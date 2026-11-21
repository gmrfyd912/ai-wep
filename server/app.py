"""3단계 분석 서버: 앱에서 사진을 받아 엔진으로 분석하고 Supabase에 저장한다.

환경 변수 (Render 설정 화면에 넣는다. 코드·채팅에는 절대 넣지 않는다):
  SUPABASE_URL         예: https://xxxx.supabase.co
  SUPABASE_SECRET_KEY  Supabase 서버용 비밀 키 (sb_secret_... 또는 예전 service_role 키)
  ROBOFLOW_API_KEY     Roboflow 키

로그인은 6단계에서 붙인다. 그전까지는 휴대폰마다 앱이 만든 임시 번호(device_id)로 구분한다.
"""
import re
import uuid

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

import store
from engine.analyze import ENGINE_VERSION, analyze_image
from engine.config import Config

MAX_BYTES = 15 * 1024 * 1024
MAX_SIDE = 4000  # 이보다 큰 사진은 줄여서 분석 (앱은 약 3000px로 보낸다)
DEVICE_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
CODE_RE = re.compile(r"^[A-Za-z0-9]{1,8}$")

app = FastAPI(title="AI W.E.P analysis server")


@app.get("/health")
def health():
    return {"ok": True, "engine_version": ENGINE_VERSION, "storage": store.configured()}


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


@app.post("/analyze")
async def analyze(
    photo: UploadFile = File(...),
    device_id: str = Form(...),
    process: str = Form(""),
    position: str = Form(""),
    material: str = Form(""),
):
    _check_device(device_id)
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

    res, vis, _ = await _step("analyze", analyze_image, img, Config())

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
    return await _step("make_links", _detail, row)


def _detail(row):
    out = _summary(row)
    out["result"] = row.get("result")
    out["photo_url"] = store.signed_url("photos", row.get("photo_path"))
    out["check_url"] = store.signed_url("results", row.get("check_path"))
    return out


@app.get("/submissions")
def list_submissions(device_id: str, limit: int = 50):
    _check_device(device_id)
    rows = store.list_by_device(device_id, max(1, min(limit, 100)))
    return [_summary(r) for r in rows]


@app.get("/submissions/{sid}")
def get_submission(sid: str, device_id: str):
    _check_device(device_id)
    try:
        uuid.UUID(sid)
    except ValueError:
        raise HTTPException(404, "not_found")
    row = store.get(sid)
    if not row or row.get("device_id") != device_id:
        raise HTTPException(404, "not_found")
    return _detail(row)
