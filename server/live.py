"""T5(이론): 수업 중 돌발 OX.

교사가 반을 골라 OX 문제를 보내면, 그 반 교육생 휴대폰(앱이 켜져 있을 때)에 문제가 화면 가득 뜬다.
- Expo Go 는 푸시 알림이 안 되므로 앱이 3초마다 GET /live/now 로 묻는다.
  지금 내는 문제는 서버 메모리에만 두어서(uvicorn 1개) 묻기만 할 때는 데이터베이스를 건드리지 않는다.
  로그인 확인도 60초 동안 기억해 둔다.
- 흐름: 보내기 → 준비(교육생 언어로 번역, 최대 PREP_MAX 초) → 문제 열림(제한 시간) → 끝(정답·해설·반 정답률).
- 끝나면 답을 live_ox_answers 에 저장 → 학습 보드에 다른 문제처럼 들어간다(맞으면 10점).
- "웰디가 설명하기": 끝난 뒤 교사가 누르면 AI 가 그 문제를 쉬운 말로 풀어 교육생 화면에 띄운다.

나중에(설치용 앱) 쓸 수 있게 문제 만들기와 보내기를 나눠 둔다:
  make_ox(글, 제목)        : 교재 범위 글이든 수업을 받아 적은 글이든 → OX 문제 dict 목록
  start_quiz(반, 교사, 문제, 초) : 문제 하나를 반에 보낸다
  예) "헤이 웰디, 돌발 OX 내 줘" → make_ox(오늘 수업 글) → save_question → start_quiz
"""
import json
import random
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

import accounts
import daily
import manage
import report
import store
import textbook

router = APIRouter()
SECONDS = (10, 20, 30, 60)
DEFAULT_SECONDS = 20
PREP_MAX = 8            # 번역 기다리는 최대 초 (넘으면 한국어로 연다)
GRACE = 1.5             # 시간 끝난 뒤 늦게 도착한 답 봐주는 초
KEEP_ENDED = 15 * 60    # 끝난 문제를 교육생 화면에 남겨 두는 초
WHO_CACHE = 60          # 로그인 확인 기억 초
LANG_FRESH = 30 * 60    # 최근 이만큼 안에 앱을 연 교육생의 언어로 미리 번역
REPEAT_DAYS = 30        # 같은 반에 같은 문제 다시 안 내는 기간
REVIEW_RATE = 60        # 반 정답률이 이보다 낮은 돌발 OX 는 다음 날 매일 문제에 다시 낸다 (%)
REVIEW_MIN_ANSWERS = 3  # 답한 사람이 이보다 적으면 정답률을 믿지 않음
REVIEW_DAYS = 3         # 최근 며칠 안에 낸 돌발 OX 까지 (주말·결석 다음 날도 받도록)
REVIEW_MAX = 2          # 하루 매일 문제에 더하는 최대 수
TEXT_MAX = 300

_lock = threading.RLock()
_live = {}              # 반 id → 지금(또는 방금 끝난) 문제 상태
_who = {}               # 토큰 해시 → (시각, 사용자 요약)
_seen = {}              # 교육생 id → (시각, 언어)


def _err(status, code):
    raise HTTPException(status, {"code": code})


def _now():
    return time.time()


def _wall():
    """데이터베이스에 넣는 시각 (실제 시계). 단계 계산은 _now()."""
    return datetime.now(timezone.utc).isoformat()


def reset():
    """시험용: 메모리 비우기."""
    with _lock:
        _live.clear()
        _who.clear()
        _seen.clear()


# ---- 문제 만들기 (교재 글·수업 글 → OX) ----

OX_SYSTEM = """You write OX (true/false) quiz statements for welding trainees from the given Korean text
(a textbook range or notes of today's class). Many trainees are foreign workers: plain, short Korean sentences.
- Use ONLY facts stated in the text. One important idea per statement. No page numbers or trivia.
- answer = 0 if the statement is true (O), 1 if false (X). Mix true and false.
- explanation: 1-2 plain sentences why. page: the [p.N] marker where the fact is (0 if none).
Reply with ONLY one JSON object: {"questions":[{"question":"","answer":0,"explanation":"","page":0}]}"""


def make_ox(text, title="", n=1, pages=(0, 0)):
    """글 → OX 문제 dict 목록 (저장 안 함). 실패하면 RuntimeError."""
    prompt = f"Topic: {title}\nWrite {n} OX statements.\n\nText:\n{text}"
    out = daily._ask(report.model_name(), OX_SYSTEM, prompt, 2000, timeout=60)
    s, e = pages
    rows = []
    for q in out.get("questions") or []:
        if isinstance(q, dict):
            c = daily.clean_question({**q, "kind": "ox"}, s, e if e else 10 ** 6)
            if c:
                if not e:
                    c["page"] = None
                rows.append(c)
    return rows[:n]


def save_question(book_id, q, unit_key="", unit_title="", source="live", status="active", user_id=None):
    """OX 문제 하나를 quiz_questions 에 저장 → 저장한 행."""
    row = {"id": str(uuid.uuid4()), "book_id": book_id, "unit_key": unit_key, "unit_title": unit_title[:300],
           "kind": "ox", "question": q["question"][:500], "choices": [], "answer": q["answer"], "model_answer": "",
           "explanation": (q.get("explanation") or "")[:600], "page": q.get("page"), "status": status,
           "report_count": 0, "translations": {}, "source": source, "created_by": user_id}
    store.insert_rows("quiz_questions", [row], returning=False)
    return row


def ox_from_unit(book, unit_key, user_id=None):
    """장 하나의 교재 글로 OX 하나를 새로 만들어 문제 은행에 넣는다 (은행에 그 장 OX 가 없을 때)."""
    unit = next(((k, t, s, e) for k, t, s, e in daily.book_units(book) if k == unit_key), None)
    if not unit:
        _err(404, "not_found")
    k, title, s, e = unit
    text = daily.unit_text(book["id"], s, e)
    if len(text) < daily.UNIT_TEXT_MIN:
        _err(400, "live_no_text")
    try:
        qs = make_ox(text, title, 1, (s, e))
    except RuntimeError as ex:
        _err(502, str(ex).split(":")[0])
    if not qs:
        _err(502, "dq_ai_failed")
    return save_question(book["id"], qs[0], k, title, source="live", status="active", user_id=user_id)


# ---- 번역 ----

def _translate_question(q, langs):
    for lang in langs:
        try:
            daily.ensure_translations([q], lang)
        except Exception as ex:  # noqa: BLE001
            print("[live] 번역 실패", lang, str(ex)[:160], flush=True)


EXPLAIN_SYSTEM = """You are Weldy, a friendly AI study helper for welding trainees (many are foreign workers).
The class just answered an OX question and many got it wrong. Explain it in plain, short Korean: 3-4 sentences.
Say whether the statement is O or X, the key reason, and one easy tip to remember. Use only the given facts.
Reply with ONLY one JSON object: {"text":""}"""
EXPLAIN_TR_SYSTEM = """Translate this short Korean explanation for welding trainees into {lang}. Keep it plain.
Keep technical abbreviations (GTAW, SMAW, HAZ...) as they are. Reply with ONLY one JSON object: {{"text":""}}"""


def _make_explain(quiz):
    q = quiz["q"]
    page_text = ""
    if q.get("page") and q.get("book_id"):
        try:
            page_text = daily.unit_text(q["book_id"], q["page"], q["page"])[:3000]
        except Exception:  # noqa: BLE001
            page_text = ""
    prompt = (f"Statement: {q['question']}\nCorrect answer: {'O (true)' if q['answer'] == 0 else 'X (false)'}\n"
              f"Short explanation: {q.get('explanation') or ''}\n"
              f"Class: {quiz['stats']['correct']} of {quiz['stats']['answered']} answered correctly.\n"
              + (f"\nTextbook page:\n{page_text}" if page_text else ""))
    try:
        out = daily._ask(report.model_name(), EXPLAIN_SYSTEM, prompt, 800, timeout=60)
        text = str(out.get("text") or "").strip()[:800]
    except Exception as ex:  # noqa: BLE001
        print("[live] 웰디 설명 실패", str(ex)[:160], flush=True)
        text = ""
    with _lock:
        if text:
            quiz["explain"] = {"ko": text}
            quiz["explain_status"] = "ready"
        else:
            quiz["explain_status"] = "failed"
    if text:
        try:
            store.patch("live_ox", {"id": f"eq.{quiz['id']}"}, {"explain": text})
        except Exception:  # noqa: BLE001
            pass
        for lang in _course_langs(quiz["course_id"]):
            _translate_explain(quiz, lang)


def _translate_explain(quiz, lang):
    with _lock:
        ex = quiz.get("explain") or {}
        if lang == "ko" or lang in ex or not ex.get("ko") or (lang in quiz["explain_busy"]):
            return
        quiz["explain_busy"].add(lang)
    try:
        out = daily._ask(report.model_name(), EXPLAIN_TR_SYSTEM.format(lang=daily.LANG_NAMES[lang]), ex["ko"], 1000, timeout=60)
        text = str(out.get("text") or "").strip()[:1200]
    except Exception as e:  # noqa: BLE001
        print("[live] 설명 번역 실패", str(e)[:160], flush=True)
        text = ""
    with _lock:
        quiz["explain_busy"].discard(lang)
        if text:
            quiz["explain"][lang] = text


def _bg(fn, *args):
    threading.Thread(target=fn, args=args, daemon=True).start()


# ---- 사람 ----

def _members(course_id):
    """반 교육생 {id: 이름} (활동 중인 사람만)."""
    students, _ = manage._students_of(course_id)
    return {s["id"]: s["name"] for s in students if s.get("status") == "active"}


def _course_langs(course_id):
    with _lock:
        quiz = _live.get(course_id)
        members = quiz["members"] if quiz else {}
        t = _now()
        return sorted({lang for uid, (at, lang) in _seen.items()
                       if uid in members and t - at < LANG_FRESH and lang != "ko"})


def _who_am_i(authorization):
    """3초마다 오는 요청용 로그인 확인 (60초 기억)."""
    tok = accounts._bearer(authorization)
    if not tok:
        _err(401, "login_required")
    th = accounts._token_hash(tok)
    with _lock:
        hit = _who.get(th)
        if hit and _now() - hit[0] < WHO_CACHE:
            return hit[1]
    u = accounts.current_user(authorization)
    me = {"id": u["id"], "role": u["role"], "courses": manage.course_ids_of(u["id"]) if u["role"] == "student" else set()}
    with _lock:
        if len(_who) > 2000:
            _who.clear()
        _who[th] = (_now(), me)
    return me


def _can_send(user, course_id):
    return user["role"] == "admin" or (user["role"] == "teacher" and course_id in manage.course_ids_of(user["id"]))


# ---- 상태 ----

def _tick(quiz):
    """시간이 지나면 다음 단계로 (lock 안에서 부른다)."""
    t = _now()
    if quiz["phase"] == "prep" and (quiz["ready"] or t - quiz["created"] >= PREP_MAX):
        quiz["phase"] = "open"
        quiz["open_at"] = t
        quiz["ends_at"] = t + quiz["seconds"]
    if quiz["phase"] == "open" and t >= quiz["ends_at"] + GRACE:  # 늦게 도착한 답을 잠깐 봐준다
        _finish(quiz)


def _finish(quiz):
    """문제 끝내기: 채점·통계 (lock 안). 저장은 뒤에서."""
    if quiz["phase"] == "ended":
        return
    quiz["phase"] = "ended"
    quiz["ended_at"] = _now()
    ans = quiz["answers"]
    right = quiz["q"]["answer"]
    correct = sum(1 for a, _ in ans.values() if a == right)
    quiz["stats"] = {"answered": len(ans), "correct": correct, "targets": len(quiz["members"]),
                     "rate": round(correct * 100 / len(ans)) if ans else 0}
    _bg(_save_result, quiz["id"], quiz["course_id"], dict(ans), dict(quiz["stats"]), dict(quiz["q"]), _wall())


def _save_result(quiz_id, course_id, answers, stats, q, ended_at):
    try:
        store.patch("live_ox", {"id": f"eq.{quiz_id}"}, {"ended_at": ended_at, "answered": stats["answered"],
                                                          "correct": stats["correct"], "targets": stats["targets"]})
        if answers:
            store.insert_rows("live_ox_answers", [
                {"quiz_id": quiz_id, "user_id": uid, "question_id": q.get("id") if q.get("book_id") else None,
                 "book_id": q.get("book_id"), "answer": a, "correct": a == q["answer"], "created_at": at}
                for uid, (a, at) in answers.items()], returning=False)
        import board
        board.clear_cache()
    except Exception as e:  # noqa: BLE001
        print("[live] 결과 저장 실패", str(e)[:200], flush=True)


def _prepare(quiz):
    langs = _course_langs(quiz["course_id"])
    if quiz["q"].get("book_id") and langs:
        _translate_question(quiz["q"], langs)
    with _lock:
        quiz["ready"] = True


def start_quiz(course_id, teacher, q, seconds=DEFAULT_SECONDS, offset=0):
    """문제 하나(quiz_questions 행 모양)를 반에 보낸다 → 상태. 이미 열린 문제가 있으면 그것을 끝낸다."""
    members = _members(course_id)
    qid = str(uuid.uuid4())
    store.insert_rows("live_ox", [{"id": qid, "course_id": course_id, "teacher_id": teacher["id"],
                                   "book_id": q.get("book_id"), "question_id": q.get("id") if q.get("book_id") else None,
                                   "question": q["question"], "answer": q["answer"], "seconds": seconds,
                                   "targets": len(members), "started_at": _wall()}], returning=False)
    quiz = {"id": qid, "course_id": course_id, "teacher_id": teacher["id"], "q": q, "seconds": seconds,
            "members": members, "answers": {}, "phase": "prep", "ready": False, "created": _now(),
            "open_at": None, "ends_at": None, "ended_at": None, "stats": None,
            "explain": None, "explain_status": "none", "explain_busy": set(), "offset": offset}
    with _lock:
        old = _live.get(course_id)
        if old and old["phase"] != "ended":
            _finish(old)
        _live[course_id] = quiz
    _bg(_prepare, quiz)
    return quiz


def _get_quiz(quiz_id):
    with _lock:
        for quiz in _live.values():
            if quiz["id"] == quiz_id:
                _tick(quiz)
                return quiz
    return None


def _q_lang(q, lang):
    tr = (q.get("translations") or {}).get(lang) if lang != "ko" else None
    return tr or None


def _student_view(quiz, uid, lang):
    q = quiz["q"]
    tr = _q_lang(q, lang)
    t = _now()
    mine = quiz["answers"].get(uid)
    out = {"id": quiz["id"], "phase": quiz["phase"], "question": q["question"],
           "tr": tr.get("question") if tr else None, "seconds": quiz["seconds"],
           "left": max(0, round(quiz["ends_at"] - t, 1)) if quiz["phase"] == "open" else None,
           "my_answer": mine[0] if mine else None, "result": None}
    if quiz["phase"] == "ended":
        ex = quiz.get("explain") or {}
        out["result"] = {
            "answer": q["answer"], "correct": (mine[0] == q["answer"]) if mine else None,
            "explanation": q.get("explanation") or "", "tr_explanation": tr.get("explanation") if tr else None,
            "page": q.get("page"), "book_id": q.get("book_id"), "rate": quiz["stats"]["rate"],
            "answered": quiz["stats"]["answered"], "explain_status": quiz["explain_status"],
            "explain": ex.get(lang) or ex.get("ko"), "explain_lang": lang if ex.get(lang) else "ko",
        }
        if q.get("page") and q.get("book_id"):
            out["result"]["printed_page"] = q["page"] - (quiz.get("offset") or 0)
    return out


def _teacher_view(quiz):
    q = quiz["q"]
    t = _now()
    ans = quiz["answers"]
    o = sum(1 for a, _ in ans.values() if a == 0)
    names = quiz["members"]
    out = {"id": quiz["id"], "course_id": quiz["course_id"], "phase": quiz["phase"], "question": q["question"],
           "answer": q["answer"], "explanation": q.get("explanation") or "", "page": q.get("page"),
           "seconds": quiz["seconds"], "left": max(0, round(quiz["ends_at"] - t, 1)) if quiz["phase"] == "open" else None,
           "targets": len(names), "answered": len(ans), "o": o, "x": len(ans) - o,
           "waiting": sorted(n for uid, n in names.items() if uid not in ans),
           "wrong": [], "stats": quiz["stats"], "explain_status": quiz["explain_status"],
           "explain": (quiz.get("explain") or {}).get("ko")}
    if quiz["phase"] == "ended":
        out["wrong"] = sorted(names.get(uid, "?") for uid, (a, _) in ans.items() if a != q["answer"])
    return out


# ---- API: 교육생 ----

@router.get("/live/now")
def live_now(lang: str = "ko", authorization: str | None = Header(None)):
    """교육생 앱이 3초마다 묻는다: 지금 내 반에 돌발 OX 가 있나?"""
    with _lock:
        if not _live:
            return {"quiz": None}
    me = _who_am_i(authorization)
    if me["role"] != "student":
        return {"quiz": None}
    lang = daily._lang(lang)
    need_tr = None
    with _lock:
        _seen[me["id"]] = (_now(), lang)
        best = None
        for cid in me["courses"]:
            quiz = _live.get(cid)
            if not quiz or me["id"] not in quiz["members"]:
                continue
            _tick(quiz)
            if quiz["phase"] == "prep":
                continue
            if quiz["phase"] == "ended" and _now() - quiz["ended_at"] > KEEP_ENDED:
                continue
            if not best or quiz["created"] > best["created"]:
                best = quiz
        if not best:
            return {"quiz": None}
        view = _student_view(best, me["id"], lang)
        ex = best.get("explain") or {}
        if lang != "ko" and ex.get("ko") and lang not in ex:
            need_tr = best
    if need_tr:
        _bg(_translate_explain, need_tr, lang)
    return {"quiz": view}


class AnswerBody(BaseModel):
    quiz_id: str
    answer: int


@router.post("/live/answer")
def live_answer(body: AnswerBody, user=Depends(accounts.current_user)):
    if body.answer not in (0, 1):
        _err(400, "live_bad_answer")
    quiz = _get_quiz(body.quiz_id)
    if not quiz or user["id"] not in quiz["members"]:
        _err(404, "not_found")
    with _lock:
        if quiz["phase"] == "open" and _now() <= quiz["ends_at"] + GRACE:
            quiz["answers"][user["id"]] = (body.answer, _wall())
            return {"ok": True}
    _err(409, "live_closed")


# ---- API: 교사 ----

def _need_teacher(user):
    if user["role"] not in ("teacher", "admin"):
        _err(403, "forbidden")


@router.get("/live/setup")
def live_setup(user=Depends(accounts.current_user)):
    """교사 돌발 OX 화면: 보낼 수 있는 반, 장 목록(장마다 OX 수), 반마다 지금 문제."""
    _need_teacher(user)
    if user["role"] == "admin":
        courses = store.select("courses", {"active": "eq.true", "select": "id,name", "order": "sort.asc,name.asc"})
    else:
        courses = accounts._courses_of(user["id"])
    book = textbook.current_book()
    units = []
    if book:
        counts = {}
        for q in store.select("quiz_questions", {"book_id": f"eq.{book['id']}", "kind": "eq.ox", "status": "eq.active",
                                                 "select": "unit_key"}):
            counts[q["unit_key"]] = counts.get(q["unit_key"], 0) + 1
        units = [{"unit_key": k, "title": t, "ox": counts.get(k, 0)} for k, t, *_ in daily.book_units(book)]
    live = {}
    with _lock:
        for c in courses:
            quiz = _live.get(c["id"])
            if quiz:
                _tick(quiz)
                if quiz["phase"] != "ended":
                    live[c["id"]] = quiz["id"]
    return {"courses": courses, "book": {"id": book["id"], "title": book.get("title") or ""} if book else None,
            "units": units, "seconds": list(SECONDS), "default_seconds": DEFAULT_SECONDS, "live": live}


def _recent_ids(course_id):
    since = (datetime.now(timezone.utc) - timedelta(days=REPEAT_DAYS)).isoformat()
    return {r["question_id"] for r in store.select("live_ox", {"course_id": f"eq.{course_id}", "started_at": f"gte.{since}",
                                                               "select": "question_id"}) if r.get("question_id")}


class PickBody(BaseModel):
    course_id: str
    unit_key: str = ""
    exclude: list[str] = []
    make: bool = False      # 은행에 없으면 AI 로 새로 만들기


@router.post("/live/pick")
def live_pick(body: PickBody, user=Depends(accounts.current_user)):
    """문제 은행에서 OX 하나 골라 주기 (이 반에 최근 낸 문제·방금 넘긴 문제는 빼고)."""
    _need_teacher(user)
    manage._uuid(body.course_id)
    if not _can_send(user, body.course_id):
        _err(404, "not_found")
    book = textbook.current_book()
    if not book:
        _err(400, "live_no_book")
    params = {"book_id": f"eq.{book['id']}", "kind": "eq.ox", "status": "eq.active", "select": daily.QSEL}
    if body.unit_key:
        params["unit_key"] = f"eq.{body.unit_key}"
    pool = store.select("quiz_questions", params)
    skip = set(body.exclude)
    fresh = [q for q in pool if q["id"] not in skip]
    recent = _recent_ids(body.course_id)
    best = [q for q in fresh if q["id"] not in recent] or fresh
    if best and not body.make:
        q = random.choice(best)
        return {"question": _bank_view(q, book), "left": len(best) - 1}
    if not body.unit_key:
        _err(404, "live_no_question")
    if not body.make:
        return {"question": None, "can_make": True}
    q = ox_from_unit(book, body.unit_key, user["id"])
    return {"question": _bank_view(q, book), "left": 0, "made": True}


def _bank_view(q, book):
    off = book.get("page_offset") or 0
    return {"id": q["id"], "question": q["question"], "answer": q["answer"], "explanation": q.get("explanation") or "",
            "unit_title": q.get("unit_title") or "", "page": q.get("page"),
            "printed_page": (q["page"] - off) if q.get("page") else None}


@router.get("/live/bank")
def live_bank(unit_key: str = "", user=Depends(accounts.current_user)):
    """문제 은행 OX 목록 (교사가 직접 고르기)."""
    _need_teacher(user)
    book = textbook.current_book()
    if not book:
        return {"items": []}
    params = {"book_id": f"eq.{book['id']}", "kind": "eq.ox", "status": "eq.active", "select": daily.QSEL,
              "order": "created_at.asc"}
    if unit_key:
        params["unit_key"] = f"eq.{unit_key}"
    return {"items": [_bank_view(q, book) for q in store.select("quiz_questions", params)]}


class StartBody(BaseModel):
    course_id: str
    question_id: str = ""
    text: str = ""          # 교사가 직접 친 문장
    answer: int | None = None
    explanation: str = ""
    seconds: int = DEFAULT_SECONDS


@router.post("/live/start")
def live_start(body: StartBody, user=Depends(accounts.current_user)):
    _need_teacher(user)
    manage._uuid(body.course_id)
    if not _can_send(user, body.course_id):
        _err(404, "not_found")
    if body.seconds not in SECONDS:
        _err(400, "live_bad_seconds")
    book = textbook.current_book()
    if body.question_id:
        manage._uuid(body.question_id)
        rows = store.select("quiz_questions", {"id": f"eq.{body.question_id}", "kind": "eq.ox", "select": daily.QSEL})
        if not rows:
            _err(404, "not_found")
        q = rows[0]
    else:
        text = body.text.strip()
        if not text or body.answer not in (0, 1):
            _err(400, "live_need_text")
        q = {"question": text[:TEXT_MAX], "answer": body.answer, "explanation": body.explanation.strip()[:600], "page": None}
        if book:  # 직접 친 문제도 저장해 두면 번역·학습 보드에 쓸 수 있다 (매일 문제에는 안 나옴)
            q = save_question(book["id"], q, source="live", status="live", user_id=user["id"])
        else:
            q = {**q, "id": None, "book_id": None, "translations": {}}
    if not _members(body.course_id):
        _err(400, "live_no_students")
    quiz = start_quiz(body.course_id, user, q, body.seconds, (book or {}).get("page_offset") or 0)
    with _lock:
        return {"quiz": _teacher_view(quiz)}


@router.get("/live/status/{quiz_id}")
def live_status(quiz_id: str, user=Depends(accounts.current_user)):
    """교사 실시간 화면 (2초마다)."""
    _need_teacher(user)
    quiz = _get_quiz(quiz_id)
    if not quiz or not _can_send(user, quiz["course_id"]):
        _err(404, "not_found")
    with _lock:
        return {"quiz": _teacher_view(quiz)}


@router.post("/live/end/{quiz_id}")
def live_end(quiz_id: str, user=Depends(accounts.current_user)):
    _need_teacher(user)
    quiz = _get_quiz(quiz_id)
    if not quiz or not _can_send(user, quiz["course_id"]):
        _err(404, "not_found")
    with _lock:
        if quiz["phase"] == "prep":
            quiz["open_at"] = quiz["ends_at"] = _now()
        _finish(quiz)
        return {"quiz": _teacher_view(quiz)}


@router.post("/live/explain/{quiz_id}")
def live_explain(quiz_id: str, user=Depends(accounts.current_user)):
    """웰디가 설명하기: 끝난 문제를 AI 가 쉬운 말로 풀어 교육생 화면에 띄운다."""
    _need_teacher(user)
    quiz = _get_quiz(quiz_id)
    if not quiz or not _can_send(user, quiz["course_id"]):
        _err(404, "not_found")
    if not report.configured():
        _err(503, "ai_not_configured")
    with _lock:
        if quiz["phase"] != "ended":
            _err(409, "live_not_ended")
        if quiz["explain_status"] in ("making", "ready"):
            return {"quiz": _teacher_view(quiz)}
        quiz["explain_status"] = "making"
    _bg(_make_explain, quiz)
    with _lock:
        return {"quiz": _teacher_view(quiz)}


@router.get("/live/history")
def live_history(course_id: str, day: str = "", user=Depends(accounts.current_user)):
    """그날(한국 날짜) 이 반에 낸 돌발 OX와 정답률."""
    _need_teacher(user)
    manage._uuid(course_id)
    if not _can_send(user, course_id):
        _err(404, "not_found")
    try:
        d = datetime.strptime(day, "%Y-%m-%d").date() if day else daily.today()
    except ValueError:
        _err(400, "auth_err_bad_date")
    start = datetime(d.year, d.month, d.day, tzinfo=daily.KST).astimezone(timezone.utc)
    rows = store.select("live_ox", {"course_id": f"eq.{course_id}", "and": f"(started_at.gte.{start.isoformat()},"
                                    f"started_at.lt.{(start + timedelta(days=1)).isoformat()})",
                                    "select": "id,question,answer,seconds,started_at,ended_at,answered,correct,targets,explain",
                                    "order": "started_at.desc"})
    items = []
    for r in rows:
        n = r.get("answered") or 0
        items.append({**r, "rate": round((r.get("correct") or 0) * 100 / n) if n else None})
    return {"day": d.isoformat(), "items": items}


def missed_counts(course_ids, since_iso):
    """교사용: 반마다 기간 안 끝난 돌발 OX 중 답하지 않은 수 → {교육생 id: [놓친 수, 낸 수]}."""
    out = {}
    try:
        for cid in course_ids:
            quizzes = store.select("live_ox", {"course_id": f"eq.{cid}", "ended_at": "not.is.null",
                                               **({"started_at": f"gte.{since_iso}"} if since_iso else {}),
                                               "select": "id"})
            if not quizzes:
                continue
            ids = [q["id"] for q in quizzes]
            got = {}
            for i in range(0, len(ids), 150):
                for a in store.select("live_ox_answers", {"quiz_id": f"in.({','.join(ids[i:i + 150])})",
                                                          "select": "quiz_id,user_id"}):
                    got.setdefault(a["user_id"], set()).add(a["quiz_id"])
            for uid in _members(cid):
                x = out.setdefault(uid, [0, 0])
                x[1] += len(ids)
                x[0] += len(ids) - len(got.get(uid, set()))
    except Exception as e:  # noqa: BLE001  (step13 SQL 전)
        print("[live] 놓친 학생 못 셈", str(e)[:160], flush=True)
    return out


def review_for(user_id, book_id, exclude=()):
    """정답률이 낮았던 돌발 OX → 이 교육생의 다음 매일 문제에 다시 낼 문제 id (맞힌 사람은 빼고, 최신 먼저)."""
    since = (datetime.now(timezone.utc) - timedelta(days=REVIEW_DAYS)).isoformat()
    skip = set(exclude)
    out = []
    try:
        cids = manage.course_ids_of(user_id)
        if not cids:
            return []
        rows = store.select("live_ox", {"course_id": f"in.({','.join(sorted(cids))})", "book_id": f"eq.{book_id}",
                                        "ended_at": "not.is.null", "started_at": f"gte.{since}",
                                        "select": "id,question_id,answered,correct,started_at", "order": "started_at.desc"})
        low = [r for r in rows if r.get("question_id") and (r.get("answered") or 0) >= REVIEW_MIN_ANSWERS
               and (r.get("correct") or 0) * 100 < REVIEW_RATE * r["answered"]]
        if not low:
            return []
        right = {a["quiz_id"] for a in store.select("live_ox_answers", {
            "quiz_id": f"in.({','.join(r['id'] for r in low)})", "user_id": f"eq.{user_id}", "correct": "is.true",
            "select": "quiz_id"})}
        for r in low:
            if r["id"] in right or r["question_id"] in skip or r["question_id"] in out:
                continue
            out.append(r["question_id"])
            if len(out) >= REVIEW_MAX:
                break
    except Exception as e:  # noqa: BLE001  (step13 SQL 전)
        print("[live] 다시 풀 문제 못 찾음", str(e)[:160], flush=True)
        return []
    return out
