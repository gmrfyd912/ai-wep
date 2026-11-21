"""보정 평면(mm)에서 비드 폭·직진도·결함 크기 측정.
모든 입력 좌표는 mm 단위 보정 평면 좌표다."""
import cv2
import numpy as np


def _r(v, n=2):
    return None if v is None else round(float(v), n)


def bead_axis(poly_mm, res=10.0):
    """비드 영역의 주축(PCA). 반환: (중심, 축 단위벡터 u, 법선 n)."""
    lo = poly_mm.min(0)
    pts = np.round((poly_mm - lo) * res).astype(np.int32)
    w, h = pts.max(0) + 2
    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [pts], 1)
    ys, xs = np.nonzero(mask)
    xy = np.stack([xs, ys], 1) / res + lo
    c = xy.mean(0)
    evals, evecs = np.linalg.eigh(np.cov((xy - c).T))
    u = evecs[:, np.argmax(evals)]
    n = np.array([-u[1], u[0]])
    return c, u, n


def _crossings(poly, x):
    """다각형과 세로선 X=x 의 교차 y 값들."""
    a, b = poly, np.roll(poly, -1, 0)
    ys = []
    for (x1, y1), (x2, y2) in zip(a, b):
        if (x1 <= x < x2) or (x2 <= x < x1):
            t = (x - x1) / (x2 - x1)
            ys.append(y1 + t * (y2 - y1))
    return ys


def measure_bead(poly_mm, marker_center_mm, cfg):
    c, u, n = bead_axis(poly_mm)
    # 시작점 = 마커에 가까운 쪽 끝
    local = np.stack([(poly_mm - c) @ u, (poly_mm - c) @ n], 1)
    xmin, xmax = local[:, 0].min(), local[:, 0].max()
    m_along = (marker_center_mm - c) @ u
    if abs(m_along - xmax) < abs(m_along - xmin):
        u, n = -u, -n
        local = -local
        xmin, xmax = local[:, 0].min(), local[:, 0].max()
    length = xmax - xmin
    step = cfg.width_step_mm
    xs = np.arange(xmin + step / 2, xmax, step)
    stations = []
    for x in xs:
        ys = _crossings(local, x)
        if len(ys) < 2:
            continue
        top, bot = min(ys), max(ys)
        stations.append((x - xmin, bot - top, (top + bot) / 2))
    if len(stations) < 3:
        raise ValueError("bead_too_short")
    st = np.array(stations)  # pos_mm, width_mm, center_offset_mm
    trim = cfg.end_trim_mm
    keep = (st[:, 0] >= trim) & (st[:, 0] <= length - trim)
    if keep.sum() < 3:
        keep[:] = True
    s = st[keep]
    w = s[:, 1]
    i_min, i_max = int(np.argmin(w)), int(np.argmax(w))
    # 절사평균: 상·하위 각 width_trim_percent % 를 빼고 평균
    ws = np.sort(w)
    k = int(len(ws) * cfg.width_trim_percent / 100.0)
    w_trim = ws[k:len(ws) - k] if len(ws) - 2 * k >= 1 else ws

    # 직진도: 중심선을 최소제곱 직선(기준선)과 비교
    a, b = np.polyfit(s[:, 0], s[:, 2], 1)
    dev = s[:, 2] - (a * s[:, 0] + b)
    absdev = np.abs(dev)
    i_dev = int(np.argmax(absdev))

    def width_at(pos, half=1.0):
        # 캘리퍼스 턱 폭을 고려해 pos ±1mm 구간 평균
        sel = np.abs(st[:, 0] - pos) <= half + 1e-9
        if not sel.any():
            sel = np.abs(st[:, 0] - pos) == np.abs(st[:, 0] - pos).min()
        return _r(st[sel, 1].mean())

    def to_plane(pos, off):
        return c + (pos + xmin) * u + off * n

    geom = {
        "origin": c, "u": u, "n": n, "xmin": xmin,
        "stations": st, "keep": keep, "fit": (a, b),
        "i_min": int(np.nonzero(keep)[0][i_min]), "i_max": int(np.nonzero(keep)[0][i_max]),
        "i_dev": int(np.nonzero(keep)[0][i_dev]),
        "to_plane": to_plane, "length": length, "trim": trim if not keep.all() else 0.0,
    }
    result = {
        "length_mm": _r(length),
        "width": {
            "step_mm": step,
            "end_trim_mm": trim,
            "mean_mm": _r(w_trim.mean()),  # 절사평균 (화면에 보이는 평균)
            "mean_all_mm": _r(w.mean()),
            "trim_percent": cfg.width_trim_percent,
            "samples": int(len(w)),
            "min_mm": _r(w[i_min]), "min_pos_mm": _r(s[i_min, 0], 1),
            "max_mm": _r(w[i_max]), "max_pos_mm": _r(s[i_max, 0], 1),
            "std_mm": _r(w.std(ddof=1) if len(w) > 1 else 0.0, 3),
            "cv_percent": _r(100 * w.std(ddof=1) / w.mean() if len(w) > 1 else 0.0),
            "at_start_10mm": width_at(10.0),
            "at_middle": width_at(length / 2),
            "at_end_10mm": width_at(length - 10.0),
            "profile": [[_r(p, 1), _r(wd)] for p, wd, _ in st],
        },
        "straightness": {
            "max_dev_mm": _r(absdev.max()),
            "max_dev_pos_mm": _r(s[i_dev, 0], 1),  # 시작점에서 떨어진 거리
            "mean_dev_mm": _r(absdev.mean()),
            "rms_dev_mm": _r(np.sqrt((dev ** 2).mean())),
            "baseline_angle_deg": _r(np.degrees(np.arctan(a))),
        },
    }
    return result, geom


def _skeleton_length_mm(poly_mm, res=10.0):
    lo = poly_mm.min(0)
    pts = np.round((poly_mm - lo) * res).astype(np.int32) + 2
    w, h = pts.max(0) + 3
    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [pts], 255)
    sk = cv2.ximgproc.thinning(mask) > 0
    # 이웃 연결 길이 합 (가로·세로 1, 대각 √2) — 각 연결이 두 번 세지지 않도록 오른쪽/아래 방향만
    L = (sk[:, :-1] & sk[:, 1:]).sum() + (sk[:-1, :] & sk[1:, :]).sum()
    L += np.sqrt(2) * ((sk[:-1, :-1] & sk[1:, 1:]).sum() + (sk[:-1, 1:] & sk[1:, :-1]).sum())
    return L / res


def measure_defect(pred, pts_mm, bead_geom, cfg):
    rect = cv2.minAreaRect(pts_mm.astype(np.float32))
    (rw, rh) = rect[1]
    length, width = max(rw, rh), min(rw, rh)
    linear = any(k in pred["class"].lower() for k in cfg.linear_defect_keywords)
    if linear and pred["polygon"] is not None and len(pts_mm) >= 3:
        length = max(_skeleton_length_mm(pts_mm), length if width < 0.5 else 0.0)
    area = cv2.contourArea(pts_mm.astype(np.float32)) if pred["polygon"] is not None else rw * rh
    center = pts_mm.mean(0)
    pos = None
    if bead_geom is not None:
        pos = (center - bead_geom["origin"]) @ bead_geom["u"] - bead_geom["xmin"]
    return {
        "type": pred["class"],
        "confidence": _r(pred["confidence"], 3),
        "length_mm": _r(length),
        "width_mm": _r(width),
        "area_mm2": _r(area),
        "pos_along_bead_mm": _r(pos, 1),
        # 양 끝 제외 구간 안의 결함은 그림에만 보이고 결함 목록·개수에서는 뺀다
        "in_end_zone": bool(pos is not None and bead_geom.get("trim", 0) > 0
                            and (pos < bead_geom["trim"] or pos > bead_geom["length"] - bead_geom["trim"])),
        "shape": "polygon" if pred["polygon"] is not None else "box",
    }
