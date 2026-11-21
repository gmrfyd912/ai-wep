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
    url, h = _base()
    r = _check(requests.get(f"{url}/rest/v1/submissions", headers=h, timeout=TIMEOUT, params={
        "device_id": f"eq.{device_id}", "order": "created_at.desc", "limit": str(limit),
        "select": ("id,status,process,position,material,created_at,width_mean_mm,straight_max_dev_mm,defect_count,"
                   # 누적 분석(4단계)용: 결과 JSON에서 필요한 값만 꺼낸다
                   "width_std_mm:result->bead->width->std_mm,width_min_mm:result->bead->width->min_mm,"
                   "width_max_mm:result->bead->width->max_mm,defect_types:result->defects")}))
    return r.json()
