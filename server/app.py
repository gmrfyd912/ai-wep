"""3단계 분석 서버: 앱에서 사진을 받아 엔진으로 분석하고 Supabase에 저장한다.

환경 변수 (Render 설정 화면에 넣는다. 코드·채팅에는 절대 넣지 않는다):
  SUPABASE_URL         예: https://xxxx.supabase.co
  SUPABASE_SECRET_KEY  Supabase 서버용 비밀 키 (sb_secret_... 또는 예전 service_role 키)
  ROBOFLOW_API_KEY     Roboflow 키
  ANTHROPIC_API_KEY    AI 리포트(5단계)용 Anthropic 키

로그인은 6단계에서 붙인다. 그전까지는 휴대폰마다 앱이 만든 임시 번호(device_id)로 구분한다.
"""
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

import report
import scoring
import store
from engine.analyze import ENGINE_VERSION, analyze_image
from engine.config import Config

MAX_BYTES = 15 * 1024 * 1024
MAX_SIDE = 4000  # 이보다 큰 사진은 줄여서 분석 (앱은 약 3000px로 보낸다)
DEVICE_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
CODE_RE = re.compile(r"^[A-Za-z0-9]{1,8}$")

app = FastAPI(title="AI W.E.P analysis server")

# 진행 단계 기록 (앱이 1초마다 조회). 서버 1대라 메모리에 둔다. 10분 지나면 지움.
PROGRESS: dict[str, tuple[str, float]] = {}


def _set_progress(job_id, stage):
    if not job_id:
        return
    now = time.time()
    PROGRESS[job_id] = (stage, now)
    for k in [k for k, (_, t) in PROGRESS.items() if now - t > 600]:
        PROGRESS.pop(k, None)


@app.get("/progress/{job_id}")
def get_progress(job_id: str):
    stage = PROGRESS.get(job_id)
    return {"stage": stage[0] if stage else None}


@app.get("/health")
def health():
    return {"ok": True, "engine_version": ENGINE_VERSION, "storage": store.configured(),
            "ai_report": report.configured()}


async def _step(name, fn, *args):
    """단계별 실행: 실패하면 원인을 짧게 앱에 돌려준다 (비밀 키는 메시지에 들어가지 않음)."""
    try:
        return await run_in_threadpool(fn, *args)
    except Exception as e:  # noqa: BLE001
        msg = f"{name}: {type(e).__name__}: {e}"[:300]
        print("[analyze] 실패", msg, flush=True)
        raise HTTPException(500, msg)


def _check_device(device_id):
    if not DEVICE_RE.match(device_id or ""):
        raise HTTPException(400, "bad_device_id")


def _summary(row):
    """목록·결과 화면에 쓰는 형태. 사진 주소는 1시간짜리 서명 주소."""
    out = {k: row.get(k) for k in (
        "id", "status", "process", "position", "material", "created_at",
        "width_mean_mm", "straight_max_dev_mm", "defect_count")}
    return out


def _list_item(row):
    """내 기록 목록: 요약 + 추이·비교·결함 통계에 쓰는 값 (그래프 배열은 넣지 않아 가볍다)."""
    out = _summary(row)
    for k in ("width_std_mm", "width_min_mm", "width_max_mm"):
        out[k] = row.get(k)
    out["defect_types"] = [d.get("type") for d in (row.get("defect_types") or []) if isinstance(d, dict)]
    sc = scoring.score_of_row(out | {"status": row.get("status")})
    out["score"] = sc["score"] if sc else None
    out["verdict"] = sc["verdict"] if sc else None
    return out


@app.post("/analyze")
async def analyze(
    photo: UploadFile = File(...),
    device_id: str = Form(...),
    process: str = Form(""),
    position: str = Form(""),
    material: str = Form(""),
    job_id: str = Form(""),
):
    _check_device(device_id)
    if job_id and not DEVICE_RE.match(job_id):
        raise HTTPException(400, "bad_job_id")
    _set_progress(job_id, "save_photo")
    for v in (process, position, material):
        if v and not CODE_RE.match(v):
            raise HTTPException(400, "bad_field")
    data = await photo.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "photo_too_large")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "image_read_failed")
    h, w = img.shape[:2]
    if max(h, w) > MAX_SIDE:
        s = MAX_SIDE / max(h, w)
        img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)

    sid = str(uuid.uuid4())
    photo_path = f"{device_id}/{sid}.jpg"
    ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    await _step("save_photo", store.upload, "photos", photo_path, jpg.tobytes())
    await _step("save_record", store.insert, {
        "id": sid, "device_id": device_id, "process": process or None,
        "position": position or None, "material": material or None,
        "status": "processing", "photo_path": photo_path,
    })

    res, vis, _ = await _step("analyze", analyze_image, img, Config(), None,
                              lambda name: _set_progress(job_id, name))
    _set_progress(job_id, "save_result")

    check_path = None
    if vis is not None:
        ok, cj = cv2.imencode(".jpg", vis, [cv2.IMWRITE_JPEG_QUALITY, 88])
        check_path = f"{device_id}/{sid}_check.jpg"
        await _step("save_check_image", store.upload, "results", check_path, cj.tobytes())

    bead = res.get("bead") or {}
    status = res.get("status", "error")
    if status == "ok" and not bead:
        status = "no_bead"
    update = {
        "status": status,
        "check_path": check_path,
        "result": res,
        "width_mean_mm": (bead.get("width") or {}).get("mean_mm"),
        "straight_max_dev_mm": (bead.get("straightness") or {}).get("max_dev_mm"),
        "defect_count": len(res.get("defects") or []),
    }
    row = await _step("save_result", store.update, sid, update)
    out = await _step("make_links", _detail, row)
    _set_progress(job_id, "done")
    return out


def _detail(row):
    out = _summary(row)
    out["result"] = row.get("result")
    out["photo_url"] = store.signed_url("photos", row.get("photo_path"))
    out["check_url"] = store.signed_url("results", row.get("check_path"))
    out["score"] = scoring.score_of_row(row)
    return out


@app.get("/submissions")
def list_submissions(device_id: str, limit: int = 200):
    _check_device(device_id)
    rows = store.list_by_device(device_id, max(1, min(limit, 500)))
    return [_list_item(r) for r in rows]


def _own_row(sid, device_id):
    _check_device(device_id)
    try:
        uuid.UUID(sid)
    except ValueError:
        raise HTTPException(404, "not_found")
    row = store.get(sid)
    if not row or row.get("device_id") != device_id:
        raise HTTPException(404, "not_found")
    return row


@app.get("/submissions/{sid}")
def get_submission(sid: str, device_id: str):
    return _detail(_own_row(sid, device_id))


# ---- 5단계: AI 종합리포트 ----

KST = timezone(timedelta(hours=9))


class ReportRequest(BaseModel):
    device_id: str
    lang: str = "ko"


def _kst_midnight_iso():
    now = datetime.now(KST)
    return now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


def _history(row, limit=10):
    """같은 기기·같은 용접법·자세의 성공한 이전 기록 (이번 것 제외, 오래된 → 최근, 최대 10개)."""
    rows = store.list_by_device(row["device_id"], 500)
    same = [r for r in rows if r.get("status") == "ok" and r.get("id") != row["id"]
            and r.get("process") == row.get("process") and r.get("position") == row.get("position")
            and (r.get("created_at") or "") <= (row.get("created_at") or "")]
    same.sort(key=lambda r: r.get("created_at") or "")
    same = same[-limit:]
    for r in same:
        r["_score"] = scoring.score_of_row(r)
    return same


@app.post("/submissions/{sid}/report")
def make_report(sid: str, body: ReportRequest):
    """AI 리포트 탭을 열면 부른다. 같은 사진·같은 언어로 만든 적이 있으면 저장된 것을 돌려준다(비용 0).
    없으면 하루 한도를 확인하고 새로 만든다."""
    row = _own_row(sid, body.device_id)
    lang = body.lang if body.lang in report.LANGS else "en"
    sc = scoring.score_of_row(row)
    if sc is None:
        raise HTTPException(409, {"code": "not_analyzed"})
    crit = scoring.criteria()
    limit = int(crit.get("report_daily_limit", 5))
    unlimited = body.device_id in (crit.get("report_unlimited_devices") or [])

    saved = store.get_report(sid, lang)
    # 검사기준이 바뀌어 점수·판정이 달라졌으면, 예전 글과 맞지 않으니 다시 만든다 (한도에 세지 않음)
    stale = bool(saved) and (saved.get("verdict") != sc["verdict"] or saved.get("score") != sc["score"])
    if saved and not stale:
        return {"report": saved.get("report"), "score": sc, "cached": True, "limit": limit}

    if not report.configured():
        if saved:  # AI를 못 쓰면 예전 글이라도 보여 준다
            return {"report": saved.get("report"), "score": sc, "cached": True, "limit": limit}
        raise HTTPException(503, {"code": "ai_not_configured"})
    used = store.count_reports_since(body.device_id, _kst_midnight_iso())
    if not stale and not unlimited and used >= limit:
        raise HTTPException(429, {"code": "daily_limit", "limit": limit})

    data = report.build_input(row, sc, _history(row))
    try:
        out, usage = report.generate(data, lang)
    except report.ReportError as e:
        print("[report] 실패", str(e)[:300], flush=True)
        raise HTTPException(503 if e.code == "ai_not_configured" else 502, {"code": e.code})
    new = {"submission_id": sid, "device_id": body.device_id, "lang": lang, "model": report.model_name(),
           "report": out, "score": sc["score"], "verdict": sc["verdict"], **usage}
    if stale:
        store.update_report(saved["id"], new)
        return {"report": out, "score": sc, "cached": False, "limit": limit}
    store.insert_report(new)
    if unlimited:
        return {"report": out, "score": sc, "cached": False, "limit": limit}
    return {"report": out, "score": sc, "cached": False, "limit": limit, "remaining": max(0, limit - used - 1)}
