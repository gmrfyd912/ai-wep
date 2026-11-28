"""G2c-2(게임): 작전 짜기·상륙 전투·대원 훈련.

원칙 (박사 승인 2026-11-28, G2c 계획안 https://claude.ai/artifact/M4UxyCQHotZ8N5LXWn3soR):
- 작전: 들어갈 바닷길(북·가운데·남) + 상륙 부두(해안 한 칸) + 대원이 부술 목표 순서(최대 3개)를 조선소 지도를 눌러 정한다.
- 전투: 전투함이 바닷길로 들어와 상륙 부두로 가며 쏜다(장벽·기뢰에 막힘). 첫 배가 부두에 닿으면 대원이 내려
  목표 순서대로 건물을 부순다. 방어 시설은 배와 대원을 모두 쏜다. 같은 입력이면 늘 같은 결과(무작위 없음).
- 대원 4종 (숫자는 예시): 용접사(기본), 취부사(빠름, 방어 시설 먼저), 지게차(튼튼, 방어 시설이 먼저 노림),
  트랜스포터(본부·창고에 2배). 배마다 태울 수 있는 수가 정해져 있다(고속정 2·호위함 4·구축함 6·상륙함 12).
- 대원은 '대원 훈련'에서 문제를 풀어 얻는다: 맞힌 1문제 = 훈련 점수 1. 점수로 대원을 뽑는다(용접사·취부사 1, 트랜스포터 2, 지게차 3).
  살아 돌아온 대원은 다시 쓰고, 쓰러진 대원은 잃는다. 대원 숙소 크기 = 10 + 본관 레벨 × 4.
- step18 SQL 필요 (game_bases.crews).
- 이기면(별 1개 이상) 앱에서 대원들이 양팔을 들고 환호한다.
"""
import math
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import daily
import game
import textbook
from game import _err, _lock, need_player

router = APIRouter()

# 대원 7종 (숫자는 예시). home = 머무는 곳(dorm 기숙사 / garage 장비 정비고), unlock = 기술교육원 레벨, seats = 배에서 차지하는 자리
# 순서를 바꾸지 말 것 (다시 보기 기록이 순서 번호를 씀). 새 대원은 맨 뒤에.
CREWS = {
    "welder":      {"hp": 30, "dmg": 1.6, "speed": 0.25, "cost": 1, "home": "dorm", "unlock": 1, "seats": 1},
    "fitter":      {"hp": 22, "dmg": 1.2, "speed": 0.42, "cost": 1, "home": "dorm", "unlock": 1, "seats": 1, "pref": "defense"},
    "forklift":    {"hp": 120, "dmg": 0.8, "speed": 0.16, "cost": 3, "home": "garage", "unlock": 3, "seats": 2, "taunt": True},
    "transporter": {"hp": 60, "dmg": 1.2, "speed": 0.2, "cost": 3, "home": "garage", "unlock": 4, "seats": 2, "pref": "hq",
                    "x2": ("hq", "hut", "yard", "rodstore"), "loot": 0.1},
    "piper":       {"hp": 28, "dmg": 1.3, "speed": 0.28, "cost": 2, "home": "dorm", "unlock": 2, "seats": 1, "pref": "coast",
                    "x2": ("battery", "asw", "pier", "dock")},
    "safety":      {"hp": 26, "dmg": 0.0, "speed": 0.3, "cost": 3, "home": "dorm", "unlock": 4, "seats": 1, "heal": 0.8},
    "crane":       {"hp": 150, "dmg": 3.0, "speed": 0.12, "cost": 5, "home": "garage", "unlock": 5, "seats": 2, "big": True},
}
CREW_KINDS = tuple(CREWS)
HOMES = {"dorm": (8, 6), "garage": (2, 2)}   # 1레벨 수용, 레벨마다 더함
HEAL_R = 1.6                             # 안전관리자 회복 거리
CAPACITY = {"patrol": 2, "frigate": 4, "destroyer": 6, "submarine": 0, "landing": 12}
CREW_QUIZ = {"ox": 2, "mc": 1}          # 대원 훈련 1번 = 문제 3개, 맞힌 수 = 훈련 점수
RAID_TICKS = 240                        # 상륙 전투 최대 120초
MAX_ORDER = 3
REACH = 0.6                             # 대원이 건물 가장자리에서 이만큼 안이면 부수기 시작
# 해적 기지 방어 선원 (3단계부터, 연습용)
PIRATE_CREWS = {3: {"welder": 2}, 4: {"welder": 3, "forklift": 1}, 5: {"welder": 4, "fitter": 2, "forklift": 1},
                6: {"welder": 5, "fitter": 3, "forklift": 2}}
_trainings: dict[str, dict] = {}        # 푸는 중인 대원 훈련 (메모리)


def _lv_of(buildings, btype):
    b = next((x for x in buildings if x["type"] == btype), None)
    return int(b["level"]) if b else 0


def home_cap(buildings, home):
    lv = _lv_of(buildings, home)
    if lv < 1:
        return 0
    a, b = HOMES[home]
    return a + b * (lv - 1)


def crew_cap(buildings):
    """(옛 이름) 사람 대원 + 장비 대원 자리 합."""
    return home_cap(buildings, "dorm") + home_cap(buildings, "garage")


def get_crews(base, now=None):
    """{종류: 수, pts, hurt: [[종류, 수, 돌아오는 시각]]} (돌아온 부상 대원은 뺌)."""
    raw = (base or {}).get("crews") or {}
    out = {k: max(0, int(raw.get(k) or 0)) for k in CREW_KINDS}
    out["pts"] = max(0, int(raw.get("pts") or 0))
    now = now or game._now()
    hurt = []
    for h in raw.get("hurt") or []:
        try:
            k, n, until = h[0], int(h[1]), game._dt(h[2])
        except (TypeError, ValueError, IndexError):
            continue
        if k in CREWS and n > 0 and until and until > now:
            hurt.append([k, n, h[2]])
    out["hurt"] = hurt
    return out


def hurt_counts(c):
    out = {k: 0 for k in CREW_KINDS}
    for k, n, _ in c.get("hurt") or []:
        out[k] += n
    return out


def available(c):
    """지금 싸울 수 있는 대원 (부상 대원 빼고)."""
    h = hurt_counts(c)
    return {k: max(0, c[k] - h[k]) for k in CREW_KINDS}


def home_used(c, home):
    return sum(c[k] for k in CREW_KINDS if CREWS[k]["home"] == home)


def seats_of(send):
    return sum(int(n) * CREWS[k]["seats"] for k, n in send.items() if k in CREWS)


def _save_crews(uid, crews):
    game._sql17(lambda: game.store.patch("game_bases", {"user_id": f"eq.{uid}"}, {"crews": crews}), code="need_sql18")


def add_hurt(c, lost, minutes, now=None):
    """방어하다 쓰러진 대원 → 부상 (minutes 분 뒤 돌아옴)."""
    until = game._iso((now or game._now()) + game.timedelta(minutes=minutes))
    for k, n in lost.items():
        if n > 0:
            c.setdefault("hurt", []).append([k, int(n), until])
    return c


def crew_view(base, buildings):
    c = get_crews(base)
    hc = hurt_counts(c)
    th = _lv_of(buildings, "trainhall")
    return {"have": {k: c[k] for k in CREW_KINDS}, "pts": c["pts"], "cap": crew_cap(buildings),
            "total": sum(c[k] for k in CREW_KINDS), "hurt": hc,
            "hurt_until": min([h[2] for h in c["hurt"]], default=None),
            "homes": {h: {"used": home_used(c, h), "cap": home_cap(buildings, h), "level": _lv_of(buildings, h)} for h in HOMES},
            "trainhall": th,
            "specs": {k: {"hp": v["hp"], "dmg": v["dmg"], "speed": v["speed"], "cost": v["cost"], "home": v["home"],
                          "unlock": v["unlock"], "seats": v["seats"]} for k, v in CREWS.items()},
            "capacity": CAPACITY, "quiz": sum(CREW_QUIZ.values())}


def ship_capacity(ships):
    return sum(CAPACITY.get(s["kind"], 0) for s in ships)


# ---- 상륙 전투 계산 ----

def _center(o):
    return o["x"] + o["w"] / 2, o["y"] + o["h"] / 2


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _edge(pos, o):
    """점에서 건물 가장자리까지 거리 (건물 안이면 0)."""
    dx = max(o["x"] - pos[0], 0, pos[0] - (o["x"] + o["w"]))
    dy = max(o["y"] - pos[1], 0, pos[1] - (o["y"] + o["h"]))
    return math.hypot(dx, dy)


DEF_TYPES = ("battery", "missile", "asw", "radar")


def simulate_raid(base, ships, lane, landing, order, crews, map_w, map_h, land_w, lanes, info=None, crew_mult=1.0, defenders=None):
    """base = 구조물 목록 [{id,type,level,x,y,w,h,hp,dmg,range,max}] (id = 목록 순서), ships = [{id,kind,max_hp,attack,weapons}],
    landing = 상륙 부두 y (해안 바로 앞 바다 칸), order = 대원이 부술 건물 id 순서, crews = {종류: 수}.
    → 결과 + 다시 보기 기록 (frames: s 배, b 건물 체력, c 대원 [x,y,체력,종류 번호], f 쏜 것)."""
    import game_battle as gb
    sonar = any("sonar" in s["weapons"] for s in ships)
    y0 = lanes.get(lane, map_h / 2)
    dock = (land_w + 0.45, landing + 0.5)
    fleet = []
    for i, s in enumerate(ships):
        off = (i - (len(ships) - 1) / 2) * 0.8
        fleet.append({**s, "x": map_w - 0.5, "y": min(map_h - 0.5, max(0.5, y0 + off)), "hp": s["max_hp"], "out": False,
                      "docked": False, "speed": gb.SHIP_SPEED.get(s["kind"], 0.3),
                      "range": gb.SHIP_RANGE + (gb.ASM_RANGE if "asm" in s["weapons"] else 0)})
    events = []
    radar = [o for o in base if o["type"] == "radar"]
    for o in base:
        o["boost"] = any(r is not o and _dist(_center(r), _center(o)) <= r["range"] for r in radar)
    if sonar:
        for o in base:
            if o["type"] == "mine":
                o["hp"] = 0
                events.append({"t": 0, "spot": o["id"]})
    alive = lambda o: o["hp"] > 0
    scored = [o for o in base if o["type"] not in ("wall", "mine")]
    order = [i for i in order if 0 <= i < len(base) and base[i]["type"] not in ("wall", "mine")][:MAX_ORDER]
    team = []        # 대원 (아직 안 내림)
    for k in CREW_KINDS:
        for _ in range(int(crews.get(k, 0))):
            team.append({"kind": k, "ki": CREW_KINDS.index(k), **CREWS[k], "dmg": CREWS[k]["dmg"] * crew_mult,
                         "hp": CREWS[k]["hp"], "max": CREWS[k]["hp"],
                         "x": land_w - 0.4, "y": landing + 0.5, "on": False, "down": False, "tgt": None})
    # 방어 대원: 기숙사·장비 정비고(해적은 오두막·본부)에서 기다리다가 적 대원이 상륙하면 나와서 싸움
    guards = []
    for k in CREW_KINDS:
        n = int((defenders or {}).get(k, 0) or 0)
        if n <= 0:
            continue
        home = next((o for o in base if o["type"] == CREWS[k]["home"]), None) \
            or next((o for o in base if o["type"] == "hut"), None) or base[0]
        hx, hy = _center(home)
        for j in range(n):
            guards.append({"kind": k, "ki": CREW_KINDS.index(k), **CREWS[k], "hp": CREWS[k]["hp"], "max": CREWS[k]["hp"],
                           "x": hx + ((j % 3) - 1) * 0.3, "y": hy + ((j // 3) % 3 - 1) * 0.3, "down": False})
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
                    and _dist((c["x"], c["y"]), (a["x"], a["y"])) <= HEAL_R:
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
        """배가 사거리 안에서 쏠 것: 목표 순서 → 방어 시설 → 본부 → 나머지 (장벽·기뢰 빼고)."""
        cands = [o for o in base if alive(o) and o["type"] not in ("mine", "wall") and _edge(pos, o) <= rng]
        if not cands:
            return None
        for i in order:
            if base[i] in cands:
                return base[i]
        rank = lambda o: (0 if o["type"] in DEF_TYPES else 1 if o["type"] == "hq" else 2, _edge(pos, o), o["id"])
        return min(cands, key=rank)

    def crew_target(c):
        for i in order:
            if alive(base[i]):
                return base[i]
        land = [o for o in base if alive(o) and o["type"] not in ("wall", "mine")]
        if not land:
            return None
        pos = (c["x"], c["y"])
        pref = c.get("pref")
        if pref == "hq":
            pool = [o for o in land if o["type"] in ("hq", "hut")] or land
        elif pref == "defense":
            pool = [o for o in land if o["type"] in DEF_TYPES] or land
        elif pref == "coast":
            pool = [o for o in land if o["type"] in c.get("x2", ())] or land
        else:
            pool = land
        return min(pool, key=lambda o: (_edge(pos, o), o["id"]))

    for tick in range(RAID_TICKS):
        shots = []
        # 1) 전투함: 상륙 부두로 가면서, 사거리 안 목표를 쏨 (장벽에 막히면 장벽부터)
        for si, s in enumerate(fleet):
            if s["out"]:
                continue
            pos = (s["x"], s["y"])
            tgt = ship_target(pos, s["range"])
            if tgt is not None:
                dmg = s["attack"] * gb.DMG_RATE
                tgt["hp"] = max(0, tgt["hp"] - dmg)
                shots.append(["s", si, tgt["id"]])
                if not alive(tgt):
                    events.append({"t": tick, "down": tgt["id"]})
                if s["docked"]:
                    continue
            if s["docked"]:
                continue
            dx, dy = dock[0] - s["x"], dock[1] - s["y"]
            n = math.hypot(dx, dy)
            if n <= s["speed"] + 0.05:
                s["x"], s["y"], s["docked"] = dock[0] + 0.0, dock[1], True
                if landed_at is None and team:
                    landed_at = tick
                    events.append({"t": tick, "land": si})
                    for k, c in enumerate(team):
                        c["on"] = True
                        c["y"] = min(map_h - 0.3, max(0.3, landing + 0.5 + ((k % 5) - 2) * 0.25))
                        c["x"] = land_w - 0.4 - (k // 5) * 0.25
                continue
            nx, ny = s["x"] + dx / n * s["speed"], s["y"] + dy / n * s["speed"]
            wall = next((o for o in base if o["type"] == "wall" and alive(o)
                         and abs(nx - (o["x"] + 0.5)) < 0.8 and abs(ny - (o["y"] + 0.5)) < 0.8), None)
            if wall:
                if tgt is None:   # 막혔고 쏠 게 없으면 장벽을 쏨
                    wd = s["attack"] * gb.DMG_RATE * (1.5 if "torpedo" in s["weapons"] else 1)
                    wall["hp"] = max(0, wall["hp"] - wd)
                    shots.append(["s", si, wall["id"]])
                    if not alive(wall):
                        events.append({"t": tick, "down": wall["id"]})
                continue
            s["x"], s["y"] = nx, ny
            for o in base:
                if o["type"] == "mine" and alive(o) and _dist((s["x"], s["y"]), _center(o)) < 0.8:
                    s["hp"] = max(0, s["hp"] - o["dmg"])
                    hits["mine"] = hits.get("mine", 0) + o["dmg"]
                    o["hp"] = 0
                    events.append({"t": tick, "boom": o["id"], "ship": si})
        # 2) 대원: 목표로 걸어가서 부숨
        for ci, c in enumerate(team):
            if not c["on"] or c["down"]:
                continue
            if c.get("heal"):   # 안전관리자: 공격 안 하고 가장 가까운 다친 동료 곁에서 회복
                hurt_ = [a for a in team if a is not c and a["on"] and not a["down"]]
                if hurt_:
                    a = min(hurt_, key=lambda a: (a["hp"] >= a["max"], _dist((c["x"], c["y"]), (a["x"], a["y"]))))
                    if _dist((c["x"], c["y"]), (a["x"], a["y"])) > 0.5:
                        step_to(c, a["x"], a["y"], land_w - 0.2)
                heal(team, c)
                continue
            g = near_foe(c, guards, REACH + 0.2) if guards else None
            if g is not None and c["dmg"] > 0:   # 바로 앞의 방어 대원과 먼저 싸움
                g["hp"] = max(0, g["hp"] - c["dmg"])
                shots.append(["cg", ci, guards.index(g)])
                continue
            if c["tgt"] is None or not alive(base[c["tgt"]]):
                t = crew_target(c)
                c["tgt"] = t["id"] if t else None
            if c["tgt"] is None:
                continue
            o = base[c["tgt"]]
            pos = (c["x"], c["y"])
            if _edge(pos, o) <= REACH:
                dmg = c["dmg"] * (2 if o["type"] in c.get("x2", ()) or (c.get("big") and o["w"] * o["h"] >= 4) else 1)
                o["hp"] = max(0, o["hp"] - dmg)
                shots.append(["c", ci, o["id"]])
                if not alive(o):
                    events.append({"t": tick, "down": o["id"]})
                continue
            cx, cy = _center(o)
            dx, dy = cx - c["x"], cy - c["y"]
            n = math.hypot(dx, dy) or 1
            c["x"] = min(land_w - 0.2, c["x"] + dx / n * c["speed"])
            c["y"] = c["y"] + dy / n * c["speed"]
        # 2-1) 방어 대원: 적 대원이 상륙한 뒤 가장 가까운 적 대원에게 (지게차가 가까우면 지게차부터)
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
                if _dist((g["x"], g["y"]), (f["x"], f["y"])) <= REACH + 0.2:
                    if g["dmg"] > 0:
                        f["hp"] = max(0, f["hp"] - g["dmg"])
                        shots.append(["gc", gi, team.index(f)])
                else:
                    step_to(g, f["x"], f["y"], land_w - 0.2)
        # 3) 방어 시설이 쏨: 사거리 안 지게차 → 가장 가까운 배·대원 (미사일은 배를 먼저)
        for o in base:
            if not alive(o) or o["dmg"] <= 0 or o["type"] == "mine":
                continue
            oc = _center(o)
            boats = [("s", si, s) for si, s in enumerate(fleet) if not s["out"] and _dist((s["x"], s["y"]), oc) <= o["range"] + 0.5]
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
        for si, s in enumerate(fleet):
            if not s["out"] and s["hp"] <= 0:
                s["out"] = True
                events.append({"t": tick, "retreat": si})
        for ci, c in enumerate(team):
            if c["on"] and not c["down"] and c["hp"] <= 0:
                c["down"] = True
                events.append({"t": tick, "fall": ci})
        for gi, g in enumerate(guards):
            if not g["down"] and g["hp"] <= 0:
                g["down"] = True
                events.append({"t": tick, "gfall": gi})
        frames.append({"s": [[round(s["x"], 2), round(s["y"], 2), int(math.ceil(s["hp"])), 1 if s["out"] else 0] for s in fleet],
                       "d": [[round(g["x"], 2), round(g["y"], 2), int(math.ceil(g["hp"])), g["ki"]] for g in guards],
                       "b": [int(math.ceil(o["hp"])) for o in base], "f": shots,
                       "c": [[round(c["x"], 2), round(c["y"], 2), int(math.ceil(c["hp"])), c["ki"]] for c in team if c["on"]]})
        boats_left = any(not s["out"] for s in fleet)
        men_left = any(c["on"] and not c["down"] for c in team)
        waiting = boats_left and any(not c["on"] for c in team)   # 아직 배에 탄 대원
        if not any(alive(o) for o in scored):
            break
        if not men_left and not waiting:
            # 대원이 없으면: 배가 모두 물러났거나, 부두에 닿아 더 쏠 게 없으면 끝
            if not boats_left or (all(s["out"] or s["docked"] for s in fleet) and
                                  not any(ship_target((s["x"], s["y"]), s["range"]) for s in fleet if not s["out"])):
                break
    down = sum(1 for o in scored if not alive(o))
    pct = round(down * 100 / len(scored)) if scored else 0
    hq_down = not alive(base[0])
    stars = (1 if pct >= 50 else 0) + (1 if hq_down else 0) + (1 if pct >= 100 else 0)
    lost = {k: 0 for k in CREW_KINDS}
    for c in team:
        if c["down"]:
            lost[c["kind"]] += 1
    out = {"lane": lane, "landing": landing, "order": order, "stars": stars, "pct": pct, "hq_down": hq_down,
           "ticks": len(frames), "tick_sec": gb.TICK, "sonar": sonar, "raid": True, "landed_at": landed_at,
           "base": [{k: o[k] for k in ("id", "type", "level", "x", "y", "w", "h", "max")} for o in base],
           "ships": [{"id": s["id"], "kind": s["kind"], "max_hp": s["max_hp"], "hp": int(math.ceil(s["hp"])), "out": s["out"],
                      "weapons": s["weapons"]} for s in fleet],
           "crews": [{"kind": c["kind"], "max": c["max"]} for c in team],
           "guards": [{"kind": g["kind"], "max": g["max"]} for g in guards],
           "guard_sent": {k: int((defenders or {}).get(k, 0) or 0) for k in CREW_KINDS},
           "guard_lost": {k: sum(1 for g in guards if g["down"] and g["kind"] == k) for k in CREW_KINDS},
           "loot_bonus": max([CREWS[c["kind"]].get("loot", 0) for c in team if c["on"] and not c["down"]] or [0]),
           "crew_sent": {k: int(crews.get(k, 0)) for k in CREW_KINDS}, "crew_lost": lost,
           "frames": frames, "events": events, "hits": {k: int(v) for k, v in hits.items()},
           "map": {"w": map_w, "h": map_h, "land": land_w}, "target": "plan"}
    if info:
        out.update(info)
    return out


def raid_note(res):
    """웰디 한 줄 평 (글: gm_bt_note_{id})."""
    import game_battle as gb
    if res["stars"] == 3:
        return {"id": "perfect"}
    if sum(res["crew_sent"].values()) == 0:
        return {"id": "nocrew"}
    if res["landed_at"] is None:
        return {"id": "noland"}
    if sum(res["crew_lost"].values()) >= max(1, sum(res["crew_sent"].values())) and not res["crew_sent"].get("forklift"):
        return {"id": "forklift"}
    return gb.buddy_note(res)


# ---- 대원 훈련 ----

class TrainStart(BaseModel):
    lang: str = "ko"


@router.post("/game/crew/train/start")
def train_start(body: TrainStart, user=Depends(need_player)):
    uid = user["id"]
    lang = daily._lang(body.lang)
    if _lv_of(game._buildings(uid), "trainhall") < 1:
        _err(400, "need_trainhall")
    book = textbook.current_book()
    if not book:
        _err(400, "no_questions")
    rows = game.ledger(uid)
    with _lock(uid):
        seen = game.game_seen(uid, rows)
    picked, _ = game.pick_supply(book, CREW_QUIZ, seen, kinds=list(CREW_QUIZ))
    if not picked:
        _err(400, "no_questions")
    daily.ensure_translations(picked, lang)
    tid = str(uuid.uuid4())
    now = game._now()
    with _lock(uid):
        _trainings[uid] = {"id": tid, "qids": [q["id"] for q in picked], "lang": lang, "book_id": book["id"]}
        opened = game._supply_open.setdefault(uid, {})
        for q in picked:
            opened[q["id"]] = now
    off = book.get("page_offset") or 0
    return {"id": tid, "total": len(picked), "questions": [daily._public(q, None, lang, off) for q in picked]}


@router.post("/game/crew/train/submit")
def train_submit(body: game.ExamSubmitBody, user=Depends(need_player)):
    uid = user["id"]
    with _lock(uid):
        tr = _trainings.get(uid)
        if not tr or tr["id"] != body.id:
            _err(400, "exam_gone")
        _trainings.pop(uid, None)
    results, right, unsure = game._grade_all(tr["qids"], body.answers, tr["lang"])
    game._record_answers(uid, tr.get("book_id"), results, "crew")
    with _lock(uid):
        base, _ = game._base(uid)
        c = get_crews(base)
        c["pts"] += right
        _save_crews(uid, c)
        opened = game._supply_open.get(uid, {})
        for q in tr["qids"]:
            opened.pop(q, None)
        base["crews"] = c
        view = crew_view(base, game._buildings(uid))
    return {"right": right, "total": len(results), "unsure": unsure, "results": results, "crews": view}


class HireBody(BaseModel):
    kind: str
    n: int = 1


@router.post("/game/crew/hire")
def hire(body: HireBody, user=Depends(need_player)):
    """훈련 점수로 대원 뽑기."""
    uid = user["id"]
    if body.kind not in CREWS or not 1 <= body.n <= 50:
        _err(400, "bad_kind")
    with _lock(uid):
        base, _ = game._base(uid)
        buildings = game._buildings(uid)
        c = get_crews(base)
        spec = CREWS[body.kind]
        if _lv_of(buildings, "trainhall") < spec["unlock"]:
            _err(400, "crew_locked", need=spec["unlock"])
        home = spec["home"]
        cap = home_cap(buildings, home)
        if home_used(c, home) + body.n > cap:
            _err(400, "crew_full_" + home if cap else "need_" + home, cap=cap)
        price = spec["cost"] * body.n
        if c["pts"] < price:
            _err(400, "crew_pts", need=price, have=c["pts"])
        c["pts"] -= price
        c[body.kind] += body.n
        _save_crews(uid, c)
        base["crews"] = c
        return {"crews": crew_view(base, buildings)}
