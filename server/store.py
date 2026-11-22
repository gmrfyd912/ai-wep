"""Supabase 저장 (REST 직접 호출). 서버용 비밀 키는 환경 변수에서만 읽는다."""
import os

import requests

TIMEOUT = 30


def _base():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SECRET_KEY 환경 변수가 없습니다.")
    headers = {"apikey": key}
    if key.startswith("eyJ"):  # 예전 service_role 키(JWT)일 때만
        headers["Authorization"] = f"Bearer {key}"
    return url, headers


def configured():
    return bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SECRET_KEY"))


def _check(r):
    if r.status_code >= 300:
        raise RuntimeError(f"Supabase {r.status_code}: {r.text[:300]}")
    return r


def upload(bucket, path, data, content_type="image/jpeg"):
    url, h = _base()
    _check(requests.post(f"{url}/storage/v1/object/{bucket}/{path}", data=data, timeout=TIMEOUT,
                         headers={**h, "Content-Type": content_type, "x-upsert": "true"}))


def signed_url(bucket, path, expires=3600):
    if not path:
        return None
    url, h = _base()
    r = _check(requests.post(f"{url}/storage/v1/object/sign/{bucket}/{path}", json={"expiresIn": expires},
                             headers=h, timeout=TIMEOUT))
    rel = r.json().get("signedURL") or r.json().get("signedUrl")
    return f"{url}/storage/v1{rel}" if rel else None


def insert(row):
    url, h = _base()
    _check(requests.post(f"{url}/rest/v1/submissions", json=row, timeout=TIMEOUT,
                         headers={**h, "Prefer": "return=minimal"}))


def update(sid, fields):
    url, h = _base()
    r = _check(requests.patch(f"{url}/rest/v1/submissions", params={"id": f"eq.{sid}"}, json=fields,
                              timeout=TIMEOUT, headers={**h, "Prefer": "return=representation"}))
    rows = r.json()
    return rows[0] if rows else {"id": sid, **fields}


def get(sid):
    url, h = _base()
    r = _check(requests.get(f"{url}/rest/v1/submissions", params={"id": f"eq.{sid}", "select": "*"},
                            headers=h, timeout=TIMEOUT))
    rows = r.json()
    return rows[0] if rows else None


def list_by_device(device_id, limit):
    return _list_submissions("device_id", device_id, limit)


# 목록·누적 분석에 쓰는 열 (결과 JSON에서 필요한 값만 꺼낸다, 그래프 배열은 빼서 가볍다)
LIST_SELECT = ("id,user_id,device_id,status,process,position,material,created_at,width_mean_mm,straight_max_dev_mm,"
               "defect_count,width_std_mm:result->bead->width->std_mm,width_min_mm:result->bead->width->min_mm,"
               "width_max_mm:result->bead->width->max_mm,defect_types:result->defects")


def _list_submissions(col, value, limit):
    url, h = _base()
    r = _check(requests.get(f"{url}/rest/v1/submissions", headers=h, timeout=TIMEOUT, params={
        col: f"eq.{value}", "order": "created_at.desc", "limit": str(limit), "select": LIST_SELECT}))
    return r.json()


# ---- 5단계: 설정·AI 리포트 ----

def get_setting(key):
    """app_settings 표의 값(JSON). 없으면 None."""
    url, h = _base()
    r = _check(requests.get(f"{url}/rest/v1/app_settings", params={"key": f"eq.{key}", "select": "value"},
                            headers=h, timeout=TIMEOUT))
    rows = r.json()
    return rows[0]["value"] if rows else None


def get_report(sid, lang):
    url, h = _base()
    r = _check(requests.get(f"{url}/rest/v1/reports", headers=h, timeout=TIMEOUT, params={
        "submission_id": f"eq.{sid}", "lang": f"eq.{lang}", "select": "*", "limit": "1"}))
    rows = r.json()
    return rows[0] if rows else None


def insert_report(row):
    """같은 사진·같은 언어 리포트가 이미 있으면 그대로 둔다 (두 번 눌러도 1개만)."""
    url, h = _base()
    _check(requests.post(f"{url}/rest/v1/reports", json=row, timeout=TIMEOUT,
                         params={"on_conflict": "submission_id,lang"},
                         headers={**h, "Prefer": "resolution=ignore-duplicates,return=minimal"}))


def update_report(rid, fields):
    """판정이 바뀐 리포트를 새 글로 바꾼다. created_at 은 그대로 (하루 한도에 다시 세지 않음)."""
    url, h = _base()
    fields = {k: v for k, v in fields.items() if k not in ("submission_id", "device_id", "lang")}
    _check(requests.patch(f"{url}/rest/v1/reports", params={"id": f"eq.{rid}"}, json=fields,
                          timeout=TIMEOUT, headers={**h, "Prefer": "return=minimal"}))


def count_reports_since(device_id, since_iso):
    url, h = _base()
    r = _check(requests.get(f"{url}/rest/v1/reports", timeout=TIMEOUT, params={
        "device_id": f"eq.{device_id}", "created_at": f"gte.{since_iso}", "select": "id"},
        headers={**h, "Prefer": "count=exact", "Range": "0-0"}))
    rng = r.headers.get("Content-Range", "")  # 예: 0-0/3 또는 */0
    try:
        return int(rng.rsplit("/", 1)[1])
    except (IndexError, ValueError):
        return len(r.json())


# ---- 6단계: 계정 (표 이름을 받아 쓰는 공통 함수) ----

def select(table, params):
    """PostgREST 조회. params 예: {"login_key": "eq.abc", "select": "*"}"""
    url, h = _base()
    r = _check(requests.get(f"{url}/rest/v1/{table}", params=params, headers=h, timeout=TIMEOUT))
    return r.json()


def insert_rows(table, rows, returning=True):
    url, h = _base()
    prefer = "return=representation" if returning else "return=minimal"
    r = _check(requests.post(f"{url}/rest/v1/{table}", json=rows, timeout=TIMEOUT,
                             headers={**h, "Prefer": prefer}))
    return r.json() if returning else None


def patch(table, filters, fields):
    """filters 예: {"id": "eq.xxx"}. 바뀐 행 목록을 돌려준다."""
    url, h = _base()
    r = _check(requests.patch(f"{url}/rest/v1/{table}", params=filters, json=fields, timeout=TIMEOUT,
                              headers={**h, "Prefer": "return=representation"}))
    return r.json()


def delete(table, filters):
    url, h = _base()
    if not filters:
        raise ValueError("delete without filter")
    _check(requests.delete(f"{url}/rest/v1/{table}", params=filters, timeout=TIMEOUT,
                           headers={**h, "Prefer": "return=minimal"}))


def remove_files(bucket, paths):
    """저장 공간의 파일 여러 개 삭제 (없는 파일은 무시)."""
    paths = [p for p in paths if p]
    if not paths:
        return
    url, h = _base()
    for i in range(0, len(paths), 100):
        _check(requests.delete(f"{url}/storage/v1/object/{bucket}", json={"prefixes": paths[i:i + 100]},
                               headers=h, timeout=TIMEOUT))


def list_by_user(user_id, limit):
    """list_by_device 와 같은 모양으로 계정의 기록을 돌려준다."""
    return _list_submissions("user_id", user_id, limit)


def count_reports_since_user(user_id, since_iso):
    """이 사람이 만든 리포트 수 (예전 리포트는 만든 사람 기록이 없어서 주인 기준으로 셈)."""
    url, h = _base()
    r = _check(requests.get(f"{url}/rest/v1/reports", timeout=TIMEOUT, params={
        "or": f"(created_by.eq.{user_id},and(created_by.is.null,user_id.eq.{user_id}))",
        "created_at": f"gte.{since_iso}", "select": "id"},
        headers={**h, "Prefer": "count=exact", "Range": "0-0"}))
    rng = r.headers.get("Content-Range", "")
    try:
        return int(rng.rsplit("/", 1)[1])
    except (IndexError, ValueError):
        return len(r.json())
