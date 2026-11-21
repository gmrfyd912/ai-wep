"""6-1단계: 회원가입·로그인·내 정보·비밀번호 찾기·계정 삭제.

- 로그인은 아이디 + 비밀번호. 아이디는 대소문자·앞뒤 공백을 구분하지 않는다.
- 비밀번호는 bcrypt 로 암호화해서만 저장한다. 규칙은 app_settings 'auth'.password_min_length (기본 0 = 규칙 없음).
- 로그인하면 긴 무작위 토큰을 앱에 준다. 로그아웃·계정 삭제·비밀번호 초기화 전까지 계속 유효하다.
  서버에는 토큰 원문이 아니라 SHA-256 값만 저장한다.
"""
import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

import mail
import store

router = APIRouter()

ROLES_SIGNUP = ("student", "teacher", "staff")
DEVICE_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
MAX_TEXT = 50
CODE_MINUTES = 15
CODE_GAP_SECONDS = 60
CODE_MAX_TRIES = 5


def _now():
    return datetime.now(timezone.utc)


def _err(status, code, **extra):
    raise HTTPException(status, {"code": code, **extra})


# ---- 비밀번호·토큰 ----

def hash_password(pw):
    return bcrypt.hashpw(pw.encode("utf-8")[:72], bcrypt.gensalt(rounds=10)).decode()


def check_password(pw, hashed):
    try:
        return bcrypt.checkpw(pw.encode("utf-8")[:72], hashed.encode())
    except (ValueError, TypeError):
        return False


def _token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _setting(key, default):
    try:
        v = store.get_setting(key)
    except Exception:  # noqa: BLE001
        v = None
    return {**default, **v} if isinstance(v, dict) else dict(default)


def _check_new_password(pw):
    min_len = int(_setting("auth", {"password_min_length": 0}).get("password_min_length") or 0)
    if not pw or len(pw) < max(1, min_len):
        _err(400, "password_short", min=max(1, min_len))


def login_key(login_id):
    return (login_id or "").strip().lower()


def _clean_email(email):
    email = (email or "").strip().lower()
    if not email:
        return None
    if len(email) > 200 or not EMAIL_RE.match(email):
        _err(400, "bad_email")
    return email


# ---- 사용자 ----

def _courses_of(user_id):
    rows = store.select("user_courses", {"user_id": f"eq.{user_id}", "select": "course_id,courses(id,name,sort)"})
    cs = [r["courses"] for r in rows if r.get("courses")]
    cs.sort(key=lambda c: c.get("sort") or 0)
    return [{"id": c["id"], "name": c["name"]} for c in cs]


def public_user(u):
    return {
        "id": u["id"], "login_id": u["login_id"], "name": u["name"], "role": u["role"],
        "email": u.get("email"), "status": u.get("status"),
        "must_change_password": bool(u.get("must_change_password")),
        "courses": _courses_of(u["id"]),
    }


def _new_session(user, device_id=None):
    token = secrets.token_urlsafe(32)
    store.insert_rows("sessions", {
        "token_hash": _token_hash(token), "user_id": user["id"],
        "device_id": device_id if device_id and DEVICE_RE.match(device_id) else None,
    }, returning=False)
    store.patch("users", {"id": f"eq.{user['id']}"}, {"last_login_at": _now().isoformat()})
    return {"token": token, "user": public_user(user)}


def _bearer(authorization):
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    tok = authorization[7:].strip()
    return tok or None


def current_user(authorization: str | None = Header(None)):
    """로그인한 사용자 (없으면 401). 다른 API 에서 Depends(current_user) 로 쓴다."""
    tok = _bearer(authorization)
    if not tok:
        _err(401, "login_required")
    th = _token_hash(tok)
    rows = store.select("sessions", {"token_hash": f"eq.{th}", "select": "user_id,last_seen_at,users(*)"})
    if not rows or not rows[0].get("users"):
        _err(401, "login_required")
    u = rows[0]["users"]
    if u.get("status") != "active":
        _err(403, u.get("status") or "disabled")
    try:  # 하루에 한 번쯤만 마지막 사용 시각을 고친다
        seen = datetime.fromisoformat(rows[0]["last_seen_at"].replace("Z", "+00:00"))
        if _now() - seen > timedelta(hours=12):
            store.patch("sessions", {"token_hash": f"eq.{th}"}, {"last_seen_at": _now().isoformat()})
    except Exception:  # noqa: BLE001
        pass
    u["_token_hash"] = th
    return u


def _find_by_login(login_id):
    key = login_key(login_id)
    if not key:
        return None
    rows = store.select("users", {"login_key": f"eq.{key}", "select": "*"})
    return rows[0] if rows else None


# ---- 공개 API ----

@router.get("/courses")
def list_courses():
    """가입 화면 과정 목록 (운영 중인 과정만)."""
    rows = store.select("courses", {"active": "eq.true", "select": "id,name", "order": "sort.asc,name.asc"})
    return rows


class SignupBody(BaseModel):
    login_id: str
    password: str
    name: str
    role: str
    email: str | None = None
    course_ids: list[str] = []
    device_id: str | None = None


@router.post("/auth/signup")
def signup(body: SignupBody):
    login_id = body.login_id.strip()
    name = body.name.strip()
    if not login_id or not name:
        _err(400, "required")
    if len(login_id) > MAX_TEXT or len(name) > MAX_TEXT:
        _err(400, "too_long")
    if body.role not in ROLES_SIGNUP:
        _err(400, "bad_role")
    _check_new_password(body.password)
    email = _clean_email(body.email)

    course_ids = list(dict.fromkeys(c for c in body.course_ids if UUID_RE.match(c or "")))
    if body.role == "student" and len(course_ids) != 1:
        _err(400, "course_required")
    if body.role == "teacher" and not course_ids:
        _err(400, "course_required")
    if body.role == "staff":
        course_ids = []
    if course_ids:
        ok = store.select("courses", {"id": f"in.({','.join(course_ids)})", "active": "eq.true", "select": "id"})
        if len(ok) != len(course_ids):
            _err(400, "bad_course")

    if _find_by_login(login_id):
        _err(409, "id_taken")

    rules = _setting("signup", {"student_approval": False, "staff_approval": False})
    need = rules["student_approval"] if body.role == "student" else rules["staff_approval"]
    try:
        user = store.insert_rows("users", {
            "login_id": login_id, "login_key": login_key(login_id), "password_hash": hash_password(body.password),
            "name": name, "role": body.role, "email": email, "status": "pending" if need else "active",
        })[0]
    except RuntimeError as e:
        if "23505" in str(e) or "duplicate" in str(e):  # 동시에 같은 아이디로 가입
            _err(409, "id_taken")
        raise
    if course_ids:
        store.insert_rows("user_courses", [{"user_id": user["id"], "course_id": c} for c in course_ids],
                          returning=False)
    if need:
        return {"pending": True}
    return _new_session(user, body.device_id)


class LoginBody(BaseModel):
    login_id: str
    password: str
    device_id: str | None = None


@router.post("/auth/login")
def login(body: LoginBody):
    u = _find_by_login(body.login_id)
    if not u or not check_password(body.password, u["password_hash"]):
        _err(401, "bad_login")
    if u.get("status") != "active":
        _err(403, u.get("status") or "disabled")
    return _new_session(u, body.device_id)


class FindIdBody(BaseModel):
    email: str
    lang: str = "ko"


@router.post("/auth/find-id")
def find_id(body: FindIdBody):
    """이메일로 아이디 보내기. 가입된 이메일인지 알려 주지 않으려고 결과는 항상 같다."""
    email = _clean_email(body.email)
    if not email:
        _err(400, "bad_email")
    if not mail.configured():
        _err(503, "mail_not_configured")
    rows = store.select("users", {"email": f"eq.{email}", "select": "login_id"})
    if rows:
        try:
            mail.send_ids(email, [r["login_id"] for r in rows], body.lang)
        except mail.MailError as e:
            print("[mail] 실패", str(e)[:200], flush=True)
            _err(502, "mail_failed")
    return {"sent": True}


class ForgotBody(BaseModel):
    login_id: str
    lang: str = "ko"


def _mask(email):
    name, _, domain = email.partition("@")
    return f"{name[:2]}{'*' * max(1, len(name) - 2)}@{domain}"


@router.post("/auth/forgot")
def forgot_password(body: ForgotBody):
    """비밀번호 재설정 번호(6자리)를 등록된 이메일로 보낸다."""
    u = _find_by_login(body.login_id)
    if not u:
        _err(404, "no_account")
    if not u.get("email"):
        _err(400, "no_email")
    if not mail.configured():
        _err(503, "mail_not_configured")
    last = store.select("email_codes", {"user_id": f"eq.{u['id']}", "select": "created_at",
                                        "order": "created_at.desc", "limit": "1"})
    if last:
        t = datetime.fromisoformat(last[0]["created_at"].replace("Z", "+00:00"))
        if (_now() - t).total_seconds() < CODE_GAP_SECONDS:
            _err(429, "too_soon")
    code = f"{secrets.randbelow(1_000_000):06d}"
    store.insert_rows("email_codes", {
        "user_id": u["id"], "code_hash": _token_hash(f"{u['id']}:{code}"),
        "expires_at": (_now() + timedelta(minutes=CODE_MINUTES)).isoformat(),
    }, returning=False)
    try:
        mail.send_code(u["email"], u["login_id"], code, body.lang)
    except mail.MailError as e:
        print("[mail] 실패", str(e)[:200], flush=True)
        _err(502, "mail_failed")
    return {"sent": True, "email": _mask(u["email"])}


class ResetBody(BaseModel):
    login_id: str
    code: str
    new_password: str
    device_id: str | None = None


@router.post("/auth/reset")
def reset_password(body: ResetBody):
    u = _find_by_login(body.login_id)
    if not u:
        _err(404, "no_account")
    rows = store.select("email_codes", {"user_id": f"eq.{u['id']}", "used": "eq.false",
                                        "expires_at": f"gt.{_now().isoformat()}", "select": "*",
                                        "order": "created_at.desc", "limit": "1"})
    if not rows or rows[0]["attempts"] >= CODE_MAX_TRIES:
        _err(400, "code_expired")
    row = rows[0]
    if not secrets.compare_digest(row["code_hash"], _token_hash(f"{u['id']}:{body.code.strip()}")):
        store.patch("email_codes", {"id": f"eq.{row['id']}"}, {"attempts": row["attempts"] + 1})
        _err(400, "bad_code")
    _check_new_password(body.new_password)
    store.patch("email_codes", {"id": f"eq.{row['id']}"}, {"used": True})
    store.patch("users", {"id": f"eq.{u['id']}"},
                {"password_hash": hash_password(body.new_password), "must_change_password": False})
    store.delete("sessions", {"user_id": f"eq.{u['id']}"})
    if u.get("status") != "active":
        _err(403, u.get("status") or "disabled")
    return _new_session(u, body.device_id)


# ---- 로그인한 사용자 API ----

@router.get("/me")
def me(user=Depends(current_user)):
    return public_user(user)


@router.post("/auth/logout")
def logout(user=Depends(current_user)):
    store.delete("sessions", {"token_hash": f"eq.{user['_token_hash']}"})
    return {"ok": True}


class PasswordBody(BaseModel):
    current: str = ""
    new: str


@router.post("/me/password")
def change_password(body: PasswordBody, user=Depends(current_user)):
    """비밀번호 변경. 첫 로그인·초기화 직후(must_change_password)에는 지금 비밀번호를 다시 묻지 않는다."""
    if not user.get("must_change_password") and not check_password(body.current, user["password_hash"]):
        _err(400, "wrong_password")
    _check_new_password(body.new)
    rows = store.patch("users", {"id": f"eq.{user['id']}"},
                       {"password_hash": hash_password(body.new), "must_change_password": False})
    # 다른 휴대폰에 남은 로그인은 끊는다 (지금 휴대폰은 유지)
    store.delete("sessions", {"user_id": f"eq.{user['id']}", "token_hash": f"neq.{user['_token_hash']}"})
    return public_user(rows[0] if rows else user)


class ProfileBody(BaseModel):
    email: str | None = None


@router.patch("/me")
def update_me(body: ProfileBody, user=Depends(current_user)):
    rows = store.patch("users", {"id": f"eq.{user['id']}"}, {"email": _clean_email(body.email)})
    return public_user(rows[0] if rows else user)


def _check_device(device_id):
    if not DEVICE_RE.match(device_id or ""):
        _err(400, "bad_device_id")


@router.get("/me/device-records")
def device_records(device_id: str, user=Depends(current_user)):
    """로그인 전에 이 휴대폰으로 올린(아직 계정이 없는) 기록 수."""
    _check_device(device_id)
    rows = store.select("submissions", {"device_id": f"eq.{device_id}", "user_id": "is.null", "select": "id"})
    return {"count": len(rows)}


class ClaimBody(BaseModel):
    device_id: str


@router.post("/me/claim-device")
def claim_device(body: ClaimBody, user=Depends(current_user)):
    """이 휴대폰의 로그인 전 기록을 내 계정으로 옮긴다."""
    _check_device(body.device_id)
    flt = {"device_id": f"eq.{body.device_id}", "user_id": "is.null"}
    moved = store.patch("submissions", flt, {"user_id": user["id"]})
    store.patch("reports", flt, {"user_id": user["id"]})
    return {"moved": len(moved)}


class DeleteBody(BaseModel):
    password: str


@router.post("/me/delete")
def delete_me(body: DeleteBody, user=Depends(current_user)):
    """계정 영구 삭제: 사진·분석 기록·리포트·로그인 기록을 모두 지운다."""
    if user["role"] == "admin":
        _err(403, "admin_cannot_delete")
    if not check_password(body.password, user["password_hash"]):
        _err(400, "wrong_password")
    rows = store.select("submissions", {"user_id": f"eq.{user['id']}", "select": "photo_path,check_path"})
    store.remove_files("photos", [r.get("photo_path") for r in rows])
    store.remove_files("results", [r.get("check_path") for r in rows])
    store.delete("users", {"id": f"eq.{user['id']}"})  # 기록·리포트·로그인은 함께 지워진다 (on delete cascade)
    return {"ok": True}
