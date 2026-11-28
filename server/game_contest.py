"""G3 주간 반 대항전 (박사 승인 2026-11-28, 숫자는 모두 예시 · 관리자 설정).

- 월요일 0시(한국 시간)에 상대 반을 정한다: 진행 중 과정(반) 중 조선소가 있는 교육생이 있는 반끼리,
  반 평균 본관 레벨이 비슷한 반끼리 짝. 반이 홀수면 남는 한 반은 '지난주 우리 반 점수에 도전'
  (지난주에 혼자였던 반은 되도록 다시 혼자가 되지 않게).
- 대항전은 월요일 0시 ~ 토요일 0시. 토요일 0시가 지나면 결과를 낸다 (누군가 게임을 열 때 서버가 계산).
- 반 점수 = 사람마다 (공부 점수 + 전투 점수)를 더해 이번 주 게임을 연 사람 수로 나눈 평균.
  하루에 한 사람이 올릴 수 있는 점수는 contest_day_cap(예시 30)이고,
  그중 공부 몫이 contest_study_pct(예시 60%) → 공부 하루 최대 18, 전투 하루 최대 12.
  · 공부: 매일 문제 다 푼 날 +10, 돌발 OX 맞힘 +2, 대원 훈련 정답 +1
  · 전투: 상대 반 교육생에게 얻은 별 +3, 해적 새 별 +2, 상대 반 공격을 막아 냄(상대 별 0~1개) +5
- 결과: 점수가 높은 반 승리 (같으면 두 반 모두 승리). 혼자인 반은 지난주 점수를 넘으면 승리 (지난주 기록이 없으면 1점 이상).
  이긴 반은 모두 강판 300·용접봉 150·명성 20, 진 반은 점수를 1점이라도 올린 사람만 강판 100. 눌러서 받기 (장부 contest:<주>:<반>).
- 관리자: '지금 짝 정하기'(이번 주 다시 정함)·'지금 결과 내기'(이번 주를 지금 끝냄)로 한 주를 기다리지 않고 확인.
- step22 SQL 필요 (game_contest 표). 없으면 대항전 칸에 "준비 중"만 보이고 게임은 그대로.
"""
import threading
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import board
import game
import game_gift
import store
from admin_settings import need_admin
from game import KST, _err, need_player

router = APIRouter()

# 점수 (예시)
PTS = {"daily": 10, "ox": 2, "crew": 1, "star": 3, "pirate": 2, "defend": 5}
DAYS = 5            # 월~금
LIVE_TTL = 60       # 진행 중 점수는 1분 동안 기억 (화면을 열 때마다 전체를 다시 세지 않게)

_lock = threading.Lock()
_live_cache: dict = {}
_off = {"until": 0.0}


def _db(label, fn):
    """game_contest 표가 없으면(step22 전) 10분 동안 쉬고 None."""
    if time.monotonic() < _off["until"]:
        return None
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        m = str(e)
        print(f"[contest] {label} 실패", m[:200], flush=True)
        if "game_contest" in m or "42P01" in m or "PGRST205" in m or "schema cache" in m:
            _off["until"] = time.monotonic() + 600
            return None
        raise


def _iso(dt):
    return game._iso(dt)


def week_start(now):
    d = now.astimezone(KST).date()
    mon = d - timedelta(days=d.weekday())
    return datetime(mon.year, mon.month, mon.day, tzinfo=KST)


def caps(st):
    cap = int(st["contest_day_cap"])
    s = round(cap * int(st["contest_study_pct"]) / 100)
    return {"study": s, "battle": cap - s}


# ---- 반 ----

def classes():
    """진행 중 과정마다 조선소가 있는 활동 중 교육생 → {과정 id: {name, members:[uid]}}."""
    cs = store.select("courses", {"active": "eq.true", "select": "id,name,sort", "order": "sort.asc,name.asc"})
    if not cs:
        return {}
    links = store.select("user_courses", {"course_id": f"in.({','.join(c['id'] for c in cs)})", "select": "user_id,course_id"})
    ids = sorted({l["user_id"] for l in links})
    if not ids:
        return {}
    got = game._par(
        users=lambda: store.select("users", {"id": f"in.({','.join(ids)})", "role": "eq.student", "status": "eq.active", "select": "id"}),
        bases=lambda: store.select("game_bases", {"user_id": f"in.({','.join(ids)})", "select": "user_id"}),
    )
    ok = {u["id"] for u in got["users"]} & {b["user_id"] for b in got["bases"]}
    out = {}
    for c in cs:
        mem = sorted({l["user_id"] for l in links if l["course_id"] == c["id"] and l["user_id"] in ok})
        if mem:
            out[c["id"]] = {"name": c.get("name") or "", "members": mem}
    return out


def _course_names(ids):
    ids = [i for i in ids if i]
    if not ids:
        return {}
    return {c["id"]: c.get("name") or "" for c in store.select("courses", {"id": f"in.({','.join(set(ids))})", "select": "id,name"})}


# ---- 점수 ----

def score_of(members, rivals, start, end, st=None):
    """members 의 [start, end) 점수 → {score, active, people:{uid:{study,battle}}}. rivals = 상대 반 교육생 (없으면 혼자)."""
    st = st or game.settings()
    cap = caps(st)
    people = {u: {"study": 0, "battle": 0} for u in members}
    if not members:
        return {"score": 0, "active": 0, "people": people, "days": {}, "attacks": {}, "seen": set()}
    rivals = set(rivals or [])
    ids = ",".join(members)
    s_iso = _iso(start)
    d0 = start.astimezone(KST).date().isoformat()
    d1 = (end - timedelta(seconds=1)).astimezone(KST).date().isoformat()

    def q(table, params):
        try:
            return board.select_all(table, params)
        except Exception as e:  # noqa: BLE001  (아직 없는 표는 0점)
            print(f"[contest] {table} 못 읽음", str(e)[:120], flush=True)
            return []

    got = game._par(
        sets=lambda: q("daily_sets", {"user_id": f"in.({ids})", "day": f"gte.{d0}", "select": "user_id,day,question_ids"}),
        ans=lambda: q("daily_answers", {"user_id": f"in.({ids})", "day": f"gte.{d0}", "select": "user_id,day"}),
        ox=lambda: q("live_ox_answers", {"user_id": f"in.({ids})", "correct": "eq.true", "created_at": f"gte.{s_iso}",
                                         "select": "user_id,created_at"}),
        crew=lambda: q("game_answers", {"user_id": f"in.({ids})", "source": "eq.crew", "correct": "eq.true",
                                        "created_at": f"gte.{s_iso}", "select": "user_id,created_at"}),
        raids=lambda: q("game_battles", {"user_id": f"in.({ids})", "kind": "eq.raid", "created_at": f"gte.{s_iso}",
                                         "select": "user_id,defender_id,stars,created_at"}),
        defs=lambda: q("game_battles", {"defender_id": f"in.({ids})", "kind": "eq.raid", "created_at": f"gte.{s_iso}",
                                        "select": "user_id,defender_id,stars,created_at"}),
        pir=lambda: q("game_battles", {"user_id": f"in.({ids})", "kind": "eq.pirate", "created_at": f"gte.{s_iso}",
                                       "select": "user_id,created_at,first:result->first_stars"}),
        seen=lambda: q("game_bases", {"user_id": f"in.({ids})", "select": "user_id,last_seen_at"}),
    )
    day_pts: dict = {}   # (uid, 날짜) → {study, battle}

    def add(uid, when, kind, n):
        if uid not in people or not n:
            return
        if isinstance(when, str) and len(when) == 10:
            day = when
        else:
            t = game._dt(when)
            if not t or t < start or t >= end:
                return
            day = t.astimezone(KST).date().isoformat()
        if not d0 <= day <= d1:
            return
        p = day_pts.setdefault((uid, day), {"study": 0, "battle": 0})
        p[kind] += n

    cnt: dict = {}
    for r in got["ans"]:
        cnt[(r["user_id"], r["day"])] = cnt.get((r["user_id"], r["day"]), 0) + 1
    days: dict = {}     # 매일 문제 다 푼 날 수 (교사 보드용)
    for s in got["sets"]:
        if s.get("question_ids") and cnt.get((s["user_id"], s["day"]), 0) >= len(s["question_ids"]):
            add(s["user_id"], s["day"], "study", PTS["daily"])
            if d0 <= s["day"] <= d1:
                days[s["user_id"]] = days.get(s["user_id"], 0) + 1
    attacks: dict = {}  # 교육생끼리 공격 횟수 (상대 반이 아니어도, 교사 보드용)
    for r in got["raids"]:
        t = game._dt(r.get("created_at"))
        if t and start <= t < end:
            attacks[r["user_id"]] = attacks.get(r["user_id"], 0) + 1
    for r in got["ox"]:
        add(r["user_id"], r["created_at"], "study", PTS["ox"])
    for r in got["crew"]:
        add(r["user_id"], r["created_at"], "study", PTS["crew"])
    for r in got["raids"]:
        if r.get("defender_id") in rivals:
            add(r["user_id"], r["created_at"], "battle", PTS["star"] * int(r.get("stars") or 0))
    for r in got["defs"]:
        if r.get("user_id") in rivals and int(r.get("stars") or 0) <= 1:
            add(r["defender_id"], r["created_at"], "battle", PTS["defend"])
    for r in got["pir"]:
        add(r["user_id"], r["created_at"], "battle", PTS["pirate"] * int(r.get("first") or 0))
    for (uid, _), p in day_pts.items():
        people[uid]["study"] += min(p["study"], cap["study"])
        people[uid]["battle"] += min(p["battle"], cap["battle"])
    # 이번 주 게임을 한 번도 안 연 사람은 평균에서 뺌 (점수가 있으면 연 것으로)
    seen = {r["user_id"] for r in got["seen"] if (game._dt(r.get("last_seen_at")) or start) >= start}
    active = [u for u in members if u in seen or people[u]["study"] + people[u]["battle"] > 0]
    total = sum(p["study"] + p["battle"] for p in people.values())
    return {"score": round(total / len(active), 1) if active else 0, "active": len(active), "people": people,
            "days": days, "attacks": attacks, "seen": seen}


# ---- 짝 정하기 · 결과 ----

def _rows(week):
    return _db("주 읽기", lambda: store.select("game_contest", {"week": f"eq.{week}", "select": "*"})) or []


def pair(start, end):
    """이번 주 짝을 정해 표에 쓴다 (이미 있으면 그대로). 반환: 그 주 줄들."""
    week = start.date().isoformat()
    cls = classes()
    if not cls:
        return []
    ids = list(cls)
    hq = {}
    allm = [u for c in cls.values() for u in c["members"]]
    for r in store.select("game_buildings", {"user_id": f"in.({','.join(allm)})", "type": "eq.hq", "select": "user_id,level"}):
        hq[r["user_id"]] = int(r.get("level") or 1)
    avg = {c: sum(hq.get(u, 1) for u in cls[c]["members"]) / len(cls[c]["members"]) for c in ids}
    order = sorted(ids, key=lambda c: (avg[c], cls[c]["name"], c))
    prev_week = (start - timedelta(days=7)).date().isoformat()
    prev = {r["course_id"]: r for r in (_db("지난주", lambda: store.select("game_contest", {"week": f"eq.{prev_week}", "select": "*"})) or [])}
    rows = []
    base = {"week": week, "start_at": _iso(start), "end_at": _iso(end), "done": False}
    if len(order) % 2:
        # 지난주에 혼자였던 반은 되도록 빼고, 본관 레벨이 가장 낮은 반부터
        solo = next((c for c in order if not (c in prev and not prev[c].get("rival_id"))), order[0])
        order.remove(solo)
        p = prev.get(solo)
        rows.append({**base, "course_id": solo, "rival_id": None, "target": p.get("score") if p and p.get("done") else None})
    for a, b in zip(order[0::2], order[1::2]):
        rows.append({**base, "course_id": a, "rival_id": b, "target": None})
        rows.append({**base, "course_id": b, "rival_id": a, "target": None})
    _db("짝 쓰기", lambda: store.upsert("game_contest", rows, on_conflict="week,course_id", ignore=True))
    return _rows(week)


def ensure_week(now):
    """이번 주 줄들. 아직 없고 월~금이면 지금 짝을 정함 (토·일에는 새로 만들지 않음)."""
    start = week_start(now)
    week = start.date().isoformat()
    rows = _rows(week)
    if rows or _off["until"] > time.monotonic():
        return rows
    if now >= start + timedelta(days=DAYS):
        return []
    with _lock:
        rows = _rows(week)
        if rows:
            return rows
        return pair(start, start + timedelta(days=DAYS))


def finish(rows, end=None, st=None):
    """끝나지 않은 줄들의 결과를 낸다 (end 를 주면 그때까지만 셈 — 관리자 '지금 결과 내기')."""
    st = st or game.settings()
    rows = [r for r in rows if not r.get("done")]
    if not rows:
        return
    cls = classes()
    by_week: dict = {}
    for r in rows:
        by_week.setdefault(r["week"], []).append(r)
    for week, wr in by_week.items():
        scores = {}
        for r in wr:
            e = end or game._dt(r["end_at"])
            s = game._dt(r["start_at"])
            mem = cls.get(r["course_id"], {}).get("members", [])
            riv = cls.get(r["rival_id"], {}).get("members", []) if r.get("rival_id") else []
            scores[r["course_id"]] = (score_of(mem, riv, s, e, st), e)
        for r in wr:
            sc, e = scores[r["course_id"]]
            if r.get("rival_id"):
                other = scores.get(r["rival_id"])
                rs = other[0]["score"] if other else 0
                won = sc["score"] >= rs
            else:
                rs = r.get("target")
                won = sc["score"] > (float(rs) if rs is not None else 0)
            _db("결과 쓰기", lambda r=r, sc=sc, rs=rs, won=won, e=e: store.patch(
                "game_contest", {"week": f"eq.{week}", "course_id": f"eq.{r['course_id']}", "done": "eq.false"},
                {"score": sc["score"], "rival_score": rs, "won": won, "done": True, "end_at": _iso(e),
                 "detail": {"active": sc["active"], "people": sc["people"]}}))
        for k in list(_live_cache):
            if k[0] == week:
                _live_cache.pop(k, None)


def finish_due(now):
    """끝날 시간이 지난 줄들의 결과 내기 (아무 교육생이나 대항전을 열 때)."""
    rows = _db("끝낼 줄", lambda: store.select("game_contest", {"done": "eq.false", "end_at": f"lt.{_iso(now)}", "select": "*"}))
    if rows:
        with _lock:
            finish(rows)


def live_scores(row, st, cls=None):
    """진행 중인 줄의 지금 점수 (우리 반, 상대 반) — 1분 기억."""
    key = (row["week"], row["course_id"])
    hit = _live_cache.get(key)
    if hit and time.monotonic() - hit[0] < LIVE_TTL:
        return hit[1]
    cls = cls if cls is not None else classes()
    s, e = game._dt(row["start_at"]), min(game._dt(row["end_at"]), game._now())
    mem = cls.get(row["course_id"], {}).get("members", [])
    riv = cls.get(row["rival_id"], {}).get("members", []) if row.get("rival_id") else []
    us = score_of(mem, riv, s, e, st)
    them = score_of(riv, mem, s, e, st) if riv else None
    out = (us, them)
    _live_cache[key] = (time.monotonic(), out)
    return out


# ---- 보상 ----

def reward_of(row, uid, st):
    """끝난 줄에서 이 사람이 받을 것 (없으면 None)."""
    if not row.get("done"):
        return None
    people = (row.get("detail") or {}).get("people") or {}
    if uid not in people:
        return None
    p = people[uid]
    if row.get("won"):
        return {"steel": int(st["contest_win_steel"]), "rods": int(st["contest_win_rods"]), "fame": int(st["contest_win_fame"])}
    if int(p.get("study") or 0) + int(p.get("battle") or 0) > 0:
        return {"steel": int(st["contest_join_steel"]), "rods": 0, "fame": 0}
    return None


def _claim_key(row):
    return f"contest:{row['week']}:{row['course_id']}"


# ---- 화면 ----

def view(user):
    uid = user["id"]
    st = game.settings()
    if not st["contest_on"]:
        return {"on": False}
    now = game._now()
    finish_due(now)
    week_rows = ensure_week(now)
    if _off["until"] > time.monotonic():
        return {"on": True, "ready": False}
    mine = game_gift._live_courses(uid)
    if not mine:
        return {"on": True, "ready": True, "row": None}
    hist = _db("기록", lambda: store.select("game_contest", {"course_id": f"in.({','.join(mine)})", "select": "*",
                                                             "order": "week.desc", "limit": "12"})) or []
    row = next((r for r in week_rows if r["course_id"] in mine), None) or (hist[0] if hist else None)
    out = {"on": True, "ready": True, "row": None, "caps": caps(st), "pts": PTS,
           "prize": {"steel": int(st["contest_win_steel"]), "rods": int(st["contest_win_rods"]), "fame": int(st["contest_win_fame"]),
                     "join": int(st["contest_join_steel"])},
           "next_start": _iso(week_start(now) + timedelta(days=7))}
    names = _course_names([r["course_id"] for r in hist + ([row] if row else [])] +
                          [r.get("rival_id") for r in hist + ([row] if row else [])])
    if row:
        cur = {"week": row["week"], "done": bool(row.get("done")), "ends_at": row["end_at"],
               "us": {"id": row["course_id"], "name": names.get(row["course_id"], "")},
               "them": {"id": row["rival_id"], "name": names.get(row["rival_id"], "")} if row.get("rival_id") else None,
               "target": row.get("target")}
        if row.get("done"):
            cur["us"]["score"] = row.get("score") or 0
            cur["rival_score"] = row.get("rival_score")
            cur["won"] = bool(row.get("won"))
            me = ((row.get("detail") or {}).get("people") or {}).get(uid) or {"study": 0, "battle": 0}
        else:
            us, them = live_scores(row, st)
            cur["us"]["score"] = us["score"]
            cur["rival_score"] = them["score"] if them else row.get("target")
            me = us["people"].get(uid) or {"study": 0, "battle": 0}
        cur["me"] = {"study": int(me.get("study") or 0), "battle": int(me.get("battle") or 0)}
        out["row"] = cur
    # 받을 보상: 끝난 지 2주 안의 줄 중 아직 안 받은 것 (가장 최근 하나)
    keys = {r["key"] for r in game.ledger(uid) if str(r.get("key", "")).startswith("contest:")}
    out["reward"] = None
    for r in hist:
        if r.get("done") and game._dt(r["end_at"]) >= now - timedelta(days=14) and _claim_key(r) not in keys:
            got = reward_of(r, uid, st)
            if got:
                out["reward"] = {"week": r["week"], "won": bool(r.get("won")), **got}
                break
    out["history"] = [{"week": r["week"], "rival": names.get(r.get("rival_id"), "") if r.get("rival_id") else None,
                       "score": r.get("score") or 0, "rival_score": r.get("rival_score"), "won": bool(r.get("won"))}
                      for r in hist if r.get("done")][:6]
    return out


@router.get("/game/contest")
def get_contest(user=Depends(need_player)):
    return view(user)


class ClaimBody(BaseModel):
    week: str
    force: bool = False     # 창고 자리가 모자라도 들어가는 만큼만 받기


@router.post("/game/contest/claim")
def claim(body: ClaimBody, user=Depends(need_player)):
    uid = user["id"]
    st = game.settings()
    mine = game_gift._live_courses(uid)
    rows = [r for r in (_db("받기", lambda: store.select("game_contest", {"week": f"eq.{body.week}", "select": "*"})) or [])
            if r["course_id"] in mine]
    row = rows[0] if rows else None
    got = reward_of(row, uid, st) if row else None
    if not got:
        _err(400, "contest_none")
    with game._lock(uid):
        led = game.ledger(uid)
        if any(r["key"] == _claim_key(row) for r in led):
            _err(400, "contest_claimed")
        room = game.clip_storage({"steel": got["steel"], "rods": got["rods"]}, game.balance(led), game.caps(game._buildings(uid)))
        if not body.force and (room["steel"] < got["steel"] or room["rods"] < got["rods"]):
            # 자리가 모자라면 먼저 알려 줌 (2주 안에 다시 받을 수 있음)
            _err(400, "contest_full", steel=room["steel"], rods=room["rods"])
        game._add(uid, [{"key": _claim_key(row), "steel": room["steel"], "rods": room["rods"], "fame": got["fame"],
                         "note": "contest_win" if row.get("won") else "contest_join"}])
    return {"contest": view(user), "state": game._fresh(user), "got": {**got, **room}}


# ---- 관리자 ----

def admin_view():
    now = game._now()
    start = week_start(now)
    rows = _rows(start.date().isoformat())
    if _off["until"] > time.monotonic():
        return {"ready": False, "rows": []}
    st = game.settings()
    cls = classes()
    names = _course_names([r["course_id"] for r in rows] + [r.get("rival_id") for r in rows])
    out = []
    seen = set()
    for r in rows:
        if r["course_id"] in seen:
            continue
        seen.add(r["course_id"])
        if r.get("rival_id"):
            seen.add(r["rival_id"])
        if r.get("done"):
            us, them = r.get("score") or 0, r.get("rival_score")
        else:
            a, b = live_scores(r, st, cls)
            us, them = a["score"], (b["score"] if b else r.get("target"))
        out.append({"course": names.get(r["course_id"], ""), "rival": names.get(r.get("rival_id"), "") if r.get("rival_id") else None,
                    "score": us, "rival_score": them, "done": bool(r.get("done")), "won": bool(r.get("won")) if r.get("done") else None})
    return {"ready": True, "week": start.date().isoformat(), "rows": out}


@router.get("/admin/game/contest")
def admin_get(user=Depends(need_admin)):
    return admin_view()


@router.post("/admin/game/contest/pair")
def admin_pair(user=Depends(need_admin)):
    """이번 주 짝을 지금 다시 정함 (주말이면 다음 월요일 0시까지 이어 감)."""
    now = game._now()
    start = week_start(now)
    week = start.date().isoformat()
    end = start + timedelta(days=DAYS)
    if now >= end:
        end = start + timedelta(days=7)
    with _lock:
        if _db("지우기", lambda: store.delete("game_contest", {"week": f"eq.{week}"})) is None and _off["until"] > time.monotonic():
            _err(503, "need_sql22")
        for k in list(_live_cache):
            if k[0] == week:
                _live_cache.pop(k, None)
        pair(start, end)
    return admin_view()


@router.post("/admin/game/contest/finish")
def admin_finish(user=Depends(need_admin)):
    """이번 주 대항전을 지금 끝내고 결과를 냄 (지금까지 점수로)."""
    now = game._now()
    week = week_start(now).date().isoformat()
    rows = _rows(week)
    if _off["until"] > time.monotonic():
        _err(503, "need_sql22")
    if not any(not r.get("done") for r in rows):
        _err(400, "contest_none")
    with _lock:
        finish(rows, end=now)
    return admin_view()
