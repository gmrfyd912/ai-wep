"""T1(이론): 교재 올리기·교재 보기·진도.

- 시스템관리자가 교재 PDF 를 올리면 서버가 뒤에서 쪽마다 그림(JPEG)과 글자로 나눠 저장한다.
  PDF 파일 자체는 저장하지 않는다 (Supabase 무료 한도 50MB 보다 크고, 쪽 그림이면 충분).
  쪽 그림: photos 저장 공간의 textbook/{교재id}/0001.jpg (비공개, 서명 주소로만 보임)
- 다 나누면 AI(Claude)가 차례 쪽을 읽어 목차(편 → 장 → 절)를 만든다. 관리자가 확인·수정한다.
- 교재는 공개 저장소(GitHub)에 절대 넣지 않는다.
- 진도: 한 쪽에서 다음 쪽으로 넘기면 그 쪽은 '다 봄' (박사 결정 2026-11-24, 시간 기준 없음).
- 쪽 번호: 목차에는 책에 인쇄된 번호를 쓰고, PDF 쪽 = 인쇄 번호 + page_offset.
"""
import base64
import json
import os
import re
import tempfile
import threading
import time
import uuid
from collections import Counter
from datetime import datetime, timezone

import requests
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

import accounts
import store
from admin_settings import need_admin

router = APIRouter()

BUCKET = "photos"
PAGE_W = 1100            # 쪽 그림 가로 (휴대폰에서 글자가 읽히고, 쪽당 약 100KB)
JPEG_Q = 62
MAX_UPLOAD = 400 * 1024 * 1024
MAX_PAGES = 3000
SIGN_SECONDS = 7 * 24 * 3600
PAGES_PER_CALL = 40
TOC_MAX_PAGES = 12       # AI 에게 보여 줄 차례 쪽 최대
DEFAULT_MODEL = "claude-sonnet-5-5"
SELECT = ("id,title,pages,processed,status,error,page_offset,toc,toc_pages,is_current,show_students,"
          "use_for_ai,created_at,updated_at")

# 한 번에 한 교재만 나눈다 (무료 서버 메모리·PDF 라이브러리는 동시에 여러 개를 다루지 않음)
_job_lock = threading.Lock()
_job = {"book_id": None}


def _err(status, code, **extra):
    raise HTTPException(status, {"code": code, **extra})


def _now():
    return datetime.now(timezone.utc).isoformat()


def model_name():
    return os.environ.get("TEXTBOOK_MODEL") or DEFAULT_MODEL


def page_path(book_id, page):
    return f"textbook/{book_id}/{page:04d}.jpg"


# ---- 쪽 나누기 ----

def render_page(pdf, index):
    """PDF 한 쪽 → (JPEG bytes, 가로, 세로, 글자). 거의 흑백인 쪽은 흑백으로 저장해 더 작게."""
    import cv2
    import numpy as np
    pg = pdf[index]
    try:
        w_pt, _ = pg.get_size()
        bm = pg.render(scale=PAGE_W / max(w_pt, 1))
        img = bm.to_numpy()
        if img.ndim == 3 and img.shape[2] == 4:
            img = img[:, :, :3]
        img = np.ascontiguousarray(img)
        if img.ndim == 3:
            small = img[::8, ::8].astype(np.int16)
            spread = (small.max(axis=2) - small.min(axis=2)).mean()
            if spread < 6:
                img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, JPEG_Q])
        if not ok:
            raise ValueError("encode")
        tp = pg.get_textpage()
        try:
            text = tp.get_text_range() or ""
        finally:
            tp.close()
        text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")[:20000]
        return buf.tobytes(), int(img.shape[1]), int(img.shape[0]), text
    finally:
        pg.close()


LEADER = re.compile(r"(?:…|·{2,}|-{3,}|\.{3,})\s*\d{1,4}")


def find_toc_pages(texts):
    """앞쪽 30쪽에서 차례 쪽 범위 (예: '5-8'). '차례/목차/contents' 글자 또는 점선+쪽 번호가 많은 쪽.
    스캔 글자는 '차례'가 '차 려' 처럼 틀리기도 해서 점선 수도 함께 본다. 못 찾으면 ''."""
    def leaders(p):
        return len(LEADER.findall(texts.get(p, "")))
    hits = [p for p, t in sorted(texts.items())
            if p <= 30 and (re.search(r"차\s*례|목\s*차|contents", t[:400], re.I) or leaders(p) >= 8)]
    if not hits:
        return ""
    start = end = hits[0]
    for p in range(start + 1, start + TOC_MAX_PAGES):
        if leaders(p) >= 5:
            end = p
        else:
            break
    return f"{start}-{end}" if end > start else str(start)


def detect_offset(texts):
    """쪽 맨 위/아래에 인쇄된 쪽 번호로 'PDF 쪽 - 인쇄 쪽' 을 찾는다. 확실하지 않으면 0."""
    votes = Counter()
    for p, t in texts.items():
        if p < 8:
            continue
        lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
        if not lines:
            continue
        for cand in (re.match(r"^(\d{1,4})\b", lines[0]), re.search(r"\b(\d{1,4})$", lines[-1])):
            if cand:
                n = int(cand.group(1))
                if 0 < n <= MAX_PAGES:
                    votes[p - n] += 1
    if not votes:
        return 0
    off, n = votes.most_common(1)[0]
    return off if n >= 3 and abs(off) < 100 else 0


def parse_range(s, pages):
    """'5-8' / '5' → [5,6,7,8] (교재 쪽 수 안, 최대 12쪽). 잘못되면 []."""
    m = re.fullmatch(r"\s*(\d{1,4})\s*(?:[-~]\s*(\d{1,4}))?\s*", s or "")
    if not m:
        return []
    a = int(m.group(1))
    b = int(m.group(2) or a)
    if a < 1 or b < a or b > pages:
        return []
    return list(range(a, min(b, a + TOC_MAX_PAGES - 1) + 1))


def _keep_awake_url():
    base = os.environ.get("RENDER_EXTERNAL_URL", "").rstrip("/")
    return f"{base}/health" if base else None


def process_book(book_id, pdf_path):
    """뒤에서 실행: 모든 쪽을 그림·글자로 저장 → 목차 쪽·쪽 번호 차이 찾기 → AI 목차 (목차가 비어 있으면)."""
    import pypdfium2 as pdfium
    ping = _keep_awake_url()
    last_ping = time.time()
    try:
        pdf = pdfium.PdfDocument(pdf_path)
        try:
            n = len(pdf)
            done_rows = store.select("textbook_pages", {"book_id": f"eq.{book_id}", "select": "page,text"})
            done = {r["page"] for r in done_rows}
            texts = {r["page"]: r.get("text") or "" for r in done_rows if r["page"] <= 120}
            count = len(done)
            for i in range(n):
                p = i + 1
                if p in done:
                    continue
                jpg, w, h, text = render_page(pdf, i)
                store.upload(BUCKET, page_path(book_id, p), jpg)
                store.insert_rows("textbook_pages", {"book_id": book_id, "page": p, "image_path": page_path(book_id, p),
                                                     "width": w, "height": h, "text": text}, returning=False)
                if p <= 120:
                    texts[p] = text
                count += 1
                if count % 10 == 0 or count == n:
                    store.patch("textbooks", {"id": f"eq.{book_id}"}, {"processed": count, "updated_at": _now()})
                # 무료 서버는 15분 동안 요청이 없으면 잠든다: 나누는 동안 4분마다 스스로 깨워 둔다
                if ping and time.time() - last_ping > 240:
                    last_ping = time.time()
                    try:
                        requests.get(ping, timeout=10)
                    except Exception:  # noqa: BLE001
                        pass
        finally:
            pdf.close()
        book = store.select("textbooks", {"id": f"eq.{book_id}", "select": SELECT})
        book = book[0] if book else {}
        fields = {"status": "ready", "processed": n, "error": "", "updated_at": _now()}
        if not book.get("toc_pages"):
            fields["toc_pages"] = find_toc_pages(texts)
        if not book.get("page_offset"):
            fields["page_offset"] = detect_offset(texts)
        store.patch("textbooks", {"id": f"eq.{book_id}"}, fields)
        print(f"[textbook] {book_id} {n}쪽 나누기 끝", flush=True)
        if not book.get("toc") and fields.get("toc_pages", book.get("toc_pages")):
            try:
                toc = make_toc(book_id, parse_range(fields.get("toc_pages") or book.get("toc_pages"), n),
                               fields.get("page_offset", book.get("page_offset") or 0), n)
                store.patch("textbooks", {"id": f"eq.{book_id}"}, {"toc": toc, "updated_at": _now()})
            except TocError as e:
                print("[textbook] AI 목차 실패(관리자가 다시 누를 수 있음):", str(e)[:200], flush=True)
    except Exception as e:  # noqa: BLE001
        print("[textbook] 나누기 실패", book_id, type(e).__name__, str(e)[:300], flush=True)
        try:
            store.patch("textbooks", {"id": f"eq.{book_id}"},
                        {"status": "failed", "error": f"{type(e).__name__}: {str(e)[:200]}", "updated_at": _now()})
        except Exception:  # noqa: BLE001
            pass
    finally:
        try:
            os.remove(pdf_path)
        except OSError:
            pass
        _job["book_id"] = None
        _job_lock.release()


def _start_job(book_id, pdf_path):
    threading.Thread(target=process_book, args=(book_id, pdf_path), daemon=True).start()


# ---- 목차 ----

class TocError(Exception):
    def __init__(self, code, detail=""):
        super().__init__(f"{code}: {detail}")
        self.code = code


def _page(v, lo, hi):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def _title(v):
    return re.sub(r"\s+", " ", str(v or "")).strip()[:120]


def clean_toc(raw, pages, offset=0):
    """목차 검사: [{title, page, chapters:[{title, page, sections:[{title, page}]}]}]. 쪽 = 인쇄 번호."""
    lo, hi = 1 - offset, pages - offset
    out = []
    for part in (raw if isinstance(raw, list) else [])[:40]:
        if not isinstance(part, dict) or not _title(part.get("title")):
            continue
        chapters = []
        for ch in (part.get("chapters") if isinstance(part.get("chapters"), list) else [])[:80]:
            if not isinstance(ch, dict) or not _title(ch.get("title")):
                continue
            sections = []
            for s in (ch.get("sections") if isinstance(ch.get("sections"), list) else [])[:80]:
                if isinstance(s, dict) and _title(s.get("title")):
                    sections.append({"title": _title(s["title"]), "page": _page(s.get("page"), lo, hi)})
            chapters.append({"title": _title(ch["title"]), "page": _page(ch.get("page"), lo, hi), "sections": sections})
        page = _page(part.get("page"), lo, hi)
        if page is None and chapters:
            page = next((c["page"] for c in chapters if c["page"] is not None), None)
        out.append({"title": _title(part["title"]), "page": page, "chapters": chapters})
    return out


TOC_SYSTEM = """You read the table of contents (차례/목차) pages of a welding textbook from scanned page images.
Return the book structure exactly as printed: parts (편/part), chapters (장) and sections (numbered items), each with the page number printed in the table of contents.
- Keep titles in the original language and wording, including the numbering (e.g. "제1장 용접 개요", "1. 용접의 정의 및 특성"). Fix obvious scan errors only.
- page = the printed page number shown in the table of contents. For a part with no page, use 0.
- If the book has no parts, put all chapters under one part titled with the book title.
- Appendices or past exam sections at the end are parts too.
Reply with ONLY one JSON object, no markdown: {"toc":[{"title":"","page":0,"chapters":[{"title":"","page":0,"sections":[{"title":"","page":0}]}]}]}"""


def make_toc(book_id, page_list, offset, pages):
    """차례 쪽 그림을 AI 에게 보여 주고 목차를 받는다 → clean_toc 결과. 실패하면 TocError."""
    import report  # ANTHROPIC_API_KEY 확인을 리포트와 같이 쓴다
    if not report.configured():
        raise TocError("ai_not_configured")
    if not page_list:
        raise TocError("tb_bad_pages")
    import anthropic
    content = []
    for p in page_list:
        try:
            data = store.download(BUCKET, page_path(book_id, p))
        except Exception as e:  # noqa: BLE001
            raise TocError("tb_page_missing", f"{p} {str(e)[:100]}")
        content.append({"type": "text", "text": f"PDF page {p}:"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                    "data": base64.standard_b64encode(data).decode()}})
    content.append({"type": "text", "text": "Read the table of contents above and reply with the JSON object."})
    client = anthropic.Anthropic(timeout=240, max_retries=1)
    try:
        resp = client.beta.messages.create(
            model=model_name(),
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            max_tokens=16000,
            output_config={"effort": "low"},
            system=TOC_SYSTEM,
            messages=[{"role": "user", "content": content}],
        )
    except anthropic.AuthenticationError as e:
        raise TocError("ai_key_invalid", str(e)[:200])
    except anthropic.RateLimitError as e:
        raise TocError("ai_busy", str(e)[:200])
    except anthropic.APIStatusError as e:
        raise TocError("tb_ai_failed", f"{e.status_code} {str(e)[:200]}")
    except anthropic.APIConnectionError as e:
        raise TocError("tb_ai_failed", f"connection {str(e)[:200]}")
    if resp.stop_reason in ("refusal", "max_tokens"):
        raise TocError("tb_ai_failed", resp.stop_reason)
    text = "".join(b.text for b in resp.content if b.type == "text")
    raw = parse_reply(text)
    if raw is None:
        raise TocError("tb_ai_failed", "bad_json")
    toc = clean_toc(raw, pages, offset)
    if not toc:
        raise TocError("tb_ai_failed", "empty")
    return toc


def parse_reply(text):
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
    return out.get("toc") if isinstance(out, dict) and isinstance(out.get("toc"), list) else None


# ---- 진도 계산 ----

def units(toc, offset, pages):
    """진도를 세는 단위(장, 장이 없는 편은 편 전체) → [(편 번호, 장 번호 또는 None, PDF 시작, PDF 끝)]."""
    starts = []
    for pi, part in enumerate(toc):
        if part.get("chapters"):
            for ci, ch in enumerate(part["chapters"]):
                if ch.get("page") is not None:
                    starts.append((ch["page"] + offset, pi, ci))
        elif part.get("page") is not None:
            starts.append((part["page"] + offset, pi, None))
    starts.sort()
    out = []
    for k, (s, pi, ci) in enumerate(starts):
        end = (starts[k + 1][0] - 1) if k + 1 < len(starts) else pages
        s = max(1, min(s, pages))
        out.append((pi, ci, s, max(s, min(end, pages))))
    return out


def toc_with_progress(toc, offset, pages, done):
    """화면용 목차: 각 편·장에 PDF 쪽 범위·다 본 쪽 수를 붙인다."""
    parts = [{**p, "pdf_page": (p["page"] + offset) if p.get("page") is not None else None, "done": 0, "total": 0,
              "chapters": [{**c, "pdf_page": (c["page"] + offset) if c.get("page") is not None else None,
                            "end_pdf_page": None, "done": 0, "total": 0,
                            "sections": [{**s, "pdf_page": (s["page"] + offset) if s.get("page") is not None else None}
                                         for s in c.get("sections", [])]}
                           for c in p.get("chapters", [])]}
             for p in toc]
    for pi, ci, s, e in units(toc, offset, pages):
        total = e - s + 1
        n = sum(1 for p in done if s <= p <= e)
        if ci is None:
            parts[pi].update(end_pdf_page=e)
        else:
            parts[pi]["chapters"][ci].update(end_pdf_page=e, done=n, total=total)
        parts[pi]["done"] += n
        parts[pi]["total"] += total
    return parts


# ---- 관리자 API ----

def _get(book_id):
    try:
        uuid.UUID(book_id)
    except ValueError:
        _err(404, "not_found")
    rows = store.select("textbooks", {"id": f"eq.{book_id}", "select": SELECT})
    if not rows:
        _err(404, "not_found")
    return rows[0]


def _admin_out(row):
    out = {k: row.get(k) for k in ("id", "title", "pages", "processed", "status", "error", "page_offset",
                                   "toc_pages", "is_current", "show_students", "use_for_ai", "created_at", "updated_at")}
    out["toc"] = clean_toc(row.get("toc"), row.get("pages") or 0, row.get("page_offset") or 0)
    out["running"] = _job["book_id"] == row["id"]
    return out


@router.get("/admin/textbooks")
def list_books(user=Depends(need_admin)):
    rows = store.select("textbooks", {"select": SELECT, "order": "created_at.desc"})
    return {"items": [_admin_out(r) for r in rows], "ai_model": model_name()}


@router.get("/admin/textbooks/{book_id}")
def get_book(book_id: str, user=Depends(need_admin)):
    return _admin_out(_get(book_id))


def _save_upload(f: UploadFile):
    fd, path = tempfile.mkstemp(prefix="textbook_", suffix=".pdf")
    size = 0
    with os.fdopen(fd, "wb") as out:
        while True:
            chunk = f.file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_UPLOAD:
                out.close()
                os.remove(path)
                return None, size
            out.write(chunk)
    return path, size


@router.post("/admin/textbooks/upload")
async def upload_book(file: UploadFile = File(...), title: str = Form(""), book_id: str = Form(""),
                      user=Depends(need_admin)):
    """교재 PDF 올리기 → 뒤에서 쪽 나누기 시작. book_id 를 주면 멈춘 교재를 이어서 나눈다 (같은 PDF)."""
    if not _job_lock.acquire(blocking=False):
        _err(409, "tb_busy")
    started = False
    path = None
    try:
        path, size = await run_in_threadpool(_save_upload, file)
        if path is None:
            _err(413, "tb_too_large", max_mb=MAX_UPLOAD // (1024 * 1024))
        with open(path, "rb") as fh:
            if fh.read(5) != b"%PDF-":
                _err(415, "tb_bad_file")
        import pypdfium2 as pdfium
        try:
            pdf = pdfium.PdfDocument(path)
            n = len(pdf)
            pdf.close()
        except Exception:  # noqa: BLE001
            _err(415, "tb_bad_file")
        if n < 1 or n > MAX_PAGES:
            _err(413, "tb_too_many_pages", max=MAX_PAGES)
        if book_id:
            row = _get(book_id)
            if row.get("pages") != n:
                _err(400, "tb_different_pdf", pages=row.get("pages"))
            row = store.patch("textbooks", {"id": f"eq.{book_id}"}, {"status": "processing", "error": "", "updated_at": _now()})[0]
        else:
            name = (title.strip() or os.path.splitext(file.filename or "")[0] or "교재")[:120]
            row = store.insert_rows("textbooks", {
                "title": name, "pages": n, "processed": 0, "status": "processing", "error": "", "page_offset": 0,
                "toc": [], "toc_pages": "", "is_current": False, "show_students": True, "use_for_ai": True,
                "created_by": user["id"], "updated_at": _now()})[0]
        _job["book_id"] = row["id"]
        _start_job(row["id"], path)
        started = True
        print(f"[textbook] 올림 {row['id']} {n}쪽 {size // 1024}KB", flush=True)
        return _admin_out(row)
    finally:
        if not started:
            if path:
                try:
                    os.remove(path)
                except OSError:
                    pass
            _job["book_id"] = None
            _job_lock.release()


class SaveBook(BaseModel):
    title: str | None = None
    page_offset: int | None = None
    toc_pages: str | None = None
    toc: list | None = None
    is_current: bool | None = None
    show_students: bool | None = None
    use_for_ai: bool | None = None


@router.put("/admin/textbooks/{book_id}")
def save_book(book_id: str, body: SaveBook, user=Depends(need_admin)):
    row = _get(book_id)
    pages = row.get("pages") or 0
    fields = {"updated_at": _now()}
    if body.title is not None:
        if not body.title.strip():
            _err(400, "tb_bad_title")
        fields["title"] = body.title.strip()[:120]
    offset = row.get("page_offset") or 0
    if body.page_offset is not None:
        if abs(body.page_offset) > 500:
            _err(400, "tb_bad_offset")
        offset = fields["page_offset"] = body.page_offset
    if body.toc_pages is not None:
        if body.toc_pages.strip() and not parse_range(body.toc_pages, pages):
            _err(400, "tb_bad_pages")
        fields["toc_pages"] = body.toc_pages.strip()[:20]
    if body.toc is not None:
        fields["toc"] = clean_toc(body.toc, pages, offset)
    for k in ("show_students", "use_for_ai"):
        if getattr(body, k) is not None:
            fields[k] = getattr(body, k)
    if body.is_current is not None:
        if body.is_current:
            if row.get("status") != "ready":
                _err(400, "tb_not_ready")
            store.patch("textbooks", {"is_current": "eq.true"}, {"is_current": False})
        fields["is_current"] = body.is_current
    return _admin_out(store.patch("textbooks", {"id": f"eq.{book_id}"}, fields)[0])


class TocBody(BaseModel):
    pages: str


@router.post("/admin/textbooks/{book_id}/toc/ai")
def ai_toc(book_id: str, body: TocBody, user=Depends(need_admin)):
    """차례 쪽(예: 5-8)을 AI 가 읽어 목차를 다시 만든다 (지금 목차를 바꿈, 1분쯤)."""
    row = _get(book_id)
    pages = row.get("pages") or 0
    page_list = parse_range(body.pages, min(pages, row.get("processed") or 0))
    if not page_list:
        _err(400, "tb_bad_pages")
    try:
        toc = make_toc(book_id, page_list, row.get("page_offset") or 0, pages)
    except TocError as e:
        print("[textbook] AI 목차 실패", str(e)[:300], flush=True)
        why = str(e).split(": ", 1)[-1][:160] if e.code == "tb_ai_failed" else ""
        _err(503 if e.code == "ai_not_configured" else 502, e.code, **({"why": why} if why else {}))
    row = store.patch("textbooks", {"id": f"eq.{book_id}"},
                      {"toc": toc, "toc_pages": body.pages.strip()[:20], "updated_at": _now()})[0]
    return _admin_out(row)


@router.delete("/admin/textbooks/{book_id}")
def delete_book(book_id: str, user=Depends(need_admin)):
    row = _get(book_id)
    if _job["book_id"] == row["id"]:
        _err(409, "tb_busy")
    paths = [r["image_path"] for r in store.select("textbook_pages", {"book_id": f"eq.{book_id}", "select": "image_path"})]
    store.remove_files(BUCKET, paths)
    store.delete("textbooks", {"id": f"eq.{book_id}"})
    return {"ok": True}


# ---- 교육생·교사 API ----

def current_book():
    rows = store.select("textbooks", {"is_current": "eq.true", "status": "eq.ready", "select": SELECT, "limit": "1"})
    return rows[0] if rows else None


def can_view(user, book):
    return bool(book) and (user["role"] != "student" or bool(book.get("show_students")))


@router.get("/textbook")
def my_textbook(user=Depends(accounts.current_user)):
    """지금 쓰는 교재 + 목차 + 내 진도. 교재가 없으면 book=null."""
    book = current_book()
    if not book:
        return {"book": None}
    pages = book.get("pages") or 0
    offset = book.get("page_offset") or 0
    done = {r["page"] for r in store.select("textbook_progress", {
        "user_id": f"eq.{user['id']}", "book_id": f"eq.{book['id']}", "select": "page"})}
    last = store.select("textbook_last", {"user_id": f"eq.{user['id']}", "book_id": f"eq.{book['id']}", "select": "page"})
    toc = clean_toc(book.get("toc"), pages, offset)
    return {
        "book": {"id": book["id"], "title": book.get("title") or "", "pages": pages, "page_offset": offset},
        "can_view": can_view(user, book),
        "last_page": last[0]["page"] if last else None,
        "done_count": len(done),
        "toc": toc_with_progress(toc, offset, pages, done),
    }


@router.get("/textbook/pages")
def textbook_pages(book_id: str, start: int = Query(..., ge=1), end: int = Query(..., ge=1),
                   user=Depends(accounts.current_user)):
    """쪽 그림 주소 (한 번에 최대 40쪽, 7일짜리 서명 주소)."""
    book = _get(book_id)
    if book.get("status") != "ready" and user["role"] != "admin":
        _err(404, "not_found")
    if not (user["role"] == "admin" or (book.get("is_current") and can_view(user, book))):
        _err(403, "forbidden")
    end = min(end, start + PAGES_PER_CALL - 1, book.get("pages") or 0)
    if end < start:
        return {"items": []}
    rows = store.select("textbook_pages", {"book_id": f"eq.{book_id}", "and": f"(page.gte.{start},page.lt.{end + 1})",
                                           "select": "page,image_path,width,height", "order": "page.asc"})
    urls = store.signed_urls(BUCKET, [r["image_path"] for r in rows], SIGN_SECONDS)
    return {"items": [{"page": r["page"], "url": urls.get(r["image_path"]), "key": r["image_path"],
                       "width": r.get("width") or 0, "height": r.get("height") or 0} for r in rows]}


class ProgressBody(BaseModel):
    book_id: str
    done: list[int] = []
    last: int | None = None


@router.post("/textbook/progress")
def save_progress(body: ProgressBody, user=Depends(accounts.current_user)):
    """다 본 쪽(넘긴 쪽)과 마지막으로 보던 쪽 저장."""
    book = _get(body.book_id)
    pages = book.get("pages") or 0
    done = sorted({p for p in body.done[:300] if 1 <= p <= pages})
    if done:
        store.upsert("textbook_progress", [{"user_id": user["id"], "book_id": book["id"], "page": p} for p in done],
                     on_conflict="user_id,book_id,page", ignore=True)
    if body.last is not None and 1 <= body.last <= pages:
        store.upsert("textbook_last", [{"user_id": user["id"], "book_id": book["id"], "page": body.last, "updated_at": _now()}],
                     on_conflict="user_id,book_id")
    return {"ok": True, "saved": len(done)}
