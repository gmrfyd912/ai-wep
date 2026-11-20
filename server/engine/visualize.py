"""확인용 그림 (글자 없음). 보정 이미지 위에 선·점만 그린다."""
import cv2
import numpy as np

GREEN, YELLOW, BLUE, CYAN = (60, 220, 60), (0, 230, 255), (255, 120, 0), (255, 255, 0)
RED, MAGENTA, ORANGE, WHITE, BLACK = (0, 0, 255), (255, 0, 255), (0, 140, 255), (255, 255, 255), (0, 0, 0)


def draw(rect_img, cfg, to_px, bead_poly_mm=None, geom=None, defects=(), marker_mm=None):
    """to_px: mm 좌표 -> 보정 이미지 px 변환 함수."""
    img = rect_img.copy()
    t = max(2, int(round(img.shape[1] / 600)))

    def P(p):
        return tuple(int(round(v)) for v in to_px(np.asarray(p, float)))

    def poly(pts, col, th):
        cv2.polylines(img, [np.array([P(p) for p in pts], np.int32)], True, col, th, cv2.LINE_AA)

    if marker_mm is not None:
        poly(marker_mm, WHITE, t)
    if bead_poly_mm is not None:
        poly(bead_poly_mm, GREEN, t)
    if geom is not None:
        st, keep, (a, b), f = geom["stations"], geom["keep"], geom["fit"], geom["to_plane"]
        for i, (pos, w, cen) in enumerate(st):
            if i in (geom["i_min"], geom["i_max"]):
                col = RED if i == geom["i_min"] else MAGENTA
                cv2.line(img, P(f(pos, cen - w / 2)), P(f(pos, cen + w / 2)), col, t + 1, cv2.LINE_AA)
            elif keep[i] and abs(pos - round(pos / 5) * 5) < cfg.width_step_mm / 2:
                cv2.line(img, P(f(pos, cen - w / 2)), P(f(pos, cen + w / 2)), CYAN, max(1, t // 2), cv2.LINE_AA)
        ks = st[keep]
        cl = [P(f(p, c)) for p, _, c in ks]
        cv2.polylines(img, [np.array(cl, np.int32)], False, YELLOW, t, cv2.LINE_AA)
        p0, p1 = ks[0, 0], ks[-1, 0]
        cv2.line(img, P(f(p0, a * p0 + b)), P(f(p1, a * p1 + b)), BLUE, t, cv2.LINE_AA)
        cv2.circle(img, P(f(0, st[0, 2])), 3 * t, GREEN, -1, cv2.LINE_AA)  # 시작점 표시
    for d, pts in defects:
        col = RED if "crack" in d["type"].lower() else ORANGE
        poly(pts, col, t)
    # 10mm 축척 막대 (왼쪽 아래)
    L = int(round(10 * cfg.px_per_mm))
    x0, y0 = 20, img.shape[0] - 20
    cv2.line(img, (x0, y0), (x0 + L, y0), BLACK, t + 4)
    cv2.line(img, (x0, y0), (x0 + L, y0), WHITE, t)
    return img
