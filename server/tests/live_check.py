"""시간차 출동 전투 시험: 출동 준비(배마다 대원) → 시작(배는 기다림) → 배 보내기(되돌아가기 막음) → 끝내기·보상.
실행: PYTHONPATH=. python tests/live_check.py"""
import time
import uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient

import accounts
import app as server
import game
import game_battle as gb
import game_live as gl
from tests import fake_db as db
from tests.textbook_check import H

NOW = [datetime(2026, 12, 1, 1, 0, tzinfo=timezone.utc)]


def code(r):
    return r.json()["detail"]["code"]


def main():
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    game._now = lambda: NOW[0]
    c = TestClient(server.app)
    u = db.insert_rows("users", {"login_id": "s1", "login_key": "s1", "name": "s1", "role": "student", "status": "active",
                                 "password_hash": accounts.hash_password("p")})[0]
    S = H(c.post("/auth/login", json={"login_id": "s1", "password": "p"}).json()["token"])
    uid = u["id"]
    assert c.get("/game/state", headers=S).status_code == 200
    for b in db.TABLES["game_bases"]:
        b["crews"] = {"welder": 6, "fitter": 0, "forklift": 1, "transporter": 0, "pts": 0}
    fid, lid = str(uuid.uuid4()), str(uuid.uuid4())
    for sid, kind in ((fid, "frigate"), (lid, "landing")):
        db.insert_rows("game_ships", {"id": sid, "user_id": uid, "kind": kind, "stage": 4, "delivered_at": "2026-11-30T00:00:00+00:00",
                                      "hull": 1, "weapons": ["gun"], "damage": 0})

    # 출동 준비: 배 자리·가진 대원 확인
    assert code(c.post("/game/live/pirate/start", headers=S, json={"stage": 1, "ships": [fid], "loads": {fid: {"welder": 5}}})) == "crew_room"
    assert code(c.post("/game/live/pirate/start", headers=S, json={"stage": 1, "ships": [lid], "loads": {lid: {"welder": 7}}})) == "crew_short"
    assert code(c.post("/game/live/pirate/start", headers=S, json={"stage": 2, "ships": [fid]})) == "stage_locked"

    # 시작: 배는 아직 바다 밖에서 기다림 (화면에 안 보임)
    r = c.post("/game/live/pirate/start", headers=S, json={"stage": 1, "ships": [fid, lid], "loads": {lid: {"welder": 4, "forklift": 1}}})
    assert r.status_code == 200, r.text
    sid, bt = r.json()["id"], r.json()["battle"]
    assert bt["live"] and all(f["s"][0][4] == 1 and f["s"][1][4] == 1 for f in bt["frames"]), "배는 보내기 전엔 기다림"
    assert bt["ticks"] == gl.LIVE_TICKS and bt["ships"][1]["load"] == 5

    # 군함을 먼저 보냄 (0칸째, 남쪽 해안)
    r = c.post("/game/live/deploy", headers=S, json={"id": sid, "t": 0, "ship": 0, "y": 2.5})
    assert r.status_code == 200, r.text
    b1 = r.json()["battle"]
    assert b1["frames"][0]["s"][0][4] == 0 and b1["frames"][0]["s"][1][4] == 1
    assert any(f[0] == "s" for fr in b1["frames"] for f in fr["f"]), "군함이 쏨"
    # 같은 배는 두 번 못 보냄, 바다 밖 자리는 안 됨
    assert code(c.post("/game/live/deploy", headers=S, json={"id": sid, "t": 5, "ship": 0, "y": 3})) == "live_sent"
    assert code(c.post("/game/live/deploy", headers=S, json={"id": sid, "t": 5, "ship": 1, "y": 12})) == "bad_plan"
    # 시간이 흐른 뒤(지난 장면으로 되돌아가 보내기 막음): 서버 시계 20칸 지났는데 5칸째로 보내면 14칸째로 바뀜
    gl._live[sid]["at"] -= 20 * gb.TICK
    r = c.post("/game/live/deploy", headers=S, json={"id": sid, "t": 5, "ship": 1, "y": 7.5})
    assert r.status_code == 200, r.text
    b2 = r.json()["battle"]
    d = b2["deploys"]
    assert [x["ship"] for x in d] == [0, 1] and d[1]["t"] == 20 - gl.LATE_OK, d
    # 보낸 순간 앞 장면은 그대로 (화면이 끊기지 않게)
    k = d[1]["t"]
    assert b2["frames"][:k] == b1["frames"][:k]
    assert b2["landed_at"] is not None and b2["landed_at"] > k and any(fr["c"] for fr in b2["frames"])

    # 끝내기: 별·보상·다시 보기 기록, 두 번 눌러도 같은 결과
    r = c.post("/game/live/end", headers=S, json={"id": sid})
    assert r.status_code == 200, r.text
    fin = r.json()["battle"]
    assert fin["stars"] >= 1 and fin["got"]["steel"] > 0 and fin["note"]["id"], (fin["stars"], fin.get("got"))
    assert c.post("/game/live/end", headers=S, json={"id": sid}).json()["battle"]["id"] == fin["id"]
    assert code(c.post("/game/live/deploy", headers=S, json={"id": sid, "t": 50, "ship": 1, "y": 3})) == "live_gone"
    rb = c.get(f"/game/battle/{fin['id']}", headers=S).json()["battle"]
    assert rb["live"] and rb["deploys"] == d
    have = c.get("/game/pirate", headers=S).json()["crews"]["have"]
    assert have["welder"] == 6 - fin["crew_lost"]["welder"], (have, fin["crew_lost"])

    # 앱을 닫고 다시 시작하면: 지난 전투는 보낸 대로 저절로 끝남, 안 보낸 배는 다치지 않음
    for s in db.TABLES["game_ships"]:
        s["damage"] = 0
    r = c.post("/game/live/pirate/start", headers=S, json={"stage": 2, "ships": [fid, lid]})
    s2 = r.json()["id"]
    c.post("/game/live/deploy", headers=S, json={"id": s2, "t": 0, "ship": 0, "y": 5})
    r = c.post("/game/live/pirate/start", headers=S, json={"stage": 1, "ships": [lid]})
    assert r.status_code == 200 and gl._live[s2]["done"], r.text
    old = gl._live[s2]["result"]["battle"]
    assert old["ships"][1]["sent"] is False and old["ships"][1]["hp"] == old["ships"][1]["max_hp"]

    # 대원 없이 군함만 (해적 연습도 같은 방식): 해안을 따라 움직이며 끝까지 쏨
    res = gl.simulate_live(gb.pirate_base(1), [{"id": "a", "kind": "destroyer", "max_hp": 400, "attack": 60, "weapons": ["gun"]}],
                           [{}], [{"t": 0, "ship": 0, "y": 8.5}], gb.MAP_W, gb.MAP_H, gb.LAND_W)
    assert res["stars"] >= 2, (res["stars"], res["pct"])
    assert res["ticks"] < gl.LIVE_TICKS
    # 아무 배도 안 보내면: 별 0, 시간 끝까지
    res = gl.simulate_live(gb.pirate_base(1), [{"id": "a", "kind": "frigate", "max_hp": 300, "attack": 40, "weapons": ["gun"]}],
                           [{}], [], gb.MAP_W, gb.MAP_H, gb.LAND_W)
    assert res["stars"] == 0 and res["ticks"] == gl.LIVE_TICKS and gl.note_of(res)["id"] == "nosend"
    print("live_check OK", fin["stars"], fin["pct"], time.strftime("%H:%M:%S"))


if __name__ == "__main__":
    main()
