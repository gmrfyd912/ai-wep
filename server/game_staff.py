"""G3 교사·관리자 게임 화면 (박사 승인 2026-11-28, 숫자는 예시).

- 교사 학습 보드 '게임' 칸 (GET /game/teacher?course=): 우리 반(고른 과정, 없으면 내가 맡은 진행 중 과정) 교육생만.
  이번 주 대항전 상대·점수, 사람마다 이번 주 공부 점수·전투 점수·매일 문제 푼 날·공격 횟수·본관 레벨,
  "공격은 많은데 공부는 적은 학생" 표시 (예시: 이번 주 공격 staff_warn_attacks 번 이상인데 매일 문제 staff_warn_days 일 이하).
- 관리자 '게임 통계' (GET /admin/game/stats): 최근 7일 하루 공격·해적 전투 수, 해적 단계별 별을 딴 사람 수,
  본관 레벨 평균·분포, 창고가 가득 찬 사람·자원이 바닥난 사람, 수리 기다리는 배. 숫자(수리비 등)를 바꿀 근거.
- SQL 없음 (있는 표만 읽음).
"""
from datetime import timedelta

from fastapi import APIRouter, Depends

import accounts
import board
import game
import game_contest as gc
import game_gift
import store
from admin_settings import need_admin
from game import KST, _err

router = APIRouter()
STAFF_ROLES = ("teacher", "staff", "admin")
LOW = {"steel": 100, "rods": 50}      # 이만큼보다 적으면 '바닥남' (예시)
FULL_PCT = 95                          # 창고가 이만큼(%) 이상 차면 '가득' (예시)


def need_staff(user=Depends(accounts.current_user)):
    if user["role"] not in STAFF_ROLES:
        _err(403, "staff_only")
    return user


def _scope(user, course):
    cls = gc.classes()
    if course and course != "all":
        ids = [course] if course in cls else []
    else:
        mine = game_gift._live_courses(user["id"])
        ids = [c for c in cls if c in mine] or (list(cls) if user["role"] == "admin" else [])
    return cls, ids


@router.get("/game/teacher")
def teacher_view(course: str = "all", user=Depends(need_staff)):
    st = game.settings()
    now = game._now()
    start = gc.week_start(now)
    cls, ids = _scope(user, course)
    week = start.date().isoformat()
    rows = {r["course_id"]: r for r in gc._rows(week)}
    names = gc._course_names(list(cls) + [r.get("rival_id") for r in rows.values()])
    allm = sorted({u for c in ids for u in cls[c]["members"]})
    users = {u["id"]: u.get("name") or "" for u in store.select("users", {"id": f"in.({','.join(allm)})", "select": "id,name"})} if allm else {}
    hq = {r["user_id"]: int(r.get("level") or 1) for r in store.select(
        "game_buildings", {"user_id": f"in.({','.join(allm)})", "type": "eq.hq", "select": "user_id,level"})} if allm else {}
    warn_a, warn_d = int(st["staff_warn_attacks"]), int(st["staff_warn_days"])
    out = []
    for cid in ids:
        mem = cls[cid]["members"]
        row = rows.get(cid)
        riv = cls.get(row["rival_id"], {}).get("members", []) if row and row.get("rival_id") else []
        s0, e0 = (game._dt(row["start_at"]), game._dt(row["end_at"])) if row and row.get("start_at") else (start, start + timedelta(days=gc.DAYS))
        sc = gc.score_of(mem, riv, s0, max(s0 + timedelta(seconds=1), min(now, e0)), st)
        contest = None
        if row:
            if row.get("done"):
                us, them = row.get("score") or 0, row.get("rival_score")
            else:
                a, b = gc.live_scores(row, st, cls)
                us, them = a["score"], (b["score"] if b else row.get("target"))
            contest = {"rival": names.get(row.get("rival_id"), "") if row.get("rival_id") else None, "score": us,
                       "rival_score": them, "done": bool(row.get("done")), "won": bool(row.get("won")) if row.get("done") else None}
        people = []
        for u in mem:
            p = sc["people"].get(u, {"study": 0, "battle": 0})
            att, days = sc["attacks"].get(u, 0), sc["days"].get(u, 0)
            people.append({"id": u, "name": users.get(u, ""), "study": p["study"], "battle": p["battle"], "days": days,
                           "attacks": att, "hq": hq.get(u, 1), "seen": u in sc["seen"],
                           "warn": bool(warn_a and att >= warn_a and days <= warn_d)})
        people.sort(key=lambda p: (not p["warn"], -(p["study"] + p["battle"]), p["name"]))
        out.append({"id": cid, "name": names.get(cid, ""), "contest": contest, "score": sc["score"], "active": sc["active"],
                    "people": people})
    return {"week": week, "classes": out, "warn": {"attacks": warn_a, "days": warn_d},
            "game_on": bool(st["enabled"]), "time_lock": bool(st["raid_time_lock"]),
            "contest_on": bool(st["contest_on"])}


@router.get("/admin/game/stats")
def admin_stats(user=Depends(need_admin)):
    now = game._now()
    since = now - timedelta(days=7)
    days = [(now - timedelta(days=i)).astimezone(KST).date().isoformat() for i in range(6, -1, -1)]
    got = game._par(
        battles=lambda: board.select_all("game_battles", {"created_at": f"gte.{game._iso(since)}", "select": "kind,created_at",
                                                          "order": "created_at.asc"}),
        stars=lambda: board.select_all("game_ledger", {"key": "like.pirate:*", "select": "user_id,key",
                                                       "order": "user_id.asc,key.asc"}),
        hq=lambda: board.select_all("game_buildings", {"type": "eq.hq", "select": "user_id,level", "order": "user_id.asc"}),
        blds=lambda: board.select_all("game_buildings", {"type": "in.(yard,rodstore)",
                                                         "select": "user_id,type,level", "order": "user_id.asc,type.asc"}),
        led=lambda: board.select_all("game_ledger", {"select": "user_id,steel,rods", "order": "user_id.asc,key.asc"}),
        ships=lambda: board.select_all("game_ships", {"damage": "gt.0", "select": "user_id,damage", "order": "user_id.asc"}),
        users=lambda: board.select_all("users", {"role": "eq.student", "status": "eq.active", "select": "id,name", "order": "id.asc"}),
    )
    students = {u["id"]: u.get("name") or "" for u in got["users"]}
    per_day = {d: {"raid": 0, "pirate": 0} for d in days}
    for b in got["battles"]:
        t = game._dt(b.get("created_at"))
        d = t.astimezone(KST).date().isoformat() if t else None
        if d in per_day and b.get("kind") in ("raid", "pirate"):
            per_day[d][b["kind"]] += 1
    cleared: dict = {}
    for r in got["stars"]:
        if r["user_id"] not in students:
            continue
        parts = str(r["key"]).split(":")
        if len(parts) >= 3:
            cleared.setdefault(int(parts[1]), set()).add(r["user_id"])
    import game_battle as gb
    stages = [{"stage": i, "players": len(cleared.get(i, ()))} for i in range(1, len(gb.PIRATE_STAGES) + 1)]
    lv = [int(r.get("level") or 1) for r in got["hq"] if r["user_id"] in students]
    dist: dict = {}
    for v in lv:
        dist[v] = dist.get(v, 0) + 1
    # 창고: 사람마다 잔액과 창고 크기
    bal: dict = {}
    for r in got["led"]:
        b = bal.setdefault(r["user_id"], {"steel": 0, "rods": 0})
        b["steel"] += int(r.get("steel") or 0)
        b["rods"] += int(r.get("rods") or 0)
    blds: dict = {}
    for r in got["blds"]:
        blds.setdefault(r["user_id"], []).append(r)
    full, low = [], []
    for u in students:
        if u not in bal:
            continue
        cap = game.caps(blds.get(u, []))
        b = bal[u]
        if any(cap[k] and b[k] * 100 >= cap[k] * FULL_PCT for k in ("steel", "rods")):
            full.append(students[u])
        if b["steel"] < LOW["steel"] and b["rods"] < LOW["rods"]:
            low.append(students[u])
    hurt = {r["user_id"] for r in got["ships"] if r["user_id"] in students}
    return {"days": [{"day": d, **per_day[d]} for d in days], "stages": stages,
            "hq": {"avg": round(sum(lv) / len(lv), 1) if lv else 0, "dist": [{"level": k, "n": dist[k]} for k in sorted(dist)]},
            "players": len(lv), "full": {"n": len(full), "names": sorted(full)[:12]},
            "low": {"n": len(low), "names": sorted(low)[:12], "under": LOW},
            "repair": {"ships": sum(1 for r in got["ships"] if r["user_id"] in students), "players": len(hurt)},
            "full_pct": FULL_PCT}
