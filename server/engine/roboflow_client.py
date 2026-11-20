"""Roboflow 호스팅 모델 호출 (detect.roboflow.com, ?api_key= 쿼리)."""
import base64

import cv2
import numpy as np
import requests

from .config import roboflow_key


def predict(img_bgr, cfg, timeout=60):
    """원본 이미지에 대해 예측. 반환 좌표는 원본 px 기준으로 되돌린다.
    각 항목: {class, confidence, polygon (N,2) 또는 None, box (x0,y0,x1,y1)}"""
    h, w = img_bgr.shape[:2]
    scale = min(1.0, cfg.roboflow_max_side / max(h, w))
    send = img_bgr if scale == 1.0 else cv2.resize(img_bgr, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", send, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        raise RuntimeError("이미지 인코딩 실패")
    r = requests.post(
        f"{cfg.roboflow_url}/{cfg.roboflow_model}",
        params={"api_key": roboflow_key(), "confidence": cfg.roboflow_confidence, "overlap": cfg.roboflow_overlap},
        data=base64.b64encode(buf.tobytes()).decode("ascii"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=timeout,
    )
    r.raise_for_status()
    return parse_predictions(r.json(), 1.0 / scale)


def parse_predictions(js, inv_scale=1.0):
    out = []
    for p in js.get("predictions", []):
        cx, cy, bw, bh = (float(p[k]) * inv_scale for k in ("x", "y", "width", "height"))
        poly = None
        if p.get("points"):
            poly = np.array([[pt["x"], pt["y"]] for pt in p["points"]], np.float64) * inv_scale
        out.append({
            "class": str(p.get("class", "")),
            "confidence": float(p.get("confidence", 0.0)),
            "polygon": poly,
            "box": (cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2),
        })
    return out
