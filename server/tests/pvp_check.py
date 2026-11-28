"""G2c-3 시험: 교육생끼리 상륙 공격·사기 3문제·약탈·보호막·하루 한도·시간 잠금·방어 기록·다시 보기·복수.
실행: python -m tests.pvp_check"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

import accounts
import app as server
import game
import game_sea as gs
import game_pvp as gp
from tests import fake_db as db
from tests.textbook_check import H

# 2026-12-01(화) 19:00 KST — 수업 시간·밤 잠금 밖
NOW = [datetime(2026, 12, 1, 10, 0, tzinfo=timezone.utc)]


def code(r):
    return r.json()["detail"]["code"]


def setst(**kw):
    db.SETTINGS["game"] = {**(db.SETTINGS.get("game") or {}), **kw}
    game._settings_cache["raw"] = None


def main():
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    game._now = lambda: NOW[0]
    c = TestClient(server.app)
    ids, hd = {}, {}
    for n in ("s1", "s2", "s3"):
        u = db.insert_rows("users", {"login_id": n, "login_key": n, "name": n, "role": "student", "status": "active",
                                     "password_hash": accounts.hash_password("p")})[0]
        ids[n] = u["id"]
        hd[n] = H(c.post("/auth/login", json={"login_id": n, "password": "p"}).json()["token"])
    ca = db.insert_rows("courses", {"name": "뉴딜2기", "sort": 1, "active": True})[0]["id"]
    for n in ("s1", "s2"):
        db.insert_rows("user_courses", {"user_id": ids[n], "course_id": ca})
    bid = db.insert_rows("textbooks", {"title": "교재", "pages": 9, "page_offset": 0, "toc": [], "is_current": True,
                                       "status": "ready", "show_students": True, "use_for_ai": True})[0]["id"]
    for i in range(30):
        db.insert_rows("quiz_questions", {"book_id": bid, "unit_key": "0-0", "unit_title": "제1장", "kind": "ox", "question": f"OX {i}",
                                          "choices": ["O", "X"], "answer": 0, "status": "active", "translations": {}})
    for i in range(15):
        db.insert_rows("quiz_questions", {"book_id": bid, "unit_key": "0-0", "unit_title": "제1장", "kind": "mc", "question": f"MC {i}",
                                          "choices": ["a", "b", "c", "d"], "answer": 2, "status": "active", "translations": {}})
    for n in ids:
        assert c.get("/game/state", headers=hd[n]).status_code == 200
    # 상대 창고: 강판 1000·용접봉 500 (약탈 20% = 200·100)
    for n in ("s2", "s3"):
        db.insert_rows("game_ledger", {"user_id": ids[n], "key": "test_gift", "steel": 1000, "rods": 500, "tech": 0, "passes": 0,
                                       "fame": 0, "note": ""})
    # 공격하는 쪽: 상륙함 1척 + 용접사 12
    for n in ("s1", "s2"):
        db.insert_rows("game_ships", {"id": str(uuid.uuid4()), "user_id": ids[n], "kind": "landing", "stage": 4,
                                      "delivered_at": "2026-11-30T00:00:00+00:00", "hull": 1, "weapons": ["gun"], "damage": 0})
    for b in db.TABLES["game_bases"]:
        b["crews"] = {"welder": 12, "fitter": 0, "forklift": 0, "transporter": 0, "pts": 0}
    ship = {n: next(s["id"] for s in db.TABLES["game_ships"] if s["user_id"] == ids[n]) for n in ("s1", "s2")}

    def ans(q):
        return {x["id"]: (0 if x["kind"] == "ox" else 2) for x in q["questions"]}

    def attack(who, target, right=3, **extra):
        q = c.post("/game/raid/morale/start", headers=hd[who], json={"lang": "ko"}).json()
        a = ans(q)
        for x in q["questions"][:3 - right]:
            a[x["id"]] = 1
        body = {"target": ids[target], "ships": [ship[who]], "loads": {ship[who]: {"welder": 12}},
                "morale_id": q["id"], "answers": a, **extra}
        for s in db.TABLES["game_ships"]:   # 시험마다 수리된 상태로
            s["damage"] = 0
        return live_raid(who, body)

    def live_raid(who, body, y=None):
        """시간차 출동 전투로 공격: 시작 → 배를 처음에 보냄 → 끝 (끝 응답에 results 를 붙여 돌려줌)."""
        r0 = c.post("/game/live/raid/start", headers=hd[who], json=body)
        if r0.status_code != 200:
            return r0
        lid, mh = r0.json()["id"], r0.json()["battle"]["map"]["h"]
        for i in range(len(body["ships"])):
            c.post("/game/live/deploy", headers=hd[who], json={"id": lid, "t": 0, "ship": i, "y": mh / 2 if y is None else y})
        return c.post("/game/live/end", headers=hd[who], json={"id": lid})

    # 시간 잠금: 평일 10시(수업) / 23시(밤)
    st = game.settings()
    # 기본은 24시간 365일 공격 가능 (박사 결정), 관리자가 켜면 수업 시간·밤 잠금
    assert st["raid_time_lock"] is False and gp.time_locked(st, datetime(2026, 12, 1, 1, 0, tzinfo=timezone.utc)) is None
    setst(raid_time_lock=True)
    st = game.settings()
    assert gp.time_locked(st, datetime(2026, 12, 1, 1, 0, tzinfo=timezone.utc)) == "class"
    assert gp.time_locked(st, datetime(2026, 12, 1, 14, 0, tzinfo=timezone.utc)) == "night"
    assert gp.time_locked(st, datetime(2026, 12, 5, 1, 0, tzinfo=timezone.utc)) is None    # 토요일 낮
    assert gp.time_locked(st, NOW[0]) is None
    assert gp.morale_mult(0, 3) == 0.8 and gp.morale_mult(3, 3) == 1.2

    # 작전 지도: 본관이 0번, 바다 길 3개
    tg = c.get(f"/game/raid/target/{ids['s2']}", headers=hd["s1"]).json()
    assert tg["base"][0]["type"] == "hq" and tg["map"]["land"] == 32 and set(tg["map"]["lanes"]) == {"north", "middle", "south"}, tg["map"]
    b2 = game.balance(game.ledger(ids["s2"]))
    assert tg["loot"] == {"steel": int(b2["steel"] * 0.2), "rods": int(b2["rods"] * 0.2)}, (tg["loot"], b2)
    # 오늘 매일 문제를 안 풀었으면 막힘 (기본 켜짐)
    assert tg["block"] == "need_daily", tg["block"]
    assert code(attack("s1", "s2")) == "raid_need_daily"
    setst(raid_need_daily=False)
    assert c.get(f"/game/raid/target/{ids['s2']}", headers=hd["s1"]).json()["block"] is None
    # 같은 과정 끄기
    setst(raid_same_course=False)
    assert code(attack("s1", "s2")) == "raid_same_course"
    setst(raid_same_course=True)
    # 수업 시간 잠금
    NOW[0] = datetime(2026, 12, 1, 2, 0, tzinfo=timezone.utc)
    r = attack("s1", "s2")
    assert code(r) == "raid_time_lock" and r.json()["detail"]["why"] == "class", r.json()
    NOW[0] = datetime(2026, 12, 1, 10, 0, tzinfo=timezone.utc)
    # 3문제 없이(또는 지난 번호로)는 못 감
    bad = c.post("/game/live/raid/start", headers=hd["s1"], json={"target": ids["s2"], "ships": [ship["s1"]], "morale_id": "x"})
    assert code(bad) == "exam_gone"

    # 공격! (3문제 다 맞힘 → 사기 1.2배)
    s2_before = game.balance(game.ledger(ids["s2"]))
    r = attack("s1", "s2", right=3)
    assert r.status_code == 200, r.text
    bt = r.json()["battle"]
    assert bt["kind"] == "raid" and bt["raid"] and bt["morale"] == {"right": 3, "total": 3, "mult": 1.2}, bt["morale"]
    assert bt["defender"]["id"] == ids["s2"] and bt["map"]["land"] == 32
    share = gp.STAR_LOOT[bt["stars"]]
    assert bt["lost"]["steel"] <= int(tg["loot"]["steel"] * share) and bt["got"]["steel"] == bt["lost"]["steel"], (bt["stars"], bt["got"], bt["lost"])
    s2_after = game.balance(game.ledger(ids["s2"]))
    assert s2_after["steel"] == s2_before["steel"] - bt["lost"]["steel"], (s2_before, s2_after)
    if bt["stars"] <= 1:
        assert bt["defend"]["fame"] == gp.DEFEND_FAME and s2_after["fame"] == gp.DEFEND_FAME, (bt["stars"], bt["defend"], s2_after)
    assert {a["source"] for a in db.TABLES["game_answers"]} == {"morale"}
    # 건물은 그대로 (실제로 부서지지 않음)
    assert all(b["level"] >= 1 for b in db.TABLES["game_buildings"] if b["user_id"] == ids["s2"])
    # 보호막·같은 친구 하루 1번
    assert gp.shield_left(next(b for b in db.TABLES["game_bases"] if b["user_id"] == ids["s2"])) == 8 * 3600
    setst(raid_need_daily=False)
    db.insert_rows("game_ships", {"id": str(uuid.uuid4()), "user_id": ids["s3"], "kind": "frigate", "stage": 4,
                                  "delivered_at": "2026-11-30T00:00:00+00:00", "hull": 1, "weapons": ["gun"], "damage": 0})
    ship["s3"] = db.TABLES["game_ships"][-1]["id"]
    r3 = attack("s3", "s2")
    assert code(r3) == "raid_shield" and r3.json()["detail"]["left"] > 0
    NOW[0] = NOW[0] + timedelta(hours=9)   # 다음 날 04:00 KST → 밤 잠금
    assert code(attack("s3", "s2")) == "raid_time_lock"
    NOW[0] = datetime(2026, 12, 1, 10, 30, tzinfo=timezone.utc)
    for b in db.TABLES["game_bases"]:
        if b["user_id"] == ids["s2"]:
            b["shield_until"] = None
    assert code(attack("s1", "s2")) == "raid_same_today"
    # 하루 한도
    setst(raid_day_max=1)
    assert code(attack("s1", "s3")) == "raid_day_max"
    setst(raid_day_max=3)
    # 관리자 스위치
    setst(raid_pvp=False)
    assert code(attack("s1", "s3")) == "raid_pvp_off"
    assert c.get("/game/sea", headers=hd["s1"]).json()["raid_open"] is False
    setst(raid_pvp=True)
    sea = c.get("/game/sea", headers=hd["s1"]).json()
    assert sea["raid_open"] is True

    # 방어 기록 (s2): 알림 1개 → 봤어요 → 0
    d = c.get("/game/defense", headers=hd["s2"]).json()
    assert d["ready"] and len(d["log"]) == 1 and d["unseen"] == 1, d
    row = d["log"][0]
    assert row["by"] == "s1" and row["lane"] == "middle" and row["lost"] == bt["lost"]
    assert c.post("/game/defense/seen", headers=hd["s2"]).status_code == 200
    assert c.get("/game/defense", headers=hd["s2"]).json()["unseen"] == 0
    # 다시 보기: 공격한 사람·공격받은 사람만
    assert c.get(f"/game/battle/{bt['id']}", headers=hd["s2"]).status_code == 200
    assert c.get(f"/game/battle/{bt['id']}", headers=hd["s1"]).status_code == 200
    assert c.get(f"/game/battle/{bt['id']}", headers=hd["s3"]).status_code == 404
    # 해적 전투 기록에는 안 섞임
    assert c.get("/game/pirate", headers=hd["s1"]).json()["history"] == []

    # 방어하다 쓰러진 s2 대원은 부상 (1시간 뒤 돌아옴) → 그동안 출동 못 함
    s2b = next(b for b in db.TABLES["game_bases"] if b["user_id"] == ids["s2"])
    if any(bt["guard_lost"].values()):
        assert s2b["crews"].get("hurt"), s2b["crews"]
    assert bt["guard_sent"]["welder"] == 12, bt["guard_sent"]
    s2b["crews"]["hurt"] = []
    # 복수 1번 (s2 → s1): 규칙은 그대로, 두 번은 안 됨
    assert row["revenge_block"] is None, row
    r = attack("s2", "s1", right=0, revenge=bt["id"])
    assert r.status_code == 200, r.text
    assert r.json()["battle"]["revenge"] and r.json()["battle"]["morale"]["mult"] == 0.8
    assert c.get("/game/defense", headers=hd["s2"]).json()["log"][0]["revenge_used"] is True
    for b in db.TABLES["game_bases"]:
        b["shield_until"] = None
    NOW[0] = NOW[0] + timedelta(days=1)
    assert code(attack("s2", "s1", revenge=bt["id"])) == "revenge_used"
    # 남의 전투로 복수 못 함
    assert code(attack("s3", "s1", revenge=bt["id"])) == "revenge_used"

    # 대원 없이 호위함만 → 별 0~1개면 막아 낸 쪽(s1)에 용접봉·명성
    for b in db.TABLES["game_bases"]:
        b["shield_until"] = None
    q = c.post("/game/raid/morale/start", headers=hd["s3"], json={"lang": "ko"}).json()
    r = live_raid("s3", {"target": ids["s1"], "ships": [ship["s3"]], "morale_id": q["id"], "answers": ans(q)}, y=2.5)
    assert r.status_code == 200, r.text
    b3 = r.json()["battle"]
    if b3["stars"] <= 1:
        assert b3["defend"]["fame"] == gp.DEFEND_FAME and any(x["key"] == f"defend:{b3['id']}" for x in db.TABLES["game_ledger"])
    print("  no-crew raid stars", b3["stars"], b3["defend"])
    # 방어 팁: 같은 길로 2번 이상 뚫리면 그 길
    tip = gp.defense_tip([{"stars": 2, "lane": "north"}, {"stars": 3, "lane": "north"}, {"stars": 0, "lane": "south"}])
    assert tip == {"id": "lane", "lane": "north", "n": 2}, tip
    assert gp.defense_tip([{"stars": 0, "lane": "north"}]) == {"id": "strong"}

    # 시간차 출동 전투로 친구 조선소 공격: 3문제 → 시작 → 배 보내기 → 끝 (같은 결과 반영)
    import game_live as gl
    for b in db.TABLES["game_bases"]:
        b["shield_until"] = None
        b["crews"] = {"welder": 12, "fitter": 0, "forklift": 0, "transporter": 0, "pts": 0}
    for s_ in db.TABLES["game_ships"]:
        s_["damage"] = 0
    NOW[0] = NOW[0] + timedelta(days=1)
    s2_before = game.balance(game.ledger(ids["s2"]))
    q = c.post("/game/raid/morale/start", headers=hd["s1"], json={"lang": "ko"}).json()
    body = {"target": ids["s2"], "ships": [ship["s1"]], "loads": {ship["s1"]: {"welder": 12}}, "morale_id": q["id"], "answers": ans(q)}
    r = c.post("/game/live/raid/start", headers=hd["s1"], json=body)
    assert r.status_code == 200, r.text
    lid, lb = r.json()["id"], r.json()["battle"]
    assert lb["live"] and lb["kind"] == "raid" and lb["morale"]["mult"] == 1.2 and lb["map"]["land"] == 32, lb.get("morale")
    # 공격 중인 조선소는 다른 교육생이 못 침
    assert gl._busy(ids["s2"], ids["s3"]) is True and gl._busy(ids["s2"], ids["s1"]) is False
    r = c.post("/game/live/deploy", headers=hd["s1"], json={"id": lid, "t": 0, "ship": 0, "y": 16})
    assert r.status_code == 200, r.text
    # 서버가 다시 켜져도 (메모리 비움) 표에서 불러와 공격 중 잠금·끝내기가 이어짐
    gl._live.clear()
    assert gl._busy(ids["s2"], ids["s3"]) is True
    gl._live.clear()
    r = c.post("/game/live/end", headers=hd["s1"], json={"id": lid})
    assert r.status_code == 200, r.text
    lv = r.json()["battle"]
    assert lv["kind"] == "raid" and lv["id"] and lv["lane"] == "middle" and lv["got"]["steel"] == lv["lost"]["steel"], lv.get("lost")
    s2_after = game.balance(game.ledger(ids["s2"]))
    assert s2_after["steel"] == s2_before["steel"] - lv["lost"]["steel"] + 0, (s2_before, s2_after)
    log = c.get("/game/defense", headers=hd["s2"]).json()["log"]
    assert log[0]["id"] == lv["id"] and log[0]["lane"] == "middle"
    rb = c.get(f"/game/battle/{lv['id']}", headers=hd["s2"])
    assert rb.status_code == 200 and rb.json()["battle"]["deploys"] == lv["deploys"], rb.text[:200]
    assert gl._busy(ids["s2"], ids["s3"]) is False
    # 같은 3문제로 또 시작 못 함
    r = c.post("/game/live/raid/start", headers=hd["s1"], json=body)
    assert code(r) in ("exam_gone", "raid_shield", "raid_same_target"), r.text
    print("  live raid stars", lv["stars"], lv["lost"])

    # ---- G3 공정한 공격: 신입 보호·쉬는 중·레벨 차이·관리자가 바꾸면 보호 끝 ----
    st = game.settings()
    assert st["raid_newbie_days"] == 3 and st["raid_level_gap"] == 3 and st["raid_rest_days"] == 7
    NOW[0] = NOW[0] + timedelta(days=1)
    for b in db.TABLES["game_bases"]:
        b["shield_until"] = None
        b["created_at"] = "2020-01-01T00:00:00+00:00"
        b["last_seen_at"] = NOW[0].isoformat()
    b3 = next(b for b in db.TABLES["game_bases"] if b["user_id"] == ids["s3"])
    b3["created_at"] = (NOW[0] - timedelta(days=1)).isoformat()      # s3 은 어제 처음 들어온 신입
    assert any(x["key"] == gp.NEWBIE_KEY and x["user_id"] == ids["s3"] for x in db.TABLES["game_ledger"])   # 앞에서 먼저 공격함
    db.TABLES["game_ledger"] = [x for x in db.TABLES["game_ledger"] if x["key"] != gp.NEWBIE_KEY]
    tg = c.get(f"/game/raid/target/{ids['s3']}", headers=hd["s1"]).json()
    assert tg["block"] == "newbie" and tg["block_info"]["d"] == 2, (tg["block"], tg["block_info"])   # 3일 중 2일 남음
    sea = c.get("/game/sea", headers=hd["s1"]).json()
    i3 = next(i for i in sea["islands"] if i["id"] == ids["s3"])
    assert i3["protect"] == "newbie" and i3["shield"] > 0 and not i3["attackable"], i3
    # 신입이 먼저 공격하면 보호 끝
    gp.end_newbie(ids["s3"])
    assert c.get(f"/game/raid/target/{ids['s3']}", headers=hd["s1"]).json()["block"] != "newbie"
    # 7일 넘게 안 들어온 교육생은 쉬는 중
    b3["last_seen_at"] = (NOW[0] - timedelta(days=8)).isoformat()
    assert c.get(f"/game/raid/target/{ids['s3']}", headers=hd["s1"]).json()["block"] == "resting"
    b3["last_seen_at"] = NOW[0].isoformat()
    # 본관이 3레벨 이상 낮으면 공격 못 함 (2레벨 차이는 약탈 절반만)
    hq1 = next(b for b in db.TABLES["game_buildings"] if b["user_id"] == ids["s1"] and b["type"] == "hq")
    hq3 = next(b for b in db.TABLES["game_buildings"] if b["user_id"] == ids["s3"] and b["type"] == "hq")
    hq3["level"], hq1["level"] = 1, 4
    gs.forget_world()
    tg = c.get(f"/game/raid/target/{ids['s3']}", headers=hd["s1"]).json()
    assert tg["block"] == "level_gap" and tg["block_info"]["gap"] == 3, (tg["block"], tg["block_info"])
    i3 = next(i for i in c.get("/game/sea", headers=hd["s1"]).json()["islands"] if i["id"] == ids["s3"])
    assert i3["gap"] and not i3["attackable"]
    # 낮은 쪽은 높은 쪽을 칠 수 있음
    assert c.get(f"/game/raid/target/{ids['s1']}", headers=hd["s3"]).json()["block"] != "level_gap"
    hq1["level"] = 3
    assert c.get(f"/game/raid/target/{ids['s3']}", headers=hd["s1"]).json()["block"] != "level_gap"
    hq1["level"] = 1
    # 관리자가 자원을 주거나 레벨을 맞추면 보호막·신입 보호가 없어짐
    adm = db.insert_rows("users", {"login_id": "adm", "login_key": "adm", "name": "adm", "role": "admin", "status": "active",
                                   "password_hash": accounts.hash_password("p")})[0]
    ha = H(c.post("/auth/login", json={"login_id": "adm", "password": "p"}).json()["token"])
    b2 = next(b for b in db.TABLES["game_bases"] if b["user_id"] == ids["s2"])
    b2["shield_until"] = (NOW[0] + timedelta(hours=5)).isoformat()
    b2["created_at"] = NOW[0].isoformat()
    assert c.get(f"/game/raid/target/{ids['s2']}", headers=hd["s1"]).json()["block"] == "newbie"
    r = c.post("/admin/game/grant", headers=ha, json={"user_id": ids["s2"], "steel": 100})
    assert r.status_code == 200, r.text
    assert b2["shield_until"] is None
    assert c.get(f"/game/raid/target/{ids['s2']}", headers=hd["s1"]).json()["block"] not in ("newbie", "shield")
    assert adm["id"]
    # ---- 수료생 (박사 요청 2026-11-28): 과정 무리 안에 수료한 때 모습으로 유지, 2주 접속 없으면 로그인 막음 ----
    next(x for x in db.TABLES["courses"] if x["id"] == ca)["active"] = False      # s1·s2 과정이 끝남
    gs.forget_world()
    sea = c.get("/game/sea", headers=hd["s3"]).json()
    isl = {i["id"]: i for i in sea["islands"]}
    assert ids["s1"] in isl and isl[ids["s1"]]["grad"] and not isl[ids["s3"]]["grad"], isl
    assert any(b["id"] == ca and b["done"] for b in sea["bays"]) and isl[ids["s1"]]["course"] == ca
    # 수료생은 오래 안 들어와도 쉬는 중 보호가 없고, 공격받아도 잃는 것이 없음
    b2["last_seen_at"] = (NOW[0] - timedelta(days=30)).isoformat()
    b2["shield_until"] = None
    assert not isl[ids["s2"]]["protect"]
    for b in db.TABLES["game_bases"]:
        b["crews"] = {"welder": 12, "fitter": 0, "forklift": 0, "transporter": 0, "pts": 0}
    for s_ in db.TABLES["game_ships"]:
        s_["damage"] = 0
    NOW[0] = NOW[0] + timedelta(days=1)
    for b in db.TABLES["game_bases"]:
        b["last_seen_at"] = NOW[0].isoformat() if b["user_id"] != ids["s2"] else b["last_seen_at"]
    s2_bal = game.balance(game.ledger(ids["s2"]))
    s2_crews = dict(next(b for b in db.TABLES["game_bases"] if b["user_id"] == ids["s2"])["crews"])
    db.SETTINGS["game"]["raid_need_daily"] = False
    game._settings_cache["raw"] = None
    q = c.post("/game/raid/morale/start", headers=hd["s3"], json={"lang": "ko"}).json()
    s3_ship = next(x["id"] for x in db.TABLES["game_ships"] if x["user_id"] == ids["s3"])
    r = live_raid("s3", {"target": ids["s2"], "ships": [s3_ship], "morale_id": q["id"], "answers": ans(q)})
    assert r.status_code == 200, r.text
    gb_ = r.json()["battle"]
    assert gb_["grad"] and gb_["lost"] == {"steel": 0, "rods": 0}, gb_.get("lost")
    assert game.balance(game.ledger(ids["s2"])) == s2_bal
    after = next(b for b in db.TABLES["game_bases"] if b["user_id"] == ids["s2"])["crews"]
    assert after == s2_crews, (after, s2_crews)   # 방어 대원도 다치지 않음
    # 2주(예시) 넘게 안 들어온 수료생은 로그인 막힘 → 관리자가 다시 열면 됨
    from datetime import datetime as _dt, timezone as _tz
    u1 = next(u for u in db.TABLES["users"] if u["id"] == ids["s1"])
    u1["last_login_at"] = (_dt.now(_tz.utc) - timedelta(days=20)).isoformat()
    r = c.post("/auth/login", json={"login_id": "s1", "password": "p"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "graduated" and u1["status"] == "graduated", r.text
    # 자동 로그인 중이던 수료생도 오래 지나면 끊김
    u3 = next(u for u in db.TABLES["users"] if u["id"] == ids["s3"])
    assert c.get("/game/state", headers=hd["s3"]).status_code == 200      # s3 은 수료생 아님
    # 3주 안 쓴 세션
    for x in db.TABLES["sessions"]:
        if x["user_id"] == ids["s2"]:
            x["last_seen_at"] = (_dt.now(_tz.utc) - timedelta(days=21)).isoformat()
    assert c.get("/game/state", headers=hd["s2"]).status_code == 401
    assert not any(x["user_id"] == ids["s2"] for x in db.TABLES["sessions"]) and u3["status"] == "active"
    r = c.patch(f"/manage/members/{ids['s1']}", headers=ha, json={"status": "active"})
    assert r.status_code == 200, r.text
    assert u1["status"] == "active" and c.post("/auth/login", json={"login_id": "s1", "password": "p"}).status_code == 200
    print("pvp_check OK", {"stars": bt["stars"], "lost": bt["lost"]})


if __name__ == "__main__":
    main()
