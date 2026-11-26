"""T3(이론): AI 학습 보조 '웰디'와 대화.

- 교육생·교사가 말(자판 받아쓰기)이나 글로 물으면, 지금 쓰는 교재의 글자에서 관련 쪽을 찾아
  그 쪽만 AI 에게 주고 "교재에 있는 내용으로만" 짧게 답하게 한다. 근거 쪽 번호를 같이 돌려준다.
- "3장 보여줘", "120쪽 열어줘" → 교재 쪽 열기, "문제 내줘" → 문제 은행에서 OX·객관식 1개. (AI 없이 바로)
- 교재에 없는 용접 질문은 '교재 밖'으로 표시하고 짧게, 용접과 관계없는 질문은 정중히 거절.
- 교육생은 하루 AI 질문 수 한도 (관리자 운영 설정 tutor_daily_limit, 기본 50). 교사·관리자는 한도 없음.
- 기록: tutor_messages (질문·답·근거 쪽·장), tutor_answers (대화 중 푼 문제). 교사 화면은 T4 에서.
"""
import random
import re
import threading
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import accounts
import daily
import scoring
import store
import textbook
from admin_settings import need_admin

router = APIRouter()
DEFAULT_LIMIT = 50
PICK_PAGES = 5            # AI 에게 주는 쪽 수
PAGE_CHARS = 1800         # 쪽 하나에서 주는 글자 수
HISTORY = 3               # 앞 대화 몇 개를 같이 주나
QUIZ_KINDS = ("ox", "mc")  # 말로 풀기 쉬운 종류만

_cache_lock = threading.Lock()
_cache = {}  # book_id → (updated_at, {page: text}, 색인)


def _err(status, code, **extra):
    raise HTTPException(status, {"code": code, **extra})


def _now():
    return datetime.now(timezone.utc).isoformat()


def daily_limit():
    try:
        return max(0, int(scoring.criteria().get("tutor_daily_limit", DEFAULT_LIMIT)))
    except (TypeError, ValueError):
        return DEFAULT_LIMIT


# ---- 교재 글자 찾기 ----

HANGUL = re.compile(r"[가-힣]+")
LATIN = re.compile(r"[a-z][a-z0-9\-]+|\d+(?:\.\d+)?")


def terms(text):
    """찾기용 낱말: 한글은 두 글자씩 (조사가 붙어도 맞게), 영어·숫자는 낱말 그대로."""
    t = (text or "").lower()
    out = []
    for w in HANGUL.findall(t):
        out += [w] if len(w) == 1 else [w[i:i + 2] for i in range(len(w) - 1)]
    out += [w for w in LATIN.findall(t) if len(w) >= 2]
    return out


def _index(book):
    """교재 쪽 글자와 낱말 색인 (교재가 바뀌면 다시 만든다)."""
    key = book.get("updated_at") or ""
    with _cache_lock:
        hit = _cache.get(book["id"])
        if hit and hit[0] == key:
            return hit[1], hit[2]
    rows = store.select("textbook_pages", {"book_id": f"eq.{book['id']}", "select": "page,text", "order": "page.asc"})
    texts = {r["page"]: (r.get("text") or "").strip() for r in rows}
    tf = {p: {} for p in texts}
    df = {}
    for p, txt in texts.items():
        for w in terms(txt):
            tf[p][w] = tf[p].get(w, 0) + 1
        for w in tf[p]:
            df[w] = df.get(w, 0) + 1
    idx = {"tf": tf, "df": df, "n": max(1, len(texts))}
    with _cache_lock:
        _cache[book["id"]] = (key, texts, idx)
    return texts, idx


def find_pages(book, query, near=None, k=PICK_PAGES):
    """질문과 낱말이 많이 겹치는 쪽 → [PDF 쪽]. near=(시작, 끝) 이면 그 장 쪽을 조금 더 쳐준다."""
    import math
    texts, idx = _index(book)
    q = set(terms(query))
    if not q:
        return []
    n = idx["n"]
    scores = []
    for p, tf in idx["tf"].items():
        s = 0.0
        for w in q:
            c = tf.get(w)
            if c:
                s += math.log(1 + n / idx["df"][w]) * (1 + math.log(c))
        if s and near and near[0] <= p <= near[1]:
            s *= 1.3
        if s:
            scores.append((s, p))
    scores.sort(reverse=True)
    if not scores:
        return []
    best = scores[0][0]
    return sorted(p for s, p in scores[:k] if s >= best * 0.35)


# ---- AI 없이 바로 알아듣는 말 ----

NUM = r"(\d{1,4})"
PAGE_RE = re.compile(
    NUM + r"\s*(?:쪽|페이지|면)|(?:p\.?|page|pages|hal\.?|halaman|trang|หน้า|página|pagina|pahina|bet)\s*" + NUM
    + r"|" + NUM + r"\s*-?\s*(?:bet|sahifa)", re.I)
CHAPTER_RE = re.compile(
    r"제?\s*" + NUM + r"\s*장|(?:chapter|ch\.|bab|chương|capítulo|capitulo|kabanata|บทที่|บท)\s*" + NUM
    + r"|" + NUM + r"\s*-?\s*bob", re.I)
PART_RE = re.compile(r"제?\s*" + NUM + r"\s*편|(?:part|bagian|phần|parte|bahagi|ภาค)\s*" + NUM, re.I)
OPEN_RE = re.compile(
    r"보여|열어|펴|펼쳐|가\s*줘|이동|띄워|show|open|go\s*to|take\s*me|buka|lihat|tampilkan|mở|xem|ochib|ko.rsat|och\b"
    r"|abre|abrir|muestra|mostrar|ver\b|ipakita|buksan|เปิด|ดู|ไปที่", re.I)
QUIZ_RE = re.compile(
    r"(?:문제|퀴즈)\s*(?:를|을|좀|하나|한\s*개|몇\s*개|도|\d+\s*개)?\s*(?:좀\s*)?(?:내|낼|풀|출제)|퀴즈|quiz|test\s*me|ask\s*me|soal|kuis|tes\s*aku|uji\s*aku|đố|kiểm\s*tra"
    r"|savol\s*ber|test\s*qil|pregúntame|preguntame|hazme\s*una\s*pregunta|examíname|tanungin\s*mo\s*ako"
    r"|ทดสอบ|ถามคำถาม", re.I)


def _num(m):
    return int(next(g for g in m.groups() if g))


def _flat_chapters(toc):
    return [(pi, ci, ch) for pi, part in enumerate(toc) for ci, ch in enumerate(part.get("chapters") or [])]


def find_chapter(toc, n):
    """'3장' → (편 번호, 장 번호, 장). 제목이 '제3장'·'3장'·'Chapter 3' 으로 시작하는 장, 없으면 n번째 장."""
    pat = re.compile(rf"^\s*(?:제\s*0*{n}\s*장|0*{n}\s*장|(?:chapter|ch\.?)\s*0*{n}\b|0*{n}[\.\s])", re.I)
    chs = _flat_chapters(toc)
    for pi, ci, ch in chs:
        if pat.match(ch.get("title") or ""):
            return pi, ci, ch
    return chs[n - 1] if 1 <= n <= len(chs) else None


def find_part(toc, n):
    pat = re.compile(rf"^\s*(?:제\s*0*{n}\s*편|0*{n}\s*편|part\s*0*{n}\b)", re.I)
    for pi, part in enumerate(toc):
        if pat.match(part.get("title") or ""):
            return pi, part
    return (n - 1, toc[n - 1]) if 1 <= n <= len(toc) else None


def parse(text, toc, offset, pages):
    """→ {"page": PDF 쪽|None, "title": 제목, "range": (시작, 끝)|None, "open": bool, "quiz": bool}"""
    t = text.strip()
    out = {"page": None, "title": "", "range": None, "open": False, "quiz": bool(QUIZ_RE.search(t))}
    units = {(pi, ci): (s, e) for pi, ci, s, e in textbook.units(toc, offset, pages)}
    m = PAGE_RE.search(t)
    mc = CHAPTER_RE.search(t)
    mp = PART_RE.search(t)
    rest = t
    if m:
        printed = _num(m)
        pdf = printed + offset
        if 1 <= pdf <= pages:
            out["page"] = pdf
            out["title"] = f"p.{printed}"
        rest = rest.replace(m.group(0), "")
    elif mc:
        hit = find_chapter(toc, _num(mc))
        if hit:
            pi, ci, ch = hit
            out["title"] = ch.get("title") or ""
            out["range"] = units.get((pi, ci))
            if ch.get("page") is not None:
                out["page"] = ch["page"] + offset
            elif out["range"]:
                out["page"] = out["range"][0]
        rest = rest.replace(mc.group(0), "")
    elif mp:
        hit = find_part(toc, _num(mp))
        if hit:
            pi, part = hit
            out["title"] = part.get("title") or ""
            rs = [v for (a, _), v in units.items() if a == pi]
            out["range"] = (min(r[0] for r in rs), max(r[1] for r in rs)) if rs else None
            if part.get("page") is not None:
                out["page"] = part["page"] + offset
            elif out["range"]:
                out["page"] = out["range"][0]
        rest = rest.replace(mp.group(0), "")
    if out["page"] and not out["quiz"]:
        # "3장 보여줘" 또는 "120쪽" 만 말하면 열기. "3장에서 ○○가 뭐야?" 는 질문 (그 장을 먼저 찾아본다)
        bare = re.sub(r"[\s\W_]|요$|좀|이요", "", rest)
        out["open"] = bool(OPEN_RE.search(t)) or len(bare) <= 2
    return out


def unit_of(book, page):
    for key, title, s, e in daily.book_units(book):
        if s <= page <= e:
            return key, title, (s, e)
    return None, "", None


# ---- 대화 중 문제 ----

def pick_quiz(user, book, rng=random, unit_range=None):
    pool = store.select("quiz_questions", {"book_id": f"eq.{book['id']}", "status": "eq.active",
                                           "kind": f"in.({','.join(QUIZ_KINDS)})", "select": daily.QSEL})
    if not pool:
        return None
    try:
        recent = {r["question_id"] for r in store.select("tutor_answers", {
            "user_id": f"eq.{user['id']}", "select": "question_id", "order": "created_at.desc", "limit": "40"})}
    except Exception:  # noqa: BLE001  (step9 SQL 전)
        recent = set()
    cands = pool
    if unit_range:
        inside = [q for q in pool if q.get("page") and unit_range[0] <= q["page"] <= unit_range[1]]
        cands = inside or pool
    fresh = [q for q in cands if q["id"] not in recent]
    cands = fresh or cands
    if not unit_range:  # 범위를 안 말했으면 많이 틀린 장 쪽으로
        wrong = daily._wrong_units(user["id"], book["id"])
        if wrong:
            weak = [q for q in cands if wrong.get(q.get("unit_key"), 0) > 0]
            if weak and rng.random() < 0.6:
                cands = weak
    return rng.choice(cands)


# ---- AI ----

TUTOR_SYSTEM = """You are Weldy (웰디), a friendly study buddy inside a welding training app at a Korean vocational training institute.
Trainees and teachers talk to you by voice; your reply is read aloud by a phone voice and shown as a subtitle.
Rules:
- Reply in {lang}. 2 to 4 short spoken sentences. No markdown, no lists, no emoji, no URLs.
  Inside the "reply" text never use the double-quote character; use 「 」 or ' ' instead.
- Base the answer on the TEXTBOOK EXCERPTS (scanned text, may be noisy). Each excerpt starts with its printed page like [p.123].
  Put the printed page numbers you actually used in "pages".
- If the excerpts do not cover it but it is about welding or the trainee's study, answer briefly from general welding knowledge,
  say it is not in the textbook, and set "outside": true with "pages": [].
- If it is not about welding, safety or studying, politely decline in one sentence, steer back to studying, and set "offtopic": true.
- If the trainee asks to see a page or chapter, set "open_page" to that printed page number. If they ask you to quiz them, set "quiz": true.
- Keep technical terms (GTAW, SMAW, HAZ...) as they are. Be warm and encouraging. Call yourself Weldy (웰디) only if asked.
Reply with ONLY: {{"reply":"","pages":[],"outside":false,"offtopic":false,"open_page":null,"quiz":false}}"""

KEYWORDS_SYSTEM = """Turn a welding trainee's question (any language) into Korean search words for a Korean welding textbook.
Give 3-8 Korean technical words (and English abbreviations like GTAW if useful), separated by spaces.
Reply with ONLY: {"words":""}"""


def korean_query(text):
    """한국어가 아닌 질문은 한국어 찾기 낱말로 바꿔서 교재를 찾는다 (실패하면 원래 글)."""
    import report
    if HANGUL.search(text):  # 한글이 있으면 그대로 (GTAW 처럼 영어가 섞여도)
        return text
    try:
        out = daily._ask(report.model_name(), KEYWORDS_SYSTEM, text[:500], 200, timeout=30)
        return f"{text} {out.get('words') or ''}"
    except Exception as e:  # noqa: BLE001
        print("[tutor] 찾기 낱말 실패", str(e)[:160], flush=True)
        return text


class TutorError(Exception):
    """대답을 못 만든 이유 (앱이 이유를 말해 준다): key busy timeout network pages refusal config other"""

    def __init__(self, code, detail=""):
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


FAIL_CODES = ("key", "busy", "timeout", "network", "pages", "refusal", "config", "other")


def call_ai(system, prompt, max_tokens, timeout=45):
    """Claude 에게 묻고 글자를 돌려받는다. 잠깐 바쁘거나 끊기면 한 번 더 해 본다."""
    import report
    if not report.configured():
        raise TutorError("config")
    anthropic, client = daily._client(timeout)
    last = "other"
    for attempt in range(2):
        try:
            resp = client.beta.messages.create(
                model=report.model_name(),
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": prompt}],
            )
            break
        except anthropic.AuthenticationError as e:
            raise TutorError("key", str(e)[:160])
        except anthropic.RateLimitError:
            last = "busy"
        except anthropic.APITimeoutError:
            last = "timeout"
        except anthropic.APIConnectionError:
            last = "network"
        except anthropic.APIStatusError as e:
            if e.status_code in (500, 502, 503, 504, 529):
                last = "busy"
            else:
                raise TutorError("other", f"{e.status_code} {str(e)[:160]}")
        if attempt == 0:
            time.sleep(1.5)
    else:
        raise TutorError(last)
    if resp.stop_reason == "refusal":
        raise TutorError("refusal")
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def read_reply(text):
    """AI 대답 → dict. JSON 모양이 아니거나 중간에 끊겨도 글자가 있으면 그 글자를 대답으로 쓴다."""
    out = daily.parse_json(text)
    if out is not None and str(out.get("reply") or "").strip():
        return out
    # JSON 이 깨졌으면 (대답 안에 따옴표가 그대로 있거나 중간에 끊김) "reply": "…" 부분만 꺼낸다
    m = re.search(r'"reply"\s*:\s*"(.*?)"\s*(?:,\s*"(?:pages|outside|offtopic|open_page|quiz)"|}\s*$)', text or "", re.S)
    v = m.group(1) if m else None
    if v is None:
        m = re.search(r'"reply"\s*:\s*"(.*)', text or "", re.S)  # 끊긴 경우
        v = m.group(1).rstrip('"} \n') if m else None
    if v is not None:
        pm = re.search(r'"pages"\s*:\s*\[([\d,\s]*)\]', text or "")
        pages = [int(x) for x in re.findall(r"\d+", pm.group(1))] if pm else []
        return {"reply": v.replace('\\"', '"').replace("\\n", " "), "pages": pages}
    plain = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", (text or "").strip())
    plain = re.sub(r"[{}]", "", plain).strip() if plain.startswith("{") else plain
    return {"reply": plain}


def ask_ai(book, text, lang, history, near):
    offset = book.get("page_offset") or 0
    try:
        texts, _ = _index(book)
    except Exception as e:  # noqa: BLE001
        raise TutorError("pages", str(e)[:160])
    pages = find_pages(book, korean_query(text), near)
    excerpts = "\n\n".join(f"[p.{p - offset}]\n{texts.get(p, '')[:PAGE_CHARS]}" for p in pages) or "(no matching pages)"
    hist = "\n".join(f"Trainee: {h.q}\nWeldy: {h.a}" for h in history[-HISTORY:] if h.q or h.a)
    prompt = (f"TEXTBOOK EXCERPTS:\n{excerpts}\n\n"
              + (f"RECENT CONVERSATION:\n{hist}\n\n" if hist else "")
              + f"TRAINEE NOW SAYS:\n{text}")
    raw = call_ai(TUTOR_SYSTEM.format(lang=daily.LANG_NAMES.get(lang, "Korean")), prompt, 1200)
    out = read_reply(raw)
    reply = re.sub(r"[*#`>]+", "", str(out.get("reply") or "")).strip()[:800]
    if not reply:
        raise TutorError("other", "empty reply")
    used = []
    for v in out.get("pages") or []:
        try:
            pdf = int(v) + offset
        except (TypeError, ValueError):
            continue
        if pdf in texts and pdf not in used:
            used.append(pdf)
    op = out.get("open_page")
    try:
        op = int(op) + offset if op not in (None, "", False) else None
    except (TypeError, ValueError):
        op = None
    return {"reply": reply, "pages": used[:4], "outside": bool(out.get("outside")) and not used,
            "offtopic": bool(out.get("offtopic")), "open": op if op and 1 <= op <= (book.get("pages") or 0) else None,
            "quiz": bool(out.get("quiz"))}


# ---- API ----

class Turn(BaseModel):
    q: str = ""
    a: str = ""


class AskBody(BaseModel):
    text: str
    lang: str = "ko"
    page: int | None = None          # 교재 보다가 물었으면 그 PDF 쪽
    history: list[Turn] = []


def _used_today(user):
    start = datetime.now(timezone.utc).astimezone(daily.KST).replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        return len(store.select("tutor_messages", {"user_id": f"eq.{user['id']}", "ai": "is.true",
                                                   "created_at": f"gte.{start.astimezone(timezone.utc).isoformat()}",
                                                   "select": "id"}))
    except Exception:  # noqa: BLE001
        return 0


def _save(row):
    try:
        return store.insert_rows("tutor_messages", row)[0]["id"]
    except Exception as e:  # noqa: BLE001  (step9 SQL 전이면 기록만 빠진다)
        print("[tutor] 기록 실패", str(e)[:160], flush=True)
        return None


def _pages_out(pages, offset):
    return [{"page": p, "printed": p - offset} for p in pages]


@router.post("/tutor/ask")
def ask(body: AskBody, user=Depends(accounts.current_user)):
    import report
    lang = daily._lang(body.lang)
    text = body.text.strip()[:500]
    if not text:
        _err(400, "tutor_empty")
    book = textbook.current_book()
    base = {"id": None, "reply": "", "key": None, "params": {}, "pages": [], "outside": False, "open": None,
            "quiz": None, "book_id": book["id"] if book else None, "left": None}
    if not book:
        return {**base, "key": "tutor_noBook"}
    if not textbook.can_view(user, book):
        return {**base, "key": "tutor_hidden"}
    pages = book.get("pages") or 0
    offset = book.get("page_offset") or 0
    toc = textbook.clean_toc(book.get("toc"), pages, offset)
    intent = parse(text, toc, offset, pages)
    ctx_page = body.page if body.page and 1 <= body.page <= pages else None
    near = intent["range"] or (unit_of(book, ctx_page)[2] if ctx_page else None)
    row = {"id": str(uuid.uuid4()), "user_id": user["id"], "book_id": book["id"], "lang": lang, "question": text,
           "answer": "", "pages": [], "unit_key": None, "ai": False, "kind": "", "created_at": _now()}

    def done(out, kind, unit_page=None):
        row["kind"] = kind
        if unit_page:
            row["unit_key"] = unit_of(book, unit_page)[0]
        out["id"] = _save(row)
        return out

    # 1) 쪽·장 열기
    if intent["open"] and intent["page"]:
        out = {**base, "key": "tutor_open", "params": {"title": intent["title"]},
               "open": {"page": intent["page"], "printed": intent["page"] - offset}}
        row["answer"] = f"open {intent['page']}"
        row["pages"] = [intent["page"]]
        return done(out, "open", intent["page"])
    # 2) 문제 내기
    if intent["quiz"]:
        q = pick_quiz(user, book, unit_range=intent["range"] or (near if ctx_page else None))
        if not q:
            return done({**base, "key": "tutor_noQuiz"}, "quiz")
        daily.ensure_translations([q], lang)
        item = daily._public(q, None, lang, offset)
        row["answer"] = f"quiz {q['id']}"
        row["pages"] = [q["page"]] if q.get("page") else []
        return done({**base, "key": "tutor_quiz", "params": {"title": q.get("unit_title") or ""}, "quiz": item},
                    "quiz", q.get("page"))
    # 3) AI 설명
    if not book.get("use_for_ai", True):
        return done({**base, "key": "tutor_aiOff"}, "blocked")
    if not report.configured():
        row["answer"] = "error: config"
        return done({**base, "key": "tutor_fail_config"}, "failed")
    limit = daily_limit()
    left = None
    if user["role"] == "student":
        used = _used_today(user)
        if used >= limit:
            return done({**base, "key": "tutor_limit", "params": {"n": limit}, "left": 0}, "limit")
        left = limit - used - 1
    try:
        ai = ask_ai(book, text, lang, body.history, near)
    except TutorError as e:
        code, detail = e.code, e.detail
    except Exception as e:  # noqa: BLE001
        code, detail = "other", f"{type(e).__name__} {str(e)[:160]}"
    else:
        code = None
    if code:
        print("[tutor] AI 실패", code, detail, flush=True)
        row["answer"] = f"error: {code} {detail}"[:500]
        return done({**base, "key": f"tutor_fail_{code}", "params": {"code": (detail or code)[:80]},
                     "left": None if left is None else left + 1}, "failed")
    row.update(answer=ai["reply"], pages=ai["pages"], ai=True)
    out = {**base, "reply": ai["reply"], "pages": _pages_out(ai["pages"], offset), "outside": ai["outside"], "left": left}
    if ai["open"]:
        out["open"] = {"page": ai["open"], "printed": ai["open"] - offset}
    if ai["quiz"]:
        q = pick_quiz(user, book, unit_range=near)
        if q:
            daily.ensure_translations([q], lang)
            out["quiz"] = daily._public(q, None, lang, offset)
    kind = "offtopic" if ai["offtopic"] else "outside" if ai["outside"] else "explain"
    return done(out, kind, (ai["pages"] or [None])[0] or ctx_page)


class QuizAnswer(BaseModel):
    question_id: str
    answer: int
    lang: str = "ko"


@router.post("/tutor/quiz")
def quiz_answer(body: QuizAnswer, user=Depends(accounts.current_user)):
    """대화 중 문제 채점 (연습용: 매일 문제 점수·연속 일수에는 안 들어감)."""
    lang = daily._lang(body.lang)
    try:
        uuid.UUID(body.question_id)
    except ValueError:
        _err(404, "not_found")
    q = daily._questions([body.question_id]).get(body.question_id)
    if not q or q["kind"] not in QUIZ_KINDS:
        _err(404, "not_found")
    if not 0 <= body.answer < (4 if q["kind"] == "mc" else 2):
        _err(400, "dq_bad_answer")
    correct = body.answer == q.get("answer")
    a = {"answer": str(body.answer), "correct": correct, "score": 10 if correct else 0, "feedback": "", "graded_by": "auto"}
    try:
        store.insert_rows("tutor_answers", {"user_id": user["id"], "book_id": q["book_id"], "question_id": q["id"],
                                            "unit_key": q.get("unit_key"), "kind": q["kind"], "answer": body.answer,
                                            "correct": correct, "created_at": _now()})
    except Exception as e:  # noqa: BLE001
        print("[tutor] 문제 기록 실패", str(e)[:160], flush=True)
    book = textbook.current_book()
    daily.ensure_translations([q], lang)
    return daily._public(q, a, lang, (book or {}).get("page_offset") or 0)


class ReportBody(BaseModel):
    message_id: str
    note: str = ""


@router.post("/tutor/report")
def report_answer(body: ReportBody, user=Depends(accounts.current_user)):
    """'답이 이상해요' 신고 → 관리자가 모아 본다."""
    try:
        uuid.UUID(body.message_id)
    except ValueError:
        _err(404, "not_found")
    rows = store.select("tutor_messages", {"id": f"eq.{body.message_id}", "user_id": f"eq.{user['id']}", "select": "id"})
    if not rows:
        _err(404, "not_found")
    store.patch("tutor_messages", {"id": f"eq.{body.message_id}"},
                {"reported": True, "report_note": body.note.strip()[:300], "reported_at": _now()})
    return {"ok": True}


@router.get("/admin/tutor/reports")
def list_reports(user=Depends(need_admin)):
    rows = store.select("tutor_messages", {"reported": "is.true", "select": "id,user_id,question,answer,pages,report_note,reported_at,lang",
                                           "order": "reported_at.desc", "limit": "200"})
    names = {}
    ids = sorted({r["user_id"] for r in rows if r.get("user_id")})
    if ids:
        names = {u["id"]: u["name"] for u in store.select("users", {"id": f"in.({','.join(ids)})", "select": "id,name"})}
    book = textbook.current_book()
    offset = (book or {}).get("page_offset") or 0
    return {"items": [{**r, "name": names.get(r.get("user_id"), ""), "printed": [p - offset for p in (r.get("pages") or [])]}
                      for r in rows]}


@router.delete("/admin/tutor/reports/{mid}")
def clear_report(mid: str, user=Depends(need_admin)):
    """확인한 신고 지우기 (대화 기록은 남김)."""
    try:
        uuid.UUID(mid)
    except ValueError:
        _err(404, "not_found")
    store.patch("tutor_messages", {"id": f"eq.{mid}"}, {"reported": False})
    return {"ok": True}

