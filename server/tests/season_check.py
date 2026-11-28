"""G3 월 시즌 시험: 명성 순위(우리 반·전체·과정 고르기), 새 달 명성 절반, 지난 시즌 배지, 관리자 시험 끝내기,
이달의 해적 선단(열림 조건·달마다 다른 배치·이달 처음 딴 별마다 명성).
실행: PYTHONPATH=. python tests/season_check.py"""
from datetime import datetime, timezone

from fastapi.testclient import TestClient

import accounts
import app as server
import game
import game_battle as gb
import game_live as gl
import game_season as gs
from tests import fake_db as db
from tests.textbook_check import H

NOW = [datetime(2026, 11, 20, 1, 0, tzinfo=timezone.utc)]


def code(r):
    assert r.status_code >= 400, r.text
    return r.json()["detail"]["code"]


def main():
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    game._now = lambda: NOW[0]
    c = TestClient(server.app)
    ids, hd = {}, {}
    for n in ("s1", "s2", "s3", "s4", "adm"):
        u = db.insert_rows("users", {"login_id": n, "login_key": n, "name": n, "role": "admin" if n == "adm" else "student",
                                     "status": "active", "password_hash": accounts.hash_password("p")})[0]
        ids[n] = u["id"]
        hd[n] = H(c.post("/auth/login", json={"login_id": n, "password": "p"}).json()["token"])
    ca = db.insert_rows("courses", {"name": "가반", "sort": 1, "active": True})[0]["id"]
    cb = db.insert_rows("courses", {"name": "나반", "sort": 2, "active": True})[0]["id"]
    for n, cid in (("s1", ca), ("s2", ca), ("s3", ca), ("s4", cb)):
        db.insert_rows("user_courses", {"user_id": ids[n], "course_id": cid})
    for n in ("s1", "s2", "s3", "s4"):
        assert c.get("/game/state", headers=hd[n]).status_code == 200
    for n, f in (("s1", 100), ("s2", 60), ("s4", 80)):
        db.insert_rows("game_ledger", {"user_id": ids[n], "key": f"t{n}", "steel": 0, "rods": 0, "tech": 0, "passes": 0, "fame": f,
                                       "note": "", "created_at": "2026-11-10T00:00:00+00:00"})

    # 우리 반 순위
    v = c.get("/game/season", headers=hd["s1"]).json()
    assert v["on"] and v["season"] == "2026-11" and v["class_name"] == "가반", v
    assert [(r["name"], r["fame"], r["rank"]) for r in v["rows"]] == [("s1", 100, 1), ("s2", 60, 2), ("s3", 0, 3)], v["rows"]
    assert v["me"]["rank"] == 1 and v["keep_pct"] == 50
    # 전체, 과정 고르기
    v = c.get("/game/season?scope=all", headers=hd["s3"]).json()
    assert [r["name"] for r in v["rows"]] == ["s1", "s4", "s2", "s3"] and v["me"]["rank"] == 4 and v["rows"][1]["course"] == "나반", v
    v = c.get(f"/game/season?scope=all&course={cb}", headers=hd["s1"]).json()
    assert [r["name"] for r in v["rows"]] == ["s4"] and v["me"] is None, v

    # 이달의 해적 선단: 해적 6단계 별 1개부터 열림, 달마다 배치가 다름, 겹치는 칸 없음
    st7 = c.get("/game/pirate", headers=hd["s1"]).json()["stages"][-1]
    assert st7["no"] == 7 and st7["monthly"] and not st7["open"] and st7["reward"]["fame"] == 50, st7
    db.insert_rows("game_ledger", {"user_id": ids["s1"], "key": "pirate:6:1", "steel": 0, "rods": 0, "tech": 0, "passes": 0, "fame": 0,
                                   "note": "", "created_at": "2026-11-10T00:00:00+00:00"})
    assert c.get("/game/pirate", headers=hd["s1"]).json()["stages"][-1]["open"]
    for m in ("2026-11", "2026-12", "2027-01"):
        cells = []
        for o in gb.fleet_base(m):
            cells += [(o["x"] + dx, o["y"] + dy) for dx in range(o["w"]) for dy in range(o["h"])]
        assert len(cells) == len(set(cells)) and all(0 <= y < gb.MAP_H for _, y in cells), m
    assert [(o["x"], o["y"]) for o in gb.fleet_base("2026-11")] != [(o["x"], o["y"]) for o in gb.fleet_base("2026-12")]
    # 별 2개 → 명성 30, 같은 달 별 3개 → +20, 다시 3개 → 0, 다음 달 → 다시 받음
    user = {"id": ids["s1"], "name": "s1", "role": "student"}
    res = lambda n: {"stars": n, "crew_lost": {}, "ships": []}  # noqa: E731
    assert gl.apply_pirate(user, 7, res(2), "2026-11")["battle"]["got"]["fame"] == 30
    assert gl.apply_pirate(user, 7, res(3), "2026-11")["battle"]["got"]["fame"] == 20
    assert gl.apply_pirate(user, 7, res(3), "2026-11")["battle"]["got"]["fame"] == 0
    assert c.get("/game/pirate", headers=hd["s1"]).json()["stages"][-1]["stars"] == 3
    assert gb.fleet_best(game.ledger(ids["s1"]), "2026-12") == 0
    for r in db.TABLES["game_ledger"]:   # 가짜 DB 는 upsert 에 시간을 안 넣음 → 11월로
        r.setdefault("created_at", "2026-11-20T01:00:00+00:00")
    gs._cache.clear()

    # 관리자 시험: 이번 달 지금까지로 배지를 만들어 봄 (s1 150 금, s2 60 은, 나반 s4 금)
    r = c.post("/admin/game/season/finish", headers=hd["adm"])
    assert r.status_code == 200 and [b["badge"] for b in r.json()["top"]] == ["gold", "gold", "silver"], r.text
    assert c.post("/admin/game/season/finish", headers=hd["s1"]).status_code == 403

    # 새 달: 지난 시즌을 끝내 배지를 남기고(시험 표시는 다시 계산), 명성은 절반
    NOW[0] = datetime(2026, 12, 2, 1, 0, tzinfo=timezone.utc)
    db.insert_rows("game_ledger", {"user_id": ids["s2"], "key": "late", "steel": 0, "rods": 0, "tech": 0, "passes": 0, "fame": 100,
                                   "note": "", "created_at": "2026-11-30T10:00:00+00:00"})   # 11월 마지막 날 → s2 160 으로 1등
    v = c.get("/game/season", headers=hd["s1"]).json()
    assert v["season"] == "2026-12", v
    assert v["my_badges"] == [{"season": "2026-11", "badge": "silver", "rank": 2, "fame": 150}], v["my_badges"]
    bd = {b["user_id"]: b["badge"] for b in db.TABLES["game_season_badges"]}
    assert bd == {ids["s2"]: "gold", ids["s1"]: "silver", ids["s4"]: "gold"}, bd   # s3 은 명성을 안 얻어 배지 없음
    assert db.select("game_seasons", {"season": "eq.2026-11"})[0]["test"] is False
    fame = {r["name"]: r["fame"] for r in v["rows"]}
    assert fame == {"s1": 75, "s2": 80, "s3": 0}, fame   # 아직 안 연 사람도 절반으로 보여 줌
    assert v["rows"][0]["name"] == "s2" and v["rows"][0]["badge"] == "gold"
    # 게임을 열면 장부에 절반 줄이 한 번만 생김
    c.get("/game/state", headers=hd["s1"])
    c.get("/game/state", headers=hd["s1"])
    assert game.balance(game.ledger(ids["s1"]))["fame"] == 75
    assert sum(1 for r in game.ledger(ids["s1"]) if r["key"] == "season:2026-12") == 1

    # 끄면 화면 없음
    db.SETTINGS["game"] = {"season_on": False}
    game._settings_cache["raw"] = None
    assert c.get("/game/season", headers=hd["s1"]).json() == {"on": False}
    print("season_check OK")


if __name__ == "__main__":
    main()
