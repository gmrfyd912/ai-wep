"""3단계 분석 서버: 앱에서 사진을 받아 엔진으로 분석하고 Supabase에 저장한다.

환경 변수 (Render 설정 화면에 넣는다. 코드·채팅에는 절대 넣지 않는다):
  SUPABASE_URL         예: https://xxxx.supabase.co
  SUPABASE_SECRET_KEY  Supabase 서버용 비밀 키 (sb_secret_... 또는 예전 service_role 키)
  ROBOFLOW_API_KEY     Roboflow 키
  ANTHROPIC_API_KEY    AI 리포트(5단계)용 Anthropic 키
  BREVO_API_KEY, MAIL_FROM  아이디·비밀번호 찾기 메일 (6-1단계, mail.py 참고)

6-1단계부터 로그인한 계정으로 기록을 저장·조회한다 (accounts.py).
device_id 는 로그인 전 기록을 계정으로 가져올 때와, 한도 없는 시험용 휴대폰 확인에만 쓴다.
"""
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

import cv2
import numpy as np
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

import accounts
import admin_settings
import mail
import manage
import media
import outline_review
import social
import report
import rules
import scoring
import store
import textbook
import daily
import tutor
from engine.analyze import ENGINE_VERSION, analyze_image
from engine.config import Config

MAX_BYTES = 15 * 1024 * 1024
MAX_SIDE = 4000  # 이보다 큰 사진은 줄여서 분석 (앱은 약 3000px로 보낸다)
DEVICE_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
CODE_RE = re.compile(r"^[A-Za-z0-9]{1,8}$")
# 6-5: 평판/배관 자세 (박사 확정 2026-11-21). 평판·배관 기록은 섞지 않는다
POSITIONS = {"plate": ("1G", "2G", "3G", "4G", "1F", "2F", "3F", "4F"),
             "pipe": ("1G", "2G", "5G", "6G", "6GR", "1F", "2F", "4F", "5F")}

app = FastAPI(title="AI W.E.P analysis server")
app.include_router(accounts.router)
app.include_router(manage.router)
app.include_router(social.router)
app.include_router(admin_settings.router)
app.include_router(rules.router)
app.include_router(textbook.router)
app.include_router(daily.router)
app.include_router(tutor.router)

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
            "ai_report": report.configured(), "mail": mail.configured(), "accounts": True}


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


def _device_or_none(device_id):
    return device_id if device_id and DEVICE_RE.match(device_id) else None


def _summary(row):
    """목록·결과 화면에 쓰는 형태. 사진 주소는 1시간짜리 서명 주소."""
    out = {k: row.get(k) for k in (
        "id", "status", "process", "position", "material", "created_at", "pipe_od_mm",
        "width_mean_mm", "straight_max_dev_mm", "defect_count")}
    out["work_type"] = row.get("work_type") or "plate"  # 예전 기록은 평판
    if row.get("back_status") or back_of(row):
        out["has_back"] = True  # 목록에 "정면·이면" 표시
    return out


def _list_item(row, show_outline=False):
    """내 기록 목록: 요약 + 추이·비교·결함 통계에 쓰는 값 (그래프 배열은 넣지 않아 가볍다)."""
    out = _summary(row)
    st = row.get("outline_status") or (((row.get("result") or {}).get("outline_review") or {}).get("status"))
    if show_outline and st == "check":
        out["outline_check"] = True
    for k in ("width_std_mm", "width_min_mm", "width_max_mm"):
        out[k] = row.get(k)
    out["defect_types"] = [d.get("type") for d in (row.get("defect_types") or []) if isinstance(d, dict)]
    sc = scoring.score_of_row(out | {"status": row.get("status")})
    out["score"] = sc["score"] if sc else None
    out["verdict"] = sc["verdict"] if sc else None
    return out


async def _read_photo(photo):
    """올린 사진을 읽어 너무 크면 줄인다."""
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
    return img


def _jpg(img, quality):
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])[1].tobytes()


async def _analyze_side(img, od, on_stage):
    """한 면(정면 또는 이면) 분석 + 윤곽 2차 검토. (결과, 확인 그림) 을 돌려준다."""
    extras = {}
    res, vis, _ = await _step("analyze", analyze_image, img, Config(), None, on_stage, od, extras)
    # 윤곽 2차 검토 (Claude 비전): 측정에 쓴 가장자리가 비드 끝을 따라가는지. 실패해도 결과는 그대로 저장
    if res.get("status") == "ok" and res.get("bead") and admin_settings.outline_mode() != "off":
        try:
            res["outline_review"] = await run_in_threadpool(outline_review.review, extras.get("review_img"))
        except Exception as e:  # noqa: BLE001
            print("[analyze] 윤곽 검토 실패", str(e)[:200], flush=True)
            res["outline_review"] = {"status": "failed", "error": "exception"}
    return res, vis


def _status_of(res):
    status = res.get("status", "error")
    return "no_bead" if status == "ok" and not res.get("bead") else status


def back_allowed(work_type, position):
    """이면 사진은 평판 맞대기(G 자세)만. 필렛은 이면이 없고, 배관은 안쪽을 찍기 어렵다."""
    return work_type == "plate" and not (position or "").upper().endswith("F")


@app.post("/analyze")
async def analyze(
    photo: UploadFile = File(...),
    back_photo: UploadFile | None = File(None),
    device_id: str = Form(""),
    process: str = Form(""),
    position: str = Form(""),
    material: str = Form(""),
    job_id: str = Form(""),
    work_type: str = Form("plate"),
    pipe_od_mm: str = Form(""),
    user=Depends(accounts.current_user),
):
    device_id = _device_or_none(device_id)
    if job_id and not DEVICE_RE.match(job_id):
        raise HTTPException(400, "bad_job_id")
    _set_progress(job_id, "save_photo")
    for v in (process, position, material):
        if v and not CODE_RE.match(v):
            raise HTTPException(400, "bad_field")
    work_type = work_type or "plate"
    if work_type not in POSITIONS:
        raise HTTPException(400, "bad_work_type")
    if position and position not in POSITIONS[work_type]:
        raise HTTPException(400, "bad_position")
    if back_photo is not None and not back_allowed(work_type, position):
        raise HTTPException(400, "back_not_allowed")
    od = None
    if work_type == "pipe":  # 배관은 외경이 있어야 검사 구간(가운데 ±45°)을 정할 수 있다
        try:
            od = round(float(pipe_od_mm.replace(",", ".")), 1)
        except ValueError:
            raise HTTPException(400, "pipe_od_required")
        if not 10 <= od <= 2000:
            raise HTTPException(400, "pipe_od_required")
    img = await _read_photo(photo)
    back_img = await _read_photo(back_photo) if back_photo is not None else None

    sid = str(uuid.uuid4())
    photo_path = f"{user['id']}/{sid}.jpg"
    await _step("save_photo", store.upload, "photos", photo_path, _jpg(img, 92))
    back_photo_path = None
    if back_img is not None:
        back_photo_path = f"{user['id']}/{sid}_back.jpg"
        await _step("save_photo", store.upload, "photos", back_photo_path, _jpg(back_img, 92))
    await _step("save_record", store.insert, {
        "id": sid, "user_id": user["id"], "device_id": device_id or "-", "process": process or None,
        "position": position or None, "material": material or None,
        "work_type": work_type, "pipe_od_mm": od,
        "status": "processing", "photo_path": photo_path,
    })

    # 정면 분석
    res, vis = await _analyze_side(img, od, lambda name: _set_progress(job_id, name))

    # 이면 분석 (올렸을 때만). 결과는 정면 기록의 result.back 안에 함께 둔다 (따로 기록을 만들지 않음)
    if back_img is not None:
        _set_progress(job_id, "back")
        bres, bvis = await _analyze_side(back_img, od, lambda name: None)
        back = {"status": _status_of(bres), "photo_path": back_photo_path, "check_path": None}
        if bvis is not None:
            back["check_path"] = f"{user['id']}/{sid}_back_check.jpg"
            await _step("save_check_image", store.upload, "results", back["check_path"], _jpg(bvis, 88))
        back["result"] = bres
        res["back"] = back
    _set_progress(job_id, "save_result")

    # 갤러리용 작은 사진 (긴 변 480px)
    thumb_path = None
    try:
        thumb_path = f"{user['id']}/{sid}_thumb.jpg"
        await _step("save_photo", store.upload, "photos", thumb_path, media.thumb_bytes(img))
    except Exception as e:  # noqa: BLE001 - 작은 사진은 없어도 원본으로 보인다
        print("[analyze] 작은 사진 실패", str(e)[:200], flush=True)
        thumb_path = None

    check_path = check_thumb_path = None
    if vis is not None:
        check_path = f"{user['id']}/{sid}_check.jpg"
        await _step("save_check_image", store.upload, "results", check_path, _jpg(vis, 88))
        try:  # 목록·랭킹용 비드 이미지 (확인 그림 작은 것)
            check_thumb_path = f"{user['id']}/{sid}_check_thumb.jpg"
            await _step("save_check_image", store.upload, "results", check_thumb_path, media.check_thumb_bytes(vis))
        except Exception as e:  # noqa: BLE001
            print("[analyze] 비드 이미지 실패", str(e)[:200], flush=True)
            check_thumb_path = None

    bead = res.get("bead") or {}
    update = {
        "status": _status_of(res),
        "check_path": check_path,
        "thumb_path": thumb_path,
        "check_thumb_path": check_thumb_path,
        "result": res,
        "width_mean_mm": (bead.get("width") or {}).get("mean_mm"),
        "straight_max_dev_mm": (bead.get("straightness") or {}).get("max_dev_mm"),
        "defect_count": len(res.get("defects") or []),
    }
    row = await _step("save_result", store.update, sid, update)
    out = await _step("make_links", _detail, row, user)
    _set_progress(job_id, "done")
    return out


def _can_see_outline(user):
    """윤곽 확인 결과를 볼 수 있는지: 'all' 이면 모두, 'staff' 이면 교사·행정·관리자만."""
    mode = admin_settings.outline_mode()
    return mode == "all" or (mode == "staff" and user is not None and user.get("role") != "student")


def _strip_outline(result, user):
    if isinstance(result, dict) and "outline_review" in result and not _can_see_outline(user):
        return {k: v for k, v in result.items() if k != "outline_review"}
    return result


def back_of(row):
    """이면 결과 (올리지 않았으면 None). 정면 기록의 result.back 에 들어 있다."""
    res = row.get("result")
    back = res.get("back") if isinstance(res, dict) else None
    return back if isinstance(back, dict) and back.get("photo_path") else None


def _back_detail(row, user):
    back = back_of(row)
    if not back:
        return None
    bres = back.get("result") if isinstance(back.get("result"), dict) else {}
    bead = bres.get("bead") or {}
    status = back.get("status") or "error"
    out = {
        "status": status,
        "result": _strip_outline(bres, user),
        "photo_url": store.signed_url("photos", back.get("photo_path")),
        "check_url": store.signed_url("results", back.get("check_path")),
        "width_mean_mm": (bead.get("width") or {}).get("mean_mm"),
        "straight_max_dev_mm": (bead.get("straightness") or {}).get("max_dev_mm"),
        "defect_count": len(bres.get("defects") or []),
        "score": scoring.score_of_row({"status": status, "result": bres}),
    }
    cj = rules.judgment_for(row, "back") if status == "ok" else None
    if cj:
        out["class_judgment"] = cj
    return out


def _detail(row, user=None):
    out = _summary(row)
    res = row.get("result")
    if isinstance(res, dict) and "back" in res:
        res = {k: v for k, v in res.items() if k != "back"}
    out["result"] = _strip_outline(res, user)
    out["photo_url"] = store.signed_url("photos", row.get("photo_path"))
    out["check_url"] = store.signed_url("results", row.get("check_path"))
    out["score"] = scoring.score_of_row(row)
    cj = rules.judgment_for(row) if row.get("status") == "ok" else None
    if cj:  # 적용 중인 선급규정이 있을 때만 (6-4b)
        out["class_judgment"] = cj
    back = _back_detail(row, user)
    if back:
        out["back"] = back
    return out


def list_items(rows, bg: BackgroundTasks | None = None, user=None):
    """기록 목록 항목 + 비드 이미지. 예전 기록에 작은 그림이 없으면 뒤에서 만들어 둔다."""
    show = _can_see_outline(user)
    items = media.attach_bead([_list_item(r, show) for r in rows], rows)
    if bg is not None and media.needs_backfill(rows):
        bg.add_task(media.backfill, rows)
    return items


@app.get("/submissions")
def list_submissions(bg: BackgroundTasks, limit: int = 200, user=Depends(accounts.current_user)):
    rows = store.list_by_user(user["id"], max(1, min(limit, 500)))
    return list_items(rows, bg, user)


def _own_row(sid, user):
    """볼 수 있는 기록: 본인·담당 교사·관리자는 언제나, 그 밖의 사람은 갤러리에 있는 것 (6-3: 누구나 결과 보기)."""
    try:
        uuid.UUID(sid)
    except ValueError:
        raise HTTPException(404, "not_found")
    row = store.get(sid)
    if not social.can_view_submission(user, row):
        raise HTTPException(404, "not_found")
    return row


@app.get("/submissions/{sid}")
def get_submission(sid: str, user=Depends(accounts.current_user)):
    row = _own_row(sid, user)
    out = _detail(row, user)
    out["user_id"] = row["user_id"]
    out["can_report"] = social.can_make_report(user, row)
    if row["user_id"] != user["id"]:  # 교사 등이 학생 결과를 볼 때 화면 위에 이름 표시
        owner = store.select("users", {"id": f"eq.{row['user_id']}", "select": "id,name,avatar_path"})
        out["owner_name"] = owner[0]["name"] if owner else None
        if owner:
            av = media.avatars_of(owner).get(owner[0]["id"]) or {}
            out["owner_avatar_url"], out["owner_avatar_key"] = av.get("avatar_url"), av.get("avatar_key")
    return out


@app.get("/students/{uid}/submissions")
def list_student_submissions(uid: str, bg: BackgroundTasks, limit: int = 200, user=Depends(accounts.current_user)):
    """그 사람의 기록 목록 (랭킹·교사 보드에서). 본인·담당 교사·관리자는 전부, 그 밖의 사람은 갤러리에 있는 것만."""
    if not accounts.UUID_RE.match(uid or ""):
        raise HTTPException(404, "not_found")
    rows = store.list_by_user(uid, max(1, min(limit, 500)))
    if not manage.can_view_student(user, uid):
        rows = [r for r in rows if r.get("status") == "ok" and not r.get("hidden")]
    return list_items(rows, bg, user)


# ---- 5단계: AI 종합리포트 ----

KST = timezone(timedelta(hours=9))


class ReportRequest(BaseModel):
    device_id: str = ""
    lang: str = "ko"


def _kst_midnight_iso():
    now = datetime.now(KST)
    return now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


def _history(row, limit=10):
    """같은 계정·같은 용접법·자세의 성공한 이전 기록 (이번 것 제외, 오래된 → 최근, 최대 10개)."""
    rows = store.list_by_user(row["user_id"], 500) if row.get("user_id") else []
    same = [r for r in rows if r.get("status") == "ok" and r.get("id") != row["id"]
            and r.get("process") == row.get("process") and r.get("position") == row.get("position")
            and (r.get("work_type") or "plate") == (row.get("work_type") or "plate")
            and (r.get("created_at") or "") <= (row.get("created_at") or "")]
    same.sort(key=lambda r: r.get("created_at") or "")
    same = same[-limit:]
    for r in same:
        r["_score"] = scoring.score_of_row(r)
    return same


@app.post("/submissions/{sid}/report")
def make_report(sid: str, body: ReportRequest, user=Depends(accounts.current_user)):
    """AI 리포트 탭을 열면 부른다. 같은 사진·같은 언어로 만든 적이 있으면 저장된 것을 돌려준다(비용 0).
    없으면 하루 한도를 확인하고 새로 만든다."""
    row = _own_row(sid, user)
    lang = body.lang if body.lang in report.LANGS else "en"
    sc = scoring.score_of_row(row)
    if sc is None:
        raise HTTPException(409, {"code": "not_analyzed"})
    if not social.can_make_report(user, row):
        # 다른 사람은 만들어진 리포트만 본다 (선택한 언어 → 아무 언어나)
        saved = store.get_report(sid, lang) or store.get_any_report(sid)
        if not saved:
            raise HTTPException(404, {"code": "no_report"})
        return {"report": saved.get("report"), "score": sc, "cached": True, "lang": saved.get("lang")}
    crit = scoring.criteria()
    limit = int(crit.get("report_daily_limit", 5))
    # 하루 한도는 교육생 계정마다. 시스템관리자·교사·행정 관리자는 한도 없음
    unlimited = user["role"] in ("admin", "teacher", "staff")

    saved = store.get_report(sid, lang)
    # 검사기준이 바뀌어 점수·판정이 달라졌으면, 예전 글과 맞지 않으니 다시 만든다 (한도에 세지 않음)
    rs = rules.active_set()
    rkey = rules.rule_key(rs)
    stale = bool(saved) and (saved.get("verdict") != sc["verdict"] or saved.get("score") != sc["score"]
                             or (saved.get("report") or {}).get("_rule") != rkey)
    if saved and not stale:
        return {"report": saved.get("report"), "score": sc, "cached": True, "limit": limit}

    if not report.configured():
        if saved:  # AI를 못 쓰면 예전 글이라도 보여 준다
            return {"report": saved.get("report"), "score": sc, "cached": True, "limit": limit}
        raise HTTPException(503, {"code": "ai_not_configured"})
    used = store.count_reports_since_user(user["id"], _kst_midnight_iso())
    if not stale and not unlimited and used >= limit:
        raise HTTPException(429, {"code": "daily_limit", "limit": limit})

    back = None
    br = rules.back_result(row)
    if br:  # 이면 사진도 올렸으면 같은 리포트에 이면도 함께
        back = {"result": br, "score": scoring.score_of_row({"status": "ok", "result": br}),
                "class_judgment": rules.judgment_for(row, "back", rs)}
    data = report.build_input(row, sc, _history(row), rules.judgment_for(row, "front", rs), back)
    try:
        out, usage = report.generate(data, lang)
    except report.ReportError as e:
        print("[report] 실패", str(e)[:300], flush=True)
        raise HTTPException(503 if e.code == "ai_not_configured" else 502, {"code": e.code})
    if rkey:
        out["_rule"] = rkey
    if back:
        out["_back"] = True  # 어떤 선급규정으로 만든 글인지 (규정이 바뀌면 다시 만든다)
    new = {"submission_id": sid, "user_id": row["user_id"], "created_by": user["id"], "device_id": _device_or_none(body.device_id) or "-", "lang": lang, "model": report.model_name(),
           "report": out, "score": sc["score"], "verdict": sc["verdict"], **usage}
    if stale:
        store.update_report(saved["id"], new)
        return {"report": out, "score": sc, "cached": False, "limit": limit}
    store.insert_report(new)
    if unlimited:
        return {"report": out, "score": sc, "cached": False, "limit": limit}
    return {"report": out, "score": sc, "cached": False, "limit": limit, "remaining": max(0, limit - used - 1)}
