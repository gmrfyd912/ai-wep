"""윤곽 2차 검토용 그림: 측정에 실제로 쓴 비드 양쪽 가장자리(초록 선)만 보정 사진 위에 그린다.
AI(Claude 비전)가 이 선이 비드 끝(토우)을 제대로 따라가는지 보고 판단한다. 글자는 넣지 않는다."""
import cv2
import numpy as np

GREEN = (0, 255, 0)
MAX_SIDE = 1568  # Claude 비전이 줄이지 않고 보는 크기


def make(rect_img, geom, to_px, align):
    """rect_img: 보정 이미지(1px=0.1mm). to_px: mm → 보정 px. align: 그림을 비드 가로 방향으로 돌리는 함수.
    반환: BGR 그림 (길면 앞·뒤 절반을 위아래로 쌓음) 또는 None."""
    st, keep, f = geom["stations"], geom["keep"], geom["to_plane"]
    ks = st[keep]
    if len(ks) < 5:
        return None
    img = rect_img.copy()
    t = max(2, int(round(img.shape[1] / 900)))
    for sign in (-1, 1):
        pts = np.array([to_px(f(p, c + sign * w / 2)) for p, w, c in ks], np.float64)
        cv2.polylines(img, [np.round(pts).astype(np.int32)], False, GREEN, t, cv2.LINE_AA)
    # 검사 구간 밖은 어둡게 (판단에서 빼라는 표시)
    z0, z1 = geom["zone"]
    if not keep.all():
        half = float(st[:, 1].max()) * 0.8 + 3.0
        cen = float(np.median(st[:, 2]))
        shade = img.copy()
        for a0, a1 in ((-5.0, z0), (z1, geom["length"] + 5.0)):
            q = [to_px(f(a0, cen - half)), to_px(f(a1, cen - half)), to_px(f(a1, cen + half)), to_px(f(a0, cen + half))]
            cv2.fillPoly(shade, [np.round(np.array(q)).astype(np.int32)], (0, 0, 0), cv2.LINE_AA)
        img = cv2.addWeighted(shade, 0.6, img, 0.4, 0)
    out = align(img)
    if out is None:
        return None
    h, w = out.shape[:2]
    if w > 2.5 * h:  # 긴 비드는 반으로 나눠 위아래로 → 가장자리가 더 크게 보인다
        m = w // 2
        gap = np.full((max(8, h // 20), m, 3), 255, np.uint8)
        out = np.vstack([out[:, :m], gap, out[:, m:2 * m]])
    s = MAX_SIDE / max(out.shape[:2])
    if s < 1:
        out = cv2.resize(out, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    return out
