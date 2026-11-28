"""G2b-2(게임): 해적 기지 연습 전투·다시 보기·전투함 수리·태풍 대비 훈련.

원칙 (박사 승인 2026-11-28, G2 계획안 v2 https://claude.ai/artifact/Uz22bbfiiBVUkzEffRMnV3):
- 다른 교육생을 공격하기 전에, 컴퓨터가 만든 '해적 기지'(6단계)와 연습 전투를 한다.
- 전투는 서버가 자동으로 계산하고(같은 입력이면 늘 같은 결과), 앱은 기록(frames)을 받아 다시 보여 준다.
  내가 정하는 것: 출격할 전투함, 들어갈 길(북·가운데·남), 먼저 칠 목표(방어 시설 / 해적 본부).
- 별: 50% 이상 부수면 1개, 해적 본부를 부수면 1개 더, 모두 부수면 3개. 단계마다 별을 처음 딸 때만 보상 (같은 별로 두 번 안 받음).
- 전투함은 침몰하지 않고 파손된다. 다친 만큼 용접봉 + 시간으로 수리 (기술 포인트·즉시 완료권으로 당길 수 있음).
  수리가 끝난 전투함만 출격할 수 있다.
- 태풍 대비 훈련: 하루 한 번. 안전 문제 3개 + 방파 장벽(레벨 합)으로 '막아 낸 정도'를 계산해 그만큼 보상.
- 숫자는 모두 예시. step17 SQL 필요 (game_ships.damage·repair_until, game_battles).
"""
import math
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import daily
import game
import game_raid
import store
import textbook
from game import _err, _iso, _lock, need_player

router = APIRouter()

# ---- 해적 기지 (컴퓨터가 만든 연습 상대) ----
# 땅 x 0~5, 바다 x 6~13, 높이 0~9. 본부는 (2,4) 2×2. 각 시설: (종류, 레벨, x, y)
LAND_W = 6
MAP_W, MAP_H = 14, 10
LANES = {"north": 2.0, "middle": 5.0, "south": 8.0}
PIRATE_STAGES = [
    {"power": 0.45, "hq_hp": 350, "reward": {"steel": 400, "rods": 200, "tech": 10, "fame": 10},
     "defs": [("battery", 1, 5, 2), ("hut", 1, 3, 1), ("hut", 1, 3, 8)]},
    {"power": 0.55, "hq_hp": 450, "reward": {"steel": 600, "rods": 300, "tech": 15, "fame": 15},
     "defs": [("battery", 1, 5, 2), ("battery", 1, 5, 7), ("hut", 1, 3, 1), ("hut", 1, 3, 8),
              ("mine", 1, 8, 5), ("mine", 1, 9, 2), ("wall", 1, 6, 4), ("wall", 1, 6, 5)]},
    {"power": 0.65, "hq_hp": 600, "reward": {"steel": 900, "rods": 450, "tech": 20, "fame": 20},
     "defs": [("battery", 2, 5, 2), ("battery", 2, 5, 7), ("missile", 1, 2, 1), ("hut", 1, 4, 1), ("hut", 1, 3, 8),
              ("mine", 1, 8, 5), ("mine", 1, 9, 2), ("mine", 1, 9, 8),
              ("wall", 1, 6, 3), ("wall", 1, 6, 4), ("wall", 1, 6, 5), ("wall", 1, 6, 6)]},
    {"power": 0.75, "hq_hp": 800, "reward": {"steel": 1300, "rods": 650, "tech": 30, "fame": 30},
     "defs": [("battery", 2, 5, 1), ("battery", 2, 5, 5), ("battery", 2, 5, 8), ("missile", 2, 2, 1), ("radar", 1, 3, 7),
              ("hut", 1, 3, 0), ("mine", 1, 8, 2), ("mine", 1, 8, 5), ("mine", 1, 8, 8), ("mine", 1, 10, 5),
              ("wall", 1, 6, 2), ("wall", 1, 6, 3), ("wall", 1, 6, 4), ("wall", 1, 6, 5), ("wall", 1, 6, 6), ("wall", 1, 6, 7)]},
    {"power": 0.85, "hq_hp": 1000, "reward": {"steel": 1800, "rods": 900, "tech": 40, "fame": 40},
     "defs": [("battery", 3, 5, 1), ("battery", 3, 5, 5), ("battery", 3, 5, 8), ("missile", 2, 2, 2), ("missile", 2, 2, 7),
              ("radar", 2, 3, 6), ("asw", 1, 4, 0), ("mine", 2, 8, 2), ("mine", 2, 8, 5), ("mine", 2, 8, 8),
              ("mine", 2, 10, 3), ("mine", 2, 10, 7)]
             + [("wall", 2, 6, y) for y in range(1, 9)]},
    {"power": 1.0, "hq_hp": 1300, "reward": {"steel": 2500, "rods": 1250, "tech": 60, "fame": 60},
     "defs": [("battery", 4, 5, 0), ("battery", 4, 5, 3), ("battery", 4, 5, 6), ("battery", 4, 5, 9), ("missile", 3, 2, 2),
              ("missile", 3, 2, 7), ("radar", 3, 3, 6), ("asw", 2, 4, 7), ("mine", 3, 8, 1), ("mine", 3, 8, 4),
              ("mine", 3, 8, 7), ("mine", 3, 10, 2), ("mine", 3, 10, 5), ("mine", 3, 10, 8)]
             + [("wall", 3, 6, y) for y in range(0, 10)] + [("wall", 2, 7, y) for y in (2, 5, 7)]},
]
HUT = {"hp": 150}
STAR_SHARE = (0.4, 0.3, 0.3)     # 별 1·2·3개를 처음 딸 때 받는 보상 비율
TICK = 0.5                       # 1칸 = 0.5초 (다시 보기 빠르기)
MAX_TICKS = 180                  # 90초
DMG_RATE = 0.2                   # 능력치 → 한 칸당 피해
SHIP_SPEED = {"patrol": 0.4, "frigate": 0.28, "destroyer": 0.24, "submarine": 0.3, "landing": 0.22}
SHIP_RANGE, ASM_RANGE = 3.0, 1.5
REPAIR_SEC_PER_HP = 6            # 체력 1 = 6초
REPAIR_RODS_PER_HP = 1           # 체력 1 = 용접봉 1
TYPHOON = {"steel": 300, "rods": 150, "tech": 5, "quiz": {"ox": 2, "mc": 1}, "wall_part": 60}
_typhoons: dict[str, dict] = {}  # 푸는 중인 태풍 훈련 (메모리)


def _stage_best(rows):
    """단계별 딴 별 수 (장부 pirate:단계:별)."""
    best = {}
    for r in rows:
        k = str(r.get("key", ""))
        if k.startswith("pirate:"):
            _, st, star = k.split(":")[:3]
            best[int(st)] = max(best.get(int(st), 0), int(star))
    return best


def _lv(level):
    return 1 + 0.25 * (max(level, 1) - 1)


def pirate_base(stage_no):
    """해적 기지 구조물 목록 (id, 종류, 레벨, x, y, w, h, hp, dmg, range)."""
    st = PIRATE_STAGES[stage_no - 1]
    out = [{"id": 0, "type": "hq", "level": stage_no, "x": 2, "y": 4, "w": 2, "h": 2, "hp": st["hq_hp"], "dmg": 0, "range": 0}]
    for i, (t, lv, x, y) in enumerate(st["defs"], start=1):
        if t == "hut":
            out.append({"id": i, "type": "hut", "level": 1, "x": x, "y": y, "w": 1, "h": 1, "hp": HUT["hp"], "dmg": 0, "range": 0})
            continue
        s = game.DEFENSE_STATS[t]
        w, h = game.BUILDINGS[t]["size"]
        out.append({"id": i, "type": t, "level": lv, "x": x, "y": y, "w": w, "h": h,
                    "hp": max(1, int(s["hp"] * _lv(lv) * st["power"])) if s["hp"] else 1,
                    "dmg": s["dmg"] * _lv(lv) * st["power"], "range": s["range"]})
    for o in out:
        o["max"] = o["hp"]
    return out


def _center(o):
    return o["x"] + o["w"] / 2, o["y"] + o["h"] / 2


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def simulate(stage_no, ships, lane, target):
    """자동 전투. ships = [{id, kind, max_hp, attack, weapons}] → 결과 + 다시 보기 기록.
    같은 입력이면 늘 같은 결과 (무작위 없음)."""
    base = pirate_base(stage_no)
    sonar = any("sonar" in s["weapons"] for s in ships)
    y0 = LANES.get(lane, 5.0)
    fleet = []
    for i, s in enumerate(ships):
        off = (i - (len(ships) - 1) / 2) * 0.8
        fleet.append({**s, "x": MAP_W - 0.5, "y": min(MAP_H - 0.5, max(0.5, y0 + off)), "hp": s["max_hp"], "out": False,
                      "tgt": None, "speed": SHIP_SPEED.get(s["kind"], 0.3),
                      "range": SHIP_RANGE + (ASM_RANGE if "asm" in s["weapons"] else 0)})
    events = []
    radar = [o for o in base if o["type"] == "radar"]
    for o in base:
        o["boost"] = any(r is not o and _dist(_center(r), _center(o)) <= r["range"] for r in radar)
    if sonar:   # 소나·레이더: 기뢰를 미리 찾아 무력화
        for o in base:
            if o["type"] == "mine":
                o["hp"] = 0
                events.append({"t": 0, "spot": o["id"]})
    frames = []
    alive = lambda o: o["hp"] > 0
    scored = [o for o in base if o["type"] not in ("wall", "mine")]
    hits = {}   # 전투함이 어떤 시설에게 얼마나 다쳤나 (웰디 한 줄 평)
    for tick in range(MAX_TICKS):
        shots = []
        # 1) 전투함: 목표 고르기 → 사거리면 쏘고, 아니면 다가감 (장벽에 막히면 장벽부터)
        for si, s in enumerate(fleet):
            if s["out"]:
                continue
            pos = (s["x"], s["y"])
            if s["tgt"] is None or not alive(base[s["tgt"]]):
                cands = [o for o in base if alive(o) and o["type"] not in ("mine",)]
                if not cands:
                    break
                defs = [o for o in cands if o["type"] in ("battery", "missile", "asw", "radar")]
                hq = [o for o in cands if o["type"] == "hq"]
                land = [o for o in cands if o["type"] != "wall"]
                pool = (hq or defs or land or cands) if target == "hq" else (defs or hq or land or cands)
                s["tgt"] = min(pool, key=lambda o: (_dist(pos, _center(o)), o["id"]))["id"]
            tgt = base[s["tgt"]]
            c = _center(tgt)
            d = _dist(pos, c) - max(tgt["w"], tgt["h"]) / 2
            if d <= s["range"]:
                dmg = s["attack"] * DMG_RATE
                if tgt["type"] == "wall" and "torpedo" in s["weapons"]:
                    dmg *= 1.5
                tgt["hp"] = max(0, tgt["hp"] - dmg)
                shots.append(["s", si, tgt["id"]])
                if not alive(tgt):
                    events.append({"t": tick, "down": tgt["id"]})
                continue
            # 다가가기 (땅에는 못 올라감)
            dx, dy = c[0] - s["x"], c[1] - s["y"]
            n = math.hypot(dx, dy) or 1
            nx, ny = s["x"] + dx / n * s["speed"], s["y"] + dy / n * s["speed"]
            nx = max(LAND_W + 0.3, nx)
            wall = next((o for o in base if o["type"] == "wall" and alive(o)
                         and abs(nx - (o["x"] + 0.5)) < 0.8 and abs(ny - (o["y"] + 0.5)) < 0.8), None)
            if wall:
                s["tgt"] = wall["id"]
                continue
            if nx <= LAND_W + 0.3 and abs(ny - s["y"]) < 0.01 and abs(nx - s["x"]) < 0.01:
                # 해안에 붙었는데 사거리 밖 → 위아래로 미끄러져 가까이
                ny = s["y"] + (0.2 if c[1] > s["y"] else -0.2)
            s["x"], s["y"] = nx, ny
            # 기뢰
            for o in base:
                if o["type"] == "mine" and alive(o) and _dist((s["x"], s["y"]), _center(o)) < 0.8:
                    hit = o["dmg"]
                    s["hp"] = max(0, s["hp"] - hit)
                    hits["mine"] = hits.get("mine", 0) + hit
                    o["hp"] = 0
                    events.append({"t": tick, "boom": o["id"], "ship": si})
        # 2) 해적 방어 시설이 쏨
        for o in base:
            if not alive(o) or o["dmg"] <= 0 or o["type"] == "mine":
                continue
            inr = [(si, s) for si, s in enumerate(fleet) if not s["out"] and _dist((s["x"], s["y"]), _center(o)) <= o["range"] + 0.5]
            if not inr:
                continue
            if o["type"] == "missile":
                si, s = max(inr, key=lambda p: (p[1]["max_hp"], -p[0]))
            else:
                si, s = min(inr, key=lambda p: (_dist((p[1]["x"], p[1]["y"]), _center(o)), p[0]))
            dmg = o["dmg"] * DMG_RATE * (1.15 if o["boost"] else 1)
            if o["type"] == "missile" and "ciws" in s["weapons"]:
                dmg *= 0.6
            if o["type"] == "asw" and s["kind"] != "submarine":
                dmg *= 0.3
            s["hp"] = max(0, s["hp"] - dmg)
            hits[o["type"]] = hits.get(o["type"], 0) + dmg
            shots.append(["d", o["id"], si])
        for si, s in enumerate(fleet):
            if not s["out"] and s["hp"] <= 0:
                s["out"] = True
                events.append({"t": tick, "retreat": si})
        frames.append({"s": [[round(s["x"], 2), round(s["y"], 2), int(math.ceil(s["hp"])), 1 if s["out"] else 0] for s in fleet],
                       "b": [int(math.ceil(o["hp"])) for o in base], "f": shots})
        if all(s["out"] for s in fleet) or not any(alive(o) for o in scored):
            break
    down = sum(1 for o in scored if not alive(o))
    pct = round(down * 100 / len(scored))
    hq_down = not alive(base[0])
    stars = (1 if pct >= 50 else 0) + (1 if hq_down else 0) + (1 if pct >= 100 else 0)
    return {"stage": stage_no, "lane": lane, "target": target, "stars": stars, "pct": pct, "hq_down": hq_down,
            "ticks": len(frames), "tick_sec": TICK, "sonar": sonar,
            "base": [{k: o[k] for k in ("id", "type", "level", "x", "y", "w", "h", "max")} for o in base],
            "ships": [{"id": s["id"], "kind": s["kind"], "max_hp": s["max_hp"], "hp": int(math.ceil(s["hp"])), "out": s["out"],
                       "weapons": s["weapons"]} for s in fleet],
            "frames": frames, "events": events, "hits": {k: int(v) for k, v in hits.items()},
            "map": {"w": MAP_W, "h": MAP_H, "land": LAND_W}}


def buddy_note(res):
    """웰디 한 줄 평 (글은 앱 언어 파일: gm_bt_note_{id})."""
    hits = res["hits"]
    if res["stars"] == 3:
        return {"id": "perfect"}
    if hits.get("mine", 0) and not res["sonar"]:
        return {"id": "mine"}
    if hits.get("missile", 0) >= max(hits.values() or [0]) and hits.get("missile", 0) > 0:
        return {"id": "missile"}
    if any(o["type"] == "wall" for o in res["base"]) and res["pct"] < 50:
        return {"id": "wall"}
    if not res["hq_down"] and res["target"] != "hq":
        return {"id": "hq"}
    return {"id": "more"}


# ---- 수리 ----

def repair_cost(damage):
    return {"rods": damage * REPAIR_RODS_PER_HP}, damage * REPAIR_SEC_PER_HP


class IdBody(BaseModel):
    id: str


@router.post("/game/warship/repair")
def warship_repair(body: IdBody, user=Depends(need_player)):
    uid = user["id"]
    with _lock(uid):
        now = game._now()
        f = game._my_warship(uid, body.id)
        dmg = int(f.get("damage") or 0)
        if dmg <= 0:
            _err(400, "not_damaged")
        if f.get("repair_until"):
            _err(400, "busy")
        price, secs = repair_cost(dmg)
        if not game._afford(game.balance(game.ledger(uid)), price):
            _err(400, "money")
        game._sql17(lambda: store.patch("game_ships", {"id": f"eq.{f['id']}"}, {"repair_until": _iso(now + timedelta(seconds=secs))}))
        game._spend(uid, f"repair:{f['id']}:{_iso(now)}", price, "repair")
    return game._fresh(user)


# ---- 해적 연습 전투 ----

def pirate_view(rows, fleet, wl):
    best = _stage_best(rows)
    ready = [f for f in fleet if not int(f.get("damage") or 0) and not f.get("repair_until")]
    stages = []
    for i, st in enumerate(PIRATE_STAGES, start=1):
        base = pirate_base(i)
        counts = {}
        for o in base[1:]:
            counts[o["type"]] = counts.get(o["type"], 0) + 1
        stages.append({"no": i, "stars": best.get(i, 0), "open": i == 1 or best.get(i - 1, 0) >= 1, "reward": st["reward"],
                       "counts": counts, "power": max(o["level"] for o in base[1:]),
                       "guards": game_raid.PIRATE_CREWS.get(i, {}),
                       # 작전 짜기 지도용 배치 (id = 목표 순서에 쓰는 번호)
                       "base": [{k: o[k] for k in ("id", "type", "level", "x", "y", "w", "h")} for o in base]})
    return {"stages": stages, "ready": len(ready), "lanes": list(LANES), "max_ships": 6}


@router.get("/game/pirate")
def pirate_state(user=Depends(need_player)):
    uid = user["id"]

    def _history():
        try:
            return store.select("game_battles", {"user_id": f"eq.{uid}", "kind": "eq.pirate", "select": "id,stage,stars,created_at,result",
                                                 "order": "created_at.desc", "limit": "5"})
        except Exception as e:  # noqa: BLE001  (step17 전)
            print("[battle] 기록 못 읽음", str(e)[:120], flush=True)
            return []
    # 필요한 것 모두 한꺼번에 받기
    got = game._par(base=lambda: game._base(uid), rows=lambda: game.ledger(uid), fleet=lambda: game._fleet(uid),
                    buildings=lambda: game._buildings(uid), history=_history)
    base, _ = got["base"]
    rows = got["rows"]
    out = pirate_view(rows, got["fleet"], game.weapon_levels(base))
    out["history"] = [{"id": b["id"], "stage": b["stage"], "stars": b["stars"], "at": b.get("created_at"),
                       "pct": (b.get("result") or {}).get("pct")} for b in got["history"]]
    out["typhoon"] = typhoon_view(uid, rows, base, got["buildings"])
    out["crews"] = game_raid.crew_view(base, got["buildings"])   # G2c-2 상륙 대원
    out["map"] = {"w": MAP_W, "h": MAP_H, "land": LAND_W, "lanes": LANES}
    return out


class AttackBody(BaseModel):
    stage: int
    ships: list[str]
    lane: str = "middle"
    target: str = "defense"     # defense | hq
    # G2c-2 작전 (landing 을 주면 상륙 전투): 상륙 부두 y, 대원이 부술 건물 id 순서(최대 3), 태울 대원 수
    landing: int | None = None
    order: list[int] = []
    crews: dict[str, int] = {}


@router.post("/game/pirate/attack")
def pirate_attack(body: AttackBody, user=Depends(need_player)):
    uid = user["id"]
    if not 1 <= body.stage <= len(PIRATE_STAGES):
        _err(400, "bad_stage")
    if body.lane not in LANES or body.target not in ("defense", "hq"):
        _err(400, "bad_plan")
    with _lock(uid):
        now = game._now()
        base, buildings = game._prep(uid, now)
        rows = game.ledger(uid)
        best = _stage_best(rows)
        if body.stage > 1 and best.get(body.stage - 1, 0) < 1:
            _err(400, "stage_locked")
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
            ships.append({"id": f["id"], "kind": f["kind"], "max_hp": ws["max_hp"], "attack": ws["attack"], "weapons": ws["weapons"]})
        raid = body.landing is not None
        if raid:
            if not 0 <= body.landing < MAP_H:
                _err(400, "bad_plan")
            have = game_raid.get_crews(base)
            free = game_raid.available(have)
            send = {k: max(0, int(body.crews.get(k, 0) or 0)) for k in game_raid.CREW_KINDS}
            if any(send[k] > free[k] for k in send):
                _err(400, "crew_short")
            if game_raid.seats_of(send) > game_raid.ship_capacity(ships):
                _err(400, "crew_room", n=game_raid.ship_capacity(ships))
            res = game_raid.simulate_raid(pirate_base(body.stage), ships, body.lane, body.landing, body.order, send,
                                          MAP_W, MAP_H, LAND_W, LANES, {"stage": body.stage},
                                          defenders=game_raid.PIRATE_CREWS.get(body.stage))
            res["note"] = game_raid.raid_note(res)
            if any(res["crew_lost"].values()):   # 쓰러진 대원만 잃음 (살아 돌아온 대원은 다시 씀)
                for k, v in res["crew_lost"].items():
                    have[k] = max(0, have[k] - v)
                game_raid._save_crews(uid, have)
        else:
            res = simulate(body.stage, ships, body.lane, body.target)
            res["note"] = buddy_note(res)
        # 파손 저장 (침몰 없음)
        for s in res["ships"]:
            dmg = s["max_hp"] - s["hp"]
            if dmg > 0:
                game._sql17(lambda s=s, dmg=dmg: store.patch("game_ships", {"id": f"eq.{s['id']}"}, {"damage": dmg}))
        # 별을 처음 땄을 때만 보상 (창고 자리만큼)
        prev = best.get(body.stage, 0)
        rw = PIRATE_STAGES[body.stage - 1]["reward"]
        got = {"steel": 0, "rods": 0, "tech": 0, "fame": 0}
        for star in range(prev + 1, res["stars"] + 1):
            share = STAR_SHARE[star - 1]
            for k in got:
                got[k] += int(rw[k] * share)
        if res["stars"] > prev:
            bal = game.balance(rows)
            room = game.clip_storage({"steel": got["steel"], "rods": got["rods"]}, bal, game.caps(buildings))
            got.update(room)
            game._add(uid, [{"key": f"pirate:{body.stage}:{res['stars']}", **got, "note": f"pirate {body.stage}"}])
        res["got"] = got
        res["first_stars"] = max(0, res["stars"] - prev)
        bid = str(uuid.uuid4())
        res["id"] = bid
        try:
            store.insert_rows("game_battles", [{"id": bid, "user_id": uid, "kind": "pirate", "stage": body.stage,
                                                 "stars": res["stars"], "result": res}], returning=False)
        except Exception as e:  # noqa: BLE001
            print("[battle] 기록 못 씀 (step17 전?)", str(e)[:120], flush=True)
    return {"battle": res, "state": game._fresh(user)}


@router.get("/game/battle/{bid}")
def battle_replay(bid: str, user=Depends(need_player)):
    try:
        uuid.UUID(bid)
    except ValueError:
        _err(404, "not_found")
    rows = store.select("game_battles", {"id": f"eq.{bid}", "select": "*"})
    # 내가 공격한 전투, 또는 (G2c-3) 내 조선소가 공격받은 전투
    if not rows or user["id"] not in (rows[0].get("user_id"), rows[0].get("defender_id")):
        _err(404, "not_found")
    return {"battle": rows[0]["result"]}


# ---- 태풍 대비 훈련 (하루 한 번) ----

def _today(now=None):
    return (now or game._now()).astimezone(game.KST).date().isoformat()


def wall_score(buildings, grid):
    """방파 장벽 레벨 합 ÷ 16 → 0~1 (큰 땅이 되어도 태풍 점수 기준은 그대로)."""
    lv = sum(b["level"] for b in buildings if b["type"] == "wall" and b["level"] >= 1)
    return min(1.0, lv / 16)


def typhoon_view(uid, rows, base=None, buildings=None):
    if base is None:
        base, _ = game._base(uid)
    if buildings is None:
        buildings = game._buildings(uid)
    done = any(str(r.get("key", "")).startswith(f"typhoon:{_today()}") for r in rows)
    ws = wall_score(buildings, game.grid_of(base))
    return {"done_today": done, "wall_pct": round(ws * TYPHOON["wall_part"]), "wall_part": TYPHOON["wall_part"],
            "quiz": sum(TYPHOON["quiz"].values()), "steel": TYPHOON["steel"], "rods": TYPHOON["rods"], "tech": TYPHOON["tech"]}


class LangBody(BaseModel):
    lang: str = "ko"


@router.post("/game/typhoon/start")
def typhoon_start(body: LangBody, user=Depends(need_player)):
    uid = user["id"]
    lang = daily._lang(body.lang)
    rows = game.ledger(uid)
    if any(str(r.get("key", "")).startswith(f"typhoon:{_today()}") for r in rows):
        _err(400, "typhoon_done")
    book = textbook.current_book()
    if not book:
        _err(400, "no_questions")
    with _lock(uid):
        seen = game.game_seen(uid, rows)   # 자재 조달·승급 시험과 같은 '낸 문제 장부'
    picked, _ = game.pick_supply(book, TYPHOON["quiz"], seen)
    if not picked:
        _err(400, "no_questions")
    daily.ensure_translations(picked, lang)
    tid = str(uuid.uuid4())
    with _lock(uid):
        _typhoons[uid] = {"id": tid, "qids": [q["id"] for q in picked], "lang": lang, "book_id": book["id"]}
        opened = game._supply_open.setdefault(uid, {})
        for q in picked:
            opened[q["id"]] = game._now()
    off = book.get("page_offset") or 0
    return {"id": tid, "total": len(picked), "questions": [daily._public(q, None, lang, off) for q in picked]}


class SubmitBody(BaseModel):
    id: str
    answers: dict[str, str | int]


@router.post("/game/typhoon/submit")
def typhoon_submit(body: SubmitBody, user=Depends(need_player)):
    uid = user["id"]
    with _lock(uid):
        tp = _typhoons.get(uid)
        if not tp or tp["id"] != body.id:
            _err(400, "exam_gone")
        _typhoons.pop(uid, None)
    results, right, unsure = game._grade_all(tp["qids"], body.answers, tp["lang"])
    game._record_answers(uid, tp["book_id"], results, "typhoon")
    with _lock(uid):
        opened = game._supply_open.get(uid, {})
        for q in tp["qids"]:
            opened.pop(q, None)
        now = game._now()
        base, buildings = game._prep(uid, now)
        rows = game.ledger(uid)
        if any(str(r.get("key", "")).startswith(f"typhoon:{_today(now)}") for r in rows):
            _err(400, "typhoon_done")
        wall = wall_score(buildings, game.grid_of(base)) * TYPHOON["wall_part"]
        quiz = (right / max(len(results), 1)) * (100 - TYPHOON["wall_part"])
        pct = int(round(wall + quiz))
        earn = {"steel": TYPHOON["steel"] * pct // 100, "rods": TYPHOON["rods"] * pct // 100}
        got = game.clip_storage(earn, game.balance(rows), game.caps(buildings))
        got["tech"] = TYPHOON["tech"] if pct >= 80 else 0
        game._add(uid, [{"key": f"typhoon:{_today(now)}", **got, "note": f"typhoon {pct}"}])
    return {"pct": pct, "wall_pct": int(round(wall)), "quiz_pct": int(round(quiz)), "right": right, "total": len(results),
            "unsure": unsure, "got": got, "results": results, "state": game._fresh(user)}
