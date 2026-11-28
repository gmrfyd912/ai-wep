"""G2c-1(게임): 전체 바다 지도·정찰.

원칙 (박사 승인 2026-11-28, G2c 계획안 https://claude.ai/artifact/M4UxyCQHotZ8N5LXWn3soR):
- 바다 지도 하나에 과정(반)마다 '만'이 있고, 교육생 조선소는 자기 과정 만 안의 섬으로 보인다.
  과정이 없는 교육생은 '무소속' 만. 여러 과정이면 첫 과정 만.
- 해적 기지 6단계도 지도 위 섬으로 옮긴다. 1~4단계는 과정 만 가장자리에(날마다 자리가 바뀜), 5·6단계는 한가운데 넓은 바다에.
- 섬을 누르면 정찰: 공격권을 쓰지 않고, 하루 정찰 횟수만 센다(같은 날 같은 섬을 다시 보면 안 셈).
  정찰로 보이는 것: 조선소 배치(땅 크기·건물·방어 시설 레벨), 본관 레벨, 방어 힘 합계, 가져올 수 있는 자원(예상), 웰디 한마디.
  방어 시설의 '정답률 배수'(남의 공부 성적)는 보여 주지 않는다.
- 같은 과정 동료도 기본으로 공격 대상(박사 결정 2026-11-28). 관리자 설정 raid_same_course 로 끌 수 있다.
  약탈은 창고 강재·용접봉의 raid_loot_pct %(기본 20). 본관이 2레벨 이상 낮은 상대는 절반.
- 교육생끼리 실제 공격은 game_pvp.py (정찰 창의 [작전 짜기] → 친구 조선소 작전 짜기).
- 숫자는 모두 예시.
"""
import math
import threading

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import game
import game_battle
import game_pvp
import game_raid
import manage
import store
from game import _err, need_player

router = APIRouter()

MAP_W, MAP_H = 1200, 800
BAY_R = 120                     # 만 크기 (지도 단위)
ISLAND_GAP = 24                 # 섬 사이 간격
NO_COURSE = "none"
_scouts: dict[str, dict] = {}   # 사람별 오늘 정찰한 섬 {"day": "2026-11-28", "seen": set()} (메모리)
_scout_lock = threading.Lock()


# ---- 힘 점수 (색깔·비교용, 정답률 배수 없이 레벨만) ----

def _lvm(level):
    return 1 + 0.25 * (max(int(level or 1), 1) - 1)


def base_score(buildings):
    """조선소 방어 힘 점수 = 방어 시설 (체력 + 공격×5)×레벨 + 본관 레벨×100."""
    s = 0.0
    for b in buildings:
        lv = int(b.get("level") or 0)
        if lv < 1:
            continue
        if b["type"] == "hq":
            s += 100 * lv
        st = game.DEFENSE_STATS.get(b["type"])
        if st:
            s += (st["hp"] + st["dmg"] * 5) * _lvm(lv)
    return int(round(s))


def pirate_score(stage_no):
    s = 0.0
    for o in game_battle.pirate_base(stage_no):
        s += o["hp"] + o["dmg"] * 5 if o["type"] != "hq" else o["hp"] + 100 * stage_no
    return int(round(s))


def tier(score, mine):
    """상대 힘 / 내 힘 → easy(쉬움) · even(비슷) · hard(강함)."""
    r = score / max(mine, 1)
    return "easy" if r < 0.7 else "hard" if r > 1.3 else "even"


# ---- 지도 배치 ----

def _bay_xy(i, n):
    a = -math.pi / 2 + 2 * math.pi * i / max(n, 1)
    return MAP_W / 2 + 420 * math.cos(a), MAP_H / 2 + 250 * math.sin(a), a


def _slot(k):
    """만 가운데에서 해바라기 씨처럼 퍼지는 k번째 자리 (겹치지 않게)."""
    a = k * 2.39996
    r = ISLAND_GAP * math.sqrt(k + 0.3)
    return r * math.cos(a), r * math.sin(a)


def _day_no(today=None):
    return (today or game._now().astimezone(game.KST).date()).toordinal()


def layout(bays, members, today=None):
    """bays = [{"id","name"}] (순서대로), members = {bay id: [user id, …]} → 만·섬·해적 자리.
    같은 입력·같은 날이면 늘 같은 자리."""
    n = len(bays)
    out_bays, spots = [], {}
    for i, b in enumerate(bays):
        x, y, a = _bay_xy(i, n)
        ids = sorted(members.get(b["id"], []))
        # 만 이름은 바깥쪽(지도 가장자리 쪽)에 — 안쪽 가장자리에는 해적 섬이 옴
        lx = min(MAP_W - 60, max(60, x + math.cos(a) * (BAY_R + 16)))
        ly = min(MAP_H - 8, max(18, y + math.sin(a) * (BAY_R + 16)))
        out_bays.append({"id": b["id"], "name": b["name"], "x": round(x), "y": round(y), "r": BAY_R, "angle": a,
                         "lx": round(lx), "ly": round(ly)})
        for k, uid in enumerate(ids):
            dx, dy = _slot(k)
            spots[uid] = (round(x + dx), round(y + dy))
    pirates = []
    day = _day_no(today)
    per_bay: dict[int, int] = {}
    for stage in range(1, len(game_battle.PIRATE_STAGES) + 1):
        if stage <= 4 and n:
            bi = (stage - 1 + day) % n
            k = per_bay.get(bi, 0)
            per_bay[bi] = k + 1
            bx, by, a = _bay_xy(bi, n)
            # 만 바깥쪽(지도 가운데 쪽) 가장자리, 같은 만에 둘 이상이면 옆으로 비켜서
            side = (k - 0.5) * 0.5 if k else 0
            px = bx - math.cos(a + side) * (BAY_R + 30)
            py = by - math.sin(a + side) * (BAY_R + 30)
        else:
            px = MAP_W / 2 + (stage - 5.5) * 160 if stage >= 5 else MAP_W / 2 + (stage - 2.5) * 90
            py = MAP_H / 2 + (0 if stage >= 5 else 70)
        pirates.append({"stage": stage, "x": round(px), "y": round(py)})
    for b in out_bays:
        b.pop("angle")
    return out_bays, spots, pirates


def _course_of(cids, order):
    """여러 과정이면 순서가 가장 앞인 과정."""
    best = None
    for c in cids:
        if c in order and (best is None or order[c] < order[best]):
            best = c
    return best


def _world():
    """지도에 필요한 것 모두 (동시에 받기): 교육생·과정·조선소·건물."""
    got = game._par(
        users=lambda: store.select("users", {"role": "eq.student", "status": "eq.active", "select": "id,name"}),
        courses=lambda: store.select("courses", {"active": "eq.true", "select": "id,name,sort", "order": "sort.asc,name.asc"}),
        links=lambda: store.select("user_courses", {"select": "user_id,course_id"}),
        bases=_bases,
        builds=lambda: store.select("game_buildings", {"type": f"in.(hq,{','.join(game.DEFENSE_TYPES)})",
                                                       "select": "user_id,type,level"}),
    )
    return got


def _bases():
    """모든 조선소 (보호막 시각 포함, step19 전이면 보호막 없이)."""
    try:
        return store.select("game_bases", {"select": "user_id,reclaim,shield_until"})
    except Exception:  # noqa: BLE001
        return store.select("game_bases", {"select": "user_id,reclaim"})


def sea_view(user):
    uid = user["id"]
    st = game.settings()
    w = _world()
    names = {u["id"]: u.get("name") or "" for u in w["users"]}
    names.setdefault(uid, user.get("name") or "")
    has_base = {b["user_id"] for b in w["bases"]}
    shields = {b["user_id"]: game_pvp.shield_left(b) for b in w["bases"]}
    players = [i for i in names if i in has_base or i == uid]
    order = {c["id"]: i for i, c in enumerate(w["courses"])}
    cids: dict[str, set] = {}
    for l in w["links"]:
        cids.setdefault(l["user_id"], set()).add(l["course_id"])
    course = {p: _course_of(cids.get(p, set()), order) or NO_COURSE for p in players}
    bays = [{"id": c["id"], "name": c["name"]} for c in w["courses"] if any(course[p] == c["id"] for p in players)]
    if any(course[p] == NO_COURSE for p in players):
        bays.append({"id": NO_COURSE, "name": ""})
    members: dict[str, list] = {}
    for p in players:
        members.setdefault(course[p], []).append(p)
    out_bays, spots, pirate_spots = layout(bays, members)
    blds: dict[str, list] = {}
    for b in w["builds"]:
        blds.setdefault(b["user_id"], []).append(b)
    my_score = base_score(blds.get(uid, []))
    my_courses = cids.get(uid, set())
    same_ok = bool(st["raid_same_course"])
    islands = []
    for p in players:
        if p not in spots:
            continue
        sc = base_score(blds.get(p, []))
        hq = max([int(b["level"]) for b in blds.get(p, []) if b["type"] == "hq"] or [1])
        same = bool(cids.get(p, set()) & my_courses)
        islands.append({"id": p, "name": names.get(p, ""), "course": course[p], "x": spots[p][0], "y": spots[p][1],
                        "hq": hq, "score": sc, "tier": tier(sc, my_score), "me": p == uid, "same": same,
                        "attackable": p != uid and (same_ok or not same), "shield": shields.get(p, 0)})
    rows = game.ledger(uid)
    best = game_battle._stage_best(rows)
    pirates = []
    for sp in pirate_spots:
        no = sp["stage"]
        sc = pirate_score(no)
        pirates.append({**sp, "stars": best.get(no, 0), "open": no == 1 or best.get(no - 1, 0) >= 1,
                        "score": sc, "tier": tier(sc, my_score)})
    used, mx = scouts_left(uid, st)
    return {"size": {"w": MAP_W, "h": MAP_H}, "bays": out_bays, "islands": islands, "pirates": pirates,
            "me": {"id": uid, "course": course.get(uid, NO_COURSE), "score": my_score},
            "scouts": {"used": used, "max": mx}, "same_course_ok": same_ok, "loot_pct": int(st["raid_loot_pct"]),
            "raid_open": bool(st["raid_pvp"])}


@router.get("/game/sea")
def sea(user=Depends(need_player)):
    return sea_view(user)


# ---- 정찰 ----

def _today_iso():
    return game._now().astimezone(game.KST).date().isoformat()


def scouts_left(uid, st):
    with _scout_lock:
        s = _scouts.get(uid)
        used = len(s["seen"]) if s and s["day"] == _today_iso() else 0
    return used, int(st["scout_day_max"])


def _seen(uid, key):
    with _scout_lock:
        s = _scouts.get(uid)
        return bool(s and s["day"] == _today_iso() and key in s["seen"])


def _count_scout(uid, key, st):
    """오늘 처음 보는 섬이면 1번 셈. 한도를 넘으면 막음 (0 = 무제한)."""
    mx = int(st["scout_day_max"])
    with _scout_lock:
        day = _today_iso()
        s = _scouts.get(uid)
        if not s or s["day"] != day:
            s = _scouts[uid] = {"day": day, "seen": set()}
        if key in s["seen"]:
            return len(s["seen"])
        if mx and len(s["seen"]) >= mx:
            _err(400, "scout_limit", n=mx)
        s["seen"].add(key)
        return len(s["seen"])


class ScoutBody(BaseModel):
    kind: str          # pirate | user
    id: str            # 해적 단계 번호 또는 교육생 id


def _counts(items):
    out = {}
    for o in items:
        if o["type"] in game.DEFENSE_TYPES:
            out[o["type"]] = out.get(o["type"], 0) + 1
    return out


def scout_pirate(uid, stage, st):
    base, _ = game._base(uid)
    rows = game.ledger(uid)
    best = game_battle._stage_best(rows)
    if stage > 1 and best.get(stage - 1, 0) < 1:
        _err(400, "stage_locked")
    fleet = [f for f in game._fleet(uid) if not int(f.get("damage") or 0) and not f.get("repair_until")]
    wl = game.weapon_levels(base)
    ships = []
    for f in fleet[:6]:
        ws = game.warship_stats(f, wl)
        ships.append({"id": f["id"], "kind": f["kind"], "max_hp": ws["max_hp"], "attack": ws["attack"], "weapons": ws["weapons"]})
    # 예상 별: 지금 출격할 수 있는 전투함 모두로 길·목표를 바꿔 가며 가장 잘 나온 경우 (정확한 결과는 안 알려 줌)
    expect = 0
    if ships:
        for lane in game_battle.LANES:
            for target in ("defense", "hq"):
                expect = max(expect, game_battle.simulate(stage, ships, lane, target)["stars"])
    items = game_battle.pirate_base(stage)
    prev = best.get(stage, 0)
    rw = game_battle.PIRATE_STAGES[stage - 1]["reward"]
    left = {k: 0 for k in rw}
    for star in range(prev + 1, 4):
        for k in left:
            left[k] += int(rw[k] * game_battle.STAR_SHARE[star - 1])
    tip = "pirate_noships" if not ships else "pirate_win" if expect >= 3 else "pirate_hard" if expect == 0 else "pirate_try"
    return {"kind": "pirate", "id": str(stage), "stage": stage, "hq": stage, "score": pirate_score(stage),
            "grid": {"w": game_battle.MAP_W, "h": game_battle.MAP_H, "land": game_battle.LAND_W},
            "buildings": [{"type": o["type"], "level": o["level"], "x": o["x"], "y": o["y"], "w": o["w"], "h": o["h"]} for o in items],
            "counts": _counts(items), "loot": left, "stars": prev, "expect": expect, "ships": len(ships),
            "guards": game_raid.PIRATE_CREWS.get(stage, {}),
            "tip": tip}


def scout_user(me, target, st):
    uid = me["id"]
    if target == uid:
        _err(400, "scout_self")
    rows = store.select("users", {"id": f"eq.{target}", "select": "id,name,role,status"})
    if not rows or rows[0]["role"] != "student":
        _err(404, "not_found")
    got = game._par(base=lambda: store.select("game_bases", {"user_id": f"eq.{target}", "select": "*"}),
                    blds=lambda: game._buildings(target), rows=lambda: game.ledger(target),
                    mine=lambda: game._buildings(uid),
                    mc=lambda: manage.course_ids_of(uid), tc=lambda: manage.course_ids_of(target))
    if not got["base"]:
        _err(404, "not_found")
    base = got["base"][0]
    blds = [b for b in got["blds"] if int(b.get("level") or 0) >= 1 or b["type"] in game.DEFENSE_TYPES]
    same = bool(got["mc"] & got["tc"])
    hq = max([int(b["level"]) for b in blds if b["type"] == "hq"] or [1])
    my_hq = max([int(b["level"]) for b in got["mine"] if b["type"] == "hq"] or [1])
    bal = game.balance(got["rows"])
    pct = int(st["raid_loot_pct"]) / 100
    half = hq <= my_hq - 2
    loot = {k: int(max(0, bal[k]) * pct * (0.5 if half else 1)) for k in ("steel", "rods")}
    sc, my_sc = base_score(blds), base_score(got["mine"])
    tr = tier(sc, my_sc)
    attackable = st["raid_same_course"] or not same
    block, block_info = game_pvp.block_reason(uid, target, st, base, same)
    items = []
    for b in blds:
        w, h = game.BUILDINGS[b["type"]]["size"]
        items.append({"type": b["type"], "level": int(b.get("level") or 0), "x": b["x"], "y": b["y"], "w": w, "h": h})
    return {"kind": "user", "id": target, "name": rows[0].get("name") or "", "hq": hq, "score": sc, "tier": tr,
            "grid": {"w": game.grid_of(base), "h": game.grid_of(base), "sea": game.sea_of(base)},
            "buildings": items, "counts": _counts(blds), "loot": loot, "loot_half": half, "same": same,
            "attackable": bool(attackable), "raid_open": bool(st["raid_pvp"]), "block": block, "block_info": block_info,
            "shield": game_pvp.shield_left(base),
            "guards": {k: v for k, v in game_raid.available(game_raid.get_crews(base)).items() if v},
            "tip": "user_weak" if half else "user_hard" if tr == "hard" else "user_easy" if tr == "easy" else "user_even"}


@router.post("/game/sea/scout")
def scout(body: ScoutBody, user=Depends(need_player)):
    st = game.settings()
    # 먼저 정찰 결과를 만들고(없는 섬이면 여기서 막힘), 그다음 오늘 횟수를 셈
    if body.kind == "pirate":
        try:
            stage = int(body.id)
        except ValueError:
            stage = 0
        if not 1 <= stage <= len(game_battle.PIRATE_STAGES):
            _err(400, "bad_stage")
        used, mx = scouts_left(user["id"], st)
        if mx and used >= mx and not _seen(user["id"], f"pirate:{stage}"):
            _err(400, "scout_limit", n=mx)
        res = scout_pirate(user["id"], stage, st)
        used = _count_scout(user["id"], f"pirate:{stage}", st)
    elif body.kind == "user":
        used, mx = scouts_left(user["id"], st)
        if mx and used >= mx and not _seen(user["id"], f"user:{body.id}"):
            _err(400, "scout_limit", n=mx)
        res = scout_user(user, body.id, st)
        used = _count_scout(user["id"], f"user:{body.id}", st)
    else:
        _err(400, "bad_kind")
    res["scouts"] = {"used": used, "max": int(st["scout_day_max"])}
    return res
