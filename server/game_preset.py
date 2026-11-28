"""관리자: 회원 조선소를 본관 레벨에 맞춰 한 번에 맞추기 (박사 요청 2026-11-28, 시험·시연용).

관리자가 회원 한 명과 본관 레벨(1~8)을 고르면, 그 레벨에 어울리는 조선소로 통째로 바꾼다.
- 건물: 그 본관 레벨에서 지을 수 있는 건물을 모두 (레벨 = 본관 레벨, 건물 최대 레벨까지), 방어 시설은 지을 수 있는 개수만큼
- 땅: 처음부터 큰 땅 (간척 없앰, 2026-11-28)
- 무기 연구: 연구소 레벨로 열리는 무기를 본관 레벨까지
- 전투함: 군항 부두 자리만큼 (만들 수 있는 종류로), 선체 레벨 = 본관 레벨, 무기 칸 채움
- 대원: 집결장 자리만큼 (기술교육원 레벨로 열린 종류로, 장비는 자리의 1/4쯤), 부상은 지움
- 승급 시험: 그 레벨까지 통과한 것으로 장부에 적음
자원(강판·용접봉 등)·상선·전투 기록은 그대로 둔다.

바꾸기 전 모습은 app_settings 'game_backup:<회원 id>' 에 한 벌 저장 → [되돌리기] 로 돌아감 (마지막 1번만).
누가·언제·몇 레벨로 바꿨는지는 회원 장부에 'preset:' 줄(자원 0)로 남는다.
"""
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import game
import game_raid
import store
from admin_settings import _save_setting, need_admin

router = APIRouter()

# 놓는 순서: 큰 것·자리가 정해진 것부터 (작은 건물이 자리를 쪼개지 않게)
ORDER = ["pier", "rally", "yard", "rodstore", "cutting", "welding", "academy", "trainhall",
         "missile", "asw", "battery", "radar", "mine", "wall"]
SHIP_ARMS = ["gun", "torpedo", "asm", "sonar", "ciws"]          # 전투함 무기 칸 채우는 순서
DORM_MIX = {"welder": 4, "fitter": 3, "piper": 2, "safety": 1}  # 사람 대원 채우는 비율 (예시)
GARAGE_MIX = ["forklift", "transporter", "crane"]                # 장비는 돌아가며 한 대씩


def _key(uid):
    return f"game_backup:{uid}"


def _fleet_plan(lv, dock_lv, cap):
    kinds = [k for k, sp in game.WARSHIPS.items() if not sp.get("soon") and sp["hq"] <= lv and sp["dock"] <= dock_lv]
    out = []
    if "landing" in kinds and cap:
        out.append("landing")
    rest = [k for k in ("frigate", "patrol") if k in kinds]
    i = 0
    while rest and len(out) < cap:
        out.append(rest[i % len(rest)])
        i += 1
    return out


def _crew_plan(lv_hall, cap, pts):
    """집결장 자리 cap(사람 1·장비 2자리)을 채움: 장비는 자리의 1/4쯤, 나머지는 사람."""
    c = {k: 0 for k in game_raid.CREW_KINDS}
    machines = [k for k in GARAGE_MIX if game_raid.CREWS[k]["unlock"] <= lv_hall]
    units = (cap // 4) // 2 if machines else 0
    for i in range(units):
        c[machines[i % len(machines)]] += 1
    people_cap = cap - units * 2
    people = [k for k in DORM_MIX if game_raid.CREWS[k]["unlock"] <= lv_hall]
    if people and people_cap:
        w = sum(DORM_MIX[k] for k in people)
        for k in people:
            c[k] = people_cap * DORM_MIX[k] // w
        left = people_cap - sum(c[k] for k in people)
        for i in range(left):
            c[people[i % len(people)]] += 1
    c["pts"] = pts
    c["hurt"] = []
    return c


def plan(lv, old_crews=None):
    """본관 레벨 lv 에 맞는 조선소 (아직 저장 안 함)."""
    lv = max(1, min(int(lv), game.MAX_LEVEL))
    stage = game.LAND_STAGE
    grid, sea = game.GRID, game.SEA
    blds = [{"id": "hq", "type": "hq", "level": lv, "x": grid // 2 - 2, "y": grid // 2 - 2},
            {"id": "dock", "type": "dock", "level": min(lv, game.BUILDINGS["dock"]["max"]), "x": grid - 2, "y": grid // 2 - 4}]
    want, short = {}, {}
    for t in ORDER:
        spec = game.BUILDINGS[t]
        if spec["unlock"] > lv:
            continue
        n = game.defense_max(t, lv) if spec.get("defense") or t in game.MULTI_COUNT else 1
        want[t] = n
        for i in range(n):
            spot = game.free_spot(blds, t, grid=grid, sea=sea)
            if not spot:
                short[t] = n - i
                break
            blds.append({"id": f"{t}{i}", "type": t, "level": min(lv, spec["max"]), "x": spot[0], "y": spot[1]})
    lv_of = {b["type"]: b["level"] for b in blds}
    academy = lv_of.get("academy", 0)
    weapons = {k: (lv if sp["academy"] <= academy else 0) for k, sp in game.WEAPONS.items()}
    weapons["gun"] = max(1, weapons["gun"])
    cap = lv_of["pier"] + 1 if lv_of.get("pier") else 0
    fleet = _fleet_plan(lv, lv_of["dock"], cap)
    arms = [k for k in SHIP_ARMS if weapons.get(k)]
    ships = [{"kind": k, "hull": lv, "weapons": arms[:game.WARSHIPS[k]["slots"]]} for k in fleet]
    cap = game_raid.crew_cap(blds)
    homes = {"rally": cap, "n": sum(1 for b in blds if b["type"] == "rally")}
    crews = _crew_plan(lv_of.get("trainhall", 0), cap, int((old_crews or {}).get("pts") or 0))
    return {"level": lv, "reclaim": stage, "grid": grid, "sea": sea, "buildings": blds, "short": short,
            "weapons": weapons, "ships": ships, "crews": crews, "homes": homes}


def summary(p):
    counts = {}
    for b in p["buildings"]:
        counts[b["type"]] = counts.get(b["type"], 0) + 1
    return {"level": p["level"], "grid": p["grid"], "buildings": counts, "short": p["short"],
            "weapons": {k: v for k, v in p["weapons"].items() if v},
            "ships": [s["kind"] for s in p["ships"]],
            "crews": {k: p["crews"][k] for k in game_raid.CREW_KINDS if p["crews"][k]}, "homes": p["homes"]}


def _war_and_open(uid):
    """바꿀 배: 전투함 전부 + 도크에서 만드는 중인 배 (진수 끝난 상선은 그대로)."""
    rows = store.select("game_ships", {"user_id": f"eq.{uid}", "select": "*", "limit": "500"})
    return [r for r in rows if game.is_war(r["kind"]) or not r.get("delivered_at")]


def _backup_of(uid):
    rows = store.select("app_settings", {"key": f"eq.{_key(uid)}", "select": "value"})
    return rows[0]["value"] if rows and rows[0].get("value") else None


BASE_KEYS = ("reclaim", "reclaim_until", "weapons", "crews", "tutorial_done")


def _replace(uid, buildings, ships, base_fields):
    store.delete("game_buildings", {"user_id": f"eq.{uid}"})
    for r in _war_and_open(uid):
        store.delete("game_ships", {"id": f"eq.{r['id']}"})
    if buildings:
        store.insert_rows("game_buildings", buildings, returning=False)
    if ships:
        store.insert_rows("game_ships", ships, returning=False)
    game._sql17(lambda: store.patch("game_bases", {"user_id": f"eq.{uid}"}, base_fields))


def player_info(uid):
    rows = game.ledger(uid)
    log = []
    for r in rows:
        if r["key"].startswith("preset:"):
            parts = (r.get("note") or "").split("|")
            log.append({"at": r.get("created_at"), "by": parts[1] if len(parts) > 1 else "",
                        "what": parts[2] if len(parts) > 2 else "", "from": parts[3] if len(parts) > 3 else ""})
    b = _backup_of(uid)
    return {"log": log[::-1][:20], "backup": {"at": b.get("at"), "level": b.get("level")} if b else None}


class PresetBody(BaseModel):
    user_id: str
    level: int


@router.get("/admin/game/preset/{uid}")
def preset_preview(uid: str, level: int, user=Depends(need_admin)):
    game._player(uid)
    base, _ = game._base(uid)
    return {"plan": summary(plan(level, game_raid.get_crews(base))), **player_info(uid)}


@router.post("/admin/game/preset")
def preset_apply(body: PresetBody, user=Depends(need_admin)):
    u = game._player(body.user_id)
    uid = u["id"]
    if not 1 <= body.level <= game.MAX_LEVEL:
        game._err(400, "bad_value", key="level")
    with game._lock(uid):
        now = game._now()
        base, _ = game._base(uid)
        old_b = game._buildings(uid)
        old_hq = game._hq(old_b)
        p = plan(body.level, game_raid.get_crews(base))
        # 1) 지금 모습 저장 (되돌리기용, 마지막 1벌)
        _save_setting(_key(uid), {"at": game._iso(now), "level": old_hq["level"] if old_hq else 0, "by": user.get("login_id") or "",
                                  "buildings": old_b, "ships": _war_and_open(uid),
                                  "base": {k: base.get(k) for k in BASE_KEYS}})
        # 2) 새 조선소로 바꾸기
        iso = game._iso(now)
        blds = [{"id": str(uuid.uuid4()), "user_id": uid, "type": b["type"], "level": b["level"], "x": b["x"], "y": b["y"],
                 "collected_at": iso} for b in p["buildings"]]
        ships = [{"id": str(uuid.uuid4()), "user_id": uid, "kind": s["kind"], "stage": len(game.STAGES) - 1, "hull": s["hull"],
                  "weapons": s["weapons"], "delivered_at": iso} for s in p["ships"]]
        _replace(uid, blds, ships, {"reclaim": p["reclaim"], "reclaim_until": None, "weapons": p["weapons"],
                                    "crews": p["crews"], "tutorial_done": True})
        # 3) 승급 시험 통과 + 기록 (자원 0)
        rows = [{"key": f"hq_exam:{n}", "note": "preset", "created_at": iso} for n in range(2, p["level"] + 1)]
        have = {r["key"] for r in game.ledger(uid)}
        rows = [r for r in rows if r["key"] not in have]
        rows.append({"key": f"preset:{uuid.uuid4()}", "created_at": iso,
                     "note": f"preset|{user.get('login_id') or ''}|{p['level']}|{old_hq['level'] if old_hq else 0}"})
        game._add(uid, rows)
    return {"plan": summary(p), **player_info(uid)}


@router.post("/admin/game/preset/undo")
def preset_undo(body: PresetBody, user=Depends(need_admin)):
    """마지막으로 맞추기 전 모습으로 되돌린다 (level 은 안 씀)."""
    u = game._player(body.user_id)
    uid = u["id"]
    with game._lock(uid):
        b = _backup_of(uid)
        if not b:
            game._err(400, "no_backup")
        _replace(uid, b.get("buildings") or [], b.get("ships") or [], b.get("base") or {})
        game._add(uid, [{"key": f"preset:{uuid.uuid4()}", "created_at": game._iso(game._now()),
                         "note": f"preset|{user.get('login_id') or ''}|undo|{b.get('level') or 0}"}])
        store.delete("app_settings", {"key": f"eq.{_key(uid)}"})
    return info_after(uid)


def info_after(uid):
    return {"plan": None, **player_info(uid)}
