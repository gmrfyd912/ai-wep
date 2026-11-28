"""시간차 출동 전투 (박사 승인 2026-11-28: 해안으로만 공격, 여러 곳에 배를 한 척씩 원하는 때).

- 전투가 시작되면 배는 아직 바다 밖에서 기다린다. 화면에서 배를 고르고 바다 쪽을 누르면
  그 순간(몇 번째 칸)에 그 배가 들어와 누른 곳의 해안으로 간다.
- 군함은 가는 길과 해안에서 사거리 안 방어 시설부터 쏜다. 쏠 게 없으면 해안을 따라 가까운 건물 쪽으로 움직인다.
- 대원을 실은 배는 해안에 닿으면 대원·장비를 내린다. 대원은 내린 곳에서 가까운 건물부터 부순다
  (종류별 좋아하는 목표는 그대로: 취부사=방어 시설, 운반차=본부·창고, 배관사=해안 시설).
- 계산은 서버가 한다 (같은 입력이면 늘 같은 결과). 배를 보낼 때마다 '몇 칸째·어느 배·어디'만 받아서
  처음부터 다시 계산해 돌려준다. 보낸 순간 앞 장면은 그대로라 화면이 끊기지 않는다.
- 한 번 보낸 배는 되돌릴 수 없고, 같은 전투를 처음부터 다시 할 수도 없다.
- 제한 시간 2분 (예시). 안 보낸 배와 대원은 다치지 않고 돌아온다.
"""
import math
import threading
import time
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import game
import game_battle as gb
import game_raid as gr
import store
from game import _err, _lock, need_player

router = APIRouter()

LIVE_TICKS = 240          # 2분 (0.5초 × 240, 예시)
LATE_OK = 6               # 화면 시계와 서버 시계 차이 허용 (칸, 3초)
SESSION_MAX = 15 * 60     # 이만큼(초) 지나도 안 끝낸 전투는 다음에 저절로 끝냄
_live: dict[str, dict] = {}
_live_lock = threading.Lock()


def _alive(o):
    return o["hp"] > 0


def simulate_live(base, ships, loads, deploys, map_w, map_h, land_w, info=None, crew_mult=1.0, defenders=None, end_tick=None):
    """base = 구조물 [{id,type,level,x,y,w,h,hp,dmg,range,max}], ships = [{id,kind,max_hp,attack,weapons}],
    loads = 배마다 태운 대원 [{종류: 수}] (ships 와 같은 순서), deploys = [{t, ship, y}] (t = 몇 칸째, ship = 배 번호).
    → 결과 + 다시 보기 기록 (frames: s 배 [x,y,체력,물러남,기다림], b 건물 체력, c 대원, d 방어 대원, f 쏜 것)."""
    _center, _dist, _edge = gr._center, gr._dist, gr._edge
    last = LIVE_TICKS if end_tick is None else max(1, min(LIVE_TICKS, int(end_tick) + 1))
    sonar = any("sonar" in s["weapons"] for s in ships)
    dep = {}
    for d in sorted(deploys, key=lambda d: d["t"]):
        if 0 <= d["ship"] < len(ships) and d["ship"] not in dep:
            dep[d["ship"]] = {"t": int(d["t"]), "y": min(map_h - 0.5, max(0.5, float(d["y"])))}
    fleet = []
    for i, s in enumerate(ships):
        fleet.append({**s, "x": map_w + 1.5, "y": map_h / 2, "hp": s["max_hp"], "out": False, "wait": True,
                      "docked": False, "speed": gb.SHIP_SPEED.get(s["kind"], 0.3), "carry": [],
                      "range": gb.SHIP_RANGE + (gb.ASM_RANGE if "asm" in s["weapons"] else 0)})
    events = []
    radar = [o for o in base if o["type"] == "radar"]
    for o in base:
        o["boost"] = any(r is not o and _dist(_center(r), _center(o)) <= r["range"] for r in radar)
    team = []   # 대원 (배에 탄 채 기다림 → 해안에 닿으면 내림)
    for si, ld in enumerate(loads):
        for k in gr.CREW_KINDS:
            for _ in range(int((ld or {}).get(k, 0) or 0)):
                fleet[si]["carry"].append(len(team))
                team.append({"kind": k, "ki": gr.CREW_KINDS.index(k), **gr.CREWS[k], "dmg": gr.CREWS[k]["dmg"] * crew_mult,
                             "hp": gr.CREWS[k]["hp"], "max": gr.CREWS[k]["hp"], "x": land_w - 0.4, "y": map_h / 2,
                             "on": False, "down": False, "tgt": None, "ship": si})
    guards = []
    for k in gr.CREW_KINDS:
        n = int((defenders or {}).get(k, 0) or 0)
        if n <= 0:
            continue
        homes = [o for o in base if o["type"] in ("rally", "dorm", "garage")] \
            or [o for o in base if o["type"] == "hut"] or [base[0]]
        for j in range(n):
            hx, hy = _center(homes[(j + gr.CREW_KINDS.index(k)) % len(homes)])
            guards.append({"kind": k, "ki": gr.CREW_KINDS.index(k), **gr.CREWS[k], "hp": gr.CREWS[k]["hp"], "max": gr.CREWS[k]["hp"],
                           "x": hx + ((j % 3) - 1) * 0.3, "y": hy + ((j // 3) % 3 - 1) * 0.3, "down": False})
    scored = [o for o in base if o["type"] not in ("wall", "mine")]
    landed_at = None
    frames, hits = [], {}

    def near_foe(c, foes, rng):
        best = None
        for f in foes:
            if f["down"] or not f.get("on", True):
                continue
            d = _dist((c["x"], c["y"]), (f["x"], f["y"]))
            if d <= rng and (best is None or d < best[0]):
                best = (d, f)
        return best[1] if best else None

    def heal(team_, c):
        for a in team_:
            if a is not c and not a["down"] and a.get("on", True) and a["hp"] < a["max"] \
                    and _dist((c["x"], c["y"]), (a["x"], a["y"])) <= gr.HEAL_R:
                a["hp"] = min(a["max"], a["hp"] + c["heal"])

    def step_to(c, tx, ty, max_x=None):
        dx, dy = tx - c["x"], ty - c["y"]
        n = math.hypot(dx, dy) or 1
        sp = min(c["speed"], n)
        c["x"] += dx / n * sp
        c["y"] += dy / n * sp
        if max_x is not None:
            c["x"] = min(max_x, c["x"])

    def ship_target(pos, rng):
        """배가 사거리 안에서 쏠 것: 방어 시설 → 본부 → 나머지 (장벽·기뢰 빼고), 같으면 가까운 것."""
        cands = [o for o in base if _alive(o) and o["type"] not in ("mine", "wall") and _edge(pos, o) <= rng]
        if not cands:
            return None
        rank = lambda o: (0 if o["type"] in gr.DEF_TYPES else 1 if o["type"] in ("hq",) else 2, _edge(pos, o), o["id"])
        return min(cands, key=rank)

    def crew_target(c):
        land = [o for o in base if _alive(o) and o["type"] not in ("wall", "mine")]
        if not land:
            return None
        pos = (c["x"], c["y"])
        pref = c.get("pref")
        if pref == "hq":
            pool = [o for o in land if o["type"] in ("hq", "hut")] or land
        elif pref == "defense":
            pool = [o for o in land if o["type"] in gr.DEF_TYPES] or land
        elif pref == "coast":
            pool = [o for o in land if o["type"] in c.get("x2", ())] or land
        else:
            pool = land
        return min(pool, key=lambda o: (_edge(pos, o), o["id"]))

    def wall_at(x, y):
        return next((o for o in base if o["type"] == "wall" and _alive(o)
                     and abs(x - (o["x"] + 0.5)) < 0.8 and abs(y - (o["y"] + 0.5)) < 0.8), None)

    def shoot_wall(si, s, wall, tick, shots):
        wd = s["attack"] * gb.DMG_RATE * (1.5 if "torpedo" in s["weapons"] else 1)
        wall["hp"] = max(0, wall["hp"] - wd)
        shots.append(["s", si, wall["id"]])
        if not _alive(wall):
            events.append({"t": tick, "down": wall["id"]})

    def mines(si, s, tick):
        for o in base:
            if o["type"] == "mine" and _alive(o) and _dist((s["x"], s["y"]), _center(o)) < 0.8:
                s["hp"] = max(0, s["hp"] - o["dmg"])
                hits["mine"] = hits.get("mine", 0) + o["dmg"]
                o["hp"] = 0
                events.append({"t": tick, "boom": o["id"], "ship": si})

    for tick in range(last):
        shots = []
        acted = False   # 이번 칸에 배가 움직이거나 쐈나
        # 0) 이번 칸에 보낸 배가 바다 끝에서 들어옴
        for si, s in enumerate(fleet):
            d = dep.get(si)
            if s["wait"] and d and d["t"] <= tick:
                s["wait"] = False
                s["x"], s["y"] = map_w - 0.5, d["y"]
                s["goal"] = (land_w + 0.45, d["y"])
                events.append({"t": tick, "send": si, "y": round(d["y"], 2)})
                if sonar and not any(e.get("spot") is not None for e in events):
                    for o in base:   # 소나: 처음 배가 들어올 때 기뢰를 찾아 무력화
                        if o["type"] == "mine" and _alive(o):
                            o["hp"] = 0
                            events.append({"t": tick, "spot": o["id"]})
        # 1) 배: 가는 길·해안에서 사거리 안 목표를 쏨, 해안에 닿으면 대원을 내림
        for si, s in enumerate(fleet):
            if s["out"] or s["wait"]:
                continue
            pos = (s["x"], s["y"])
            tgt = ship_target(pos, s["range"]) if s["attack"] > 0 else None
            if tgt is not None:
                dmg = s["attack"] * gb.DMG_RATE
                tgt["hp"] = max(0, tgt["hp"] - dmg)
                shots.append(["s", si, tgt["id"]])
                if not _alive(tgt):
                    events.append({"t": tick, "down": tgt["id"]})
                # 대원을 실은 배는 쏘면서도 계속 감, 군함은 서서 쏨
                if not s["carry"] or s["docked"]:
                    continue
            if s["docked"]:
                # 해안에 닿았는데 쏠 게 없음 → 해안을 따라 가까운 건물 쪽으로 (대원 다 내린 뒤)
                land = [o for o in base if _alive(o) and o["type"] not in ("wall", "mine")]
                if not land or s["attack"] <= 0:
                    continue
                o = min(land, key=lambda o: (_edge(pos, o), o["id"]))
                cy = _center(o)[1]
                if abs(cy - s["y"]) < 0.15:
                    continue
                ny = s["y"] + max(-s["speed"], min(s["speed"], cy - s["y"]))
                w = wall_at(s["x"], ny)
                if w:
                    shoot_wall(si, s, w, tick, shots)
                    continue
                s["y"] = ny
                acted = True
                mines(si, s, tick)
                continue
            gx, gy = s["goal"]
            dx, dy = gx - s["x"], gy - s["y"]
            n = math.hypot(dx, dy)
            if n <= s["speed"] + 0.05:
                s["x"], s["y"], s["docked"] = gx, gy, True
                acted = True
                if s["carry"]:
                    if landed_at is None:
                        landed_at = tick
                    events.append({"t": tick, "land": si})
                    for k, ci in enumerate(s["carry"]):
                        c = team[ci]
                        c["on"] = True
                        c["y"] = min(map_h - 0.3, max(0.3, gy + ((k % 5) - 2) * 0.25))
                        c["x"] = land_w - 0.4 - (k // 5) * 0.25
                    s["carry"] = []
                continue
            nx, ny = s["x"] + dx / n * s["speed"], s["y"] + dy / n * s["speed"]
            w = wall_at(nx, ny)
            if w:
                if tgt is None:
                    shoot_wall(si, s, w, tick, shots)
                continue
            s["x"], s["y"] = nx, ny
            acted = True
            mines(si, s, tick)
        # 2) 대원: 가까운 건물로 걸어가 부숨 (방어 대원이 가까우면 먼저 맞서 싸움)
        for ci, c in enumerate(team):
            if not c["on"] or c["down"]:
                continue
            if c.get("heal"):
                mates = [a for a in team if a is not c and a["on"] and not a["down"]]
                if mates:
                    a = min(mates, key=lambda a: (a["hp"] >= a["max"], _dist((c["x"], c["y"]), (a["x"], a["y"]))))
                    if _dist((c["x"], c["y"]), (a["x"], a["y"])) > 0.5:
                        step_to(c, a["x"], a["y"], land_w - 0.2)
                heal(team, c)
                continue
            g = near_foe(c, guards, gr.ENGAGE) if guards and c["dmg"] > 0 else None
            if g is not None:
                if _dist((c["x"], c["y"]), (g["x"], g["y"])) <= gr.REACH + 0.2:
                    g["hp"] = max(0, g["hp"] - c["dmg"])
                    shots.append(["cg", ci, guards.index(g)])
                else:
                    step_to(c, g["x"], g["y"], land_w - 0.2)
                continue
            if c["tgt"] is None or not _alive(base[c["tgt"]]):
                t = crew_target(c)
                c["tgt"] = t["id"] if t else None
            if c["tgt"] is None:
                continue
            o = base[c["tgt"]]
            if _edge((c["x"], c["y"]), o) <= gr.REACH:
                dmg = c["dmg"] * (2 if o["type"] in c.get("x2", ()) or (c.get("big") and o["w"] * o["h"] >= 4) else 1)
                o["hp"] = max(0, o["hp"] - dmg)
                shots.append(["c", ci, o["id"]])
                if not _alive(o):
                    events.append({"t": tick, "down": o["id"]})
                continue
            cx, cy = _center(o)
            step_to(c, cx, cy, land_w - 0.2)
        # 2-1) 방어 대원: 적 대원이 처음 내린 뒤부터 가장 가까운 적 대원에게 (지게차가 가까우면 지게차부터)
        if landed_at is not None:
            for gi, g in enumerate(guards):
                if g["down"]:
                    continue
                if g.get("heal"):
                    mates = [a for a in guards if a is not g and not a["down"]]
                    if mates:
                        a = min(mates, key=lambda a: (a["hp"] >= a["max"], _dist((g["x"], g["y"]), (a["x"], a["y"]))))
                        if _dist((g["x"], g["y"]), (a["x"], a["y"])) > 0.5:
                            step_to(g, a["x"], a["y"], land_w - 0.2)
                    heal(guards, g)
                    continue
                foes = [c for c in team if c["on"] and not c["down"]]
                if not foes:
                    continue
                tank = [c for c in foes if c.get("taunt") and _dist((g["x"], g["y"]), (c["x"], c["y"])) <= 2.0]
                f = min(tank or foes, key=lambda c: _dist((g["x"], g["y"]), (c["x"], c["y"])))
                if _dist((g["x"], g["y"]), (f["x"], f["y"])) <= gr.REACH + 0.2:
                    if g["dmg"] > 0:
                        f["hp"] = max(0, f["hp"] - g["dmg"])
                        shots.append(["gc", gi, team.index(f)])
                else:
                    step_to(g, f["x"], f["y"], land_w - 0.2)
        # 3) 방어 시설이 쏨: 사거리 안 지게차 → 가장 가까운 배·대원 (미사일은 배를 먼저)
        for o in base:
            if not _alive(o) or o["dmg"] <= 0 or o["type"] == "mine":
                continue
            oc = _center(o)
            boats = [("s", si, s) for si, s in enumerate(fleet)
                     if not s["out"] and not s["wait"] and _dist((s["x"], s["y"]), oc) <= o["range"] + 0.5]
            men = [("c", ci, c) for ci, c in enumerate(team) if c["on"] and not c["down"] and _dist((c["x"], c["y"]), oc) <= o["range"] + 0.5]
            if not boats and not men:
                continue
            tank = [m for m in men if m[2].get("taunt")]
            if o["type"] == "missile" and boats:
                who, idx, u = max(boats, key=lambda p: (p[2]["max_hp"], -p[1]))
            elif tank:
                who, idx, u = min(tank, key=lambda p: (_dist((p[2]["x"], p[2]["y"]), oc), p[1]))
            else:
                who, idx, u = min(boats + men, key=lambda p: (_dist((p[2]["x"], p[2]["y"]), oc), p[0], p[1]))
            dmg = o["dmg"] * gb.DMG_RATE * (1.15 if o["boost"] else 1)
            if who == "s":
                if o["type"] == "missile" and "ciws" in u["weapons"]:
                    dmg *= 0.6
                if o["type"] == "asw" and u["kind"] != "submarine":
                    dmg *= 0.3
            u["hp"] = max(0, u["hp"] - dmg)
            hits[o["type"]] = hits.get(o["type"], 0) + dmg
            shots.append(["d" if who == "s" else "dc", o["id"], idx])
        if any(f[0] == "s" for f in shots):
            acted = True
        for si, s in enumerate(fleet):
            if not s["out"] and s["hp"] <= 0:
                s["out"] = True
                events.append({"t": tick, "retreat": si})
                for ci in s["carry"]:   # 내리기 전에 배가 물러나면 대원도 그대로 돌아감 (다치지 않음)
                    team[ci]["home"] = True
                s["carry"] = []
        for ci, c in enumerate(team):
            if c["on"] and not c["down"] and c["hp"] <= 0:
                c["down"] = True
                events.append({"t": tick, "fall": ci})
        for gi, g in enumerate(guards):
            if not g["down"] and g["hp"] <= 0:
                g["down"] = True
                events.append({"t": tick, "gfall": gi})
        frames.append({"s": [[round(s["x"], 2), round(s["y"], 2), int(math.ceil(s["hp"])), 1 if s["out"] else 0, 1 if s["wait"] else 0]
                             for s in fleet],
                       "d": [[round(g["x"], 2), round(g["y"], 2), int(math.ceil(g["hp"])), g["ki"]] for g in guards],
                       "b": [int(math.ceil(o["hp"])) for o in base], "f": shots,
                       "c": [[round(c["x"], 2), round(c["y"], 2), int(math.ceil(c["hp"])), c["ki"]] for c in team if c["on"]]})
        if not any(_alive(o) for o in scored):
            break
        # 더 보낼 배가 없고, 배·대원도 이번 칸에 아무것도 못 했으면 끝
        if all(not s["wait"] or si in dep for si, s in enumerate(fleet)) and not any(s["wait"] for s in fleet):
            men_left = any(c["on"] and not c["down"] for c in team)
            if not men_left and not acted:
                break
    down = sum(1 for o in scored if not _alive(o))
    pct = round(down * 100 / len(scored)) if scored else 0
    hq_down = not _alive(base[0])
    stars = (1 if pct >= 50 else 0) + (1 if hq_down else 0) + (1 if pct >= 100 else 0)
    sent = {k: 0 for k in gr.CREW_KINDS}
    lost = {k: 0 for k in gr.CREW_KINDS}
    for c in team:
        if c["ship"] not in dep:   # 안 보낸 배의 대원은 집에 그대로
            continue
        sent[c["kind"]] += 1
        if c["down"]:
            lost[c["kind"]] += 1
    # 방어 기록·팁에 쓰는 '들어온 쪽': 대원 실은 배가 처음 닿은 곳 (없으면 처음 보낸 배)
    order_dep = sorted(dep.items(), key=lambda p: p[1]["t"])
    main = next((d for si, d in order_dep if sum((loads[si] or {}).values())), order_dep[0][1] if order_dep else None)
    side = "middle" if main is None else "north" if main["y"] < map_h / 3 else "south" if main["y"] > map_h * 2 / 3 else "middle"
    out = {"live": True, "stars": stars, "pct": pct, "hq_down": hq_down, "lane": side, "landing": None, "order": [],
           "ticks": len(frames), "tick_sec": gb.TICK, "max_ticks": LIVE_TICKS, "sonar": sonar, "raid": bool(team),
           "landed_at": landed_at, "deploys": [{"t": d["t"], "ship": si, "y": d["y"]} for si, d in sorted(dep.items(), key=lambda p: p[1]["t"])],
           "base": [{k: o[k] for k in ("id", "type", "level", "x", "y", "w", "h", "max")} for o in base],
           "ships": [{"id": s["id"], "kind": s["kind"], "max_hp": s["max_hp"], "hp": int(math.ceil(s["hp"])), "out": s["out"],
                      "sent": not s["wait"], "load": sum(1 for c in team if c["ship"] == si), "weapons": s["weapons"]}
                     for si, s in enumerate(fleet)],
           "crews": [{"kind": c["kind"], "max": c["max"]} for c in team],
           "guards": [{"kind": g["kind"], "max": g["max"]} for g in guards],
           "guard_sent": {k: int((defenders or {}).get(k, 0) or 0) for k in gr.CREW_KINDS},
           "guard_lost": {k: sum(1 for g in guards if g["down"] and g["kind"] == k) for k in gr.CREW_KINDS},
           "loot_bonus": max([gr.CREWS[c["kind"]].get("loot", 0) for c in team if c["on"] and not c["down"]] or [0]),
           "crew_sent": sent, "crew_lost": lost,
           "frames": frames, "events": events, "hits": {k: int(v) for k, v in hits.items()},
           "map": {"w": map_w, "h": map_h, "land": land_w}, "target": "plan"}
    if info:
        out.update(info)
    return out


def note_of(res):
    """웰디 한 줄 평 (gm_bt_note_{id})."""
    if res["stars"] == 3:
        return {"id": "perfect"}
    if not any(s["sent"] for s in res["ships"]):
        return {"id": "nosend"}
    if sum(res["crew_sent"].values()) and res["landed_at"] is None:
        return {"id": "noland"}
    if sum(res["crew_sent"].values()) and sum(res["crew_lost"].values()) >= sum(res["crew_sent"].values()) \
            and not res["crew_sent"].get("forklift"):
        return {"id": "forklift"}
    return gb.buddy_note({**res, "target": "hq" if res["hq_down"] else "defense"})


# ---- 해적 기지: 출동 준비 → 시작 → 배 보내기 → 끝 ----

class LoadBody(BaseModel):
    stage: int
    ships: list[str]
    loads: dict[str, dict[str, int]] = {}   # 배 id → {대원 종류: 수}


def _loads(base, ships, loads):
    """배마다 태운 대원 확인: 다친 대원 빼고 가진 만큼, 배 자리만큼."""
    have = gr.get_crews(base)
    free = gr.available(have)
    total = {k: 0 for k in gr.CREW_KINDS}
    out = []
    for s in ships:
        ld = {k: max(0, int((loads.get(s["id"]) or {}).get(k, 0) or 0)) for k in gr.CREW_KINDS}
        if gr.seats_of(ld) > gr.CAPACITY.get(s["kind"], 0):
            _err(400, "crew_room", n=gr.CAPACITY.get(s["kind"], 0))
        for k in ld:
            total[k] += ld[k]
        out.append(ld)
    if any(total[k] > free[k] for k in total):
        _err(400, "crew_short")
    return out, have


def _session(user, sid, done_ok=False):
    with _live_lock:
        s = _live.get(sid)
    if not s or s["uid"] != user["id"] or (s.get("done") and not (done_ok and s.get("result"))):
        _err(400, "live_gone")
    return s


def _tick_now(s):
    return int((time.time() - s["at"]) / gb.TICK)


def _run(s, end_tick=None):
    return simulate_live([dict(o) for o in s["base"]], s["ships"], s["loads"], s["deploys"], s["map"][0], s["map"][1], s["map"][2],
                         s["info"], s.get("mult", 1.0), s.get("defenders"), end_tick)


def _finish_old(uid):
    """끝내지 않은 전투가 있으면 (앱을 닫았을 때) 지금까지 보낸 대로 끝냄."""
    with _live_lock:
        olds = [s for s in _live.values() if s["uid"] == uid and not s.get("done")]
    for s in olds:
        try:
            _finish(s, None)
        except Exception as e:  # noqa: BLE001
            print("[live] 지난 전투 끝내기 실패", str(e)[:120], flush=True)
    now = time.time()
    with _live_lock:
        for k in [k for k, s in _live.items() if s.get("done") and now - s["at"] > SESSION_MAX]:
            _live.pop(k, None)


def _finish(s, end_tick):
    with _live_lock:
        if s.get("done"):
            return s.get("result")
        s["done"] = True
    res = _run(s, end_tick)
    res["note"] = note_of(res)
    out = s["finish"](res)
    s["result"] = out
    return out


@router.post("/game/live/pirate/start")
def pirate_start(body: LoadBody, user=Depends(need_player)):
    uid = user["id"]
    if not 1 <= body.stage <= len(gb.PIRATE_STAGES):
        _err(400, "bad_stage")
    _finish_old(uid)
    with _lock(uid):
        now = game._now()
        base, buildings = game._prep(uid, now)
        rows = game.ledger(uid)
        best = gb._stage_best(rows)
        if body.stage > 1 and best.get(body.stage - 1, 0) < 1:
            _err(400, "stage_locked")
        fleet = {f["id"]: f for f in game._fleet(uid)}
        picked = [fleet[i] for i in dict.fromkeys(body.ships) if i in fleet][:gb_max_ships()]
        if not picked:
            _err(400, "no_ships")
        if any(int(f.get("damage") or 0) or f.get("repair_until") for f in picked):
            _err(400, "ship_damaged")
        wl = game.weapon_levels(base)
        ships = []
        for f in picked:
            ws = game.warship_stats(f, wl)
            ships.append({"id": f["id"], "kind": f["kind"], "max_hp": ws["max_hp"], "attack": ws["attack"], "weapons": ws["weapons"]})
        loads, _ = _loads(base, ships, body.loads)
        game.mark_todo(uid, "battle")
    stage = body.stage

    def finish(res):
        return apply_pirate(user, stage, res)

    sid = str(uuid.uuid4())
    s = {"id": sid, "uid": uid, "at": time.time(), "base": gb.pirate_base(stage), "ships": ships, "loads": loads, "deploys": [],
         "map": (gb.MAP_W, gb.MAP_H, gb.LAND_W), "info": {"stage": stage}, "defenders": gr.PIRATE_CREWS.get(stage),
         "finish": finish}
    with _live_lock:
        _live[sid] = s
    res = _run(s)
    return {"id": sid, "battle": res}


def gb_max_ships():
    return 6


def apply_pirate(user, stage, res):
    """해적 기지 전투 결과 저장: 쓰러진 대원 잃음, 배 파손, 별을 처음 땄을 때만 보상, 다시 보기 기록."""
    uid = user["id"]
    with _lock(uid):
        base, buildings = game._prep(uid, game._now())
        rows = game.ledger(uid)
        if any(res["crew_lost"].values()):
            have = gr.get_crews(base)
            for k, v in res["crew_lost"].items():
                have[k] = max(0, have[k] - v)
            gr._save_crews(uid, have)
        for s in res["ships"]:
            dmg = s["max_hp"] - s["hp"]
            if dmg > 0:
                game._sql17(lambda s=s, dmg=dmg: store.patch("game_ships", {"id": f"eq.{s['id']}"}, {"damage": dmg}))
        best = gb._stage_best(rows)
        prev = best.get(stage, 0)
        rw = gb.PIRATE_STAGES[stage - 1]["reward"]
        got = {"steel": 0, "rods": 0, "tech": 0, "fame": 0}
        for star in range(prev + 1, res["stars"] + 1):
            share = gb.STAR_SHARE[star - 1]
            for k in got:
                got[k] += int(rw[k] * share)
        if res["stars"] > prev:
            room = game.clip_storage({"steel": got["steel"], "rods": got["rods"]}, game.balance(rows), game.caps(buildings))
            got.update(room)
            game._add(uid, [{"key": f"pirate:{stage}:{res['stars']}", **got, "note": f"pirate {stage}"}])
        res["got"] = got
        res["first_stars"] = max(0, res["stars"] - prev)
        bid = str(uuid.uuid4())
        res["id"] = bid
        try:
            store.insert_rows("game_battles", [{"id": bid, "user_id": uid, "kind": "pirate", "stage": stage,
                                                 "stars": res["stars"], "result": res}], returning=False)
        except Exception as e:  # noqa: BLE001
            print("[live] 기록 못 씀", str(e)[:120], flush=True)
    return {"battle": res, "state": game._fresh(user)}


class DeployBody(BaseModel):
    id: str
    t: int
    ship: int
    y: float


@router.post("/game/live/deploy")
def deploy(body: DeployBody, user=Depends(need_player)):
    s = _session(user, body.id)
    if not 0 <= body.ship < len(s["ships"]) or any(d["ship"] == body.ship for d in s["deploys"]):
        _err(400, "live_sent")
    if not 0 <= body.y < s["map"][1]:
        _err(400, "bad_plan")
    now_t = _tick_now(s)
    last = max([d["t"] for d in s["deploys"]] or [0])
    # 화면 시계를 믿되, 지난 장면으로 되돌아가 보내기는 막음 (몇 초 차이는 봐줌)
    t = max(body.t, last, now_t - LATE_OK, 0)
    if t >= LIVE_TICKS:
        _err(400, "live_over")
    s["deploys"].append({"t": t, "ship": body.ship, "y": body.y})
    return {"id": s["id"], "battle": _run(s)}


class EndBody(BaseModel):
    id: str
    t: int | None = None


@router.post("/game/live/end")
def end(body: EndBody, user=Depends(need_player)):
    s = _session(user, body.id, done_ok=True)
    if s.get("result"):
        return s["result"]   # 끝내기를 두 번 눌렀거나 다시 보냄
    last = max([d["t"] for d in s["deploys"]] or [0])
    t = None if body.t is None else max(int(body.t), last)
    return _finish(s, t)


# ---- 친구 조선소: 출동 전 3문제(사기) → 시작 → 배 보내기 → 끝 ----

class RaidLoadBody(BaseModel):
    target: str
    ships: list[str]
    loads: dict[str, dict[str, int]] = {}
    morale_id: str = ""
    answers: dict[str, str | int] = {}
    revenge: str | None = None


def _busy(target, uid):
    """다른 교육생이 지금 이 조선소를 공격하는 중인지 (오래된 전투는 끝내고 봄)."""
    with _live_lock:
        others = [s for s in _live.values() if s.get("target") == target and s["uid"] != uid and not s.get("done")]
    for s in others:
        if time.time() - s["at"] > LIVE_TICKS * gb.TICK + 30:
            try:
                _finish(s, None)
            except Exception as e:  # noqa: BLE001
                print("[live] 오래된 공격 끝내기 실패", str(e)[:120], flush=True)
        else:
            return True
    return False


@router.post("/game/live/raid/start")
def raid_start(body: RaidLoadBody, user=Depends(need_player)):
    import game_pvp as pv
    uid = user["id"]
    try:
        uuid.UUID(body.target)
    except ValueError:
        _err(404, "not_found")
    st = game.settings()
    pv.need_sql19()
    _finish_old(uid)
    tg0 = pv._target(user, body.target, st)
    code, extra = pv.block_reason(uid, body.target, st, tg0["base"], tg0["same"])
    if code:
        _err(400, "raid_" + code, **extra)
    if _busy(body.target, uid):
        _err(400, "raid_busy")
    results, right, mult = pv.grade_morale(uid, body.morale_id, body.answers)
    game.mark_todo(uid, "battle")
    revenge = pv.revenge_of(uid, body.target, body.revenge)
    la, lb = pv._pair_locks(uid, body.target)
    with la, lb:
        now = game._now()
        tg = pv._target(user, body.target, st)
        code, extra = pv.block_reason(uid, body.target, st, tg["base"], tg["same"], now=now)
        if code:
            _err(400, "raid_" + code, **extra)
        base, buildings = game._prep(uid, now)
        fleet = {f["id"]: f for f in game._fleet(uid)}
        picked = [fleet[i] for i in dict.fromkeys(body.ships) if i in fleet][:gb_max_ships()]
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
        loads, _ = _loads(base, ships, body.loads)
        tbase, mp = pv.battle_base(tg["blds"], st, tg["units"], game.grid_of(tg["base"]), game.sea_of(tg["base"]))
        guards = gr.available(gr.get_crews(tg["base"], now))
    morale = {"right": right, "total": len(results), "mult": mult}
    target = body.target

    def finish(res):
        return pv.apply_raid(user, target, res, morale, revenge)

    sid = str(uuid.uuid4())
    s = {"id": sid, "uid": uid, "at": time.time(), "base": tbase, "ships": ships, "loads": loads, "deploys": [],
         "map": (mp["w"], mp["h"], mp["land"]), "mult": mult, "defenders": guards, "target": target,
         "info": {"stage": 0, "kind": "raid", "morale": morale, "attacker": {"id": uid, "name": user.get("name") or ""},
                  "defender": {"id": target, "name": tg["user"].get("name") or ""}},
         "finish": finish}
    with _live_lock:
        _live[sid] = s
    return {"id": sid, "battle": _run(s), "results": results}
