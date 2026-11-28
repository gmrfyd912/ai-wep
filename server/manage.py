"""6-2단계: 과정 관리·회원 관리·가입 방식 설정, 교사 보드·행정 관리자 보드.

권한
- 시스템관리자(admin): 모두.
- 행정 관리자(staff): 모든 과정 보드·다른 교육생 결과 보기는 기본. 과정 관리·회원 관리는
  시스템관리자가 사람마다 준 권한(users.permissions.manage_courses / manage_members)이 있을 때만.
- 교사(teacher): 맡은 과정(담임·부담임)의 보드와 학생 기록. 그 과정 교육생의 가입 승인·비밀번호 초기화.
  역할 변경·반 이동은 할 수 없다.
"""
from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import accounts
import media
import scoring
import store

router = APIRouter()

KST = timezone(timedelta(hours=9))
ROLES = ("student", "teacher", "staff")
COURSE_ROLES = ("homeroom", "assistant")
PERMISSIONS = ("manage_courses", "manage_members")


def _err(status, code, **extra):
    raise HTTPException(status, {"code": code, **extra})


def _uuid(v):
    if not accounts.UUID_RE.match(v or ""):
        _err(404, "not_found")
    return v


# ---- 권한 ----

def perms(u):
    p = u.get("permissions") or {}
    return {k: bool(p.get(k)) for k in PERMISSIONS}


def can_manage_members(u):
    return u["role"] == "admin" or (u["role"] == "staff" and perms(u)["manage_members"])


def can_manage_courses(u):
    return u["role"] == "admin" or (u["role"] == "staff" and perms(u)["manage_courses"])


def course_ids_of(user_id):
    return {r["course_id"] for r in store.select("user_courses", {"user_id": f"eq.{user_id}", "select": "course_id"})}


def can_view_course(u, course_id):
    if u["role"] in ("admin", "staff"):
        return True
    return u["role"] == "teacher" and course_id in course_ids_of(u["id"])


def can_view_student(viewer, student_id):
    """학생 기록·결과를 볼 수 있는지 (본인, 관리자·행정 관리자, 같은 과정 교사)."""
    if viewer["id"] == student_id or viewer["role"] in ("admin", "staff"):
        return True
    if viewer["role"] == "teacher":
        return bool(course_ids_of(viewer["id"]) & course_ids_of(student_id))
    return False


def kick(user_ids):
    """회원 정보(역할·반·권한·상태)가 바뀐 회원의 로그인을 끊는다. 앱이 알아채고 다시 로그인하게 한다."""
    ids = [u for u in dict.fromkeys(user_ids) if u]
    if ids:
        store.delete("sessions", {"user_id": f"in.({','.join(ids)})"})


def _get_user(uid):
    rows = store.select("users", {"id": f"eq.{_uuid(uid)}", "select": "*"})
    if not rows:
        _err(404, "not_found")
    return rows[0]


def _can_care(viewer, target):
    """가입 승인·비밀번호 초기화: 회원 관리 권한자, 또는 같은 과정 교사(교육생만)."""
    if target["role"] == "admin":
        return False
    if can_manage_members(viewer):
        return True
    return (viewer["role"] == "teacher" and target["role"] == "student"
            and bool(course_ids_of(viewer["id"]) & course_ids_of(target["id"])))


def need_members(user=Depends(accounts.current_user)):
    if not can_manage_members(user):
        _err(403, "forbidden")
    return user


def need_courses(user=Depends(accounts.current_user)):
    if not can_manage_courses(user):
        _err(403, "forbidden")
    return user


# ---- 회원 정보 ----

def _member(u, courses_by_user):
    return {
        "id": u["id"], "login_id": u["login_id"], "name": u["name"], "role": u["role"],
        "status": u.get("status"), "email": u.get("email"), "permissions": perms(u),
        "courses": courses_by_user.get(u["id"], []),
        "created_at": u.get("created_at"), "last_login_at": u.get("last_login_at"),
    }


def _courses_by_user(user_ids=None):
    params = {"select": "user_id,course_role,courses(id,name,active,sort)"}
    if user_ids is not None:
        if not user_ids:
            return {}
        params["user_id"] = f"in.({','.join(user_ids)})"
    out = {}
    for r in store.select("user_courses", params):
        c = r.get("courses")
        if c:
            out.setdefault(r["user_id"], []).append(
                {"id": c["id"], "name": c["name"], "course_role": r.get("course_role"), "sort": c.get("sort") or 0})
    for lst in out.values():
        lst.sort(key=lambda c: c["sort"])
        for c in lst:
            c.pop("sort", None)
    return out


# ---- 과정 관리 ----

@router.get("/manage/courses")
def manage_list_courses(user=Depends(accounts.current_user)):
    """모든 과정(종료 포함) + 담임·부담임 + 교육생 수. 과정 관리 권한자, 회원 관리 권한자(반 이동용)."""
    if not (can_manage_courses(user) or can_manage_members(user)):
        _err(403, "forbidden")
    courses = store.select("courses", {"select": "id,name,active,sort", "order": "sort.asc,name.asc"})
    links = store.select("user_courses", {"select": "course_id,course_role,users(id,name,role,status)"})
    for c in courses:
        mine = [r for r in links if r["course_id"] == c["id"] and r.get("users")]
        c["teachers"] = [{"id": r["users"]["id"], "name": r["users"]["name"], "course_role": r.get("course_role")}
                         for r in mine if r["users"]["role"] == "teacher"]
        c["teachers"].sort(key=lambda t: (t["course_role"] != "homeroom", t["name"]))
        c["student_count"] = sum(1 for r in mine if r["users"]["role"] == "student")
    return courses


class CourseBody(BaseModel):
    name: str


@router.post("/manage/courses")
def manage_add_course(body: CourseBody, user=Depends(need_courses)):
    name = body.name.strip()
    if not name or len(name) > accounts.MAX_TEXT:
        _err(400, "required")
    if store.select("courses", {"name": f"eq.{name}", "select": "id"}):
        _err(409, "course_exists")
    top = store.select("courses", {"select": "sort", "order": "sort.desc", "limit": "1"})
    row = store.insert_rows("courses", {"name": name, "sort": (top[0]["sort"] + 1) if top else 1})[0]
    return {**row, "teachers": [], "student_count": 0}


class CoursePatch(BaseModel):
    name: str | None = None
    active: bool | None = None


@router.patch("/manage/courses/{cid}")
def manage_update_course(cid: str, body: CoursePatch, user=Depends(need_courses)):
    fields = {}
    if body.name is not None:
        name = body.name.strip()
        if not name or len(name) > accounts.MAX_TEXT:
            _err(400, "required")
        other = store.select("courses", {"name": f"eq.{name}", "select": "id"})
        if other and other[0]["id"] != cid:
            _err(409, "course_exists")
        fields["name"] = name
    if body.active is not None:
        fields["active"] = body.active
    rows = store.patch("courses", {"id": f"eq.{_uuid(cid)}"}, fields) if fields else \
        store.select("courses", {"id": f"eq.{cid}", "select": "*"})
    if not rows:
        _err(404, "not_found")
    return rows[0]


class TeacherItem(BaseModel):
    user_id: str
    course_role: str


class TeachersBody(BaseModel):
    teachers: list[TeacherItem]


@router.put("/manage/courses/{cid}/teachers")
def manage_set_teachers(cid: str, body: TeachersBody, user=Depends(need_courses)):
    """과정의 담임(1명)·부담임(여러 명)을 통째로 정한다."""
    _uuid(cid)
    if not store.select("courses", {"id": f"eq.{cid}", "select": "id"}):
        _err(404, "not_found")
    items = {}
    for t in body.teachers:
        if t.course_role not in COURSE_ROLES:
            _err(400, "bad_role")
        items[_uuid(t.user_id)] = t.course_role
    if sum(1 for r in items.values() if r == "homeroom") > 1:
        _err(400, "one_homeroom")
    if items:
        ok = store.select("users", {"id": f"in.({','.join(items)})", "role": "eq.teacher", "select": "id"})
        if len(ok) != len(items):
            _err(400, "not_teacher")
    # 이 과정의 기존 교사 연결을 지우고 새로 넣는다 (교육생 연결은 그대로)
    current = store.select("user_courses", {"course_id": f"eq.{cid}", "select": "user_id,course_role,users(role)"})
    before = {}
    for r in current:
        if (r.get("users") or {}).get("role") == "teacher":
            before[r["user_id"]] = r.get("course_role")
            store.delete("user_courses", {"course_id": f"eq.{cid}", "user_id": f"eq.{r['user_id']}"})
    if items:
        store.insert_rows("user_courses", [{"user_id": u, "course_id": cid, "course_role": r} for u, r in items.items()],
                          returning=False)
    # 담당이 생기거나 빠지거나 담임/부담임이 바뀐 교사는 다시 로그인
    kick([u for u in set(before) | set(items) if before.get(u) != items.get(u)])
    return {"ok": True}


# ---- 회원 관리 ----

@router.get("/manage/members")
def manage_list_members(user=Depends(accounts.current_user)):
    """회원 관리 권한자(과정 관리 권한자는 담임 지정용으로 보기만)는 전체(시스템관리자 계정 제외),
    교사는 맡은 과정 교육생만."""
    if can_manage_members(user) or can_manage_courses(user):
        users = store.select("users", {"role": "neq.admin", "select": "*", "order": "created_at.desc"})
    elif user["role"] == "teacher":
        cids = course_ids_of(user["id"])
        if not cids:
            return []
        links = store.select("user_courses", {"course_id": f"in.({','.join(cids)})", "select": "user_id"})
        ids = list({r["user_id"] for r in links})
        users = store.select("users", {"id": f"in.({','.join(ids)})", "role": "eq.student", "select": "*",
                                       "order": "created_at.desc"}) if ids else []
    else:
        _err(403, "forbidden")
    cbu = _courses_by_user([u["id"] for u in users])
    return [_member(u, cbu) for u in users]


@router.get("/manage/members/{uid}")
def manage_get_member(uid: str, user=Depends(accounts.current_user)):
    target = _get_user(uid)
    if not (_can_care(user, target) or (can_manage_members(user) and target["role"] != "admin")):
        _err(404, "not_found")
    return _member(target, _courses_by_user([target["id"]]))


@router.post("/manage/members/{uid}/approve")
def manage_approve(uid: str, user=Depends(accounts.current_user)):
    target = _get_user(uid)
    if not _can_care(user, target):
        _err(403, "forbidden")
    store.patch("users", {"id": f"eq.{target['id']}"}, {"status": "active"})
    return manage_get_member(uid, user)


@router.post("/manage/members/{uid}/reset-password")
def manage_reset_password(uid: str, user=Depends(accounts.current_user)):
    """기본 비밀번호(설정값, 기본 0000)로 초기화 → 다음 로그인 때 새 비밀번호를 정하게 한다."""
    target = _get_user(uid)
    if not _can_care(user, target):
        _err(403, "forbidden")
    pw = str(accounts._setting("auth", {"reset_password": "0000"}).get("reset_password") or "0000")
    store.patch("users", {"id": f"eq.{target['id']}"},
                {"password_hash": accounts.hash_password(pw), "must_change_password": True})
    store.delete("sessions", {"user_id": f"eq.{target['id']}"})  # 쓰던 휴대폰은 로그아웃
    return {"ok": True, "password": pw}


class MemberPatch(BaseModel):
    role: str | None = None
    course_ids: list[str] | None = None
    status: str | None = None
    permissions: dict | None = None


@router.patch("/manage/members/{uid}")
def manage_update_member(uid: str, body: MemberPatch, user=Depends(need_members)):
    """역할·과정(반 이동)·사용 중지·행정 관리자 권한. 회원 관리 권한자만."""
    target = _get_user(uid)
    if target["role"] == "admin":
        _err(403, "forbidden")
    if target["id"] == user["id"] and (body.role is not None or body.status is not None or body.permissions is not None):
        _err(400, "not_self")  # 자기 권한을 스스로 바꾸지 않게
    fields = {}
    role = target["role"]
    if body.role is not None:
        if body.role not in ROLES:
            _err(400, "bad_role")
        role = fields["role"] = body.role
    if body.status is not None:
        if body.status not in ("active", "disabled"):
            _err(400, "bad_status")
        fields["status"] = body.status
        if body.status == "active" and target.get("status") == "graduated":
            # 수료로 막힌 계정을 다시 열면, 오래 안 들어왔다고 바로 다시 막히지 않게
            fields["last_login_at"] = datetime.now(timezone.utc).isoformat()
    if body.permissions is not None:
        if user["role"] != "admin":  # 추가 권한은 시스템관리자만 준다
            _err(403, "forbidden")
        fields["permissions"] = {k: bool(body.permissions.get(k)) for k in PERMISSIONS}
    changed = False
    if fields:
        store.patch("users", {"id": f"eq.{target['id']}"}, fields)
        changed = (fields.get("role", target["role"]) != target["role"]
                   or fields.get("status", target.get("status")) != target.get("status")
                   or ("permissions" in fields and fields["permissions"] != {k: bool((target.get("permissions") or {}).get(k)) for k in PERMISSIONS}))

    if body.course_ids is not None or body.role is not None:
        ids = body.course_ids
        if ids is None:  # 역할만 바뀜: 기존 과정 유지 (행정 관리자가 되면 과정 없음)
            ids = [c["id"] for c in _courses_by_user([target["id"]]).get(target["id"], [])]
        ids = list(dict.fromkeys(_uuid(c) for c in ids))
        if role == "staff":
            ids = []
        if role == "student" and len(ids) != 1:
            _err(400, "course_required")
        if ids and len(store.select("courses", {"id": f"in.({','.join(ids)})", "select": "id"})) != len(ids):
            _err(400, "bad_course")
        old = {c["id"]: c.get("course_role") for c in _courses_by_user([target["id"]]).get(target["id"], [])}
        new = {c: (old.get(c) or "assistant") if role == "teacher" else None for c in ids}
        store.delete("user_courses", {"user_id": f"eq.{target['id']}"})
        if ids:
            store.insert_rows("user_courses", [
                {"user_id": target["id"], "course_id": c, "course_role": r} for c, r in new.items()],
                returning=False)
        changed = changed or old != new
    if changed:
        kick([target["id"]])
    return manage_get_member(uid, user)


# ---- 가입 방식 설정 ----

class SignupSettings(BaseModel):
    student_approval: bool
    staff_approval: bool
    avatar_required: bool = True


@router.get("/manage/settings/signup")
def get_signup_settings(user=Depends(need_members)):
    return accounts._setting("signup", accounts.SIGNUP_DEFAULT)


@router.put("/manage/settings/signup")
def put_signup_settings(body: SignupSettings, user=Depends(need_members)):
    value = {"student_approval": body.student_approval, "staff_approval": body.staff_approval,
             "avatar_required": body.avatar_required}
    if store.select("app_settings", {"key": "eq.signup", "select": "key"}):
        store.patch("app_settings", {"key": "eq.signup"}, {"value": value, "updated_at": datetime.now(timezone.utc).isoformat()})
    else:
        store.insert_rows("app_settings", {"key": "signup", "value": value}, returning=False)
    return value


# ---- 보드 ----

def week_start_iso(now=None):
    """이번 주 월요일 0시 (한국 시간)."""
    now = (now or datetime.now(KST)).astimezone(KST)
    monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return monday.isoformat()


def _subs_of(user_ids, limit=5000):
    if not user_ids:
        return []
    return store.select("submissions", {"user_id": f"in.({','.join(user_ids)})", "select": store.LIST_SELECT,
                                        "order": "created_at.desc", "limit": str(limit)})


def _scored(rows, crit):
    """성공한 분석만, 최근 → 오래된 순, 점수 붙임."""
    out = []
    for r in rows:
        sc = scoring.score_of_row(r, crit)
        if sc:
            out.append((r, sc["score"]))
    return out


def _trend(scores):
    """최근 점수 vs 그 전 5개 평균. 3점 넘게 오르면 up, 내리면 down."""
    if len(scores) < 2:
        return "flat"
    prev = scores[1:6]
    diff = scores[0] - sum(prev) / len(prev)
    return "up" if diff > 3 else "down" if diff < -3 else "flat"


def _frequent_defect(rows):
    c = Counter()
    for r in rows:
        for d in r.get("defect_types") or []:
            t = (d.get("type") if isinstance(d, dict) else d) or ""
            if t:
                c[t.lower()] += 1
    return c.most_common(1)[0][0] if c else None


def _students_of(course_id):
    links = store.select("user_courses", {"course_id": f"eq.{course_id}",
                                          "select": "user_id,course_role,users(id,name,login_id,role,status,avatar_path)"})
    students = [r["users"] for r in links if r.get("users") and r["users"]["role"] == "student"]
    teachers = [{"id": r["users"]["id"], "name": r["users"]["name"], "course_role": r.get("course_role")}
                for r in links if r.get("users") and r["users"]["role"] == "teacher"]
    teachers.sort(key=lambda t: (t["course_role"] != "homeroom", t["name"]))
    return students, teachers


@router.get("/boards/courses")
def board_courses(user=Depends(accounts.current_user)):
    """과정 카드: 교육생 수, 이번 주 제출, 평균 점수, 담임·부담임.
    시스템관리자·행정 관리자는 운영 중인 모든 과정, 교사는 맡은 과정."""
    if user["role"] in ("admin", "staff"):
        courses = store.select("courses", {"active": "eq.true", "select": "id,name,sort", "order": "sort.asc,name.asc"})
    elif user["role"] == "teacher":
        cids = course_ids_of(user["id"])
        courses = store.select("courses", {"id": f"in.({','.join(cids)})", "select": "id,name,sort,active",
                                           "order": "sort.asc,name.asc"}) if cids else []
    else:
        _err(403, "forbidden")
    crit = scoring.criteria()
    week = week_start_iso()
    out = []
    for c in courses:
        students, teachers = _students_of(c["id"])
        rows = _subs_of([s["id"] for s in students if s["status"] == "active"])
        scored = _scored(rows, crit)
        out.append({
            "id": c["id"], "name": c["name"], "teachers": teachers,
            "student_count": sum(1 for s in students if s["status"] == "active"),
            "pending_count": sum(1 for s in students if s["status"] == "pending"),
            "weekly_submissions": sum(1 for r in rows if (r.get("created_at") or "") >= week),
            "avg_score": round(sum(s for _, s in scored) / len(scored)) if scored else None,
        })
    return out


@router.get("/boards/courses/{cid}")
def board_course(cid: str, user=Depends(accounts.current_user)):
    """교사 보드: 교육생 카드 (이번 주 제출, 최근·평균 점수, 추이, 자주 나오는 결함)."""
    _uuid(cid)
    if not can_view_course(user, cid):
        _err(404, "not_found")
    course = store.select("courses", {"id": f"eq.{cid}", "select": "id,name,active"})
    if not course:
        _err(404, "not_found")
    students, teachers = _students_of(cid)
    crit = scoring.criteria()
    week = week_start_iso()
    rows = _subs_of([s["id"] for s in students])
    by_user = {}
    for r in rows:
        by_user.setdefault(r["user_id"], []).append(r)
    avatars = media.avatars_of(students)
    cards = []
    for s in students:
        mine = by_user.get(s["id"], [])
        scored = _scored(mine, crit)
        scores = [sc for _, sc in scored]
        cards.append({
            "id": s["id"], "name": s["name"], "login_id": s["login_id"], "status": s["status"],
            "total": len(mine),
            "week_count": sum(1 for r in mine if (r.get("created_at") or "") >= week),
            "last_score": scores[0] if scores else None,
            "avg_score": round(sum(scores) / len(scores)) if scores else None,
            "trend": _trend(scores),
            "frequent_defect": _frequent_defect([r for r, _ in scored]),
            "last_at": mine[0]["created_at"] if mine else None,
            **(avatars.get(s["id"]) or {}),
        })
    # 승인 대기 먼저, 그다음 이름순
    cards.sort(key=lambda c: (c["status"] != "pending", c["name"]))
    active = [c for c in cards if c["status"] == "active"]
    all_scores = [c["avg_score"] for c in active if c["avg_score"] is not None]
    return {
        "course": course[0], "teachers": teachers, "students": cards,
        "summary": {
            "student_count": len(active),
            "weekly_submissions": sum(c["week_count"] for c in active),
            "avg_score": round(sum(all_scores) / len(all_scores)) if all_scores else None,
        },
        "can_care": can_manage_members(user) or user["role"] == "teacher",
    }


@router.get("/students/{uid}")
def student_info(uid: str, user=Depends(accounts.current_user)):
    """교육생 기록 화면 머리글: 이름·과정·내가 할 수 있는 일."""
    target = _get_user(uid)
    if target["role"] == "admin":
        _err(404, "not_found")
    if target["role"] != "student" or not can_view_student(user, target["id"]):
        # 6-3: 누구나 랭킹·갤러리에서 기록을 볼 수 있다 → 이름·역할·과정만
        courses = _courses_by_user([target["id"]]).get(target["id"], [])
        return {"id": target["id"], "name": target["name"], "role": target["role"], "courses": courses,
                "can_care": False, "can_edit": False, **(media.avatars_of([target]).get(target["id"]) or {})}
    m = _member(target, _courses_by_user([target["id"]]))
    m.update(media.avatars_of([target]).get(target["id"]) or {})
    m["can_care"] = _can_care(user, target)
    m["can_edit"] = can_manage_members(user)
    return m
