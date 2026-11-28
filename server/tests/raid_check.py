"""G2c-2 시험: 대원 훈련(문제 → 훈련 점수)·대원 뽑기·작전(상륙 부두·목표 순서)·상륙 전투·쓰러진 대원만 잃기.
실행: python -m tests.raid_check"""
import uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient

import accounts
import app as server
import game
import game_battle as gb
import game_raid as gr
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
    bid = db.insert_rows("textbooks", {"title": "교재", "pages": 9, "page_offset": 0, "toc": [], "is_current": True,
                                       "status": "ready", "show_students": True, "use_for_ai": True})[0]["id"]
    for i in range(6):
        db.insert_rows("quiz_questions", {"book_id": bid, "unit_key": "0-0", "unit_title": "제1장", "kind": "ox", "question": f"OX {i}",
                                          "choices": ["O", "X"], "answer": 0, "status": "active", "translations": {}})
    for i in range(3):
        db.insert_rows("quiz_questions", {"book_id": bid, "unit_key": "0-0", "unit_title": "제1장", "kind": "mc", "question": f"MC {i}",
                                          "choices": ["a", "b", "c", "d"], "answer": 2, "status": "active", "translations": {}})
    assert c.get("/game/state", headers=S).status_code == 200

    # 처음: 대원 0, 숙소 = 10 + 본관 1 × 4
    p = c.get("/game/pirate", headers=S).json()
    cr = p["crews"]
    assert cr["have"] == {"welder": 0, "fitter": 0, "forklift": 0, "transporter": 0} and cr["pts"] == 0 and cr["cap"] == 14, cr
    assert p["map"] == {"w": 14, "h": 10, "land": 6, "lanes": gb.LANES}

    # 대원 훈련: 문제 3개(OX 2 + 객관식 1) → 맞힌 수만큼 훈련 점수
    t = c.post("/game/crew/train/start", headers=S, json={"lang": "ko"}).json()
    assert t["total"] == 3, t
    ans = {q["id"]: (0 if q["kind"] == "ox" else 2) for q in t["questions"]}
    wrong = t["questions"][0]["id"]
    ans[wrong] = 1
    r = c.post("/game/crew/train/submit", headers=S, json={"id": t["id"], "answers": ans}).json()
    assert r["right"] == 2 and r["crews"]["pts"] == 2, r
    assert c.post("/game/crew/train/submit", headers=S, json={"id": t["id"], "answers": ans}).status_code == 400   # 두 번 안 됨
    assert {a["source"] for a in db.TABLES["game_answers"]} == {"crew"}
    # 다음 훈련은 안 낸 문제부터
    t2 = c.post("/game/crew/train/start", headers=S, json={"lang": "ko"}).json()
    assert not set(q["id"] for q in t2["questions"]) & set(ans), "같은 문제 반복"
    c.post("/game/crew/train/submit", headers=S, json={"id": t2["id"], "answers": {q["id"]: (0 if q["kind"] == "ox" else 2) for q in t2["questions"]}})

    # 뽑기: 점수 5 → 용접사 2(2점) + 지게차 1(3점), 더는 점수 부족
    assert c.post("/game/crew/hire", headers=S, json={"kind": "welder", "n": 2}).status_code == 200
    r = c.post("/game/crew/hire", headers=S, json={"kind": "forklift", "n": 1}).json()
    assert r["crews"]["have"]["welder"] == 2 and r["crews"]["have"]["forklift"] == 1 and r["crews"]["pts"] == 0, r
    assert code(c.post("/game/crew/hire", headers=S, json={"kind": "fitter", "n": 1})) == "crew_pts"
    assert code(c.post("/game/crew/hire", headers=S, json={"kind": "boss", "n": 1})) == "bad_kind"
    # 숙소가 차면 못 뽑음
    for b in db.TABLES["game_bases"]:
        b["crews"] = {**b["crews"], "pts": 100}
    assert code(c.post("/game/crew/hire", headers=S, json={"kind": "welder", "n": 12})) == "crew_full"
    for b in db.TABLES["game_bases"]:
        b["crews"] = {**b["crews"], "pts": 0}

    # 전투함 1척 (호위함: 대원 4명까지)
    sid = str(uuid.uuid4())
    db.insert_rows("game_ships", {"id": sid, "user_id": uid, "kind": "frigate", "stage": 4, "delivered_at": "2026-11-30T00:00:00+00:00",
                                  "hull": 1, "weapons": ["gun"], "damage": 0})
    plan = {"stage": 1, "ships": [sid], "lane": "north", "landing": 2, "order": [0]}
    assert code(c.post("/game/pirate/attack", headers=S, json={**plan, "crews": {"welder": 3}})) == "crew_short"
    assert code(c.post("/game/pirate/attack", headers=S, json={**plan, "landing": 10, "crews": {}})) == "bad_plan"
    for b in db.TABLES["game_bases"]:
        b["crews"] = {"welder": 6, "fitter": 0, "forklift": 1, "transporter": 0, "pts": 0}
    assert code(c.post("/game/pirate/attack", headers=S, json={**plan, "crews": {"welder": 5}})) == "crew_room"
    r = c.post("/game/pirate/attack", headers=S, json={**plan, "crews": {"welder": 2, "forklift": 1}})
    assert r.status_code == 200, r.text
    bt = r.json()["battle"]
    assert bt["raid"] and bt["landing"] == 2 and bt["order"] == [0] and bt["landed_at"] is not None, {k: bt[k] for k in ("raid", "landed_at")}
    assert bt["crew_sent"] == {"welder": 2, "fitter": 0, "forklift": 1, "transporter": 0}
    assert any(f["c"] for f in bt["frames"]) and len(bt["crews"]) == 3
    assert bt["stars"] >= 1 and bt["got"]["steel"] > 0, (bt["stars"], bt.get("got"))
    lost = bt["crew_lost"]
    have = c.get("/game/pirate", headers=S).json()["crews"]["have"]
    assert have["welder"] == 6 - lost["welder"] and have["forklift"] == 1 - lost["forklift"], (have, lost)
    # 다시 보기에도 대원이 들어 있음
    rb = c.get(f"/game/battle/{bt['id']}", headers=S).json()["battle"]
    assert rb["raid"] and rb["crews"]

    # 상륙함: 대원 12명까지 태움 (호위함 4명보다 많이)
    lid = str(uuid.uuid4())
    db.insert_rows("game_ships", {"id": lid, "user_id": uid, "kind": "landing", "stage": 4, "delivered_at": "2026-11-30T00:00:00+00:00",
                                  "hull": 1, "weapons": ["gun"], "damage": 0})
    for b in db.TABLES["game_bases"]:
        b["crews"] = {"welder": 14, "fitter": 0, "forklift": 0, "transporter": 0, "pts": 0}
    lplan = {**plan, "stage": 2, "ships": [lid]}
    assert code(c.post("/game/pirate/attack", headers=S, json={**lplan, "crews": {"welder": 13}})) == "crew_room"
    r = c.post("/game/pirate/attack", headers=S, json={**lplan, "crews": {"welder": 12}})
    assert r.status_code == 200, r.text
    assert r.json()["battle"]["crew_sent"]["welder"] == 12

    # 같은 입력이면 같은 결과
    base = gb.pirate_base(2)
    ships = [{"id": "a", "kind": "frigate", "max_hp": 260, "attack": 57, "weapons": ["gun"]}]
    a = gr.simulate_raid(gb.pirate_base(2), [dict(x) for x in ships], "middle", 5, [0], {"welder": 3}, 14, 10, 6, gb.LANES)
    b = gr.simulate_raid(gb.pirate_base(2), [dict(x) for x in ships], "middle", 5, [0], {"welder": 3}, 14, 10, 6, gb.LANES)
    assert a["frames"] == b["frames"] and len(base) == len(a["base"])
    # 목표 순서: 벽·기뢰는 빼고 최대 3개
    walls = [o["id"] for o in base if o["type"] == "wall"]
    a = gr.simulate_raid(gb.pirate_base(2), [dict(x) for x in ships], "middle", 5, walls + [1, 2, 3, 4], {}, 14, 10, 6, gb.LANES)
    assert a["order"] == [1, 2, 3] and a["landed_at"] is None
    print("raid_check OK", {"stars": bt["stars"], "lost": lost})


if __name__ == "__main__":
    main()
