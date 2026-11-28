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

CREWS = {
    "welder":      {"hp": 30, "dmg": 1.6, "speed": 0.25, "cost": 1},
    "fitter":      {"hp": 22, "dmg": 1.2, "speed": 0.42, "cost": 1, "pref": "defense"},
    "forklift":    {"hp": 120, "dmg": 0.8, "speed": 0.16, "cost": 3, "taunt": True},
    "transporter": {"hp": 60, "dmg": 1.2, "speed": 0.2, "cost": 2, "pref": "hq", "x2": ("hq", "hut")},
}
CREW_KINDS = tuple(CREWS)
CAPACITY = {"patrol": 2, "frigate": 4, "destroyer": 6, "submarine": 0, "landing": 12}
CREW_QUIZ = {"ox": 2, "mc": 1}          # 대원 훈련 1번 = 문제 3개, 맞힌 수 = 훈련 점수
RAID_TICKS = 240                        # 상륙 전투 최대 120초
MAX_ORDER = 3
REACH = 0.6                             # 대원이 건물 가장자리에서 이만큼 안이면 부수기 시작
_trainings: dict[str, dict] = {}        # 푸는 중인 대원 훈련 (메모리)


def crew_cap(buildings):
    hq = game._hq(buildings)
    return 10 + 4 * (hq["level"] if hq else 1)


def get_crews(base):
    raw = (base or {}).get("crews") or {}
    out = {k: max(0, int(raw.get(k) or 0)) for k in CREW_KINDS}
    out["pts"] = max(0, int(raw.get("pts") or 0))
    return out


def _save_crews(uid, crews):
    game._sql17(lambda: game.store.patch("game_bases", {"user_id": f"eq.{uid}"}, {"crews": crews}), code="need_sql18")


def crew_view(base, buildings):
    c = get_crews(base)
    return {"have": {k: c[k] for k in CREW_KINDS}, "pts": c["pts"], "cap": crew_cap(buildings),
            "total": sum(c[k] for k in CREW_KINDS),
            "specs": {k: {"hp": v["hp"], "dmg": v["dmg"], "speed": v["speed"], "cost": v["cost"]} for k, v in CREWS.items()},
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


def simulate_raid(base, ships, lane, landing, order, crews, map_w, map_h, land_w, lanes, info=None):
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
            team.append({"kind": k, "ki": CREW_KINDS.index(k), **CREWS[k], "hp": CREWS[k]["hp"], "max": CREWS[k]["hp"],
                         "x": land_w - 0.4, "y": landing + 0.5, "on": False, "down": False, "tgt": None})
    landed_at = None
    frames, hits = [], {}

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
            if c["tgt"] is None or not alive(base[c["tgt"]]):
                t = crew_target(c)
                c["tgt"] = t["id"] if t else None
            if c["tgt"] is None:
                continue
            o = base[c["tgt"]]
            pos = (c["x"], c["y"])
            if _edge(pos, o) <= REACH:
                dmg = c["dmg"] * (2 if o["type"] in c.get("x2", ()) else 1)
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
        frames.append({"s": [[round(s["x"], 2), round(s["y"], 2), int(math.ceil(s["hp"])), 1 if s["out"] else 0] for s in fleet],
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
        price = CREWS[body.kind]["cost"] * body.n
        if c["pts"] < price:
            _err(400, "crew_pts", need=price, have=c["pts"])
        if sum(c[k] for k in CREW_KINDS) + body.n > crew_cap(buildings):
            _err(400, "crew_full", cap=crew_cap(buildings))
        c["pts"] -= price
        c[body.kind] += body.n
        _save_crews(uid, c)
        base["crews"] = c
        return {"crews": crew_view(base, buildings)}
