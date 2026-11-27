"""T5 시험: 수업 중 돌발 OX (보내기·준비·답하기·끝내기·학습 보드·웰디 설명·지난주 결산). Claude 는 가짜.
실행: python -m tests.live_check"""
import time
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

import accounts
import app as server
import board
import daily
import live
import report
from tests import fake_db as db
from tests.textbook_check import H

TOC = [{"title": "제1편 기초", "page": 4, "chapters": [{"title": "제1장 아크", "page": 4, "sections": []},
                                                    {"title": "제2장 가스", "page": 6, "sections": []}]}]
CLOCK = [1000.0]
CALLS = []


def fake_ask(model, system, text, max_tokens, timeout=180):
    CALLS.append(system[:20])
    if system is live.OX_SYSTEM:
        return {"questions": [{"question": "아크 길이가 길면 언더컷이 생기기 쉽다.", "answer": 0, "explanation": "해설", "page": 8}]}
    if system is live.EXPLAIN_SYSTEM:
        assert "Class: 1 of 2" in text, text
        return {"text": "정답은 O예요. 쉽게 설명할게요."}
    if system.startswith("Translate this short"):
        return {"text": "EN explain"}
    if system.startswith("Translate"):
        import json
        items = json.loads(text)["items"]
        return {"items": [{**i, "question": "EN " + i["question"], "explanation": "EN 해설"} for i in items]}
    raise AssertionError(system[:40])


def wait(cond, sec=3):
    end = time.time() + sec
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    raise AssertionError("시간 초과")


def main():
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    report.configured = lambda: True
    daily._ask = fake_ask
    live.reset()
    live._now = lambda: CLOCK[0]
    board.clear_cache()
    c = TestClient(server.app)

    def user(lid, role, course=None):
        u = db.insert_rows("users", {"login_id": lid, "login_key": lid, "name": lid, "role": role, "status": "active",
                                     "password_hash": accounts.hash_password("p")})[0]
        if course:
            db.insert_rows("user_courses", {"user_id": u["id"], "course_id": course})
        tok = c.post("/auth/login", json={"login_id": lid, "password": "p"}).json()["token"]
        return u["id"], H(tok)

    ca = db.insert_rows("courses", {"name": "뉴딜2기", "sort": 1, "active": True})[0]["id"]
    cb = db.insert_rows("courses", {"name": "페루반", "sort": 2, "active": True})[0]["id"]
    s1, S1 = user("s1", "student", ca)
    s2, S2 = user("s2", "student", ca)
    s3, S3 = user("s3", "student", ca)
    s4, S4 = user("s4", "student", cb)
    t1, T1 = user("t1", "teacher", ca)
    _, A = user("admin", "admin")

    # 아무 문제 없을 때: 로그인 확인 없이 바로 빈 답
    assert c.get("/live/now").json() == {"quiz": None, "launches": []}
    # 교육생·남의 반 교사는 못 보냄
    assert c.get("/live/setup", headers=S1).status_code == 403
    assert c.post("/live/start", headers=T1, json={"course_id": cb, "text": "문장", "answer": 0}).status_code == 404

    bid = db.insert_rows("textbooks", {"title": "용접 교재", "pages": 8, "page_offset": 2, "toc": TOC, "is_current": True,
                                       "status": "ready", "show_students": True, "use_for_ai": True})[0]["id"]
    for p in range(4, 9):
        db.insert_rows("textbook_pages", {"book_id": bid, "page": p, "text": "아크 용접 설명 " * 40})
    q0 = db.insert_rows("quiz_questions", {"book_id": bid, "unit_key": "0-0", "unit_title": "제1장 아크", "kind": "ox",
                                           "question": "아크는 전기 방전이다.", "choices": [], "answer": 0,
                                           "model_answer": "", "explanation": "맞아요", "page": 6, "status": "active",
                                           "translations": {}, "source": "admin"})[0]["id"]

    st = c.get("/live/setup", headers=T1).json()
    assert [x["name"] for x in st["courses"]] == ["뉴딜2기"], st["courses"]
    assert [(u["unit_key"], u["ox"]) for u in st["units"]] == [("0-0", 1), ("0-1", 0)], st["units"]
    assert len(c.get("/live/setup", headers=A).json()["courses"]) == 2

    # 문제 은행에서 고르기 → 장에 OX 가 없으면 AI 로 만들기 제안 → 만들기
    pk = c.post("/live/pick", headers=T1, json={"course_id": ca, "unit_key": "0-0"}).json()
    assert pk["question"]["id"] == q0 and pk["question"]["printed_page"] == 4, pk
    assert c.post("/live/pick", headers=T1, json={"course_id": ca, "unit_key": "0-1"}).json() == {"question": None, "can_make": True}
    made = c.post("/live/pick", headers=T1, json={"course_id": ca, "unit_key": "0-1", "make": True}).json()
    assert made["made"] and made["question"]["page"] == 8
    newq = next(q for q in db.TABLES["quiz_questions"] if q["id"] == made["question"]["id"])
    assert newq["source"] == "live" and newq["status"] == "active" and newq["unit_key"] == "0-1"

    # 교육생 s2 는 영어로 앱을 쓰는 중 (언어 기억용으로 한 번 물어봄 — 아직 문제 없음)
    live._seen[s2] = (CLOCK[0], "en")

    # 보내기 → 준비(번역) → 열림
    r = c.post("/live/start", headers=T1, json={"course_id": ca, "question_id": q0, "seconds": 20})
    assert r.status_code == 200, r.text
    quiz = r.json()["quiz"]
    qid = quiz["id"]
    assert quiz["phase"] == "prep" and quiz["targets"] == 3
    wait(lambda: live._get_quiz(qid)["ready"])
    now1 = c.get("/live/now?lang=en", headers=S2).json()["quiz"]
    assert now1["phase"] == "open" and now1["tr"] == "EN 아크는 전기 방전이다." and now1["left"] == 20, now1
    assert now1["result"] is None
    # 다른 반 교육생에겐 안 뜸, 교사에게도 안 뜸
    assert c.get("/live/now", headers=S4).json()["quiz"] is None
    assert c.get("/live/now", headers=T1).json()["quiz"] is None

    # 답하기 (시간 안에는 바꿀 수 있음), 다른 반은 못 함
    assert c.post("/live/answer", headers=S1, json={"quiz_id": qid, "answer": 1}).status_code == 200
    assert c.post("/live/answer", headers=S1, json={"quiz_id": qid, "answer": 0}).status_code == 200
    assert c.post("/live/answer", headers=S4, json={"quiz_id": qid, "answer": 0}).status_code == 404
    assert c.post("/live/answer", headers=S2, json={"quiz_id": qid, "answer": 2}).status_code == 400
    CLOCK[0] += 10
    assert c.post("/live/answer", headers=S2, json={"quiz_id": qid, "answer": 1}).status_code == 200
    stt = c.get(f"/live/status/{qid}", headers=T1).json()["quiz"]
    assert (stt["answered"], stt["o"], stt["x"], stt["waiting"], stt["left"]) == (2, 1, 1, ["s3"], 10), stt
    assert c.get(f"/live/status/{qid}", headers=S1).status_code == 403
    assert c.post(f"/live/explain/{qid}", headers=T1).status_code == 409  # 아직 안 끝남

    # 시간 끝 (+봐주는 1.5초) → 끝, 늦은 답은 거절
    CLOCK[0] += 10.5
    assert c.post("/live/answer", headers=S3, json={"quiz_id": qid, "answer": 0}).status_code == 200  # 1초 늦음: 봐줌
    CLOCK[0] += 1.5
    assert c.post("/live/answer", headers=S3, json={"quiz_id": qid, "answer": 1}).status_code == 409
    stt = c.get(f"/live/status/{qid}", headers=T1).json()["quiz"]
    assert stt["phase"] == "ended" and stt["stats"] == {"answered": 3, "correct": 2, "targets": 3, "rate": 67}, stt
    assert stt["wrong"] == ["s2"]
    res = c.get("/live/now?lang=en", headers=S2).json()["quiz"]["result"]
    assert res["correct"] is False and res["answer"] == 0 and res["rate"] == 67 and res["tr_explanation"] == "EN 해설"
    assert res["printed_page"] == 4
    wait(lambda: len(db.TABLES.get("live_ox_answers", [])) == 3)
    row = db.TABLES["live_ox"][0]
    assert row["answered"] == 3 and row["correct"] == 2 and row["ended_at"]

    # 웰디가 설명하기 → 교육생 언어로
    # (가짜 AI 는 'Class: 1 of 2' 를 기대하므로 통계를 맞춰 둔다: 설명 함수가 받는 숫자 확인용)
    live._get_quiz(qid)["stats"].update({"answered": 2, "correct": 1})
    ex = c.post(f"/live/explain/{qid}", headers=T1).json()["quiz"]
    assert ex["explain_status"] in ("making", "ready")
    wait(lambda: live._get_quiz(qid)["explain_status"] == "ready")
    wait(lambda: "en" in (live._get_quiz(qid)["explain"] or {}))
    res = c.get("/live/now?lang=en", headers=S2).json()["quiz"]["result"]
    assert res["explain"] == "EN explain" and res["explain_lang"] == "en", res
    assert c.get("/live/now?lang=ko", headers=S1).json()["quiz"]["result"]["explain"] == "정답은 O예요. 쉽게 설명할게요."

    # 직접 친 문제 + 교사가 먼저 끝내기
    r = c.post("/live/start", headers=T1, json={"course_id": ca, "text": "  보호 가스는 질소다. ", "answer": 1, "seconds": 10}).json()
    q2 = r["quiz"]["id"]
    typed = db.TABLES["quiz_questions"][-1]
    assert typed["question"] == "보호 가스는 질소다." and typed["status"] == "live" and typed["unit_key"] == ""
    wait(lambda: live._get_quiz(q2)["ready"])
    assert c.get("/live/now", headers=S1).json()["quiz"]["id"] == q2
    c.post("/live/answer", headers=S1, json={"quiz_id": q2, "answer": 1})
    end = c.post(f"/live/end/{q2}", headers=T1).json()["quiz"]
    assert end["phase"] == "ended" and end["stats"]["correct"] == 1 and end["waiting"] == ["s2", "s3"]
    assert c.post("/live/answer", headers=S2, json={"quiz_id": q2, "answer": 1}).status_code == 409
    wait(lambda: len(db.TABLES["live_ox_answers"]) == 4)
    # 교사가 직접 친 문제는 문제 은행 목록·매일 문제에 안 나옴
    items = c.get(f"/admin/textbooks/{bid}/questions", headers=A).json()["items"]
    assert typed["id"] not in [i["id"] for i in items] and len(items) == 2
    assert c.post("/live/start", headers=T1, json={"course_id": ca, "text": "", "answer": 1}).status_code == 400
    assert c.post("/live/start", headers=T1, json={"course_id": ca, "question_id": q0, "seconds": 15}).status_code == 400

    # 오늘 기록
    hist = c.get(f"/live/history?course_id={ca}", headers=T1).json()["items"]
    assert len(hist) == 2 and {h["rate"] for h in hist} == {67, 100}, hist

    # 학습 보드: 돌발 OX 도 문제 풀이에 (맞으면 10점), 교사 칸에 놓친 학생
    board.clear_cache()
    sb = c.get("/study-board?period=week", headers=T1).json()
    rows = {r["name"]: r for r in sb["rows"]}
    assert rows["s1"]["live"] == 2 and rows["s1"]["score"] == 20, rows["s1"]
    assert rows["s2"]["live"] == 1 and rows["s2"]["score"] == 0
    missed = {m["name"]: (m["missed"], m["total"]) for m in sb["staff"]["live_missed"]}
    assert missed == {"s2": (1, 2), "s3": (1, 2)}, missed

    # 월요일 지난주 결산: 기록을 지난주로 옮겨서
    this_mon = datetime.fromisoformat(board.social.period_start("week"))
    for a in db.TABLES["live_ox_answers"]:
        a["created_at"] = (this_mon - timedelta(days=2)).astimezone(timezone.utc).isoformat()
    board.clear_cache()
    rc = c.get("/study-board/last-week", headers=S1).json()
    assert rc["me"]["solved"] == 2 and rc["me"]["rate"] == 100 and rc["me"]["rank"] == 1 and rc["me"]["live"] == 2, rc
    assert rc["top"] == {"name": "s1", "solved": 2} and rc["start"] == (this_mon - timedelta(days=7)).date().isoformat()
    assert c.get("/study-board/last-week", headers=S4).json()["me"]["solved"] == 0
    tc = c.get("/study-board/last-week", headers=T1).json()
    assert tc["me"] is None and [x["name"] for x in tc["courses"]] == ["뉴딜2기"], tc
    assert tc["courses"][0]["participation"] == 100 and tc["courses"][0]["avg_rate"] == 75, tc["courses"]

    # 끝나고 15분 지나면 교육생 화면에서 사라짐
    CLOCK[0] += live.KEEP_ENDED + 1
    assert c.get("/live/now", headers=S1).json()["quiz"] is None
    # 반 정답률이 낮았던 돌발 OX → 다음 매일 문제에 다시 (맞힌 사람은 빼고)
    db.SETTINGS["daily"] = {"ox": 1, "mc": 0, "word": 0, "short": 0}
    r = c.post("/live/start", headers=T1, json={"course_id": ca, "question_id": newq["id"], "seconds": 10}).json()
    q3 = r["quiz"]["id"]
    wait(lambda: live._get_quiz(q3)["ready"])
    c.get("/live/now", headers=S1)
    for hdr, a in ((S1, 0), (S2, 1), (S3, 1)):
        assert c.post("/live/answer", headers=hdr, json={"quiz_id": q3, "answer": a}).status_code == 200
    c.post(f"/live/end/{q3}", headers=T1)
    wait(lambda: (next(x for x in db.TABLES["live_ox"] if x["id"] == q3).get("answered") or 0) == 3)
    d2 = c.get("/daily", headers=S2).json()
    assert d2["ready"] and d2["items"][0]["id"] == newq["id"] and d2["items"][0]["review"] is True, d2["items"]
    assert len(d2["items"]) == 2 and d2["items"][1]["review"] is False and d2["items"][1]["id"] == q0
    d1 = c.get("/daily", headers=S1).json()
    assert all(not i["review"] for i in d1["items"])  # 맞힌 s1 은 다시 풀기 없음
    # 다시 불러도(개수 맞추기) 다시 풀기 문제는 그대로
    d2b = c.get("/daily", headers=S2).json()
    assert [i["id"] for i in d2b["items"]] == [i["id"] for i in d2["items"]]
    ok = c.post("/daily/answer", headers=S2, json={"question_id": newq["id"], "answer": 0}).json()
    assert ok["result"]["correct"] is True
    assert live.review_for(s3, bid, exclude=[newq["id"]]) == []
    assert live.review_for(s3, bid) == [newq["id"]]
    print("live_check OK", {"ai_calls": len(CALLS)})


if __name__ == "__main__":
    main()
