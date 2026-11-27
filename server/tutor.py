"""T3(이론): AI 학습 보조 '웰디'와 대화.

- 교육생·교사가 말(음성 입력)이나 글로 물으면, 지금 쓰는 교재의 글자에서 관련 쪽을 찾아
  그 쪽만 AI 에게 주고 "교재에 있는 내용으로" 짧게 답하게 한다. 근거 쪽 번호를 같이 돌려준다.
- 대답은 AI 가 쓰는 대로 흘려 보낸다 (/tutor/ask/stream). 앱은 첫 문장이 오면 바로 말하기 시작한다.
- 같은 질문(같은 교재·같은 언어, 거의 같은 말)은 전에 한 대답을 바로 준다 (AI 안 부름, 하루 한도에 안 셈).
  신고된 대답, 교재를 바꾸기 전의 대답, 꼬리 질문("그건 왜?")에는 쓰지 않는다.
- 꼬리 질문은 앞 질문과 합쳐서 교재를 찾고 앞 대답의 쪽도 다시 준다. "이해 안 돼"·"더 쉽게"면 더 쉽게 비유로 다시.
- "3장 보여줘", "120쪽 열어줘", "그 페이지 펼쳐줘"(바로 전 대답의 첫 쪽) → 교재 쪽 열기. (AI 없이 바로)
- "277쪽에서 객관식 문제 만들어 줘" → 그 쪽(앞뒤 1쪽) 문제가 은행에 있으면 바로, 없거나 "새 문제"면
  그 쪽 글로 AI 가 1개 만들어 문제 은행에 넣는다 (source='tutor'). 매일 문제·게임에도 쓰인다.
- 교재에 없는 용접 질문은 '교재 밖'으로 표시하고 짧게, 용접과 관계없는 질문은 정중히 거절.
- 교육생은 하루 AI 사용 수 한도 (관리자 운영 설정 tutor_daily_limit, 기본 50). 교사·관리자는 한도 없음.
- 기록: tutor_messages (질문·답·근거 쪽·장, 저장된 답이면 cache_of), tutor_answers (대화 중 푼 문제).
"""
import json
import math
import random
import re
import threading
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
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
HISTORY = 5               # 앞 대화 몇 개를 같이 주나
QUIZ_KINDS = ("ox", "mc", "word")  # 대화에서 내는 종류 (화면에서 바로 채점)
QUIZ_TEXT_MAX = 6000      # 문제 만들 때 AI 에게 주는 글자 수
QUIZ_TEXT_MIN = 80        # 쪽 글자가 이보다 적으면 (그림만 있는 쪽) 문제를 못 만든다
CACHE_SIM = 0.9           # 이만큼 겹치면 같은 질문
CACHE_TTL = 600           # 저장된 답 목록을 다시 읽는 간격 (초)
CACHE_ROWS = 2000

_cache_lock = threading.Lock()
_cache = {}    # book_id → (updated_at, {page: text}, 색인)
_answers = {}  # (book_id, lang) → {"at": 읽은 시각, "key": 교재 updated_at, "items": [저장된 답]}
_words = {}    # 외국어 질문 → 한국어 찾기 낱말


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


def find_pages(book, query, near=None, k=PICK_PAGES, ranked=False):
    """질문과 낱말이 많이 겹치는 쪽 → [PDF 쪽]. near=(시작, 끝) 이면 그 장 쪽을 조금 더 쳐준다. ranked 면 잘 맞는 순."""
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
    top = [p for s, p in scores[:k] if s >= best * 0.35]
    return top if ranked else sorted(top)


# ---- 근거 확인 (근거 없는 말 막기) ----

def key_terms(book, text, limit=12):
    """찾기 낱말 중 교재에서 드문 낱말 (흔한 낱말 '용접'·'하는' 등은 뺀다) — 잘 구별되는 순."""
    _, idx = _index(book)
    n = idx["n"]
    ws = {w for w in terms(text) if w in idx["df"]}
    rare = [w for w in ws if idx["df"][w] <= max(2, n * 0.25)]
    rare.sort(key=lambda w: idx["df"][w])
    return rare[:limit]


def page_has(book, page, words, need=0.5):
    """그 쪽 글에 낱말이 need 비율 이상 들어 있나."""
    if not words:
        return False
    _, idx = _index(book)
    tf = idx["tf"].get(page) or {}
    hit = sum(1 for w in words if w in tf)
    return hit >= max(1, math.ceil(len(words) * need))


def verified(book, pages, reply, given):
    """AI 가 근거라고 한 쪽 중 실제로 준 쪽이고, 대답의 드문 낱말이 그 쪽에 들어 있는 쪽만."""
    words = key_terms(book, reply, 16)
    out = []
    for p in pages:
        if p in given and p not in out and page_has(book, p, words, 0.3 if len(words) >= 4 else 0.5):
            out.append(p)
    return out


def mentions(book, query, near=None):
    """교재 전체에서 그 주제가 실제로 나오는 쪽 (드문 낱말이 절반 넘게 들어 있는 쪽), 잘 맞는 순으로 최대 4쪽."""
    words = key_terms(book, query, 8)
    if not words:
        return []
    return [p for p in find_pages(book, query, near, k=8, ranked=True) if page_has(book, p, words, 0.5)][:4]


# 교육생이 따지는 말 ("이 페이지에 없잖아", "교재에 없어?", "틀렸어")
META_RE = re.compile(
    r"없잖|없는데|안\s*나와|안\s*나오|없어\?|없냐|없나요|없어요\?|틀렸|틀린|아닌데|아니잖|엉뚱|상관\s*없|관련\s*(?:된|있는|없)|거짓|맞아\?|맞나요|정말|진짜"
    r"|not\s+(?:there|in|on)|wrong|isn'?t|doesn'?t|really\?|are\s+you\s+sure|sai\s+rồi|không\s+có|salah|tidak\s+ada|noto'?g'?ri|yo'?q|incorrect|no\s+está|mali|wala|ผิด|ไม่มี", re.I)


def topic_of(history):
    """대화 주제: 앞 대화에서 꼬리 질문이 아닌 마지막 질문."""
    for h in reversed(history or []):
        q = (h.q or "").strip()
        if q and not FOLLOW_RE.search(q) and not META_RE.search(q) and len(norm_q(q)) >= 5:
            return q
    return ""


# ---- 같은 질문 알아보기 ----

ENDINGS = re.compile(r"(?:입니까|인가요|인가|일까요|일까|이에요|에요|예요|이야|이죠|인지|나요|니까|까요|어요|아요|야|요|니|냐|죠|지|까)+$")


def norm_q(text):
    """'보호 가스가 뭐예요?' → '보호가스가뭐' (띄어쓰기·문장부호·말끝 없이)."""
    t = re.sub(r"[\s\W_]+", "", (text or "").lower())
    t = re.sub(r"(?:무엇|뭔가|뭐)(?:인가요|입니까|이에요|예요|에요|야|지|죠|니)?$", "뭐", t)
    return ENDINGS.sub("", t) or t


def _grams(t):
    return {t[i:i + 2] for i in range(len(t) - 1)} if len(t) > 1 else {t}


def similar(a, b):
    """두 질문이 얼마나 같은지 0~1 (두 글자 묶음이 겹치는 정도)."""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ga, gb = _grams(a), _grams(b)
    return 2 * len(ga & gb) / (len(ga) + len(gb))


# 앞 대화에 기대는 말 (꼬리 질문) → 저장된 답을 안 쓰고, 찾기도 앞 질문과 합쳐서
FOLLOW_RE = re.compile(
    r"^\s*(?:그럼|그러면|그건|그게|그거|그것|그래서|그런데|근데|왜요?|이건|이게|저건|그\s*다음|아까|방금|then|so\b|why\b|and\b|what about|how about)"
    r"|이해(?:가|를)?\s*(?:안|못)|모르겠|못\s*알아|다시\s*(?:말|설명|한\s*번)|더\s*(?:쉽|자세|간단|천천)|쉽게|예를|예시|비유"
    r"|don'?t\s+(?:understand|get)|simpler|explain\s+again|example|again\b|more\s+detail"
    r"|không\s*hiểu|ví\s*dụ|tidak\s*(?:paham|mengerti)|contoh|tushunmadim|misol|no\s+entiendo|ejemplo|hindi\s+ko\s+maintindihan|halimbawa"
    r"|ไม่เข้าใจ|ตัวอย่าง", re.I)
CONFUSED_RE = re.compile(
    r"이해(?:가|를)?\s*(?:안|못)|모르겠|못\s*알아|더\s*쉽|쉽게|다시\s*(?:말|설명)|don'?t\s+(?:understand|get)|simpler|explain\s+again"
    r"|không\s*hiểu|tidak\s*(?:paham|mengerti)|tushunmadim|no\s+entiendo|hindi\s+ko\s+maintindihan|ไม่เข้าใจ", re.I)


def is_follow(text, history):
    """앞 대화가 있고, 앞 말에 기대는 질문이면 True."""
    if not history:
        return False
    return bool(FOLLOW_RE.search(text)) or len(norm_q(text)) < 6


def _cached_rows(book, lang):
    """이 교재·언어로 AI 가 한 대답 중 다시 써도 되는 것 (신고 안 됨, 교재 바꾼 뒤)."""
    params = {"book_id": f"eq.{book['id']}", "lang": f"eq.{lang}", "ai": "is.true", "reported": "is.false",
              "kind": "in.(explain,outside)", "select": "id,question,answer,pages,kind,created_at",
              "order": "created_at.desc", "limit": str(CACHE_ROWS)}
    if book.get("updated_at"):
        params["created_at"] = f"gte.{book['updated_at']}"
    rows = store.select("tutor_messages", params)
    try:  # 저장된 답을 받은 사람이 신고했으면 원래 답도 안 쓴다
        bad = {r["cache_of"] for r in store.select("tutor_messages", {
            "book_id": f"eq.{book['id']}", "reported": "is.true", "select": "cache_of"}) if r.get("cache_of")}
    except Exception:  # noqa: BLE001  (step10 SQL 전)
        bad = set()
    return [{"id": r["id"], "norm": norm_q(r["question"]), "answer": r["answer"], "pages": r.get("pages") or [],
             "outside": r.get("kind") == "outside"} for r in rows if r["id"] not in bad and (r.get("answer") or "").strip()]


def cache_find(book, lang, text):
    n = norm_q(text)
    if len(n) < 4:
        return None
    key = (book["id"], lang)
    with _cache_lock:
        hit = _answers.get(key)
    if not hit or hit["key"] != (book.get("updated_at") or "") or time.time() - hit["at"] > CACHE_TTL:
        try:
            items = _cached_rows(book, lang)
        except Exception as e:  # noqa: BLE001
            print("[tutor] 저장된 답 읽기 실패", str(e)[:160], flush=True)
            items = []
        hit = {"at": time.time(), "key": book.get("updated_at") or "", "items": items}
        with _cache_lock:
            _answers[key] = hit
    best, score = None, 0.0
    for it in hit["items"]:
        if abs(len(it["norm"]) - len(n)) > max(3, len(n) // 4):
            continue
        s = similar(n, it["norm"])
        if s > score:
            best, score = it, s
    return best if score >= CACHE_SIM else None


def cache_add(book, lang, mid, question, answer, pages, outside):
    with _cache_lock:
        hit = _answers.get((book["id"], lang))
        if hit and mid:
            hit["items"].insert(0, {"id": mid, "norm": norm_q(question), "answer": answer, "pages": pages, "outside": outside})


def cache_clear():
    with _cache_lock:
        _answers.clear()


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
    r"보여|열어|펴|펼쳐|가\s*줘|이동|띄워|보자|볼래|볼까|보고\s*싶|show|open|go\s*to|take\s*me|let'?s\s+see|buka|lihat|tampilkan|mở|xem"
    r"|ochib|ko.rsat|och\b|abre|abrir|muestra|mostrar|ver\b|veamos|ipakita|buksan|tingnan|เปิด|ดู|ไปที่", re.I)
QUIZ_RE = re.compile(
    r"(?:문제|퀴즈|ox|o/x|오엑스|객관식|단답형?|주관식|빈칸)\s*(?:문제)?\s*(?:를|을|좀|하나|한\s*개|몇\s*개|도|\d+\s*개)?\s*(?:좀\s*)?(?:새로\s*|또\s*)?"
    r"(?:내(?!용)|낼|풀|출제|만들|생성)"
    r"|퀴즈|quiz|test\s*me|ask\s*me|(?:make|create|give\s*me|write)\s+(?:me\s+)?(?:a|an|one|another|new|\d+)?\s*(?:new\s+)?"
    r"(?:ox\s+|true[\s/-]*false\s+|multiple[\s-]*choice\s+|short[\s-]*answer\s+)?question"
    r"|soal|kuis|tes\s*aku|uji\s*aku|đố|kiểm\s*tra|câu\s*hỏi"
    r"|savol\s*(?:ber|tuz)|test\s*qil|pregúntame|preguntame|hazme\s*una\s*pregunta|examíname|(?:crea|haz)\s+una\s+pregunta"
    r"|tanungin\s*mo\s*ako|gumawa\s*ng\s*tanong|ทดสอบ|ถามคำถาม|สร้างคำถาม", re.I)
KIND_RE = {
    "ox": re.compile(r"(?<![a-z])o\s*/?\s*x(?![a-z])|오엑스|참\s*거짓|true[\s/-]*(?:or\s+)?false|benar\s*salah|đúng\s*sai|verdadero|tama\s*o\s*mali|ถูก\s*ผิด", re.I),
    "mc": re.compile(r"객관식|사지\s*선다|4\s*지\s*선다|선다형|multiple[\s-]*choice|pilihan\s*ganda|trắc\s*nghiệm|opción\s*múltiple|test\s*savol|ปรนัย", re.I),
    "word": re.compile(r"단답|주관식|빈칸|short[\s-]*answer|fill[\s-]*in|one[\s-]*word|isian|điền|respuesta\s*corta|อัตนัย", re.I),
}
NEW_RE = re.compile(
    r"새\s*(?:로운\s*)?문제|새로\s*(?:운\s*)?(?:하나|한\s*개)?\s*(?:만들|내)|다른\s*(?:문제|거)|또\s*(?:다른\s*)?(?:문제\s*)?(?:하나\s*)?(?:만들|내)|하나\s*더"
    r"|\bnew\b|another|one\s+more|baru|lagi|mới|khác|nueva|nuevo|otra|otro|bago|iba|yangi|boshqa|ใหม่|อีก", re.I)
# "그 페이지", "거기" — 쪽 번호 대신 가리키는 말
THAT_RE = re.compile(
    r"그\s*(?:페이지|쪽|장|부분|면|내용|곳|거|것)|이\s*(?:페이지|쪽|장|부분|곳|내용)|거기|여기|해당\s*(?:페이지|쪽|부분|내용)|방금|아까|관련\s*(?:페이지|쪽)|그거|그것"
    r"|that\s+(?:page|part|chapter|one)|this\s+page|\bit\b|\bthere\b|halaman\s+itu|trang\s+đó|esa\s+página|pahinang\s+iyon|o['‘’]?sha\s+bet|หน้านั้น", re.I)
ORD_RE = re.compile(r"(첫|두|세|네|[1-4])\s*번째|\b(first|second|third|fourth)\b", re.I)
ORD_N = {"첫": 0, "두": 1, "세": 2, "네": 3, "1": 0, "2": 1, "3": 2, "4": 3, "first": 0, "second": 1, "third": 2, "fourth": 3}
# 쪽 번호 없이 "페이지"·"쪽"만 말함 ("TIG 나오는 페이지 열어줘", "페이지 열어봐")
PAGEWORD_RE = re.compile(r"페이지|쪽|page|halaman|trang|página|pagina|pahina|หน้า|\bbet\b|sahifa", re.I)
# 쪽 찾기에서 뺄 군말
FILLER_RE = re.compile(
    r"내용|들어\s*(?:가|있)\S*|있는|나오는|나온|나와\s*있는|설명\S*|관련\S*|대한|대해|좀|줘|주세요|줄래|봐|보여|열어|펼쳐|펴|띄워|보자|볼래|볼까"
    r"|\b(?:the|a|an|with|about|on|of|please|me)\b", re.I)
NEXT_RE = re.compile(r"다음\s*(?:쪽|페이지|장)|next\s+page|trang\s+sau|siguiente\s+página|halaman\s+berikut", re.I)


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
    """→ {"page": PDF 쪽|None, "title", "range": (시작, 끝)|None, "focus": 쪽 하나를 말했으면 그 쪽,
          "open": bool, "quiz": bool, "kind": 문제 종류|None, "new": 새 문제, "that": '그 페이지'처럼 가리킴,
          "ord": 몇 번째 쪽|None, "next": 다음 쪽, "topic": 쪽을 찾을 낱말 ("TIG 나오는 페이지 열어줘")}"""
    t = text.strip()
    out = {"page": None, "title": "", "range": None, "focus": None, "open": False, "quiz": bool(QUIZ_RE.search(t)),
           "kind": None, "new": False, "that": False, "ord": None, "next": False, "topic": ""}
    if out["quiz"]:
        out["kind"] = next((k for k, r in KIND_RE.items() if r.search(t)), None)
        out["new"] = bool(NEW_RE.search(t))
    units = {(pi, ci): (s, e) for pi, ci, s, e in textbook.units(toc, offset, pages)}
    m = PAGE_RE.search(t)
    mc = CHAPTER_RE.search(t)
    mp = PART_RE.search(t)
    rest = t
    if m:
        printed = _num(m)
        pdf = printed + offset
        if 1 <= pdf <= pages:
            out["page"] = out["focus"] = pdf
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
    elif not m and not mc and not mp:
        mo = ORD_RE.search(t)
        if mo:
            out["ord"] = ORD_N.get((mo.group(1) or mo.group(2) or "").lower())
        out["next"] = bool(NEXT_RE.search(t))
        out["that"] = bool(THAT_RE.search(t)) or out["ord"] is not None or out["next"]
        if not out["quiz"] and OPEN_RE.search(t):
            # "그 페이지 펼쳐줘", "거기 보여줘", "펼쳐 줘" → 바로 전 대답의 쪽을 연다
            bare = re.sub(r"[\s\W_]|요$|좀|줘|주세요|줄래|봐", "", OPEN_RE.sub("", THAT_RE.sub("", t)))
            out["open"] = out["that"] or len(bare) <= 1 or bool(PAGEWORD_RE.search(t))
            if out["open"] and not out["that"]:
                topic = FILLER_RE.sub(" ", PAGEWORD_RE.sub(" ", OPEN_RE.sub(" ", t)))
                topic = re.sub(r"(?<=[가-힣])(?:이|가|을|를|은|는|에서|에|의|로|으로|이랑|랑)(?=\s|$)", "", topic)
                topic = re.sub(r"[^\w\s]", " ", topic)
                out["topic"] = " ".join(w for w in topic.split() if len(w) >= 2)
    return out


def unit_of(book, page):
    for key, title, s, e in daily.book_units(book):
        if s <= page <= e:
            return key, title, (s, e)
    return None, "", None


def last_pages(user, book, sent):
    """바로 전 대답의 확인된 쪽 (앱이 보낸 것, 앱이 대화를 처음 연 경우만 30분 안의 내 마지막 대화에서)."""
    pages = [p for p in (sent or []) if isinstance(p, int) and 1 <= p <= (book.get("pages") or 0)]
    if pages or sent is not None:
        return pages
    since = datetime.fromtimestamp(time.time() - 1800, timezone.utc).isoformat()
    try:
        rows = store.select("tutor_messages", {"user_id": f"eq.{user['id']}", "book_id": f"eq.{book['id']}",
                                               "created_at": f"gte.{since}", "select": "pages,created_at",
                                               "order": "created_at.desc", "limit": "6"})
    except Exception:  # noqa: BLE001
        return []
    # 바로 전 대화 하나만 본다 (더 앞 대화로 거슬러 가면 지금 이야기와 상관없는 쪽이 열린다)
    return list(rows[0].get("pages") or []) if rows else []


# ---- 대화 중 문제 ----

def _recent_quiz(user):
    try:
        return {r["question_id"] for r in store.select("tutor_answers", {
            "user_id": f"eq.{user['id']}", "select": "question_id", "order": "created_at.desc", "limit": "40"})}
    except Exception:  # noqa: BLE001  (step9 SQL 전)
        return set()


def pick_quiz(user, book, rng=random, unit_range=None, kinds=QUIZ_KINDS, strict=False):
    """문제 은행에서 1개. strict 면 범위 안에서 안 풀어 본 문제만 (없으면 None → 새로 만든다)."""
    pool = store.select("quiz_questions", {"book_id": f"eq.{book['id']}", "status": "eq.active",
                                           "kind": f"in.({','.join(kinds)})", "select": daily.QSEL})
    recent = _recent_quiz(user)
    if strict:
        cands = [q for q in pool if q.get("page") and unit_range[0] <= q["page"] <= unit_range[1] and q["id"] not in recent]
        return rng.choice(cands) if cands else None
    if not pool:
        return None
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


def make_quiz(user, book, s, e, kind):
    """쪽 s~e 글로 AI 가 문제 1개를 만들어 문제 은행에 넣는다 → 저장한 문제 (거의 같은 문제가 있으면 그 문제)."""
    text = daily.unit_text(book["id"], s, e)[:QUIZ_TEXT_MAX]
    if len(re.sub(r"\[p\.\d+\]|\s", "", text)) < QUIZ_TEXT_MIN:
        raise TutorError("pages", "no text on page")
    have = [q for q in store.select("quiz_questions", {"book_id": f"eq.{book['id']}", "select": daily.QSEL})
            if q.get("page") and s - 1 <= q["page"] <= e + 1]
    avoid = "\n".join(f"- {q['question']}" for q in have[-30:])
    prompt = (f"Write these questions: 1 {daily.KIND_PROMPT[kind]} (\"{kind}\").\n"
              + (f"Ask about a different idea than these existing questions:\n{avoid}\n" if avoid else "")
              + f"\nTextbook text:\n{text}")
    out = daily.parse_json(call_ai(daily.QUIZ_SYSTEM, prompt, 1500, timeout=40)) or {}
    c = next((x for x in (daily.clean_question(q, s, e) for q in out.get("questions") or []) if x and x["kind"] == kind), None)
    if not c:
        raise TutorError("other", "bad quiz")
    n = norm_q(c["question"])
    same = next((q for q in have if q["kind"] == kind and similar(n, norm_q(q["question"])) >= 0.85), None)
    if same:
        if same.get("status") == "active":
            return same
        raise TutorError("other", "same as hidden question")
    key, title, _ = unit_of(book, c["page"])
    row = {"id": str(uuid.uuid4()), "book_id": book["id"], "unit_key": key or "", "unit_title": (title or "")[:300],
           "status": "active", "report_count": 0, "translations": {}, **c,
           "source": "tutor", "created_by": user["id"]}
    try:
        store.insert_rows("quiz_questions", row, returning=False)
    except Exception:  # noqa: BLE001  (step10 SQL 전: 만든 사람 칸 없이)
        store.insert_rows("quiz_questions", {k: v for k, v in row.items() if k not in ("source", "created_by")},
                          returning=False)
    return row


# ---- AI ----

TUTOR_SYSTEM = """You are Weldy (웰디), a friendly study buddy inside a welding training app at a Korean vocational training institute.
Trainees and teachers talk to you by voice; your reply is read aloud by a phone voice and shown as a subtitle.
Rules:
- Reply in {lang}. 2 to 4 short spoken sentences. No markdown, no lists, no emoji, no URLs.
- Base the answer on the TEXTBOOK EXCERPTS (scanned text, may be noisy). Each excerpt starts with its printed page like [p.123].
  Put in "pages" only printed page numbers of excerpts whose text you actually used. Never invent or guess a page number.
- TEXTBOOK SEARCH is a fact checked by the app. Never contradict it:
  if it lists pages, the textbook DOES cover the topic: never say it is not in the textbook.
  If it says nothing was found, say you could not find it in the textbook (do not say the textbook does not have it),
  then you may answer briefly from general welding knowledge and set "outside": true with "pages": [].
- Never guess. If the excerpts and your sure knowledge do not answer it, say you could not confirm it.
- If the trainee says you are wrong or that a page does not have it, do not simply agree. Re-read the excerpts and the
  TEXTBOOK SEARCH, then say plainly what the textbook says and on which printed page, or that you could not confirm it.
- If it is not about welding, safety or studying, politely decline in one sentence, steer back to studying, and set "offtopic": true.
- Use the RECENT CONVERSATION for follow-up questions (it, that, why...).
- If the trainee did not understand or asks again or asks for an easier explanation: explain it again more simply than before,
  with shorter words and one everyday comparison (kitchen, cars, the body...), not the same sentences as before,
  and end with a short check such as "이해됐어요?" in {lang}.
- If the trainee asks for an example, give one concrete example from a welding shop or shipyard.
- If the trainee asks to see a page, set "open_page" to a printed page from "pages" (never any other page). If they ask you to quiz them, set "quiz": true.
- Keep technical terms (GTAW, SMAW, HAZ...) as they are. Be warm and encouraging. Call yourself Weldy (웰디) only if asked.
Output format: first the spoken reply as plain text. Then a new line with exactly @@@ and then ONE JSON object:
@@@
{{"pages":[],"outside":false,"offtopic":false,"open_page":null,"quiz":false}}"""

KEYWORDS_SYSTEM = """Turn a welding trainee's question (any language) into Korean search words for a Korean welding textbook.
Give 3-8 Korean technical words (and English abbreviations like GTAW if useful), separated by spaces.
Reply with ONLY: {"words":""}"""
MARK = "@@@"


def korean_query(text):
    """한국어가 아닌 질문은 한국어 찾기 낱말로 바꿔서 교재를 찾는다 (실패하면 원래 글). 같은 질문은 한 번만."""
    import report
    if HANGUL.search(text):  # 한글이 있으면 그대로 (GTAW 처럼 영어가 섞여도)
        return text
    key = norm_q(text)
    if key in _words:
        return f"{text} {_words[key]}"
    try:
        out = daily._ask(report.model_name(), KEYWORDS_SYSTEM, text[:500], 120, timeout=10)
        words = str(out.get("words") or "")[:200]
        if len(_words) > 2000:
            _words.clear()
        _words[key] = words
        return f"{text} {words}"
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


def _code_of(anthropic, e):
    """Anthropic 오류 → (이유 코드, 다시 해 볼 만한지, 자세한 내용)."""
    if isinstance(e, anthropic.AuthenticationError):
        return "key", False, str(e)[:160]
    if isinstance(e, anthropic.RateLimitError):
        return "busy", True, ""
    if isinstance(e, anthropic.APITimeoutError):
        return "timeout", True, ""
    if isinstance(e, anthropic.APIConnectionError):
        return "network", True, ""
    if isinstance(e, anthropic.APIStatusError):
        if e.status_code in (500, 502, 503, 504, 529):
            return "busy", True, ""
        return "other", False, f"{e.status_code} {str(e)[:160]}"
    return "other", False, str(e)[:160]


def _ai_args(system, prompt, max_tokens):
    import report
    return dict(model=report.model_name(), betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                max_tokens=max_tokens, system=system, messages=[{"role": "user", "content": prompt}])


def call_ai(system, prompt, max_tokens, timeout=45):
    """Claude 에게 묻고 글자를 돌려받는다. 잠깐 바쁘거나 끊기면 한 번 더 해 본다."""
    import report
    if not report.configured():
        raise TutorError("config")
    anthropic, client = daily._client(timeout)
    last = "other"
    for attempt in range(2):
        try:
            resp = client.beta.messages.create(**_ai_args(system, prompt, max_tokens))
            break
        except anthropic.APIError as e:
            last, again, detail = _code_of(anthropic, e)
            if not again:
                raise TutorError(last, detail)
        if attempt == 0:
            time.sleep(1.5)
    else:
        raise TutorError(last)
    if resp.stop_reason == "refusal":
        raise TutorError("refusal")
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def stream_ai(system, prompt, max_tokens, timeout=45):
    """Claude 대답을 쓰는 대로 조각조각 돌려준다. 첫 글자가 오기 전에 바쁘거나 끊기면 한 번 더 해 본다."""
    import report
    if not report.configured():
        raise TutorError("config")
    anthropic, client = daily._client(timeout)
    last = "other"
    for attempt in range(2):
        got = False
        try:
            with client.beta.messages.stream(**_ai_args(system, prompt, max_tokens)) as s:
                for piece in s.text_stream:
                    got = True
                    yield piece
                if s.get_final_message().stop_reason == "refusal" and not got:
                    raise TutorError("refusal")
            return
        except anthropic.APIError as e:
            last, again, detail = _code_of(anthropic, e)
            if got:  # 중간에 끊기면 받은 데까지만
                print("[tutor] 대답 중간에 끊김", last, flush=True)
                return
            if not again:
                raise TutorError(last, detail)
        if attempt == 0:
            time.sleep(1.5)
    raise TutorError(last)


def read_reply(text):
    """AI 대답 → dict. '말 @@@ {정보}' 모양이 기본. JSON 으로만 오거나 깨져도 글자가 있으면 그 글자를 대답으로 쓴다."""
    text = text or ""
    if MARK in text:
        speech, _, meta = text.partition(MARK)
        out = daily.parse_json(meta) or {}
        if speech.strip():
            return {**out, "reply": speech.strip()}
    out = daily.parse_json(text)
    if out is not None and str(out.get("reply") or "").strip():
        return out
    # JSON 이 깨졌으면 (대답 안에 따옴표가 그대로 있거나 중간에 끊김) "reply": "…" 부분만 꺼낸다
    m = re.search(r'"reply"\s*:\s*"(.*?)"\s*(?:,\s*"(?:pages|outside|offtopic|open_page|quiz)"|}\s*$)', text, re.S)
    v = m.group(1) if m else None
    if v is None:
        m = re.search(r'"reply"\s*:\s*"(.*)', text, re.S)  # 끊긴 경우
        v = m.group(1).rstrip('"} \n') if m else None
    if v is not None:
        pm = re.search(r'"pages"\s*:\s*\[([\d,\s]*)\]', text)
        pages = [int(x) for x in re.findall(r"\d+", pm.group(1))] if pm else []
        return {"reply": v.replace('\\"', '"').replace("\\n", " "), "pages": pages}
    plain = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text.strip())
    plain = re.sub(r"[{}]", "", plain).strip() if plain.startswith("{") else plain
    return {"reply": plain}


def clean_speech(s):
    return re.sub(r"[*#`>]+", "", s)


def search_query(text, history, follow):
    """교재를 찾을 말: 꼬리 질문·따지는 말이면 대화 주제와 합친다."""
    if (follow or META_RE.search(text)) and history:
        topic = topic_of(history)
        if topic and norm_q(topic) not in norm_q(text):
            return f"{topic} {text}"
    return text


def ask_ai(book, text, lang, history, near, focus=None, prev_pages=(), follow=False, seen=None):
    """→ ("delta", 글자 조각) … 그리고 마지막에 ("done", 대답 dict).
    seen: 교육생이 방금 본 교재 쪽 (그 쪽 글도 같이 준다)."""
    offset = book.get("page_offset") or 0
    try:
        texts, _ = _index(book)
    except Exception as e:  # noqa: BLE001
        raise TutorError("pages", str(e)[:160])
    meta = bool(META_RE.search(text)) and bool(history)
    query = korean_query(search_query(text, history, follow))
    pages = find_pages(book, query, near)
    found = mentions(book, query, near)  # 교재 전체에서 주제가 실제로 나오는 쪽 (서버가 확인한 사실)
    first = []
    if focus:  # "277쪽에서 ○○" → 그 쪽을 꼭 넣는다
        first += [p for p in (focus, focus + 1) if p in texts]
    if seen and seen in texts:  # 방금 본 쪽
        first.append(seen)
    first += found[:3]
    if follow or meta:  # 앞 대답에 쓴 쪽도 다시
        first += [p for p in list(prev_pages)[:2] if p in texts]
    pages = list(dict.fromkeys(first + pages))[:PICK_PAGES + 2]
    given = set(pages)
    excerpts = "\n\n".join(
        f"[p.{p - offset}]" + (" (the page the trainee just looked at)" if p == seen else "") + f"\n{texts.get(p, '')[:PAGE_CHARS]}"
        for p in pages) or "(no matching pages)"
    search_fact = (f"pages that mention this topic: {', '.join(f'p.{p - offset}' for p in found)}" if found
                   else "no page clearly mentions this topic (the search may have missed it)")
    hist = "\n".join(f"Trainee: {h.q}\nWeldy: {h.a}" for h in history[-HISTORY:] if h.q or h.a)
    prompt = (f"TEXTBOOK EXCERPTS:\n{excerpts}\n\n"
              + f"TEXTBOOK SEARCH (checked by the app, trust this): {search_fact}\n\n"
              + (f"RECENT CONVERSATION:\n{hist}\n\n" if hist else "")
              + ("NOTE: The trainee is questioning your last answer. Check the excerpts again before you answer. "
                 "Do not just agree.\n\n" if meta else "")
              + ("NOTE: The trainee did not understand the last answer. Explain it again more simply.\n\n"
                 if follow and CONFUSED_RE.search(text) else "")
              + f"TRAINEE NOW SAYS:\n{text}")
    raw = ""
    sent = 0
    jsonish = None
    for piece in stream_ai(TUTOR_SYSTEM.format(lang=daily.LANG_NAMES.get(lang, "Korean")), prompt, 1200):
        raw += piece
        if jsonish is None and raw.strip():
            jsonish = raw.lstrip().startswith(("{", "`"))  # 형식을 안 지키고 JSON 으로 오면 다 받은 뒤에 읽는다
        if jsonish:
            continue
        cut = raw.find(MARK)
        visible = raw[:cut] if cut >= 0 else raw[:max(sent, len(raw) - len(MARK) + 1)]
        if len(visible) > sent:
            chunk = clean_speech(visible[sent:])
            sent = len(visible)
            if chunk:
                yield "delta", chunk
    out = read_reply(raw)
    reply = clean_speech(str(out.get("reply") or "")).strip()[:800]
    if not reply:
        raise TutorError("other", "empty reply")
    said = []
    for v in out.get("pages") or []:
        try:
            said.append(int(v) + offset)
        except (TypeError, ValueError):
            continue
    # 실제로 준 쪽이고 대답 낱말이 들어 있는 쪽만 근거로 (한국어가 아닌 대답은 한국어 찾기 낱말로 확인)
    used = verified(book, said, reply if HANGUL.search(reply) else query, given)
    if said and not used:
        print("[tutor] 근거 쪽 버림", said, flush=True)
    op = out.get("open_page")
    try:
        op = int(op) + offset if op not in (None, "", False) else None
    except (TypeError, ValueError):
        op = None
    if op not in used:  # 확인된 근거 쪽만 연다
        op = used[0] if op and used else None
    yield "done", {"reply": reply, "pages": used[:4], "outside": bool(out.get("outside")) and not used and not found,
                   "offtopic": bool(out.get("offtopic")), "open": op, "quiz": bool(out.get("quiz")), "found": found}


# ---- API ----

class Turn(BaseModel):
    q: str = ""
    a: str = ""


class AskBody(BaseModel):
    text: str
    lang: str = "ko"
    page: int | None = None          # 교재 보다가 물었으면 그 PDF 쪽
    history: list[Turn] = []
    last_pages: list[int] | None = None  # 바로 전 대답의 확인된 쪽 (PDF) — "그 페이지 펼쳐줘". 앱이 대화를 처음 열면 None
    seen_page: int | None = None     # 웰디 대화에서 열어 본 교재 쪽 (PDF)


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
        if "cache_of" in row:  # step10 SQL 전
            return _save({k: v for k, v in row.items() if k != "cache_of"})
        print("[tutor] 기록 실패", str(e)[:160], flush=True)
        return None


def _pages_out(pages, offset):
    return [{"page": p, "printed": p - offset} for p in pages]


def _gate(user, book):
    """AI 를 써도 되나 → (막힌 이유 key|None, params, 남은 수)."""
    import report
    if not book.get("use_for_ai", True):
        return "tutor_aiOff", {}, None
    if not report.configured():
        return "tutor_fail_config", {}, None
    if user["role"] != "student":
        return None, {}, None
    limit = daily_limit()
    used = _used_today(user)
    if used >= limit:
        return "tutor_limit", {"n": limit}, 0
    return None, {}, limit - used - 1


def _fail(e):
    if isinstance(e, TutorError):
        return e.code, e.detail
    return "other", f"{type(e).__name__} {str(e)[:160]}"


def run(body: AskBody, user):
    """대화 한 번 → {"t": "delta", "text"} 조각들 … 마지막에 {"t": "done", 대답}."""
    lang = daily._lang(body.lang)
    text = body.text.strip()[:500]
    book = textbook.current_book()
    base = {"id": None, "reply": "", "key": None, "params": {}, "pages": [], "outside": False, "open": None,
            "quiz": None, "book_id": book["id"] if book else None, "left": None, "cached": False, "made": False}
    if not book:
        yield {"t": "done", **base, "key": "tutor_noBook"}
        return
    if not textbook.can_view(user, book):
        yield {"t": "done", **base, "key": "tutor_hidden"}
        return
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
        return {"t": "done", **out}

    def failed(e, left):
        code, detail = _fail(e)
        print("[tutor] AI 실패", code, detail, flush=True)
        row["answer"] = f"error: {code} {detail}"[:500]
        row["ai"] = False
        return done({**base, "key": f"tutor_fail_{code}", "params": {"code": (detail or code)[:80]},
                     "left": None if left is None else left + 1}, "failed")

    def quiz_out(q, key, made=False):
        daily.ensure_translations([q], lang)
        item = daily._public(q, None, lang, offset)
        row["answer"] = f"quiz {q['id']}"
        row["pages"] = [q["page"]] if q.get("page") else []
        return {**base, "key": key, "params": {"title": q.get("unit_title") or "", "page": item.get("printed_page") or ""},
                "quiz": item, "made": made, "pages": _pages_out(row["pages"], offset)}

    follow = is_follow(text, body.history)
    meta = bool(META_RE.search(text)) and bool(body.history)
    prev = last_pages(user, book, body.last_pages) if intent["that"] or intent["open"] or follow or meta else []

    # 1) 쪽·장 열기 ("그 페이지 펼쳐줘" 는 바로 전 대답의 쪽, "TIG 나오는 페이지 열어줘" 는 찾은 쪽)
    if intent["open"] and not intent["page"]:
        # 찾을 말: "TIG 나오는 페이지" 면 그 말, "그 내용 있는 페이지" 인데 바로 전 쪽이 없으면 대화 주제
        want = intent["topic"] or ("" if prev else topic_of(body.history))
        if want:
            try:
                found = mentions(book, korean_query(want), near)  # 그 내용이 실제로 들어 있는 쪽만
            except Exception:  # noqa: BLE001
                found = []
            prev = found
        if not prev:
            yield done({**base, "key": "tutor_whichPage"}, "open")
            return
        if intent["next"]:
            target = min(pages, prev[0] + 1)
        elif intent["ord"] is not None and intent["ord"] < len(prev):
            target = prev[intent["ord"]]
        else:
            target = prev[0]
        others = [p for p in prev if p != target]
        out = {**base, "key": "tutor_openThatMore" if others else "tutor_openThat",
               "params": {"page": target - offset}, "open": {"page": target, "printed": target - offset},
               "pages": _pages_out(others, offset)}
        row["answer"] = f"open {target}"
        row["pages"] = [target]
        yield done(out, "open", target)
        return
    if intent["open"] and intent["page"]:
        out = {**base, "key": "tutor_open", "params": {"title": intent["title"]},
               "open": {"page": intent["page"], "printed": intent["page"] - offset}}
        row["answer"] = f"open {intent['page']}"
        row["pages"] = [intent["page"]]
        yield done(out, "open", intent["page"])
        return

    # 2) 문제: 말한 쪽(앞뒤 1쪽)·장 문제가 은행에 있으면 바로, 없거나 "새 문제"면 그 쪽 글로 만든다
    if intent["quiz"]:
        spot = intent["focus"] or ((prev[0] if prev else ctx_page) if intent["that"] else None)
        kinds = (intent["kind"],) if intent["kind"] else QUIZ_KINDS
        if spot:
            bank_range, make_range = (max(1, spot - 1), min(pages, spot + 1)), (spot, spot)
        elif intent["range"]:
            bank_range = make_range = intent["range"]
        else:
            bank_range, make_range = None, None
        if not intent["new"]:
            q = (pick_quiz(user, book, unit_range=bank_range, kinds=kinds, strict=True) if bank_range
                 else pick_quiz(user, book, unit_range=near if ctx_page else None, kinds=kinds))
            if q:
                yield done(quiz_out(q, "tutor_quiz"), "quiz", q.get("page"))
                return
        if not make_range:
            make_range = (ctx_page, ctx_page) if ctx_page else None
        if not make_range:
            yield done({**base, "key": "tutor_noQuizWhere" if intent["new"] else "tutor_noQuiz"}, "quiz")
            return
        key, params, left = _gate(user, book)
        if key:
            yield done({**base, "key": key, "params": params, "left": left}, "limit" if key == "tutor_limit" else "blocked")
            return
        yield {"t": "status", "key": "tutor_making"}
        try:
            q = make_quiz(user, book, make_range[0], make_range[1], intent["kind"] or "mc")
        except Exception as e:  # noqa: BLE001
            yield failed(e, left)
            return
        row["ai"] = True
        yield done({**quiz_out(q, "tutor_quizNew", made=True), "left": left}, "quiz", q.get("page"))
        return

    # 3) 같은 질문을 전에 누가 했으면 그 대답을 바로 (꼬리 질문·쪽을 말한 질문은 빼고)
    if not follow and not meta and not intent["focus"] and book.get("use_for_ai", True):
        hit = cache_find(book, lang, text)
        if hit:
            row.update(answer=hit["answer"], pages=hit["pages"], cache_of=hit["id"])
            out = {**base, "reply": hit["answer"], "pages": _pages_out(hit["pages"], offset), "outside": hit["outside"],
                   "cached": True}
            yield done(out, "outside" if hit["outside"] else "explain", (hit["pages"] or [None])[0] or ctx_page)
            return

    # 4) AI 설명 (쓰는 대로 흘려 보낸다)
    key, params, left = _gate(user, book)
    if key:
        if key == "tutor_fail_config":
            row["answer"] = "error: config"
        yield done({**base, "key": key, "params": params, "left": left},
                   {"tutor_limit": "limit", "tutor_fail_config": "failed"}.get(key, "blocked"))
        return
    ai = None
    try:
        seen = body.seen_page if body.seen_page and 1 <= body.seen_page <= pages else None
        for kind, v in ask_ai(book, text, lang, body.history, near, intent["focus"], prev, follow, seen):
            if kind == "delta":
                yield {"t": "delta", "text": v}
            else:
                ai = v
    except Exception as e:  # noqa: BLE001
        yield failed(e, left)
        return
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
    ev = done(out, kind, (ai["pages"] or [None])[0] or ctx_page)
    if kind != "offtopic" and not follow and not meta and not intent["focus"]:
        cache_add(book, lang, ev["id"], text, ai["reply"], ai["pages"], ai["outside"])
    yield ev


@router.post("/tutor/ask")
def ask(body: AskBody, user=Depends(accounts.current_user)):
    """대답을 다 만든 뒤 한 번에 (예전 앱)."""
    if not body.text.strip():
        _err(400, "tutor_empty")
    last = None
    for ev in run(body, user):
        if ev["t"] == "done":
            last = ev
    last.pop("t", None)
    return last


@router.post("/tutor/ask/stream")
def ask_stream(body: AskBody, user=Depends(accounts.current_user)):
    """대답을 쓰는 대로 흘려 보낸다 (text/event-stream: 'data: {json}' 줄). 마지막은 t=done."""
    if not body.text.strip():
        _err(400, "tutor_empty")

    def events():
        yield ": start\n\n"  # 연결이 열렸음을 바로 알린다
        try:
            for ev in run(body, user):
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except Exception as e:  # noqa: BLE001
            code, detail = _fail(e)
            print("[tutor] 흘려 보내기 실패", code, detail, flush=True)
            yield "data: " + json.dumps({"t": "done", "id": None, "reply": "", "key": f"tutor_fail_{code}",
                                         "params": {"code": (detail or code)[:80]}, "pages": [], "outside": False,
                                         "open": None, "quiz": None, "book_id": None, "left": None,
                                         "cached": False, "made": False}, ensure_ascii=False) + "\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class QuizAnswer(BaseModel):
    question_id: str
    answer: int | str
    lang: str = "ko"


@router.post("/tutor/quiz")
def quiz_answer(body: QuizAnswer, user=Depends(accounts.current_user)):
    """대화 중 문제 채점 (연습용: 매일 문제 점수·연속 일수에는 안 들어감). 단답형은 글로 답한다."""
    lang = daily._lang(body.lang)
    try:
        uuid.UUID(body.question_id)
    except ValueError:
        _err(404, "not_found")
    q = daily._questions([body.question_id]).get(body.question_id)
    if not q or q["kind"] not in QUIZ_KINDS:
        _err(404, "not_found")
    if q["kind"] == "word":
        said = str(body.answer).strip()[:200]
        if not said:
            _err(400, "dq_bad_answer")
        score, feedback, by = daily.grade_word(q, said, lang)
        correct = bool(score is not None and score >= daily.PASS_SCORE)
        a = {"answer": said, "correct": None if score is None else correct, "score": score, "feedback": feedback,
             "graded_by": by}
        saved = said
    else:
        try:
            pick = int(body.answer)
        except (TypeError, ValueError):
            _err(400, "dq_bad_answer")
        if not 0 <= pick < (4 if q["kind"] == "mc" else 2):
            _err(400, "dq_bad_answer")
        correct = pick == q.get("answer")
        a = {"answer": str(pick), "correct": correct, "score": 10 if correct else 0, "feedback": "", "graded_by": "auto"}
        saved = pick
    rec = {"user_id": user["id"], "book_id": q["book_id"], "question_id": q["id"], "unit_key": q.get("unit_key"),
           "kind": q["kind"], "answer": saved, "correct": correct, "created_at": _now()}
    try:
        store.insert_rows("tutor_answers", rec)
    except Exception as e:  # noqa: BLE001
        try:  # step10 SQL 전 (답 칸이 숫자)
            store.insert_rows("tutor_answers", {**rec, "answer": None})
        except Exception:  # noqa: BLE001
            print("[tutor] 문제 기록 실패", str(e)[:160], flush=True)
    book = textbook.current_book()
    daily.ensure_translations([q], lang)
    return daily._public(q, a, lang, (book or {}).get("page_offset") or 0)


class ReportBody(BaseModel):
    message_id: str
    note: str = ""


@router.post("/tutor/report")
def report_answer(body: ReportBody, user=Depends(accounts.current_user)):
    """'답이 이상해요' 신고 → 관리자가 모아 본다. 신고된 답은 다른 교육생에게 다시 안 준다."""
    try:
        uuid.UUID(body.message_id)
    except ValueError:
        _err(404, "not_found")
    rows = store.select("tutor_messages", {"id": f"eq.{body.message_id}", "user_id": f"eq.{user['id']}", "select": "id"})
    if not rows:
        _err(404, "not_found")
    store.patch("tutor_messages", {"id": f"eq.{body.message_id}"},
                {"reported": True, "report_note": body.note.strip()[:300], "reported_at": _now()})
    cache_clear()
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
    cache_clear()
    return {"ok": True}


@router.get("/admin/tutor/faq")
def faq(days: int = 30, user=Depends(need_admin)):
    """자주 묻는 질문: 지금 교재에서 AI 가 한 대답마다 같은 질문(저장된 답을 받은 수 포함)을 세어 많은 순."""
    book = textbook.current_book()
    if not book:
        return {"items": [], "days": days}
    days = max(1, min(365, days))
    since = datetime.fromtimestamp(time.time() - days * 86400, timezone.utc).isoformat()
    base = {"book_id": f"eq.{book['id']}", "created_at": f"gte.{since}"}
    src = store.select("tutor_messages", {**base, "ai": "is.true", "kind": "in.(explain,outside)",
                                          "select": "id,question,answer,pages,lang,kind,reported,created_at",
                                          "order": "created_at.desc", "limit": "3000"})
    try:
        hits = store.select("tutor_messages", {**base, "select": "cache_of", "limit": "20000"})
    except Exception:  # noqa: BLE001
        hits = []
    count = {}
    for h in hits:
        if h.get("cache_of"):
            count[h["cache_of"]] = count.get(h["cache_of"], 0) + 1
    groups = []  # 저장된 답이 생기기 전에 같은 질문을 따로 물은 것도 묶는다
    for r in src:
        n = norm_q(r["question"])
        g = next((g for g in groups if g["lang"] == r["lang"] and similar(n, g["norm"]) >= CACHE_SIM), None)
        c = 1 + count.get(r["id"], 0)
        if g:
            g["count"] += c
        else:
            groups.append({"norm": n, "lang": r["lang"], "count": c, "question": r["question"], "answer": r["answer"],
                           "pages": r.get("pages") or [], "outside": r.get("kind") == "outside",
                           "reported": bool(r.get("reported")), "id": r["id"]})
    offset = book.get("page_offset") or 0
    groups.sort(key=lambda g: -g["count"])
    return {"items": [{**{k: v for k, v in g.items() if k != "norm"}, "printed": [p - offset for p in g["pages"]]}
                      for g in groups[:50]], "days": days}


# ---- 관리자: 웰디 점검 (질문과 정답 쪽을 넣어 두고 실제 웰디로 한꺼번에 확인) ----
# 교재가 대외비라 질문 목록은 저장소가 아니라 DB(tutor_checks)에 둔다.

NOT_IN_BOOK_RE = re.compile(
    r"교재에(?:는|선|서는)?\s*(?:없|나오지\s*않|안\s*나와|실려\s*있지\s*않)|not\s+in\s+the\s+textbook|isn'?t\s+in\s+the\s+textbook", re.I)
CHECK_SEED = 20


class CheckBody(BaseModel):
    question: str
    page_from: int               # 정답 쪽 (책에 인쇄된 쪽)
    page_to: int | None = None
    note: str = ""


ASK_TAIL_RE = re.compile(r"(?:에\s*대해(?:서)?|이?란|가|이|은|는)?\s*(?:자세히\s*)?(?:설명|알려|가르쳐)\S*\s*(?:줘|주세요|줄래)?\s*[?.!]*\s*$")


def _share(book, page, words):
    """그 쪽(PDF 쪽)에 질문 낱말이 몇 할 들어 있나."""
    _, idx = _index(book)
    tf = idx["tf"].get(page) or {}
    return sum(1 for w in words if w in tf) / len(words) if words else 0.0


def check_hint(book, r, offset):
    """엉뚱한 쪽·근거 쪽 없음일 때 서버가 교재 글로 다시 본다 (AI 안 씀, 바로 끝남).
    weldy_right 웰디 쪽에 내용이 있고 정답 쪽엔 없음 → 정답 쪽을 고치자 / both 둘 다 있음 /
    weldy_wrong 정답 쪽에만 있음 → 웰디 잘못 / elsewhere 근거 쪽은 없지만 교재 다른 쪽에 있음 / unclear 글로는 판단 어려움."""
    verdict = r.get("last_verdict") or ""
    if verdict not in ("wrong_page", "no_page"):
        return None
    try:
        words = key_terms(book, ASK_TAIL_RE.sub("", r["question"]).strip() or r["question"], 8)
        if not words:
            return {"kind": "unclear", "page": None}
        texts, _ = _index(book)
        a, b = r["page_from"], r["page_to"]
        exp = max((_share(book, p + offset, words) for p in range(a, b + 1) if p + offset in texts), default=0.0)
        if verdict == "wrong_page":
            got = sorted(((_share(book, p + offset, words), p) for p in r.get("last_pages") or []), reverse=True)
            best, page = got[0] if got else (0.0, None)
            if best >= 0.5 and exp >= 0.5:
                return {"kind": "both", "page": page}
            if best >= 0.5:
                return {"kind": "weldy_right", "page": page}
            if exp >= 0.5:
                return {"kind": "weldy_wrong", "page": None}
            return {"kind": "unclear", "page": None}
        if exp >= 0.5:
            return {"kind": "weldy_wrong", "page": None}
        other = [p - offset for p in mentions(book, r["question"]) if not a <= p - offset <= b]
        return {"kind": "elsewhere", "page": other[0]} if other else {"kind": "unclear", "page": None}
    except Exception as e:  # noqa: BLE001 — 힌트는 덤이라 실패해도 목록은 보여 준다
        print("[tutor] 점검 힌트 실패", type(e).__name__, e)
        return None


def _check_out(r, offset, book=None):
    return {"id": r["id"], "question": r["question"], "page_from": r["page_from"], "page_to": r["page_to"],
            "note": r.get("note") or "", "last_verdict": r.get("last_verdict") or "",
            "last_pages": r.get("last_pages") or [], "last_found": r.get("last_found") or [],
            "last_reply": r.get("last_reply") or "", "last_run_at": r.get("last_run_at"),
            "hint": check_hint(book, r, offset) if book else None}


@router.get("/admin/tutor/checks")
def list_checks(user=Depends(need_admin)):
    book = textbook.current_book()
    if not book:
        return {"items": [], "book": None}
    rows = store.select("tutor_checks", {"book_id": f"eq.{book['id']}", "select": "*", "order": "created_at.asc"})
    return {"items": [_check_out(r, book.get("page_offset") or 0, book) for r in rows], "book": book.get("title") or ""}


@router.post("/admin/tutor/checks")
def add_check(body: CheckBody, user=Depends(need_admin)):
    book = textbook.current_book()
    if not book:
        _err(400, "tutor_noBook")
    q = body.question.strip()[:300]
    a = body.page_from
    b = body.page_to if body.page_to is not None else a
    if not q or a < 1 or b < a:
        _err(400, "tutor_check_bad")
    row = {"id": str(uuid.uuid4()), "book_id": book["id"], "question": q, "page_from": a, "page_to": b,
           "note": body.note.strip()[:200], "created_at": _now()}
    store.insert_rows("tutor_checks", row, returning=False)
    return _check_out(row, book.get("page_offset") or 0, book)


class CheckPagesBody(BaseModel):
    page_from: int
    page_to: int | None = None


@router.patch("/admin/tutor/checks/{cid}")
def edit_check(cid: str, body: CheckPagesBody, user=Depends(need_admin)):
    """정답 쪽 고치기. 지난 점검 결과가 있으면 AI 다시 안 부르고 새 정답 쪽으로 판정만 다시 한다."""
    try:
        uuid.UUID(cid)
    except ValueError:
        _err(404, "not_found")
    rows = store.select("tutor_checks", {"id": f"eq.{cid}", "select": "*"})
    book = textbook.current_book()
    if not rows or not book:
        _err(404, "not_found")
    a = body.page_from
    b = body.page_to if body.page_to is not None else a
    if a < 1 or b < a:
        _err(400, "tutor_check_bad")
    r = rows[0]
    fields = {"page_from": a, "page_to": b}
    if r.get("last_verdict") in ("ok", "wrong_page", "no_page", "said_missing"):
        fields["last_verdict"] = judge(r.get("last_pages") or [], r.get("last_reply") or "", a, b)
    store.patch("tutor_checks", {"id": f"eq.{cid}"}, fields)
    return _check_out({**r, **fields}, book.get("page_offset") or 0, book)


@router.delete("/admin/tutor/checks/{cid}")
def delete_check(cid: str, user=Depends(need_admin)):
    try:
        uuid.UUID(cid)
    except ValueError:
        _err(404, "not_found")
    store.delete("tutor_checks", {"id": f"eq.{cid}"})
    return {"ok": True}


@router.post("/admin/tutor/checks/seed")
def seed_checks(user=Depends(need_admin)):
    """예시 질문 만들기: 교재 목차의 장 제목으로 최대 20개 (정답 쪽 = 그 장의 쪽). 예시이니 관리자가 바꾼다."""
    book = textbook.current_book()
    if not book:
        _err(400, "tutor_noBook")
    offset = book.get("page_offset") or 0
    have = {norm_q(r["question"]) for r in store.select("tutor_checks", {"book_id": f"eq.{book['id']}", "select": "question"})}
    units = daily.book_units(book)
    if not units:
        _err(400, "dq_no_toc")
    step = max(1, len(units) / CHECK_SEED)
    picked = [units[int(i * step)] for i in range(min(CHECK_SEED, len(units)))]
    rows = []
    for key, title, s, e in picked:
        name = re.sub(r"^\s*(?:제?\s*\d+\s*[편장절]\.?|chapter\s*\d+|part\s*\d+|\d+[\.\s])\s*", "", title.split("›")[-1], flags=re.I).strip()
        if len(name) < 2:
            continue
        q = f"{name}에 대해 설명해 줘"
        if norm_q(q) in have:
            continue
        rows.append({"id": str(uuid.uuid4()), "book_id": book["id"], "question": q[:300], "page_from": s - offset,
                     "page_to": e - offset, "note": "예시 (목차로 자동)", "created_at": _now()})
    if rows:
        store.insert_rows("tutor_checks", rows, returning=False)
    return {"added": len(rows)}


def judge(pages, reply, a, b):
    """점검 판정 (쪽은 인쇄 쪽): ok 맞음 / wrong_page 엉뚱한 쪽 / no_page 근거 쪽 없음 / said_missing '교재에 없다'고 함."""
    if NOT_IN_BOOK_RE.search(reply or ""):
        return "said_missing"
    if not pages:
        return "no_page"
    return "ok" if any(a - 1 <= p <= b + 1 for p in pages) else "wrong_page"


@router.post("/admin/tutor/checks/{cid}/run")
def run_check(cid: str, user=Depends(need_admin)):
    """질문 하나를 실제 웰디(앞 대화 없이)로 묻고 판정을 저장한다."""
    try:
        uuid.UUID(cid)
    except ValueError:
        _err(404, "not_found")
    rows = store.select("tutor_checks", {"id": f"eq.{cid}", "select": "*"})
    book = textbook.current_book()
    if not rows or not book:
        _err(404, "not_found")
    r = rows[0]
    offset = book.get("page_offset") or 0
    ai = None
    try:
        for kind, v in ask_ai(book, r["question"], "ko", [], None):
            if kind == "done":
                ai = v
    except Exception as e:  # noqa: BLE001
        code, detail = _fail(e)
        verdict, reply, pages, found = f"error_{code}", detail[:300], [], []
    else:
        pages = [p - offset for p in ai["pages"]]
        found = [p - offset for p in ai["found"]]
        reply = ai["reply"]
        verdict = judge(pages, reply, r["page_from"], r["page_to"])
    fields = {"last_verdict": verdict, "last_pages": pages, "last_found": found, "last_reply": reply[:800],
              "last_run_at": _now()}
    store.patch("tutor_checks", {"id": f"eq.{cid}"}, fields)
    return _check_out({**r, **fields}, offset, book)
