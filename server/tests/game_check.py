"""G1 시험: 웰디의 조선소 (공부 → 자원, 짓기·올리기·공장·배 건조·즉시 완료권·처음 따라 하기·관리자 설정).
실행: python -m tests.game_check"""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

import accounts
import app as server
import daily
import game
from tests import fake_db as db
from tests.textbook_check import H

TOC = [{"title": "제1편 기초", "page": 4, "chapters": [{"title": "제1장 아크", "page": 4, "sections": []},
                                                    {"title": "제2장 가스", "page": 6, "sections": []}]}]
KST = timezone(timedelta(hours=9))
NOW = [datetime(2026, 12, 1, 1, 0, tzinfo=timezone.utc)]  # 한국 시간 12/1 오전 10시


def tick(sec):
    NOW[0] += timedelta(seconds=sec)


def main():
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    game._now = lambda: NOW[0]
    daily.today = lambda now=None: (now or NOW[0]).astimezone(KST).date()
    c = TestClient(server.app)

    def user(lid, role):
        u = db.insert_rows("users", {"login_id": lid, "login_key": lid, "name": lid, "role": role, "status": "active",
                                     "password_hash": accounts.hash_password("p")})[0]
        tok = c.post("/auth/login", json={"login_id": lid, "password": "p"}).json()["token"]
        return u["id"], H(tok)

    s1, S1 = user("s1", "student")
    _, T1 = user("t1", "teacher")
    _, A = user("admin", "admin")

    bid = db.insert_rows("textbooks", {"title": "용접 교재", "pages": 9, "page_offset": 0, "toc": TOC, "is_current": True,
                                       "status": "ready", "show_students": True, "use_for_ai": True})[0]["id"]
    qs = [db.insert_rows("quiz_questions", {"book_id": bid, "unit_key": "0-0", "unit_title": "제1장", "kind": k, "question": f"문제{i}",
                                            "choices": [], "answer": 0, "status": "active", "translations": {}})[0]["id"]
          for i, k in enumerate(["mc", "mc", "short"])]

    # 교사는 못 들어감
    assert c.get("/game/state", headers=T1).status_code == 403

    # 처음: 기본 건물 3개 + 환영 자원
    d = c.get("/game/state", headers=S1).json()
    types = sorted(b["type"] for b in d["buildings"])
    assert types == ["cutting", "dock", "hq"], types
    assert d["resources"]["steel"] == 500 and d["resources"]["rods"] == 300, d["resources"]
    assert d["run_today"] is False and d["tips"][0]["id"] == "daily"
    assert d["tutorial"]["step"] == 0 and not d["tutorial"]["done"]
    assert d["rewards"]["steel"] == 500

    # 처음 따라 하기: 받을 생산분이 없어도 '생산분 받기'에서 막히지 않게 첫 생산분 선물 (한 번만)
    s9, S9 = user("s9", "student")
    out = c.post("/game/collect", headers=S9).json()
    assert out["collect_gift"] is True and out["collected"] == {"steel": 100, "rods": 50}, out
    assert out["tutorial"]["steps"][2]["ok"] is True
    out = c.post("/game/collect", headers=S9).json()
    assert out["collect_gift"] is False and out["collected"] == {"steel": 0, "rods": 0}

    # 공부 안 한 날: 공장이 안 돈다
    tick(3600)
    d = c.get("/game/state", headers=S1).json()
    assert d["pending"]["steel"] == 0, d["pending"]
    assert d["rewards"] is None

    # 오늘 매일 문제 3개: 2개 맞힘(객관식 1·서술형 1), 1개 틀림
    day = "2026-12-01"
    db.insert_rows("daily_sets", {"user_id": s1, "day": day, "book_id": bid, "question_ids": qs})
    db.insert_rows("daily_answers", {"user_id": s1, "day": day, "question_id": qs[0], "book_id": bid, "kind": "mc", "score": 10})
    db.insert_rows("daily_answers", {"user_id": s1, "day": day, "question_id": qs[1], "book_id": bid, "kind": "mc", "score": 0})
    d = c.get("/game/state", headers=S1).json()
    assert d["run_today"] is False  # 아직 2/3
    db.insert_rows("daily_answers", {"user_id": s1, "day": day, "question_id": qs[2], "book_id": bid, "kind": "short", "score": 8})
    d = c.get("/game/state", headers=S1).json()
    r = d["rewards"]
    assert r["steel"] == 300 and r["rods"] == 200, r  # 객관식 100 은 앞에서 이미 받음
    assert d["run_today"] is True
    assert d["resources"]["steel"] == 800 and d["resources"]["rods"] == 600
    assert d["tutorial"]["step"] == 1 and d["tutorial"]["spot"], d["tutorial"]
    # 다시 열어도 또 주지 않음
    d = c.get("/game/state", headers=S1).json()
    assert d["rewards"] is None and d["resources"]["steel"] == 800
    # 공장: 오늘 매일 문제를 다 풀었으니 지은 뒤 1시간치(시간당 60)가 쌓임
    assert d["pending"]["steel"] == 60, d["pending"]

    # 받기
    out = c.post("/game/collect", headers=S1).json()
    assert out["collected"]["steel"] == 60, out["collected"]
    assert out["resources"]["steel"] == 860
    # 창고가 가득 차면 남는 자리만큼만 (본관 기본 1000)
    tick(8 * 3600)
    out = c.post("/game/collect", headers=S1).json()
    assert out["collected"]["steel"] == 140 and out["resources"]["steel"] == 1000, out["collected"]

    # 야적장 짓기: 처음 따라 하기 자리에
    sp = d["tutorial"]["spot"]
    assert c.post("/game/build", headers=S1, json={"type": "yard", "x": 14, "y": 14}).status_code == 400  # 본관 자리
    assert c.post("/game/build", headers=S1, json={"type": "welding", "x": 0, "y": 10}).json()["detail"]["code"] == "hq_level"
    out = c.post("/game/build", headers=S1, json={"type": "yard", **sp}).json()
    yard = next(b for b in out["buildings"] if b["type"] == "yard")
    assert yard["level"] == 0 and yard["left"] == 60
    assert out["resources"]["steel"] == 800
    assert c.post("/game/build", headers=S1, json={"type": "yard", "x": 0, "y": 12}).json()["detail"]["code"] == "already"
    # 작업 반장 2명: 하나 더 (용접봉 창고), 세 번째는 막힘
    c.post("/game/build", headers=S1, json={"type": "rodstore", "x": 0, "y": 11})
    cut = next(b for b in out["buildings"] if b["type"] == "cutting")
    assert c.post("/game/upgrade", headers=S1, json={"id": cut["id"]}).json()["detail"]["code"] in ("builders", "hq_level")
    tick(61)
    d = c.get("/game/state", headers=S1).json()
    yard = next(b for b in d["buildings"] if b["type"] == "yard")
    assert yard["level"] == 1 and yard["just_done"], yard
    assert d["caps"]["steel"] == 1000 + 1500
    assert any(t["id"] == "built" for t in d["tips"])
    d = c.get("/game/state", headers=S1).json()
    assert not next(b for b in d["buildings"] if b["type"] == "yard")["just_done"]

    # 교재 장 완료는 기술 포인트 30 (본관 조건은 아님)
    hq = next(b for b in d["buildings"] if b["type"] == "hq")
    assert hq["block"] == "exam" and hq["next"]["exam"] == {"counts": {"ox": 10, "mc": 0, "word": 0, "short": 0},
                                                            "total": 10, "pass": 8, "passed": False}, hq["next"]
    assert c.post("/game/upgrade", headers=S1, json={"id": hq["id"]}).json()["detail"]["code"] == "exam"
    for p in (4, 5):
        db.insert_rows("textbook_progress", {"user_id": s1, "book_id": bid, "page": p})
    d = c.get("/game/state", headers=S1).json()
    assert d["units"]["done"] == 1 and d["units"]["total"] == 2, d["units"]
    assert d["rewards"]["tech"] == 30 and d["rewards"]["why"] == {"unit_done": 1}, d["rewards"]
    hq = next(b for b in d["buildings"] if b["type"] == "hq")
    assert hq["block"] == "exam"

    # 본관 승급 시험: OX 10문제 중 8개 (문제 은행에 OX 12개, 정답은 짝수 번 O·홀수 번 X)
    ox = {}
    for i in range(12):
        q = db.insert_rows("quiz_questions", {"book_id": bid, "unit_key": "0-0", "unit_title": "제1장", "kind": "ox",
                                              "question": f"OX{i}", "choices": [], "answer": i % 2, "status": "active",
                                              "translations": {}})[0]
        ox[q["id"]] = i % 2
    assert c.post("/game/hq-exam/start", headers=T1, json={}).status_code == 403
    ex = c.post("/game/hq-exam/start", headers=S1, json={}).json()
    assert ex["target"] == 2 and ex["total"] == 10 and ex["pass"] == 8 and ex["short_of"] == 0, ex
    assert all(q["kind"] == "ox" and q["result"] is None for q in ex["questions"])  # 답은 안 보냄
    ids = [q["id"] for q in ex["questions"]]
    # 7개만 맞힘 → 불합격, 다시 봐야 함
    ans = {qid: (ox[qid] if k < 7 else 1 - ox[qid]) for k, qid in enumerate(ids)}
    r = c.post("/game/hq-exam/submit", headers=S1, json={"id": ex["id"], "answers": ans}).json()
    assert r["passed"] is False and r["right"] == 7 and r["results"][0]["correct_choice"] is not None, r
    assert c.post("/game/hq-exam/submit", headers=S1, json={"id": ex["id"], "answers": ans}).json()["detail"]["code"] == "exam_gone"
    first = set(ids)
    # 다시 보고 8개 맞힘 → 통과. 낸 문제 장부: 지난번에 안 나온 2문제가 꼭 들어감 (한 바퀴 돌 때까지 안 겹침)
    ex = c.post("/game/hq-exam/start", headers=S1, json={}).json()
    ids = [q["id"] for q in ex["questions"]]
    assert (set(ox) - first) <= set(ids), (set(ox) - first, ids)
    ans = {qid: (ox[qid] if k < 8 else 1 - ox[qid]) for k, qid in enumerate(ids)}
    r = c.post("/game/hq-exam/submit", headers=S1, json={"id": ex["id"], "answers": ans}).json()
    assert r["passed"] is True and r["right"] == 8, r
    hq = next(b for b in r["state"]["buildings"] if b["type"] == "hq")
    assert hq["block"] is None and hq["next"]["exam"]["passed"] is True
    assert c.post("/game/hq-exam/start", headers=S1, json={}).json()["detail"]["code"] == "already"
    tick(4 * 3600)  # 공장 4시간 → 강판 240 (본관 비용 800 모으기)
    d = c.post("/game/collect", headers=S1).json()
    steel0 = d["resources"]["steel"]
    assert steel0 >= 800, d["resources"]
    out = c.post("/game/upgrade", headers=S1, json={"id": hq["id"]}).json()
    assert "resources" in out, (out, d["resources"])
    assert out["resources"]["steel"] == steel0 - 800 and out["resources"]["rods"] == d["resources"]["rods"] - 200
    hq = next(b for b in out["buildings"] if b["type"] == "hq")
    assert hq["left"] == 600 and hq["speed"]["tech"] == 1
    # 기술 포인트 1개로 바로 끝 (10분)
    out = c.post("/game/speedup", headers=S1, json={"target": hq["id"], "using": "tech"}).json()
    assert out["resources"]["tech"] == 29
    d = c.get("/game/state", headers=S1).json()
    assert d["hq_level"] == 2
    assert d["tutorial"]["steps"][4]["ok"]

    # 옮기기: 도크는 못 옮김, 겹치면 안 됨
    dock = next(b for b in d["buildings"] if b["type"] == "dock")
    assert c.post("/game/move", headers=S1, json={"id": dock["id"], "x": 0, "y": 0}).json()["detail"]["code"] == "fixed"
    cut = next(b for b in d["buildings"] if b["type"] == "cutting")
    assert c.post("/game/move", headers=S1, json={"id": cut["id"], "x": 14, "y": 14}).status_code == 400
    out = c.post("/game/move", headers=S1, json={"id": cut["id"], "x": 0, "y": 0}).json()
    assert next(b for b in out["buildings"] if b["type"] == "cutting")["x"] == 0

    # 같은 반 친구 진수 알림 준비: s1·s2 같은 반, s3 다른 반
    ca = db.insert_rows("courses", {"name": "A반", "sort": 1})[0]["id"]
    cb = db.insert_rows("courses", {"name": "B반", "sort": 2})[0]["id"]
    s2, S2 = user("s2", "student")
    s3, S3 = user("s3", "student")
    for uid_, cid_ in ((s1, ca), (s2, ca), (s3, cb)):
        db.insert_rows("user_courses", {"user_id": uid_, "course_id": cid_})
    assert c.get("/live/now", headers=S2).json()["launches"] == []

    # 배: 바지선 → 공정 5개 → 인도 명성 10
    assert next(x for x in d["ships"] if x["kind"] == "bulk")["lock"] == "dock"
    assert c.post("/game/ship/start", headers=S1, json={"kind": "barge"}).json()["detail"]["code"] == "money"
    db.insert_rows("game_ledger", {"user_id": s1, "key": "test_gift", "steel": 5000, "rods": 3000})  # 시험용 자원
    out = c.post("/game/ship/start", headers=S1, json={"kind": "barge"}).json()
    assert out["ship"]["stage"] == 0 and out["ship"]["left"] == sum(game.STAGE_SECONDS) and out["ship"]["stage_left"] == 60
    bal1 = game.balance(game.ledger(s1))   # 시험용 자원을 다 빼서 진수 대금이 창고에 다 들어가게
    db.insert_rows("game_ledger", {"user_id": s1, "key": "test_trim", "steel": -bal1["steel"], "rods": -bal1["rods"]})
    assert c.post("/game/ship/next", headers=S1).json()["detail"]["code"] == "not_ready"
    # 공정은 누르지 않아도 저절로 이어짐: 첫 공정 + 반쯤 지나면 대조립 중
    tick(game.STAGE_SECONDS[0] + 30)
    mid = c.get("/game/state", headers=S1).json()["ship"]
    assert mid["stage"] == 1 and mid["stage_left"] == game.STAGE_SECONDS[1] - 30 and not mid["ready"], mid
    assert mid["left"] == sum(game.STAGE_SECONDS) - game.STAGE_SECONDS[0] - 30
    assert c.post("/game/ship/next", headers=S1).json()["detail"]["code"] == "not_ready"
    tick(sum(game.STAGE_SECONDS) - game.STAGE_SECONDS[0] - 30)
    st_done = c.get("/game/state", headers=S1).json()
    assert st_done["ship"]["ready"] and st_done["ship"]["stage"] == 4 and any(t["id"] == "ship_ready" for t in st_done["tips"])
    out = c.post("/game/ship/next", headers=S1).json()
    dn = out["delivered_now"]
    assert dn["kind"] == "barge" and dn["fame"] == 10 and dn["first"] is True and dn["count"] == 1, dn
    assert dn["got"] == {"fame": 10, "steel": 350, "rods": 180, "tech": 5, "passes": 1}, dn
    assert out["resources"]["fame"] == 10 and out["ship"] is None and out["delivered"] == ["barge"]
    assert next(x for x in out["ships"] if x["kind"] == "barge")["first_bonus"] == 0
    # 같은 반 친구(s2)에게만 알림, 나(s1)·다른 반(s3)은 안 보임, 10분 지나면 사라짐
    ln = c.get("/live/now", headers=S2).json()["launches"]
    assert len(ln) == 1 and ln[0]["name"] == "s1" and ln[0]["kind"] == "barge", ln
    assert c.get("/live/now", headers=S1).json()["launches"] == []
    assert c.get("/live/now", headers=S3).json()["launches"] == []
    passes_before = out["resources"]["passes"]
    # 두 번째 바지선: 대금은 또 받지만 첫 인도 완료권은 없음
    c.post("/game/ship/start", headers=S1, json={"kind": "barge"})
    tick(10 * sum(game.STAGE_SECONDS))   # 오래 안 들어와도 다 끝나 있음
    out = c.post("/game/ship/next", headers=S1).json()
    dn = out["delivered_now"]
    assert dn["first"] is False and "passes" not in dn["got"] and dn["count"] == 2, dn
    assert out["resources"]["passes"] == passes_before
    # 즉시 완료권은 남은 공정 전체를 끝냄
    db.insert_rows("game_ledger", {"user_id": s1, "key": "test_pass", "passes": 1, "steel": 300, "rods": 100})
    c.post("/game/ship/start", headers=S1, json={"kind": "barge"})
    sp = c.post("/game/speedup", headers=S1, json={"target": "ship", "using": "pass"}).json()
    assert sp["ship"]["ready"] and sp["ship"]["stage"] == 4, sp["ship"]
    assert "delivered_now" in c.post("/game/ship/next", headers=S1).json()

    # 실습: 92점(높은 점수·첫 합격) → 완료권 하루 최대 2장 + 강판 200
    def sub(score_parts, when, pos="1G", width=8.0):
        w0, w1, dev = score_parts
        db.insert_rows("submissions", {"user_id": s1, "status": "ok", "work_type": "plate", "process": "GTAW", "position": pos,
                                       "created_at": when, "width_mean_mm": width, "width_min_mm": w0, "width_max_mm": w1,
                                       "straight_max_dev_mm": dev, "defect_count": 0, "defect_types": []})
    sub((7.9, 8.1, 0.2), NOW[0].isoformat())
    d = c.get("/game/state", headers=S1).json()
    assert d["rewards"]["passes"] == 2 and d["rewards"]["steel"] == 200, d["rewards"]
    # 같은 사진 다시 올림 (측정값 같음) → 안 줌
    sub((7.9, 8.1, 0.2), (NOW[0] + timedelta(seconds=5)).isoformat())
    d = c.get("/game/state", headers=S1).json()
    assert d["rewards"] is None
    # 완료권으로 공사 바로 끝
    out = c.post("/game/build", headers=S1, json={"type": "welding", "x": 0, "y": 6}).json()
    wel = next(b for b in out["buildings"] if b["type"] == "welding")
    out = c.post("/game/speedup", headers=S1, json={"target": wel["id"], "using": "pass"}).json()
    assert out["resources"]["passes"] == 2  # 실습 2장 + 첫 바지선 1장 − 1장
    d = c.get("/game/state", headers=S1).json()
    assert next(b for b in d["buildings"] if b["type"] == "welding")["level"] == 1

    # 다음 날: 매일 문제 안 풀면 공장 멈춤 (전날 몫만 쌓임)
    c.post("/game/collect", headers=S1)
    tick(24 * 3600)
    assert c.get("/live/now", headers=S2).json()["launches"] == []  # 진수 알림은 10분만
    d = c.get("/game/state", headers=S1).json()
    assert d["run_today"] is False
    p_before = d["pending"]["steel"]
    tick(3600)
    d = c.get("/game/state", headers=S1).json()
    assert d["pending"]["steel"] == p_before, (p_before, d["pending"])

    # 전에 틀린 문제를 다시 맞힘 → 기술 포인트 5 + 용접봉
    day2 = daily.today().isoformat()
    db.insert_rows("daily_sets", {"user_id": s1, "day": day2, "book_id": bid, "question_ids": [qs[1]]})
    db.insert_rows("daily_answers", {"user_id": s1, "day": day2, "question_id": qs[1], "book_id": bid, "kind": "mc", "score": 10,
                                     "created_at": NOW[0].isoformat()})
    d = c.get("/game/state", headers=S1).json()
    assert d["rewards"]["tech"] == 5 and d["rewards"]["rods"] == 100 and d["rewards"]["steel"] == 300, d["rewards"]
    assert d["run_today"] is True

    # 처음 따라 하기 끄기
    out = c.post("/game/tutorial", headers=S1, json={"done": True}).json()
    assert out["tutorial"]["done"]

    # 관리자 설정: 게임 끄기 → 교육생 못 들어감, 관리자는 들어감
    assert c.get("/admin/game-settings", headers=S1).status_code == 403
    st = c.get("/admin/game-settings", headers=A).json()
    assert st["settings"]["daily_done_steel"] == 300
    assert c.put("/admin/game-settings", headers=A, json={"daily_done_steel": -1}).status_code == 400
    assert c.put("/admin/game-settings", headers=A, json={"enabled": False, "daily_done_steel": 500}).json()["settings"]["daily_done_steel"] == 500
    assert c.get("/game/state", headers=S1).json()["detail"]["code"] == "game_off"
    assert c.get("/game/state", headers=A).status_code == 200

    # 관리자: 승급 시험 바꾸기 (단답형 2개 모두 맞히기). 합격 개수가 문제 수보다 많으면 안 됨
    bad = c.put("/admin/game-settings", headers=A, json={"hq_exam_ox": 0, "hq_exam_word": 2, "hq_exam_pass": 3})
    assert bad.status_code == 400 and bad.json()["detail"]["key"] == "hq_exam_pass"
    assert c.put("/admin/game-settings", headers=A, json={"hq_exam_ox": 0, "hq_exam_mc": 0, "hq_exam_word": 0,
                                                          "hq_exam_short": 0}).status_code == 400
    assert c.put("/admin/game-settings", headers=A, json={"hq_exam_ox": 21}).status_code == 400
    st = c.put("/admin/game-settings", headers=A, json={"enabled": True, "hq_exam_ox": 0, "hq_exam_word": 2,
                                                        "hq_exam_pass": 2}).json()["settings"]
    assert st["hq_exam_word"] == 2 and st["hq_exam_pass"] == 2
    for w in ("아크", "용융지"):
        db.insert_rows("quiz_questions", {"book_id": bid, "unit_key": "0-0", "unit_title": "제1장", "kind": "word",
                                          "question": f"{w}?", "choices": [], "answer": None, "model_answer": w,
                                          "status": "active", "translations": {}})
    s4, S4 = user("s4", "student")
    hq4 = next(b for b in c.get("/game/state", headers=S4).json()["buildings"] if b["type"] == "hq")
    assert hq4["next"]["exam"]["counts"]["word"] == 2 and hq4["next"]["exam"]["pass"] == 2
    ex = c.post("/game/hq-exam/start", headers=S4, json={}).json()
    assert ex["total"] == 2 and all(q["kind"] == "word" for q in ex["questions"]), ex
    words = {q["id"]: q["question"].rstrip("?") for q in ex["questions"]}
    r = c.post("/game/hq-exam/submit", headers=S4, json={"id": ex["id"], "answers": {k: f" {v} " for k, v in words.items()}}).json()
    assert r["passed"] is True and r["right"] == 2, r
    # 창고 한도: 공부 보상이 창고 자리를 넘으면 사라지지 않고 '창고 대기' → 자리가 나면 들어옴
    s5, S5 = user("s5", "student")
    d = c.get("/game/state", headers=S5).json()
    assert d["resources"]["steel"] == 500 and d["caps"]["steel"] == 1000
    db.insert_rows("game_ledger", {"user_id": s5, "key": "test_gift", "steel": 400, "rods": 0, "tech": 0, "passes": 0, "fame": 0, "note": ""})
    db.insert_rows("daily_sets", {"user_id": s5, "day": "2026-12-05", "book_id": bid, "question_ids": [qs[0]]})
    db.insert_rows("daily_answers", {"user_id": s5, "day": "2026-12-05", "question_id": qs[0], "book_id": bid, "kind": "mc", "score": 0})
    d = c.get("/game/state", headers=S5).json()
    dd = d["earn"]["daily_done_steel"]
    assert d["resources"]["steel"] == 900, d["resources"]          # 매일 문제 강판이 들어갈 자리(100)가 없음
    assert d["waiting"]["steel"] == dd > 100, d["waiting"]
    assert any(t["id"] == "full" and t["steel"] == dd for t in d["tips"]), d["tips"]
    d = c.get("/game/state", headers=S5).json()
    assert d["resources"]["steel"] == 900 and d["waiting"]["steel"] == dd and d["rewards"] is None   # 다시 열어도 그대로
    db.insert_rows("game_ledger", {"user_id": s5, "key": "test_spend", "steel": -500, "rods": 0, "tech": 0, "passes": 0, "fame": 0, "note": ""})
    d = c.get("/game/state", headers=S5).json()
    assert d["resources"]["steel"] == 400 + dd and d["waiting"]["steel"] == 0, (d["resources"], d["waiting"])
    assert d["rewards"]["steel"] == dd
    assert game.clip_storage({"steel": 500, "rods": 100}, {"steel": 900, "rods": 600}, {"steel": 1000, "rods": 600}) == {"steel": 100, "rods": 0}
    # 자재 조달: 문제 풀어 강판·용접봉 벌기 (기본 OX 3 + 객관식 2, 1문제 강판 40·용접봉 20, 하루 무제한)
    s6, S6 = user("s6", "student")
    d = c.get("/game/state", headers=S6).json()
    assert d["supply"]["counts"] == {"ox": 3, "mc": 2, "word": 0} and d["supply"]["day_max"] == 0, d["supply"]
    ans_of = {q["id"]: q.get("answer") for q in db.TABLES["quiz_questions"]}
    sp = c.post("/game/supply/start", headers=S6, json={}).json()
    assert sp["total"] == 5 and sp["steel"] == 40, sp
    ids = [q["id"] for q in sp["questions"]]
    answers = {qid: ans_of[qid] for qid in ids}
    wrong = ids[0]
    answers[wrong] = 1 - ans_of[wrong]
    r = c.post("/game/supply/submit", headers=S6, json={"id": sp["id"], "answers": answers}).json()
    assert r["right"] == 4 and r["got"] == {"steel": 160, "rods": 80} and r["full"] is False, r
    assert r["state"]["resources"]["steel"] == 500 + 160 and r["state"]["supply"]["done_today"] == 1
    assert next(x for x in r["results"] if x["id"] == wrong)["correct"] is False
    # 같은 조달을 두 번 채점하면 안 됨
    assert c.post("/game/supply/submit", headers=S6, json={"id": sp["id"], "answers": answers}).json()["detail"]["code"] == "exam_gone"
    # 방금 나온 OX 3개는 다음 판에서 되도록 안 나옴 (OX가 12개라 충분)
    sp2 = c.post("/game/supply/start", headers=S6, json={}).json()
    ox_ids = lambda x: {q["id"] for q in x["questions"] if q["kind"] == "ox"}
    assert not (ox_ids(sp) & ox_ids(sp2)), (ox_ids(sp), ox_ids(sp2))
    # 창고가 가득이면 자리만큼만
    db.insert_rows("game_ledger", {"user_id": s6, "key": "test_fill", "steel": 1000 - 660 - 20, "rods": 0})
    r = c.post("/game/supply/submit", headers=S6, json={"id": sp2["id"], "answers": {q: ans_of[q] for q in ox_ids(sp2)}}).json()
    assert r["right"] == len(ox_ids(sp2)) >= 3 and r["got"]["steel"] == 20 and r["full"] is True, (r["right"], r["got"])
    # 관리자: 하루 횟수 1번으로 → 오늘 더 못 함
    assert c.put("/admin/game-settings", headers=A, json={"supply_ox": 0, "supply_mc": 0, "supply_word": 0}).status_code == 400
    assert c.put("/admin/game-settings", headers=A, json={"supply_day_max": 1}).status_code == 200
    e = c.post("/game/supply/start", headers=S6, json={}).json()["detail"]
    assert e["code"] == "supply_day_max" and e["n"] == 1, e
    # 자재 조달 2: 다 낼 때까지 같은 문제 안 나옴, OX 바닥나면 객관식→단답형으로, 서술형은 절대 안 나옴, 서버가 다시 켜져도 기억
    assert c.put("/admin/game-settings", headers=A, json={"supply_day_max": 0, "supply_ox": 5, "supply_mc": 0, "supply_word": 0}).status_code == 200
    s7, S7 = user("s7", "student")
    bank = [q for q in db.TABLES["quiz_questions"] if q["book_id"] == bid and q["status"] == "active"]
    n_ox = sum(1 for q in bank if q["kind"] == "ox")
    fresh_total = sum(1 for q in bank if q["kind"] in ("ox", "mc"))   # 단답형 0 → 단답형은 안 나옴
    seen_ids, rounds = [], []
    for i in range(fresh_total // 5 + 2):
        if i == 1:
            game._supply_open.clear()   # 서버가 다시 켜진 것처럼 (메모리 지움) → 장부로 기억해야 함
        sp = c.post("/game/supply/start", headers=S7, json={}).json()
        kinds = [q["kind"] for q in sp["questions"]]
        assert set(kinds) <= {"ox", "mc"} and len(kinds) == 5, kinds
        ids = [q["id"] for q in sp["questions"]]
        assert len(set(ids)) == 5
        rounds.append((ids, kinds, sp["swapped"]))
        c.post("/game/supply/submit", headers=S7, json={"id": sp["id"], "answers": {}})
        seen_ids += ids
    full_rounds = fresh_total // 5
    first = seen_ids[:full_rounds * 5]
    assert len(set(first)) == len(first), "다 낼 때까지는 같은 문제가 다시 나오면 안 됨"
    left = {q["id"] for q in bank if q["kind"] in ("ox", "mc")} - set(first)
    assert left <= set(rounds[full_rounds][0]), "남은 새 문제를 먼저 내야 함"
    swap_round = rounds[n_ox // 5]
    assert swap_round[2] is True and "mc" in swap_round[1], swap_round   # OX 가 바닥난 판은 객관식으로 채움
    last, prev = rounds[-1][0], rounds[-2][0]
    assert not (set(last) & set(prev)), "다시 낼 때도 방금 판 문제가 연달아 나오면 안 됨"

    # G2a: 군항 부두·전투함·간척
    s8, S8 = user("s8", "student")
    d = c.get("/game/state", headers=S8).json()
    db.insert_rows("game_ledger", {"user_id": s8, "key": "test_gift", "steel": 30000, "rods": 15000, "tech": 0, "passes": 1,
                                   "fame": 0, "note": ""})
    assert d["grid"] == 32 and d["sea"] == 4 and d["fleet"]["cap"] == 0, (d["grid"], d["fleet"])
    wl = {w["kind"]: w["lock"] for w in d["warships"]}
    assert wl == {"patrol": "pier", "frigate": "hq", "destroyer": "soon", "submarine": "soon", "landing": "hq"}, wl
    assert d["reclaim"] is None   # 간척 없앰 (처음부터 큰 땅)
    assert any(t["id"] == "pier" for t in d["tips"]), d["tips"]
    e = c.post("/game/ship/start", headers=S8, json={"kind": "patrol"}).json()["detail"]
    assert e["code"] == "pier", e
    # 부두는 해안(오른쪽 끝)에만
    assert c.post("/game/build", headers=S8, json={"type": "pier", "x": 3, "y": 10}).json()["detail"]["code"] == "spot"
    r = c.post("/game/build", headers=S8, json={"type": "pier", "x": 30, "y": 4})
    assert r.status_code == 200, r.text
    tick(61)
    d = c.get("/game/state", headers=S8).json()
    assert d["fleet"]["cap"] == 2 and {w["kind"]: w["lock"] for w in d["warships"]}["patrol"] is None, d["fleet"]
    fame0 = d["resources"]["fame"]

    def make(kind):
        r = c.post("/game/ship/start", headers=S8, json={"kind": kind})
        assert r.status_code == 200, r.text
        assert r.json()["ship"]["war"] is True
        tick(5 * 2000)
        r = c.post("/game/ship/next", headers=S8)
        assert r.status_code == 200, r.text
        return r.json()

    d = make("patrol")
    assert d["commissioned_now"] == {"kind": "patrol", "no": 1, "count": 1, "cap": 2}, d.get("commissioned_now")
    assert d["ship"] is None and d["delivered"] == [] and d["resources"]["fame"] == fame0 and "delivered_now" not in d
    d = make("patrol")
    assert d["commissioned_now"]["no"] == 2 and len(d["fleet"]["ships"]) == 2
    assert {w["kind"]: w["lock"] for w in d["warships"]}["patrol"] == "fleet_full"
    assert c.post("/game/ship/start", headers=S8, json={"kind": "patrol"}).json()["detail"]["code"] == "fleet_full"
    # 상선은 함대가 가득 차도 그대로 만들 수 있음
    assert c.post("/game/ship/start", headers=S8, json={"kind": "barge"}).status_code == 200
    # 본관 2 → 3 (간척은 없앰: 옛 앱이 불러도 막힘)
    db.insert_rows("game_ledger", {"user_id": s8, "key": "hq_exam:2", "steel": 0, "rods": 0, "tech": 0, "passes": 0, "fame": 0, "note": ""})
    hq8 = next(b for b in d["buildings"] if b["type"] == "hq")
    assert c.post("/game/upgrade", headers=S8, json={"id": hq8["id"]}).status_code == 200
    tick(601)
    d = c.get("/game/state", headers=S8).json()
    assert d["hq_level"] == 2 and d["reclaim"] is None and not any(t["id"] == "reclaim" for t in d["tips"])
    assert c.post("/game/reclaim", headers=S8).json()["detail"]["code"] == "reclaim_max"
    # 큰 땅 가장자리에도 지을 수 있음
    assert c.post("/game/build", headers=S8, json={"type": "yard", "x": 0, "y": 30}).status_code == 200
    tick(61)
    # 폐자재: 처음 10개쯤, 그 자리엔 못 짓고, 치우면 자원 + 목록에서 빠짐, 두 번은 안 됨
    d = c.get("/game/state", headers=S8).json()
    sc = d["scraps"]
    assert 5 <= len(sc) <= 13 and all(p["x"] + 1 < d["grid"] for p in sc), sc
    p0 = sc[0]
    import game as G
    blds = G._buildings(s8)
    blocks = G.scrap_blocks(s8, blds, G.ledger(s8), d["grid"])
    assert G._free(blds, "radar", p0["x"], p0["y"]) and not G._free(blds + blocks, "radar", p0["x"], p0["y"])
    r0 = d["resources"]
    out = c.post("/game/scrap/clear", headers=S8, json={"id": p0["id"]}).json()
    assert not any(p["id"] == p0["id"] for p in out["scraps"])
    assert out["resources"]["steel"] >= r0["steel"] and out["resources"]["rods"] >= r0["rods"]
    assert c.post("/game/scrap/clear", headers=S8, json={"id": p0["id"]}).status_code == 404
    # 오늘 할 일: 4가지 중 다 안 했으면 못 받음, 다 하면 한 번만
    t = out["todo"]
    assert [i["key"] for i in t["items"]] == ["daily", "supply", "crew", "battle"] and not t["claimed"]
    if not all(i["done"] for i in t["items"]):
        assert c.post("/game/todo/claim", headers=S8).json()["detail"]["code"] == "todo_left"
    for k in ("crew", "battle"):
        G.mark_todo(s8, k)
    day = G._kday()
    db.insert_rows("game_ledger", {"user_id": s8, "key": f"supply:{day}:x", "steel": 0, "rods": 0, "tech": 0, "passes": 0, "fame": 0, "note": ""})
    t = c.get("/game/state", headers=S8).json()["todo"]
    assert all(i["done"] for i in t["items"] if i["key"] != "daily"), t
    if all(i["done"] for i in t["items"]):
        tech0 = c.get("/game/state", headers=S8).json()["resources"]["tech"]
        out = c.post("/game/todo/claim", headers=S8).json()
        assert out["todo"]["claimed"] and out["resources"]["tech"] == tech0 + G.TODO_REWARD["tech"]
        assert c.post("/game/todo/claim", headers=S8).json()["detail"]["code"] == "already"
    db.insert_rows("game_ledger", {"user_id": s8, "key": "hq_exam:3", "steel": 0, "rods": 0, "tech": 0, "passes": 0, "fame": 0, "note": ""})
    assert c.post("/game/upgrade", headers=S8, json={"id": hq8["id"]}).status_code == 200
    tick(1801)
    d = c.get("/game/state", headers=S8).json()
    assert {w["kind"]: w["lock"] for w in d["warships"]}["frigate"] == "dock"
    # 관리자 자원 지급: 창고 한도 무시, 기록 남음, 회수는 잔액까지만, 교사는 못 함
    pl = c.get("/admin/game/players?q=s8", headers=A).json()["players"]
    assert [p["login_id"] for p in pl] == ["s8"], pl
    assert c.get("/admin/game/players", headers=T1).status_code == 403
    before = c.get(f"/admin/game/player/{s8}", headers=A).json()["resources"]
    r = c.post("/admin/game/grant", headers=A, json={"user_id": s8, "steel": 99999, "passes": 3, "memo": "시험 | 보상"})
    assert r.status_code == 200, r.text
    g = r.json()
    assert g["resources"]["steel"] == before["steel"] + 99999 and g["resources"]["passes"] == before["passes"] + 3
    assert g["grants"][0]["steel"] == 99999 and g["grants"][0]["by"] == "admin" and g["grants"][0]["memo"] == "시험 / 보상", g["grants"][0]
    assert c.post("/admin/game/grant", headers=A, json={"user_id": s8}).json()["detail"]["code"] == "grant_empty"
    e = c.post("/admin/game/grant", headers=A, json={"user_id": s8, "tech": -(g["resources"]["tech"] + 1)}).json()["detail"]
    assert e["code"] == "grant_below_zero" and e["res"] == "tech", e
    assert c.post("/admin/game/grant", headers=A, json={"user_id": s8, "passes": -1}).json()["resources"]["passes"] == before["passes"] + 2
    assert c.post("/admin/game/grant", headers=T1, json={"user_id": s8, "steel": 1}).status_code == 403
    d = c.get("/game/state", headers=S8).json()
    assert d["resources"]["steel"] == g["resources"]["steel"]
    # 지급 알림: 받은 것(양수)만, 빼기만 한 줄은 알림 없음. 앱 어디서든(/live/now) + 게임 화면(받았어요 누를 때까지)
    gifts = d["gifts"]
    assert len(gifts) == 1 and gifts[0]["steel"] == 99999 and gifts[0]["passes"] == 3 and gifts[0]["memo"] == "시험 / 보상", gifts
    now = c.get("/live/now", headers=S8).json()
    assert [x["steel"] for x in now["gifts"]] == [99999], now
    assert c.get("/live/now", headers=S1).json()["gifts"] == []
    d = c.post("/game/gifts/seen", headers=S8, json={"ids": [gifts[0]["id"], "남의것"]}).json()
    assert d["gifts"] == [] and d["resources"]["steel"] == g["resources"]["steel"], d["gifts"]
    assert c.get("/live/now", headers=S8).json()["gifts"] == []
    # 일주일 지난 지급은 게임 화면 알림에서 빠짐
    c.post("/admin/game/grant", headers=A, json={"user_id": s8, "rods": 5})
    assert len(c.get("/game/state", headers=S8).json()["gifts"]) == 1
    tick(8 * 86400)
    assert c.get("/game/state", headers=S8).json()["gifts"] == []
    g2b(c, user, A, T1, qs)
    print("game_check OK")


def g2b(c, user, A, T1, qs):
    """G2b-1: 방어 시설 6종·장 정답률·무기 연구/장착·선체·장벽."""
    import uuid as _u
    s10, S = user("s10", "student")
    c.get("/game/state", headers=S)
    db.insert_rows("game_ledger", {"user_id": s10, "key": "test_gift", "steel": 60000, "rods": 30000, "tech": 1000, "passes": 0,
                                   "fame": 0, "note": ""})
    for b in db.TABLES["game_buildings"]:
        if b["user_id"] == s10 and b["type"] == "hq":
            b["level"] = 3
    for t, x, y, lv in [("pier", 30, 19, 1), ("academy", 2, 17, 3)]:
        db.insert_rows("game_buildings", {"id": str(_u.uuid4()), "user_id": s10, "type": t, "level": lv, "x": x, "y": y,
                                          "collected_at": NOW[0].isoformat()})
    ship = db.insert_rows("game_ships", {"id": str(_u.uuid4()), "user_id": s10, "kind": "patrol", "stage": 4,
                                         "delivered_at": NOW[0].isoformat()})[0]
    # 장 0-0 정답률 25% (4문제 중 1개)
    book_id = db.TABLES["textbooks"][0]["id"]
    for i, ok in enumerate([True, False, False, False]):
        db.insert_rows("game_answers", {"user_id": s10, "book_id": book_id, "question_id": qs[i % 3], "correct": ok, "source": "supply"})
    d = c.get("/game/state", headers=S).json()
    cat = {x["type"]: x for x in d["catalog"]}
    assert cat["battery"]["max"] == 3 and cat["wall"]["max"] == 12 and cat["asw"]["locked"] and cat["asw"]["more_at"] == 4, cat["asw"]
    assert any(t["id"] == "defense" for t in d["tips"]), d["tips"]
    # 놓는 곳: 해안포대 = 땅 오른쪽 끝, 기뢰·장벽 = 바다 (도크 앞·부두 옆 물길 제외)
    code = lambda r: r.json().get("detail", {}).get("code") if r.status_code != 200 else "ok"
    B = lambda t, x, y: code(c.post("/game/build", headers=S, json={"type": t, "x": x, "y": y}))
    assert B("battery", 5, 16) == "spot"
    assert B("mine", 31, 11) == "spot" and B("wall", 36, 18) == "spot" and B("wall", 31, 18) == "spot" and B("wall", 32, 14) == "spot" and B("mine", 32, 20) == "spot"
    assert B("battery", 31, 17) == "ok"
    assert B("wall", 32, 17) == "ok" and B("wall", 32, 18) == "ok"   # 장벽은 작업 반장 없이 바로
    d = c.get("/game/state", headers=S).json()
    walls = [b for b in d["buildings"] if b["type"] == "wall"]
    assert len(walls) == 2 and all(w["level"] == 1 and not w["busy_until"] for w in walls) and d["builders"]["busy"] == 1
    assert B("mine", 33, 13) == "ok"
    assert B("wall", 32, 18) == "spot"
    # 여러 칸 한 번에: 이미 있는 칸·물길 칸은 건너뛰고, 쌓은 칸 수만큼만 강판
    before = c.get("/game/state", headers=S).json()["resources"]["steel"]
    r = c.post("/game/walls/build", headers=S, json={"spots": [[32, 18], [33, 17], [33, 18], [36, 18]]})
    assert r.status_code == 200 and r.json()["placed"] == 2 and r.json()["skipped"] == 2, r.text[:300]
    assert before - r.json()["resources"]["steel"] == 2 * game.cost("wall", 1)["steel"], (before, r.json()["resources"])
    assert code(c.post("/game/walls/build", headers=S, json={"spots": [[36, 18]]})) == "spot"
    new_ids = {b["id"] for b in r.json()["buildings"] if b["type"] == "wall" and b["x"] == 33}
    db.TABLES["game_buildings"][:] = [b for b in db.TABLES["game_buildings"] if b["id"] not in new_ids]   # 아래 검사 그대로 두려고 지움
    tick(61)
    assert B("battery", 31, 22) == "ok" and B("battery", 31, 23) == "ok"
    assert B("battery", 31, 24) == "def_full"
    tick(61)
    d = c.get("/game/state", headers=S).json()
    bat = next(b for b in d["buildings"] if b["type"] == "battery" and b["y"] == 17)
    df = bat["defense"]
    assert df["unit"]["no"] == 1 and df["rate"] == 25 and df["mult"] == 0.85 and df["dmg"] == round(30 * 0.85), df
    weak = [t for t in d["tips"] if t["id"] == "weak"]
    assert weak and weak[0]["type"] in ("battery", "mine", "wall"), d["tips"]
    # 이 장 문제 풀기 (자재 조달을 그 장 문제로) → 맞히면 정답률이 올라 힘이 세짐
    r = c.post("/game/supply/start", headers=S, json={"lang": "ko", "unit": "0-0"}).json()
    assert r["questions"] and all(q["unit_title"] == "제1장" for q in r["questions"]), r
    res = c.post("/game/supply/submit", headers=S, json={"id": r["id"], "answers": {q["id"]: 0 for q in r["questions"]}}).json()
    n = len(r["questions"])
    bat = next(b for b in res["state"]["buildings"] if b["type"] == "battery" and b["y"] == 17)
    assert bat["defense"]["n"] == 4 + n and bat["defense"]["rate"] == round((1 + res["right"]) / (4 + n) * 100), bat["defense"]
    assert c.post("/game/supply/start", headers=S, json={"lang": "ko", "unit": "9-9"}).json()["detail"]["code"] == "unit_no_questions"
    # 관리자: 연결할 장 바꾸기 (장 번호), 장 이름 목록
    gs = c.get("/admin/game-settings", headers=A).json()
    assert len(gs["units"]) == 2 and gs["settings"]["link_battery"] == 0
    assert c.put("/admin/game-settings", headers=A, json={**gs["settings"], "link_battery": 2}).status_code == 200
    d = c.get("/game/state", headers=S).json()
    assert next(b for b in d["buildings"] if b["type"] == "battery")["defense"]["unit"]["no"] == 2
    assert next(b for b in d["buildings"] if b["type"] == "battery")["defense"]["mult"] == 1.0   # 2장은 기록 없음
    # 무기: 연구소 레벨 조건, 기술 포인트로 연구, 레벨은 본관까지
    w = {x["kind"]: x for x in d["weapons"]["list"]}
    assert w["gun"]["level"] == 1 and w["torpedo"]["lock"] is None and d["weapons"]["academy"] == 3
    tech0 = d["resources"]["tech"]
    d = c.post("/game/weapon/research", headers=S, json={"kind": "torpedo"}).json()
    assert {x["kind"]: x["level"] for x in d["weapons"]["list"]}["torpedo"] == 1 and d["resources"]["tech"] == tech0 - 60
    assert code(c.post("/game/weapon/research", headers=S, json={"kind": "torpedo"})) == "already"
    assert code(c.post("/game/weapon/upgrade", headers=S, json={"kind": "gun"})) == "ok"
    assert code(c.post("/game/weapon/upgrade", headers=S, json={"kind": "gun"})) == "ok"
    assert code(c.post("/game/weapon/upgrade", headers=S, json={"kind": "gun"})) == "hq_level"
    assert code(c.post("/game/weapon/upgrade", headers=S, json={"kind": "ciws"})) == "not_researched"
    # 전투함에 무기 달기 (칸 수까지, 연구한 것만), 선체 올리기
    F = lambda arms: code(c.post("/game/warship/fit", headers=S, json={"id": ship["id"], "weapons": arms}))
    assert F(["gun", "torpedo"]) == "bad_slots" and F(["ciws"]) == "not_researched" and F([]) == "bad_slots"
    assert F(["torpedo"]) == "ok"
    d = c.post("/game/warship/hull", headers=S, json={"id": ship["id"]}).json()
    f = d["fleet"]["ships"][0]
    assert f["weapons"] == ["torpedo"] and f["hull"] == 2 and f["max_hp"] == 120 and f["attack"] == int(20 * 1.15) + 20, f
    assert f["hull_next"]["block"] is None
    # 장벽 한꺼번에 올리기
    d = c.post("/game/walls/upgrade", headers=S).json()
    assert sorted(b["level"] for b in d["buildings"] if b["type"] == "wall") == [2, 2]
    # 옛 간척 땅(14칸) 조선소 → 불러올 때 큰 땅으로 한 번 옮김 (땅 건물은 가운데로, 해안·바다 시설은 새 해안선으로), 간척 공사 중이면 돌려줌
    so, SO = user("s_old", "student")
    db.insert_rows("game_bases", {"user_id": so, "tutorial_done": True, "reclaim": 0, "reclaim_until": NOW[0].isoformat()})
    for t, x, y in [("hq", 6, 6), ("dock", 12, 1), ("pier", 12, 8), ("battery", 13, 3), ("mine", 14, 5), ("wall", 15, 9), ("cutting", 2, 2)]:
        db.insert_rows("game_buildings", {"id": str(_u.uuid4()), "user_id": so, "type": t, "level": 1, "x": x, "y": y,
                                          "collected_at": NOW[0].isoformat()})
    d = c.get("/game/state", headers=SO).json()
    pos = {b["type"]: (b["x"], b["y"]) for b in d["buildings"]}
    assert d["grid"] == 32 and d["sea"] == 4 and d["reclaim"] is None, d["grid"]
    assert pos == {"hq": (15, 15), "dock": (30, 10), "pier": (30, 17), "battery": (31, 12), "mine": (32, 14), "wall": (33, 18),
                   "cutting": (11, 11)}, pos
    assert d["resources"]["steel"] >= 1500 and d["builders"]["busy"] == 0, d["resources"]
    assert c.get("/game/state", headers=SO).json()["buildings"][0]["x"] == d["buildings"][0]["x"]   # 두 번 옮기지 않음
    assert c.post("/game/weapon/research", headers=T1, json={"kind": "gun"}).status_code == 403
    # ---- G2b-2: 해적 연습 전투·수리·다시 보기·태풍 대비 훈련 ----
    import game_battle
    pv = c.get("/game/pirate", headers=S).json()
    assert pv["stages"][0]["open"] and not pv["stages"][1]["open"] and pv["ready"] == 1, pv["stages"][:2]
    assert pv["typhoon"]["done_today"] is False and pv["history"] == []
    assert code(c.post("/game/pirate/attack", headers=S, json={"stage": 2, "ships": [ship["id"]]})) == "stage_locked"
    assert code(c.post("/game/pirate/attack", headers=S, json={"stage": 1, "ships": []})) == "no_ships"
    assert code(c.post("/game/pirate/attack", headers=S, json={"stage": 1, "ships": [ship["id"]], "lane": "x"})) == "bad_plan"
    steel0 = c.get("/game/state", headers=S).json()["resources"]["steel"]
    r = c.post("/game/pirate/attack", headers=S, json={"stage": 1, "ships": [ship["id"]], "lane": "middle", "target": "defense"})
    assert r.status_code == 200, r.text
    bt, st = r.json()["battle"], r.json()["state"]
    assert bt["stars"] >= 1 and bt["frames"] and bt["first_stars"] == bt["stars"] and bt["note"]["id"], (bt["stars"], bt["pct"])
    assert bt["got"]["tech"] == int(10 * sum(game_battle.STAR_SHARE[:bt["stars"]])) or bt["got"]["tech"] > 0
    f = st["fleet"]["ships"][0]
    assert f["damage"] > 0 and f["repair"]["rods"] == f["damage"], f
    assert any(t["id"] == "repair" for t in st["tips"])
    # 같은 입력이면 같은 결과
    ws = game.warship_stats({"kind": "patrol", "hull": 2, "weapons": ["torpedo"]}, {"gun": 3, "torpedo": 1})
    one = [{"id": "a", "kind": "patrol", "max_hp": ws["max_hp"], "attack": ws["attack"], "weapons": ws["weapons"]}]
    assert game_battle.simulate(1, one, "middle", "defense")["frames"] == bt["frames"]
    # 다친 배는 출격 못 함 → 수리 (용접봉 + 시간, 기술 포인트로 당기기)
    assert code(c.post("/game/pirate/attack", headers=S, json={"stage": 1, "ships": [ship["id"]]})) == "ship_damaged"
    d = c.post("/game/warship/repair", headers=S, json={"id": ship["id"]}).json()
    f = d["fleet"]["ships"][0]
    assert f["repair_left"] == f["damage"] * 6, f
    assert code(c.post("/game/warship/repair", headers=S, json={"id": ship["id"]})) == "busy"
    d = c.post("/game/speedup", headers=S, json={"target": f"repair:{ship['id']}", "using": "tech"}).json()
    d = c.get("/game/state", headers=S).json()
    f = d["fleet"]["ships"][0]
    assert f["damage"] == 0 and "repair_left" not in f and "repair" not in f, f
    # 다시 보기 + 기록
    rp = c.get(f"/game/battle/{bt['id']}", headers=S).json()["battle"]
    assert rp["frames"] == bt["frames"]
    pv = c.get("/game/pirate", headers=S).json()
    assert pv["history"][0]["stars"] == bt["stars"] and pv["stages"][1]["open"]
    # 같은 별로는 두 번 안 받음
    r2 = c.post("/game/pirate/attack", headers=S, json={"stage": 1, "ships": [ship["id"]]}).json()["battle"]
    assert r2["first_stars"] == 0 and r2["got"] == {"steel": 0, "rods": 0, "tech": 0, "fame": 0}
    # 태풍 대비 훈련: 하루 한 번, 장벽(레벨 합) + 문제
    ty = c.post("/game/typhoon/start", headers=S, json={"lang": "ko"}).json()
    assert ty["questions"], ty
    tr = c.post("/game/typhoon/submit", headers=S, json={"id": ty["id"], "answers": {q["id"]: 0 for q in ty["questions"]}}).json()
    assert tr["wall_pct"] == round(min(1, 4 / 16) * 60) and tr["pct"] == tr["wall_pct"] + tr["quiz_pct"] or abs(tr["pct"] - tr["wall_pct"] - tr["quiz_pct"]) <= 1, tr
    assert code(c.post("/game/typhoon/start", headers=S, json={"lang": "ko"})) == "typhoon_done"
    assert c.get("/game/pirate", headers=S).json()["typhoon"]["done_today"] is True


if __name__ == "__main__":
    main()
