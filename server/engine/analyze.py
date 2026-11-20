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


def analyze_image(img, cfg=None, predictions=None):
    """img: BGR 배열 또는 파일 경로. predictions: 테스트용(주면 Roboflow 호출 생략).
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
    if predictions is None:
        try:
            predictions = roboflow_client.predict(img, cfg)
        except Exception as e:  # 네트워크·키 오류
            return _error("roboflow_failed", str(e)), None, None
    res["detections"] = {"classes": sorted({p["class"] for p in predictions})}
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
    res["defects"] = [d for d, _ in defects]

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
    res["rectified"] = {"px_per_mm": k, "width": rect_img.shape[1], "height": rect_img.shape[0]}
    res["timing_s"] = round(time.time() - t0, 2)
    return res, vis, rect_img


def _error(code, detail=""):
    return {"engine_version": ENGINE_VERSION, "status": code, "detail": detail}
