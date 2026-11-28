"""G3 교사 보드 게임 칸·관리자 게임 통계 시험.
실행: PYTHONPATH=. python tests/staff_check.py"""
from datetime import datetime, timezone

from fastapi.testclient import TestClient

import accounts
import app as server
import game
from tests import fake_db as db
from tests.textbook_check import H

NOW = [datetime(2026, 11, 30, 1, 0, tzinfo=timezone.utc)]   # 월요일 10시 (한국)
AT = "2026-11-30T00:30:00+00:00"


def main():
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    game._now = lambda: NOW[0]
    c = TestClient(server.app)
    ids, hd = {}, {}
    for n, role in (("s1", "student"), ("s2", "student"), ("s3", "student"), ("t1", "teacher"), ("t2", "teacher"), ("adm", "admin")):
        u = db.insert_rows("users", {"login_id": n, "login_key": n, "name": n, "role": role, "status": "active",
                                     "password_hash": accounts.hash_password("p")})[0]
        ids[n] = u["id"]
        hd[n] = H(c.post("/auth/login", json={"login_id": n, "password": "p"}).json()["token"])
    ca = db.insert_rows("courses", {"name": "가반", "sort": 1, "active": True})[0]["id"]
    cb = db.insert_rows("courses", {"name": "나반", "sort": 2, "active": True})[0]["id"]
    for n, cid in (("s1", ca), ("s2", ca), ("t1", ca), ("s3", cb)):
        db.insert_rows("user_courses", {"user_id": ids[n], "course_id": cid})
    for n in ("s1", "s2", "s3"):
        assert c.get("/game/state", headers=hd[n]).status_code == 200
    # s1: 공격 3번(1번은 다른 반), 매일 문제 0일 / s2: 매일 문제 1일
    for i, tgt in enumerate((ids["s3"], ids["s3"], ids["s2"])):
        db.insert_rows("game_battles", {"id": f"r{i}", "user_id": ids["s1"], "kind": "raid", "defender_id": tgt, "stars": 1,
                                        "result": {}, "created_at": AT})
    db.insert_rows("daily_sets", {"user_id": ids["s2"], "day": "2026-11-30", "question_ids": ["q1"]})
    db.insert_rows("daily_answers", {"user_id": ids["s2"], "day": "2026-11-30", "question_id": "q1", "created_at": AT})
    db.SETTINGS["game"] = {"staff_warn_attacks": 3, "staff_warn_days": 0}
    game._settings_cache["raw"] = None
    # 대항전 짝 (가반 vs 나반)
    assert c.get("/game/contest", headers=hd["s1"]).status_code == 200

    # 교육생은 못 봄
    assert c.get("/game/teacher", headers=hd["s1"]).status_code == 403
    # 교사: 내가 맡은 반만
    v = c.get("/game/teacher", headers=hd["t1"]).json()
    assert [x["name"] for x in v["classes"]] == ["가반"], v
    k = v["classes"][0]
    assert k["contest"]["rival"] == "나반", k["contest"]
    p = {x["name"]: x for x in k["people"]}
    assert p["s1"]["attacks"] == 3 and p["s1"]["warn"] and p["s1"]["battle"] == 6 and p["s1"]["days"] == 0, p["s1"]
    assert p["s2"]["days"] == 1 and p["s2"]["study"] == 10 and not p["s2"]["warn"], p["s2"]
    assert k["people"][0]["name"] == "s1"   # 표시된 학생이 맨 위
    # 맡은 반이 없는 교사는 빈 목록, 과정을 고르면 그 반
    assert c.get("/game/teacher", headers=hd["t2"]).json()["classes"] == []
    assert [x["name"] for x in c.get(f"/game/teacher?course={cb}", headers=hd["t2"]).json()["classes"]] == ["나반"]
    # 관리자는 모든 반
    assert len(c.get("/game/teacher", headers=hd["adm"]).json()["classes"]) == 2

    # 관리자 통계
    db.insert_rows("game_ledger", {"user_id": ids["s1"], "key": "pirate:1:2", "steel": 0, "rods": 0, "tech": 0, "passes": 0, "fame": 0, "note": ""})
    db.insert_rows("game_ledger", {"user_id": ids["s2"], "key": "pirate:1:1", "steel": 0, "rods": 0, "tech": 0, "passes": 0, "fame": 0, "note": ""})
    db.insert_rows("game_ledger", {"user_id": ids["s2"], "key": "pirate:2:1", "steel": 0, "rods": 0, "tech": 0, "passes": 0, "fame": 0, "note": ""})
    db.insert_rows("game_ledger", {"user_id": ids["s3"], "key": "drain", "steel": -100000, "rods": -100000, "tech": 0, "passes": 0, "fame": 0, "note": ""})
    db.insert_rows("game_ledger", {"user_id": ids["s2"], "key": "fill", "steel": 100000, "rods": 0, "tech": 0, "passes": 0, "fame": 0, "note": ""})
    db.insert_rows("game_ships", {"id": "sh1", "user_id": ids["s1"], "kind": "frigate", "stage": 4, "damage": 30})
    assert c.get("/admin/game/stats", headers=hd["t1"]).status_code == 403
    r = c.get("/admin/game/stats", headers=hd["adm"]).json()
    assert r["days"][-1] == {"day": "2026-11-30", "raid": 3, "pirate": 0}, r["days"]
    assert r["stages"][0] == {"stage": 1, "players": 2} and r["stages"][1]["players"] == 1, r["stages"]
    assert r["hq"]["avg"] == 1 and r["players"] == 3
    assert r["full"]["names"] == ["s2"] and "s3" in r["low"]["names"] and r["repair"] == {"ships": 1, "players": 1}, r
    print("staff_check OK")


if __name__ == "__main__":
    main()
