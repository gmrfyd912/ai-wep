"""G2c-1 시험: 바다 지도(과정별 만·섬·해적 자리)와 정찰(하루 횟수·같은 섬 다시 보기·약탈 예상·같은 과정 설정).
실행: python -m tests.sea_check"""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

import accounts
import app as server
import game
import game_sea
from tests import fake_db as db
from tests.textbook_check import H

NOW = [datetime(2026, 12, 1, 1, 0, tzinfo=timezone.utc)]


def main():
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    game._now = lambda: NOW[0]
    c = TestClient(server.app)

    def user(lid, role="student"):
        u = db.insert_rows("users", {"login_id": lid, "login_key": lid, "name": lid, "role": role, "status": "active",
                                     "password_hash": accounts.hash_password("p")})[0]
        tok = c.post("/auth/login", json={"login_id": lid, "password": "p"}).json()["token"]
        return u["id"], H(tok)

    s1, S1 = user("s1")
    s2, S2 = user("s2")
    s3, S3 = user("s3")
    s4, S4 = user("s4")          # 과정 없음
    _, A = user("admin", "admin")
    ca = db.insert_rows("courses", {"name": "뉴딜2기", "sort": 1, "active": True})[0]["id"]
    cb = db.insert_rows("courses", {"name": "뉴딜3기", "sort": 2, "active": True})[0]["id"]
    for u_, c_ in ((s1, ca), (s2, ca), (s3, cb)):
        db.insert_rows("user_courses", {"user_id": u_, "course_id": c_})
    for S in (S1, S2, S3, S4):
        assert c.get("/game/state", headers=S).status_code == 200
    # s2 창고에 강판 1000 + 환영 500
    db.insert_rows("game_ledger", {"user_id": s2, "key": "gift", "steel": 1000, "rods": 500})

    d = c.get("/game/sea", headers=S1).json()
    names = sorted(b["name"] for b in d["bays"])
    assert names == ["", "뉴딜2기", "뉴딜3기"], names
    isl = {i["id"]: i for i in d["islands"]}
    assert set(isl) == {s1, s2, s3, s4}, isl.keys()
    assert isl[s1]["me"] and not isl[s1]["attackable"]
    assert isl[s2]["same"] and isl[s2]["attackable"], "같은 과정도 기본 공격 가능"
    assert not isl[s3]["same"] and isl[s3]["attackable"]
    assert len({(i["x"], i["y"]) for i in d["islands"]}) == 4, "섬 자리가 겹치면 안 됨"
    assert [p["stage"] for p in d["pirates"]] == [1, 2, 3, 4, 5, 6]
    assert d["pirates"][0]["open"] and not d["pirates"][1]["open"]
    assert d["scouts"] == {"used": 0, "max": 20} and d["loot_pct"] == 20
    # 같은 날 같은 입력이면 같은 자리, 다음 날엔 해적 자리가 바뀜
    assert c.get("/game/sea", headers=S1).json()["pirates"] == d["pirates"]
    NOW[0] += timedelta(days=1)
    moved = c.get("/game/sea", headers=S1).json()["pirates"]
    assert moved[:4] != d["pirates"][:4] and moved[4:] == d["pirates"][4:]

    # 정찰: 해적 1단계 (전투함 없음 → 예상 별 0, 웰디 '배 없음')
    r = c.post("/game/sea/scout", headers=S1, json={"kind": "pirate", "id": "1"}).json()
    assert r["stage"] == 1 and r["expect"] == 0 and r["tip"] == "pirate_noships" and r["scouts"]["used"] == 1, r
    assert r["buildings"][0]["type"] == "hq" and r["loot"]["steel"] > 0
    assert c.post("/game/sea/scout", headers=S1, json={"kind": "pirate", "id": "2"}).status_code == 400   # 1단계 별 없음
    # 교육생 정찰: 약탈 20% 예상, 정답률 배수는 안 보임
    r = c.post("/game/sea/scout", headers=S1, json={"kind": "user", "id": s2}).json()
    assert r["loot"]["steel"] == 300 and r["loot"]["rods"] == 160, r["loot"]   # (500+1000)×20%, (300+500)×20%
    assert r["same"] and r["attackable"] and r["scouts"]["used"] == 2
    assert all("mult" not in b and "rate" not in b for b in r["buildings"])
    assert {b["type"] for b in r["buildings"]} >= {"hq", "dock", "cutting"}
    # 같은 섬 다시 보기는 안 셈
    assert c.post("/game/sea/scout", headers=S1, json={"kind": "user", "id": s2}).json()["scouts"]["used"] == 2
    assert c.post("/game/sea/scout", headers=S1, json={"kind": "user", "id": s1}).status_code == 400   # 나 자신
    assert c.post("/game/sea/scout", headers=S1, json={"kind": "user", "id": "x"}).status_code == 404

    # 관리자: 같은 과정 공격 끄기 + 약탈 % + 정찰 한도
    st = c.get("/admin/game-settings", headers=A).json()["settings"]
    assert st["raid_same_course"] is True and st["raid_loot_pct"] == 20
    assert c.put("/admin/game-settings", headers=A, json={**st, "raid_loot_pct": 101}).status_code == 400
    r = c.put("/admin/game-settings", headers=A, json={**st, "raid_same_course": False, "raid_loot_pct": 10, "scout_day_max": 3})
    assert r.status_code == 200, r.text
    d = c.get("/game/sea", headers=S1).json()
    isl = {i["id"]: i for i in d["islands"]}
    assert not isl[s2]["attackable"] and isl[s3]["attackable"] and d["loot_pct"] == 10
    r = c.post("/game/sea/scout", headers=S1, json={"kind": "user", "id": s2}).json()
    assert r["loot"]["steel"] == 150 and not r["attackable"]
    c.post("/game/sea/scout", headers=S1, json={"kind": "user", "id": s3})
    r = c.post("/game/sea/scout", headers=S1, json={"kind": "user", "id": s4})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "scout_limit", r.text   # 3번 넘음
    assert c.post("/game/sea/scout", headers=S1, json={"kind": "user", "id": s2}).status_code == 200   # 본 섬은 됨
    # 교사는 못 들어감
    _, T = user("t1", "teacher")
    assert c.get("/game/sea", headers=T).status_code == 403
    # 배치: 30명 만도 섬이 안 겹침
    bays, spots, _ = game_sea.layout([{"id": "a", "name": "A"}], {"a": [str(i) for i in range(30)]})
    assert len(set(spots.values())) == 30
    print("sea_check OK")


if __name__ == "__main__":
    main()
