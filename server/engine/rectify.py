"""마커 네 꼭짓점으로 호모그래피를 구해 정면(위에서 내려다본) 이미지로 보정. 1px = 0.1mm."""
import cv2
import numpy as np


def marker_homography(corners, cfg):
    """원본 px -> 보정 평면 mm*px_per_mm 좌표 (마커 좌상단이 원점)."""
    s = cfg.marker_size_mm * cfg.px_per_mm
    dst = np.array([[0, 0], [s, 0], [s, s], [0, s]], np.float64)
    H, _ = cv2.findHomography(corners, dst, 0)
    return H


def transform_points(H, pts):
    pts = np.asarray(pts, np.float64).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(pts, H).reshape(-1, 2)


def warp_region(img, H, region_pts, cfg, max_side_px=6000):
    """보정 평면에서 region_pts(보정 좌표)를 감싸는 영역만 잘라 정면 이미지 생성.
    반환: (보정 이미지, 원본->잘라낸 보정 이미지 호모그래피)"""
    m = cfg.crop_margin_mm * cfg.px_per_mm
    x0, y0 = np.floor(region_pts.min(0) - m)
    x1, y1 = np.ceil(region_pts.max(0) + m)
    w, h = int(x1 - x0), int(y1 - y0)
    if max(w, h) > max_side_px:
        raise ValueError("보정 영역이 너무 큽니다 (촬영 각도가 너무 비스듬함).")
    T = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1]], np.float64)
    Hc = T @ H
    out = cv2.warpPerspective(img, Hc, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT)
    return out, Hc
