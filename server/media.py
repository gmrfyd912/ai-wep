"""사진 크기 줄이기·서명 주소 (6-3 수정: 갤러리·랭킹·기록 목록을 빠르게, 프로필 사진).

- 갤러리 작은 사진: photos/{uid}/{sid}_thumb.jpg (긴 변 480px)
- 비드 이미지(확인 그림 작은 것): results/{uid}/{sid}_check_thumb.jpg (가로 720px)
- 프로필 사진: photos/avatars/{uid}_{난수}.jpg (256px 정사각형, 바꿀 때마다 새 이름 → 휴대폰 저장본도 새로)
서명 주소는 7일짜리. 앱은 파일 경로를 저장 열쇠(cacheKey)로 써서, 주소가 바뀌어도 한 번 받은 사진은 다시 받지 않는다.
예전 기록에 작은 사진이 없으면, 목록을 보여 준 뒤 뒤에서 만들어 둔다(다음부터 빠름).
"""
import secrets
import threading

import cv2
import numpy as np

import store

THUMB_SIDE = 480
CHECK_THUMB_W = 720
AVATAR = 256
SIGN_SECONDS = 7 * 24 * 3600
BACKFILL_MAX = 24  # 한 번에 만들 예전 사진 수 (무료 서버 부담 줄이기)

_busy: set[str] = set()
_lock = threading.Lock()


def _jpeg(img, q):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
    if not ok:
        raise ValueError("encode")
    return buf.tobytes()


def _shrink(img, max_w=None, max_side=None):
    h, w = img.shape[:2]
    s = 1.0
    if max_side:
        s = min(s, max_side / max(h, w))
    if max_w:
        s = min(s, max_w / w)
    if s >= 1:
        return img
    return cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)


def thumb_bytes(img):
    return _jpeg(_shrink(img, max_side=THUMB_SIDE), 80)


def check_thumb_bytes(vis):
    return _jpeg(_shrink(vis, max_w=CHECK_THUMB_W), 82)


def avatar_bytes(data: bytes):
    """가운데를 정사각형으로 잘라 256px. 사진이 아니면 ValueError."""
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("image_read_failed")
    h, w = img.shape[:2]
    side = min(h, w)
    y, x = (h - side) // 2, (w - side) // 2
    sq = cv2.resize(img[y:y + side, x:x + side], (AVATAR, AVATAR), interpolation=cv2.INTER_AREA)
    return _jpeg(sq, 85)


def save_avatar(user_id, data: bytes):
    """프로필 사진 저장 → 새 경로. 예전 사진은 지운다."""
    jpg = avatar_bytes(data)
    path = f"avatars/{user_id}_{secrets.token_hex(4)}.jpg"
    store.upload("photos", path, jpg)
    old = store.select("users", {"id": f"eq.{user_id}", "select": "avatar_path"})
    store.patch("users", {"id": f"eq.{user_id}"}, {"avatar_path": path})
    if old and old[0].get("avatar_path"):
        try:
            store.remove_files("photos", [old[0]["avatar_path"]])
        except Exception:  # noqa: BLE001
            pass
    return path


def sign(bucket, paths):
    paths = [p for p in paths if p]
    if not paths:
        return {}
    try:
        return store.signed_urls(bucket, paths, SIGN_SECONDS)
    except Exception as e:  # noqa: BLE001 - 사진 주소가 없어도 목록은 보이게
        print("[media] 서명 실패", str(e)[:200], flush=True)
        return {}


def avatars_of(users):
    """{user_id: {"avatar_url", "avatar_key"}} (사진이 없으면 None)."""
    urls = sign("photos", [u.get("avatar_path") for u in users])
    return {u["id"]: {"avatar_url": urls.get(u.get("avatar_path")), "avatar_key": u.get("avatar_path")} for u in users}


def bead_path(row):
    return row.get("check_thumb_path") or row.get("check_path")


def attach_bead(items, rows):
    """목록 항목에 비드 이미지(확인 그림 작은 것) 주소·저장 열쇠·가로세로 비율을 붙인다."""
    urls = sign("results", [bead_path(r) for r in rows])
    for it, r in zip(items, rows):
        p = bead_path(r)
        it["bead_url"] = urls.get(p) if p else None
        it["bead_key"] = p
        w, h = r.get("check_w"), r.get("check_h")
        it["bead_ratio"] = (w / h) if isinstance(w, (int, float)) and isinstance(h, (int, float)) and h else None
    return items


def needs_backfill(rows):
    return [r for r in rows if r.get("status") == "ok" and (
        (r.get("photo_path") and not r.get("thumb_path")) or (r.get("check_path") and not r.get("check_thumb_path")))]


def backfill(rows):
    """예전 기록의 작은 사진·비드 이미지를 만든다 (응답을 보낸 뒤 뒤에서)."""
    todo = []
    with _lock:
        for r in needs_backfill(rows):
            if r["id"] not in _busy and len(todo) < BACKFILL_MAX:
                _busy.add(r["id"])
                todo.append(r)
    for r in todo:
        try:
            fields = {}
            uid = r.get("user_id") or "anon"
            if r.get("photo_path") and not r.get("thumb_path"):
                img = cv2.imdecode(np.frombuffer(store.download("photos", r["photo_path"]), np.uint8), cv2.IMREAD_COLOR)
                if img is not None:
                    p = f"{uid}/{r['id']}_thumb.jpg"
                    store.upload("photos", p, thumb_bytes(img))
                    fields["thumb_path"] = p
            if r.get("check_path") and not r.get("check_thumb_path"):
                vis = cv2.imdecode(np.frombuffer(store.download("results", r["check_path"]), np.uint8), cv2.IMREAD_COLOR)
                if vis is not None:
                    p = f"{uid}/{r['id']}_check_thumb.jpg"
                    store.upload("results", p, check_thumb_bytes(vis))
                    fields["check_thumb_path"] = p
            if fields:
                store.patch("submissions", {"id": f"eq.{r['id']}"}, fields)
        except Exception as e:  # noqa: BLE001
            print("[media] 작은 사진 만들기 실패", r.get("id"), str(e)[:200], flush=True)
        finally:
            with _lock:
                _busy.discard(r["id"])
