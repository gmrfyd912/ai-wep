"""시험용 가짜 Supabase (메모리). store.py 의 공통 함수(select·insert_rows·patch·delete)를 대신한다.
PostgREST 조건 중 이 서버가 쓰는 것만 흉내 낸다: eq. neq. is.null in.() gt. gte. / order / limit / 표 이어붙이기."""
import re
import uuid
from datetime import datetime, timezone

import store

TABLES: dict[str, list[dict]] = {}
SETTINGS: dict[str, dict] = {}
FILES: dict[str, bytes] = {}
# 이어붙이기: (표, 이어붙일 이름) → (이 표의 열, 대상 표)
FKEYS = {("sessions", "users"): ("user_id", "users"), ("user_courses", "courses"): ("course_id", "courses"),
         ("user_courses", "users"): ("user_id", "users")}
UNIQUE = {"users": "login_key", "sessions": "token_hash"}
CASCADE = {"users": [("sessions", "user_id"), ("user_courses", "user_id"), ("email_codes", "user_id"),
                     ("submissions", "user_id"), ("reports", "user_id"), ("comments", "user_id"),
                     ("reactions", "user_id"), ("notifications", "user_id")],
           "comments": [("comments", "parent_id"), ("notifications", "comment_id")]}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _match(row, col, cond):
    v = row.get(col)
    op, _, arg = cond.partition(".")
    if op == "eq":
        return str(v).lower() == arg.lower() if isinstance(v, bool) else str(v) == arg and v is not None
    if op == "neq":
        return str(v) != arg
    if op == "not":
        return not _match(row, col, arg)
    if op == "is":
        if arg in ("true", "false"):
            return bool(v) == (arg == "true")
        return v is None if arg == "null" else False
    if op == "in":
        return str(v) in arg.strip("()").split(",")
    if op in ("gt", "gte", "lt"):
        if v is None:
            return False
        a, b = str(v), arg
        return a > b if op == "gt" else a >= b if op == "gte" else a < b
    raise ValueError(cond)


def _filter(table, params):
    rows = TABLES.setdefault(table, [])
    special = {"select", "order", "limit", "on_conflict", "or"}
    out = [r for r in rows if all(_match(r, k, v) for k, v in params.items() if k not in special)]
    return out


def _project(table, row, select):
    if not select or select == "*":
        return dict(row)
    out = {}
    for part in re.findall(r"[^,()]+\([^)]*\)|[^,]+", select):
        m = re.match(r"(\w+)\((.*)\)", part)
        if m:
            name, inner = m.groups()
            col, target = FKEYS[(table, name)]
            ref = next((r for r in TABLES.get(target, []) if r["id"] == row.get(col)), None)
            out[name] = _project(target, ref, inner) if ref else None
        elif ":" in part:  # 별명:JSON경로 → 시험 행에는 별명 이름으로 값을 넣어 둔다
            name = part.split(":", 1)[0]
            out[name] = row.get(name)
        else:
            out[part] = row.get(part)
    return out


def select(table, params):
    rows = _filter(table, params)
    if "order" in params:
        for key in reversed(params["order"].split(",")):
            col, _, direction = key.partition(".")
            rows = sorted(rows, key=lambda r: (r.get(col) is None, r.get(col)), reverse=direction == "desc")
    if "limit" in params:
        rows = rows[: int(params["limit"])]
    return [_project(table, r, params.get("select", "*")) for r in rows]


def insert_rows(table, rows, returning=True):
    rows = rows if isinstance(rows, list) else [rows]
    t = TABLES.setdefault(table, [])
    made = []
    for r in rows:
        r = dict(r)
        r.setdefault("id", str(uuid.uuid4()))
        r.setdefault("created_at", _now())
        if table == "sessions":
            r.setdefault("last_seen_at", _now())
        if table == "users":
            r.setdefault("status", "active")
            r.setdefault("must_change_password", False)
        if table == "courses":
            r.setdefault("active", True)
        if table == "submissions":
            r.setdefault("hidden", False)
        if table == "users":
            r.setdefault("permissions", {})
        if table == "email_codes":
            r.setdefault("used", False)
            r.setdefault("attempts", 0)
        u = UNIQUE.get(table)
        if u and any(x.get(u) == r.get(u) for x in t):
            raise RuntimeError("Supabase 409: 23505 duplicate key")
        t.append(r)
        made.append(dict(r))
    return made if returning else None


def patch(table, filters, fields):
    rows = _filter(table, filters)
    for r in rows:
        r.update(fields)
    return [dict(r) for r in rows]


def delete(table, filters):
    rows = _filter(table, filters)
    for r in rows:
        for child, col in CASCADE.get(table, []):
            TABLES[child] = [x for x in TABLES.get(child, []) if x.get(col) != r["id"]]
    TABLES[table] = [r for r in TABLES.get(table, []) if r not in rows]


def remove_files(bucket, paths):
    for p in paths:
        if p:
            FILES.pop(f"{bucket}/{p}", None)


def install():
    """store 의 함수를 가짜로 바꾼다."""
    TABLES.clear()
    SETTINGS.clear()
    FILES.clear()
    store.select = select
    store.insert_rows = insert_rows
    store.patch = patch
    store.delete = delete
    store.remove_files = remove_files
    store.get_setting = lambda k: next((r["value"] for r in TABLES.get("app_settings", []) if r.get("key") == k), SETTINGS.get(k))
    store.configured = lambda: True
    store.upload = lambda b, p, d, content_type="image/jpeg": FILES.__setitem__(f"{b}/{p}", d)
    store.signed_url = lambda b, p, expires=3600: p and f"https://fake/{b}/{p}"
    store.signed_urls = lambda b, ps, expires=3600: {p: f"https://fake/{b}/{p}" for p in ps if p}
    store.download = lambda b, p: FILES[f"{b}/{p}"]
    store.insert = lambda row: insert_rows("submissions", row, returning=False)
    store.update = lambda sid, f: patch("submissions", {"id": f"eq.{sid}"}, f)[0]
    store.get = lambda sid: next((dict(r) for r in TABLES.get("submissions", []) if r["id"] == sid), None)
    store.list_by_user = lambda uid, n: [dict(r) for r in TABLES.get("submissions", []) if r.get("user_id") == uid][:n]
    store.get_report = lambda sid, lang: next(
        (r for r in TABLES.get("reports", []) if r["submission_id"] == sid and r["lang"] == lang), None)
    store.get_any_report = lambda sid: next((dict(r) for r in TABLES.get("reports", []) if r["submission_id"] == sid), None)
    store.insert_report = lambda r: insert_rows("reports", r, returning=False)
    store.update_report = lambda rid, f: patch("reports", {"id": f"eq.{rid}"}, f)
    store.count_reports_since_user = lambda uid, since: sum(
        1 for r in TABLES.get("reports", [])
        if r.get("created_by") == uid or (r.get("created_by") is None and r.get("user_id") == uid))
