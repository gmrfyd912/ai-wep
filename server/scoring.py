"""5단계: 점수(100점)와 AI 예비판정(합격/불합격).

점수·판정은 AI가 아니라 이 공식으로 계산한다. 같은 비드는 항상 같은 점수가 나와야
랭킹이 공정하기 때문이다. AI 리포트는 이 결과를 받아서 설명만 한다.

검사기준(박사 결정 2026-11-21)
- 폭 균일 40점: 검사구간 최대폭−최소폭이 full_mm 이하면 만점, zero_mm 이상이면 0점, 사이는 비례
- 직진도 30점: 기준선 대비 최대 이탈이 full_mm 이하면 만점, zero_mm 이상이면 0점, 사이는 비례
- 결함 30점: 결함 1개당 종류별 감점 (스패터는 감점 없음), 0점 아래로는 안 내려감
- 불합격: fail_types(지금은 균열만)가 1개라도 있으면 불합격, 점수는 fail_score_cap(59점)까지만
- 불합격: 점수가 pass_score(80점) 미만이어도 불합격 (박사 결정 2026-11-21)
- 선급 검사표를 받기 전까지의 임시 기준이다.

기준값은 교사가 아니라 시스템관리자가 정한다. Supabase app_settings 표의 'criteria' 값이
있으면 아래 기본값 위에 덮어쓴다 (6단계 시스템관리자 화면이 이 값을 고친다).
"""
import copy
import time

import store

DEFAULT_CRITERIA = {
    "width": {"points": 40, "full_mm": 1.0, "zero_mm": 4.0},
    "straight": {"points": 30, "full_mm": 0.5, "zero_mm": 3.0},
    "defects": {
        "points": 30,
        # 결함 이름(Roboflow 클래스)에 이 글자가 들어 있으면 그 감점. 없으면 default.
        "deduct": {"porosity": 10, "undercut": 10, "overlap": 10, "spatter": 0},
        "deduct_default": 10,
    },
    "fail_types": ["crack"],
    "fail_score_cap": 59,
    # 이 점수 미만이면 불합격
    "pass_score": 80,
    # 기기 1대가 하루(한국 시간)에 새로 만들 수 있는 AI 리포트 수
    "report_daily_limit": 2,
}

_CACHE = {"at": 0.0, "value": None}
CACHE_SECONDS = 300


def _merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def criteria():
    """현재 검사기준. Supabase 값을 5분 동안 기억해 둔다. 표가 없거나 읽기 실패면 기본값."""
    now = time.time()
    if _CACHE["value"] is not None and now - _CACHE["at"] < CACHE_SECONDS:
        return _CACHE["value"]
    over = None
    try:
        over = store.get_setting("criteria")
    except Exception as e:  # noqa: BLE001 - 설정 표가 없어도 기본값으로 동작
        print("[criteria] 기본값 사용:", type(e).__name__, str(e)[:200], flush=True)
    value = _merge(DEFAULT_CRITERIA, over if isinstance(over, dict) else None)
    _CACHE.update(at=now, value=value)
    return value


def _linear(value, rule):
    pts = rule["points"]
    if value is None:
        return None
    full, zero = rule["full_mm"], rule["zero_mm"]
    if value <= full:
        return float(pts)
    if value >= zero:
        return 0.0
    return pts * (zero - value) / (zero - full)


def _is(kind, name):
    return kind.lower() in (name or "").lower()


def score(width_min, width_max, straight_max_dev, defect_types, crit=None):
    """측정값 → {score, verdict, parts, fail_reasons}. 값이 없으면 None.
    defect_types = 검사구간 결함 이름 목록 (끝 구간 결함은 이미 빠져 있음)."""
    if width_min is None or width_max is None or straight_max_dev is None:
        return None
    c = crit or criteria()
    wr = max(0.0, float(width_max) - float(width_min))
    sd = abs(float(straight_max_dev))
    w_pts = _linear(wr, c["width"])
    s_pts = _linear(sd, c["straight"])

    types = [t for t in (defect_types or []) if t]
    d = c["defects"]
    items = []
    for t in types:
        minus = next((v for k, v in d["deduct"].items() if _is(k, t)), d["deduct_default"])
        if any(_is(f, t) for f in c["fail_types"]):
            minus = 0  # 불합격 결함은 감점 대신 불합격으로 처리
        items.append({"type": t, "minus": minus})
    d_pts = max(0.0, d["points"] - sum(i["minus"] for i in items))

    fail_reasons = sorted({t for t in types if any(_is(f, t) for f in c["fail_types"])})
    total = round(w_pts + s_pts + d_pts)
    if fail_reasons:
        total = min(total, int(c["fail_score_cap"]))
    pass_score = int(c.get("pass_score", 80))
    low = total < pass_score
    return {
        "score": int(total),
        "verdict": "fail" if fail_reasons or low else "pass",
        "fail_reasons": fail_reasons,
        "fail_low_score": low,
        "pass_score": pass_score,
        "parts": {
            "width": {"points": round(w_pts, 1), "max": c["width"]["points"], "value_mm": round(wr, 2)},
            "straight": {"points": round(s_pts, 1), "max": c["straight"]["points"], "value_mm": round(sd, 2)},
            "defects": {"points": round(d_pts, 1), "max": d["points"], "items": items},
        },
    }


def score_of_row(row, crit=None):
    """submissions 행(전체 result 포함) 또는 목록 행(width_min_mm 등 꺼낸 값)에서 점수 계산."""
    if row.get("status") != "ok":
        return None
    res = row.get("result")
    if isinstance(res, dict):
        bead = res.get("bead") or {}
        w = bead.get("width") or {}
        st = bead.get("straightness") or {}
        types = [x.get("type") for x in (res.get("defects") or []) if isinstance(x, dict)]
        return score(w.get("min_mm"), w.get("max_mm"), st.get("max_dev_mm"), types, crit)
    types = row.get("defect_types") or []
    types = [x.get("type") if isinstance(x, dict) else x for x in types]
    return score(row.get("width_min_mm"), row.get("width_max_mm"), row.get("straight_max_dev_mm"), types, crit)
