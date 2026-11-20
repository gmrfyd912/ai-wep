"""합성 사진으로 기하 계산(마커→정면 보정→폭·직진도) 정확도를 확인한다.
Roboflow 대신 정답 비드 윤곽을 카메라 좌표로 투영해 넣는다 (윤곽 꼭짓점에 ±1px 잡음).
실행: python -m tests.synthetic_check"""
import sys

import cv2
import numpy as np

from engine.analyze import analyze_image
from engine.config import Config
from engine.marker import _dictionary

S = 20  # 합성 평면 해상도 px/mm
import os
NOISE = float(os.environ.get("NOISE_PX", "1.0"))  # 윤곽 꼭짓점 잡음(px)


def make_plane(cfg, rng, width_fn, center_fn, L=120.0):
    W, Hh = 220, 140  # 평판 mm
    plane = np.full((Hh * S, W * S, 3), 0, np.uint8)
    plane[:] = (150, 150, 155)
    noise = rng.normal(0, 8, plane.shape[:2])
    plane = np.clip(plane + noise[..., None], 0, 255).astype(np.uint8)
    # 마커 (흰 여백 5mm 포함) 위치: 왼쪽 위
    m = cfg.marker_size_mm
    mx, my = 15.0, 15.0
    d = _dictionary(cfg.marker_dict)
    mimg = cv2.aruco.generateImageMarker(d, cfg.marker_id, int(m * S))
    cv2.rectangle(plane, (int((mx - 5) * S), int((my - 5) * S)), (int((mx + m + 5) * S), int((my + m + 5) * S)), (255, 255, 255), -1)
    plane[int(my * S):int(my * S) + mimg.shape[0], int(mx * S):int(mx * S) + mimg.shape[1]] = mimg[..., None]
    # 비드: x = 60~60+L mm, 중심 y = center_fn(t), 폭 width_fn(t)
    t = np.linspace(0, L, 400)
    x = 70 + t
    yc = 95 + center_fn(t)
    w = width_fn(t)
    top = np.stack([x, yc - w / 2], 1)
    bot = np.stack([x, yc + w / 2], 1)[::-1]
    poly = np.vstack([top, bot])
    cv2.fillPoly(plane, [np.round(poly * S).astype(np.int32)], (70, 75, 90), cv2.LINE_AA)
    return plane, poly, (t, w, yc)


def camera(plane, poly_mm, rng, tilt_deg, rot_deg, dist=1.0, noise_px=1.0):
    """평면 이미지를 원근 변환해 카메라 사진처럼 만든다."""
    h, w = plane.shape[:2]
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    k = np.tan(np.radians(tilt_deg)) * 0.35
    dst = np.array([[w * k, 0], [w * (1 - k), 0], [w, h], [0, h]], np.float32)  # 위쪽이 멀어 보이게
    Hp = cv2.getPerspectiveTransform(src, dst)
    R = cv2.getRotationMatrix2D((w / 2, h / 2), rot_deg, 0.75 * dist)
    R = np.vstack([R, [0, 0, 1]])
    Hall = R @ Hp
    sc = np.diag([0.45, 0.45, 1.0])  # 카메라 해상도 (약 9 px/mm)
    Hall = sc @ Hall
    out_w, out_h = int(w * 0.45), int(h * 0.45)
    img = cv2.warpPerspective(plane, Hall, (out_w, out_h), flags=cv2.INTER_AREA, borderValue=(40, 40, 40))
    img = cv2.GaussianBlur(img, (3, 3), 0.8)
    img = np.clip(img + rng.normal(0, 3, img.shape), 0, 255).astype(np.uint8)
    pts = cv2.perspectiveTransform((poly_mm * S).reshape(-1, 1, 2), Hall).reshape(-1, 2)
    idx = np.linspace(0, len(pts) - 1, 80).astype(int)  # Roboflow처럼 꼭짓점 수를 줄임
    pts = pts[idx] + rng.normal(0, noise_px, (len(idx), 2))
    return img, pts


def run():
    cfg = Config()
    rng = np.random.default_rng(1)
    cases = [
        ("정면", 0, 0), ("기울기15", 15, 0), ("기울기30", 30, 0), ("회전45", 0, 45),
        ("회전90", 0, 90, 0.55), ("기울기25+회전120", 25, 120), ("기울기40", 40, 0),
    ]
    width_fn = lambda t: 8.0 + 0.8 * np.sin(t / 15.0)
    center_fn = lambda t: 1.5 * np.sin(t / 40.0)
    plane, poly, (t, w, yc) = make_plane(cfg, rng, width_fn, center_fn)
    # 정답: 시작 10mm, 중간, 끝 10mm 폭, 다듬은 구간 평균
    L = t[-1]
    tt = np.arange(0.5, L, 1.0)
    truth = {"mean": width_fn(tt[(tt >= 5) & (tt <= L - 5)]).mean(), "s10": width_fn(10.0),
             "mid": width_fn(L / 2), "e10": width_fn(L - 10.0)}
    print(f"정답: 평균 {truth['mean']:.2f}  시작10 {truth['s10']:.2f}  중간 {truth['mid']:.2f}  끝10 {truth['e10']:.2f} (mm)")
    worst = 0.0
    for name, tilt, rot, *dist in cases:
        img, pts = camera(plane, poly, rng, tilt, rot, dist[0] if dist else 1.0, NOISE)
        preds = [{"class": "weld_bead", "confidence": 0.9, "polygon": pts, "box": (*pts.min(0), *pts.max(0))}]
        res, vis, _ = analyze_image(img, cfg, predictions=preds)
        if res["status"] != "ok":
            print(name, res["status"], res.get("detail"))
            worst = 99
            continue
        b = res["bead"]["width"]
        errs = [b["mean_mm"] - truth["mean"], b["at_start_10mm"] - truth["s10"],
                b["at_middle"] - truth["mid"], b["at_end_10mm"] - truth["e10"]]
        worst = max(worst, max(abs(e) for e in errs))
        print(f"{name:16s} 평균 {b['mean_mm']:.2f}  시작10 {b['at_start_10mm']:.2f}  중간 {b['at_middle']:.2f}  "
              f"끝10 {b['at_end_10mm']:.2f}  길이 {res['bead']['length_mm']:.1f}  직진도최대 {res['bead']['straightness']['max_dev_mm']:.2f}  "
              f"최대오차 {max(abs(e) for e in errs):.2f}")
        if len(sys.argv) > 1:
            cv2.imwrite(f"{sys.argv[1]}/{name}_input.jpg", img)
            cv2.imwrite(f"{sys.argv[1]}/{name}_check.jpg", vis)
    print(f"최대 오차 {worst:.2f} mm ->", "통과" if worst <= 0.5 else "실패")
    return worst


if __name__ == "__main__":
    run()
