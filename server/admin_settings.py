"""6-4: 시스템관리자 설정 (검사기준·합격 점수·리포트 한도·비밀번호 규칙)과 학습용 사진 받기 (ZIP)."""
import base64
import csv
import hashlib
import hmac
import io
import json
import os
import tempfile
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

import accounts
import scoring
import store

router = APIRouter()
KST = timezone(timedelta(hours=9))
AUTH_DEFAULT = {"password_min_length": 0, "reset_password": "0000"}
PART_SIZE = 200  # ZIP 하나에 넣는 사진 수
LINK_SECONDS = 3600  # 다운로드 링크 유효 시간
_pool = ThreadPoolExecutor(8)


def _err(status, code, **extra):
    raise HTTPException(status, {"code": code, **extra})


def need_admin(user=Depends(accounts.current_user)):
    if user["role"] != "admin":
        _err(403, "forbidden")
    return user


def _save_setting(key, value):
    now = datetime.now(timezone.utc).isoformat()
    if store.select("app_settings", {"key": f"eq.{key}", "select": "key"}):
        store.patch("app_settings", {"key": f"eq.{key}"}, {"value": value, "updated_at": now})
    else:
        store.insert_rows("app_settings", {"key": key, "value": value}, returning=False)


# ---- 검사·운영 설정 ----

def _view():
    c = scoring.criteria()
    a = accounts._setting("auth", AUTH_DEFAULT)
    d = c["defects"]["deduct"]
    return {
        "pass_score": int(c.get("pass_score", 80)),
        "width": {k: c["width"][k] for k in ("points", "full_mm", "zero_mm")},
        "straight": {k: c["straight"][k] for k in ("points", "full_mm", "zero_mm")},
        "defects": {"points": c["defects"]["points"],
                    "porosity": d.get("porosity", 10), "undercut": d.get("undercut", 10),
                    "overlap": d.get("overlap", 10), "spatter": d.get("spatter", 0),
                    "other": c["defects"].get("deduct_default", 10)},
        "crack_fail": "crack" in [x.lower() for x in c.get("fail_types") or []],
        "fail_score_cap": int(c.get("fail_score_cap", 59)),
        "report_daily_limit": int(c.get("report_daily_limit", 5)),
        "password_min_length": int(a.get("password_min_length") or 0),
        "reset_password": str(a.get("reset_password") or "0000"),
        "updated_at": c.get("_updated_at"),
        "updated_by": c.get("_updated_by"),
    }


class Rule(BaseModel):
    points: float
    full_mm: float
    zero_mm: float


class Defects(BaseModel):
    points: float
    porosity: float
    undercut: float
    overlap: float
    spatter: float
    other: float


class SettingsBody(BaseModel):
    pass_score: int
    width: Rule
    straight: Rule
    defects: Defects
    crack_fail: bool = True
    fail_score_cap: int = 59
    report_daily_limit: int
    password_min_length: int
    reset_password: str


@router.get("/admin/settings")
def get_settings(user=Depends(need_admin)):
    return _view()


@router.put("/admin/settings")
def put_settings(body: SettingsBody, user=Depends(need_admin)):
    total = body.width.points + body.straight.points + body.defects.points
    if abs(total - 100) > 0.01:
        _err(400, "points_sum", total=round(total, 1))
    for r in (body.width, body.straight):
        if r.points < 0 or r.full_mm < 0 or r.zero_mm <= r.full_mm:
            _err(400, "bad_range")
    d = body.defects
    if d.points < 0 or any(v < 0 or v > 100 for v in (d.porosity, d.undercut, d.overlap, d.spatter, d.other)):
        _err(400, "bad_value")
    if not 0 <= body.pass_score <= 100 or not 0 <= body.fail_score_cap <= 100:
        _err(400, "bad_value")
    if not 0 <= body.report_daily_limit <= 100:
        _err(400, "bad_value")
    if not 0 <= body.password_min_length <= 32:
        _err(400, "bad_value")
    reset = body.reset_password.strip()
    if not reset or len(reset) > 50:
        _err(400, "bad_reset_password")
    if len(reset) < body.password_min_length:
        _err(400, "reset_too_short", min=body.password_min_length)

    try:
        cur = store.get_setting("criteria")
    except Exception:  # noqa: BLE001
        cur = None
    cur = dict(cur) if isinstance(cur, dict) else {}
    fail_types = [x for x in (cur.get("fail_types") or ["crack"]) if x.lower() != "crack"]
    if body.crack_fail:
        fail_types = ["crack"] + fail_types
    deduct = dict((cur.get("defects") or {}).get("deduct") or {})
    deduct.update(porosity=d.porosity, undercut=d.undercut, overlap=d.overlap, spatter=d.spatter)
    cur.update({
        "pass_score": body.pass_score,
        "width": body.width.model_dump(),
        "straight": body.straight.model_dump(),
        "defects": {"points": d.points, "deduct": deduct, "deduct_default": d.other},
        "fail_types": fail_types,
        "fail_score_cap": body.fail_score_cap,
        "report_daily_limit": body.report_daily_limit,
        "_updated_at": datetime.now(timezone.utc).isoformat(),
        "_updated_by": user["name"],
    })
    cur.pop("report_unlimited_devices", None)
    _save_setting("criteria", cur)
    auth = accounts._setting("auth", AUTH_DEFAULT)
    auth.update(password_min_length=body.password_min_length, reset_password=reset)
    _save_setting("auth", auth)
    scoring.clear_cache()  # 지난 분석 점수도 새 기준으로 다시 계산된다 (점수는 볼 때마다 계산)
    return _view()


# ---- 학습용 사진 받기 ----

class ExportQuery(BaseModel):
    range: str = "all"  # all | period | new
    date_from: str | None = None  # YYYY-MM-DD (한국 날짜)
    date_to: str | None = None
    process: str = ""
    position: str = ""
    course: str = "all"


def _day_start(day):
    try:
        d = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=KST)
    except (TypeError, ValueError):
        _err(400, "bad_date")
    return d


def _last_export():
    return accounts._setting("training_export", {"last_at": None}).get("last_at")


def _rows(q: ExportQuery, select="id,created_at"):
    """받을 사진 목록 (오래된 것부터). 분석 성공·갤러리에서 내리지 않은 것만."""
    params = {"status": "eq.ok", "hidden": "is.false", "user_id": "not.is.null", "photo_path": "not.is.null",
              "select": select, "order": "created_at.asc,id.asc", "limit": "50000"}
    if q.range == "period":
        start, end = _day_start(q.date_from), _day_start(q.date_to) + timedelta(days=1)
        if end <= start:
            _err(400, "bad_date")
        params["and"] = f"(created_at.gte.{start.isoformat()},created_at.lt.{end.isoformat()})"
    elif q.range == "new":
        last = _last_export()
        if last:
            params["created_at"] = f"gt.{last}"
    elif q.range != "all":
        _err(400, "bad_range")
    if q.process:
        params["process"] = f"eq.{q.process}"
    if q.position:
        params["position"] = f"eq.{q.position}"
    if q.course != "all":
        members = [r["user_id"] for r in store.select("user_courses", {"course_id": f"eq.{q.course}", "select": "user_id"})]
        if not members:
            return []
        params["user_id"] = f"in.({','.join(members)})"
    return store.select("submissions", params)


@router.post("/admin/training-export")
def export_summary(q: ExportQuery, user=Depends(need_admin)):
    """조건에 맞는 사진 수와 나눠 받을 ZIP 목록 (각 링크는 1시간 동안 열림)."""
    rows = _rows(q, "id,created_at,labeled:result->detections->boxes")
    labeled = sum(1 for r in rows if r.get("labeled") is not None)
    exp = int(time.time()) + LINK_SECONDS
    parts = []
    for i in range(0, len(rows), PART_SIZE):
        chunk = rows[i:i + PART_SIZE]
        token = _sign({"q": q.model_dump(), "ids": [r["id"] for r in chunk], "start": i + 1, "exp": exp,
                       "by": user["id"]})
        parts.append({"index": len(parts) + 1, "first": i + 1, "last": i + len(chunk),
                      "date_from": chunk[0]["created_at"], "date_to": chunk[-1]["created_at"],
                      "path": f"/admin/training-export/download?t={token}"})
    return {"total": len(rows), "labeled": labeled, "parts": parts, "expires_at": exp,
            "last_export_at": _last_export()}


def _secret():
    key = os.environ.get("SUPABASE_SECRET_KEY") or "local-test"
    return hashlib.sha256(("training-export:" + key).encode()).digest()


def _sign(payload):
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(_secret(), raw.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{raw}.{sig}"


def _unsign(token):
    try:
        raw, sig = token.rsplit(".", 1)
        good = hmac.new(_secret(), raw.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, good):
            raise ValueError
        payload = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    except Exception:  # noqa: BLE001
        _err(403, "bad_link")
    if payload.get("exp", 0) < time.time():
        _err(410, "link_expired")
    return payload


def _courses_by_user(user_ids):
    if not user_ids:
        return {}
    rows = store.select("user_courses", {"user_id": f"in.({','.join(user_ids)})", "select": "user_id,courses(name)"})
    out = {}
    for r in rows:
        if r.get("courses"):
            out.setdefault(r["user_id"], []).append(r["courses"]["name"])
    return out


def build_zip(ids, start, path):
    """사진(번호 파일명) + COCO 라벨 + 목록표를 path 에 ZIP 으로 쓴다. 넣은 행들을 돌려준다."""
    sel = ("id,user_id,created_at,process,position,material,photo_path,"
           "boxes:result->detections->boxes,img_w:result->image->width,img_h:result->image->height")
    got = {r["id"]: r for r in store.select("submissions", {"id": f"in.({','.join(ids)})", "select": sel})}
    rows = [got[i] for i in ids if i in got]
    courses = _courses_by_user(list({r["user_id"] for r in rows}))

    def fetch(r):
        try:
            return store.download("photos", r["photo_path"])
        except Exception as e:  # noqa: BLE001 - 지워진 사진은 건너뛴다
            print("[export] 사진 받기 실패", r["id"], str(e)[:120], flush=True)
            return None

    images, anns, cats = [], [], {}
    table = io.StringIO()
    w = csv.writer(table)
    w.writerow(["number", "file", "labeled", "date_kst", "process", "position", "material", "course"])
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        for n, (r, data) in enumerate(zip(rows, _pool.map(fetch, rows)), start=start):
            if data is None:
                continue
            boxes = r.get("boxes")
            labeled = isinstance(boxes, list)
            name = f"{n:06d}.jpg"
            folder = "labeled" if labeled else "unlabeled"
            z.writestr(f"{folder}/{name}", data)
            day = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")).astimezone(KST).strftime("%Y-%m-%d %H:%M")
            w.writerow([n, f"{folder}/{name}", "yes" if labeled else "no", day, r.get("process") or "",
                        r.get("position") or "", r.get("material") or "", ", ".join(courses.get(r["user_id"], []))])
            if not labeled:
                continue
            img_id = len(images) + 1
            images.append({"id": img_id, "file_name": name, "width": r.get("img_w"), "height": r.get("img_h")})
            for b in boxes:
                cid = cats.setdefault(b["class"], len(cats) + 1)
                anns.append({"id": len(anns) + 1, "image_id": img_id, "category_id": cid,
                             "bbox": [b["x"], b["y"], b["w"], b["h"]], "area": round(b["w"] * b["h"], 1),
                             "iscrowd": 0, "segmentation": []})
        coco = {"info": {"description": "AI W.E.P training photos", "date_created": datetime.now(KST).isoformat()},
                "images": images, "annotations": anns,
                "categories": [{"id": i, "name": c, "supercategory": "weld"} for c, i in cats.items()]}
        z.writestr("labeled/_annotations.coco.json", json.dumps(coco, ensure_ascii=False))
        z.writestr("list.csv", "﻿" + table.getvalue())
        z.writestr("README.txt", README)
    return rows


README = """AI W.E.P 학습용 사진

labeled/   AI가 찾은 위치 라벨이 있는 사진 + _annotations.coco.json (COCO 형식)
           -> Roboflow 프로젝트 Upload 에 labeled 폴더를 통째로 끌어다 놓으면 라벨과 함께 올라갑니다.
           라벨은 AI가 찾은 결과라 틀린 곳이 있을 수 있으니 Roboflow 에서 확인·수정한 뒤 학습하세요.
unlabeled/ 라벨 기록이 없는 예전 사진 (사진만)
list.csv   번호별 날짜·용접법·자세·재질·반 (이름은 넣지 않음)
"""


@router.get("/admin/training-export/download")
def export_download(t: str):
    """브라우저에서 여는 다운로드 링크 (로그인 대신 1시간짜리 서명)."""
    p = _unsign(t)
    ids = [i for i in p.get("ids") or [] if isinstance(i, str)]
    if not ids:
        _err(404, "not_found")
    fd, path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    rows = build_zip(ids, int(p.get("start") or 1), path)
    # 지난번 받은 이후: 받은 사진 중 가장 최근 시각까지 받은 것으로 기록
    if rows:
        newest = max(r["created_at"] for r in rows)
        last = _last_export()
        if not last or newest > last:
            _save_setting("training_export", {"last_at": newest})
    first, last_n = int(p.get("start") or 1), int(p.get("start") or 1) + len(ids) - 1
    name = f"aiwep-training-{datetime.now(KST).strftime('%Y%m%d')}-{first:06d}-{last_n:06d}.zip"
    return FileResponse(path, media_type="application/zip", filename=name,
                        background=BackgroundTask(lambda: os.path.exists(path) and os.remove(path)))
