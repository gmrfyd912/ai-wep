"""G3 주간 반 대항전 시험: 짝 정하기(홀수 반은 혼자), 점수(공부·전투·하루 상한·안 연 사람 빼기), 토요일 결과, 보상 받기,
다음 주 혼자 반 바뀜·지난주 점수 도전, 관리자 '지금 짝 정하기'·'지금 결과 내기'.
실행: python -m tests.contest_check"""
from datetime import datetime, timezone

from fastapi.testclient import TestClient

import accounts
import app as server
import game
import game_contest as gc
from tests import fake_db as db
from tests.textbook_check import H

NOW = [datetime(2026, 11, 30, 1, 0, tzinfo=timezone.utc)]   # 월요일 10시 (한국)
AT = "2026-11-30T00:30:00+00:00"                             # 월요일 9시 30분 (한국)


def code(r):
    assert r.status_code >= 400, r.text
    return r.json()["detail"]["code"]


def main():
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    game._now = lambda: NOW[0]
    c = TestClient(server.app)
    ids, hd = {}, {}
    for n in ("s1", "s2", "s3", "s4", "s5", "adm"):
        u = db.insert_rows("users", {"login_id": n, "login_key": n, "name": n, "role": "admin" if n == "adm" else "student",
                                     "status": "active", "password_hash": accounts.hash_password("p")})[0]
        ids[n] = u["id"]
        hd[n] = H(c.post("/auth/login", json={"login_id": n, "password": "p"}).json()["token"])
    ca = db.insert_rows("courses", {"name": "가반", "sort": 1, "active": True})[0]["id"]
    cb = db.insert_rows("courses", {"name": "나반", "sort": 2, "active": True})[0]["id"]
    cc = db.insert_rows("courses", {"name": "다반", "sort": 3, "active": True})[0]["id"]
    for n, cid in (("s1", ca), ("s2", ca), ("s3", cb), ("s4", cb), ("s5", cc)):
        db.insert_rows("user_courses", {"user_id": ids[n], "course_id": cid})
    for n in ("s1", "s2", "s3", "s4", "s5"):
        assert c.get("/game/state", headers=hd[n]).status_code == 200
        db.insert_rows("game_ledger", {"user_id": ids[n], "key": "test_room", "steel": -400, "rods": -200, "tech": 0, "passes": 0,
                                       "fame": 0, "note": ""})
    # 가반·나반은 본관 2레벨, 다반은 1레벨 → 다반이 혼자
    for n in ("s1", "s2", "s3", "s4"):
        db.patch("game_buildings", {"user_id": f"eq.{ids[n]}", "type": "eq.hq"}, {"level": 2})
    # s2 는 이번 주 게임을 안 염 (평균에서 빠짐)
    db.patch("game_bases", {"user_id": f"eq.{ids['s2']}"}, {"last_seen_at": "2026-11-20T00:00:00+00:00"})

    # 이번 주 기록
    db.insert_rows("daily_sets", {"user_id": ids["s1"], "day": "2026-11-30", "question_ids": ["q1", "q2"]})
    for q in ("q1", "q2"):
        db.insert_rows("daily_answers", {"user_id": ids["s1"], "day": "2026-11-30", "question_id": q, "created_at": AT})
    for i in range(5):   # 돌발 OX 5개 맞힘 → +10 (공부 하루 18 상한)
        db.insert_rows("live_ox_answers", {"quiz_id": f"x{i}", "user_id": ids["s1"], "correct": True, "created_at": AT})
    db.insert_rows("live_ox_answers", {"quiz_id": "old", "user_id": ids["s1"], "correct": True,
                                       "created_at": "2026-11-29T10:00:00+00:00"})   # 지난주 → 안 셈
    for i in range(3):
        db.insert_rows("game_answers", {"user_id": ids["s4"], "source": "crew", "correct": True, "question_id": f"c{i}", "created_at": AT})
    db.insert_rows("game_answers", {"user_id": ids["s4"], "source": "supply", "correct": True, "question_id": "z", "created_at": AT})
    db.insert_rows("game_battles", {"id": "b1", "user_id": ids["s1"], "kind": "raid", "defender_id": ids["s3"], "stars": 2,
                                    "result": {}, "created_at": AT})
    db.insert_rows("game_battles", {"id": "b2", "user_id": ids["s3"], "kind": "raid", "defender_id": ids["s1"], "stars": 1,
                                    "result": {}, "created_at": AT})
    db.insert_rows("game_battles", {"id": "b3", "user_id": ids["s1"], "kind": "raid", "defender_id": ids["s5"], "stars": 3,
                                    "result": {}, "created_at": AT})   # 상대 반이 아님 → 안 셈
    db.insert_rows("game_battles", {"id": "b4", "user_id": ids["s5"], "kind": "pirate", "stars": 2,
                                    "result": {"first_stars": 2}, "created_at": AT})

    v = c.get("/game/contest", headers=hd["s1"]).json()
    assert v["on"] and v["ready"], v
    row = v["row"]
    assert row["us"]["name"] == "가반" and row["them"]["name"] == "나반" and not row["done"], row
    # s1: 공부 10+10=20 → 18, 전투 별2×3 + 막아 냄 5 = 11 / s2 는 빠짐 → 29
    assert row["me"] == {"study": 18, "battle": 11}, row["me"]
    assert row["us"]["score"] == 29 and row["rival_score"] == 3.0, row   # 나반: s3 별1×3 + s4 훈련 3 → 6/2
    assert v["caps"] == {"study": 18, "battle": 12}
    v5 = c.get("/game/contest", headers=hd["s5"]).json()["row"]
    assert v5["them"] is None and v5["target"] is None and v5["us"]["score"] == 4, v5

    # 토요일 0시가 지나면 결과
    NOW[0] = datetime(2026, 12, 4, 16, 0, tzinfo=timezone.utc)
    v = c.get("/game/contest", headers=hd["s1"]).json()
    assert v["row"]["done"] and v["row"]["won"] and v["reward"] == {"week": "2026-11-30", "won": True, "steel": 300, "rods": 150, "fame": 20}, v
    assert v["history"][0]["rival"] == "나반"
    # 창고가 꽉 차 있으면 먼저 알려 주고, '들어가는 만큼만'을 고르면 받음 (s4 는 진 반 → 강판 100)
    db.insert_rows("game_ledger", {"user_id": ids["s4"], "key": "fill", "steel": 100000, "rods": 0, "tech": 0, "passes": 0, "fame": 0, "note": ""})
    assert code(c.post("/game/contest/claim", headers=hd["s4"], json={"week": "2026-11-30"})) == "contest_full"
    r = c.post("/game/contest/claim", headers=hd["s4"], json={"week": "2026-11-30", "force": True})
    assert r.status_code == 200 and r.json()["got"]["steel"] == 0, r.text
    b = game.balance(game.ledger(ids["s1"]))
    r = c.post("/game/contest/claim", headers=hd["s1"], json={"week": "2026-11-30"})
    assert r.status_code == 200 and r.json()["contest"]["reward"] is None, r.text
    a = game.balance(game.ledger(ids["s1"]))
    assert a["fame"] == b["fame"] + 20 and a["rods"] == b["rods"] + 150 and a["steel"] == b["steel"] + 300, (a, b)
    assert code(c.post("/game/contest/claim", headers=hd["s1"], json={"week": "2026-11-30"})) == "contest_claimed"
    # 이긴 반은 모두 (안 연 s2 도), 진 반은 점수를 올린 사람만 강판 100
    assert c.get("/game/contest", headers=hd["s2"]).json()["reward"]["won"] is True
    v3 = c.get("/game/contest", headers=hd["s3"]).json()
    assert not v3["row"]["won"] and v3["reward"] == {"week": "2026-11-30", "won": False, "steel": 100, "rods": 0, "fame": 0}, v3
    # 다반(혼자, 지난주 기록 없음): 1점 이상이면 승리
    assert c.get("/game/contest", headers=hd["s5"]).json()["row"]["won"] is True
    # 주말에는 새 짝을 만들지 않음
    assert not db.select("game_contest", {"week": "eq.2026-12-07"})

    # 다음 주: 지난주 혼자였던 다반은 짝이 생기고, 가반이 혼자 (지난주 점수 29 도전)
    NOW[0] = datetime(2026, 12, 7, 1, 0, tzinfo=timezone.utc)
    v = c.get("/game/contest", headers=hd["s1"]).json()["row"]
    assert v["week"] == "2026-12-07" and v["them"] is None and v["target"] == 29, v
    assert c.get("/game/contest", headers=hd["s5"]).json()["row"]["them"]["name"] == "나반"

    # 관리자: 지금 결과 내기 → 지금 짝 정하기
    r = c.get("/admin/game/contest", headers=hd["adm"]).json()
    assert r["ready"] and len(r["rows"]) == 2, r
    assert c.post("/admin/game/contest/pair", headers=hd["s1"]).status_code == 403
    r = c.post("/admin/game/contest/finish", headers=hd["adm"])
    assert r.status_code == 200 and all(x["done"] for x in r.json()["rows"]), r.text
    assert code(c.post("/admin/game/contest/finish", headers=hd["adm"])) == "contest_none"
    r = c.post("/admin/game/contest/pair", headers=hd["adm"])
    assert r.status_code == 200 and not any(x["done"] for x in r.json()["rows"]), r.text
    # 끄면 화면 없음
    db.SETTINGS["game"] = {"contest_on": False}
    game._settings_cache["raw"] = None
    assert c.get("/game/contest", headers=hd["s1"]).json() == {"on": False}
    print("contest_check OK", gc.PTS)


if __name__ == "__main__":
    main()
