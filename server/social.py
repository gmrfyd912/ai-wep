"""6-3단계: 갤러리·반응·댓글·알림·랭킹.

- 분석에 성공한 사진은 누구 것이든 자동으로 갤러리에 올라간다 (교사·관리자가 내린 것만 빠짐).
- 로그인한 사람은 과정·역할과 상관없이 갤러리의 결과와 AI 리포트를 볼 수 있다.
- 반응은 6가지 중 하나, 댓글은 한 단계 대댓글까지. 댓글·대댓글이 달리면 앱 안 알림.
- 랭킹: 교육생만, 기간 안 최고 점수, 같은 용접법·자세끼리, 반별/전과정.
"""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

import accounts
import manage
import media
import scoring
import store

router = APIRouter()

EMOJIS = ("heart", "thumbs", "check", "smile", "wow", "sad")
COMMENT_MAX = 500
GALLERY_PAGE = 12
_pool = ThreadPoolExecutor(max_workers=6)


def _err(status, code, **extra):
    raise HTTPException(status, {"code": code, **extra})


def _uuid(v):
    try:
        return str(uuid.UUID(str(v)))
    except ValueError:
        _err(404, "not_found")


def _in(ids):
    return f"in.({','.join(ids)})"


def can_moderate(viewer, owner_id):
    """갤러리 글·댓글 내리기: 시스템관리자·행정 관리자는 전체, 교사는 자기 반 사람 것."""
    if viewer["role"] in ("admin", "staff"):
        return True
    if viewer["role"] == "teacher":
        return viewer["id"] == owner_id or bool(manage.course_ids_of(viewer["id"]) & manage.course_ids_of(owner_id))
    return False


def can_view_submission(viewer, row):
    """결과 보기: 본인·담당 교사·관리자는 언제나, 그 밖의 사람은 갤러리에 있는(성공·내리지 않은) 것."""
    if not row or not row.get("user_id"):
        return False
    if manage.can_view_student(viewer, row["user_id"]):
        return True
    return row.get("status") == "ok" and not row.get("hidden")


def can_make_report(viewer, row):
    """AI 리포트 새로 만들기: 본인, 담당 교사, 시스템관리자·행정 관리자 (다른 사람은 만들어진 것만 봄)."""
    return manage.can_view_student(viewer, row["user_id"])


def _users(ids):
    ids = [i for i in dict.fromkeys(ids) if i]
    if not ids:
        return {}
    rows = store.select("users", {"id": _in(ids), "select": "id,name,role,avatar_path"})
    av = media.avatars_of(rows)
    return {u["id"]: {**u, **(av.get(u["id"]) or {})} for u in rows}


def _courses_of(ids):
    """사람별 과정 이름 목록."""
    ids = [i for i in dict.fromkeys(ids) if i]
    if not ids:
        return {}
    links = store.select("user_courses", {"user_id": _in(ids), "select": "user_id,course_id,courses(id,name,sort)"})
    out = {}
    for r in links:
        c = r.get("courses")
        if c:
            out.setdefault(r["user_id"], []).append(c)
    return {k: [c["name"] for c in sorted(v, key=lambda c: (c.get("sort") or 0, c["name"]))] for k, v in out.items()}


def _get_row(sid):
    row = store.get(_uuid(sid))
    if not row:
        _err(404, "not_found")
    return row


def _viewable(sid, user):
    row = _get_row(sid)
    if not can_view_submission(user, row):
        _err(404, "not_found")
    return row


# ---- 갤러리 ----

@router.get("/gallery")
def gallery(bg: BackgroundTasks, course: str = "all", process: str = "", position: str = "", before: str = "",
            limit: int = GALLERY_PAGE, work_type: str = "", user=Depends(accounts.current_user)):
    """갤러리 목록 (최근 → 예전). course = all 또는 과정 id. before = 이 시각보다 예전 것 (더 보기)."""
    params = {"status": "eq.ok", "hidden": "is.false", "user_id": "not.is.null",
              "select": store.LIST_SELECT,
              "order": "created_at.desc", "limit": str(max(1, min(limit, 60)))}
    if process:
        params["process"] = f"eq.{process}"
    if position:
        params["position"] = f"eq.{position}"
    if work_type in ("plate", "pipe"):  # 비면 평판·배관 모두
        params["work_type"] = f"eq.{work_type}"
    if before:
        params["created_at"] = f"lt.{before}"
    if course != "all":
        cid = _uuid(course)
        members = [r["user_id"] for r in store.select("user_courses", {"course_id": f"eq.{cid}", "select": "user_id"})]
        if not members:
            return {"items": [], "more": False}
        params["user_id"] = _in(members)
    rows = store.select("submissions", params)
    ids = [r["id"] for r in rows]
    uids = [r["user_id"] for r in rows]
    # 서로 상관없는 조회는 동시에 (응답 시간 줄이기)
    f_users = _pool.submit(_users, uids)
    f_courses = _pool.submit(_courses_of, uids)
    f_react = _pool.submit(lambda: store.select("reactions", {"submission_id": _in(ids), "select": "submission_id,user_id,emoji"}) if ids else [])
    f_comm = _pool.submit(lambda: store.select("comments", {"submission_id": _in(ids), "select": "submission_id"}) if ids else [])
    f_thumbs = _pool.submit(media.sign, "photos", [r.get("thumb_path") or r.get("photo_path") for r in rows])
    users, courses, reactions, comments, thumbs = (f.result() for f in (f_users, f_courses, f_react, f_comm, f_thumbs))
    if media.needs_backfill(rows):
        bg.add_task(media.backfill, rows)
    crit = scoring.criteria()
    items = []
    for r in rows:
        sc = scoring.score_of_row(r, crit)
        rs = [x for x in reactions if x["submission_id"] == r["id"]]
        u = users.get(r["user_id"]) or {}
        items.append({
            "id": r["id"], "user_id": r["user_id"], "name": u.get("name"), "role": u.get("role"),
            "courses": courses.get(r["user_id"], []),
            "process": r.get("process"), "position": r.get("position"), "material": r.get("material"),
            "work_type": r.get("work_type") or "plate", "pipe_od_mm": r.get("pipe_od_mm"),
            "created_at": r.get("created_at"),
            "score": sc["score"] if sc else None, "verdict": sc["verdict"] if sc else None,
            "photo_url": thumbs.get(r.get("thumb_path") or r.get("photo_path")),
            "photo_key": r.get("thumb_path") or r.get("photo_path"),
            "avatar_url": u.get("avatar_url"), "avatar_key": u.get("avatar_key"),
            "reactions": _count(rs), "my_reaction": next((x["emoji"] for x in rs if x["user_id"] == user["id"]), None),
            "comment_count": sum(1 for c in comments if c["submission_id"] == r["id"]),
        })
    return {"items": items, "more": len(rows) >= int(params["limit"])}


def _count(rs):
    out = {}
    for x in rs:
        out[x["emoji"]] = out.get(x["emoji"], 0) + 1
    return out


class HideBody(BaseModel):
    hidden: bool


@router.post("/submissions/{sid}/hide")
def hide(sid: str, body: HideBody, user=Depends(accounts.current_user)):
    """갤러리에서 내리기/다시 올리기 (교사는 자기 반, 관리자는 전체)."""
    row = _get_row(sid)
    if not can_moderate(user, row["user_id"]):
        _err(403, "forbidden")
    store.update(row["id"], {"hidden": body.hidden})
    return {"ok": True, "hidden": body.hidden}


# ---- 반응·댓글 ----

def _comment_out(c, users, user, owner_id):
    u = users.get(c["user_id"]) or {}
    return {
        "id": c["id"], "parent_id": c.get("parent_id"), "user_id": c["user_id"], "name": u.get("name"),
        "avatar_url": u.get("avatar_url"), "avatar_key": u.get("avatar_key"),
        "role": u.get("role"), "body": c["body"], "created_at": c.get("created_at"),
        "can_delete": c["user_id"] == user["id"] or can_moderate(user, owner_id),
    }


@router.get("/submissions/{sid}/social")
def social(sid: str, user=Depends(accounts.current_user)):
    """결과 화면 아래: 반응 수·내 반응·댓글(오래된 → 최근)."""
    row = _viewable(sid, user)
    rs = store.select("reactions", {"submission_id": f"eq.{row['id']}", "select": "user_id,emoji"})
    cs = store.select("comments", {"submission_id": f"eq.{row['id']}", "select": "*", "order": "created_at.asc"})
    users = _users([c["user_id"] for c in cs])
    return {
        "reactions": _count(rs),
        "my_reaction": next((x["emoji"] for x in rs if x["user_id"] == user["id"]), None),
        "comments": [_comment_out(c, users, user, row["user_id"]) for c in cs],
        "hidden": bool(row.get("hidden")),
        "can_moderate": can_moderate(user, row["user_id"]),
    }


class ReactionBody(BaseModel):
    emoji: str | None = None


@router.put("/submissions/{sid}/reaction")
def set_reaction(sid: str, body: ReactionBody, user=Depends(accounts.current_user)):
    """반응 고르기 (한 사람 하나, 같은 걸 다시 누르면 앱이 emoji=None 으로 지움)."""
    row = _viewable(sid, user)
    if body.emoji is not None and body.emoji not in EMOJIS:
        _err(400, "bad_emoji")
    store.delete("reactions", {"submission_id": f"eq.{row['id']}", "user_id": f"eq.{user['id']}"})
    if body.emoji:
        store.insert_rows("reactions", {"submission_id": row["id"], "user_id": user["id"], "emoji": body.emoji},
                          returning=False)
    rs = store.select("reactions", {"submission_id": f"eq.{row['id']}", "select": "user_id,emoji"})
    return {"reactions": _count(rs), "my_reaction": body.emoji}


class CommentBody(BaseModel):
    body: str
    parent_id: str | None = None


@router.post("/submissions/{sid}/comments")
def add_comment(sid: str, body: CommentBody, user=Depends(accounts.current_user)):
    row = _viewable(sid, user)
    text = (body.body or "").strip()
    if not text:
        _err(400, "empty_comment")
    if len(text) > COMMENT_MAX:
        _err(400, "comment_too_long", max=COMMENT_MAX)
    parent = None
    if body.parent_id:
        found = store.select("comments", {"id": f"eq.{_uuid(body.parent_id)}", "submission_id": f"eq.{row['id']}",
                                          "select": "*"})
        if not found:
            _err(404, "not_found")
        parent = found[0]
        if parent.get("parent_id"):  # 대댓글에 단 답은 같은 댓글 묶음으로 (한 단계까지만)
            top = store.select("comments", {"id": f"eq.{parent['parent_id']}", "select": "*"})
            parent = top[0] if top else parent
    c = store.insert_rows("comments", {"submission_id": row["id"], "user_id": user["id"],
                                       "parent_id": parent["id"] if parent else None, "body": text})[0]
    # 알림: 댓글 → 글쓴이, 대댓글 → 댓글쓴이 (자기 자신에게는 보내지 않음)
    to, kind = (parent["user_id"], "reply") if parent else (row["user_id"], "comment")
    if to and to != user["id"]:
        store.insert_rows("notifications", {"user_id": to, "kind": kind, "submission_id": row["id"],
                                            "comment_id": c["id"], "actor_id": user["id"]}, returning=False)
    return _comment_out(c, _users([user["id"]]), user, row["user_id"])


@router.delete("/comments/{cid}")
def delete_comment(cid: str, user=Depends(accounts.current_user)):
    found = store.select("comments", {"id": f"eq.{_uuid(cid)}", "select": "*"})
    if not found:
        _err(404, "not_found")
    c = found[0]
    owner = (store.select("submissions", {"id": f"eq.{c['submission_id']}", "select": "user_id"}) or [{}])[0].get("user_id")
    if c["user_id"] != user["id"] and not can_moderate(user, owner):
        _err(403, "forbidden")
    store.delete("comments", {"id": f"eq.{c['id']}"})  # 달린 대댓글·알림도 함께 지워진다 (on delete cascade)
    return {"ok": True}


# ---- 알림 (앱 안) ----

@router.get("/notifications")
def notifications(user=Depends(accounts.current_user)):
    rows = store.select("notifications", {"user_id": f"eq.{user['id']}", "select": "*",
                                          "order": "created_at.desc", "limit": "50"})
    actors = _users([n.get("actor_id") for n in rows])
    cids = [n["comment_id"] for n in rows if n.get("comment_id")]
    bodies = {c["id"]: c["body"] for c in store.select("comments", {"id": _in(cids), "select": "id,body"})} if cids else {}
    sids = [n["submission_id"] for n in rows if n.get("submission_id")]
    subs = {s["id"]: s for s in store.select("submissions", {"id": _in(sids), "select": "id,process,position"})} if sids else {}
    out = []
    for n in rows:
        s = subs.get(n.get("submission_id")) or {}
        a = actors.get(n.get("actor_id")) or {}
        out.append({
            "id": n["id"], "kind": n["kind"], "submission_id": n.get("submission_id"),
            "actor_name": a.get("name"), "avatar_url": a.get("avatar_url"), "avatar_key": a.get("avatar_key"),
            "body": (bodies.get(n.get("comment_id")) or "")[:80],
            "process": s.get("process"), "position": s.get("position"),
            "created_at": n.get("created_at"), "read": bool(n.get("read_at")),
        })
    return out


@router.get("/notifications/unread")
def unread_count(user=Depends(accounts.current_user)):
    rows = store.select("notifications", {"user_id": f"eq.{user['id']}", "read_at": "is.null", "select": "id",
                                          "limit": "100"})
    return {"count": len(rows)}


class ReadBody(BaseModel):
    ids: list[str] | None = None  # 없으면 모두 읽음


@router.post("/notifications/read")
def mark_read(body: ReadBody, user=Depends(accounts.current_user)):
    flt = {"user_id": f"eq.{user['id']}", "read_at": "is.null"}
    if body.ids:
        flt["id"] = _in([_uuid(i) for i in body.ids])
    store.patch("notifications", flt, {"read_at": datetime.now(manage.KST).isoformat()})
    return {"ok": True}


# ---- 랭킹 ----

PERIODS = ("day", "week", "month", "all")


def period_start(period, now=None):
    now = (now or datetime.now(manage.KST)).astimezone(manage.KST)
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "day":
        return day.isoformat()
    if period == "week":
        return (day - timedelta(days=day.weekday())).isoformat()
    if period == "month":
        return day.replace(day=1).isoformat()
    return None


@router.get("/ranking")
def ranking(bg: BackgroundTasks, process: str = "", position: str = "", period: str = "week", course: str = "all",
            work_type: str = "plate", user=Depends(accounts.current_user)):
    """교육생 순위 (기간 안 최고 점수, 같으면 먼저 낸 사람이 위). 공정·자세가 비면 전체를 합쳐서."""
    if period not in PERIODS:
        _err(400, "bad_period")
    if work_type not in ("plate", "pipe"):  # 평판·배관은 섞어서 비교하지 않는다
        _err(400, "bad_work_type")
    params = {"status": "eq.ok", "user_id": "not.is.null", "select": store.LIST_SELECT,
              "order": "created_at.asc", "limit": "20000", "work_type": f"eq.{work_type}"}
    if process:
        params["process"] = f"eq.{process}"
    if position:
        params["position"] = f"eq.{position}"
    start = period_start(period)
    if start:
        params["created_at"] = f"gte.{start}"
    if course != "all":
        cid = _uuid(course)
        members = [r["user_id"] for r in store.select("user_courses", {"course_id": f"eq.{cid}", "select": "user_id"})]
        if not members:
            return {"rows": [], "me": None, "total": 0}
        params["user_id"] = _in(members)
    rows = store.select("submissions", params)
    users = {u["id"]: u for u in store.select("users", {"id": _in(list({r["user_id"] for r in rows})),
                                                         "select": "id,name,role,status,avatar_path"})} if rows else {}
    crit = scoring.criteria()
    best = {}
    for r in rows:  # 오래된 → 최근이라, 같은 점수면 먼저 낸 것이 남는다
        u = users.get(r["user_id"])
        if not u or u["role"] != "student" or u.get("status") != "active":
            continue
        sc = scoring.score_of_row(r, crit)
        if not sc:
            continue
        cur = best.get(r["user_id"])
        if cur is None or sc["score"] > cur["score"]:
            best[r["user_id"]] = {"user_id": r["user_id"], "name": u["name"], "score": sc["score"],
                                  "verdict": sc["verdict"], "submission_id": r["id"], "created_at": r["created_at"],
                                  "process": r.get("process"), "position": r.get("position"), "_row": r}
    ordered = sorted(best.values(), key=lambda x: (-x["score"], x["created_at"]))
    top = ordered[:100]
    mine = next((x for x in ordered if x["user_id"] == user["id"]), None)
    shown = top + ([mine] if mine and mine not in top else [])
    f_courses = _pool.submit(_courses_of, [x["user_id"] for x in shown])
    f_av = _pool.submit(media.avatars_of, [users[x["user_id"]] for x in shown])
    rows_shown = [x.pop("_row") for x in shown]
    for x in ordered:
        x.pop("_row", None)
    beads = media.attach_bead([{} for _ in shown], rows_shown)
    courses, avatars = f_courses.result(), f_av.result()
    if media.needs_backfill(rows_shown):
        bg.add_task(media.backfill, rows_shown)
    rank_of = {x["user_id"]: i + 1 for i, x in enumerate(ordered)}  # 같은 점수라도 먼저 낸 사람이 위
    out = [{**x, **b, **(avatars.get(x["user_id"]) or {}), "rank": rank_of[x["user_id"]],
            "courses": courses.get(x["user_id"], [])} for x, b in zip(shown, beads)]
    me = next((x for x in out if x["user_id"] == user["id"]), None)
    return {"rows": out[:len(top)], "me": me, "total": len(ordered)}
