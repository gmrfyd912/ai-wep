"""T3 시험: 웰디 대화 (쪽·장 열기, 문제 내기·채점, AI 설명·근거 쪽, 하루 한도, 신고). Claude 는 가짜.
실행: python -m tests.tutor_check"""
import json

from fastapi.testclient import TestClient

import accounts
import app as server
import daily
import report
import scoring
import textbook
import tutor
from tests import fake_db as db
from tests.daily_check import fake_ask as daily_ask
from tests.textbook_check import H, book_pdf

CALLS = []


def fake_call(system, prompt, max_tokens, timeout=45):
    """웰디 대답 (진짜 AI 처럼 JSON 글자로)."""
    out = fake_ask("m", system, prompt, max_tokens)
    if isinstance(out, str):
        return out
    return json.dumps(out, ensure_ascii=False)


def fake_ask(model, system, text, max_tokens, timeout=180):
    if system is tutor.KEYWORDS_SYSTEM:
        CALLS.append("keywords")
        return {"words": "가스 차폐"}
    if system.startswith("You are Weldy"):
        CALLS.append(text)
        if "날씨" in text:
            return {"reply": "용접 공부 이야기를 해요.", "pages": [], "offtopic": True}
        if "따옴표" in text:  # JSON 이 깨진 대답도 살린다
            return '{"reply":"그건 "보호 가스"예요.","pages":[6],"quiz":false}'
        if "로봇" in text:
            return {"reply": "교재에는 없지만 짧게 말하면...", "pages": [], "outside": True}
        return {"reply": "**보호 가스**는 공기를 막아 줘요.", "pages": [6, 999], "open_page": None,
                "quiz": "문제도" in text}
    return daily_ask(model, system, text, max_tokens, timeout)


def check_helpers():
    toc = [{"title": "제1편 기초", "page": 4, "chapters": [{"title": "제1장 아크", "page": 4, "sections": []},
                                                        {"title": "제2장 가스", "page": 6, "sections": []}]}]
    p = tutor.parse("2장 보여줘", toc, 0, 8)
    assert p["open"] and p["page"] == 6 and p["range"] == (6, 8) and p["title"] == "제2장 가스", p
    p = tutor.parse("5쪽", toc, 0, 8)
    assert p["open"] and p["page"] == 5, p
    p = tutor.parse("p.7 open", toc, 2, 20)
    assert p["open"] and p["page"] == 9, p
    p = tutor.parse("2장에서 차폐 가스가 왜 필요해?", toc, 0, 8)
    assert not p["open"] and p["range"] == (6, 8), p  # 질문 (그 장을 먼저 찾아본다)
    p = tutor.parse("1장 문제 내줘", toc, 0, 8)
    assert p["quiz"] and not p["open"] and p["range"] == (4, 5), p
    assert tutor.parse("quiz me", toc, 0, 8)["quiz"]
    assert not tutor.parse("이 문제가 뭐야", toc, 0, 8)["quiz"]
    assert not tutor.parse("이 문제 좀 알려줘", toc, 0, 8)["quiz"]
    assert tutor.parse("문제 하나 내 줘", toc, 0, 8)["quiz"] and tutor.parse("퀴즈!", toc, 0, 8)["quiz"]
    p = tutor.parse("1편 보여줘", toc, 0, 8)
    assert p["open"] and p["page"] == 4 and p["range"] == (4, 8), p
    assert tutor.parse("99쪽 보여줘", toc, 0, 8)["page"] is None  # 책 밖 쪽
    assert tutor.find_chapter([{"title": "A", "chapters": [{"title": "Intro"}, {"title": "Gas"}]}], 2)[2]["title"] == "Gas"
    assert tutor.terms("가스용접을") == ["가스", "스용", "용접", "접을"]


def check_call_ai():
    """AI 오류 → 이유 코드 (바쁨·끊김은 한 번 더 해 봄)."""
    import anthropic
    import httpx
    req = httpx.Request("POST", "https://x")
    calls = []

    class Msgs:
        def __init__(self, errs):
            self.errs = errs

        def create(self, **kw):
            calls.append(1)
            if self.errs:
                raise self.errs.pop(0)
            return type("R", (), {"stop_reason": "end_turn",
                                  "content": [type("B", (), {"type": "text", "text": '{"reply":"ok"}'})()]})()

    def client_with(errs):
        c = type("C", (), {})()
        c.beta = type("B", (), {})()
        c.beta.messages = Msgs(errs)
        return lambda timeout: (anthropic, c)

    old = daily._client, tutor.time.sleep, report.configured
    tutor.time.sleep = lambda s: None
    report.configured = lambda: True
    busy = anthropic.APIStatusError("overloaded", response=httpx.Response(529, request=req), body=None)
    daily._client = client_with([busy])
    assert tutor.call_ai("s", "p", 10) == '{"reply":"ok"}' and len(calls) == 2  # 한 번 더 해서 됨
    daily._client = client_with([anthropic.APITimeoutError(request=req), anthropic.APITimeoutError(request=req)])
    try:
        tutor.call_ai("s", "p", 10)
        raise AssertionError("no error")
    except tutor.TutorError as e:
        assert e.code == "timeout", e
    auth = anthropic.AuthenticationError("bad key", response=httpx.Response(401, request=req), body=None)
    daily._client = client_with([auth])
    try:
        tutor.call_ai("s", "p", 10)
        raise AssertionError("no error")
    except tutor.TutorError as e:
        assert e.code == "key", e
    bad = anthropic.BadRequestError("bad", response=httpx.Response(400, request=req), body=None)
    daily._client = client_with([bad])
    try:
        tutor.call_ai("s", "p", 10)
        raise AssertionError("no error")
    except tutor.TutorError as e:
        assert e.code == "other" and e.detail.startswith("400"), e
    report.configured = lambda: False
    try:
        tutor.call_ai("s", "p", 10)
        raise AssertionError("no error")
    except tutor.TutorError as e:
        assert e.code == "config"
    daily._client, tutor.time.sleep, report.configured = old


def main():
    check_helpers()
    check_call_ai()
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    report.configured = lambda: True
    daily._ask = fake_ask
    tutor.call_ai = fake_call
    textbook.make_toc = lambda *a, **k: (_ for _ in ()).throw(textbook.TocError("ai_not_configured"))
    daily.UNIT_TEXT_MIN = 1
    textbook._start_job = textbook.process_book
    daily._start_quiz_job = daily.run_quiz_job
    c = TestClient(server.app)

    def user(lid, role):
        u = db.insert_rows("users", {"login_id": lid, "login_key": lid, "name": lid, "role": role, "status": "active",
                                     "password_hash": accounts.hash_password("p")})[0]
        tok = c.post("/auth/login", json={"login_id": lid, "password": "p"}).json()["token"]
        return u["id"], H(tok)

    s1, S1 = user("s1", "student")
    t1, T1 = user("t1", "teacher")
    ad, A = user("ad", "admin")

    ask = lambda text, h=S1, **kw: c.post("/tutor/ask", json={"text": text, **kw}, headers=h)
    assert ask("안녕").json()["key"] == "tutor_noBook"

    bid = c.post("/admin/textbooks/upload", files={"file": ("b.pdf", book_pdf(), "application/pdf")}, headers=A).json()["id"]
    toc = [{"title": "Part 1", "page": 4, "chapters": [{"title": "Chapter 1 Basics", "page": 4, "sections": []},
                                                       {"title": "Chapter 2 Gas", "page": 6, "sections": []}]}]
    assert c.put(f"/admin/textbooks/{bid}", json={"toc": toc, "is_current": True}, headers=A).status_code == 200

    # 쪽·장 열기 (AI 안 씀)
    r = ask("Chapter 2 보여줘").json()
    assert r["key"] == "tutor_open" and r["open"] == {"page": 6, "printed": 6} and r["book_id"] == bid, r
    assert ask("5쪽").json()["open"]["page"] == 5
    # 문제 은행이 비었으면
    assert ask("문제 내줘").json()["key"] == "tutor_noQuiz"
    assert c.post(f"/admin/textbooks/{bid}/quiz", json={}, headers=A).status_code == 200
    r = ask("Chapter 2 문제 내줘").json()
    q = r["quiz"]
    assert r["key"] == "tutor_quiz" and q["kind"] in ("ox", "mc") and q["result"] is None, r
    assert 6 <= q["page"] <= 8, q  # 말한 장에서
    full = next(x for x in db.TABLES["quiz_questions"] if x["id"] == q["id"])
    wrong = (full["answer"] + 1) % (4 if full["kind"] == "mc" else 2)
    r = c.post("/tutor/quiz", json={"question_id": q["id"], "answer": wrong}, headers=S1).json()
    assert r["result"]["correct"] is False and r["result"]["correct_choice"] == full["answer"], r
    assert c.post("/tutor/quiz", json={"question_id": q["id"], "answer": 7}, headers=S1).status_code == 400
    assert db.TABLES["tutor_answers"][0]["correct"] is False
    assert daily._wrong_units(s1, bid) == {full["unit_key"]: 1}  # 대화 중 틀린 장도 약점으로
    # 매일 문제 점수에는 안 들어감
    assert not db.TABLES.get("daily_answers")

    # AI 설명: 근거 쪽, 꾸밈 글자 없앰, 앞 대화 같이
    CALLS.clear()
    r = ask("Chapter text body 가 뭐야?", history=[{"q": "앞 질문", "a": "앞 대답"}], page=6).json()
    assert r["reply"] == "보호 가스는 공기를 막아 줘요." and r["pages"] == [{"page": 6, "printed": 6}], r
    assert r["left"] == 49 and r["id"], r
    assert "[p.6]" in CALLS[-1] and "앞 대답" in CALLS[-1] and "keywords" not in CALLS, CALLS
    # 외국어 질문은 한국어 찾기 낱말로 바꿔서 찾음
    CALLS.clear()
    ask("What is shielding gas?", lang="en")
    assert CALLS[0] == "keywords", CALLS
    r = ask("로봇 용접 알려줘").json()
    assert r["outside"] and r["pages"] == [], r
    r = ask("오늘 날씨 어때").json()
    assert not r["outside"] and r["reply"], r
    kinds = [m["kind"] for m in db.TABLES["tutor_messages"]]
    assert "offtopic" in kinds and "outside" in kinds and "open" in kinds and "quiz" in kinds, kinds
    # AI 가 문제를 내자고 하면 문제도 같이
    r = ask("설명하고 문제도 줄래").json()
    assert r["reply"] and r["quiz"], r

    # 하루 한도 (교육생만)
    db.SETTINGS["criteria"] = {**scoring.criteria(), "tutor_daily_limit": 5}
    scoring.clear_cache()
    r = ask("Chapter text body?").json()
    assert r["key"] == "tutor_limit" and r["params"] == {"n": 5} and r["left"] == 0, r
    assert ask("Chapter 1 보여줘").json()["open"]  # 열기·문제는 한도와 상관없음
    assert ask("Chapter text body?", T1).json()["reply"]  # 교사는 한도 없음
    # 관리자 운영 설정에서 바꿈 (예전 앱이 안 보내면 그대로)
    st = c.get("/admin/settings", headers=A).json()
    assert st["tutor_daily_limit"] == 5
    body = {k: st[k] for k in ("pass_score", "width", "straight", "defects", "crack_fail", "fail_score_cap",
                               "report_daily_limit", "password_min_length", "reset_password")}
    assert c.put("/admin/settings", json=body, headers=A).json()["tutor_daily_limit"] == 5
    assert c.put("/admin/settings", json={**body, "tutor_daily_limit": 501}, headers=A).status_code == 400
    assert c.put("/admin/settings", json={**body, "tutor_daily_limit": 80}, headers=A).json()["tutor_daily_limit"] == 80

    # AI 를 교재 근거로 안 쓰는 교재
    assert c.put(f"/admin/textbooks/{bid}", json={"use_for_ai": False}, headers=A).status_code == 200
    assert ask("Chapter text body?").json()["key"] == "tutor_aiOff"
    assert ask("Chapter 1 보여줘").json()["open"]
    assert c.put(f"/admin/textbooks/{bid}", json={"use_for_ai": True}, headers=A).status_code == 200
    # AI 실패: 이유를 알려 준다
    tutor.call_ai = lambda *a, **k: (_ for _ in ()).throw(tutor.TutorError("busy"))
    assert ask("Chapter text body?").json()["key"] == "tutor_fail_busy"
    tutor.call_ai = lambda *a, **k: (_ for _ in ()).throw(ValueError("boom"))
    r = ask("Chapter text body?").json()
    assert r["key"] == "tutor_fail_other" and "boom" in r["params"]["code"], r
    assert db.TABLES["tutor_messages"][-1]["answer"].startswith("error: other"), db.TABLES["tutor_messages"][-1]
    tutor.call_ai = fake_call
    r = ask("따옴표 대답 해줘").json()
    assert r["reply"] == '그건 "보호 가스"예요.' and r["pages"] == [{"page": 6, "printed": 6}], r

    # 신고 → 관리자 목록 → 지우기
    mid = next(m["id"] for m in db.TABLES["tutor_messages"] if m["kind"] == "explain")
    assert c.post("/tutor/report", json={"message_id": mid, "note": "틀림"}, headers=T1).status_code == 404  # 남의 대화
    assert c.post("/tutor/report", json={"message_id": mid, "note": "틀림"}, headers=S1).json()["ok"]
    assert c.get("/admin/tutor/reports", headers=S1).status_code == 403
    items = c.get("/admin/tutor/reports", headers=A).json()["items"]
    assert len(items) == 1 and items[0]["name"] == "s1" and items[0]["report_note"] == "틀림" and items[0]["printed"] == [6], items
    assert c.delete(f"/admin/tutor/reports/{mid}", headers=A).json()["ok"]
    assert c.get("/admin/tutor/reports", headers=A).json()["items"] == []

    # 교육생에게 숨긴 교재
    assert c.put(f"/admin/textbooks/{bid}", json={"show_students": False}, headers=A).status_code == 200
    assert ask("Chapter 1 보여줘").json()["key"] == "tutor_hidden"
    assert ask("Chapter 1 보여줘", T1).json()["open"]
    assert ask("   ").status_code == 400
    print("tutor_check OK", json.dumps({"messages": len(db.TABLES["tutor_messages"])}))


if __name__ == "__main__":
    main()
