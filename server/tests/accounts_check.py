"""6-1단계 계정 흐름 시험: 가입·로그인·세션 유지·비밀번호 변경/찾기·기록 가져오기·계정 삭제.
Supabase·메일은 가짜. 실행: python -m tests.accounts_check"""
import base64
import os

import cv2
import numpy as np

from fastapi.testclient import TestClient

import accounts
import app as server
import mail
from tests import fake_db as db

DEV = "test-device-1234"


def main():
    db.install()
    db.insert_rows("courses", [{"id": "11111111-1111-4111-8111-111111111111", "name": "뉴딜2기", "active": True, "sort": 1},
                               {"id": "22222222-2222-4222-8222-222222222222", "name": "뉴딜3기", "active": True, "sort": 2},
                               {"id": "33333333-3333-4333-8333-333333333333", "name": "옛날반", "active": False, "sort": 3}])
    c1, c2, c_old = (r["id"] for r in db.TABLES["courses"])
    c = TestClient(server.app)

    # 과정 목록: 운영 중인 것만
    assert [x["name"] for x in c.get("/courses").json()] == ["뉴딜2기", "뉴딜3기"]

    # 가입: 교육생은 과정 1개 필수, 비밀번호 규칙 없음(1글자도 OK)
    base = {"login_id": "Kim01", "password": "1", "name": "김민수", "role": "student"}
    assert c.post("/auth/signup", json=base).json()["detail"]["code"] == "course_required"
    assert c.post("/auth/signup", json=base | {"course_ids": [c_old]}).json()["detail"]["code"] == "bad_course"
    assert c.post("/auth/signup", json=base | {"course_ids": [c1], "password": ""}).json()["detail"]["code"] == "password_short"
    assert c.post("/auth/signup", json=base | {"course_ids": [c1], "email": "x"}).json()["detail"]["code"] == "bad_email"
    # 프로필 사진: 기본 필수
    assert c.post("/auth/signup", json=base | {"course_ids": [c1]}).json()["detail"]["code"] == "avatar_required"
    assert c.post("/auth/signup", json=base | {"course_ids": [c1], "avatar_b64": "bm90IGFuIGltYWdl"}).json()["detail"]["code"] == "bad_avatar"
    face = base64.b64encode(cv2.imencode(".jpg", np.full((300, 400, 3), 90, np.uint8))[1].tobytes()).decode()
    r = c.post("/auth/signup", json=base | {"course_ids": [c1], "email": " Kim@Example.com ", "device_id": DEV,
                                            "avatar_b64": face})
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    u = r.json()["user"]
    assert u["avatar_url"] and u["avatar_key"].startswith("avatars/") and u["needs_avatar"] is False
    av = cv2.imdecode(np.frombuffer(db.FILES[f"photos/{u['avatar_key']}"], np.uint8), cv2.IMREAD_COLOR)
    assert av.shape[:2] == (256, 256)
    assert c.get("/auth/signup-rules").json() == {"avatar_required": True}
    db.SETTINGS["signup"] = {"avatar_required": False}  # 아래 시험은 사진 없이
    assert c.get("/auth/signup-rules").json() == {"avatar_required": False}
    assert u["role"] == "student" and u["courses"] == [{"id": c1, "name": "뉴딜2기"}] and u["email"] == "kim@example.com"
    assert "password_hash" not in u
    assert db.TABLES["users"][0]["password_hash"].startswith("$2")  # 원문 저장 안 함
    # 아이디는 대소문자·공백 무시하고 중복 확인
    assert c.post("/auth/signup", json=base | {"login_id": " kim01 ", "course_ids": [c1]}).status_code == 409

    H = {"Authorization": f"Bearer {tok}"}
    assert c.get("/me", headers=H).json()["name"] == "김민수"
    assert c.get("/me").status_code == 401
    assert c.get("/me", headers={"Authorization": "Bearer nope"}).status_code == 401

    # 로그인: 대소문자 무시, 틀린 비밀번호
    assert c.post("/auth/login", json={"login_id": "KIM01", "password": "2"}).json()["detail"]["code"] == "bad_login"
    r = c.post("/auth/login", json={"login_id": "kim01", "password": "1"})
    assert r.status_code == 200
    tok2 = r.json()["token"]
    H2 = {"Authorization": f"Bearer {tok2}"}

    # 교사: 담당 과정 여러 개 / 행정 관리자: 과정 없음 / admin 역할은 가입 불가
    r = c.post("/auth/signup", json={"login_id": "t1", "password": "pw", "name": "이교사", "role": "teacher",
                                     "course_ids": [c1, c2]})
    assert len(r.json()["user"]["courses"]) == 2
    r = c.post("/auth/signup", json={"login_id": "s1", "password": "pw", "name": "박행정", "role": "staff",
                                     "course_ids": [c1]})
    assert r.json()["user"]["courses"] == []
    assert c.post("/auth/signup", json={"login_id": "a2", "password": "pw", "name": "x", "role": "admin"}).status_code == 400

    # 승인 필요 설정이 켜지면 승인 대기
    db.SETTINGS["signup"] = {"student_approval": True, "staff_approval": False, "avatar_required": False}
    r = c.post("/auth/signup", json=base | {"login_id": "wait1", "course_ids": [c2]})
    assert r.json() == {"pending": True}
    assert c.post("/auth/login", json={"login_id": "wait1", "password": "1"}).json()["detail"]["code"] == "pending"
    db.SETTINGS["signup"] = {"avatar_required": False}

    # 비밀번호 규칙 (6-4단계 관리자 설정)
    db.SETTINGS["auth"] = {"password_min_length": 4}
    r = c.post("/auth/signup", json=base | {"login_id": "short", "course_ids": [c1], "password": "123"})
    assert r.json()["detail"] == {"code": "password_short", "min": 4}
    db.SETTINGS.pop("auth")

    # 비밀번호 변경: 지금 비밀번호 확인, 다른 휴대폰 로그인은 끊김
    assert c.post("/me/password", headers=H, json={"current": "x", "new": "new"}).json()["detail"]["code"] == "wrong_password"
    assert c.post("/me/password", headers=H, json={"current": "1", "new": "new"}).status_code == 200
    assert c.get("/me", headers=H).status_code == 200
    assert c.get("/me", headers=H2).status_code == 401
    assert c.post("/auth/login", json={"login_id": "kim01", "password": "new"}).status_code == 200

    # 첫 로그인 비밀번호 변경 (admin: SQL 로 만든 bcrypt 값)
    db.insert_rows("users", {"login_id": "admin", "login_key": "admin", "name": "관리자", "role": "admin",
                             "password_hash": accounts.hash_password("first"), "must_change_password": True})
    r = c.post("/auth/login", json={"login_id": "admin", "password": "first"}).json()
    assert r["user"]["must_change_password"] is True
    HA = {"Authorization": f"Bearer {r['token']}"}
    r = c.post("/me/password", headers=HA, json={"new": "changed"})  # 지금 비밀번호 안 물음
    assert r.status_code == 200 and r.json()["must_change_password"] is False
    assert c.post("/me/password", headers=HA, json={"new": "again"}).status_code == 400  # 이제는 물음
    assert c.post("/me/delete", headers=HA, json={"password": "changed"}).json()["detail"]["code"] == "admin_cannot_delete"

    # 이메일: 변경 / 메일 서비스 설정 전
    assert c.patch("/me", headers=H, json={"email": "new@example.com"}).json()["email"] == "new@example.com"
    os.environ.pop("BREVO_API_KEY", None)
    assert c.post("/auth/forgot", json={"login_id": "kim01"}).json()["detail"]["code"] == "mail_not_configured"
    assert c.post("/auth/forgot", json={"login_id": "t1"}).json()["detail"]["code"] == "no_email"
    assert c.post("/auth/forgot", json={"login_id": "nobody"}).status_code == 404

    # 메일 서비스 설정 후: 아이디 찾기 / 재설정 번호
    os.environ.update(BREVO_API_KEY="test", MAIL_FROM="noreply@example.com")
    sent = []
    mail.send = lambda to, subject, body: sent.append((to, subject, body))
    assert c.post("/auth/find-id", json={"email": "NEW@example.com", "lang": "vi"}).json() == {"sent": True}
    assert sent[-1][0] == "new@example.com" and "Kim01" in sent[-1][2] and "ID" in sent[-1][1]
    n = len(sent)
    assert c.post("/auth/find-id", json={"email": "none@example.com"}).json() == {"sent": True}
    assert len(sent) == n  # 없는 이메일은 보내지 않지만 결과는 같음
    r = c.post("/auth/forgot", json={"login_id": "kim01", "lang": "ko"})
    assert r.status_code == 200 and r.json()["email"] == "ne*@example.com", r.text
    code = sent[-1][2].split("번호는 ")[1][:6]
    assert c.post("/auth/forgot", json={"login_id": "kim01"}).json()["detail"]["code"] == "too_soon"
    bad = "000000" if code != "000000" else "111111"
    assert c.post("/auth/reset", json={"login_id": "kim01", "code": bad, "new_password": "z"}).json()["detail"]["code"] == "bad_code"
    r = c.post("/auth/reset", json={"login_id": "kim01", "code": code, "new_password": "reset"})
    assert r.status_code == 200, r.text
    assert c.get("/me", headers=H).status_code == 401  # 재설정하면 모든 휴대폰 로그아웃
    H = {"Authorization": f"Bearer {r.json()['token']}"}
    assert c.post("/auth/reset", json={"login_id": "kim01", "code": code, "new_password": "x"}).json()["detail"]["code"] == "code_expired"

    # 로그인 전 이 휴대폰 기록 가져오기
    db.insert_rows("submissions", [
        {"device_id": DEV, "user_id": None, "status": "ok", "photo_path": f"{DEV}/a.jpg"},
        {"device_id": DEV, "user_id": None, "status": "ok", "photo_path": f"{DEV}/b.jpg"},
        {"device_id": "other-device-999", "user_id": None, "status": "ok"}], returning=False)
    db.insert_rows("reports", {"device_id": DEV, "user_id": None, "submission_id": "x", "lang": "ko"}, returning=False)
    assert c.get("/me/device-records", headers=H, params={"device_id": DEV}).json() == {"count": 2}
    assert c.post("/me/claim-device", headers=H, json={"device_id": DEV}).json() == {"moved": 2}
    assert c.get("/me/device-records", headers=H, params={"device_id": DEV}).json() == {"count": 0}
    assert db.TABLES["reports"][0]["user_id"] == c.get("/me", headers=H).json()["id"]
    assert len(c.get("/submissions", headers=H).json()) == 2

    # 로그아웃
    r = c.post("/auth/login", json={"login_id": "kim01", "password": "reset"}).json()
    HL = {"Authorization": f"Bearer {r['token']}"}
    assert c.post("/auth/logout", headers=HL).status_code == 200
    assert c.get("/me", headers=HL).status_code == 401
    assert c.get("/me", headers=H).status_code == 200

    # 계정 삭제: 비밀번호 확인 후 기록·사진까지 삭제
    db.FILES[f"photos/{DEV}/a.jpg"] = b"1"
    assert c.post("/me/delete", headers=H, json={"password": "x"}).json()["detail"]["code"] == "wrong_password"
    assert c.post("/me/delete", headers=H, json={"password": "reset"}).status_code == 200
    assert c.get("/me", headers=H).status_code == 401
    assert not any(r.get("device_id") == DEV for r in db.TABLES["submissions"])
    assert not db.TABLES["reports"] and f"photos/{DEV}/a.jpg" not in db.FILES
    assert c.post("/auth/login", json={"login_id": "kim01", "password": "reset"}).status_code == 401
    # 사진 없이 가입한 사람: 필수로 바뀌면 needs_avatar → 올리면 해제, 바꾸면 예전 파일 삭제
    r = c.post("/auth/signup", json={"login_id": "noface", "password": "p", "name": "무사진", "role": "staff"}).json()
    HN = {"Authorization": f"Bearer {r['token']}"}
    assert r["user"]["needs_avatar"] is False and r["user"]["avatar_url"] is None
    db.SETTINGS["signup"] = {}
    assert c.get("/me", headers=HN).json()["needs_avatar"] is True
    img = cv2.imencode(".jpg", np.full((500, 300, 3), 200, np.uint8))[1].tobytes()
    me = c.post("/me/avatar", headers=HN, files={"photo": ("a.jpg", img, "image/jpeg")}).json()
    assert me["needs_avatar"] is False and me["avatar_key"]
    first = me["avatar_key"]
    me = c.post("/me/avatar", headers=HN, files={"photo": ("b.jpg", img, "image/jpeg")}).json()
    assert me["avatar_key"] != first and f"photos/{first}" not in db.FILES
    assert c.post("/me/avatar", headers=HN, files={"photo": ("c.jpg", b"xx", "image/jpeg")}).status_code == 400
    db.SETTINGS["signup"] = {"avatar_required": False}
    print("계정 흐름 시험 통과")


if __name__ == "__main__":
    main()
