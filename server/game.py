"""G1(게임): 웰디의 조선소 — 내 조선소 키우기 (혼자 하기).

원칙 (박사 승인 2026-11-27, 계획안 https://claude.ai/artifact/FuBHW7hFvEm1V7r5f2GtKL):
- 자원은 공부로만 생긴다. 서버가 학습 기록(매일 문제·웰디 문제·돌발 OX·교재 진도·실습 점수)을 읽어
  아직 안 준 것만 '자원 장부'(game_ledger)에 한 줄씩 적는다. 줄마다 열쇠(key)가 있어 같은 공부로 두 번 받지 않는다.
  잔액 = 장부 합계 (쓴 것도 음수 줄로 적는다). 현금 결제 없음.
- 공장은 그날 매일 문제를 다 푼 날(한국 날짜)에만 돌아간다.
- 본관 레벨을 올리려면 '본관 승급 시험'을 통과해야 한다 (박사 변경 2026-11-27: 교재 장 완료 조건은 뺌).
  문제 수·종류(OX·객관식·단답형·서술형)·합격 개수는 관리자 '게임 설정'에서 정한다. 문제는 지금 교재의 문제 은행에서 뽑는다.
- 즉시 완료권은 실습 점수로만 (90점 이상·실력 급상승·개인 최고점·새 자세 첫 합격, 하루 2장).
- 공사·배 건조는 '끝나는 시각'만 저장하고, 화면을 열 때 계산한다 (무료 서버가 자고 있어도 됨).
- 교육생만 (관리자는 시험용으로 들어갈 수 있음). 학습 보드 점수와는 따로.
- 모든 숫자는 예시이며 관리자 '게임 설정'에서 바꾼다 (보상·장 완료 기준·게임 켜기).
G2a(박사 승인 2026-11-28, 계획안 https://claude.ai/artifact/Uz22bbfiiBVUkzEffRMnV3):
- 배는 두 갈래. 상선은 지금처럼 인도(판매)해서 대금·명성, 전투함은 진수 뒤 '군항 부두'에 정박해 함대가 된다.
- 군항 부두(새 건물, 해안에만): 함대에 둘 수 있는 전투함 수 = 부두 레벨 + 1 (1레벨 2척 → 5레벨 6척).
- 간척: 땅 14×14 → 16 → 18 (G2a는 2단계까지, 최대 22×22). 작업 반장 1명이 맡고, 끝나면 도크·부두는 새 해안선으로 옮겨진다.
G2b(방어·해적 연습 전투)·G2c(공격)·G3(대항전)는 다음 단계.
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
    # 군항 부두: 해안(땅 오른쪽 끝)에만 놓음. 전투함이 옆 바다에 정박
    "pier":     {"size": (2, 3), "steel": 400, "rods": 150, "unlock": 1, "max": 5, "coast": True},
}
COAST_TYPES = ("dock", "pier")   # 해안에 붙는 건물 (간척하면 새 해안선으로 옮김)
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
# 전투함 (G2a): 도크 레벨·본관 레벨·비용·공정 시간 배수·체력·공격력·무기 칸. 숫자는 예시.
# soon = 다음 단계에서 열림 (G2a는 고속정·호위함만)
WARSHIPS = {
    "patrol":    {"dock": 1, "hq": 1, "steel": 300, "rods": 150, "mult": 2, "hp": 100, "power": 20, "slots": 1},
    "frigate":   {"dock": 2, "hq": 2, "steel": 900, "rods": 500, "mult": 6, "hp": 260, "power": 45, "slots": 2},
    "destroyer": {"dock": 3, "hq": 3, "steel": 2200, "rods": 1200, "mult": 15, "hp": 480, "power": 90, "slots": 3, "soon": True},
    "submarine": {"dock": 3, "hq": 4, "steel": 2600, "rods": 1500, "mult": 18, "hp": 300, "power": 110, "slots": 2, "soon": True},
    "landing":   {"dock": 4, "hq": 5, "steel": 3500, "rods": 2000, "mult": 22, "hp": 600, "power": 70, "slots": 2, "soon": True},
}
# 간척 단계: (땅 크기, 바다 줄 수, 본관 레벨, 강판, 용접봉, 공사 초). 숫자는 예시.
RECLAIM = [
    (14, 2, 0, 0, 0, 0),
    (16, 3, 2, 1500, 0, 3600),
    (18, 3, 3, 4000, 1500, 3 * 3600),
    (20, 4, 4, 9000, 4000, 6 * 3600),
    (22, 4, 5, 18000, 8000, 12 * 3600),
]
RECLAIM_OPEN = 2             # G2a: 간척 2단계(18×18)까지
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
    # 본관 승급 시험 (문제 은행에서 종류별로 뽑음, 이만큼 맞히면 통과). 예시 값.
    "hq_exam_ox": 10,
    "hq_exam_mc": 0,
    "hq_exam_word": 0,                # 단답형
    "hq_exam_short": 0,               # 서술형
    "hq_exam_pass": 8,
    # 자재 조달: 게임 안에서 문제를 풀어 강판·용접봉 벌기 (맞힌 문제마다)
    "supply_ox": 3,
    "supply_mc": 2,
    "supply_word": 0,                 # 단답형
    "supply_steel": 40,               # 1문제 맞힘 → 강판
    "supply_rods": 20,                # 1문제 맞힘 → 용접봉
    "supply_day_max": 0,              # 하루 최대 횟수 (0 = 무제한)
}
EXAM_KINDS = ("ox", "mc", "word", "short")
EXAM_MAX_EACH = 20
_exams: dict[str, dict] = {}         # 보는 중인 승급 시험 (메모리, 사람마다 하나)
SUPPLY_KINDS = ("ox", "mc", "word")  # 서술형은 AI 채점이라 자재 조달에는 절대 안 냄
SUPPLY_FALLBACK = ("ox", "mc", "word")  # 종류 순서. 새 문제가 바닥나면 객관식으로 채움 (단답형은 관리자가 켰을 때만)
_supplies: dict[str, dict] = {}      # 푸는 중인 자재 조달 (메모리, 사람마다 하나)
_supply_open: dict[str, dict] = {}   # 사람별 '열었지만 아직 안 낸' 문제 {문제 id: 낸 시각} (서버 메모리)
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


def ship_spec(kind):
    return SHIPS.get(kind) or WARSHIPS[kind]


def ship_stage_seconds(kind, stage):
    return STAGE_SECONDS[stage] * ship_spec(kind)["mult"]


def is_war(kind):
    return kind in WARSHIPS


# ---- 간척·땅 크기·함대 ----

def reclaim_stage(base):
    return int((base or {}).get("reclaim") or 0)


def grid_of(base):
    return RECLAIM[min(reclaim_stage(base), len(RECLAIM) - 1)][0]


def sea_of(base):
    return RECLAIM[min(reclaim_stage(base), len(RECLAIM) - 1)][1]


def reclaim_busy(base):
    return bool((base or {}).get("reclaim_until"))


def busy_count(buildings, base):
    """일하는 작업 반장 수 = 공사 중 건물 + 간척 중이면 1."""
    return sum(1 for b in buildings if b.get("busy_until")) + (1 if reclaim_busy(base) else 0)


def _pier(buildings):
    return next((b for b in buildings if b["type"] == "pier"), None)


def fleet_cap(buildings):
    p = _pier(buildings)
    return p["level"] + 1 if p and p["level"] >= 1 else 0


def _fleet(uid):
    """군항 부두에 있는 전투함 (진수 끝난 것), 오래된 것부터."""
    rows = store.select("game_ships", {"user_id": f"eq.{uid}", "delivered_at": "not.is.null", "select": "id,kind,delivered_at,created_at",
                                       "order": "created_at.asc", "limit": "500"})
    return [r for r in rows if is_war(r["kind"])]


def _finish_reclaim(uid, base, buildings, now):
    """간척 공사가 끝났으면 단계 +1, 해안 건물(도크·부두)을 새 해안선으로 옮긴다."""
    end = _dt((base or {}).get("reclaim_until"))
    if not end or end > now:
        return
    old = grid_of(base)
    stage = reclaim_stage(base) + 1
    new = RECLAIM[stage][0]
    store.patch("game_bases", {"user_id": f"eq.{uid}"}, {"reclaim": stage, "reclaim_until": None})
    base["reclaim"], base["reclaim_until"] = stage, None
    for b in buildings:
        w = BUILDINGS[b["type"]]["size"][0]
        if b["type"] in COAST_TYPES and b["x"] + w == old:
            b["x"] += new - old
            store.patch("game_buildings", {"id": f"eq.{b['id']}"}, {"x": b["x"]})


def _prep(uid, now):
    """조선소 불러오기 + 끝난 공사·간척 마무리 → (base, buildings)."""
    base, _ = _base(uid)
    buildings = _buildings(uid)
    _finish_due(uid, buildings, None, now)
    _finish_reclaim(uid, base, buildings, now)
    return base, buildings


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


def _ship(uid, now=None):
    """도크에서 만드는 배. 공정은 저절로 이어진다 (박사 요청 2026-11-28: 공정마다 누르지 않게).
    지금 공정이 끝났으면 다음 공정을 그 끝난 시각부터 시작한 것으로 하고, 마지막 공정까지 이어서 계산한다.
    마지막 공정이 끝나면 '인도하기'(상선) / '군항 부두로'(전투함) 한 번만 누르면 된다."""
    rows = store.select("game_ships", {"user_id": f"eq.{uid}", "delivered_at": "is.null", "select": "*",
                                       "order": "created_at.desc", "limit": "1"})
    if not rows:
        return None
    ship = rows[0]
    now = now or _now()
    until = _dt(ship.get("stage_until"))
    stage = ship["stage"]
    changed = False
    while until and until <= now and stage < len(STAGES) - 1:
        stage += 1
        until = until + timedelta(seconds=ship_stage_seconds(ship["kind"], stage))
        changed = True
    if changed:
        store.patch("game_ships", {"id": f"eq.{ship['id']}"}, {"stage": stage, "stage_until": _iso(until)})
        ship["stage"], ship["stage_until"] = stage, _iso(until)
    return ship


def ship_total_left(ship, now):
    """다 만들 때까지 남은 초 (지금 공정 남은 시간 + 남은 공정들)."""
    until = _dt(ship.get("stage_until"))
    left = max(0, int((until - now).total_seconds())) if until else 0
    return left + sum(ship_stage_seconds(ship["kind"], i) for i in range(ship["stage"] + 1, len(STAGES)))


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


def _free(buildings, btype, x, y, skip_id=None, grid=GRID):
    w, h = BUILDINGS[btype]["size"]
    if x < 0 or y < 0 or x + w > grid or y + h > grid:
        return False
    if BUILDINGS[btype].get("coast") and x + w != grid:
        return False  # 군항 부두는 해안(땅 오른쪽 끝)에만
    for o in buildings:
        if o["id"] == skip_id:
            continue
        ox, oy, ow, oh = _rect(o)
        if x < ox + ow and ox < x + w and y < oy + oh and oy < y + h:
            return False
    return True


def free_spot(buildings, btype, grid=GRID):
    """처음 따라 하기 등에서 쓸 빈 자리 하나 (가운데에 가까운 곳)."""
    best = None
    for y in range(grid):
        for x in range(grid):
            if _free(buildings, btype, x, y, grid=grid):
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
        _finish_reclaim(uid, base, buildings, now)
        rows = ledger(uid)
        book, units = None, []
        new_rows = []
        waiting = {"steel": 0, "rods": 0}
        if sync:
            have = {r["key"] for r in rows}
            found, book, units = study_rewards(uid, st, have)
            new_rows, waiting = fit_storage(found, balance(rows), caps(buildings))
            if new_rows:
                _add(uid, [dict(r) for r in new_rows])
                rows = ledger(uid)
        else:
            book, units = unit_progress(uid, st)
    return {"uid": uid, "st": st, "base": base, "new": new, "now": now, "buildings": buildings, "rows": rows,
            "book": book, "units": units, "new_rows": new_rows, "waiting": waiting, "ship": _ship(uid, now),
            "fleet": _fleet(uid), "run_days": _run_days(uid)}


def fit_storage(found, bal, cap):
    """창고에 들어갈 공부 보상만 고른다.
    강판·용접봉이 창고 자리보다 많은 보상 줄은 장부에 아직 안 쓰고 '창고 대기'로 남긴다
    (사라지지 않음: 자원을 쓰거나 창고를 올려 자리가 나면 다음에 들어온다).
    기술 포인트·완료권만 있는 줄은 창고와 상관없이 바로 들어온다."""
    room = {k: max(0, cap[k] - bal[k]) for k in ("steel", "rods")}
    ok, waiting = [], {"steel": 0, "rods": 0}
    for r in found:
        need = {k: int(r.get(k) or 0) for k in ("steel", "rods")}
        if all(need[k] <= room[k] for k in need):
            ok.append(r)
            for k in need:
                room[k] -= need[k]
        else:
            for k in need:
                waiting[k] += need[k]
    return ok, waiting


def clip_storage(got, bal, cap):
    """한 번에 받는 보상(진수 대금·첫 생산분 선물)을 창고 자리만큼 자른다. 넘치는 만큼은 못 받음."""
    out = dict(got)
    for k in ("steel", "rods"):
        if out.get(k):
            out[k] = max(0, min(int(out[k]), cap[k] - bal[k]))
    return out


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


def exam_passed(rows, target):
    """본관 target 레벨 승급 시험을 통과했나 (장부에 hq_exam:target 줄)."""
    key = f"hq_exam:{target}"
    return any(r["key"] == key for r in rows)


def exam_spec(st):
    counts = {k: int(st[f"hq_exam_{k}"]) for k in EXAM_KINDS}
    total = sum(counts.values())
    return {"counts": counts, "total": total, "pass": min(int(st["hq_exam_pass"]), total)}


def upgrade_block(b, buildings, rows):
    """올릴 수 없는 이유 코드 (없으면 None). rows = 자원 장부 (승급 시험 통과 확인용)."""
    spec = BUILDINGS[b["type"]]
    if b.get("busy_until"):
        return "busy"
    nxt = b["level"] + 1
    if nxt > spec["max"]:
        return "max"
    hq = _hq(buildings)
    if b["type"] == "hq":
        if not exam_passed(rows, nxt):
            return "exam"
    elif hq and nxt > hq["level"]:
        return "hq_level"
    return None


def view(s, lang="ko"):
    st, now, buildings = s["st"], s["now"], s["buildings"]
    bal = balance(s["rows"])
    cap = caps(buildings)
    hq = _hq(buildings)
    hq_lv = hq["level"] if hq else 1
    base = s["base"]
    busy_n = busy_count(buildings, base)
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
                "coast": bool(spec.get("coast")), "busy_until": b.get("busy_until"), "pending": p,
                "just_done": bool(b.get("finished_at") and last_seen and _dt(b["finished_at"]) > last_seen),
                "block": upgrade_block(b, buildings, s["rows"])}
        if nxt <= spec["max"]:
            item["next"] = {"level": nxt, "cost": cost(b["type"], nxt), "seconds": build_seconds(nxt)}
            if b["type"] == "hq":
                item["next"]["exam"] = {**exam_spec(st), "passed": exam_passed(s["rows"], nxt)}
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
        if b["type"] == "pier":
            item["fleet_cap"] = max(b["level"], 1) + 1
        out_b.append(item)
    catalog = []
    for t, spec in BUILDINGS.items():
        if t in ("hq", "dock"):
            continue
        have = sum(1 for b in buildings if b["type"] == t)
        if have:
            continue
        catalog.append({"type": t, "cost": cost(t, 1), "seconds": build_seconds(1), "unlock": spec["unlock"],
                        "locked": hq_lv < spec["unlock"], "w": spec["size"][0], "h": spec["size"][1],
                        "coast": bool(spec.get("coast"))})
    ship = s["ship"]
    dock = _dock(buildings)
    delivered = [d for d in store.select("game_ships", {"user_id": f"eq.{s['uid']}", "delivered_at": "not.is.null",
                                                        "select": "kind", "limit": "500"}) if not is_war(d["kind"])]
    delivered_kinds = {d["kind"] for d in delivered}
    ships = []
    for k, sp in SHIPS.items():
        lock = None
        if not dock or dock["level"] < sp["dock"]:
            lock = "dock"
        ships.append({"kind": k, "cost": {"steel": sp["steel"], "rods": sp["rods"]}, "fame": sp["fame"], "pay": sp["pay"],
                      "first_bonus": FIRST_SHIP_PASSES if k not in delivered_kinds else 0,
                      "dock": sp["dock"], "units": sp["units"], "lock": lock,
                      "seconds": sum(ship_stage_seconds(k, i) for i in range(len(STAGES)))})
    ship_out = None
    if ship:
        until = _dt(ship.get("stage_until"))
        stage_left = max(0, int((until - now).total_seconds())) if until else 0
        left = ship_total_left(ship, now)
        # left = 다 만들 때까지 (공정은 저절로 이어짐), stage_left = 지금 공정이 끝날 때까지 (지도 그림을 바꿀 때)
        ship_out = {"id": ship["id"], "kind": ship["kind"], "war": is_war(ship["kind"]), "stage": ship["stage"],
                    "left": left, "stage_left": stage_left, "ready": left == 0,
                    "stage_seconds": ship_stage_seconds(ship["kind"], ship["stage"]),
                    "speed": {"tech": math.ceil(left / TECH_SECONDS), "passes": 1}}
    fleet = s.get("fleet") or []
    fcap = fleet_cap(buildings)
    building_war = 1 if ship and is_war(ship["kind"]) else 0
    warships = []
    for k, sp in WARSHIPS.items():
        warships.append({"kind": k, "cost": {"steel": sp["steel"], "rods": sp["rods"]}, "hp": sp["hp"], "power": sp["power"],
                         "slots": sp["slots"], "dock": sp["dock"], "hq": sp["hq"],
                         "lock": warship_block(k, buildings, hq_lv, len(fleet) + building_war, fcap),
                         "seconds": sum(ship_stage_seconds(k, i) for i in range(len(STAGES)))})
    count = {}
    fleet_out = []
    for f in fleet:
        count[f["kind"]] = count.get(f["kind"], 0) + 1
        sp = WARSHIPS[f["kind"]]
        fleet_out.append({"id": f["id"], "kind": f["kind"], "no": count[f["kind"]], "hp": sp["hp"], "power": sp["power"],
                          "slots": sp["slots"]})
    rewards = summarize(s["new_rows"])
    tut = tutorial(s, buildings, ship, delivered)
    data = {
        "enabled": st["enabled"], "now": _iso(now), "resources": bal, "caps": cap, "pending": pending,
        "waiting": s.get("waiting") or {"steel": 0, "rods": 0},
        "builders": {"total": BUILDERS, "busy": busy_n}, "run_today": run_today,
        "hq_level": hq_lv, "grid": grid_of(base), "sea": sea_of(base), "buildings": out_b, "catalog": catalog,
        "ships": ships, "ship": ship_out, "delivered": [d["kind"] for d in delivered],
        "warships": warships, "fleet": {"cap": fcap, "ships": fleet_out, "building": building_war},
        "reclaim": reclaim_view(base, hq_lv, busy_n, now),
        "units": {"done": done_n, "total": len(units),
                  "next": next(({"key": u["key"], "title": u["title"], "pdf_page": u["pdf_page"], "seen": u["seen"],
                                 "pages": u["pages"], "correct": u["correct"]} for u in units if not u["done"]), None),
                  "rule": {"pages_pct": st["unit_pages_pct"], "correct": st["unit_correct"]}},
        "book_id": s["book"]["id"] if s["book"] else None,
        "rewards": rewards, "tutorial": tut,
        "speed_rule": {"tech_minutes": TECH_SECONDS // 60, "pass_hours": PASS_SECONDS // 3600},
        "earn": {k: st[k] for k in ("daily_done_steel", "daily_ok_rods", "daily_ok_rods_short", "redo_tech", "live_ok_rods",
                                     "tutor_ok_tech", "unit_done_tech", "practice_steel", "pass_day_max", "pass_high_score",
                                     "pass_jump", "supply_steel", "supply_rods", "supply_day_max")},
        "supply": {**supply_spec(st), "done_today": supply_today(s["rows"], now)},
    }
    data["tips"] = tips(data, s)
    return data


def warship_block(kind, buildings, hq_lv, used, cap):
    """전투함을 만들 수 없는 이유 (없으면 None). used = 함대 + 지금 도크에서 만드는 전투함."""
    sp = WARSHIPS[kind]
    if sp.get("soon"):
        return "soon"
    dock = _dock(buildings)
    if hq_lv < sp["hq"]:
        return "hq"
    if not dock or dock["level"] < sp["dock"]:
        return "dock"
    if cap <= 0:
        return "pier"
    if used >= cap:
        return "fleet_full"
    return None


def reclaim_view(base, hq_lv, busy_n, now):
    stage = reclaim_stage(base)
    out = {"stage": stage, "max": len(RECLAIM) - 1, "open": RECLAIM_OPEN, "grid": grid_of(base), "sea": sea_of(base),
           "next": None, "block": None}
    end = _dt(base.get("reclaim_until"))
    if end:
        left = max(0, int((end - now).total_seconds()))
        out["left"] = left
        out["speed"] = {"tech": math.ceil(left / TECH_SECONDS), "passes": 1}
    if stage + 1 < len(RECLAIM):
        g, sea, hq, steel, rods, secs = RECLAIM[stage + 1]
        out["next"] = {"stage": stage + 1, "grid": g, "sea": sea, "hq": hq, "cost": {"steel": steel, "rods": rods},
                       "seconds": secs}
        out["block"] = reclaim_block(base, hq_lv, busy_n)
    return out


def reclaim_block(base, hq_lv, busy_n):
    stage = reclaim_stage(base)
    if reclaim_busy(base):
        return "busy"
    if stage + 1 >= len(RECLAIM):
        return "max"
    if stage + 1 > RECLAIM_OPEN:
        return "soon"
    if hq_lv < RECLAIM[stage + 1][2]:
        return "hq_level"
    if busy_n >= BUILDERS:
        return "builders"
    return None


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
        ("ship", bool(ship) or bool(delivered) or bool(s.get("fleet"))),
        ("hq", bool(hq and hq["level"] >= 2) or bool(hq and hq.get("busy_until"))),  # 승급 시험 → 올리기
    ]
    cur = next((i for i, (_, ok) in enumerate(steps) if not ok), None)
    done = bool(s["base"].get("tutorial_done")) or cur is None
    spot = None
    if not done and steps[cur][0] == "yard":
        spot = free_spot(buildings, "yard", grid_of(s["base"]))
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
    w = d.get("waiting") or {}
    if w.get("steel", 0) + w.get("rods", 0) > 0:
        out.append({"id": "full", "steel": w.get("steel", 0), "rods": w.get("rods", 0)})
    hq = next((b for b in d["buildings"] if b["type"] == "hq"), None)
    if hq and hq["block"] == "exam" and hq.get("next") and d["builders"]["busy"] < d["builders"]["total"] \
            and _afford(d["resources"], hq["next"]["cost"]):
        ex = hq["next"]["exam"]
        out.append({"id": "exam", "level": hq["next"]["level"], "total": ex["total"], "pass": ex["pass"]})
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
    fl = d["fleet"]
    if fl["cap"] == 0 and any(c["type"] == "pier" and not c["locked"] for c in d["catalog"]):
        out.append({"id": "pier", "n": 2})
    elif fl["cap"] > len(fl["ships"]) + fl["building"] and not d["ship"]:
        free = [x for x in d["warships"] if not x["lock"]]
        if free:
            out.append({"id": "warship", "kind": free[-1]["kind"], "n": len(fl["ships"]), "cap": fl["cap"]})
    rc = d["reclaim"]
    if rc["next"] and not rc["block"] and _afford(d["resources"], rc["next"]["cost"]):
        out.append({"id": "reclaim", "grid": rc["next"]["grid"]})
    if d["resources"]["passes"] > 0 and (any(b.get("busy_until") for b in d["buildings"]) or "left" in rc):
        out.append({"id": "pass", "n": d["resources"]["passes"]})
    if d["builders"]["busy"] < d["builders"]["total"] and not any(t["id"] in ("idle", "exam", "collect") for t in out):
        # 지을 것도 만들 배도 못 고를 만큼 자원이 모자람 → 자재 조달 문제로 벌기
        out.append({"id": "supply", "steel": d["earn"]["supply_steel"], "rods": d["earn"]["supply_rods"]})
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
        base, buildings = _prep(uid, now)
        if any(b["type"] == body.type for b in buildings):
            _err(400, "already")
        hq = _hq(buildings)
        if (hq["level"] if hq else 1) < spec["unlock"]:
            _err(400, "hq_level")
        if busy_count(buildings, base) >= BUILDERS:
            _err(400, "builders")
        if not _free(buildings, body.type, body.x, body.y, grid=grid_of(base)):
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
        base, buildings = _prep(uid, now)
        b = next((x for x in buildings if x["id"] == body.id), None)
        if not b:
            _err(404, "not_found")
        why = upgrade_block(b, buildings, ledger(uid))
        if why:
            _err(400, why)
        if busy_count(buildings, base) >= BUILDERS:
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
        base, buildings = _prep(uid, _now())
        b = next((x for x in buildings if x["id"] == body.id), None)
        if not b:
            _err(404, "not_found")
        if BUILDINGS[b["type"]].get("fixed"):
            _err(400, "fixed")
        if not _free(buildings, b["type"], body.x, body.y, skip_id=b["id"], grid=grid_of(base)):
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
                got = clip_storage(TUTORIAL_COLLECT, balance(ledger(uid)), cap)
                _add(uid, [{"key": "collect:tutorial", **got, "note": "collect_first"}])
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
        total = None
        if body.target == "ship":
            ship = _ship(uid, now)
            if not ship:
                _err(404, "not_found")
            until = _dt(ship.get("stage_until"))
            table, row_id, col = "game_ships", ship["id"], "stage_until"
            total = ship_total_left(ship, now)
        elif body.target == "reclaim":
            base, _ = _base(uid)
            until = _dt(base.get("reclaim_until"))
            table, row_id, col = "game_bases", uid, "reclaim_until"
        else:
            b = _get_building(uid, body.target)
            until = _dt(b.get("busy_until"))
            table, row_id, col = "game_buildings", b["id"], "busy_until"
        left = int((until - now).total_seconds()) if until else 0
        if total is not None:
            left = total  # 배는 남은 공정 전체를 당김 (공정은 저절로 이어지므로)
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
        store.patch(table, {"user_id" if table == "game_bases" else "id": f"eq.{row_id}"},
                    {col: _iso(until - timedelta(seconds=cut))})
    return view(load(user, sync=False))


class ShipBody(BaseModel):
    kind: str


@router.post("/game/ship/start")
def ship_start(body: ShipBody, user=Depends(need_player)):
    uid = user["id"]
    sp = SHIPS.get(body.kind) or WARSHIPS.get(body.kind)
    if not sp:
        _err(400, "bad_kind")
    with _lock(uid):
        if _ship(uid):
            _err(400, "busy")
        base, buildings = _prep(uid, _now())
        if is_war(body.kind):
            hq = _hq(buildings)
            why = warship_block(body.kind, buildings, hq["level"] if hq else 1, len(_fleet(uid)), fleet_cap(buildings))
            if why:
                _err(400, why)
        dock = _dock(buildings)
        if not dock or dock["level"] < sp["dock"]:
            _err(400, "dock")
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
    """모든 공정이 끝났으면 인도(상선 → 대금·명성) 또는 군항 부두로(전투함). 공정 사이는 저절로 이어지므로 누를 필요 없음."""
    uid = user["id"]
    with _lock(uid):
        now = _now()
        ship = _ship(uid, now)
        if not ship:
            _err(404, "not_found")
        until = _dt(ship.get("stage_until"))
        if (until and until > now) or ship["stage"] < len(STAGES) - 1:
            _err(400, "not_ready")
        stage = ship["stage"] + 1
        war = is_war(ship["kind"])
        if stage >= len(STAGES) and war:
            # 전투함: 대금 대신 군항 부두로 (함대에 들어감)
            store.patch("game_ships", {"id": f"eq.{ship['id']}"}, {"delivered_at": _iso(now), "stage_until": None})
            delivered = False
        elif stage >= len(STAGES):
            store.patch("game_ships", {"id": f"eq.{ship['id']}"}, {"delivered_at": _iso(now), "stage_until": None})
            sp = SHIPS[ship["kind"]]
            keys = {r["key"] for r in ledger(uid)}
            first = f"first_ship:{ship['kind']}" not in keys
            got = {"fame": sp["fame"], **clip_storage(sp["pay"], balance(ledger(uid)), caps(_buildings(uid)))}
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
    if war and stage >= len(STAGES):
        mine = [f for f in out["fleet"]["ships"] if f["id"] == ship["id"]]
        out["commissioned_now"] = {"kind": ship["kind"], "no": mine[0]["no"] if mine else 1,
                                   "count": len(out["fleet"]["ships"]), "cap": out["fleet"]["cap"]}
    if delivered:
        out["delivered_now"] = {"kind": ship["kind"], "fame": got["fame"], "first": first, "got": got,
                                "count": len(out["delivered"])}
    return out


# ---- 간척 ----

@router.post("/game/reclaim")
def reclaim(user=Depends(need_player)):
    """다음 간척 단계 공사 시작 (작업 반장 1명, 끝나면 땅이 넓어짐)."""
    uid = user["id"]
    with _lock(uid):
        now = _now()
        base, buildings = _prep(uid, now)
        hq = _hq(buildings)
        why = reclaim_block(base, hq["level"] if hq else 1, busy_count(buildings, base))
        if why:
            _err(400, "reclaim_" + why if why in ("soon", "max") else why)
        stage = reclaim_stage(base) + 1
        _, _, _, steel, rods, secs = RECLAIM[stage]
        price = {"steel": steel, "rods": rods}
        if not _afford(balance(ledger(uid)), price):
            _err(400, "money")
        try:
            store.patch("game_bases", {"user_id": f"eq.{uid}"}, {"reclaim_until": _iso(now + timedelta(seconds=secs))})
        except RuntimeError as e:
            print("[game] 간척 저장 실패", str(e)[:200], flush=True)
            _err(503, "need_sql16")  # step16-game-fleet.sql 을 아직 안 돌림
        _spend(uid, f"reclaim:{stage}", price, "reclaim")
    return _fresh(user)


# ---- 본관 승급 시험 ----

class ExamStartBody(BaseModel):
    lang: str = "ko"


def _pick(book, counts, avoid=None):
    """지금 교재 문제 은행에서 종류별로 무작위로 뽑기. avoid 에 있는 문제는 되도록 빼고, 모자라면 섞어 채운다."""
    import random
    avoid = avoid or set()
    picked = []
    for k, n in counts.items():
        if n <= 0:
            continue
        pool = store.select("quiz_questions", {"book_id": f"eq.{book['id']}", "kind": f"eq.{k}", "status": "eq.active",
                                               "select": daily.QSEL, "limit": "2000"})
        fresh = [q for q in pool if q["id"] not in avoid]
        got = random.sample(fresh, min(n, len(fresh)))
        if len(got) < n:
            rest = [q for q in pool if q["id"] in avoid]
            got += random.sample(rest, min(n - len(got), len(rest)))
        picked += got
    return picked


def _grade_all(qids, answers, lang):
    """여러 문제 채점 → (결과 목록, 맞힌 수, 채점 못 한 수)."""
    qs = daily._questions(qids)
    results, right, unsure = [], 0, 0
    for qid in qids:
        q = qs.get(qid)
        if not q:
            continue
        ok, fb = _grade(q, answers.get(qid), lang)
        right += 1 if ok else 0
        unsure += 1 if ok is None else 0
        tr = (q.get("translations") or {}).get(lang) if lang != "ko" else None
        results.append({"id": qid, "correct": ok, "feedback": fb,
                        "correct_choice": q.get("answer") if q["kind"] in daily.CHOICE_KINDS else None,
                        "model_answer": (tr or {}).get("model_answer") or q.get("model_answer") or "",
                        "explanation": (tr or {}).get("explanation") or q.get("explanation") or ""})
    return results, right, unsure


@router.post("/game/hq-exam/start")
def hq_exam_start(body: ExamStartBody, user=Depends(need_player)):
    """지금 본관 다음 레벨 승급 시험 문제를 문제 은행에서 뽑는다 (볼 때마다 새로 뽑음)."""
    uid = user["id"]
    st = settings()
    lang = daily._lang(body.lang)
    hq = _hq(_buildings(uid))
    if not hq:
        _err(404, "not_found")
    target = hq["level"] + 1
    if target > BUILDINGS["hq"]["max"]:
        _err(400, "max")
    if exam_passed(ledger(uid), target):
        _err(400, "already")
    book = textbook.current_book()
    if not book:
        _err(400, "no_questions")
    spec = exam_spec(st)
    picked = _pick(book, spec["counts"])
    if not picked:
        _err(400, "no_questions")
    need = min(spec["pass"], len(picked))
    daily.ensure_translations(picked, lang)
    exam_id = str(uuid.uuid4())
    with _lock(uid):
        _exams[uid] = {"id": exam_id, "target": target, "qids": [q["id"] for q in picked], "pass": need,
                       "lang": lang, "at": _now()}
    off = book.get("page_offset") or 0
    return {"id": exam_id, "target": target, "pass": need, "total": len(picked), "short_of": spec["total"] - len(picked),
            "questions": [daily._public(q, None, lang, off) for q in picked]}


class ExamSubmitBody(BaseModel):
    id: str
    answers: dict[str, str | int]


def _grade(q, ans, lang):
    """승급 시험 한 문제 채점 → (맞음 True/False/None(채점 못 함), 해설)."""
    if q["kind"] in daily.CHOICE_KINDS:
        try:
            pick = int(ans)
        except (TypeError, ValueError):
            return False, ""
        return pick == q.get("answer"), ""
    text = str(ans or "").strip()[:1000 if q["kind"] == "short" else 200]
    if not text:
        return False, ""
    if q["kind"] == "word":
        score, fb, _ = daily.grade_word(q, text, lang)
    else:
        score, fb = daily.grade_short(q, text, lang)
    return (None if score is None else score >= daily.PASS_SCORE), fb


@router.post("/game/hq-exam/submit")
def hq_exam_submit(body: ExamSubmitBody, user=Depends(need_player)):
    uid = user["id"]
    with _lock(uid):
        ex = _exams.get(uid)
    if not ex or ex["id"] != body.id:
        _err(400, "exam_gone")  # 서버가 다시 켜졌거나 다른 시험을 새로 시작함 → 다시 보기
    results, right, unsure = _grade_all(ex["qids"], body.answers, ex["lang"])
    passed = right >= ex["pass"]
    with _lock(uid):
        if _exams.get(uid, {}).get("id") == ex["id"]:
            _exams.pop(uid, None)
        if passed:
            _add(uid, [{"key": f"hq_exam:{ex['target']}", "note": "hq_exam"}])
    return {"passed": passed, "right": right, "total": len(results), "pass": ex["pass"], "unsure": unsure,
            "target": ex["target"], "results": results, "state": _fresh(user)}


# ---- 자재 조달 (게임 안에서 문제 풀어 강판·용접봉 벌기) ----

def supply_spec(st):
    counts = {k: int(st[f"supply_{k}"]) for k in SUPPLY_KINDS}
    return {"counts": counts, "total": sum(counts.values()), "steel": int(st["supply_steel"]),
            "rods": int(st["supply_rods"]), "day_max": int(st["supply_day_max"])}


def supply_today(rows, now=None):
    """오늘(한국 날짜) 자재 조달을 몇 번 했나 (장부 열쇠 supply:날짜:id)."""
    pre = f"supply:{(now or _now()).astimezone(KST).date().isoformat()}:"
    return sum(1 for r in rows if str(r.get("key", "")).startswith(pre))


def supply_seen(uid, rows):
    """자재 조달에서 이미 낸 문제 → 낸 순서 (클수록 최근). 장부(낸 판, 오래된 것부터) + 메모리(열었지만 안 낸 판)."""
    seen, n = {}, 0
    for r in rows:   # 장부는 created_at 오름차순
        note = str(r.get("note") or "")
        if str(r.get("key", "")).startswith("supply:") and note.startswith("supply|"):
            n += 1
            for q in note[7:].split(","):
                if q:
                    seen[q] = n
    n += 1
    for q in _supply_open.get(uid, {}):
        seen[q] = n
    return seen


def _norm(text):
    return "".join(ch for ch in str(text or "").lower() if ch.isalnum())


def pick_supply(book, counts, seen):
    """자재 조달 문제 고르기.
    1) 아직 안 낸 문제만, 종류별로 정한 수만큼 (글이 같은 문제는 하나로 봄)
    2) 그 종류의 새 문제가 바닥나면 객관식 새 문제로 채움 (단답형은 관리자가 단답형 수를 1 이상으로 했을 때만:
       답이 조금 달라도 AI 채점이 들 수 있어서)
    3) 전부 다 냈으면 가장 오래전에 낸 문제부터 다시 (방금 낸 문제가 연달아 나오지 않게)
    서술형은 절대 안 냄."""
    import random
    pools = {}
    for k in SUPPLY_FALLBACK:
        rows = store.select("quiz_questions", {"book_id": f"eq.{book['id']}", "kind": f"eq.{k}", "status": "eq.active",
                                               "select": daily.QSEL, "limit": "2000"})
        random.shuffle(rows)
        pools[k] = rows
    picked, used_text = [], set()
    # 글이 같은 문제(문제 은행에 겹쳐 들어간 것)는 하나라도 냈으면 같이 낸 것으로 본다
    text_seen = {}
    for rows in pools.values():
        for q in rows:
            if q["id"] in seen:
                t = _norm(q.get("question"))
                text_seen[t] = max(text_seen.get(t, 0), seen[q["id"]])
    when = lambda q: max(seen.get(q["id"], 0), text_seen.get(_norm(q.get("question")), 0))

    def take(k, n, fresh):
        got = []
        cands = [q for q in pools[k] if (when(q) == 0) == fresh]
        if not fresh:   # 다시 낼 때는 오래전에 낸 것부터
            cands.sort(key=when)
        for q in cands:
            if len(got) >= n:
                break
            t = _norm(q.get("question"))
            if t in used_text or any(q["id"] == x["id"] for x in picked):
                continue
            used_text.add(t)
            got.append(q)
        picked.extend(got)
        return n - len(got)

    short = 0
    for k in SUPPLY_FALLBACK:
        if counts.get(k, 0) > 0:
            short += take(k, counts[k], True)
    swapped = False
    allowed = [k for k in SUPPLY_FALLBACK if k != "word" or counts.get("word", 0) > 0]
    for k in allowed:                  # 새 문제가 모자라면 다른 종류의 새 문제로
        if short <= 0:
            break
        before = short
        short = take(k, short, True)
        swapped = swapped or short < before
    order = [k for k in allowed if counts.get(k, 0) > 0] + [k for k in allowed if counts.get(k, 0) <= 0]
    for k in order:                    # 그래도 모자라면 오래전에 낸 문제부터 다시
        if short <= 0:
            break
        short = take(k, short, False)
    rank = {k: i for i, k in enumerate(SUPPLY_FALLBACK)}
    picked.sort(key=lambda q: rank.get(q["kind"], 9))
    return picked, swapped


@router.post("/game/supply/start")
def supply_start(body: ExamStartBody, user=Depends(need_player)):
    """자재 조달 문제 뽑기. 하루 횟수(0 = 무제한)를 넘으면 day_max."""
    uid = user["id"]
    st = settings()
    lang = daily._lang(body.lang)
    spec = supply_spec(st)
    if spec["total"] <= 0:
        _err(400, "no_questions")
    rows = ledger(uid)
    done = supply_today(rows)
    if spec["day_max"] and done >= spec["day_max"]:
        _err(400, "supply_day_max", n=spec["day_max"])
    book = textbook.current_book()
    if not book:
        _err(400, "no_questions")
    now = _now()
    with _lock(uid):
        seen = supply_seen(uid, rows)
    picked, swapped = pick_supply(book, spec["counts"], seen)
    if not picked:
        _err(400, "no_questions")
    daily.ensure_translations(picked, lang)
    sid = str(uuid.uuid4())
    with _lock(uid):
        _supplies[uid] = {"id": sid, "qids": [q["id"] for q in picked], "lang": lang, "at": now}
        opened = _supply_open.setdefault(uid, {})
        for q in picked:
            opened[q["id"]] = now
    off = book.get("page_offset") or 0
    return {"id": sid, "total": len(picked), "short_of": spec["total"] - len(picked), "swapped": swapped,
            "steel": spec["steel"], "rods": spec["rods"], "done_today": done, "day_max": spec["day_max"],
            "questions": [daily._public(q, None, lang, off) for q in picked]}


@router.post("/game/supply/submit")
def supply_submit(body: ExamSubmitBody, user=Depends(need_player)):
    """채점하고 맞힌 만큼 강판·용접봉 (창고 자리만큼만)."""
    uid = user["id"]
    st = settings()
    with _lock(uid):
        sp = _supplies.get(uid)
        if not sp or sp["id"] != body.id:
            _err(400, "exam_gone")
        _supplies.pop(uid, None)   # 한 번만 채점 (두 번 받기 막기)
    results, right, unsure = _grade_all(sp["qids"], body.answers, sp["lang"])
    earn = {"steel": right * int(st["supply_steel"]), "rods": right * int(st["supply_rods"])}
    with _lock(uid):
        buildings = _buildings(uid)
        got = clip_storage(earn, balance(ledger(uid)), caps(buildings))
        day = _now().astimezone(KST).date().isoformat()
        # 낸 문제 id 를 메모에 남겨 서버가 다시 켜져도 같은 문제를 또 내지 않게
        _add(uid, [{"key": f"supply:{day}:{sp['id']}", **got, "note": "supply|" + ",".join(sp["qids"])}])
        opened = _supply_open.get(uid, {})
        for q in sp["qids"]:
            opened.pop(q, None)
    return {"right": right, "total": len(results), "unsure": unsure, "earn": earn, "got": got,
            "full": got != earn, "results": results, "state": _fresh(user)}


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
    for k in EXAM_KINDS:
        if cur[f"hq_exam_{k}"] > EXAM_MAX_EACH:
            _err(400, "bad_value", key=f"hq_exam_{k}")
    total = sum(cur[f"hq_exam_{k}"] for k in EXAM_KINDS)
    if total < 1:
        _err(400, "bad_value", key="hq_exam_ox")
    if not 1 <= cur["hq_exam_pass"] <= total:
        _err(400, "bad_value", key="hq_exam_pass")
    for k in SUPPLY_KINDS:
        if cur[f"supply_{k}"] > EXAM_MAX_EACH:
            _err(400, "bad_value", key=f"supply_{k}")
    if sum(cur[f"supply_{k}"] for k in SUPPLY_KINDS) < 1:
        _err(400, "bad_value", key="supply_ox")
    _save_setting("game", cur)
    return {"settings": cur, "defaults": DEFAULTS}


# ---- 관리자: 계정에 자원 지급 (박사 요청 2026-11-28) ----
# 장부에 'admin:' 열쇠로 한 줄 적는다 (누가·언제·메모가 남음). 창고 한도는 무시하고 그대로 들어간다.
# 음수를 넣으면 회수 (잔액보다 많이 빼지는 못함).
GRANT_KEYS = ("steel", "rods", "tech", "passes", "fame")
GRANT_MAX = 1000000


@router.get("/admin/game/players")
def admin_players(q: str = "", user=Depends(need_admin)):
    rows = store.select("users", {"role": "in.(student,admin)", "select": "id,name,login_id,role,status",
                                  "order": "name.asc", "limit": "5000"})
    q = q.strip().lower()
    out = [r for r in rows if r.get("status") != "deleted"
           and (not q or q in (r.get("name") or "").lower() or q in (r.get("login_id") or "").lower())]
    return {"players": [{"id": r["id"], "name": r.get("name") or "", "login_id": r.get("login_id") or "", "role": r["role"]}
                        for r in out[:50]], "total": len(out)}


def _player(uid):
    try:
        uuid.UUID(uid)
    except ValueError:
        _err(404, "not_found")
    rows = store.select("users", {"id": f"eq.{uid}", "select": "id,name,login_id,role"})
    if not rows or rows[0]["role"] not in GAME_ROLES:
        _err(404, "not_found")
    return rows[0]


def _player_view(u):
    rows = ledger(u["id"])
    buildings = _buildings(u["id"])
    hq = _hq(buildings)
    grants = [{"at": r.get("created_at"), **{k: int(r.get(k) or 0) for k in GRANT_KEYS},
               "by": (r.get("note") or "").split("|")[1] if (r.get("note") or "").count("|") >= 2 else "",
               "memo": (r.get("note") or "").split("|", 2)[2] if (r.get("note") or "").count("|") >= 2 else ""}
              for r in rows if r["key"].startswith("admin:")]
    return {"player": {"id": u["id"], "name": u.get("name") or "", "login_id": u.get("login_id") or "", "role": u["role"]},
            "started": bool(buildings), "hq_level": hq["level"] if hq else 0,
            "resources": balance(rows), "caps": caps(buildings), "grants": grants[::-1][:30]}


@router.get("/admin/game/player/{uid}")
def admin_player(uid: str, user=Depends(need_admin)):
    return _player_view(_player(uid))


class GrantBody(BaseModel):
    user_id: str
    steel: int = 0
    rods: int = 0
    tech: int = 0
    passes: int = 0
    fame: int = 0
    memo: str = ""


@router.post("/admin/game/grant")
def admin_grant(body: GrantBody, user=Depends(need_admin)):
    u = _player(body.user_id)
    amt = {k: int(getattr(body, k)) for k in GRANT_KEYS}
    if not any(amt.values()):
        _err(400, "grant_empty")
    if any(abs(v) > GRANT_MAX for v in amt.values()):
        _err(400, "grant_big", n=GRANT_MAX)
    memo = (body.memo or "").replace("|", "/").strip()[:100]
    with _lock(u["id"]):
        bal = balance(ledger(u["id"]))
        short = [k for k, v in amt.items() if v < 0 and bal[k] + v < 0]
        if short:
            _err(400, "grant_below_zero", res=short[0], have=bal[short[0]])
        _add(u["id"], [{"key": f"admin:{uuid.uuid4()}", **amt,
                        "note": f"admin|{user.get('login_id') or user.get('name') or ''}|{memo}"}])
    return _player_view(u)

