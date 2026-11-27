"""T4 시험: 학습 보드 (문제 풀이 순위·많이 물어본 질문·많이 틀린 문제·장별 정답률·연속 일수). Claude 는 가짜.
실행: python -m tests.board_check"""
import json
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

import accounts
import app as server
import board
import daily
import report
from tests import fake_db as db
from tests.textbook_check import H

TOC = [{"title": "제1편 기초", "page": 4, "chapters": [{"title": "제1장 아크", "page": 4, "sections": []},
                                                    {"title": "제2장 가스", "page": 6, "sections": []}]}]
TAGS = []


def fake_ask(model, system, text, max_tokens, timeout=180):
    if system is board.TOPIC_SYSTEM:
        qs = [l.split(". ", 1)[1] for l in text.split("QUESTIONS:\n")[1].splitlines()]
        TAGS.append(len(qs))
        return {"topics": ["언더컷 원인" if "언더컷" in q or "undercut" in q else "보호 가스" for q in qs]}
    if system.startswith("Translate"):
        return {"items": []}
    raise AssertionError(system[:40])


def at(minutes=0, days=0):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes, days=days)).isoformat()


def main():
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    report.configured = lambda: True
    daily._ask = fake_ask
    board.clear_cache()
    c = TestClient(server.app)

    def user(lid, role, course=None):
        u = db.insert_rows("users", {"login_id": lid, "login_key": lid, "name": lid, "role": role, "status": "active",
                                     "password_hash": accounts.hash_password("p")})[0]
        if course:
            db.insert_rows("user_courses", {"user_id": u["id"], "course_id": course})
        tok = c.post("/auth/login", json={"login_id": lid, "password": "p"}).json()["token"]
        return u["id"], H(tok)

    ca = db.insert_rows("courses", {"name": "뉴딜2기", "sort": 1})[0]["id"]
    cb = db.insert_rows("courses", {"name": "페루반", "sort": 2})[0]["id"]
    s = {}
    for i in range(1, 7):
        s[i] = user(f"s{i}", "student", ca if i <= 4 else cb)
    t1, T1 = user("t1", "teacher", ca)

    assert c.get("/study-board", headers=T1).json()["book"] is None  # 교재 없음

    bid = db.insert_rows("textbooks", {"title": "용접 교재", "pages": 8, "page_offset": 0, "toc": TOC, "is_current": True,
                                       "status": "ready", "show_students": True, "use_for_ai": True})[0]["id"]
    q = {}
    for n, (unit, kind, ans) in enumerate([("0-0", "mc", 2), ("0-0", "ox", 0), ("0-1", "mc", 1), ("0-1", "short", None)]):
        q[n] = db.insert_rows("quiz_questions", {"book_id": bid, "unit_key": unit, "unit_title": unit, "kind": kind,
                                                 "question": f"문제{n}", "choices": ["a", "b", "c", "d"] if kind == "mc" else [],
                                                 "answer": ans, "model_answer": "모범", "explanation": "해설", "page": 4 if unit == "0-0" else 6,
                                                 "status": "active", "translations": {}})[0]["id"]

    def daily_ans(uid, qn, score, answer=None, mins=10, day=None):
        db.insert_rows("daily_answers", {"user_id": uid, "day": day or daily.today().isoformat(), "question_id": q[qn],
                                         "book_id": bid, "kind": "mc", "answer": answer, "score": score,
                                         "correct": None if score is None else score >= 6, "created_at": at(mins)})

    def tutor_ans(uid, qn, ok, answer=0, mins=5):
        db.insert_rows("tutor_answers", {"user_id": uid, "book_id": bid, "question_id": q[qn], "unit_key": "0-0",
                                         "kind": "mc", "answer": answer, "correct": ok, "created_at": at(mins)})

    # 문제0: 6명 모두 풂, 5명 틀림 (오답 3번을 4명이 고름) → 많이 틀린 문제 1위
    for i in range(1, 7):
        daily_ans(s[i][0], 0, 10 if i == 1 else 0, "2" if i == 1 else ("3" if i <= 5 else "1"), mins=30)
    # s1: 문제1 맞음(웰디) + 문제0 다시 풂(웰디, 처음 것만 셈) + 서술형 7점 + 채점 대기
    tutor_ans(s[1][0], 1, True)
    tutor_ans(s[1][0], 0, False, mins=1)
    daily_ans(s[1][0], 3, 7, "글", mins=8)
    daily_ans(s[1][0], 2, None, mins=7)
    # s2: 문제1·2 맞음
    tutor_ans(s[2][0], 1, True)
    tutor_ans(s[2][0], 2, True)
    # 교사 풀이는 순위에 안 들어감
    tutor_ans(t1, 1, True)

    r = c.get("/study-board", params={"period": "week"}, headers=s[1][1])
    assert r.status_code == 200, r.text
    b = r.json()
    rows = {x["name"]: x for x in b["rows"]}
    assert set(rows) == {"s1", "s2", "s3", "s4", "s5", "s6"}, rows.keys()
    assert rows["s1"]["solved"] == 3 and rows["s1"]["correct"] == 3 and rows["s1"]["score"] == 27, rows["s1"]
    assert rows["s1"]["daily"] == 2 and rows["s1"]["tutor"] == 1 and rows["s1"]["rate"] == 100, rows["s1"]
    assert rows["s2"]["solved"] == 3 and rows["s2"]["score"] == 20 and rows["s2"]["rank"] == 2, rows["s2"]
    assert rows["s1"]["rank"] == 1 and rows["s1"]["courses"] == ["뉴딜2기"], rows["s1"]
    assert b["me"]["user_id"] == s[1][0] and b["total"] == 6, b["me"]
    # 점수 순
    b2 = c.get("/study-board", params={"sort": "score"}, headers=s[3][1]).json()
    assert [x["name"] for x in b2["rows"][:2]] == ["s1", "s2"] and b2["me"]["rank"] >= 3, b2["rows"]
    # 정답률 순: 10문제 미만은 빠짐, 나는 순위 없음 + 이유
    b3 = c.get("/study-board", params={"sort": "rate"}, headers=s[1][1]).json()
    assert b3["rows"] == [] and b3["me"]["rank"] is None and b3["me"]["rank_note"] == "need_more", b3["me"]
    # 과정별
    bb = c.get("/study-board", params={"course": cb}, headers=s[5][1]).json()
    assert {x["name"] for x in bb["rows"]} == {"s5", "s6"} and bb["wrong"] == [], bb  # 2명뿐이라 틀린 문제 없음
    # 많이 틀린 문제 (전체): 문제0, 정답률 1/6, 가장 많이 고른 오답 3번 (4명)
    w = b["wrong"]
    assert len(w) == 1 and w[0]["qid"] == q[0] and w[0]["attempts"] == 6 and w[0]["wrong"] == 5, w
    assert w[0]["rate"] == 17 and w[0]["top_wrong"] == 3 and w[0]["top_wrong_n"] == 4, w
    assert w[0]["item"]["result"] is None and w[0]["item"]["reveal"]["correct_choice"] == 2, w[0]["item"]
    # 장별 정답률
    units = {u["unit_key"]: u for u in b["units"]}
    assert units["0-0"]["attempts"] == 8 and units["0-0"]["correct"] == 3, units
    assert units["0-1"]["attempts"] == 2 and units["0-1"]["rate"] == 100, units
    # 교사도 볼 수 있고, 교사는 '나' 가 없음
    bt = c.get("/study-board", headers=T1).json()
    assert bt["me"] is None and len(bt["rows"]) == 6
    # 안 푼 교육생도 '나' 카드는 나옴
    s7 = user("s7", "student", ca)
    b7 = c.get("/study-board", headers=s7[1]).json()
    assert b7["me"]["solved"] == 0 and b7["me"]["rank"] is None, b7["me"]

    # 🔥 연속 일수: s3 이 어제·그제 매일 문제(3개)를 다 풂
    board.clear_cache()
    for d in (1, 2):
        day = (daily.today() - timedelta(days=d)).isoformat()
        for n in range(3):
            db.insert_rows("daily_answers", {"user_id": s[3][0], "day": day, "question_id": f"x{d}{n}", "book_id": "other",
                                             "kind": "mc", "answer": "0", "score": 10, "correct": True, "created_at": at(days=d)})
    rows = {x["name"]: x for x in c.get("/study-board", headers=s[3][1]).json()["rows"]}
    assert rows["s3"]["streak"] == 2 and rows["s1"]["streak"] == 1 and rows["s2"]["streak"] == 0, (rows["s3"], rows["s1"])

    # 약한 장: s4 가 0-0 장을 3번 풀어 1번만 맞음
    board.clear_cache()
    tutor_ans(s[4][0], 1, True)
    db.insert_rows("tutor_answers", {"user_id": s[4][0], "book_id": bid, "question_id": q[1], "kind": "ox", "answer": 1,
                                     "correct": False, "created_at": at(0)})  # 같은 문제 다시: 안 셈
    daily_ans(s[4][0], 2, 0, "0", mins=3)
    tutor_ans(s[4][0], 1, True)
    me = c.get("/study-board", headers=s[4][1]).json()["me"]
    assert me["solved"] == 3 and me["weak_unit"] is None, me  # 0-0: 2번 (0 틀림 + 1 맞음) → 3번 미만
    daily_ans(s[4][0], 3, 3, "글", mins=2)
    board.clear_cache()
    me = c.get("/study-board", headers=s[4][1]).json()["me"]
    assert me["weak_unit"] is None, me  # 0-1 장: 2번
    board.MIN_WEAK = 2
    me = c.get("/study-board", headers=s[4][1]).json()["me"]
    assert me["weak_unit"]["unit_key"] == "0-1" and me["weak_unit"]["rate"] == 0, me  # 0-1: 2번 다 틀림, 0-0: 반만
    board.MIN_WEAK = 3
    board.clear_cache()

    # 많이 물어본 질문: 주제가 없으면 뒤에서 붙이고, 다음에 묶어서 보임 (이름 없음)
    for i, (uid, text, lang) in enumerate([(s[1][0], "언더컷이 왜 생겨?", "ko"), (s[2][0], "언더컷 원인 알려줘", "ko"),
                                            (s[5][0], "why undercut?", "en"), (s[1][0], "보호 가스 뭐야", "ko"),
                                            (t1, "언더컷?", "ko")]):
        db.insert_rows("tutor_messages", {"user_id": uid, "book_id": bid, "lang": lang, "question": text,
                                          "answer": f"대답{i}", "pages": [4], "kind": "explain", "ai": True,
                                          "topic": None, "created_at": at(i)})
    db.insert_rows("tutor_messages", {"user_id": s[3][0], "book_id": bid, "lang": "ko", "question": "언더컷 원인?",
                                      "answer": "대답(저장된 답)", "pages": [4], "kind": "explain", "ai": False,
                                      "cache_of": "x", "topic": None, "created_at": at(9)})  # 저장된 답으로 대답한 질문도 셈
    db.insert_rows("tutor_answers", {"user_id": s[6][0], "book_id": bid, "question_id": q[3], "kind": "word",
                                     "answer": "글", "correct": None, "created_at": at(0)})  # 채점 대기는 안 셈
    db.insert_rows("tutor_messages", {"user_id": s[1][0], "book_id": bid, "question": "날씨", "answer": "", "pages": [],
                                      "kind": "offtopic", "ai": True, "topic": None, "created_at": at(0)})
    b = c.get("/study-board", params={"lang": "en"}, headers=s[6][1]).json()
    assert b["tagging"] == 6 and TAGS == [6], (b["tagging"], TAGS)  # 뒤에서 한 번에 붙임 (잡담은 안 셈)
    b = c.get("/study-board", params={"lang": "en"}, headers=s[6][1]).json()
    assert b["tagging"] == 0, b["tagging"]
    tp = b["topics"]
    assert tp[0]["topic"] == "언더컷 원인" and tp[0]["users"] == 4 and tp[0]["count"] == 4, tp  # 교사 질문은 안 셈
    assert tp[0]["answer"] == "대답2" and tp[0]["pages"] == [{"page": 4, "printed": 4}], tp[0]  # 내 언어 대답 먼저
    assert tp[1]["topic"] == "보호 가스" and tp[1]["count"] == 1, tp
    assert "user_id" not in tp[0] and "name" not in tp[0]
    bb = c.get("/study-board", params={"course": cb}, headers=s[6][1]).json()
    assert [x["topic"] for x in bb["topics"]] == ["언더컷 원인"], bb["topics"]

    # 사람을 누르면 장별 정답률
    uu = c.get(f"/study-board/user/{s[1][0]}", headers=s[6][1]).json()["units"]
    assert [(u["unit_key"], u["attempts"], u["correct"]) for u in uu] == [("0-0", 2, 2), ("0-1", 1, 1)], uu
    assert c.get("/study-board/user/nope", headers=T1).status_code == 404

    # 2차: 이번 주 성장왕 · 과정 대항전 · 교사용 칸
    import social
    from datetime import datetime as _dt
    last = (_dt.fromisoformat(social.period_start("week")) - timedelta(days=1)).astimezone(timezone.utc).isoformat()
    for qn in (1, 2):  # s2: 지난주 2문제 다 틀림 → 이번 주 3문제 중 2개 맞음
        db.insert_rows("tutor_answers", {"user_id": s[2][0], "book_id": bid, "question_id": q[qn], "kind": "mc",
                                         "answer": "3", "correct": False, "created_at": last})
    board.MIN_GROWTH = 2
    board.clear_cache()
    b = c.get("/study-board", headers=s[5][1]).json()
    g = b["growth"]
    assert [x["name"] for x in g] == ["s2"] and g[0]["last_rate"] == 0 and g[0]["this_rate"] == 67 and g[0]["delta"] == 67, g  # 이번 주 3문제 중 2개
    assert c.get("/study-board", params={"course": cb}, headers=s[5][1]).json()["growth"] == []  # 과정 선택을 따름
    board.MIN_GROWTH = 5
    cs = {x["name"]: x for x in b["courses"]}
    assert cs["뉴딜2기"]["students"] == 5 and cs["페루반"]["students"] == 2, cs  # s1~s4 + s7
    assert cs["페루반"]["active"] == 2 and cs["페루반"]["participation"] == 100, cs["페루반"]
    assert cs["뉴딜2기"]["active"] == 4 and cs["뉴딜2기"]["participation"] == 80, cs["뉴딜2기"]
    assert b["staff"] is None  # 교육생에게는 교사용 칸 없음
    db.insert_rows("question_reports", {"question_id": q[0], "user_id": s[1][0], "reason": "보기 이상", "created_at": at(0)})
    mid = db.TABLES["tutor_messages"][0]["id"]
    db.TABLES["tutor_messages"][0].update(reported=True, report_note="틀림", reported_at=at(0))
    st = c.get("/study-board", params={"course": ca}, headers=T1).json()["staff"]
    assert [x["name"] for x in st["idle"]] == ["s7"] and st["idle"][0]["last_day"] is None, st["idle"]
    assert [w["name"] for w in st["weak"]] == ["뉴딜2기"] and [u["unit_key"] for u in st["weak"][0]["units"]] == ["0-1", "0-0"], st["weak"]
    assert st["question_reports"][0]["question"] == "문제0" and st["question_reports"][0]["reason"] == "보기 이상", st
    assert st["tutor_reports"][0]["id"] == mid and st["tutor_reports"][0]["report_note"] == "틀림", st
    st = c.get("/study-board", headers=T1).json()["staff"]
    assert {w["name"] for w in st["weak"]} <= {"뉴딜2기", "페루반"}

    # 숨긴 교재 → 교육생은 통계 없음, 교사는 보임
    db.TABLES["textbooks"][0]["show_students"] = False
    assert c.get("/study-board", headers=s[1][1]).json()["hidden"] is True
    assert c.get("/study-board", headers=T1).json()["rows"]
    # 잘못된 값
    assert c.get("/study-board", params={"period": "year"}, headers=T1).status_code == 400
    assert c.get("/study-board", params={"sort": "x"}, headers=T1).status_code == 400
    assert c.get("/study-board", params={"course": "nope"}, headers=T1).status_code == 404
    assert c.get("/study-board").status_code == 401
    # 1000행 넘게 나눠 읽기
    board.PAGE = 2
    assert len(board.select_all("quiz_questions", {"select": "id"})) == 4
    board.PAGE = 1000
    print("board_check OK", json.dumps({"topics": len(tp), "wrong": len(w)}))


if __name__ == "__main__":
    main()
