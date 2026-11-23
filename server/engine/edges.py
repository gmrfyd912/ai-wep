"""비드 가장자리 다시 찾기.
Roboflow 윤곽은 계단 모양으로 거칠고 바깥으로 번지는 경우가 많아, 1mm마다 비드에 수직인
밝기 단면을 원본 사진(고해상도)에서 읽어 가장 뚜렷한 밝기 변화 위치를 새 가장자리로 삼는다.
2026-11-23 실측 21장 검증: 평균 오차 1.5mm → 1.1mm, ±1mm 이내 21/54 → 34/54곳."""
import cv2
import numpy as np

from . import rectify


def _gauss1d(a, sigma):
    r = int(3 * sigma + 0.5)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.pad(a, ((0, 0), (r, r)), mode="edge")
    return np.apply_along_axis(lambda v: np.convolve(v, k, mode="valid"), 1, pad)


def _median(a, w):
    h = w // 2
    p = np.pad(a, h, mode="edge")
    return np.array([np.median(p[i:i + w]) for i in range(len(a))])


def refine_stations(gray, H, to_plane, st, cfg):
    """st: (pos_mm, width_mm, center_mm) 배열. H: 원본 px -> 보정 px.
    반환: 폭·중심을 새 가장자리로 바꾼 배열."""
    k = cfg.px_per_mm
    Hi = np.linalg.inv(H)
    pos, w, cen = st[:, 0], st[:, 1], st[:, 2]
    inner, outer = cfg.edge_band_inner_mm, cfg.edge_band_outer_mm
    half = w.max() / 2 + outer + 2.0
    step = 1.0 / k
    offs = np.arange(-half, half + 1e-9, step)
    along = np.linspace(-0.5, 0.5, 5)  # 비드 방향 ±0.5mm 평균으로 잡음 줄이기
    pts = np.array([[to_plane(p + a, c + o) for o in offs] for p, c in zip(pos, cen) for a in along]) * k
    src = rectify.transform_points(Hi, pts.reshape(-1, 2)).reshape(pts.shape).astype(np.float32)
    v = cv2.remap(gray, src[..., 0], src[..., 1], cv2.INTER_LINEAR)
    prof = v.reshape(len(pos), len(along), len(offs)).mean(1)
    f = np.abs(np.gradient(_gauss1d(prof, 0.3 * k), axis=1))  # 0.3mm 평활 후 밝기 기울기
    tops, bots = [], []
    for i in range(len(pos)):
        t0, b0 = -w[i] / 2, w[i] / 2
        mt = (offs >= t0 - outer) & (offs <= t0 + inner)
        mb = (offs >= b0 - inner) & (offs <= b0 + outer)
        tops.append(offs[mt][np.argmax(f[i][mt])] if mt.any() else t0)
        bots.append(offs[mb][np.argmax(f[i][mb])] if mb.any() else b0)
    mw = cfg.edge_median_stations
    tops, bots = _median(np.array(tops), mw), _median(np.array(bots), mw)
    out = st.copy()
    out[:, 1] = np.maximum(bots - tops, 0.1)
    out[:, 2] = cen + (tops + bots) / 2
    return out
