"""G3 월 시즌·명성 순위 (박사 승인 2026-11-28, 숫자는 예시 · 관리자 설정).

- 한 달(한국 시간 매달 1일 0시 ~ 다음 달 1일 0시)이 한 시즌. 순위는 지금 명성으로 매긴다.
- 새 시즌이 시작되면 명성을 season_keep_pct(예시 50%)만 남긴다 (게임을 열 때 장부 season:<달> 한 줄로, game.season_half_row).
  아직 게임을 안 연 사람도 순위에서는 같은 계산으로 줄여서 보여 준다.
- 명성 얻는 곳: 공격 별·막아 냄·해적 새 별·배 인도·대항전 승리·자재 지원(조금)·이달의 해적 선단.
- 순위 두 가지: 우리 반 안(진행 중 과정), 전체 교육생(과정 고르기). 교육생만 (조선소가 있는 사람).
- 시즌이 끝나면 반마다 1·2·3등 금·은·동 배지, 그 시즌에 명성을 1이라도 얻은 사람은 참여 배지.
  다음 달 누군가 순위를 열 때 서버가 계산해 game_season_badges 에 남긴다 (지난 시즌 기록은 계속 남음).
- 관리자 '지금 시즌 끝내 보기'(시험): 이번 달 지금까지로 배지를 미리 만들어 본다. 표시가 남지만, 진짜 달이 끝나면 다시 계산해 바꾼다.
- step23 SQL 필요 (game_seasons, game_season_badges). 없으면 배지만 빠지고 순위는 보인다.
"""
import threading
import time
from datetime import datetime

from fastapi import APIRouter, Depends

import game
import game_gift
import store
from admin_settings import need_admin
from game import KST, _err, need_player

router = APIRouter()
BADGES = ("gold", "silver", "bronze")
TOP_N = 50
CACHE_TTL = 60

_lock = threading.Lock()
_cache: dict = {}
_off = {"until": 0.0}


def _db(label, fn):
    if time.monotonic() < _off["until"]:
        return None
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        m = str(e)
        print(f"[season] {label} 실패", m[:200], flush=True)
        if "game_season" in m or "42P01" in m or "PGRST205" in m or "schema cache" in m:
            _off["until"] = time.monotonic() + 600
            return None
        raise


def next_start(start):
    y, m = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
    return datetime(y, m, 1, tzinfo=KST)


def prev_start(start):
    y, m = (start.year - 1, 12) if start.month == 1 else (start.year, start.month - 1)
    return datetime(y, m, 1, tzinfo=KST)


# ---- 명성 ----

def _fame_rows(ids):
    if not ids:
        return {}
    out: dict = {u: [] for u in ids}
    for i in range(0, len(ids), 150):
        part = ids[i:i + 150]
        for r in store.select("game_ledger", {"user_id": f"in.({','.join(part)})", "fame": "neq.0",
                                              "select": "user_id,key,fame,created_at", "limit": "50000"}):
            out.setdefault(r["user_id"], []).append(r)
    return out


def fame_at(rows, start, end, keep):
    """[start, end) 시즌이 end 에 끝났을 때 명성. 그 시즌 줄이기 줄이 없으면 같은 계산으로 줄여 줌."""
    key = f"season:{start.strftime('%Y-%m')}"
    upto = [r for r in rows if (game._dt(r.get("created_at")) or start) < end]
    total = sum(int(r.get("fame") or 0) for r in upto)
    if not any(r.get("key") == key for r in rows):
        total -= game.season_cut(rows, start, keep)
    return total


def gained(rows, start, end):
    """그 시즌 동안 얻은 명성 (줄이기·회수 줄은 빼고 + 만)."""
    return sum(max(0, int(r.get("fame") or 0)) for r in rows
               if not str(r.get("key", "")).startswith("season:") and start <= (game._dt(r.get("created_at")) or start) < end)


# ---- 사람 ----

def players():
    """조선소가 있는 교육생 (활동 중·수료) → {uid: {name, courses:[과정 id]}} 와 과정 이름."""
    users = store.select("users", {"role": "eq.student", "status": "in.(active,graduated)", "select": "id,name"})
    ids = [u["id"] for u in users]
    if not ids:
        return {}, {}
    has = set()
    for i in range(0, len(ids), 150):
        part = ids[i:i + 150]
        has |= {b["user_id"] for b in store.select("game_bases", {"user_id": f"in.({','.join(part)})", "select": "user_id"})}
    links = store.select("user_courses", {"select": "user_id,course_id"})
    courses = {c["id"]: c for c in store.select("courses", {"select": "id,name,active,sort", "order": "sort.asc,name.asc"})}
    out = {}
    for u in users:
        if u["id"] in has:
            out[u["id"]] = {"name": u.get("name") or "", "courses": [l["course_id"] for l in links if l["user_id"] == u["id"]]}
    return out, courses


def table(now, st):
    """이번 시즌 모두의 명성 (1분 기억)."""
    key = game.season_key(now)
    hit = _cache.get("table")
    if hit and hit[0] == key and time.monotonic() - hit[1] < CACHE_TTL:
        return hit[2]
    people, courses = players()
    rows = _fame_rows(list(people))
    start = game.season_start(now)
    end = next_start(start)
    keep = int(st["season_keep_pct"])
    for uid, p in people.items():
        p["fame"] = fame_at(rows.get(uid, []), start, end, keep)
        p["gain"] = gained(rows.get(uid, []), start, end)
    out = (people, courses)
    _cache["table"] = (key, time.monotonic(), out)
    return out


# ---- 시즌 끝: 배지 ----

def finish(start, end, st, test=False):
    """[start, end) 시즌 배지를 계산해 저장 (반마다 1·2·3등 + 참여). test 면 나중에 진짜 끝날 때 다시 계산."""
    season = start.strftime("%Y-%m")
    people, courses = players()
    rows = _fame_rows(list(people))
    keep = int(st["season_keep_pct"])
    score = {u: (fame_at(rows.get(u, []), start, end, keep), gained(rows.get(u, []), start, end)) for u in people}
    badges = {}
    live = [c for c, v in courses.items() if v.get("active")]
    for cid in live + [None]:
        mem = [u for u, p in people.items() if (cid in p["courses"] if cid else not any(c in live for c in p["courses"]))]
        join = sorted([u for u in mem if score[u][1] > 0], key=lambda u: (-score[u][0], people[u]["name"]))
        for i, u in enumerate(join):
            if u in badges:
                continue
            badge = BADGES[i] if cid and i < 3 else "join"
            badges[u] = {"season": season, "user_id": u, "course_id": cid, "rank": i + 1, "fame": score[u][0], "badge": badge}
    if _db("배지 지우기", lambda: store.delete("game_season_badges", {"season": f"eq.{season}"})) is None and _off["until"] > time.monotonic():
        return None
    if badges:
        _db("배지 쓰기", lambda: store.insert_rows("game_season_badges", list(badges.values()), returning=False))
    _db("시즌 표시", lambda: store.upsert("game_seasons", [{"season": season, "done_at": game._iso(game._now()), "test": test}],
                                          on_conflict="season"))
    _cache.pop("badges", None)
    return list(badges.values())


def finish_due(now, st):
    """지난 시즌이 아직 안 끝났으면(또는 시험으로만 끝냈으면) 지금 끝냄."""
    if time.monotonic() < _off["until"]:
        return
    start = prev_start(game.season_start(now))
    season = start.strftime("%Y-%m")
    rows = _db("시즌 확인", lambda: store.select("game_seasons", {"season": f"eq.{season}", "select": "season,test"}))
    if rows is None or (rows and not rows[0].get("test")):
        return
    with _lock:
        rows = _db("시즌 확인", lambda: store.select("game_seasons", {"season": f"eq.{season}", "select": "season,test"}))
        if rows is None or (rows and not rows[0].get("test")):
            return
        finish(start, game.season_start(now), st)


def badges_of(ids=None):
    """사람마다 가장 최근 시즌 배지 {uid: {season, badge, rank}} (1분 기억)."""
    hit = _cache.get("badges")
    if not hit or time.monotonic() - hit[0] > CACHE_TTL:
        rows = _db("배지 읽기", lambda: store.select("game_season_badges", {"select": "season,user_id,badge,rank,fame,course_id",
                                                                         "order": "season.desc", "limit": "50000"})) or []
        latest = {}
        for r in rows:
            latest.setdefault(r["user_id"], r)
        hit = (time.monotonic(), latest, rows)
        _cache["badges"] = hit
    return hit[1] if ids is None else {u: hit[1][u] for u in ids if u in hit[1]}


def my_badges(uid):
    badges_of()
    return [{"season": r["season"], "badge": r["badge"], "rank": r["rank"], "fame": r["fame"]}
            for r in _cache["badges"][2] if r["user_id"] == uid][:12]


# ---- 화면 ----

def _row(uid, p, rank, courses, badge):
    names = [courses[c]["name"] for c in p["courses"] if c in courses and courses[c].get("active")]
    return {"id": uid, "name": p["name"], "fame": p["fame"], "rank": rank, "course": names[0] if names else "",
            "badge": badge.get("badge") if badge else None}


def ranking(people, ids):
    order = sorted(ids, key=lambda u: (-people[u]["fame"], people[u]["name"], u))
    rank, last, out = 0, None, []
    for i, u in enumerate(order):
        if people[u]["fame"] != last:
            rank, last = i + 1, people[u]["fame"]
        out.append((u, rank))
    return out


def view(user, scope="class", course=None):
    uid = user["id"]
    st = game.settings()
    if not st["season_on"]:
        return {"on": False}
    now = game._now()
    finish_due(now, st)
    people, courses = table(now, st)
    start = game.season_start(now)
    end = next_start(start)
    mine = game_gift._live_courses(uid)
    live = [{"id": c, "name": v["name"]} for c, v in courses.items() if v.get("active")]
    if scope == "class":
        ids = [u for u, p in people.items() if mine & set(p["courses"])]
    else:
        ids = [u for u, p in people.items() if not course or course in p["courses"]]
    if uid in people and uid not in ids and scope == "class":
        ids.append(uid)
    ranked = ranking(people, ids)
    bd = badges_of([u for u, _ in ranked[:TOP_N]] + [uid])
    rows = [_row(u, people[u], r, courses, bd.get(u)) for u, r in ranked[:TOP_N]]
    me = next(((u, r) for u, r in ranked if u == uid), None)
    out = {"on": True, "season": game.season_key(now), "ends_at": game._iso(end), "keep_pct": int(st["season_keep_pct"]),
           "scope": scope, "course": course, "courses": live, "rows": rows, "total": len(ranked),
           "me": _row(uid, people[uid], me[1], courses, bd.get(uid)) if me else None,
           "my_badges": my_badges(uid), "badges_ready": _off["until"] <= time.monotonic(),
           "class_name": next((courses[c]["name"] for c in mine if c in courses), "")}
    return out


@router.get("/game/season")
def get_season(scope: str = "class", course: str | None = None, user=Depends(need_player)):
    if scope not in ("class", "all"):
        _err(400, "bad_value")
    return view(user, scope, course)


@router.post("/admin/game/season/finish")
def admin_finish(user=Depends(need_admin)):
    """시험: 이번 달 지금까지 명성으로 배지를 만들어 봄 (진짜 달이 끝나면 다시 계산해 바꿈)."""
    now = game._now()
    st = game.settings()
    with _lock:
        got = finish(game.season_start(now), now, st, test=True)
    if got is None:
        _err(503, "need_sql23")
    _cache.pop("table", None)
    return {"season": game.season_key(now), "count": len(got),
            "top": sorted([{"badge": b["badge"], "rank": b["rank"], "fame": b["fame"]} for b in got if b["badge"] != "join"],
                          key=lambda b: b["rank"])[:12]}

