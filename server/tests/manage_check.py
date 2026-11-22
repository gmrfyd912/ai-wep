"""6-2단계 시험: 과정 관리·담임/부담임·회원 관리·가입 설정·교사/행정 보드·권한.
실행: python -m tests.manage_check"""
from fastapi.testclient import TestClient

import accounts
import app as server
import manage
from tests import fake_db as db


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def main():
    db.install()
    c = TestClient(server.app)
    db.insert_rows("users", {"login_id": "admin", "login_key": "admin", "name": "관리자", "role": "admin",
                             "password_hash": accounts.hash_password("a")})
    A = H(c.post("/auth/login", json={"login_id": "admin", "password": "a"}).json()["token"])

    # 과정 추가·이름 변경·종료
    r = c.post("/manage/courses", headers=A, json={"name": "뉴딜2기"})
    c1 = r.json()["id"]
    c2 = c.post("/manage/courses", headers=A, json={"name": "뉴딜3기"}).json()["id"]
    assert c.post("/manage/courses", headers=A, json={"name": "뉴딜2기"}).status_code == 409
    assert c.patch(f"/manage/courses/{c2}", headers=A, json={"name": "뉴딜2기"}).status_code == 409

    def signup(lid, role, courses=()):
        r = c.post("/auth/signup", json={"login_id": lid, "password": "p", "name": lid, "role": role,
                                         "course_ids": list(courses)})
        assert r.status_code == 200, r.text
        return r.json()["user"]["id"], H(r.json()["token"])

    def relogin(lid):
        r = c.post("/auth/login", json={"login_id": lid, "password": "p"})
        assert r.status_code == 200, r.text
        return H(r.json()["token"])

    s1, S1 = signup("s1", "student", [c1])
    s2, S2 = signup("s2", "student", [c2])
    t1, T1 = signup("t1", "teacher", [c1])
    t2, T2 = signup("t2", "teacher", [c1, c2])
    st, ST = signup("st", "staff")
    assert c.get(f"/manage/members/{t1}", headers=A).json()["courses"][0]["course_role"] == "assistant"

    # 담임 1명 + 부담임
    assert c.put(f"/manage/courses/{c1}/teachers", headers=A, json={"teachers": [
        {"user_id": t1, "course_role": "homeroom"}, {"user_id": t2, "course_role": "homeroom"}]}).status_code == 400
    assert c.put(f"/manage/courses/{c1}/teachers", headers=A, json={"teachers": [
        {"user_id": s1, "course_role": "assistant"}]}).json()["detail"]["code"] == "not_teacher"
    assert c.put(f"/manage/courses/{c1}/teachers", headers=A, json={"teachers": [
        {"user_id": t1, "course_role": "homeroom"}, {"user_id": t2, "course_role": "assistant"}]}).status_code == 200
    # 담당이 바뀐 교사는 로그아웃 (t1 부담임→담임, t2 그대로 부담임), 교육생은 그대로
    assert c.get("/me", headers=T1).status_code == 401 and c.get("/me", headers=T2).status_code == 200
    assert c.get("/me", headers=S1).status_code == 200
    T1 = relogin("t1")
    cs = {x["name"]: x for x in c.get("/manage/courses", headers=A).json()}
    assert [(t["name"], t["course_role"]) for t in cs["뉴딜2기"]["teachers"]] == [("t1", "homeroom"), ("t2", "assistant")]
    assert cs["뉴딜2기"]["student_count"] == 1
    # 담임 교체: t1 빼고 t2 담임 → 교육생 연결은 그대로
    c.put(f"/manage/courses/{c1}/teachers", headers=A, json={"teachers": [{"user_id": t2, "course_role": "homeroom"}]})
    cs = {x["name"]: x for x in c.get("/manage/courses", headers=A).json()}
    assert [t["name"] for t in cs["뉴딜2기"]["teachers"]] == ["t2"] and cs["뉴딜2기"]["student_count"] == 1
    c.put(f"/manage/courses/{c1}/teachers", headers=A, json={"teachers": [
        {"user_id": t1, "course_role": "homeroom"}, {"user_id": t2, "course_role": "assistant"}]})
    T1, T2 = relogin("t1"), relogin("t2")
    # 똑같이 다시 저장하면 아무도 로그아웃되지 않음
    c.put(f"/manage/courses/{c1}/teachers", headers=A, json={"teachers": [
        {"user_id": t1, "course_role": "homeroom"}, {"user_id": t2, "course_role": "assistant"}]})
    assert c.get("/me", headers=T1).status_code == 200 and c.get("/me", headers=T2).status_code == 200

    # 권한: 교사·교육생·권한 없는 행정 관리자는 과정 관리 불가
    for h in (T1, S1, ST):
        assert c.post("/manage/courses", headers=h, json={"name": "x"}).status_code == 403
        assert c.get("/manage/settings/signup", headers=h).status_code == 403
    # 행정 관리자에게 권한 부여 (시스템관리자만)
    r = c.patch(f"/manage/members/{st}", headers=A, json={"permissions": {"manage_courses": True, "manage_members": True}})
    assert r.json()["permissions"] == {"manage_courses": True, "manage_members": True}
    assert c.get("/me", headers=ST).status_code == 401  # 권한이 바뀌면 다시 로그인
    ST = relogin("st")
    assert c.get("/me", headers=ST).json()["permissions"]["manage_members"] is True
    assert c.post("/manage/courses", headers=ST, json={"name": "특기병"}).status_code == 200
    assert c.patch(f"/manage/members/{s1}", headers=ST, json={"permissions": {"manage_courses": True}}).status_code == 403
    assert c.patch(f"/manage/members/{st}", headers=ST, json={"status": "disabled"}).json()["detail"]["code"] == "not_self"
    admin_id = c.get("/me", headers=A).json()["id"]
    assert c.patch(f"/manage/members/{admin_id}", headers=ST, json={"status": "disabled"}).status_code == 403

    # 회원 목록: 관리자는 전체(admin 제외), 교사는 맡은 반 교육생만
    assert {m["login_id"] for m in c.get("/manage/members", headers=A).json()} == {"s1", "s2", "t1", "t2", "st"}
    assert {m["login_id"] for m in c.get("/manage/members", headers=T1).json()} == {"s1"}
    assert {m["login_id"] for m in c.get("/manage/members", headers=T2).json()} == {"s1", "s2"}
    assert c.get("/manage/members", headers=S1).status_code == 403

    # 비밀번호 초기화: 같은 반 교사 OK, 다른 반 교사 X, 교사→교사 X
    assert c.post(f"/manage/members/{s2}/reset-password", headers=T1).status_code == 403
    assert c.post(f"/manage/members/{t2}/reset-password", headers=T1).status_code == 403
    r = c.post(f"/manage/members/{s1}/reset-password", headers=T1)
    assert r.json() == {"ok": True, "password": "0000"}
    assert c.get("/me", headers=S1).status_code == 401  # 쓰던 휴대폰 로그아웃
    r = c.post("/auth/login", json={"login_id": "s1", "password": "0000"}).json()
    assert r["user"]["must_change_password"] is True
    S1 = H(r["token"])
    c.post("/me/password", headers=S1, json={"new": "p"})

    # 반 이동·역할 변경은 회원 관리 권한자만
    assert c.patch(f"/manage/members/{s1}", headers=T1, json={"course_ids": [c2]}).status_code == 403
    assert c.patch(f"/manage/members/{s1}", headers=A, json={"course_ids": [c1, c2]}).json()["detail"]["code"] == "course_required"
    r = c.patch(f"/manage/members/{s2}", headers=A, json={"course_ids": [c1]})
    assert [x["id"] for x in r.json()["courses"]] == [c1]
    assert c.get("/me", headers=S2).status_code == 401  # 반 이동 → 다시 로그인
    S2 = relogin("s2")
    c.patch(f"/manage/members/{s2}", headers=A, json={"course_ids": [c1]})  # 같은 반 그대로 → 유지
    assert c.get("/me", headers=S2).status_code == 200
    r = c.patch(f"/manage/members/{s2}", headers=A, json={"course_ids": [c2]})
    # 사용 중지 → 로그인 불가, 다시 사용
    c.patch(f"/manage/members/{s2}", headers=A, json={"status": "disabled"})
    assert c.get("/me", headers=S2).status_code == 401
    assert c.post("/auth/login", json={"login_id": "s2", "password": "p"}).json()["detail"]["code"] == "disabled"
    c.patch(f"/manage/members/{s2}", headers=A, json={"status": "active"})
    S2 = H(c.post("/auth/login", json={"login_id": "s2", "password": "p"}).json()["token"])

    # 가입 방식 설정 + 교사가 자기 반 가입 승인
    assert c.get("/manage/settings/signup", headers=A).json() == {"student_approval": False, "staff_approval": False}
    assert c.put("/manage/settings/signup", headers=A, json={"student_approval": True, "staff_approval": False}).status_code == 200
    db.SETTINGS["signup"] = next(r["value"] for r in db.TABLES["app_settings"] if r["key"] == "signup")
    r = c.post("/auth/signup", json={"login_id": "s3", "password": "p", "name": "s3", "role": "student", "course_ids": [c1]})
    assert r.json() == {"pending": True}
    s3 = next(u["id"] for u in db.TABLES["users"] if u["login_id"] == "s3")
    board = c.get(f"/boards/courses/{c1}", headers=T1).json()
    assert board["students"][0]["login_id"] == "s3" and board["students"][0]["status"] == "pending"
    assert c.post(f"/manage/members/{s3}/approve", headers=T2).json()["status"] == "active"
    db.SETTINGS.pop("signup")

    # 보드: 분석 기록 넣기 (이번 주·지난주)
    week = manage.week_start_iso()

    def sub(uid, created, wmin, wmax, dev, defects=()):
        db.insert_rows("submissions", {"user_id": uid, "device_id": "-", "status": "ok", "created_at": created,
                                       "width_min_mm": wmin, "width_max_mm": wmax, "straight_max_dev_mm": dev,
                                       "defect_types": [{"type": d} for d in defects]}, returning=False)

    sub(s1, "2020-01-01T00:00:00+09:00", 7, 10, 2.5, ["Porosity"])        # 지난 기록, 낮은 점수
    sub(s1, "2020-01-02T00:00:00+09:00", 7.5, 9, 1.5, ["Porosity"])
    sub(s1, week[:10] + "T12:00:00+09:00", 8, 8.8, 0.4)                   # 이번 주, 100점
    sub(s2, week[:10] + "T13:00:00+09:00", 8, 8.8, 0.4)
    board = c.get(f"/boards/courses/{c1}", headers=T1).json()
    k = {x["login_id"]: x for x in board["students"]}["s1"]
    assert k["week_count"] == 1 and k["total"] == 3 and k["last_score"] == 100 and k["trend"] == "up", k
    assert k["frequent_defect"] == "porosity"
    assert board["summary"]["student_count"] == 2 and board["summary"]["weekly_submissions"] == 1
    assert [t["course_role"] for t in board["teachers"]] == ["homeroom", "assistant"]
    # 다른 반 교사는 못 봄, 교육생도 못 봄, 행정 관리자는 봄
    assert c.get(f"/boards/courses/{c2}", headers=T1).status_code == 404
    assert c.get(f"/boards/courses/{c1}", headers=S1).status_code == 404
    _, ST2 = signup("st2", "staff")
    assert c.get(f"/boards/courses/{c1}", headers=ST2).status_code == 200
    cards = {x["name"]: x for x in c.get("/boards/courses", headers=ST2).json()}
    assert cards["뉴딜2기"]["student_count"] == 2 and cards["뉴딜2기"]["weekly_submissions"] == 1
    assert cards["뉴딜3기"]["weekly_submissions"] == 1
    assert [x["name"] for x in c.get("/boards/courses", headers=T1).json()] == ["뉴딜2기"]
    assert c.get("/boards/courses", headers=S1).status_code == 403

    # 교육생 기록 보기: 같은 반 교사·행정 관리자 OK, 다른 반 교사 X
    assert len(c.get(f"/students/{s1}/submissions", headers=T1).json()) == 3
    assert c.get(f"/students/{s2}/submissions", headers=T1).status_code == 404
    assert len(c.get(f"/students/{s2}/submissions", headers=ST2).json()) == 1
    assert c.get(f"/students/{s1}/submissions", headers=S2).status_code == 404
    info = c.get(f"/students/{s1}", headers=T1).json()
    assert info["can_care"] is True and info["can_edit"] is False
    info = c.get(f"/students/{s1}", headers=ST2).json()
    assert info["can_care"] is False and info["can_edit"] is False
    sid = next(r["id"] for r in db.TABLES["submissions"] if r["user_id"] == s1)
    d = c.get(f"/submissions/{sid}", headers=T1).json()
    assert d["user_id"] == s1 and d["owner_name"] == "s1"
    assert c.get(f"/submissions/{sid}", headers=S2).status_code == 404
    assert "owner_name" not in c.get(f"/submissions/{sid}", headers=S1).json()
    print("과정·회원 관리·보드 시험 통과")


if __name__ == "__main__":
    main()
