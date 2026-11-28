"""관리자 조선소 맞추기 시험: 미리 보기·적용(건물·땅·무기·전투함·대원·시험 통과)·기록·되돌리기.
실행: python -m tests.preset_check"""
import uuid

from fastapi.testclient import TestClient

import accounts
import app as server
import game
import game_raid
from tests import fake_db as db
from tests.textbook_check import H


def main():
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    c = TestClient(server.app)
    ids, hd = {}, {}
    for n, role in (("s1", "student"), ("ad", "admin")):
        u = db.insert_rows("users", {"login_id": n, "login_key": n, "name": n, "role": role, "status": "active",
                                     "password_hash": accounts.hash_password("p")})[0]
        ids[n] = u["id"]
        hd[n] = H(c.post("/auth/login", json={"login_id": n, "password": "p"}).json()["token"])
    s1 = ids["s1"]
    assert c.get("/game/state", headers=hd["s1"]).status_code == 200
    merchant = str(uuid.uuid4())
    db.insert_rows("game_ships", {"id": merchant, "user_id": s1, "kind": "barge", "stage": 4, "delivered_at": "2026-11-27T00:00:00+00:00"})
    before = sorted((b["type"], b["level"]) for b in db.TABLES["game_buildings"] if b["user_id"] == s1)

    # 교육생은 못 씀
    assert c.get(f"/admin/game/preset/{s1}?level=6", headers=hd["s1"]).status_code == 403
    r = c.get(f"/admin/game/preset/{s1}?level=6", headers=hd["ad"])
    assert r.status_code == 200, r.text
    pv = r.json()["plan"]
    assert pv["buildings"]["hq"] == 1 and pv["buildings"]["battery"] == 6 and pv["buildings"]["garage"] == 1, pv
    assert "landing" in pv["ships"] and len(pv["ships"]) == 6, pv["ships"]
    assert r.json()["backup"] is None
    # 미리 보기는 아무것도 안 바꿈
    assert sorted((b["type"], b["level"]) for b in db.TABLES["game_buildings"] if b["user_id"] == s1) == before

    r = c.post("/admin/game/preset", headers=hd["ad"], json={"user_id": s1, "level": 6})
    assert r.status_code == 200, r.text
    st = c.get("/game/state", headers=hd["s1"]).json()
    blds = st["buildings"]
    hq = next(b for b in blds if b["type"] == "hq")
    assert hq["level"] == 6
    assert all(b["level"] == min(6, game.BUILDINGS[b["type"]]["max"]) for b in blds), [(b["type"], b["level"]) for b in blds]
    assert sum(1 for b in blds if b["type"] == "mine") == game.defense_max("mine", 6)
    # 겹치는 건물 없음, 놓을 수 있는 자리
    grid, sea = st["reclaim"]["grid"], st["reclaim"]["sea"]
    assert grid == game.RECLAIM[game.RECLAIM_OPEN][0], grid
    raw = [b for b in db.TABLES["game_buildings"] if b["user_id"] == s1]
    for b in raw:
        assert game._free(raw, b["type"], b["x"], b["y"], skip_id=b["id"], grid=grid, sea=sea), (b["type"], b["x"], b["y"])
    assert len(st["fleet"]["ships"]) == 6 and st["fleet"]["cap"] == 6
    assert any(s["kind"] == "landing" for s in st["fleet"]["ships"])
    assert any(s["id"] == merchant for s in db.TABLES["game_ships"]), "상선은 그대로"
    base = next(b for b in db.TABLES["game_bases"] if b["user_id"] == s1)
    cr = game_raid.get_crews(base)
    assert sum(cr[k] for k in ("welder", "fitter", "piper", "safety")) == 8 + 6 * 5
    assert cr["crane"] + cr["forklift"] + cr["transporter"] == 2 + 2 * 5 and cr["crane"] > 0
    assert base["weapons"]["asm"] == 6 and base["tutorial_done"] is True
    keys = {r["key"] for r in game.ledger(s1)}
    assert {"hq_exam:2", "hq_exam:6"} <= keys
    hqb = next(b for b in raw if b["type"] == "hq")
    assert game.upgrade_block(hqb, raw, game.ledger(s1)) == "exam"   # 7레벨은 시험을 봐야 함
    info = c.get(f"/admin/game/preset/{s1}?level=3", headers=hd["ad"]).json()
    assert info["backup"]["level"] == 1 and info["log"][0]["what"] == "6" and info["log"][0]["by"] == "ad", info

    # 1레벨: 땅 14, 방어 시설 없음
    r = c.post("/admin/game/preset", headers=hd["ad"], json={"user_id": s1, "level": 1})
    st = c.get("/game/state", headers=hd["s1"]).json()
    assert st["reclaim"]["grid"] == 14 and not any(game.BUILDINGS[b["type"]].get("defense") for b in st["buildings"])
    # 8레벨: 바다 칸이 모자라면 못 놓은 개수를 알려 줌
    p8 = c.get(f"/admin/game/preset/{s1}?level=8", headers=hd["ad"]).json()["plan"]
    print("  level 8 short", p8["short"], "grid", p8["grid"])

    # 되돌리기: 마지막으로 맞추기 전(6레벨) 모습
    r = c.post("/admin/game/preset/undo", headers=hd["ad"], json={"user_id": s1, "level": 0})
    assert r.status_code == 200, r.text
    st = c.get("/game/state", headers=hd["s1"]).json()
    assert next(b for b in st["buildings"] if b["type"] == "hq")["level"] == 6 and len(st["fleet"]["ships"]) == 6
    r = c.post("/admin/game/preset/undo", headers=hd["ad"], json={"user_id": s1, "level": 0})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "no_backup"
    assert c.post("/admin/game/preset", headers=hd["ad"], json={"user_id": s1, "level": 9}).status_code == 400
    print("preset_check OK")


if __name__ == "__main__":
    main()
