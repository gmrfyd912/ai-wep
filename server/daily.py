"""T2(이론): 매일 문제.

- 문제 은행: 관리자가 누르면 AI 가 교재 장(章)마다 글자를 읽고 객관식·주관식 문제를 미리 만든다 (뒤에서, 장마다).
- 매일 문제: 교육생마다 하루 객관식 N + 주관식 M (기본 2+1, 관리자 설정). 본 장 위주, 전에 틀린 장 먼저, 30일 안에 낸 문제는 다시 안 냄.
- 채점: 객관식은 바로, 주관식은 AI(0~10점, 해설). AI 가 안 되면 '채점 대기'로 두고 교사가 점수를 넣는다.
- 번역: 문제는 한국어로 만들고, 교육생 앱 언어로 한 번 번역해 저장해 둔다.
- 교사 보드: 반 교육생별 오늘 응시·점수·연속 일수·많이 틀린 장.
"""
import json
import random
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import accounts
import manage
import store
import textbook
from admin_settings import _save_setting, need_admin

router = APIRouter()
KST = timezone(timedelta(hours=9))
DEFAULT_SETTINGS = {"mc": 2, "short": 1}
MC_PER_UNIT = 8          # 장마다 만드는 객관식 수
SHORT_PER_UNIT = 4       # 장마다 만드는 주관식 수
UNIT_TEXT_MAX = 14000    # 장 하나에서 AI 에게 보내는 글자 수
UNIT_TEXT_MIN = 300      # 이보다 글자가 적은 장(스캔이 안 읽힌 장)은 건너뜀
REPEAT_DAYS = 30         # 같은 문제를 다시 내지 않는 기간
PASS_SCORE = 6           # 주관식 이 점수 미만이면 '틀림'으로 본다
LANGS = ("ko", "en", "vi", "th", "fil", "uz", "id", "es")
LANG_NAMES = {"ko": "Korean", "en": "English", "vi": "Vietnamese", "th": "Thai", "fil": "Filipino",
              "uz": "Uzbek", "id": "Indonesian", "es": "Spanish"}

_quiz_lock = threading.Lock()
_quiz_job = {"book_id": None}


def _err(status, code, **extra):
    raise HTTPException(status, {"code": code, **extra})


def _now():
    return datetime.now(timezone.utc).isoformat()


def today(now=None):
    return (now or datetime.now(timezone.utc)).astimezone(KST).date()


def settings():
    s = accounts._setting("daily", DEFAULT_SETTINGS) or {}
    return {"mc": int(s.get("mc", DEFAULT_SETTINGS["mc"])), "short": int(s.get("short", DEFAULT_SETTINGS["short"]))}


def unit_key(pi, ci):
    return f"{pi}-{'' if ci is None else ci}"


def book_units(book):
    """[(unit_key, 제목, PDF 시작, PDF 끝)] — 진도와 같은 단위(장)."""
    pages = book.get("pages") or 0
    offset = book.get("page_offset") or 0
    toc = textbook.clean_toc(book.get("toc"), pages, offset)
    out = []
    for pi, ci, s, e in textbook.units(toc, offset, pages):
        part = toc[pi]
        title = part["title"] if ci is None else f'{part["title"]} › {part["chapters"][ci]["title"]}'
        out.append((unit_key(pi, ci), title, s, e))
    return out


# ---- AI ----

def _client(timeout):
    import anthropic
    return anthropic, anthropic.Anthropic(timeout=timeout, max_retries=2)


def _ask(model, system, text, max_tokens, timeout=180):
    """Claude 에게 묻고 JSON 객체를 돌려받는다. 실패하면 RuntimeError(code)."""
    import report
    if not report.configured():
        raise RuntimeError("ai_not_configured")
    anthropic, client = _client(timeout)
    try:
        resp = client.beta.messages.create(
            model=model,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": text}],
        )
    except anthropic.AuthenticationError:
        raise RuntimeError("ai_key_invalid")
    except anthropic.RateLimitError:
        raise RuntimeError("ai_busy")
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as e:
        raise RuntimeError(f"dq_ai_failed: {str(e)[:160]}")
    if resp.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError(f"dq_ai_failed: {resp.stop_reason}")
    out = parse_json("".join(b.text for b in resp.content if b.type == "text"))
    if out is None:
        raise RuntimeError("dq_ai_failed: bad_json")
    return out


def parse_json(text):
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", t)
    i, j = t.find("{"), t.rfind("}")
    if i < 0 or j <= i:
        return None
    try:
        out = json.loads(t[i:j + 1])
    except json.JSONDecodeError:
        return None
    return out if isinstance(out, dict) else None


QUIZ_SYSTEM = """You write quiz questions for welding trainees from one chapter of their Korean welding textbook.
Many trainees are foreign workers, so write in plain, short Korean sentences.
- Use ONLY facts stated in the given text. Do not test page numbers, figure numbers or trivia.
- Each question tests one important idea (definition, cause, effect, comparison, safety point, procedure).
- Multiple choice ("mc"): exactly 4 choices, exactly one correct, wrong choices plausible but clearly wrong by the text. answer = index 0-3 of the correct choice. Vary the position of the correct choice.
- Short answer ("short"): answerable in 1-3 sentences. model_answer = a short correct answer. points = 2-4 key points a good answer must mention.
- explanation: 1-2 plain sentences why the answer is right.
- page: the [p.N] marker of the page where the answer is found.
Reply with ONLY one JSON object:
{"questions":[{"kind":"mc","question":"","choices":["","","",""],"answer":0,"explanation":"","page":0},
{"kind":"short","question":"","model_answer":"","points":[""],"explanation":"","page":0}]}"""


def clean_question(q, s, e):
    """AI 가 준 문제 하나 검사 → 저장할 dict 또는 None."""
    if not isinstance(q, dict):
        return None
    kind = q.get("kind")
    text = str(q.get("question") or "").strip()[:500]
    expl = str(q.get("explanation") or "").strip()[:600]
    try:
        page = int(q.get("page") or 0)
    except (TypeError, ValueError):
        page = 0
    if not (s <= page <= e):
        page = s
    if not text:
        return None
    if kind == "mc":
        choices = [str(c).strip()[:200] for c in (q.get("choices") or []) if str(c).strip()]
        try:
            ans = int(q.get("answer"))
        except (TypeError, ValueError):
            return None
        if len(choices) != 4 or len(set(choices)) != 4 or not 0 <= ans < 4:
            return None
        return {"kind": "mc", "question": text, "choices": choices, "answer": ans, "model_answer": "",
                "explanation": expl, "page": page}
    if kind == "short":
        model = str(q.get("model_answer") or "").strip()[:600]
        points = [str(p).strip()[:200] for p in (q.get("points") or []) if str(p).strip()][:5]
        if not model:
            return None
        return {"kind": "short", "question": text, "choices": points, "answer": None, "model_answer": model,
                "explanation": expl, "page": page}
    return None


def unit_text(book_id, s, e):
    rows = store.select("textbook_pages", {"book_id": f"eq.{book_id}", "and": f"(page.gte.{s},page.lt.{e + 1})",
                                           "select": "page,text", "order": "page.asc"})
    parts = [f"[p.{r['page']}]\n{(r.get('text') or '').strip()}" for r in rows if (r.get("text") or "").strip()]
    return "\n\n".join(parts)[:UNIT_TEXT_MAX]


def make_unit_questions(book_id, key, title, s, e):
    """장 하나 → 문제 저장. 저장한 수 (글자가 너무 적으면 0)."""
    text = unit_text(book_id, s, e)
    if len(re.sub(r"\[p\.\d+\]|\s", "", text)) < UNIT_TEXT_MIN:
        return 0
    prompt = (f"Chapter: {title}\nWrite {MC_PER_UNIT} multiple choice and {SHORT_PER_UNIT} short answer questions.\n\n"
              f"Textbook text:\n{text}")
    out = _ask(textbook.model_name(), QUIZ_SYSTEM, prompt, 12000)
    rows = []
    for q in out.get("questions") or []:
        c = clean_question(q, s, e)
        if c:
            rows.append({"id": str(uuid.uuid4()), "book_id": book_id, "unit_key": key, "unit_title": title[:300],
                         "status": "active", "report_count": 0, "translations": {}, **c})
    if rows:
        store.insert_rows("quiz_questions", rows, returning=False)
    return len(rows)


def run_quiz_job(book_id, replace):
    """뒤에서 실행: 장마다 문제 만들기 (3개씩 동시에). 이미 문제가 있는 장은 건너뜀 (replace 면 지우고 새로)."""
    ping = textbook._keep_awake_url()
    try:
        book = textbook._get(book_id)
        if replace:
            store.delete("quiz_questions", {"book_id": f"eq.{book_id}"})
        have = {r["unit_key"] for r in store.select("quiz_questions", {"book_id": f"eq.{book_id}", "select": "unit_key"})}
        units = [u for u in book_units(book) if u[0] not in have]
        total = len(units)
        store.patch("textbooks", {"id": f"eq.{book_id}"},
                    {"quiz_status": "running", "quiz_done": 0, "quiz_total": total, "quiz_error": ""})
        done = [0]
        errors = []
        last_ping = [time.time()]
        lock = threading.Lock()

        def work(u):
            try:
                make_unit_questions(book_id, *u)
            except Exception as e:  # noqa: BLE001
                errors.append(str(e)[:200])
            with lock:
                done[0] += 1
                store.patch("textbooks", {"id": f"eq.{book_id}"}, {"quiz_done": done[0]})
                if ping and time.time() - last_ping[0] > 240:
                    last_ping[0] = time.time()
                    try:
                        requests.get(ping, timeout=10)
                    except Exception:  # noqa: BLE001
                        pass

        with ThreadPoolExecutor(3) as pool:
            list(pool.map(work, units))
        err = ""
        if errors:
            err = f"{len(errors)}/{total}: {errors[0]}"
        store.patch("textbooks", {"id": f"eq.{book_id}"},
                    {"quiz_status": "failed" if errors and len(errors) == total else "ready", "quiz_error": err})
        print(f"[daily] {book_id} 문제 만들기 끝 {total}장, 실패 {len(errors)}", flush=True)
    except Exception as e:  # noqa: BLE001
        print("[daily] 문제 만들기 실패", type(e).__name__, str(e)[:300], flush=True)
        try:
            store.patch("textbooks", {"id": f"eq.{book_id}"}, {"quiz_status": "failed", "quiz_error": str(e)[:200]})
        except Exception:  # noqa: BLE001
            pass
    finally:
        _quiz_job["book_id"] = None
        _quiz_lock.release()


def _start_quiz_job(book_id, replace):
    threading.Thread(target=run_quiz_job, args=(book_id, replace), daemon=True).start()


GRADE_SYSTEM = """You grade one short answer from a welding trainee. Many trainees are foreign workers: judge the meaning, not spelling or grammar. The answer may be in any language.
Give score 0-10 (10 = all key points, 6 = main idea right, 0 = wrong or empty).
feedback: 1-2 short, kind sentences in {lang}: what was right and what was missing.
Reply with ONLY: {{"score":0,"feedback":""}}"""


def grade_short(q, answer, lang):
    """주관식 채점 → (점수, 해설). AI 가 안 되면 (None, '')."""
    import report
    text = (f"Question: {q['question']}\nModel answer: {q.get('model_answer') or ''}\n"
            f"Key points: {'; '.join(q.get('choices') or [])}\nTrainee answer: {answer}")
    try:
        out = _ask(report.model_name(), GRADE_SYSTEM.format(lang=LANG_NAMES.get(lang, "Korean")), text, 600, timeout=60)
        score = max(0, min(10, int(round(float(out.get("score"))))))
        return score, str(out.get("feedback") or "").strip()[:600]
    except Exception as e:  # noqa: BLE001
        print("[daily] 주관식 채점 실패", str(e)[:200], flush=True)
        return None, ""


TRANSLATE_SYSTEM = """Translate welding quiz content from Korean into {lang} for foreign welding trainees.
Keep it plain and short. Keep technical abbreviations (GTAW, SMAW, HAZ...) as they are.
Input and output have the same JSON shape: {{"items":[{{"id":"","question":"","choices":[""],"explanation":"","model_answer":""}}]}}
Reply with ONLY the JSON object."""


def ensure_translations(questions, lang):
    """문제 번역이 없으면 한 번에 번역해 저장 (실패하면 한국어 그대로)."""
    if lang == "ko" or lang not in LANGS:
        return
    need = [q for q in questions if lang not in (q.get("translations") or {})]
    if not need:
        return
    import report
    items = [{"id": q["id"], "question": q["question"], "choices": q.get("choices") or [],
              "explanation": q.get("explanation") or "", "model_answer": q.get("model_answer") or ""} for q in need]
    try:
        out = _ask(report.model_name(), TRANSLATE_SYSTEM.format(lang=LANG_NAMES[lang]),
                   json.dumps({"items": items}, ensure_ascii=False), 4000, timeout=60)
    except Exception as e:  # noqa: BLE001
        print("[daily] 번역 실패", str(e)[:200], flush=True)
        return
    got = {str(i.get("id")): i for i in out.get("items") or [] if isinstance(i, dict)}
    for q in need:
        t = got.get(q["id"])
        if not t or not str(t.get("question") or "").strip():
            continue
        choices = [str(c)[:300] for c in (t.get("choices") or [])]
        if len(choices) != len(q.get("choices") or []):
            choices = q.get("choices") or []
        tr = {"question": str(t["question"])[:800], "choices": choices,
              "explanation": str(t.get("explanation") or "")[:900], "model_answer": str(t.get("model_answer") or "")[:900]}
        q["translations"] = {**(q.get("translations") or {}), lang: tr}
        try:
            store.patch("quiz_questions", {"id": f"eq.{q['id']}"}, {"translations": q["translations"]})
        except Exception:  # noqa: BLE001
            pass


# ---- 매일 문제 고르기 ----

QSEL = "id,book_id,unit_key,unit_title,kind,question,choices,answer,model_answer,explanation,page,status,translations"


def _recent_ids(user_id, day):
    since = (day - timedelta(days=REPEAT_DAYS)).isoformat()
    ids = set()
    for r in store.select("daily_sets", {"user_id": f"eq.{user_id}", "day": f"gte.{since}", "select": "question_ids"}):
        ids.update(r.get("question_ids") or [])
    return ids


def _wrong_units(user_id, book_id=None):
    """틀린 문제의 장 → 틀린 수 (최근 300개 답 중)."""
    rows = store.select("daily_answers", {"user_id": f"eq.{user_id}", "select": "question_id,score",
                                          "order": "created_at.desc", "limit": "300"})
    bad = [r["question_id"] for r in rows if r.get("score") is not None and r["score"] < PASS_SCORE]
    if not bad:
        return {}
    qs = {q["id"]: q for q in store.select("quiz_questions", {"id": f"in.({','.join(set(bad))})",
                                                              "select": "id,unit_key,book_id"})}
    out = {}
    for qid in bad:
        q = qs.get(qid)
        if q and (not book_id or q["book_id"] == book_id):
            out[q["unit_key"]] = out.get(q["unit_key"], 0) + 1
    return out


def pick_questions(user_id, book, day, rng=random):
    """오늘 문제 고르기 → 문제 id 목록 (객관식 먼저, 그다음 주관식)."""
    st = settings()
    pool = store.select("quiz_questions", {"book_id": f"eq.{book['id']}", "status": "eq.active", "select": "id,unit_key,kind"})
    if not pool:
        return []
    units = book_units(book)
    done = {r["page"] for r in store.select("textbook_progress", {
        "user_id": f"eq.{user_id}", "book_id": f"eq.{book['id']}", "select": "page"})}
    read = {k for k, _, s, e in units if any(s <= p <= e for p in done)}
    have = {q["unit_key"] for q in pool}
    if not read & have:
        # 아직 본 장이 없으면 교재 앞쪽 장(문제가 있는 장) 두 개에서
        read = set([k for k, *_ in units if k in have][:2])
    wrong = _wrong_units(user_id, book["id"])
    recent = _recent_ids(user_id, day)
    picked = []
    for kind, n in (("mc", st["mc"]), ("short", st["short"])):
        cands = [q for q in pool if q["kind"] == kind and q["id"] not in recent and q["unit_key"] in read]
        if len(cands) < n:  # 본 장에서 모자라면 다른 장에서도
            cands += [q for q in pool if q["kind"] == kind and q["id"] not in recent and q["unit_key"] not in read]
        if len(cands) < n:  # 그래도 모자라면 예전에 낸 문제도
            cands += [q for q in pool if q["kind"] == kind and q["id"] in recent]
        rng.shuffle(cands)
        cands.sort(key=lambda q: (q["unit_key"] not in read, -wrong.get(q["unit_key"], 0)))
        seen_units = set()
        chosen = []
        for q in cands:  # 되도록 서로 다른 장에서
            if len(chosen) < n and q["unit_key"] not in seen_units:
                chosen.append(q)
                seen_units.add(q["unit_key"])
        for q in cands:
            if len(chosen) < n and q not in chosen:
                chosen.append(q)
        picked += [q["id"] for q in chosen]
    return picked


def get_or_make_set(user, book, day):
    rows = store.select("daily_sets", {"user_id": f"eq.{user['id']}", "day": f"eq.{day.isoformat()}", "select": "*"})
    if rows:
        return rows[0]
    ids = pick_questions(user["id"], book, day)
    if not ids:
        return None
    row = {"user_id": user["id"], "day": day.isoformat(), "book_id": book["id"], "question_ids": ids}
    store.upsert("daily_sets", [row], on_conflict="user_id,day", ignore=True)
    rows = store.select("daily_sets", {"user_id": f"eq.{user['id']}", "day": f"eq.{day.isoformat()}", "select": "*"})
    return rows[0] if rows else row


def _questions(ids):
    if not ids:
        return {}
    return {q["id"]: q for q in store.select("quiz_questions", {"id": f"in.({','.join(ids)})", "select": QSEL})}


def _answers(user_id, day):
    return {r["question_id"]: r for r in store.select("daily_answers", {
        "user_id": f"eq.{user_id}", "day": f"eq.{day.isoformat()}", "select": "*"})}


def _public(q, a, lang, offset):
    """교육생에게 보내는 문제 (답은 푼 뒤에만)."""
    tr = (q.get("translations") or {}).get(lang) if lang != "ko" else None
    out = {"id": q["id"], "kind": q["kind"], "unit_title": q.get("unit_title") or "",
           "question": q["question"], "choices": q.get("choices") if q["kind"] == "mc" else [],
           "page": q.get("page"), "printed_page": (q.get("page") or 0) - offset if q.get("page") else None,
           "tr": ({"question": tr["question"], "choices": tr.get("choices") if q["kind"] == "mc" else []} if tr else None),
           "result": None}
    if a:
        out["result"] = {
            "answer": a.get("answer"), "correct": a.get("correct"), "score": a.get("score"),
            "feedback": a.get("feedback") or "", "graded_by": a.get("graded_by"),
            "correct_choice": q.get("answer") if q["kind"] == "mc" else None,
            "model_answer": q.get("model_answer") or "", "explanation": q.get("explanation") or "",
            "tr": ({"model_answer": tr.get("model_answer") or "", "explanation": tr.get("explanation") or ""} if tr else None),
        }
    return out


def streak_of(user_id, day, need):
    """오늘(또는 어제)까지 매일 문제를 다 푼 연속 일수."""
    since = (day - timedelta(days=60)).isoformat()
    by_day = {}
    for r in store.select("daily_answers", {"user_id": f"eq.{user_id}", "day": f"gte.{since}", "select": "day"}):
        by_day[r["day"]] = by_day.get(r["day"], 0) + 1
    full = {d for d, n in by_day.items() if n >= need}
    n, d = 0, day
    if d.isoformat() not in full:
        d -= timedelta(days=1)
    while d.isoformat() in full:
        n += 1
        d -= timedelta(days=1)
    return n


def _lang(lang):
    return lang if lang in LANGS else "ko"


@router.get("/daily")
def my_daily(lang: str = "ko", user=Depends(accounts.current_user)):
    """오늘의 문제. 교재나 문제 은행이 없으면 ready=false."""
    lang = _lang(lang)
    book = textbook.current_book()
    day = today()
    st = settings()
    if not book:
        return {"ready": False, "reason": "no_book", "day": day.isoformat()}
    s = get_or_make_set(user, book, day)
    if not s:
        return {"ready": False, "reason": "no_questions", "day": day.isoformat()}
    qs = _questions(s["question_ids"])
    ordered = [qs[i] for i in s["question_ids"] if i in qs]
    ensure_translations(ordered, lang)
    answers = _answers(user["id"], day)
    items = [_public(q, answers.get(q["id"]), lang, book.get("page_offset") or 0) for q in ordered]
    answered = [i for i in items if i["result"]]
    return {
        "ready": True, "day": day.isoformat(), "book_id": book["id"], "items": items,
        "done": len(answered), "total": len(items),
        "score": sum((i["result"]["score"] or 0) for i in answered), "max_score": 10 * len(items),
        "streak": streak_of(user["id"], day, len(items) or st["mc"] + st["short"]),
    }


class AnswerBody(BaseModel):
    question_id: str
    answer: int | str
    lang: str = "ko"


@router.post("/daily/answer")
def answer(body: AnswerBody, user=Depends(accounts.current_user)):
    lang = _lang(body.lang)
    book = textbook.current_book()
    day = today()
    rows = store.select("daily_sets", {"user_id": f"eq.{user['id']}", "day": f"eq.{day.isoformat()}", "select": "*"})
    if not rows or body.question_id not in (rows[0].get("question_ids") or []):
        _err(404, "dq_not_today")
    if body.question_id in _answers(user["id"], day):
        _err(409, "dq_answered")
    q = _questions([body.question_id]).get(body.question_id)
    if not q:
        _err(404, "not_found")
    if q["kind"] == "mc":
        try:
            pick = int(body.answer)
        except (TypeError, ValueError):
            _err(400, "dq_bad_answer")
        if not 0 <= pick < 4:
            _err(400, "dq_bad_answer")
        correct = pick == q.get("answer")
        row = {"answer": str(pick), "correct": correct, "score": 10 if correct else 0, "feedback": "", "graded_by": "auto"}
    else:
        text = str(body.answer).strip()[:1000]
        if not text:
            _err(400, "dq_bad_answer")
        score, feedback = grade_short(q, text, lang)
        row = {"answer": text, "score": score, "feedback": feedback,
               "correct": None if score is None else score >= PASS_SCORE,
               "graded_by": "pending" if score is None else "ai"}
    row.update({"user_id": user["id"], "day": day.isoformat(), "question_id": q["id"], "kind": q["kind"],
                "book_id": q["book_id"], "created_at": _now()})
    store.upsert("daily_answers", [row], on_conflict="user_id,day,question_id", ignore=True)
    ensure_translations([q], lang)
    return _public(q, row, lang, (book or {}).get("page_offset") or 0)


@router.get("/daily/history")
def history(days: int = Query(14, ge=1, le=60), lang: str = "ko", user=Depends(accounts.current_user)):
    """지난 문제 (오늘 빼고): 날짜별 문제·내 답·채점."""
    lang = _lang(lang)
    day = today()
    since = (day - timedelta(days=days)).isoformat()
    sets = store.select("daily_sets", {"user_id": f"eq.{user['id']}", "day": f"gte.{since}", "select": "*",
                                       "order": "day.desc"})
    sets = [s for s in sets if s["day"] != day.isoformat()]
    ids = [i for s in sets for i in s.get("question_ids") or []]
    qs = _questions(ids)
    answers = {}
    for r in store.select("daily_answers", {"user_id": f"eq.{user['id']}", "day": f"gte.{since}", "select": "*"}):
        answers[(r["day"], r["question_id"])] = r
    book = textbook.current_book() or {}
    out = []
    for s in sets:
        items = []
        for i in s.get("question_ids") or []:
            q = qs.get(i)
            if not q:
                continue
            a = answers.get((s["day"], i))
            item = _public(q, a or {"answer": None, "correct": None, "score": None, "graded_by": "missed"}, lang,
                           book.get("page_offset") or 0)
            items.append(item)
        out.append({"day": s["day"], "items": items, "done": sum(1 for i in items if i["result"]["graded_by"] != "missed")})
    return {"days": out}


class ReportBody(BaseModel):
    question_id: str
    reason: str = ""


@router.post("/daily/report")
def report_question(body: ReportBody, user=Depends(accounts.current_user)):
    """이상한 문제 신고 → 관리자 문제 은행에 '신고됨'으로 보임."""
    q = _questions([body.question_id]).get(body.question_id) if _is_uuid(body.question_id) else None
    if not q:
        _err(404, "not_found")
    if store.select("question_reports", {"question_id": f"eq.{q['id']}", "user_id": f"eq.{user['id']}", "select": "id"}):
        return {"ok": True}
    store.insert_rows("question_reports", {"question_id": q["id"], "user_id": user["id"], "reason": body.reason.strip()[:300]},
                      returning=False)
    n = len(store.select("question_reports", {"question_id": f"eq.{q['id']}", "select": "id"}))
    store.patch("quiz_questions", {"id": f"eq.{q['id']}"}, {"report_count": n})
    return {"ok": True}


def _is_uuid(v):
    try:
        uuid.UUID(str(v))
        return True
    except ValueError:
        return False


# ---- 관리자: 문제 은행·설정 ----

def quiz_info(book_id):
    rows = store.select("textbooks", {"id": f"eq.{book_id}", "select": "quiz_status,quiz_done,quiz_total,quiz_error"})
    r = rows[0] if rows else {}
    qs = store.select("quiz_questions", {"book_id": f"eq.{book_id}", "select": "kind,status,report_count"})
    return {
        "status": r.get("quiz_status") or "", "done": r.get("quiz_done") or 0, "total": r.get("quiz_total") or 0,
        "error": r.get("quiz_error") or "", "running": _quiz_job["book_id"] == book_id,
        "mc": sum(1 for q in qs if q["kind"] == "mc" and q["status"] == "active"),
        "short": sum(1 for q in qs if q["kind"] == "short" and q["status"] == "active"),
        "hidden": sum(1 for q in qs if q["status"] != "active"),
        "reported": sum(1 for q in qs if (q.get("report_count") or 0) > 0 and q["status"] == "active"),
    }


@router.get("/admin/textbooks/{book_id}/quiz")
def admin_quiz(book_id: str, user=Depends(need_admin)):
    textbook._get(book_id)
    return quiz_info(book_id)


class QuizStart(BaseModel):
    replace: bool = False


@router.post("/admin/textbooks/{book_id}/quiz")
def admin_quiz_start(book_id: str, body: QuizStart, user=Depends(need_admin)):
    """문제 은행 만들기 시작 (이미 문제가 있는 장은 건너뜀, replace 면 모두 새로)."""
    book = textbook._get(book_id)
    if book.get("status") != "ready":
        _err(400, "tb_not_ready")
    if not book_units(book):
        _err(400, "dq_no_toc")
    import report
    if not report.configured():
        _err(503, "ai_not_configured")
    if not _quiz_lock.acquire(blocking=False):
        _err(409, "dq_busy")
    _quiz_job["book_id"] = book["id"]
    _start_quiz_job(book["id"], body.replace)
    return quiz_info(book["id"])


@router.get("/admin/textbooks/{book_id}/questions")
def admin_questions(book_id: str, filter: str = "all", user=Depends(need_admin)):
    book = textbook._get(book_id)
    params = {"book_id": f"eq.{book_id}", "select": QSEL + ",report_count,created_at", "order": "unit_key.asc,created_at.asc"}
    if filter == "reported":
        params["report_count"] = "gt.0"
    elif filter == "hidden":
        params["status"] = "neq.active"
    rows = store.select("quiz_questions", params)
    order = {k: i for i, (k, *_) in enumerate(book_units(book))}
    rows.sort(key=lambda r: (order.get(r["unit_key"], 999), r["kind"] != "mc"))
    reasons = {}
    if filter == "reported" and rows:
        for r in store.select("question_reports", {"question_id": f"in.({','.join(q['id'] for q in rows)})",
                                                   "select": "question_id,reason"}):
            if r.get("reason"):
                reasons.setdefault(r["question_id"], []).append(r["reason"])
    for r in rows:
        r.pop("translations", None)
        r["reasons"] = reasons.get(r["id"], [])
    return {"items": rows, "offset": book.get("page_offset") or 0}


class QuestionEdit(BaseModel):
    question: str | None = None
    choices: list[str] | None = None
    answer: int | None = None
    model_answer: str | None = None
    explanation: str | None = None
    status: str | None = None
    clear_reports: bool = False


@router.put("/admin/questions/{qid}")
def admin_edit_question(qid: str, body: QuestionEdit, user=Depends(need_admin)):
    if not _is_uuid(qid):
        _err(404, "not_found")
    rows = store.select("quiz_questions", {"id": f"eq.{qid}", "select": QSEL})
    if not rows:
        _err(404, "not_found")
    q = rows[0]
    f = {}
    if body.question is not None:
        if not body.question.strip():
            _err(400, "dq_bad_question")
        f["question"] = body.question.strip()[:500]
    if body.choices is not None:
        ch = [c.strip()[:200] for c in body.choices]
        if q["kind"] == "mc" and (len(ch) != 4 or not all(ch)):
            _err(400, "dq_bad_question")
        f["choices"] = ch
    if body.answer is not None:
        if q["kind"] != "mc" or not 0 <= body.answer < 4:
            _err(400, "dq_bad_question")
        f["answer"] = body.answer
    if body.model_answer is not None:
        f["model_answer"] = body.model_answer.strip()[:600]
    if body.explanation is not None:
        f["explanation"] = body.explanation.strip()[:600]
    if body.status is not None:
        if body.status not in ("active", "hidden"):
            _err(400, "dq_bad_question")
        f["status"] = body.status
    if body.clear_reports:
        store.delete("question_reports", {"question_id": f"eq.{qid}"})
        f["report_count"] = 0
    if any(k in f for k in ("question", "choices", "model_answer", "explanation")):
        f["translations"] = {}  # 고친 문제는 다시 번역
    if f:
        store.patch("quiz_questions", {"id": f"eq.{qid}"}, f)
    return {"ok": True}


@router.delete("/admin/questions/{qid}")
def admin_delete_question(qid: str, user=Depends(need_admin)):
    if not _is_uuid(qid):
        _err(404, "not_found")
    store.delete("quiz_questions", {"id": f"eq.{qid}"})
    return {"ok": True}


class DailySettings(BaseModel):
    mc: int
    short: int


@router.get("/admin/daily-settings")
def get_daily_settings(user=Depends(need_admin)):
    return settings()


@router.put("/admin/daily-settings")
def put_daily_settings(body: DailySettings, user=Depends(need_admin)):
    if not (0 <= body.mc <= 5 and 0 <= body.short <= 3 and 1 <= body.mc + body.short <= 6):
        _err(400, "dq_bad_counts")
    _save_setting("daily", {"mc": body.mc, "short": body.short})
    return settings()


# ---- 교사 보드 ----

@router.get("/boards/courses/{cid}/daily")
def board_daily(cid: str, day: str = "", user=Depends(accounts.current_user)):
    """반 교육생별 그날 매일 문제: 푼 수·점수·연속 일수·많이 틀린 장, 반 전체 많이 틀린 장."""
    manage._uuid(cid)
    if not manage.can_view_course(user, cid):
        _err(404, "not_found")
    try:
        d = datetime.strptime(day, "%Y-%m-%d").date() if day else today()
    except ValueError:
        _err(400, "auth_err_bad_date")
    students, _ = manage._students_of(cid)
    students = [s for s in students if s["status"] == "active"]
    book = textbook.current_book() or {}
    titles = {k: t for k, t, *_ in book_units(book)} if book else {}
    cards = []
    class_wrong = {}
    for s in students:
        sets = store.select("daily_sets", {"user_id": f"eq.{s['id']}", "day": f"eq.{d.isoformat()}", "select": "question_ids"})
        total = len(sets[0]["question_ids"]) if sets else settings()["mc"] + settings()["short"]
        ans = list(_answers(s["id"], d).values())
        wrong = _wrong_units(s["id"], book.get("id"))
        for k, n in wrong.items():
            class_wrong[k] = class_wrong.get(k, 0) + n
        weak = sorted(wrong.items(), key=lambda kv: -kv[1])[:2]
        cards.append({
            "id": s["id"], "name": s["name"], "done": len(ans), "total": total,
            "score": sum(a.get("score") or 0 for a in ans), "max_score": 10 * total,
            "pending": sum(1 for a in ans if a.get("graded_by") == "pending"),
            "streak": streak_of(s["id"], d, total),
            "weak": [titles.get(k, k) for k, _ in weak],
        })
    cards.sort(key=lambda c: (c["done"] >= c["total"], c["name"]))
    weak_class = sorted(class_wrong.items(), key=lambda kv: -kv[1])[:5]
    return {
        "day": d.isoformat(), "students": cards,
        "summary": {"count": len(cards), "finished": sum(1 for c in cards if c["done"] >= c["total"])},
        "weak_units": [{"title": titles.get(k, k), "wrong": n} for k, n in weak_class],
    }


@router.get("/daily/student/{uid}")
def student_daily(uid: str, day: str = "", user=Depends(accounts.current_user)):
    """교사: 교육생 한 명의 그날 문제·답·채점 (주관식 점수 고치기용)."""
    manage._uuid(uid)
    if user["role"] == "student" or not manage.can_view_student(user, uid):
        _err(404, "not_found")
    try:
        d = datetime.strptime(day, "%Y-%m-%d").date() if day else today()
    except ValueError:
        _err(400, "auth_err_bad_date")
    sets = store.select("daily_sets", {"user_id": f"eq.{uid}", "day": f"eq.{d.isoformat()}", "select": "question_ids"})
    ids = sets[0]["question_ids"] if sets else []
    qs = _questions(ids)
    ans = _answers(uid, d)
    book = textbook.current_book() or {}
    items = []
    for i in ids:
        if i in qs:
            a = ans.get(i)
            items.append(_public(qs[i], a or {"answer": None, "correct": None, "score": None, "graded_by": "missed"}, "ko",
                                 book.get("page_offset") or 0))
    return {"day": d.isoformat(), "items": items}


class ScoreBody(BaseModel):
    score: int


@router.put("/daily/student/{uid}/{day}/{qid}")
def set_score(uid: str, day: str, qid: str, body: ScoreBody, user=Depends(accounts.current_user)):
    """교사가 주관식 점수 고치기 (0~10)."""
    manage._uuid(uid)
    if user["role"] == "student" or not manage.can_view_student(user, uid):
        _err(404, "not_found")
    if not 0 <= body.score <= 10:
        _err(400, "dq_bad_score")
    rows = store.select("daily_answers", {"user_id": f"eq.{uid}", "day": f"eq.{day}", "question_id": f"eq.{qid}", "select": "kind"})
    if not rows or rows[0]["kind"] != "short":
        _err(404, "not_found")
    store.patch("daily_answers", {"user_id": f"eq.{uid}", "day": f"eq.{day}", "question_id": f"eq.{qid}"},
                {"score": body.score, "correct": body.score >= PASS_SCORE, "graded_by": "teacher"})
    return {"ok": True}
