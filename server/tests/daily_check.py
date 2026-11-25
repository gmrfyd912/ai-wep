"""T2 시험: 문제 은행 만들기·매일 문제 고르기·채점·번역·신고·교사 보드·관리자 수정. Claude 는 가짜.
실행: python -m tests.daily_check"""
import random
from datetime import date, timedelta

from fastapi.testclient import TestClient

import accounts
import app as server
import daily
import report
import textbook
from tests import fake_db as db
from tests.textbook_check import H, book_pdf


def fake_ask(model, system, text, max_tokens, timeout=180):
    if system is daily.QUIZ_SYSTEM:
        page = 4 if "Basics" in text else 6
        qs = [{"kind": "mc", "question": f"객관식 {i} {page}", "choices": ["가", "나", "다", "라"], "answer": i % 4,
               "explanation": "해설", "page": page} for i in range(daily.MC_PER_UNIT)]
        qs += [{"kind": "short", "question": f"주관식 {i} {page}", "model_answer": "모범 답", "points": ["핵심"],
                "explanation": "해설", "page": 999} for i in range(daily.SHORT_PER_UNIT)]
        qs.append({"kind": "mc", "question": "보기 3개 (버림)", "choices": ["a", "b", "c"], "answer": 0})
        return {"questions": qs}
    if system.startswith("You grade"):
        return {"score": 8 if "좋은" in text else 3, "feedback": "Good" if "English" in system else "피드백"}
    if system.startswith("Translate"):
        import json
        items = json.loads(text)["items"]
        return {"items": [{**i, "question": "EN " + i["question"], "explanation": "EN"} for i in items]}
    raise AssertionError(system[:40])


def main():
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    report.configured = lambda: True
    daily._ask = fake_ask
    textbook.make_toc = lambda *a, **k: (_ for _ in ()).throw(textbook.TocError("ai_not_configured"))
    daily.UNIT_TEXT_MIN = 1
    textbook._start_job = textbook.process_book
    daily._start_quiz_job = daily.run_quiz_job  # 시험에서는 바로 실행
    c = TestClient(server.app)

    def user(lid, role):
        u = db.insert_rows("users", {"login_id": lid, "login_key": lid, "name": lid, "role": role, "status": "active",
                                     "password_hash": accounts.hash_password("p")})[0]
        tok = c.post("/auth/login", json={"login_id": lid, "password": "p"}).json()["token"]
        return u["id"], H(tok)

    s1, S1 = user("s1", "student")
    s2, S2 = user("s2", "student")
    t1, T1 = user("t1", "teacher")
    t2, T2 = user("t2", "teacher")
    ad, A = user("ad", "admin")
    course = db.insert_rows("courses", {"name": "뉴딜4기", "active": True, "sort": 0})[0]["id"]
    db.insert_rows("user_courses", [{"user_id": s1, "course_id": course, "course_role": None},
                                    {"user_id": s2, "course_id": course, "course_role": None},
                                    {"user_id": t1, "course_id": course, "course_role": "homeroom"}])

    assert c.get("/daily", headers=S1).json()["reason"] == "no_book"
    bid = c.post("/admin/textbooks/upload", files={"file": ("b.pdf", book_pdf(), "application/pdf")}, headers=A).json()["id"]
    toc = [{"title": "Part 1", "page": 4, "chapters": [{"title": "Chapter 1 Basics", "page": 4, "sections": []},
                                                       {"title": "Chapter 2 Gas", "page": 6, "sections": []}]}]
    r = c.put(f"/admin/textbooks/{bid}", json={"toc": toc, "is_current": True}, headers=A)
    assert r.status_code == 200, r.text
    assert c.get("/daily", headers=S1).json()["reason"] == "no_questions"

    # 문제 은행 만들기 (권한·결과)
    assert c.post(f"/admin/textbooks/{bid}/quiz", json={}, headers=T1).status_code == 403
    r = c.post(f"/admin/textbooks/{bid}/quiz", json={}, headers=A)
    assert r.status_code == 200, r.text
    info = c.get(f"/admin/textbooks/{bid}/quiz", headers=A).json()
    assert info["status"] == "ready" and info["done"] == 2 and info["total"] == 2, info
    assert info["mc"] == 2 * daily.MC_PER_UNIT and info["short"] == 2 * daily.SHORT_PER_UNIT, info
    qs = db.TABLES["quiz_questions"]
    assert all(q["page"] in (4, 5, 6, 7, 8) for q in qs)  # 장 밖 쪽(999)은 장 첫 쪽으로
    # 다시 누르면 이미 있는 장은 건너뜀
    c.post(f"/admin/textbooks/{bid}/quiz", json={}, headers=A)
    assert len(db.TABLES["quiz_questions"]) == len(qs)

    # 매일 문제: 본 장이 없으면 앞쪽 장, 객관식 2 + 주관식 1, 정답은 안 보임
    random.seed(1)
    d = c.get("/daily", headers=S1).json()
    assert d["ready"] and d["total"] == 3 and d["done"] == 0, d
    kinds = [i["kind"] for i in d["items"]]
    assert kinds == ["mc", "mc", "short"], kinds
    assert all(i["result"] is None for i in d["items"]) and "answer" not in d["items"][0]
    assert c.get("/daily", headers=S1).json()["items"] == d["items"]  # 같은 날은 같은 문제

    mc = d["items"][0]
    q = next(x for x in qs if x["id"] == mc["id"])
    r = c.post("/daily/answer", json={"question_id": mc["id"], "answer": q["answer"]}, headers=S1).json()
    assert r["result"]["correct"] and r["result"]["score"] == 10 and r["result"]["correct_choice"] == q["answer"], r
    assert c.post("/daily/answer", json={"question_id": mc["id"], "answer": 0}, headers=S1).status_code == 409
    mc2 = d["items"][1]
    q2 = next(x for x in qs if x["id"] == mc2["id"])
    r = c.post("/daily/answer", json={"question_id": mc2["id"], "answer": (q2["answer"] + 1) % 4}, headers=S1).json()
    assert r["result"]["correct"] is False and r["result"]["score"] == 0
    sh = d["items"][2]
    assert c.post("/daily/answer", json={"question_id": sh["id"], "answer": "  "}, headers=S1).status_code == 400
    r = c.post("/daily/answer", json={"question_id": sh["id"], "answer": "좋은 답입니다", "lang": "en"}, headers=S1).json()
    assert r["result"]["score"] == 8 and r["result"]["feedback"] == "Good" and r["result"]["graded_by"] == "ai", r
    assert r["tr"]["question"].startswith("EN "), r  # 번역 저장
    other = next(x for x in qs if x["id"] not in [i["id"] for i in d["items"]])
    assert c.post("/daily/answer", json={"question_id": other["id"], "answer": 0}, headers=S1).status_code == 404

    d = c.get("/daily?lang=en", headers=S1).json()
    assert d["done"] == 3 and d["score"] == 18 and d["max_score"] == 30 and d["streak"] == 1, d
    assert all(i["tr"] for i in d["items"])

    # AI 채점이 안 되면 '채점 대기' → 교사가 점수
    d2 = c.get("/daily", headers=S2).json()
    report_conf = report.configured
    daily._ask = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("ai_busy"))
    sh2 = d2["items"][2]
    r = c.post("/daily/answer", json={"question_id": sh2["id"], "answer": "답"}, headers=S2).json()
    assert r["result"]["graded_by"] == "pending" and r["result"]["score"] is None, r
    daily._ask = fake_ask
    textbook.make_toc = lambda *a, **k: (_ for _ in ()).throw(textbook.TocError("ai_not_configured"))
    report.configured = report_conf
    today = daily.today().isoformat()
    assert c.put(f"/daily/student/{s2}/{today}/{sh2['id']}", json={"score": 7}, headers=T2).status_code == 404  # 다른 반 교사
    assert c.put(f"/daily/student/{s2}/{today}/{sh2['id']}", json={"score": 11}, headers=T1).status_code == 400
    assert c.put(f"/daily/student/{s2}/{today}/{sh2['id']}", json={"score": 7}, headers=T1).json() == {"ok": True}
    one = c.get(f"/daily/student/{s2}?day={today}", headers=T1).json()
    assert [i["result"]["score"] for i in one["items"]] == [None, None, 7], one
    assert c.get(f"/daily/student/{s2}", headers=S1).status_code == 404

    # 교사 보드
    b = c.get(f"/boards/courses/{course}/daily", headers=T1).json()
    by = {x["name"]: x for x in b["students"]}
    assert by["s1"]["done"] == 3 and by["s1"]["score"] == 18 and by["s2"]["done"] == 1, b
    assert b["summary"] == {"count": 2, "finished": 1}, b["summary"]
    assert by["s1"]["weak"] and b["weak_units"][0]["wrong"] >= 1, b
    assert c.get(f"/boards/courses/{course}/daily", headers=T2).status_code == 404

    # 내일: 틀린 장 위주, 30일 안에 낸 문제는 다시 안 냄, 연속 일수
    yesterday = daily.today()
    daily.today = lambda now=None: yesterday + timedelta(days=1)
    d3 = c.get("/daily", headers=S1).json()
    first_ids = [i["id"] for i in d["items"]]
    assert not set(first_ids) & {i["id"] for i in d3["items"]}, d3
    assert d3["streak"] == 1  # 어제까지 연속 1일 (오늘은 아직)
    h = c.get("/daily/history", headers=S1).json()
    assert len(h["days"]) == 1 and h["days"][0]["done"] == 3 and h["days"][0]["items"][1]["result"]["correct"] is False, h

    # 신고 → 관리자 '신고됨' 목록, 숨기기·고치기
    qid = d3["items"][0]["id"]
    c.post("/daily/report", json={"question_id": qid, "reason": "정답이 이상해요"}, headers=S1)
    c.post("/daily/report", json={"question_id": qid, "reason": "중복"}, headers=S1)  # 한 사람은 한 번
    rep = c.get(f"/admin/textbooks/{bid}/questions?filter=reported", headers=A).json()["items"]
    assert len(rep) == 1 and rep[0]["report_count"] == 1 and rep[0]["reasons"] == ["정답이 이상해요"], rep
    assert c.put(f"/admin/questions/{qid}", json={"choices": ["a", "b"]}, headers=A).status_code == 400
    assert c.put(f"/admin/questions/{qid}", json={"answer": 2, "question": "고친 문제", "clear_reports": True}, headers=A).json() == {"ok": True}
    fixed = next(x for x in db.TABLES["quiz_questions"] if x["id"] == qid)
    assert fixed["answer"] == 2 and fixed["question"] == "고친 문제" and fixed["report_count"] == 0 and fixed["translations"] == {}
    c.put(f"/admin/questions/{qid}", json={"status": "hidden"}, headers=A)
    assert c.get(f"/admin/textbooks/{bid}/quiz", headers=A).json()["hidden"] == 1
    assert c.get(f"/admin/textbooks/{bid}/questions?filter=hidden", headers=A).json()["items"][0]["id"] == qid

    # 관리자 설정: 개수
    assert c.get("/admin/daily-settings", headers=A).json() == {"mc": 2, "short": 1}
    assert c.put("/admin/daily-settings", json={"mc": 0, "short": 0}, headers=A).status_code == 400
    assert c.put("/admin/daily-settings", json={"mc": 3, "short": 2}, headers=T1).status_code == 403
    assert c.put("/admin/daily-settings", json={"mc": 3, "short": 2}, headers=A).json() == {"mc": 3, "short": 2}
    daily.today = lambda now=None: yesterday + timedelta(days=2)
    d4 = c.get("/daily", headers=S2).json()
    assert [i["kind"] for i in d4["items"]] == ["mc", "mc", "mc", "short", "short"], d4
    assert qid not in [i["id"] for i in d4["items"]]  # 숨긴 문제는 안 나옴

    # 문제 지우기
    assert c.delete(f"/admin/questions/{qid}", headers=A).json() == {"ok": True}
    assert not any(x["id"] == qid for x in db.TABLES["quiz_questions"])
    print("daily_check OK")


if __name__ == "__main__":
    main()
