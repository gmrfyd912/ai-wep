"""G1(게임): 웰디의 조선소 — 내 조선소 키우기 (혼자 하기).

원칙 (박사 승인 2026-11-27, 계획안 https://claude.ai/artifact/FuBHW7hFvEm1V7r5f2GtKL):
- 자원은 공부로만 생긴다. 서버가 학습 기록(매일 문제·웰디 문제·돌발 OX·교재 진도·실습 점수)을 읽어
  아직 안 준 것만 '자원 장부'(game_ledger)에 한 줄씩 적는다. 줄마다 열쇠(key)가 있어 같은 공부로 두 번 받지 않는다.
  잔액 = 장부 합계 (쓴 것도 음수 줄로 적는다). 현금 결제 없음.
- 공장은 그날 매일 문제를 다 푼 날(한국 날짜)에만 돌아간다.
- 본관 레벨을 올리려면 교재 장 완료가 필요하다 (장 완료 = 쪽 80% 이상 보고, 그 장 문제 2개 이상 맞힘).
- 즉시 완료권은 실습 점수로만 (90점 이상·실력 급상승·개인 최고점·새 자세 첫 합격, 하루 2장).
- 공사·배 건조는 '끝나는 시각'만 저장하고, 화면을 열 때 계산한다 (무료 서버가 자고 있어도 됨).
- 교육생만 (관리자는 시험용으로 들어갈 수 있음). 학습 보드 점수와는 따로.
- 모든 숫자는 예시이며 관리자 '게임 설정'에서 바꾼다 (보상·장 완료 기준·게임 켜기).
G2(공격·방어)·G3(대항전)는 다음 단계.
"""
import math
import threading
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import accounts
import daily
import manage
import scoring
import store
import textbook
from admin_settings import _save_setting, need_admin

router = APIRouter()
KST = timezone(timedelta(hours=9))
GRID = 14                    # 땅 14 × 14 칸
BUILDERS = 2                 # 작업 반장 (동시에 공사 2곳)
MAX_LEVEL = 8
FACTORY_BUFFER_H = 8         # 공장에 쌓이는 최대 시간
TECH_SECONDS = 600           # 기술 포인트 1개 = 10분 줄이기
PASS_SECONDS = 8 * 3600      # 즉시 완료권 1장 = 바로 끝 (남은 시간이 더 길면 8시간만 줄임)
PRACTICE_PASS = 80           # 실습 점수 이 이상이면 강판 보너스 (하루 1번)
LEVEL_MULT = [0, 1, 2, 4, 7, 11, 16, 22, 30]
LEVEL_TIME = [0, 60, 600, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 24 * 3600]
HQ_UNITS = [0, 0, 1, 2, 3, 5, 7, 9, 11]          # 본관 레벨 n 이 되려면 장 완료 수
HQ_CAP = {"steel": 1000, "rods": 600}            # 본관 기본 저장량
CAP_TABLE = [0, 1500, 3000, 6000, 10000, 15000, 22000, 30000, 40000]
PROD_TABLE = [0, 60, 90, 130, 180, 240, 310, 390, 480]   # 시간당 생산 (강판, 용접봉은 절반)

# 건물: 크기(w,h)·비용 기본값·본관 몇 레벨부터·옮길 수 있나
BUILDINGS = {
    "hq":       {"size": (3, 3), "steel": 400, "rods": 100, "unlock": 1, "max": 8},
    "yard":     {"size": (2, 2), "steel": 200, "rods": 0, "unlock": 1, "max": 8},
    "rodstore": {"size": (2, 2), "steel": 200, "rods": 0, "unlock": 1, "max": 8},
    "cutting":  {"size": (2, 2), "steel": 150, "rods": 50, "unlock": 1, "max": 8},
    "welding":  {"size": (2, 2), "steel": 250, "rods": 0, "unlock": 2, "max": 8},
    "academy":  {"size": (2, 2), "steel": 300, "rods": 100, "unlock": 2, "max": 8},
    "dock":     {"size": (2, 5), "steel": 300, "rods": 100, "unlock": 1, "max": 5, "fixed": True},
}
START = [("hq", 6, 6, 1), ("cutting", 2, 2, 1), ("dock", 12, 1, 1)]
# 배: 도크 레벨·장 완료 수·비용·공정 5개 시간 배수·인도 명성
# 진수식(인도) 보상 "pay": 선주가 주는 대금 = 강판·용접봉·기술 포인트 (만든 비용보다 많이). 숫자는 예시.
SHIPS = {
    "barge":     {"dock": 1, "units": 0, "steel": 200, "rods": 100, "mult": 1, "fame": 10,
                  "pay": {"steel": 350, "rods": 180, "tech": 5}},
    "bulk":      {"dock": 2, "units": 1, "steel": 800, "rods": 400, "mult": 6, "fame": 25,
                  "pay": {"steel": 1300, "rods": 650, "tech": 15}},
    "container": {"dock": 3, "units": 3, "steel": 2000, "rods": 1000, "mult": 15, "fame": 50,
                  "pay": {"steel": 3200, "rods": 1600, "tech": 30}},
    "lng":       {"dock": 4, "units": 5, "steel": 4500, "rods": 2500, "mult": 30, "fame": 90,
                  "pay": {"steel": 7000, "rods": 3800, "tech": 60}},
    "offshore":  {"dock": 5, "units": 7, "steel": 8000, "rods": 4500, "mult": 50, "fame": 150,
                  "pay": {"steel": 12500, "rods": 7000, "tech": 100}},
}
FIRST_SHIP_PASSES = 1        # 그 종류 배를 처음 인도하면 즉시 완료권 1장 (종류마다 한 번)
TUTORIAL_COLLECT = {"steel": 100, "rods": 50}   # 처음 따라 하기 '생산분 받기'에 받을 게 없으면 첫 생산분 선물
STAGE_SECONDS = [60, 120, 180, 120, 60]          # 블록 제작 → 대조립 → 도크 탑재 → 진수 → 인도
STAGES = ("block", "assembly", "erection", "launch", "delivery")
DEFAULTS = {
    "enabled": True,
    "welcome_steel": 500, "welcome_rods": 300,
    "daily_done_steel": 300,          # 오늘 매일 문제 다 풀기
    "daily_ok_rods": 100,             # 매일 문제 맞힘 (OX·객관식·단답형, 처음 푼 답)
    "daily_ok_rods_short": 200,       # 서술형 맞힘
    "redo_tech": 5,                   # 전에 틀린 문제를 다시 맞힘
    "live_ok_rods": 50,               # 돌발 OX 맞힘
    "tutor_ok_tech": 1,               # 웰디가 낸 연습 문제 맞힘 (문제마다 처음 한 번)
    "unit_done_tech": 30,             # 교재 한 장 완료
    "unit_pages_pct": 80,             # 장 완료: 쪽을 이만큼 이상 봄
    "unit_correct": 2,                # 장 완료: 그 장 문제를 이만큼 이상 맞힘
    "practice_steel": 200,            # 실습 80점 이상 (하루 1번)
    "pass_day_max": 2,                # 즉시 완료권 하루 최대
    "pass_high_score": 90,            # 고득점 기준
    "pass_jump": 10,                  # 실력 급상승: 같은 자세 지난 5번 평균보다 이만큼 이상
}
SETTING_KEYS = tuple(DEFAULTS)
GAME_ROLES = ("student", "admin")

LAUNCH_KEEP = 600            # 같은 반 친구에게 진수 알림을 보여 주는 시간 (초)
_launches: list[dict] = []   # 최근 진수 (메모리, 서버가 다시 켜지면 비워짐)
_launch_lock = threading.Lock()

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _err(status, code, **extra):
    raise HTTPException(status, {"code": code, **extra})


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def _dt(v):
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _lock(uid):
    with _locks_guard:
        return _locks.setdefault(uid, threading.Lock())


def settings():
    raw = store.get_setting("game") or {}
    out = dict(DEFAULTS)
    for k, v in raw.items():
        if k in DEFAULTS and isinstance(v, type(DEFAULTS[k])):
            out[k] = v
    return out


def need_player(user=Depends(accounts.current_user)):
    if user["role"] not in GAME_ROLES:
        _err(403, "students_only")
    if not settings()["enabled"] and user["role"] != "admin":
        _err(403, "game_off")
    return user


# ---- 비용·시간 ----

def cost(btype, level):
    """level 이 되는 공사 비용 (1 = 새로 짓기)."""
    b = BUILDINGS[btype]
    m = LEVEL_MULT[level]
    return {"steel": b["steel"] * m, "rods": b["rods"] * m}


def build_seconds(level):
    return LEVEL_TIME[level]


def caps(buildings):
    out = dict(HQ_CAP)
    for b in buildings:
        lv = b["level"]  # 새로 짓는 중이면 0
        if b["type"] == "yard" and lv:
            out["steel"] += CAP_TABLE[lv]
        if b["type"] == "rodstore" and lv:
            out["rods"] += int(CAP_TABLE[lv] * 0.6)
    return out


def ship_stage_seconds(kind, stage):
    return STAGE_SECONDS[stage] * SHIPS[kind]["mult"]


# ---- 장부 ----

def ledger(uid):
    return store.select("game_ledger", {"user_id": f"eq.{uid}", "select": "key,steel,rods,tech,passes,fame,note,created_at",
                                        "order": "created_at.asc", "limit": "20000"})


def balance(rows):
    out = {"steel": 0, "rods": 0, "tech": 0, "passes": 0, "fame": 0}
    for r in rows:
        for k in out:
            out[k] += int(r.get(k) or 0)
    return out


def _add(uid, rows):
    """새 장부 줄 쓰기. 같은 열쇠가 이미 있으면 그 줄은 무시 (두 번 받기 방지)."""
    if not rows:
        return
    for r in rows:
        r["user_id"] = uid
        for k in ("steel", "rods", "tech", "passes", "fame"):
            r.setdefault(k, 0)
        r.setdefault("note", "")
    store.upsert("game_ledger", rows, on_conflict="user_id,key", ignore=True)


def _spend(uid, key, price, note):
    _add(uid, [{"key": key, "steel": -price.get("steel", 0), "rods": -price.get("rods", 0),
                "tech": -price.get("tech", 0), "passes": -price.get("passes", 0), "note": note}])


def _afford(bal, price):
    return all(bal.get(k, 0) >= v for k, v in price.items() if v)


# ---- 공부 → 자원 (아직 안 준 것만) ----

def daily_done_days(uid):
    """매일 문제를 다 푼 한국 날짜 모음."""
    sets = store.select("daily_sets", {"user_id": f"eq.{uid}", "select": "day,question_ids"})
    cnt = {}
    for r in store.select("daily_answers", {"user_id": f"eq.{uid}", "select": "day", "limit": "20000"}):
        cnt[r["day"]] = cnt.get(r["day"], 0) + 1
    return {s["day"] for s in sets if s.get("question_ids") and cnt.get(s["day"], 0) >= len(s["question_ids"])}


def unit_progress(uid, st):
    """지금 교재 장마다 {key,title,pdf_page,pages,seen,correct,done}."""
    book = textbook.current_book()
    if not book:
        return None, []
    units = daily.book_units(book)
    seen = {r["page"] for r in store.select("textbook_progress", {"user_id": f"eq.{uid}", "book_id": f"eq.{book['id']}",
                                                                   "select": "page", "limit": "5000"})}
    right = {}
    qids = set()
    for r in store.select("daily_answers", {"user_id": f"eq.{uid}", "book_id": f"eq.{book['id']}",
                                            "select": "question_id,score", "limit": "20000"}):
        if r.get("score") is not None and r["score"] >= daily.PASS_SCORE:
            qids.add(r["question_id"])
    for table in ("tutor_answers", "live_ox_answers"):
        try:
            for r in store.select(table, {"user_id": f"eq.{uid}", "book_id": f"eq.{book['id']}",
                                          "select": "question_id,correct", "limit": "20000"}):
                if r.get("correct") and r.get("question_id"):
                    qids.add(r["question_id"])
        except Exception as e:  # noqa: BLE001  (step9·13 SQL 전)
            print("[game] 기록 못 읽음", table, str(e)[:120], flush=True)
    ids = sorted(qids)
    for i in range(0, len(ids), 150):
        for q in store.select("quiz_questions", {"id": f"in.({','.join(ids[i:i + 150])})", "select": "id,unit_key"}):
            right[q["unit_key"]] = right.get(q["unit_key"], 0) + 1
    out = []
    for key, title, s, e in units:
        pages = e - s + 1
        n = sum(1 for p in seen if s <= p <= e)
        ok = right.get(key, 0)
        done = n * 100 >= pages * st["unit_pages_pct"] and ok >= st["unit_correct"]
        out.append({"key": key, "title": title, "pdf_page": s, "pages": pages, "seen": n, "correct": ok, "done": done})
    return book, out


def _practice_rewards(uid, st):
    """실습 기록 → 강판 보너스(80점↑ 하루 1번)와 즉시 완료권 (하루 최대 pass_day_max)."""
    rows = store.select("submissions", {"user_id": f"eq.{uid}", "select": store.LIST_SELECT, "order": "created_at.asc",
                                        "limit": "5000"})
    out = []
    seen_meas = set()
    hist = {}        # (평판/배관, 공정, 자세) → 지난 점수들
    passed_pos = set()
    best = {}
    per_day = {}
    for r in rows:
        if r.get("status") != "ok" or r.get("hidden"):
            continue
        sc = scoring.score_of_row(r)
        if not sc:
            continue
        # 같은 사진을 다시 올린 것으로 보이면 (측정값이 완전히 같음) 건너뜀
        meas = (r.get("work_type") or "plate", r.get("position"), r.get("width_mean_mm"), r.get("straight_max_dev_mm"),
                r.get("defect_count"))
        if meas in seen_meas:
            continue
        seen_meas.add(meas)
        score = sc["score"]
        day = (_dt(r["created_at"]) or _now()).astimezone(KST).date().isoformat()
        pos = (r.get("work_type") or "plate", r.get("process"), r.get("position"))
        if score >= PRACTICE_PASS:
            out.append({"key": f"prac:{day}", "steel": st["practice_steel"], "note": "practice"})
        got = []
        prev = hist.get(pos, [])
        if score >= st["pass_high_score"]:
            got.append(("high", 1))
        if len(prev) >= 3 and score - sum(prev[-5:]) / len(prev[-5:]) >= st["pass_jump"]:
            got.append(("jump", 2))
        if prev and score > best.get(pos, -1):
            got.append(("best", 1))
        if sc["verdict"] == "pass" and pos not in passed_pos:
            got.append(("first", 1))
            passed_pos.add(pos)
        hist.setdefault(pos, []).append(score)
        best[pos] = max(best.get(pos, -1), score)
        for why, n in got:
            left = st["pass_day_max"] - per_day.get(day, 0)
            n = min(n, left)
            if n <= 0:
                break
            per_day[day] = per_day.get(day, 0) + n
            out.append({"key": f"pass:{why}:{r['id']}", "passes": n, "note": f"pass_{why}"})
    return out


def study_rewards(uid, st, have):
    """아직 장부에 없는 공부 보상 줄 목록."""
    out = []
    if "welcome" not in have:
        out.append({"key": "welcome", "steel": st["welcome_steel"], "rods": st["welcome_rods"], "note": "welcome"})
    for d in daily_done_days(uid):
        out.append({"key": f"daily_done:{d}", "steel": st["daily_done_steel"], "note": "daily_done"})
    rows = store.select("daily_answers", {"user_id": f"eq.{uid}", "select": "day,question_id,kind,score,created_at",
                                          "order": "created_at.asc", "limit": "20000"})
    wrong_before = set()
    first = set()
    for r in rows:
        if r.get("score") is None:
            continue
        ok = r["score"] >= daily.PASS_SCORE
        q = r["question_id"]
        if ok and q not in first:
            amt = st["daily_ok_rods_short"] if r.get("kind") == "short" else st["daily_ok_rods"]
            out.append({"key": f"daily_ok:{q}", "rods": amt, "note": "daily_ok"})
            if q in wrong_before:
                out.append({"key": f"redo:{q}", "tech": st["redo_tech"], "note": "redo"})
        if ok:
            first.add(q)
        else:
            wrong_before.add(q)
    try:
        for r in store.select("live_ox_answers", {"user_id": f"eq.{uid}", "select": "quiz_id,correct", "limit": "20000"}):
            if r.get("correct"):
                out.append({"key": f"live:{r['quiz_id']}", "rods": st["live_ok_rods"], "note": "live_ok"})
    except Exception as e:  # noqa: BLE001
        print("[game] 돌발 OX 못 읽음", str(e)[:120], flush=True)
    try:
        for r in store.select("tutor_answers", {"user_id": f"eq.{uid}", "select": "question_id,correct", "limit": "20000"}):
            if r.get("correct") and r.get("question_id"):
                out.append({"key": f"tutor:{r['question_id']}", "tech": st["tutor_ok_tech"], "note": "tutor_ok"})
    except Exception as e:  # noqa: BLE001
        print("[game] 웰디 문제 못 읽음", str(e)[:120], flush=True)
    book, units = unit_progress(uid, st)
    for u in units:
        if u["done"]:
            out.append({"key": f"unit:{book['id']}:{u['key']}", "tech": st["unit_done_tech"], "note": "unit_done"})
    out += _practice_rewards(uid, st)
    uniq = {}
    for r in out:
        if r["key"] not in have:
            uniq.setdefault(r["key"], r)
    return list(uniq.values()), book, units


# ---- 공사·배 마무리 ----

def _finish_due(uid, buildings, ships, now):
    for b in buildings:
        end = _dt(b.get("busy_until"))
        if end and end <= now:
            store.patch("game_buildings", {"id": f"eq.{b['id']}"},
                        {"level": b["level"] + 1, "busy_until": None, "finished_at": _iso(end)})
            b["level"] += 1
            b["busy_until"] = None
            b["finished_at"] = _iso(end)


def _base(uid):
    rows = store.select("game_bases", {"user_id": f"eq.{uid}", "select": "*"})
    if rows:
        return rows[0], False
    now = _now()
    base = {"user_id": uid, "tutorial_done": False, "last_seen_at": _iso(now)}
    store.upsert("game_bases", [base], on_conflict="user_id", ignore=True)
    if not store.select("game_buildings", {"user_id": f"eq.{uid}", "select": "id", "limit": "1"}):
        store.insert_rows("game_buildings", [{"id": str(uuid.uuid4()), "user_id": uid, "type": t, "level": lv, "x": x, "y": y,
                                               "collected_at": _iso(now)} for t, x, y, lv in START], returning=False)
    return base, True


def _buildings(uid):
    return store.select("game_buildings", {"user_id": f"eq.{uid}", "select": "*", "order": "created_at.asc"})


def _ship(uid):
    rows = store.select("game_ships", {"user_id": f"eq.{uid}", "delivered_at": "is.null", "select": "*",
                                       "order": "created_at.desc", "limit": "1"})
    return rows[0] if rows else None


def _run_days(uid):
    return daily_done_days(uid)


def factory_pending(b, run_days, now):
    """공장에 쌓인 생산량 (매일 문제 다 푼 날만, 최대 FACTORY_BUFFER_H 시간)."""
    if b["type"] not in ("cutting", "welding") or b["level"] < 1:
        return 0
    start = _dt(b.get("collected_at")) or now
    if start >= now:
        return 0
    secs = 0.0
    t = start
    while t < now:
        kday = t.astimezone(KST).date()
        nxt = datetime.combine(kday + timedelta(days=1), datetime.min.time(), KST).astimezone(timezone.utc)
        end = min(nxt, now)
        if kday.isoformat() in run_days:
            secs += (end - t).total_seconds()
        t = end
    secs = min(secs, FACTORY_BUFFER_H * 3600)
    rate = PROD_TABLE[b["level"]] * (0.5 if b["type"] == "welding" else 1)
    return int(rate * secs / 3600)


def _rect(b):
    w, h = BUILDINGS[b["type"]]["size"]
    return b["x"], b["y"], w, h


def _free(buildings, btype, x, y, skip_id=None):
    w, h = BUILDINGS[btype]["size"]
    if x < 0 or y < 0 or x + w > GRID or y + h > GRID:
        return False
    for o in buildings:
        if o["id"] == skip_id:
            continue
        ox, oy, ow, oh = _rect(o)
        if x < ox + ow and ox < x + w and y < oy + oh and oy < y + h:
            return False
    return True


def free_spot(buildings, btype):
    """처음 따라 하기 등에서 쓸 빈 자리 하나 (가운데에 가까운 곳)."""
    best = None
    for y in range(GRID):
        for x in range(GRID):
            if _free(buildings, btype, x, y):
                d = (x - 6) ** 2 + (y - 6) ** 2
                if best is None or d < best[0]:
                    best = (d, x, y)
    return (best[1], best[2]) if best else None


# ---- 상태 모으기 ----

def load(user, sync=True):
    uid = user["id"]
    st = settings()
    with _lock(uid):
        base, new = _base(uid)
        now = _now()
        buildings = _buildings(uid)
        _finish_due(uid, buildings, None, now)
        rows = ledger(uid)
        book, units = None, []
        new_rows = []
        if sync:
            have = {r["key"] for r in rows}
            new_rows, book, units = study_rewards(uid, st, have)
            if new_rows:
                _add(uid, [dict(r) for r in new_rows])
                rows = ledger(uid)
        else:
            book, units = unit_progress(uid, st)
    return {"uid": uid, "st": st, "base": base, "new": new, "now": now, "buildings": buildings, "rows": rows,
            "book": book, "units": units, "new_rows": new_rows, "ship": _ship(uid), "run_days": _run_days(uid)}


def _hq(buildings):
    return next((b for b in buildings if b["type"] == "hq"), None)


def _dock(buildings):
    return next((b for b in buildings if b["type"] == "dock"), None)


def units_done(units):
    return sum(1 for u in units if u["done"])


def hq_need(target, units):
    """본관 target 레벨에 필요한 장 완료 수 (교재 장 수를 넘지 않게)."""
    need = HQ_UNITS[min(target, len(HQ_UNITS) - 1)]
    return min(need, len(units)) if units else need


def upgrade_block(b, buildings, units):
    """올릴 수 없는 이유 코드 (없으면 None)."""
    spec = BUILDINGS[b["type"]]
    if b.get("busy_until"):
        return "busy"
    nxt = b["level"] + 1
    if nxt > spec["max"]:
        return "max"
    hq = _hq(buildings)
    if b["type"] == "hq":
        need = hq_need(nxt, units)
        if units_done(units) < need:
            return "units"
    elif hq and nxt > hq["level"]:
        return "hq_level"
    return None


def view(s, lang="ko"):
    st, now, buildings = s["st"], s["now"], s["buildings"]
    bal = balance(s["rows"])
    cap = caps(buildings)
    hq = _hq(buildings)
    hq_lv = hq["level"] if hq else 1
    busy = [b for b in buildings if b.get("busy_until")]
    run_today = daily.today(now).isoformat() in s["run_days"]
    units = s["units"]
    done_n = units_done(units)
    out_b = []
    pending = {"steel": 0, "rods": 0}
    last_seen = _dt(s["base"].get("last_seen_at"))
    for b in buildings:
        p = factory_pending(b, s["run_days"], now)
        if b["type"] == "cutting":
            pending["steel"] += p
        elif b["type"] == "welding":
            pending["rods"] += p
        nxt = b["level"] + 1
        spec = BUILDINGS[b["type"]]
        item = {"id": b["id"], "type": b["type"], "level": b["level"], "x": b["x"], "y": b["y"],
                "w": spec["size"][0], "h": spec["size"][1], "fixed": bool(spec.get("fixed")),
                "busy_until": b.get("busy_until"), "pending": p,
                "just_done": bool(b.get("finished_at") and last_seen and _dt(b["finished_at"]) > last_seen),
                "block": upgrade_block(b, buildings, units)}
        if nxt <= spec["max"]:
            item["next"] = {"level": nxt, "cost": cost(b["type"], nxt), "seconds": build_seconds(nxt)}
            if b["type"] == "hq":
                item["next"]["units_need"] = hq_need(nxt, units)
        if b.get("busy_until"):
            left = max(0, int((_dt(b["busy_until"]) - now).total_seconds()))
            item["left"] = left
            item["speed"] = {"tech": math.ceil(left / TECH_SECONDS), "passes": 1}
        if b["type"] in ("cutting", "welding"):
            item["rate"] = int(PROD_TABLE[max(b["level"], 1)] * (0.5 if b["type"] == "welding" else 1))
        if b["type"] == "yard":
            item["cap"] = CAP_TABLE[max(b["level"], 1)]
        if b["type"] == "rodstore":
            item["cap"] = int(CAP_TABLE[max(b["level"], 1)] * 0.6)
        out_b.append(item)
    catalog = []
    for t, spec in BUILDINGS.items():
        if t in ("hq", "dock"):
            continue
        have = sum(1 for b in buildings if b["type"] == t)
        if have:
            continue
        catalog.append({"type": t, "cost": cost(t, 1), "seconds": build_seconds(1), "unlock": spec["unlock"],
                        "locked": hq_lv < spec["unlock"], "w": spec["size"][0], "h": spec["size"][1]})
    ship = s["ship"]
    dock = _dock(buildings)
    delivered = store.select("game_ships", {"user_id": f"eq.{s['uid']}", "delivered_at": "not.is.null",
                                            "select": "kind", "limit": "500"})
    delivered_kinds = {d["kind"] for d in delivered}
    ships = []
    for k, sp in SHIPS.items():
        lock = None
        if not dock or dock["level"] < sp["dock"]:
            lock = "dock"
        elif done_n < min(sp["units"], len(units) if units else sp["units"]):
            lock = "units"
        ships.append({"kind": k, "cost": {"steel": sp["steel"], "rods": sp["rods"]}, "fame": sp["fame"], "pay": sp["pay"],
                      "first_bonus": FIRST_SHIP_PASSES if k not in delivered_kinds else 0,
                      "dock": sp["dock"], "units": sp["units"], "lock": lock,
                      "seconds": sum(ship_stage_seconds(k, i) for i in range(len(STAGES)))})
    ship_out = None
    if ship:
        until = _dt(ship.get("stage_until"))
        left = max(0, int((until - now).total_seconds())) if until else 0
        ship_out = {"id": ship["id"], "kind": ship["kind"], "stage": ship["stage"], "left": left, "ready": left == 0,
                    "stage_seconds": ship_stage_seconds(ship["kind"], ship["stage"]),
                    "speed": {"tech": math.ceil(left / TECH_SECONDS), "passes": 1}}
    rewards = summarize(s["new_rows"])
    tut = tutorial(s, buildings, ship, delivered)
    data = {
        "enabled": st["enabled"], "now": _iso(now), "resources": bal, "caps": cap, "pending": pending,
        "builders": {"total": BUILDERS, "busy": len(busy)}, "run_today": run_today,
        "hq_level": hq_lv, "grid": GRID, "buildings": out_b, "catalog": catalog,
        "ships": ships, "ship": ship_out, "delivered": [d["kind"] for d in delivered],
        "units": {"done": done_n, "total": len(units),
                  "next": next(({"key": u["key"], "title": u["title"], "pdf_page": u["pdf_page"], "seen": u["seen"],
                                 "pages": u["pages"], "correct": u["correct"]} for u in units if not u["done"]), None),
                  "rule": {"pages_pct": st["unit_pages_pct"], "correct": st["unit_correct"]}},
        "book_id": s["book"]["id"] if s["book"] else None,
        "rewards": rewards, "tutorial": tut,
        "speed_rule": {"tech_minutes": TECH_SECONDS // 60, "pass_hours": PASS_SECONDS // 3600},
        "earn": {k: st[k] for k in ("daily_done_steel", "daily_ok_rods", "daily_ok_rods_short", "redo_tech", "live_ok_rods",
                                     "tutor_ok_tech", "unit_done_tech", "practice_steel", "pass_day_max", "pass_high_score",
                                     "pass_jump")},
    }
    data["tips"] = tips(data, s)
    return data


def summarize(rows):
    """새로 받은 공부 보상 묶음 (화면 위 '공부해서 받은 자원')."""
    if not rows:
        return None
    tot = {"steel": 0, "rods": 0, "tech": 0, "passes": 0}
    why = {}
    for r in rows:
        for k in tot:
            tot[k] += int(r.get(k) or 0)
        n = r.get("note") or ""
        why[n] = why.get(n, 0) + 1
    return {**tot, "why": why}


def tutorial(s, buildings, ship, delivered):
    """처음 따라 하기 5단계 (게임 상태로 판단, 저장하는 건 '끝/끄기' 하나)."""
    keys = {r["key"].split(":")[0] for r in s["rows"]}
    hq = _hq(buildings)
    steps = [
        ("daily", "daily_done" in keys),
        ("yard", any(b["type"] == "yard" for b in buildings)),
        ("collect", "collect" in keys),
        ("ship", bool(ship) or bool(delivered)),
        ("hq", bool(hq and hq["level"] >= 2) or bool(hq and hq.get("busy_until"))),
    ]
    cur = next((i for i, (_, ok) in enumerate(steps) if not ok), None)
    done = bool(s["base"].get("tutorial_done")) or cur is None
    spot = None
    if not done and steps[cur][0] == "yard":
        spot = free_spot(buildings, "yard")
    return {"done": done, "step": cur, "steps": [{"id": k, "ok": ok} for k, ok in steps],
            "spot": {"x": spot[0], "y": spot[1]} if spot else None}


def tips(d, s):
    """웰디의 '오늘의 할 일' (우선순위 순, 앞의 것부터 말함). 글은 앱 언어 파일에서."""
    out = []
    if not d["run_today"]:
        out.append({"id": "daily", "steel": d["earn"]["daily_done_steel"]})
    done = [b for b in d["buildings"] if b["just_done"]]
    if done:
        out.append({"id": "built", "type": done[0]["type"], "level": done[0]["level"]})
    if d["ship"] and d["ship"]["ready"]:
        out.append({"id": "ship_ready", "kind": d["ship"]["kind"], "stage": d["ship"]["stage"]})
    if d["pending"]["steel"] + d["pending"]["rods"] >= 30:
        out.append({"id": "collect", "steel": d["pending"]["steel"], "rods": d["pending"]["rods"]})
    hq = next((b for b in d["buildings"] if b["type"] == "hq"), None)
    if hq and hq["block"] == "units" and d["units"]["next"]:
        u = d["units"]["next"]
        out.append({"id": "units", "title": u["title"], "pdf_page": u["pdf_page"], "need": hq["next"]["units_need"],
                    "done": d["units"]["done"], "seen": u["seen"], "pages": u["pages"], "correct": u["correct"]})
    if d["builders"]["busy"] < d["builders"]["total"]:
        bal = d["resources"]
        cands = [b for b in d["buildings"] if not b["block"] and b.get("next") and _afford(bal, b["next"]["cost"])]
        cands += [c for c in d["catalog"] if not c["locked"] and _afford(bal, c["cost"])]
        if cands:
            c = min(cands, key=lambda c: (c.get("next") or c)["cost"]["steel"])
            out.append({"id": "idle", "type": c["type"]})
    if not d["ship"]:
        free = [x for x in d["ships"] if not x["lock"]]
        if free:
            out.append({"id": "ship_idle", "kind": free[-1]["kind"]})
    if d["resources"]["passes"] > 0 and any(b.get("busy_until") for b in d["buildings"]):
        out.append({"id": "pass", "n": d["resources"]["passes"]})
    if not out:
        out.append({"id": "study"})
    return out


def _seen(uid, now):
    store.patch("game_bases", {"user_id": f"eq.{uid}"}, {"last_seen_at": _iso(now)})


# ---- 같은 반 친구 진수 알림 ----

def _announce(user, kind, ship_id):
    try:
        courses = manage.course_ids_of(user["id"])
    except Exception as e:  # noqa: BLE001
        print("[game] 반 못 읽음", str(e)[:120], flush=True)
        return
    if not courses:
        return
    now = _now()
    with _launch_lock:
        _launches.append({"id": ship_id, "user_id": user["id"], "name": user.get("name") or "", "kind": kind,
                          "courses": set(courses), "at": now})
        _launches[:] = [e for e in _launches if (now - e["at"]).total_seconds() <= LAUNCH_KEEP][-50:]


def has_recent_launch():
    now = _now()
    with _launch_lock:
        return any((now - e["at"]).total_seconds() <= LAUNCH_KEEP for e in _launches)


def recent_launches(me):
    """me = {"id", "courses"}: 같은 반 친구(나 빼고)의 최근 진수 (최대 3개, 오래된 것부터)."""
    if not settings()["enabled"]:
        return []
    now = _now()
    mine = set(me.get("courses") or ())
    with _launch_lock:
        out = [{"id": e["id"], "name": e["name"], "kind": e["kind"], "at": _iso(e["at"])} for e in _launches
               if (now - e["at"]).total_seconds() <= LAUNCH_KEEP and e["user_id"] != me["id"] and e["courses"] & mine]
    return out[-3:]


# ---- API ----

@router.get("/game/state")
def game_state(lang: str = "ko", user=Depends(need_player)):
    try:
        s = load(user)
    except RuntimeError as e:
        m = str(e)
        print("[game] state 실패", m[:300], flush=True)
        if "game_" in m and ("PGRST205" in m or "42P01" in m or "42501" in m or "does not exist" in m or "schema cache" in m):
            _err(503, "need_sql")  # step15-game.sql 을 아직 안 돌림 (또는 권한 줄 빠짐)
        raise
    out = view(s, lang)
    _seen(s["uid"], s["now"])
    return out


def _fresh(user):
    return view(load(user, sync=False))


class BuildBody(BaseModel):
    type: str
    x: int
    y: int


@router.post("/game/build")
def build(body: BuildBody, user=Depends(need_player)):
    uid = user["id"]
    spec = BUILDINGS.get(body.type)
    if not spec or body.type in ("hq", "dock"):
        _err(400, "bad_type")
    with _lock(uid):
        now = _now()
        buildings = _buildings(uid)
        _finish_due(uid, buildings, None, now)
        if any(b["type"] == body.type for b in buildings):
            _err(400, "already")
        hq = _hq(buildings)
        if (hq["level"] if hq else 1) < spec["unlock"]:
            _err(400, "hq_level")
        if sum(1 for b in buildings if b.get("busy_until")) >= BUILDERS:
            _err(400, "builders")
        if not _free(buildings, body.type, body.x, body.y):
            _err(400, "spot")
        price = cost(body.type, 1)
        if not _afford(balance(ledger(uid)), price):
            _err(400, "money")
        bid = str(uuid.uuid4())
        _spend(uid, f"build:{bid}", price, body.type)
        store.insert_rows("game_buildings", [{"id": bid, "user_id": uid, "type": body.type, "level": 0, "x": body.x, "y": body.y,
                                               "busy_until": _iso(now + timedelta(seconds=build_seconds(1))),
                                               "collected_at": _iso(now + timedelta(seconds=build_seconds(1)))}], returning=False)
    return _fresh(user)


class IdBody(BaseModel):
    id: str


def _get_building(uid, bid):
    try:
        uuid.UUID(bid)
    except ValueError:
        _err(404, "not_found")
    rows = store.select("game_buildings", {"id": f"eq.{bid}", "user_id": f"eq.{uid}", "select": "*"})
    if not rows:
        _err(404, "not_found")
    return rows[0]


@router.post("/game/upgrade")
def upgrade(body: IdBody, user=Depends(need_player)):
    uid = user["id"]
    st = settings()
    with _lock(uid):
        now = _now()
        buildings = _buildings(uid)
        _finish_due(uid, buildings, None, now)
        b = next((x for x in buildings if x["id"] == body.id), None)
        if not b:
            _err(404, "not_found")
        _, units = unit_progress(uid, st) if b["type"] == "hq" else (None, [])
        why = upgrade_block(b, buildings, units)
        if why:
            _err(400, why)
        if sum(1 for x in buildings if x.get("busy_until")) >= BUILDERS:
            _err(400, "builders")
        nxt = b["level"] + 1
        price = cost(b["type"], nxt)
        if not _afford(balance(ledger(uid)), price):
            _err(400, "money")
        _spend(uid, f"up:{b['id']}:{nxt}", price, b["type"])
        fields = {"busy_until": _iso(now + timedelta(seconds=build_seconds(nxt)))}
        if b["type"] in ("cutting", "welding"):  # 올리기 전에 쌓인 것은 먼저 받기
            _collect_one(uid, b, buildings, now)
        store.patch("game_buildings", {"id": f"eq.{b['id']}"}, fields)
    return _fresh(user)


class MoveBody(BaseModel):
    id: str
    x: int
    y: int


@router.post("/game/move")
def move(body: MoveBody, user=Depends(need_player)):
    uid = user["id"]
    with _lock(uid):
        buildings = _buildings(uid)
        b = next((x for x in buildings if x["id"] == body.id), None)
        if not b:
            _err(404, "not_found")
        if BUILDINGS[b["type"]].get("fixed"):
            _err(400, "fixed")
        if not _free(buildings, b["type"], body.x, body.y, skip_id=b["id"]):
            _err(400, "spot")
        store.patch("game_buildings", {"id": f"eq.{b['id']}"}, {"x": body.x, "y": body.y})
    return _fresh(user)


def _collect_one(uid, b, buildings, now, run_days=None, bal=None, cap=None):
    run_days = run_days if run_days is not None else _run_days(uid)
    amt = factory_pending(b, run_days, now)
    kind = "steel" if b["type"] == "cutting" else "rods"
    if amt > 0:
        bal = bal if bal is not None else balance(ledger(uid))
        cap = cap if cap is not None else caps(buildings)
        room = max(0, cap[kind] - bal[kind])
        amt = min(amt, room)
    if amt > 0:
        _add(uid, [{"key": f"collect:{b['id']}:{_iso(now)}", kind: amt, "note": "collect"}])
        if bal is not None:
            bal[kind] += amt
    store.patch("game_buildings", {"id": f"eq.{b['id']}"}, {"collected_at": _iso(now)})
    return kind, amt


@router.post("/game/collect")
def collect(user=Depends(need_player)):
    """공장 생산분 모두 받기. 창고가 가득 차면 넘치는 만큼은 사라진다 (창고를 올리세요)."""
    uid = user["id"]
    got = {"steel": 0, "rods": 0}
    with _lock(uid):
        now = _now()
        buildings = _buildings(uid)
        _finish_due(uid, buildings, None, now)
        run_days = _run_days(uid)
        bal = balance(ledger(uid))
        cap = caps(buildings)
        for b in buildings:
            if b["type"] in ("cutting", "welding") and b["level"] >= 1 and not b.get("busy_until"):
                kind, amt = _collect_one(uid, b, buildings, now, run_days, bal, cap)
                got[kind] += amt
        gift = False
        if got["steel"] + got["rods"] == 0:
            # 처음 따라 하기 중 첫 '생산분 받기'인데 받을 게 없으면 (막 지은 공장·공부 안 한 날) 첫 생산분을 선물로 준다.
            # 안내가 여기서 끊기지 않게 하려는 것. 한 사람당 한 번.
            base, _ = _base(uid)
            keys = {r["key"].split(":")[0] for r in ledger(uid)}
            if not base.get("tutorial_done") and "collect" not in keys:
                _add(uid, [{"key": "collect:tutorial", **TUTORIAL_COLLECT, "note": "collect_first"}])
                got = dict(TUTORIAL_COLLECT)
                gift = True
    out = _fresh(user)
    out["collected"] = got
    out["collect_gift"] = gift
    return out


class SpeedBody(BaseModel):
    target: str          # 건물 id 또는 "ship"
    using: str           # tech | pass


@router.post("/game/speedup")
def speedup(body: SpeedBody, user=Depends(need_player)):
    uid = user["id"]
    if body.using not in ("tech", "pass"):
        _err(400, "bad_using")
    with _lock(uid):
        now = _now()
        if body.target == "ship":
            ship = _ship(uid)
            if not ship:
                _err(404, "not_found")
            until = _dt(ship.get("stage_until"))
            table, row_id, col = "game_ships", ship["id"], "stage_until"
        else:
            b = _get_building(uid, body.target)
            until = _dt(b.get("busy_until"))
            table, row_id, col = "game_buildings", b["id"], "busy_until"
        left = int((until - now).total_seconds()) if until else 0
        if left <= 0:
            _err(400, "not_busy")
        bal = balance(ledger(uid))
        if body.using == "tech":
            need = math.ceil(left / TECH_SECONDS)
            if bal["tech"] < need:
                _err(400, "money")
            price, cut = {"tech": need}, left
        else:
            if bal["passes"] < 1:
                _err(400, "money")
            price, cut = {"passes": 1}, min(left, PASS_SECONDS)
        _spend(uid, f"speed:{row_id}:{_iso(now)}", price, body.using)
        store.patch(table, {"id": f"eq.{row_id}"}, {col: _iso(until - timedelta(seconds=cut))})
    return view(load(user, sync=False))


class ShipBody(BaseModel):
    kind: str


@router.post("/game/ship/start")
def ship_start(body: ShipBody, user=Depends(need_player)):
    uid = user["id"]
    sp = SHIPS.get(body.kind)
    if not sp:
        _err(400, "bad_kind")
    st = settings()
    with _lock(uid):
        if _ship(uid):
            _err(400, "busy")
        buildings = _buildings(uid)
        dock = _dock(buildings)
        if not dock or dock["level"] < sp["dock"]:
            _err(400, "dock")
        _, units = unit_progress(uid, st)
        if units_done(units) < min(sp["units"], len(units) if units else sp["units"]):
            _err(400, "units")
        price = {"steel": sp["steel"], "rods": sp["rods"]}
        if not _afford(balance(ledger(uid)), price):
            _err(400, "money")
        sid = str(uuid.uuid4())
        _spend(uid, f"ship:{sid}", price, body.kind)
        now = _now()
        store.insert_rows("game_ships", [{"id": sid, "user_id": uid, "kind": body.kind, "stage": 0,
                                          "stage_until": _iso(now + timedelta(seconds=ship_stage_seconds(body.kind, 0)))}],
                          returning=False)
    return _fresh(user)


@router.post("/game/ship/next")
def ship_next(user=Depends(need_player)):
    """지금 공정이 끝났으면 다음 공정 시작. 마지막(인도)이 끝났으면 인도 → 명성."""
    uid = user["id"]
    with _lock(uid):
        ship = _ship(uid)
        if not ship:
            _err(404, "not_found")
        now = _now()
        until = _dt(ship.get("stage_until"))
        if until and until > now:
            _err(400, "not_ready")
        stage = ship["stage"] + 1
        if stage >= len(STAGES):
            store.patch("game_ships", {"id": f"eq.{ship['id']}"}, {"delivered_at": _iso(now), "stage_until": None})
            sp = SHIPS[ship["kind"]]
            keys = {r["key"] for r in ledger(uid)}
            first = f"first_ship:{ship['kind']}" not in keys
            got = {"fame": sp["fame"], **sp["pay"]}
            rows = [{"key": f"deliver:{ship['id']}", **got, "note": ship["kind"]}]
            if first and FIRST_SHIP_PASSES:
                rows.append({"key": f"first_ship:{ship['kind']}", "passes": FIRST_SHIP_PASSES, "note": "first_ship"})
                got["passes"] = FIRST_SHIP_PASSES
            _add(uid, rows)
            delivered = True
        else:
            store.patch("game_ships", {"id": f"eq.{ship['id']}"},
                        {"stage": stage, "stage_until": _iso(now + timedelta(seconds=ship_stage_seconds(ship["kind"], stage)))})
            delivered = False
    if delivered:
        _announce(user, ship["kind"], ship["id"])
    out = _fresh(user)
    if delivered:
        out["delivered_now"] = {"kind": ship["kind"], "fame": got["fame"], "first": first, "got": got,
                                "count": len(out["delivered"])}
    return out


class TutorialBody(BaseModel):
    done: bool


@router.post("/game/tutorial")
def set_tutorial(body: TutorialBody, user=Depends(need_player)):
    with _lock(user["id"]):
        _base(user["id"])
        store.patch("game_bases", {"user_id": f"eq.{user['id']}"}, {"tutorial_done": body.done})
    return _fresh(user)


# ---- 관리자 ----

@router.get("/admin/game-settings")
def get_game_settings(user=Depends(need_admin)):
    return {"settings": settings(), "defaults": DEFAULTS}


@router.put("/admin/game-settings")
def put_game_settings(body: dict, user=Depends(need_admin)):
    cur = settings()
    for k, v in (body or {}).items():
        if k not in DEFAULTS:
            continue
        if isinstance(DEFAULTS[k], bool):
            if not isinstance(v, bool):
                _err(400, "bad_value", key=k)
        else:
            if isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0 or v > 100000:
                _err(400, "bad_value", key=k)
            v = int(v)
        cur[k] = v
    if not 1 <= cur["unit_pages_pct"] <= 100:
        _err(400, "bad_value", key="unit_pages_pct")
    _save_setting("game", cur)
    return {"settings": cur, "defaults": DEFAULTS}
