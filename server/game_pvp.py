"""G2c-3(게임): 교육생끼리 상륙 공격·보호막·방어 기록·복수.

원칙 (박사 승인 2026-11-28, G2c 계획안 https://claude.ai/artifact/M4UxyCQHotZ8N5LXWn3soR):
- 바다 지도에서 친구 섬을 정찰 → [작전 짜기] → 친구 조선소 지도에서 바닷길·상륙 부두·목표 순서 → 출동 전 3문제(사기) → 상륙 전투.
- 친구 조선소의 실제 건물·방어 시설로 싸운다. 방어 시설 힘 = 레벨 × 그 친구의 장 정답률 배수 (공부한 만큼 단단함).
- 사기: 출동 전 3문제(OX 2 + 객관식 1)를 맞힌 만큼 0.8배(0개) ~ 1.2배(3개). 전투함 공격력과 대원 힘에 곱함.
- 약탈: 상대 창고 강판·용접봉의 raid_loot_pct %(기본 20) × 별 비율(별 1개 40% · 2개 70% · 3개 100%).
  본관이 2레벨 이상 낮은 상대는 절반. 내 창고 자리만큼만 가져오고, 상대는 내가 가져온 만큼만 잃는다. 기술 포인트·건물은 안 뺏김.
  건물·배는 실제로 부서지지 않는다(전투 화면에서만 무너짐).
- 공정함: 관리자 스위치(raid_pvp), 오늘 매일 문제 다 푼 사람만(raid_need_daily), 하루 raid_day_max 번, 같은 친구 하루 1번,
  공격받은 조선소는 raid_shield_hours 시간 보호막, 수업 시간(평일)·밤 잠금(raid_time_lock), 같은 과정 끄기(raid_same_course).
- 방어하는 쪽: 방어 기록(누가·언제·어느 길·별·뺏긴 것), 다시 보기, 다음에 열면 웰디 알림, 막아 내면(별 0~1개) 용접봉+명성,
  복수 1번(규칙은 그대로 지킴), 웰디 한 줄 팁(규칙으로 계산, AI 안 씀).
- 숫자는 모두 예시. step19 SQL 필요 (game_bases.shield_until, game_battles.defender_id·defender_seen·revenge_used).
"""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import daily
import game
import game_raid
import manage
import store
import textbook
from game import _err, _iso, _lock, need_player

router = APIRouter()

MORALE_QUIZ = {"ox": 2, "mc": 1}
STAR_LOOT = (0, 0.4, 0.7, 1.0)         # 별 수 → 가져오는 비율
OPEN_SEA = 4                           # 친구 조선소 바다 오른쪽에 덧붙이는 넓은 바다 (배가 들어오는 길)
ATTACK_FAME = 5                        # 별 1개마다 명성
DEFEND_FAME = 5
_morale: dict[str, dict] = {}          # 푸는 중인 출동 전 3문제 (메모리)


def _today():
    return game._now().astimezone(game.KST).date().isoformat()


def morale_mult(right, total):
    if not total:
        return 1.0
    return round(0.8 + 0.4 * right / total, 2)


def time_locked(st, now=None):
    """수업 시간(평일)·밤이면 잠김 사유, 아니면 None."""
    if not st["raid_time_lock"]:
        return None
    t = (now or game._now()).astimezone(game.KST)
    h = t.hour
    a, b = int(st["raid_class_from"]), int(st["raid_class_to"])
    if t.weekday() < 5 and a < b and a <= h < b:
        return "class"
    na, nb = int(st["raid_night_from"]), int(st["raid_night_to"])
    if na != nb and ((na < nb and na <= h < nb) or (na > nb and (h >= na or h < nb))):
        return "night"
    return None


def shield_left(base, now=None):
    end = game._dt((base or {}).get("shield_until"))
    if not end:
        return 0
    return max(0, int((end - (now or game._now())).total_seconds()))


def _my_raids_today(uid):
    """오늘 내가 교육생을 공격한 기록 [{defender_id}] (step19 전이면 빈 목록)."""
    start = game._now().astimezone(game.KST).replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        return store.select("game_battles", {"user_id": f"eq.{uid}", "kind": "eq.raid", "created_at": f"gte.{_iso(start)}",
                                             "select": "defender_id"})
    except Exception as e:  # noqa: BLE001
        print("[pvp] 기록 못 읽음 (step19 전?)", str(e)[:120], flush=True)
        return []


def block_reason(me_id, target_id, st, target_base, same, today_rows=None, daily_done=None, now=None):
    """친구 조선소를 지금 공격할 수 없는 이유 (code, 덧붙일 값) — 없으면 (None, {})."""
    if target_id == me_id:
        return "self", {}
    if not st["raid_pvp"]:
        return "pvp_off", {}
    if same and not st["raid_same_course"]:
        return "same_course", {}
    why = time_locked(st, now)
    if why:
        return "time_lock", {"why": why, "class_from": st["raid_class_from"], "class_to": st["raid_class_to"],
                             "night_from": st["raid_night_from"], "night_to": st["raid_night_to"]}
    left = shield_left(target_base, now)
    if left:
        return "shield", {"left": left, "h": left // 3600, "m": (left % 3600) // 60}
    rows = _my_raids_today(me_id) if today_rows is None else today_rows
    if any(r.get("defender_id") == target_id for r in rows):
        return "same_today", {}
    mx = int(st["raid_day_max"])
    if mx and len(rows) >= mx:
        return "day_max", {"n": mx}
    if st["raid_need_daily"]:
        done = (_today() in game.daily_done_days(me_id)) if daily_done is None else daily_done
        if not done:
            return "need_daily", {}
    return None, {}


# ---- 친구 조선소 → 전투 지도 ----

def _lv(level):
    return 1 + 0.25 * (max(level, 1) - 1)


def battle_base(buildings, st, units, grid, sea):
    """친구 조선소 건물 → 상륙 전투 구조물 목록 (본관이 0번). 방어 시설 힘 = 레벨 × 장 정답률 배수.
    (레이더 강화는 전투 계산에서 따로 더하므로 여기 힘에는 안 넣음)"""
    blds = [b for b in buildings if int(b.get("level") or 0) >= 1]
    blds.sort(key=lambda b: (b["type"] != "hq", b.get("created_at") or "", b["id"]))
    out = []
    for b in blds:
        t = b["type"]
        w, h = game.BUILDINGS[t]["size"]
        lv = int(b["level"])
        o = {"id": len(out), "type": t, "level": lv, "x": b["x"], "y": b["y"], "w": w, "h": h, "dmg": 0, "range": 0}
        if t in game.DEFENSE_STATS:
            s = game.DEFENSE_STATS[t]
            _, u = game.defense_link(t, st, units)
            _, mult = game.chapter_mult(u)
            o["hp"] = max(1, int(s["hp"] * _lv(lv) * (mult if t == "wall" else 1))) if s["hp"] else 1
            o["dmg"] = s["dmg"] * _lv(lv) * mult
            o["range"] = s["range"]
        elif t == "hq":
            o["hp"] = 300 + 150 * lv
        else:
            o["hp"] = 150 + 60 * lv
        o["max"] = o["hp"]
        out.append(o)
    if not out or out[0]["type"] != "hq":   # 본관이 없을 수는 없지만, 계산이 깨지지 않게
        out.insert(0, {"id": 0, "type": "hq", "level": 1, "x": 0, "y": 0, "w": 3, "h": 3, "dmg": 0, "range": 0, "hp": 450, "max": 450})
        for i, o in enumerate(out):
            o["id"] = i
    mh = grid
    mp = {"w": grid + sea + OPEN_SEA, "h": mh, "land": grid,
          "lanes": {"north": round(mh * 0.2, 1), "middle": round(mh / 2, 1), "south": round(mh * 0.8, 1)}}
    return out, mp


def _target(me, target_id, st):
    """상대 정보 한꺼번에: (사용자, base, 건물, 장부, 내 건물, 같은 과정, 장 목록)."""
    rows = store.select("users", {"id": f"eq.{target_id}", "select": "id,name,role,status"})
    if not rows or rows[0]["role"] != "student" or rows[0].get("status") == "deleted":
        _err(404, "not_found")
    got = game._par(base=lambda: store.select("game_bases", {"user_id": f"eq.{target_id}", "select": "*"}),
                    blds=lambda: game._buildings(target_id), rows=lambda: game.ledger(target_id),
                    mine=lambda: game._buildings(me["id"]),
                    mc=lambda: manage.course_ids_of(me["id"]), tc=lambda: manage.course_ids_of(target_id),
                    prog=lambda: game.unit_progress(target_id, st))
    if not got["base"]:
        _err(404, "not_found")
    return {"user": rows[0], "base": got["base"][0], "blds": got["blds"], "rows": got["rows"], "mine": got["mine"],
            "same": bool(got["mc"] & got["tc"]), "units": got["prog"][1]}


def need_sql19():
    """step19 SQL(방어 기록·보호막 칸)을 돌렸는지 먼저 확인 (안 돌렸으면 need_sql19)."""
    game._sql17(lambda: store.select("game_battles", {"select": "defender_id,defender_seen,revenge_used", "limit": "1"}),
                code="need_sql19")
    game._sql17(lambda: store.select("game_bases", {"select": "shield_until", "limit": "1"}), code="need_sql19")


def _hq_lv(blds):
    return max([int(b["level"]) for b in blds if b["type"] == "hq"] or [1])


def loot_full(tg):
    st = game.settings()
    bal = game.balance(tg["rows"])
    half = _hq_lv(tg["blds"]) <= _hq_lv(tg["mine"]) - 2
    pct = int(st["raid_loot_pct"]) / 100
    return {k: int(max(0, bal[k]) * pct * (0.5 if half else 1)) for k in ("steel", "rods")}, half


@router.get("/game/raid/target/{target_id}")
def raid_target(target_id: str, user=Depends(need_player)):
    """작전 짜기에 쓸 친구 조선소 지도 + 지금 공격할 수 있는지."""
    try:
        uuid.UUID(target_id)
    except ValueError:
        _err(404, "not_found")
    st = game.settings()
    need_sql19()
    tg = _target(user, target_id, st)
    base, mp = battle_base(tg["blds"], st, tg["units"], game.grid_of(tg["base"]), game.sea_of(tg["base"]))
    code, extra = block_reason(user["id"], target_id, st, tg["base"], tg["same"])
    loot, half = loot_full(tg)
    return {"id": target_id, "name": tg["user"].get("name") or "", "hq": _hq_lv(tg["blds"]),
            "base": [{k: o[k] for k in ("id", "type", "level", "x", "y", "w", "h")} for o in base], "map": mp,
            "loot": loot, "loot_half": half, "same": tg["same"], "block": code, "block_info": extra,
            "morale": sum(MORALE_QUIZ.values()),
            "guards": {k: v for k, v in game_raid.available(game_raid.get_crews(tg["base"])).items() if v}}


# ---- 출동 전 3문제 (사기) ----

class LangBody(BaseModel):
    lang: str = "ko"


@router.post("/game/raid/morale/start")
def morale_start(body: LangBody, user=Depends(need_player)):
    uid = user["id"]
    lang = daily._lang(body.lang)
    book = textbook.current_book()
    if not book:
        _err(400, "no_questions")
    rows = game.ledger(uid)
    with _lock(uid):
        seen = game.game_seen(uid, rows)
    picked, _ = game.pick_supply(book, MORALE_QUIZ, seen, kinds=list(MORALE_QUIZ))
    if not picked:
        _err(400, "no_questions")
    daily.ensure_translations(picked, lang)
    mid = str(uuid.uuid4())
    now = game._now()
    with _lock(uid):
        _morale[uid] = {"id": mid, "qids": [q["id"] for q in picked], "lang": lang, "book_id": book["id"]}
        opened = game._supply_open.setdefault(uid, {})
        for q in picked:
            opened[q["id"]] = now
    off = book.get("page_offset") or 0
    return {"id": mid, "total": len(picked), "questions": [daily._public(q, None, lang, off) for q in picked]}


# ---- 공격 ----

class RaidBody(BaseModel):
    target: str
    ships: list[str]
    lane: str = "middle"
    landing: int
    order: list[int] = []
    crews: dict[str, int] = {}
    morale_id: str = ""
    answers: dict[str, str | int] = {}
    revenge: str | None = None       # 복수: 내가 방어한 전투 id


def _pair_locks(a, b):
    first, second = sorted([a, b])
    return _lock(first), _lock(second)


@router.post("/game/raid/attack")
def raid_attack(body: RaidBody, user=Depends(need_player)):
    uid = user["id"]
    if body.lane not in ("north", "middle", "south"):
        _err(400, "bad_plan")
    try:
        uuid.UUID(body.target)
    except ValueError:
        _err(404, "not_found")
    st = game.settings()
    need_sql19()
    # 먼저 지금 공격할 수 있는지 (막히면 3문제를 버리지 않게 채점 전에)
    tg0 = _target(user, body.target, st)
    code, extra = block_reason(uid, body.target, st, tg0["base"], tg0["same"])
    if code:
        _err(400, "raid_" + code, **extra)
    # 출동 전 3문제 채점 (틀려도 문제는 푼 것으로 기록)
    with _lock(uid):
        mo = _morale.get(uid)
        if not mo or mo["id"] != body.morale_id:
            _err(400, "exam_gone")
        _morale.pop(uid, None)
    results, right, _ = game._grade_all(mo["qids"], body.answers, mo["lang"])
    game._record_answers(uid, mo.get("book_id"), results, "morale")
    opened = game._supply_open.get(uid, {})
    for q in mo["qids"]:
        opened.pop(q, None)
    mult = morale_mult(right, len(results))
    game.mark_todo(uid, "battle")
    revenge = None
    if body.revenge:
        try:
            rv = store.select("game_battles", {"id": f"eq.{body.revenge}", "select": "id,user_id,defender_id,revenge_used"})
        except Exception:  # noqa: BLE001
            rv = []
        if not rv or rv[0].get("defender_id") != uid or rv[0]["user_id"] != body.target or rv[0].get("revenge_used"):
            _err(400, "revenge_used")
        revenge = rv[0]["id"]
    la, lb = _pair_locks(uid, body.target)
    with la, lb:
        now = game._now()
        tg = _target(user, body.target, st)
        code, extra = block_reason(uid, body.target, st, tg["base"], tg["same"], now=now)
        if code:
            _err(400, "raid_" + code, **extra)
        base, buildings = game._prep(uid, now)
        fleet = {f["id"]: f for f in game._fleet(uid)}
        picked = [fleet[i] for i in dict.fromkeys(body.ships) if i in fleet]
        if not picked:
            _err(400, "no_ships")
        if any(int(f.get("damage") or 0) or f.get("repair_until") for f in picked):
            _err(400, "ship_damaged")
        wl = game.weapon_levels(base)
        ships = []
        for f in picked:
            ws = game.warship_stats(f, wl)
            ships.append({"id": f["id"], "kind": f["kind"], "max_hp": ws["max_hp"], "attack": ws["attack"] * mult,
                          "weapons": ws["weapons"]})
        tbase, mp = battle_base(tg["blds"], st, tg["units"], game.grid_of(tg["base"]), game.sea_of(tg["base"]))
        if not 0 <= body.landing < mp["h"]:
            _err(400, "bad_plan")
        have = game_raid.get_crews(base)
        free = game_raid.available(have)
        send = {k: max(0, int(body.crews.get(k, 0) or 0)) for k in game_raid.CREW_KINDS}
        if any(send[k] > free[k] for k in send):
            _err(400, "crew_short")
        if game_raid.seats_of(send) > game_raid.ship_capacity(ships):
            _err(400, "crew_room", n=game_raid.ship_capacity(ships))
        tcrews = game_raid.get_crews(tg["base"], now)
        guards = game_raid.available(tcrews)
        res = game_raid.simulate_raid(tbase, ships, body.lane, body.landing, body.order, send, mp["w"], mp["h"], mp["land"],
                                      mp["lanes"], {"stage": 0}, crew_mult=mult, defenders=guards)
        if any(res["guard_lost"].values()):   # 방어하다 쓰러진 대원은 부상 → 정한 시간 뒤 돌아옴
            game_raid.add_hurt(tcrews, res["guard_lost"], int(st["crew_hurt_minutes"]), now)
            game_raid._save_crews(body.target, tcrews)
        for s in res["ships"]:        # 보여 줄 공격력은 원래 값으로
            s.pop("attack", None)
        res["note"] = game_raid.raid_note(res)
        if any(res["crew_lost"].values()):
            for k, v in res["crew_lost"].items():
                have[k] = max(0, have[k] - v)
            game_raid._save_crews(uid, have)
        for s in res["ships"]:
            dmg = s["max_hp"] - s["hp"]
            if dmg > 0:
                game._sql17(lambda s=s, dmg=dmg: store.patch("game_ships", {"id": f"eq.{s['id']}"}, {"damage": dmg}))
        # 약탈: 별 비율만큼, 내 창고 자리만큼 (상대는 내가 가져온 만큼만 잃음)
        full, half = loot_full(tg)
        share = STAR_LOOT[res["stars"]]
        want = {k: int(full[k] * share * (1 + ((res.get("loot_bonus") or 0) if res["stars"] else 0))) for k in full}
        mine_bal = game.balance(game.ledger(uid))
        take = game.clip_storage(want, mine_bal, game.caps(buildings))
        bid = str(uuid.uuid4())
        got = {"steel": take["steel"], "rods": take["rods"], "tech": 0, "fame": ATTACK_FAME * res["stars"]}
        if any(got.values()):
            game._add(uid, [{"key": f"raid:{bid}", **got, "note": "raid"}])
        if take["steel"] or take["rods"]:
            game._add(body.target, [{"key": f"raided:{bid}", "steel": -take["steel"], "rods": -take["rods"], "note": "raided"}])
        # 막아 냄 보상 (상대 별 0~1개)
        defend = {"rods": 0, "fame": 0}
        if res["stars"] <= 1:
            tcap = game.caps(tg["blds"])
            tbal = game.balance(tg["rows"])
            tbal = {**tbal, "steel": tbal["steel"] - take["steel"], "rods": tbal["rods"] - take["rods"]}
            room = game.clip_storage({"rods": int(st["raid_defend_rods"])}, tbal, tcap)
            defend = {"rods": room.get("rods", 0), "fame": DEFEND_FAME}
            game._add(body.target, [{"key": f"defend:{bid}", **defend, "note": "defend"}])
        # 보호막
        shield_until = now + timedelta(hours=int(st["raid_shield_hours"]))
        if st["raid_shield_hours"]:
            game._sql17(lambda: store.patch("game_bases", {"user_id": f"eq.{body.target}"}, {"shield_until": _iso(shield_until)}),
                        code="need_sql19")
        res.update({"id": bid, "kind": "raid", "got": got, "lost": {"steel": take["steel"], "rods": take["rods"]},
                    "defend": defend, "loot_half": half, "first_stars": 0, "hurt_minutes": int(st["crew_hurt_minutes"]),
                    "morale": {"right": right, "total": len(results), "mult": mult},
                    "attacker": {"id": uid, "name": user.get("name") or ""},
                    "defender": {"id": body.target, "name": tg["user"].get("name") or ""}, "revenge": bool(revenge)})
        game._sql17(lambda: store.insert_rows("game_battles", [{"id": bid, "user_id": uid, "kind": "raid", "stage": 0,
                                                                 "stars": res["stars"], "result": res, "defender_id": body.target,
                                                                 "defender_seen": False, "revenge_used": False,
                                                                 "created_at": _iso(now)}],
                                               returning=False), code="need_sql19")
        if revenge:
            game._sql17(lambda: store.patch("game_battles", {"id": f"eq.{revenge}"}, {"revenge_used": True}), code="need_sql19")
    return {"battle": res, "results": results, "state": game._fresh(user)}


# ---- 방어 기록 ----

def defense_tip(log):
    """방어 기록으로 웰디 한 줄 (규칙). 같은 길로 2번 이상 뚫렸으면 그 길을 알려 줌."""
    lost = [b for b in log if b["stars"] >= 2]
    if not log:
        return {"id": "none"}
    if not lost:
        return {"id": "strong"}
    lanes = {}
    for b in lost:
        lanes[b["lane"]] = lanes.get(b["lane"], 0) + 1
    lane, n = max(lanes.items(), key=lambda kv: (kv[1], kv[0]))
    if n >= 2:
        return {"id": "lane", "lane": lane, "n": n}
    return {"id": "more"}


@router.get("/game/defense")
def defense_log(user=Depends(need_player)):
    uid = user["id"]
    try:
        rows = store.select("game_battles", {"defender_id": f"eq.{uid}", "kind": "eq.raid",
                                             "select": "id,user_id,stars,created_at,result,defender_seen,revenge_used",
                                             "order": "created_at.desc", "limit": "20"})
    except Exception as e:  # noqa: BLE001
        print("[pvp] 방어 기록 못 읽음 (step19 전?)", str(e)[:120], flush=True)
        return {"log": [], "unseen": 0, "tip": {"id": "none"}, "shield": 0, "ready": False}
    st = game.settings()
    base, _ = game._base(uid)
    today_rows = None
    log = []
    for r in rows:
        res = r.get("result") or {}
        item = {"id": r["id"], "at": r.get("created_at"), "stars": r["stars"], "pct": res.get("pct"),
                "lane": res.get("lane"), "by": (res.get("attacker") or {}).get("name") or "",
                "by_id": r["user_id"], "lost": res.get("lost") or {}, "defend": res.get("defend") or {},
                "seen": bool(r.get("defender_seen")), "revenge_used": bool(r.get("revenge_used"))}
        if not item["revenge_used"]:
            if today_rows is None:
                today_rows = _my_raids_today(uid)
            tb = store.select("game_bases", {"user_id": f"eq.{r['user_id']}", "select": "shield_until"})
            same = bool(manage.course_ids_of(uid) & manage.course_ids_of(r["user_id"]))
            code, extra = block_reason(uid, r["user_id"], st, tb[0] if tb else {}, same, today_rows=today_rows)
            item["revenge_block"] = code
            item["revenge_info"] = extra
        log.append(item)
    return {"log": log, "unseen": sum(1 for b in log if not b["seen"]), "tip": defense_tip(log),
            "shield": shield_left(base), "ready": True}


@router.post("/game/defense/seen")
def defense_seen(user=Depends(need_player)):
    game._sql17(lambda: store.patch("game_battles", {"defender_id": f"eq.{user['id']}", "defender_seen": "eq.false"},
                                    {"defender_seen": True}), code="need_sql19")
    return {"ok": True}
