"""분석 파이프라인: 마커 → 정면 보정 → Roboflow → 측정 → JSON + 그림."""
import time

import cv2
import numpy as np

from . import marker as mk
from . import measure, rectify, roboflow_client, visualize
from .config import Config

ENGINE_VERSION = "0.2.0"


def _is_bead(cls, cfg):
    c = cls.lower()
    return any(k in c for k in cfg.bead_class_keywords)


def _pred_points(p):
    if p["polygon"] is not None and len(p["polygon"]) >= 3:
        return p["polygon"]
    x0, y0, x1, y1 = p["box"]
    return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], float)


def _box_of(p):
    x0, y0, x1, y1 = p["box"]
    return {"class": p["class"], "confidence": round(float(p.get("confidence", 0.0)), 3),
            "x": round(x0, 1), "y": round(y0, 1), "w": round(x1 - x0, 1), "h": round(y1 - y0, 1)}


def analyze_image(img, cfg=None, predictions=None, progress=None):
    """img: BGR 배열 또는 파일 경로. predictions: 테스트용(주면 Roboflow 호출 생략).
    progress: 단계 이름을 받는 함수 (marker → roboflow → measure). 앱 진행 표시용.
    반환: (result dict, 확인용 그림, 보정 이미지)"""
    cfg = cfg or Config()
    t0 = time.time()
    if isinstance(img, str):
        img = cv2.imread(img, cv2.IMREAD_COLOR)
        if img is None:
            return _error("image_read_failed"), None, None
    res = {"engine_version": ENGINE_VERSION, "status": "ok", "warnings": [],
           "image": {"width": img.shape[1], "height": img.shape[0]},
           "marker": {"dict": cfg.marker_dict, "id": cfg.marker_id, "size_mm": cfg.marker_size_mm}}
    step = progress or (lambda name: None)
    step("marker")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    try:
        corners = mk.detect_marker(gray, cfg)
    except mk.MarkerNotFound as e:
        return _error("marker_not_found", str(e)), None, None
    res["marker"].update(mk.marker_quality(corners))
    H = rectify.marker_homography(corners, cfg)  # 원본 px -> 보정 px (1px=0.1mm)
    k = cfg.px_per_mm

    def to_mm(pts):
        return rectify.transform_points(H, pts) / k

    marker_mm = to_mm(corners)
    step("roboflow")
    if predictions is None:
        try:
            predictions = roboflow_client.predict(img, cfg)
        except Exception as e:  # 네트워크·키 오류
            return _error("roboflow_failed", str(e)), None, None
    step("measure")
    res["detections"] = {"classes": sorted({p["class"] for p in predictions}),
                         # AI가 찾은 상자 (원본 px, 왼쪽 위 x·y + 폭·높이): 학습용 사진 받기의 라벨
                         "boxes": [_box_of(p) for p in predictions]}
    predictions = [p for p in predictions if not any(k in p["class"].lower() for k in cfg.ignore_class_keywords)]
    beads = [p for p in predictions if _is_bead(p["class"], cfg)]
    others = [p for p in predictions if not _is_bead(p["class"], cfg)]
    res["detections"]["bead_count"] = len(beads)

    bead_mm, geom = None, None
    if not beads:
        res["status"] = "no_bead"
    else:
        best = max(beads, key=lambda p: cv2.contourArea(_pred_points(p).astype(np.float32)))
        if best["polygon"] is None:
            res["warnings"].append("bead_box_only")
        if len(beads) > 1:
            res["warnings"].append("multiple_beads")
        bead_mm = to_mm(_pred_points(best))
        try:
            res["bead"], geom = measure.measure_bead(bead_mm, marker_mm.mean(0), cfg)
            res["bead"]["confidence"] = round(best["confidence"], 3)
        except ValueError as e:
            res["status"] = str(e)

    defects = []
    for p in others:
        pts = to_mm(_pred_points(p))
        defects.append((measure.measure_defect(p, pts, geom, cfg), pts))
    res["defects"] = [d for d, _ in defects if not d["in_end_zone"]]
    res["defects_end_zone"] = [d for d, _ in defects if d["in_end_zone"]]

    # 보정 이미지: 마커 + 비드 + 결함을 감싸는 영역
    region = [marker_mm] + ([bead_mm] if bead_mm is not None else []) + [p for _, p in defects]
    region_px = np.vstack(region) * k
    try:
        rect_img, Hc = rectify.warp_region(img, H, region_px, cfg)
    except ValueError:
        res["warnings"].append("rectify_too_large")
        res["timing_s"] = round(time.time() - t0, 2)
        return res, None, None
    offset = (Hc @ np.linalg.inv(H))[:2, 2]

    def to_px(p_mm):
        return p_mm * k + offset

    vis = visualize.draw(rect_img, cfg, to_px, bead_mm, geom, defects, marker_mm)
    if geom is not None:
        # 확인 그림을 비드가 가로로 눕고 시작(마커 쪽)이 왼쪽에 오게 돌린다 → 앱 그래프와 위치가 맞음
        # 마커는 빼고 비드(+결함)만 잘라서, 그림 폭이 그래프의 가로(비드 길이)와 거의 같게 한다
        keep_pts = np.vstack([bead_mm] + [p for _, p in defects])
        vis, res["check_layout"] = _align_to_bead(vis, geom, keep_pts, k, offset, cfg)
    res["rectified"] = {"px_per_mm": k, "width": rect_img.shape[1], "height": rect_img.shape[0]}
    res["timing_s"] = round(time.time() - t0, 2)
    return res, vis, rect_img


def _align_to_bead(vis, geom, region_mm, k, offset, cfg, max_side_px=6000):
    """보정 그림(px)을 비드 좌표계로 회전·자르기. 가로 = 시작에서 거리(mm), 세로 = 비드 폭 방향.
    반환 layout: 그림 왼쪽·오른쪽 끝이 시작에서 몇 mm인지(x_start_mm, x_end_mm),
    dev_sign = 직진도 이탈값에 곱하면 그림의 위쪽이 그래프의 + 가 됨."""
    u = np.asarray(geom["u"], float)
    v = np.array([-u[1], u[0]])  # 회전만 (뒤집기 없음)
    c = np.asarray(geom["origin"], float)
    xmin = float(geom["xmin"])
    mx, my = 5.0, 8.0  # 비드 둘레 여백 (mm): 가로, 세로
    s = (region_mm - c) @ u - xmin
    o = (region_mm - c) @ v
    s0, s1 = float(s.min() - mx), float(s.max() + mx)
    o0, o1 = float(o.min() - my), float(o.max() + my)
    w, h = int(np.ceil((s1 - s0) * k)), int(np.ceil((o1 - o0) * k))
    if max(w, h) > max_side_px:
        return vis, None
    off = np.asarray(offset, float)
    M = np.array([
        [u[0], u[1], -u @ off - k * (c @ u + xmin + s0)],
        [v[0], v[1], -v @ off - k * (c @ v + o0)],
    ])
    out = cv2.warpAffine(vis, M, (w, h), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0))
    n = np.asarray(geom["n"], float)
    layout = {
        "x_start_mm": round(s0, 2), "x_end_mm": round(s1, 2),
        "width": w, "height": h,
        "dev_sign": -1 if float(n @ v) > 0 else 1,
    }
    return out, layout


def _error(code, detail=""):
    return {"engine_version": ENGINE_VERSION, "status": code, "detail": detail}
