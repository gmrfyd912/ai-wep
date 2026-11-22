"""6-4b: 선급규정. 규정 파일(PDF·사진)을 올리면 AI(Claude Sonnet 5.5)가 판정 기준 초안을 뽑고,
시스템관리자가 확인·수정해서 저장한다. 적용 중인 세트 하나로 모든 결과에 '선급 예비판정'을 붙인다.

- 100점 점수·랭킹은 그대로 두고, 선급 판정은 따로 보여 준다.
- 깊이·높이·용입·뒷면처럼 사진으로 잴 수 없는 항목은 manual(교사 확인)로만 보여 준다.
- 규정 파일은 공개 저장소에 넣지 않고 Supabase 비공개 저장 공간(photos/rules/...)에만 둔다.
"""
import base64
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

import store
from admin_settings import need_admin

router = APIRouter()
DEFAULT_MODEL = "claude-sonnet-5-5"
MAX_PAGES = 20
MAX_BYTES = 20 * 1024 * 1024
CACHE_SECONDS = 60
SELECT = "id,name,society,items,manual,files,notes,active,created_at,updated_at,updated_by"

# 사진으로 판정하는 항목. kind = 결함(검출 이름에 이 글자가 있으면 그 결함) / 측정값
DEFECTS = ("crack", "porosity", "undercut", "overlap", "spatter")
MEASURES = ("width_variation", "straightness")
ITEM_FIELDS = {
    "crack": ("allowed",),
    "porosity": ("allowed", "max_diameter_mm", "max_count", "per_length_mm"),
    "undercut": ("allowed", "max_length_mm"),
    "overlap": ("allowed",),
    "spatter": ("allowed",),
    "width_variation": ("max_mm",),
    "straightness": ("max_mm",),
}


def _err(status, code, **extra):
    raise HTTPException(status, {"code": code, **extra})


def _now():
    return datetime.now(timezone.utc).isoformat()


def model_name():
    return os.environ.get("RULES_MODEL") or DEFAULT_MODEL


def empty_items():
    out = {}
    for k, fields in ITEM_FIELDS.items():
        it = {"check": False, "source": None, "note": ""}
        for f in fields:
            it[f] = False if f == "allowed" else None
        out[k] = it
    return out


# ---- 값 정리 (AI 초안·관리자 입력 모두 같은 규칙) ----

def _num(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise ValueError("bad_value")
    if f < 0 or f > 10000:
        raise ValueError("bad_value")
    return round(f, 3)


def _source(s):
    if not isinstance(s, dict):
        return None
    page = s.get("page")
    try:
        page = int(page) if page not in (None, "") else None
    except (TypeError, ValueError):
        page = None
    ref = str(s.get("ref") or "")[:200]
    quote = str(s.get("quote") or "")[:1000]
    if page is None and not ref and not quote:
        return None
    return {"page": page, "ref": ref, "quote": quote}


def clean_items(raw):
    raw = raw if isinstance(raw, dict) else {}
    out = empty_items()
    for k, fields in ITEM_FIELDS.items():
        src = raw.get(k) if isinstance(raw.get(k), dict) else {}
        it = out[k]
        it["check"] = bool(src.get("check"))
        it["note"] = str(src.get("note") or "")[:500]
        it["source"] = _source(src.get("source"))
        for f in fields:
            it[f] = bool(src.get(f)) if f == "allowed" else _num(src.get(f))
        if k == "crack":
            it["allowed"] = False  # 균열은 어느 선급에서도 허용하지 않는다
        if k == "porosity" and it["max_count"] is not None:
            it["max_count"] = int(it["max_count"])
    return out


def clean_manual(raw):
    out = []
    for m in (raw if isinstance(raw, list) else [])[:50]:
        if not isinstance(m, dict):
            continue
        name = str(m.get("name") or "").strip()[:100]
        rule = str(m.get("rule") or "").strip()[:500]
        if name or rule:
            out.append({"name": name, "rule": rule, "source": _source(m.get("source"))})
    return out


# ---- 적용 중인 세트 (1분 기억) ----

_CACHE = {"at": 0.0, "value": None, "loaded": False}


def clear_cache():
    _CACHE.update(at=0.0, value=None, loaded=False)


def active_set():
    now = time.time()
    if _CACHE["loaded"] and now - _CACHE["at"] < CACHE_SECONDS:
        return _CACHE["value"]
    value = None
    try:
        rows = store.select("rule_sets", {"active": "is.true", "select": SELECT, "limit": "1"})
        value = rows[0] if rows else None
    except Exception as e:  # noqa: BLE001 - 표가 아직 없으면 선급 판정 없이 동작
        print("[rules] 적용 세트 읽기 실패:", type(e).__name__, str(e)[:200], flush=True)
    _CACHE.update(at=now, value=value, loaded=True)
    return value


def rule_key(rs):
    """리포트가 어떤 세트로 만들어졌는지 (세트·수정 시각이 바뀌면 리포트를 다시 만든다)."""
    return f"{rs['id']}@{rs.get('updated_at')}" if rs else None


# ---- 판정 ----

def _is(kind, name):
    return kind in (name or "").lower()


def _max_in_window(positions, window):
    """비드를 따라 window(mm) 안에 들어가는 결함 수의 최댓값."""
    ps = sorted(p for p in positions if p is not None)
    best, j = 0, 0
    for i, p in enumerate(ps):
        while ps[i] - ps[j] > window:
            j += 1
        best = max(best, i - j + 1)
    return best


def judge(result, rs):
    """측정 결과(result JSON) + 규정 세트 → 선급 예비판정. 비드를 못 쟀으면 None."""
    if not rs or not isinstance(result, dict) or not result.get("bead"):
        return None
    items = clean_items(rs.get("items"))
    bead = result.get("bead") or {}
    w = bead.get("width") or {}
    st = bead.get("straightness") or {}
    defects = [d for d in (result.get("defects") or []) if isinstance(d, dict)]  # 양 끝 10mm 는 이미 빠짐
    rows = []

    def add(key, check, ok, measured, limit, unit, it, per_mm=None):
        rows.append({"key": key, "check": check, "ok": bool(ok), "measured": measured, "limit": limit,
                     "unit": unit, "per_mm": per_mm, "source": it.get("source"), "note": it.get("note") or ""})

    for k in DEFECTS:
        it = items[k]
        if not it["check"]:
            continue
        found = [d for d in defects if _is(k, d.get("type"))]
        if not it["allowed"]:
            add(k, "none", not found, len(found), 0, "count", it)
            continue
        checked = False
        if k == "porosity":
            if it["max_diameter_mm"] is not None:
                big = max([float(d.get("length_mm") or 0) for d in found], default=0.0)
                add(k, "max_diameter", big <= it["max_diameter_mm"], round(big, 2), it["max_diameter_mm"], "mm", it)
                checked = True
            if it["max_count"] is not None:
                if it["per_length_mm"]:
                    n = _max_in_window([d.get("pos_along_bead_mm") for d in found], it["per_length_mm"])
                else:
                    n = len(found)
                add(k, "count", n <= it["max_count"], n, it["max_count"], "count", it, it["per_length_mm"])
                checked = True
        if k == "undercut" and it["max_length_mm"] is not None:
            longest = max([float(d.get("length_mm") or 0) for d in found], default=0.0)
            add(k, "max_length", longest <= it["max_length_mm"], round(longest, 2), it["max_length_mm"], "mm", it)
            checked = True
        if not checked:  # 허용이고 수치 기준이 없으면 개수만 보여 준다
            add(k, "allowed", True, len(found), None, "count", it)

    it = items["width_variation"]
    if it["check"] and it["max_mm"] is not None and w.get("min_mm") is not None and w.get("max_mm") is not None:
        rng = round(float(w["max_mm"]) - float(w["min_mm"]), 2)
        add("width_variation", "max", rng <= it["max_mm"], rng, it["max_mm"], "mm", it)
    it = items["straightness"]
    if it["check"] and it["max_mm"] is not None and st.get("max_dev_mm") is not None:
        dev = round(abs(float(st["max_dev_mm"])), 2)
        add("straightness", "max", dev <= it["max_mm"], dev, it["max_mm"], "mm", it)

    manual = clean_manual(rs.get("manual"))
    if not rows and not manual:
        return None
    verdict = None if not rows else ("fail" if any(not r["ok"] for r in rows) else "pass")
    return {"set_id": rs["id"], "name": rs.get("name") or "", "society": rs.get("society") or "",
            "verdict": verdict, "items": rows, "manual": manual}


def judgment_for(result):
    return judge(result, active_set())


# ---- AI 초안 (Claude Sonnet 5.5) ----

SYSTEM = """You read welding qualification / visual inspection rules from classification societies (DNV, KR, ABS, LR, BV, ClassNK and others) and the institute's own inspection sheets.
A program measures a trainee's practice bead from a single top-view photo. It can measure ONLY:
- bead width along the bead (so: max width − min width), and straightness (max deviation of the bead centre line from a straight line), in mm
- surface defects visible from above, with their length (largest dimension, mm) and position along the bead: crack, porosity (surface pores), undercut (length only), overlap, spatter.
It CANNOT measure: depth of anything (undercut depth, pore depth), reinforcement / bead height, convexity, throat or leg size, penetration, root / back side, internal defects (RT/UT), misalignment, angular distortion, arc strikes on other faces.

Task: extract the visual acceptance criteria for a butt or fillet weld surface from the document.
- For each photo-checkable item set found=true only if the document gives a rule for it, and fill the limits exactly as written. Leave a limit null when the document gives none. Convert to mm when the document gives a clear formula with a stated thickness; otherwise put the rule into manual.
- allowed=false means any occurrence is a rejection ("not permitted", "not acceptable").
- porosity: max_diameter_mm = largest single pore allowed; max_count = pores allowed; per_length_mm = the length that count applies to (e.g. 100 mm), null if it applies to the whole weld.
- undercut: max_length_mm = longest undercut allowed. Undercut depth limits go to manual.
- width_variation: max allowed difference between widest and narrowest bead width. straightness: max allowed deviation of the bead from a straight line.
- Everything visual that the photo cannot check (depth, height, reinforcement, root, penetration, leg size, etc.) goes to manual, one entry per rule.
- source: page = 1-based page number of the uploaded file (or image order), ref = table / clause number, quote = the exact original sentence (keep the original language, at most 300 characters).
- Never invent rules. If the document is not an inspection rule, set every found=false, leave manual empty and explain in notes.
- Write name, society, rule, note and notes in Korean (짧고 쉬운 말). Keep quote in the original language."""

_SRC = {"type": "object", "additionalProperties": False, "required": ["page", "ref", "quote"],
        "properties": {"page": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                       "ref": {"type": "string"}, "quote": {"type": "string"}}}
_NUM = {"anyOf": [{"type": "number"}, {"type": "null"}]}


def _item_schema(fields):
    props = {"found": {"type": "boolean"}, "note": {"type": "string"}, "source": _SRC}
    for f in fields:
        props[f] = {"type": "boolean"} if f == "allowed" else _NUM
    return {"type": "object", "additionalProperties": False, "required": list(props), "properties": props}


SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["name", "society", "notes", "items", "manual"],
    "properties": {
        "name": {"type": "string"}, "society": {"type": "string"}, "notes": {"type": "string"},
        "items": {"type": "object", "additionalProperties": False, "required": list(ITEM_FIELDS),
                  "properties": {k: _item_schema(f) for k, f in ITEM_FIELDS.items()}},
        "manual": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["name", "rule", "source"],
            "properties": {"name": {"type": "string"}, "rule": {"type": "string"}, "source": _SRC}}},
    },
}


class ExtractError(Exception):
    def __init__(self, code, detail=""):
        super().__init__(f"{code}: {detail}")
        self.code = code


def pdf_pages(data):
    return len(re.findall(rb"/Type\s*/Page(?![s\w])", data))


def _media_type(name, ctype, data):
    if data[:4] == b"%PDF":
        return "application/pdf"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def extract(files):
    """files = [(media_type, bytes)] → AI 초안 dict. 실패하면 ExtractError."""
    import report  # ANTHROPIC_API_KEY 확인을 리포트와 같이 쓴다
    if not report.configured():
        raise ExtractError("ai_not_configured")
    import anthropic

    content = []
    for mt, data in files:
        b64 = base64.standard_b64encode(data).decode()
        if mt == "application/pdf":
            content.append({"type": "document", "source": {"type": "base64", "media_type": mt, "data": b64}})
        else:
            content.append({"type": "image", "source": {"type": "base64", "media_type": mt, "data": b64}})
    content.append({"type": "text", "text": "Extract the visual inspection acceptance criteria from the uploaded "
                    "document (pages/images in order). Return the JSON."})
    client = anthropic.Anthropic(timeout=240, max_retries=1)
    try:
        resp = client.beta.messages.create(
            model=model_name(),
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            max_tokens=16000,
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
            system=SYSTEM,
            messages=[{"role": "user", "content": content}],
        )
    except anthropic.AuthenticationError as e:
        raise ExtractError("ai_key_invalid", str(e)[:200])
    except anthropic.RateLimitError as e:
        raise ExtractError("ai_busy", str(e)[:200])
    except anthropic.APIStatusError as e:
        raise ExtractError("ai_failed", f"{e.status_code} {str(e)[:200]}")
    except anthropic.APIConnectionError as e:
        raise ExtractError("ai_failed", f"connection {str(e)[:200]}")
    if resp.stop_reason == "refusal":
        raise ExtractError("ai_failed", "refusal")
    if resp.stop_reason == "max_tokens":
        raise ExtractError("ai_failed", "max_tokens")
    text = next((b.text for b in resp.content if b.type == "text"), None)
    try:
        return json.loads(text or "")
    except json.JSONDecodeError:
        raise ExtractError("ai_failed", "bad_json")


def draft_from_ai(out):
    """AI 결과 → 저장 모양 (found → check)."""
    items = {}
    for k in ITEM_FIELDS:
        src = (out.get("items") or {}).get(k) or {}
        items[k] = {**src, "check": bool(src.get("found"))}
    return {"name": str(out.get("name") or "")[:100], "society": str(out.get("society") or "")[:100],
            "notes": str(out.get("notes") or "")[:2000],
            "items": clean_items(items), "manual": clean_manual(out.get("manual"))}


# ---- 화면용 API (시스템관리자만) ----

def _get(rid):
    try:
        uuid.UUID(rid)
    except ValueError:
        _err(404, "not_found")
    rows = store.select("rule_sets", {"id": f"eq.{rid}", "select": SELECT})
    if not rows:
        _err(404, "not_found")
    return rows[0]


def _out(row, with_files=False):
    out = {k: row.get(k) for k in ("id", "name", "society", "notes", "active", "created_at", "updated_at")}
    out["items"] = clean_items(row.get("items"))
    out["manual"] = clean_manual(row.get("manual"))
    files = row.get("files") or []
    out["files"] = [{"name": f.get("name"), "type": f.get("type"), "pages": f.get("pages"),
                     **({"url": store.signed_url("photos", f.get("path"))} if with_files else {})} for f in files]
    if row.get("updated_by"):
        u = store.select("users", {"id": f"eq.{row['updated_by']}", "select": "name"})
        out["updated_by"] = u[0]["name"] if u else None
    return out


@router.get("/admin/rules")
def list_rules(user=Depends(need_admin)):
    rows = store.select("rule_sets", {"select": SELECT, "order": "created_at.desc"})
    return {"items": [{"id": r["id"], "name": r.get("name"), "society": r.get("society"), "active": bool(r.get("active")),
                       "updated_at": r.get("updated_at"), "files": len(r.get("files") or []),
                       "checked": sum(1 for it in clean_items(r.get("items")).values() if it["check"]),
                       "manual": len(r.get("manual") or [])} for r in rows],
            "model": model_name()}


@router.get("/admin/rules/{rid}")
def get_rule(rid: str, user=Depends(need_admin)):
    return _out(_get(rid), with_files=True)


class NewRule(BaseModel):
    name: str = ""


@router.post("/admin/rules")
def create_rule(body: NewRule, user=Depends(need_admin)):
    row = store.insert_rows("rule_sets", {"name": body.name.strip()[:100], "items": empty_items(), "manual": [],
                                          "files": [], "created_by": user["id"], "updated_by": user["id"],
                                          "updated_at": _now()})[0]
    return _out(row)


@router.post("/admin/rules/extract")
def extract_rule(files: list[UploadFile] = File(...), name: str = Form(""), user=Depends(need_admin)):
    """규정 파일(PDF 또는 사진 여러 장) → AI 초안을 새 세트로 저장 (적용 안 함, 관리자가 확인 후 적용)."""
    if not files:
        _err(400, "no_files")
    got, total, pages = [], 0, 0
    for f in files:
        data = f.file.read()
        total += len(data)
        if total > MAX_BYTES:
            _err(413, "too_large", max_mb=MAX_BYTES // (1024 * 1024))
        mt = _media_type(f.filename, f.content_type, data)
        if not mt:
            _err(415, "bad_file", name=f.filename or "")
        n = max(1, pdf_pages(data)) if mt == "application/pdf" else 1
        pages += n
        if pages > MAX_PAGES:
            _err(413, "too_many_pages", max=MAX_PAGES)
        got.append((f.filename or "", mt, data, n))
    try:
        out = extract([(mt, data) for _, mt, data, _ in got])
    except ExtractError as e:
        print("[rules] AI 초안 실패", str(e)[:300], flush=True)
        _err(503 if e.code == "ai_not_configured" else 502, e.code)
    draft = draft_from_ai(out)
    rid = str(uuid.uuid4())
    stored = []
    for i, (fname, mt, data, n) in enumerate(got, 1):
        ext = {"application/pdf": "pdf", "image/png": "png", "image/webp": "webp"}.get(mt, "jpg")
        path = f"rules/{rid}/{i}.{ext}"
        store.upload("photos", path, data, content_type=mt)
        stored.append({"name": fname[:200], "type": mt, "pages": n, "path": path})
    row = store.insert_rows("rule_sets", {
        "id": rid, "name": (name.strip() or draft["name"])[:100], "society": draft["society"], "notes": draft["notes"],
        "items": draft["items"], "manual": draft["manual"], "files": stored, "active": False,
        "created_by": user["id"], "updated_by": user["id"], "updated_at": _now()})[0]
    return _out(row, with_files=True)


class SaveRule(BaseModel):
    name: str
    society: str = ""
    notes: str = ""
    items: dict
    manual: list = []


@router.put("/admin/rules/{rid}")
def save_rule(rid: str, body: SaveRule, user=Depends(need_admin)):
    row = _get(rid)
    if not body.name.strip():
        _err(400, "no_name")
    try:
        items = clean_items(body.items)
    except ValueError:
        _err(400, "bad_value")
    for k, it in items.items():
        if k == "porosity" and it["check"] and it["allowed"] and it["per_length_mm"] is not None and it["per_length_mm"] <= 0:
            _err(400, "bad_value", item=k)
    fields = {"name": body.name.strip()[:100], "society": body.society.strip()[:100], "notes": body.notes[:2000],
              "items": items, "manual": clean_manual(body.manual), "updated_by": user["id"], "updated_at": _now()}
    row = store.patch("rule_sets", {"id": f"eq.{row['id']}"}, fields)[0]
    clear_cache()
    return _out(row, with_files=True)


class Activate(BaseModel):
    active: bool


@router.post("/admin/rules/{rid}/activate")
def activate_rule(rid: str, body: Activate, user=Depends(need_admin)):
    row = _get(rid)
    now = _now()
    if body.active:
        # 하나만 적용: 다른 세트를 먼저 끈다 (DB에도 하나만 허용하는 색인이 있음)
        store.patch("rule_sets", {"active": "is.true", "id": f"neq.{row['id']}"}, {"active": False})
    store.patch("rule_sets", {"id": f"eq.{row['id']}"}, {"active": body.active, "updated_by": user["id"], "updated_at": now})
    clear_cache()
    return {"ok": True, "active": body.active}


@router.delete("/admin/rules/{rid}")
def delete_rule(rid: str, user=Depends(need_admin)):
    row = _get(rid)
    if row.get("active"):
        _err(409, "active")  # 적용 중인 세트는 먼저 해제해야 지울 수 있다
    store.remove_files("photos", [f.get("path") for f in row.get("files") or []])
    store.delete("rule_sets", {"id": f"eq.{row['id']}"})
    return {"ok": True}
