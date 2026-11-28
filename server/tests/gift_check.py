"""G3 자재 지원 시험: 같은 반 친구 목록, 하루 1번 보내기, 받는 횟수·창고 자리, '자재가 필요해요'.
실행: python -m tests.gift_check"""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

import accounts
import app as server
import game
from tests import fake_db as db
from tests.textbook_check import H

NOW = [datetime(2026, 12, 1, 1, 0, tzinfo=timezone.utc)]


def code(r):
    assert r.status_code >= 400, r.text
    return r.json()["detail"]["code"]


def main():
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    game._now = lambda: NOW[0]
    c = TestClient(server.app)
    ids, hd = {}, {}
    for n in ("s1", "s2", "s3", "s4", "s5", "x1"):
        u = db.insert_rows("users", {"login_id": n, "login_key": n, "name": n, "role": "student", "status": "active",
                                     "password_hash": accounts.hash_password("p")})[0]
        ids[n] = u["id"]
        hd[n] = H(c.post("/auth/login", json={"login_id": n, "password": "p"}).json()["token"])
    ca = db.insert_rows("courses", {"name": "뉴딜2기", "sort": 1, "active": True})[0]["id"]
    cb = db.insert_rows("courses", {"name": "특기병", "sort": 2, "active": True})[0]["id"]
    for n in ("s1", "s2", "s3", "s4", "s5"):
        db.insert_rows("user_courses", {"user_id": ids[n], "course_id": ca})
    db.insert_rows("user_courses", {"user_id": ids["x1"], "course_id": cb})
    for n in ids:
        assert c.get("/game/state", headers=hd[n]).status_code == 200
        db.insert_rows("game_ledger", {"user_id": ids[n], "key": "test_room", "steel": -300, "rods": -200, "tech": 0, "passes": 0,
                                       "fame": 0, "note": ""})
    # 같은 반 친구만 보임 (다른 반 x1 은 없음)
    v = c.get("/game/class", headers=hd["s1"]).json()
    names = {m["name"] for m in v["members"]}
    assert names == {"s2", "s3", "s4", "s5"} and v["amount"] == 100 and v["tech"] == 2 and v["sent"] is None, v
    # 다른 반에는 못 보냄
    assert code(c.post("/game/gift", headers=hd["s1"], json={"to": ids["x1"], "kind": "steel"})) == "gift_not_mate"
    # 자재가 필요해요 (하루 1번) → 친구 목록 맨 위에 표시
    r = c.post("/game/need", headers=hd["s2"], json={"kind": "rods"})
    assert r.status_code == 200 and r.json()["class"]["need"] == "rods", r.text
    assert code(c.post("/game/need", headers=hd["s2"], json={"kind": "steel"})) == "need_done"
    v = c.get("/game/class", headers=hd["s1"]).json()
    assert v["members"][0]["name"] == "s2" and v["members"][0]["need"] == "rods", v["members"][:2]
    # 보내기: 내 용접봉 -100, 기술 +2, 친구 용접봉 +100
    b1, b2 = game.balance(game.ledger(ids["s1"])), game.balance(game.ledger(ids["s2"]))
    r = c.post("/game/gift", headers=hd["s1"], json={"to": ids["s2"], "kind": "rods"})
    assert r.status_code == 200, r.text
    a1, a2 = game.balance(game.ledger(ids["s1"])), game.balance(game.ledger(ids["s2"]))
    assert a1["rods"] == b1["rods"] - 100 and a1["tech"] == b1["tech"] + 2 and a2["rods"] == b2["rods"] + 100, (a1, a2)
    assert r.json()["class"]["sent"] == ids["s2"]
    # 하루 1번만
    assert code(c.post("/game/gift", headers=hd["s1"], json={"to": ids["s3"], "kind": "steel"})) == "gift_sent"
    v2 = c.get("/game/class", headers=hd["s2"]).json()
    assert v2["got_today"] == [{"from": "s1", "steel": 0, "rods": 100}], v2["got_today"]
    # 한 사람이 하루에 받는 횟수 3번까지 (예시)
    for n in ("s3", "s4"):
        assert c.post("/game/gift", headers=hd[n], json={"to": ids["s2"], "kind": "steel"}).status_code == 200
    assert code(c.post("/game/gift", headers=hd["s5"], json={"to": ids["s2"], "kind": "steel"})) == "gift_recv_max"
    # 받는 친구 창고가 가득이면 못 보냄
    cap = game.caps(game._buildings(ids["s1"]))
    db.insert_rows("game_ledger", {"user_id": ids["s1"], "key": "fill", "steel": cap["steel"], "rods": 0, "tech": 0, "passes": 0,
                                   "fame": 0, "note": ""})
    assert code(c.post("/game/gift", headers=hd["s5"], json={"to": ids["s1"], "kind": "steel"})) == "gift_full"
    # 가진 것보다 많이는 못 보냄
    db.insert_rows("game_ledger", {"user_id": ids["s5"], "key": "drain", "steel": -10000, "rods": -10000, "tech": 0, "passes": 0,
                                   "fame": 0, "note": ""})
    assert code(c.post("/game/gift", headers=hd["s5"], json={"to": ids["s3"], "kind": "rods"})) == "gift_short"
    # 다음 날은 다시 보낼 수 있음
    NOW[0] = NOW[0] + timedelta(days=1)
    r = c.post("/game/gift", headers=hd["s1"], json={"to": ids["s3"], "kind": "steel"})
    assert r.status_code == 200, r.text
    # 관리자가 끄면 못 보냄
    db.SETTINGS["game"] = {**(db.SETTINGS.get("game") or {}), "gift_on": False}
    game._settings_cache["raw"] = None
    assert code(c.post("/game/gift", headers=hd["s2"], json={"to": ids["s3"], "kind": "rods"})) == "gift_off"
    print("gift_check OK")


if __name__ == "__main__":
    main()
