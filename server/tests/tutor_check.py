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


def fake_stream(system, prompt, max_tokens, timeout=45):
    """웰디 대답을 조각조각 ('말 @@@ {정보}' 모양)."""
    out = fake_ask("m", system, prompt, max_tokens)
    if isinstance(out, str):
        full = out
    else:
        meta = {k: v for k, v in out.items() if k != "reply"}
        full = f"{out['reply']}\n@@@\n{json.dumps(meta, ensure_ascii=False)}"
    for i in range(0, len(full), 4):
        yield full[i:i + 4]


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
        if "가짜 쪽" in text:  # 대답과 상관없는 쪽·없는 쪽을 근거라고 함
            return {"reply": "보호 가스는 공기를 막아 줘요.", "pages": [8, 3, 999]}
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
    # 쪽을 말한 문제 만들기, 종류, 새 문제
    p = tutor.parse("5쪽에서 객관식 문제 하나 만들어 줘", toc, 0, 8)
    assert p["quiz"] and p["focus"] == 5 and p["kind"] == "mc" and not p["new"] and not p["open"], p
    p = tutor.parse("그 페이지에서 새 문제 만들어줘", toc, 0, 8)
    assert p["quiz"] and p["that"] and p["new"] and p["kind"] is None, p
    assert tutor.parse("OX 문제 내줘", toc, 0, 8)["kind"] == "ox"
    assert tutor.parse("단답형 하나 만들어 줘", toc, 0, 8)["kind"] == "word"
    assert tutor.parse("make a new multiple choice question", toc, 0, 8)["kind"] == "mc"
    assert not tutor.parse("문제 내용이 뭐야", toc, 0, 8)["quiz"]
    # "그 페이지 펼쳐줘" (쪽 번호 없이)
    for t in ("그 페이지 펼쳐줘", "그 쪽 보자", "거기 보여줘", "펼쳐 줘", "open that page", "두 번째 쪽 열어줘", "다음 쪽 보여줘"):
        p = tutor.parse(t, toc, 0, 8)
        assert p["open"] and p["page"] is None, (t, p)
    assert tutor.parse("두 번째 쪽 열어줘", toc, 0, 8)["ord"] == 1 and tutor.parse("다음 쪽 보여줘", toc, 0, 8)["next"]
    for t in ("그 내용이 들어가 있는 페이지 열어봐", "내용이 들어있는 페이지 열어봐", "페이지 열어봐", "이 내용 있는 페이지 보여줘"):
        p = tutor.parse(t, toc, 0, 8)
        assert p["open"] and p["page"] is None and not p["topic"], (t, p)
    p = tutor.parse("TIG 용접 나오는 페이지 열어줘", toc, 0, 8)
    assert p["open"] and p["topic"] == "TIG 용접", p
    assert not tutor.parse("예를 보여줘 용접 순서", toc, 0, 8)["open"]
    assert not tutor.parse("그건 왜 그래?", toc, 0, 8)["open"]
    # 같은 질문 알아보기
    assert tutor.norm_q("보호 가스가 뭐예요?") == tutor.norm_q("보호가스가 뭐야") == "보호가스가뭐"
    assert tutor.similar(tutor.norm_q("TIG 용접 원리가 뭐예요"), tutor.norm_q("tig 용접 원리가 뭐야?")) == 1
    assert tutor.similar(tutor.norm_q("TIG 용접 원리"), tutor.norm_q("MIG 용접 원리")) < 0.9
    # 꼬리 질문
    h = [tutor.Turn(q="보호 가스가 뭐야", a="공기를 막아요")]
    assert tutor.is_follow("그건 왜 그래?", h) and tutor.is_follow("이해가 안 돼", h) and tutor.is_follow("더 쉽게", h)
    assert not tutor.is_follow("그건 왜 그래?", []) and not tutor.is_follow("피복 아크 용접봉의 종류를 알려줘", h)
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


def check_stream_ai():
    """흘려 보내기: 조각을 그대로, 첫 글자 전 바쁨은 한 번 더, '@@@' 뒤 정보는 말에서 뺀다."""
    import anthropic
    import httpx
    req = httpx.Request("POST", "https://x")

    class S:
        def __init__(self, pieces):
            self.pieces = pieces

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        @property
        def text_stream(self):
            yield from self.pieces

        def get_final_message(self):
            return type("M", (), {"stop_reason": "end_turn"})()

    class Msgs:
        def __init__(self, plan):
            self.plan = plan

        def stream(self, **kw):
            p = self.plan.pop(0)
            if isinstance(p, Exception):
                raise p
            return S(p)

    def client_with(plan):
        c = type("C", (), {})()
        c.beta = type("B", (), {})()
        c.beta.messages = Msgs(plan)
        return lambda timeout: (anthropic, c)

    old = daily._client, tutor.time.sleep, report.configured, tutor.stream_ai
    tutor.time.sleep = lambda s: None
    report.configured = lambda: True
    busy = anthropic.APIStatusError("overloaded", response=httpx.Response(529, request=req), body=None)
    daily._client = client_with([busy, ["보호 ", "가스는 ", "공기를 막아요. ", "더 궁금해요?\n@", "@@\n{\"pages\":[6],\"outside\":false}"]])
    assert "".join(tutor.stream_ai("s", "p", 10)) .startswith("보호 가스는")
    # ask_ai: 말 조각만 앱으로, 정보는 마지막에
    daily._client = client_with([["**보호** 가스는 ", "공기를 막아요.", "\n@@", "@\n{\"pages\":[2],\"quiz\":false}"]])
    book = {"id": "b-stream", "updated_at": "x", "page_offset": 0, "pages": 3}
    tutor._cache["b-stream"] = ("x", {1: "가스", 2: "보호 가스 공기", 3: "끝"}, {"tf": {1: {"가스": 1}, 2: {"보호": 1, "가스": 1}, 3: {}},
                                                                     "df": {"가스": 2, "보호": 1}, "n": 3})
    evs = list(tutor.ask_ai(book, "보호 가스가 뭐야", "ko", [], None))
    deltas = "".join(v for k, v in evs if k == "delta")
    assert deltas.strip() == "보호 가스는 공기를 막아요." and "@" not in deltas, deltas
    assert evs[-1][0] == "done" and evs[-1][1]["reply"] == "보호 가스는 공기를 막아요." and evs[-1][1]["pages"] == [2], evs[-1]
    # 형식을 안 지키고 JSON 으로 오면 조각을 안 보내고 다 받은 뒤 읽는다
    daily._client = client_with([['{"reply":"제이슨', ' 대답","pages":[1]}']])
    evs = list(tutor.ask_ai(book, "보호 가스", "ko", [], None))
    assert [k for k, _ in evs] == ["done"] and evs[0][1]["reply"] == "제이슨 대답", evs
    auth = anthropic.AuthenticationError("bad key", response=httpx.Response(401, request=req), body=None)
    daily._client = client_with([auth])
    try:
        list(tutor.stream_ai("s", "p", 10))
        raise AssertionError("no error")
    except tutor.TutorError as e:
        assert e.code == "key"
    daily._client, tutor.time.sleep, report.configured = old[:3]
    tutor._cache.pop("b-stream", None)


def main():
    check_helpers()
    check_call_ai()
    check_stream_ai()
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    report.configured = lambda: True
    daily._ask = fake_ask
    tutor.call_ai = fake_call
    tutor.stream_ai = fake_stream
    tutor.QUIZ_TEXT_MIN = 1
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
    # 쪽 글에 한국어 내용을 넣는다 (근거 쪽 확인은 대답 낱말이 그 쪽에 실제로 있어야 통과)
    KO = {5: "아크 길이와 전류. 아크 전압이 높아진다.", 6: "보호 가스는 공기를 막아 줘요. 아르곤 가스 차폐 원리.",
          7: "예열 온도는 균열을 막는다. 두꺼운 판 예열.", 8: "텅스텐 전극 TIG 전극 끝 모양."}
    for r0 in db.TABLES["textbook_pages"]:
        if r0["page"] in KO:
            r0["text"] = f"{r0['text']}\n{KO[r0['page']]}"
    tutor._cache.clear()

    # 쪽·장 열기 (AI 안 씀)
    r = ask("Chapter 2 보여줘").json()
    assert r["key"] == "tutor_open" and r["open"] == {"page": 6, "printed": 6} and r["book_id"] == bid, r
    assert ask("5쪽").json()["open"]["page"] == 5
    # 문제 은행이 비었으면
    assert ask("문제 내줘").json()["key"] == "tutor_noQuiz"
    assert c.post(f"/admin/textbooks/{bid}/quiz", json={}, headers=A).status_code == 200
    r = ask("Chapter 2 객관식 문제 내줘").json()
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
    assert r["left"] == 49 and r["id"] and not r["cached"], r
    assert "[p.6]" in CALLS[-1] and "앞 대답" in CALLS[-1] and "keywords" not in CALLS, CALLS
    # 같은 질문은 저장된 답을 바로 (AI 안 부름, 한도에 안 셈) — 다른 교육생도
    s2, S2 = user("s2", "student")
    CALLS.clear()
    r = ask("chapter text body가 뭐예요", S2).json()
    assert r["cached"] and r["reply"] == "보호 가스는 공기를 막아 줘요." and r["pages"][0]["page"] == 6 and not CALLS, r
    hit = db.TABLES["tutor_messages"][-1]
    assert hit["ai"] is False and hit["cache_of"] and hit["kind"] == "explain", hit
    # 꼬리 질문은 저장된 답을 안 쓰고, 앞 질문과 합쳐 찾고, 앞 대답의 쪽도 다시
    CALLS.clear()
    r = ask("이해가 안 돼, 더 쉽게", history=[{"q": "Chapter text body 가 뭐야?", "a": "보호 가스는"}], last_pages=[7]).json()
    assert not r["cached"] and r["reply"], r
    assert "[p.7]" in CALLS[-1] and "Explain it again more simply" in CALLS[-1], CALLS
    # 근거 쪽은 실제로 준 쪽이고 대답 낱말이 들어 있는 쪽만 (지어낸 쪽·상관없는 쪽은 버림)
    r = ask("가짜 쪽 대답 해줘", T1).json()
    assert r["reply"] and r["pages"] == [], r
    # 따지는 말: 대화 주제로 교재 전체를 다시 찾고, 찾은 쪽을 사실로 주고, 방금 본 쪽 글도 같이
    CALLS.clear()
    r = ask("이 페이지에는 내가 물어본 게 없잖아", T1, history=[{"q": "예열 온도는 왜 필요해?", "a": "균열을 막아요"}],
            last_pages=[], seen_page=5).json()
    assert not r["cached"] and r["reply"], r
    pr = CALLS[-1]
    assert "TEXTBOOK SEARCH" in pr and "p.7" in pr.split("TEXTBOOK SEARCH")[1].split("\n")[0], pr
    assert "[p.7]" in pr and "[p.5] (the page the trainee just looked at)" in pr and "Do not just agree" in pr, pr
    # 외국어 질문은 한국어 찾기 낱말로 바꿔서 찾음 (같은 질문은 한 번만 바꿈)
    CALLS.clear()
    ask("What is shielding gas?", lang="en")
    assert CALLS[0] == "keywords", CALLS
    CALLS.clear()
    tutor.cache_clear()
    ask("What is shielding gas", S2, lang="en")
    assert "keywords" not in CALLS
    r = ask("로봇 용접 알려줘").json()
    assert r["outside"] and r["pages"] == [], r
    r = ask("오늘 날씨 어때").json()
    assert not r["outside"] and r["reply"], r
    kinds = [m["kind"] for m in db.TABLES["tutor_messages"]]
    assert "offtopic" in kinds and "outside" in kinds and "open" in kinds and "quiz" in kinds, kinds
    # AI 가 문제를 내자고 하면 문제도 같이
    r = ask("설명하고 문제도 줄래").json()
    assert r["reply"] and r["quiz"], r

    # "그 페이지 펼쳐줘": 바로 전 대답의 첫 쪽
    r = ask("그 페이지 펼쳐줘", last_pages=[7, 8]).json()
    assert r["key"] == "tutor_openThatMore" and r["open"]["page"] == 7 and r["pages"] == [{"page": 8, "printed": 8}], r
    assert ask("두 번째 쪽 보여줘", last_pages=[7, 8]).json()["open"]["page"] == 8
    assert ask("다음 쪽 보여줘", last_pages=[7]).json()["open"]["page"] == 8
    # 앱이 안 보내면 30분 안의 내 마지막 대화에서
    r = ask("거기 보여줘").json()
    assert r["open"] and r["key"].startswith("tutor_openThat"), r
    r = ask("그 내용이 들어가 있는 페이지 열어봐", last_pages=[7]).json()
    assert r["open"]["page"] == 7 and not r["reply"], r
    r = ask("예열 온도 나오는 페이지 보여줘", A).json()  # 쪽 번호 대신 내용으로 찾아 연다 (그 내용이 실제로 있는 쪽)
    assert r["open"]["page"] == 7, r
    r = ask("본문 text body 나오는 페이지 보여줘", A).json()
    assert r["key"] == "tutor_whichPage", r  # 어디에나 있는 말이면 못 찾음
    # 바로 전 대답에 확인된 쪽이 없으면 더 앞 대화로 거슬러 가지 않는다 → 대화 주제로 찾거나 되묻는다
    assert ask("그 페이지 펼쳐줘", last_pages=[]).json()["key"] == "tutor_whichPage"
    r = ask("그 내용 있는 페이지 열어봐", last_pages=[], history=[{"q": "예열 온도는 왜 필요해?", "a": "균열을 막아요"}]).json()
    assert r["open"]["page"] == 7, r
    r = ask("그 페이지 펼쳐줘", T1).json()  # 교사는 아직 대화가 없음
    assert r["key"] == "tutor_whichPage" and r["open"] is None, r

    # 쪽을 말한 문제: 은행에 있으면 바로, 없으면 그 쪽 글로 만들어 은행에 넣음
    r = ask("6쪽에서 객관식 문제 내줘").json()
    assert r["key"] == "tutor_quiz" and r["quiz"]["kind"] == "mc" and 5 <= r["quiz"]["page"] <= 7 and not r["made"], r
    n_bank = len(db.TABLES["quiz_questions"])
    made = []
    serial = [0]

    def make_ask(model, system, text, max_tokens, timeout=180):
        if system is daily.QUIZ_SYSTEM:
            made.append(text)
            serial[0] += 1
            return {"questions": [{"kind": "mc", "question": ["가스 유량은 어떻게 맞추나요", "텅스텐 전극 끝 모양은", "예열 온도를 정하는 기준"][serial[0] - 1], "choices": ["가", "나", "다", "라"],
                                   "answer": 1, "explanation": "해설", "page": 8}]}
        return fake_ask(model, system, text, max_tokens, timeout)

    daily._ask = make_ask
    tutor.call_ai = lambda system, prompt, max_tokens, timeout=45: json.dumps(make_ask("m", system, prompt, max_tokens))
    r = ask("8쪽에서 객관식 문제 하나 만들어 줘", S2).json()
    assert r["key"] == "tutor_quizNew" and r["made"] and r["quiz"]["page"] == 8 and r["left"] is not None, r
    assert "page 8" in made[0] and "1 multiple choice" in made[0], made
    new = db.TABLES["quiz_questions"][-1]
    assert len(db.TABLES["quiz_questions"]) == n_bank + 1 and new["source"] == "tutor" and new["created_by"] == s2, new
    assert new["status"] == "active" and new["unit_key"], new
    # 다른 교육생이 같은 쪽 문제를 달라고 하면 은행에서 바로 (AI 안 부름)
    made.clear()
    r = ask("8쪽 객관식 문제 내줘").json()
    assert r["key"] == "tutor_quiz" and r["quiz"]["id"] == new["id"] and not made, r
    # "새 문제" → 또 만든다
    r = ask("8쪽에서 새 문제 만들어줘").json()
    assert r["key"] == "tutor_quizNew" and len(made) == 1 and "가스 유량은 어떻게" in made[0], (r, made)  # 있는 문제는 피하라고
    # 쪽을 말 안 하고 새 문제 → 어디서 만들지 물음
    assert ask("새 문제 만들어 줘").json()["key"] == "tutor_noQuizWhere"
    # 관리자 문제 은행: 웰디로 만든 문제만 보기
    tq = c.get(f"/admin/textbooks/{bid}/questions?filter=tutor", headers=A).json()["items"]
    assert len(tq) == 2 and all(q["source"] == "tutor" for q in tq), tq
    assert c.get(f"/admin/textbooks/{bid}/questions", headers=A).json()["items"][0]["source"] == "admin"
    # 웰디로 만든 문제는 신고되면 바로 숨김
    assert c.post("/daily/report", json={"question_id": new["id"], "reason": "이상함"}, headers=S1).json()["ok"]
    assert next(q for q in db.TABLES["quiz_questions"] if q["id"] == new["id"])["status"] == "hidden"
    daily._ask = fake_ask
    tutor.call_ai = fake_call
    # 단답형 문제는 글로 답한다
    word = next(q for q in db.TABLES["quiz_questions"] if q["kind"] == "word")
    r = c.post("/tutor/quiz", json={"question_id": word["id"], "answer": "GTAW"}, headers=S1).json()
    assert r["result"]["correct"] is True, r
    assert db.TABLES["tutor_answers"][-1]["answer"] == "GTAW"

    # 흘려 보내기: 조각들 → 마지막 done
    res = c.post("/tutor/ask/stream", json={"text": "Chapter 2 차폐 원리 설명"}, headers=T1)
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
    evs = [json.loads(line[6:]) for line in res.text.split("\n") if line.startswith("data: ")]
    assert evs[-1]["t"] == "done" and evs[-1]["reply"] == "보호 가스는 공기를 막아 줘요.", evs[-1]
    assert len([e for e in evs if e["t"] == "delta"]) > 2 and "".join(e["text"] for e in evs if e["t"] == "delta").startswith("보호"), evs
    evs = [json.loads(line[6:]) for line in c.post("/tutor/ask/stream", json={"text": "Chapter 1 보여줘"}, headers=T1).text.split("\n")
           if line.startswith("data: ")]
    assert len(evs) == 1 and evs[0]["key"] == "tutor_open", evs

    # 자주 묻는 질문 (관리자): 같은 질문을 묶어 많은 순
    faq = c.get("/admin/tutor/faq", headers=A).json()["items"]
    top = {f["question"].lower(): f["count"] for f in faq}
    assert top.get("chapter text body 가 뭐야?") == 2 and top.get("what is shielding gas?") == 2, faq
    assert c.get("/admin/tutor/faq", headers=S1).status_code == 403

    # 웰디 점검 (관리자): 예시 만들기 → 직접 넣기 → 실행 → 판정
    assert c.get("/admin/tutor/checks", headers=S1).status_code == 403
    assert c.post("/admin/tutor/checks/seed", headers=A).json()["added"] == 2  # 장 2개
    assert c.post("/admin/tutor/checks/seed", headers=A).json()["added"] == 0  # 같은 질문은 다시 안 넣음
    good = c.post("/admin/tutor/checks", json={"question": "보호 가스가 하는 일은?", "page_from": 6}, headers=A).json()
    bad = c.post("/admin/tutor/checks", json={"question": "보호 가스 원리", "page_from": 2, "page_to": 3}, headers=A).json()
    assert c.post("/admin/tutor/checks", json={"question": " ", "page_from": 1}, headers=A).status_code == 400
    r = c.post(f"/admin/tutor/checks/{good['id']}/run", headers=A).json()
    assert r["last_verdict"] == "ok" and r["last_pages"] == [6] and 6 in r["last_found"], r
    assert c.post(f"/admin/tutor/checks/{bad['id']}/run", headers=A).json()["last_verdict"] == "wrong_page"
    assert tutor.judge([], "그 내용은 교재에는 없어요.", 6, 6) == "said_missing" and tutor.judge([], "음", 6, 6) == "no_page"
    items = c.get("/admin/tutor/checks", headers=A).json()["items"]
    assert len(items) == 4 and items[0]["note"].startswith("예시"), items
    assert c.delete(f"/admin/tutor/checks/{bad['id']}", headers=A).json()["ok"]
    assert len(c.get("/admin/tutor/checks", headers=A).json()["items"]) == 3

    # 하루 한도 (교육생만)
    db.SETTINGS["criteria"] = {**scoring.criteria(), "tutor_daily_limit": 5}
    scoring.clear_cache()
    r = ask("용접봉 건조 온도는?").json()
    assert r["key"] == "tutor_limit" and r["params"] == {"n": 5} and r["left"] == 0, r
    assert ask("Chapter 1 보여줘").json()["open"]  # 열기·문제는 한도와 상관없음
    assert ask("chapter text body 가 뭐야").json()["cached"]  # 저장된 답도 한도와 상관없음
    assert ask("용접봉 건조 온도는?", T1).json()["reply"]  # 교사는 한도 없음
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
    tutor.stream_ai = lambda *a, **k: (_ for _ in ()).throw(tutor.TutorError("busy"))
    assert ask("아크 길이 설명 1").json()["key"] == "tutor_fail_busy"
    tutor.stream_ai = lambda *a, **k: (_ for _ in ()).throw(ValueError("boom"))
    r = ask("아크 길이 설명 2").json()
    assert r["key"] == "tutor_fail_other" and "boom" in r["params"]["code"], r
    assert db.TABLES["tutor_messages"][-1]["answer"].startswith("error: other"), db.TABLES["tutor_messages"][-1]
    tutor.stream_ai = fake_stream
    r = ask("보호 가스 따옴표 대답 해줘").json()
    assert r["reply"] == '그건 "보호 가스"예요.' and r["pages"] == [{"page": 6, "printed": 6}], r

    # 신고 → 관리자 목록 → 지우기
    mid = next(m["id"] for m in db.TABLES["tutor_messages"] if m["kind"] == "explain")
    assert c.post("/tutor/report", json={"message_id": mid, "note": "틀림"}, headers=T1).status_code == 404  # 남의 대화
    assert c.post("/tutor/report", json={"message_id": mid, "note": "틀림"}, headers=S1).json()["ok"]
    assert not ask("chapter text body가 뭐예요", T1).json()["cached"]  # 신고된 답은 다시 안 줌
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
