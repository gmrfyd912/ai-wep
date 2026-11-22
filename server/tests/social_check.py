"""6-3단계 시험: 갤러리·누구나 결과/리포트 보기·반응·댓글·대댓글·알림·내리기·랭킹.
실행: python -m tests.social_check"""
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

import accounts
import app as server
import manage
import social
from tests import fake_db as db


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def main():
    db.install()
    c = TestClient(server.app)
    c1 = db.insert_rows("courses", {"name": "뉴딜2기", "sort": 1})[0]["id"]
    c2 = db.insert_rows("courses", {"name": "뉴딜3기", "sort": 2})[0]["id"]

    def user(lid, role, courses=()):
        u = db.insert_rows("users", {"login_id": lid, "login_key": lid, "name": lid, "role": role,
                                     "password_hash": accounts.hash_password("p")})[0]
        for cid in courses:
            db.insert_rows("user_courses", {"user_id": u["id"], "course_id": cid}, returning=False)
        tok = c.post("/auth/login", json={"login_id": lid, "password": "p"}).json()["token"]
        return u["id"], H(tok)

    s1, S1 = user("s1", "student", [c1])
    s2, S2 = user("s2", "student", [c1])
    s3, S3 = user("s3", "student", [c2])
    t1, T1 = user("t1", "teacher", [c1])
    t2, T2 = user("t2", "teacher", [c2])
    ad, A = user("ad", "admin")

    now = datetime.now(manage.KST)
    week = social.period_start("week")
    month = social.period_start("month")
    today = social.period_start("day")

    def sub(uid, created, wmin, wmax, dev, process="SMAW", position="1G", status="ok", defects=()):
        return db.insert_rows("submissions", {
            "user_id": uid, "device_id": "-", "status": status, "created_at": created, "process": process,
            "position": position, "width_min_mm": wmin, "width_max_mm": wmax, "straight_max_dev_mm": dev,
            "defect_types": [{"type": d} for d in defects], "photo_path": f"{uid}/x.jpg",
            "result": {"bead": {"width": {"min_mm": wmin, "max_mm": wmax}, "straightness": {"max_dev_mm": dev}},
                       "defects": [{"type": d} for d in defects]}})[0]["id"]

    a = sub(s1, now.isoformat(), 8, 8.8, 0.4)                            # 100점 (오늘)
    b = sub(s2, (now - timedelta(minutes=5)).isoformat(), 8, 8.8, 0.4)   # 100점, 먼저 냄
    d = sub(s3, now.isoformat(), 7, 10, 2.5, defects=["Porosity"])       # 다른 반, 낮은 점수
    f = sub(s1, now.isoformat(), 8, 9, 1, status="marker_not_found")     # 실패 → 갤러리에 없음
    old = sub(s1, "2020-01-01T00:00:00+09:00", 8, 8.5, 0.3)              # 예전 100점 (종합만)
    tt = sub(t1, now.isoformat(), 8, 8.8, 0.4)                           # 교사 사진: 갤러리 O, 랭킹 X
    g = sub(s3, now.isoformat(), 8, 8.8, 0.4, process="GTAW")            # 다른 용접법

    # 갤러리: 전체 / 반별 / 용접법
    ids = [x["id"] for x in c.get("/gallery", headers=S3).json()["items"]]
    assert set(ids) == {a, b, d, old, tt, g} and f not in ids
    ids = [x["id"] for x in c.get(f"/gallery?course={c1}", headers=S3).json()["items"]]
    assert set(ids) == {a, b, old, tt}
    assert [x["id"] for x in c.get("/gallery?process=GTAW", headers=S1).json()["items"]] == [g]
    item = next(x for x in c.get("/gallery", headers=S3).json()["items"] if x["id"] == a)
    assert item["name"] == "s1" and item["courses"] == ["뉴딜2기"] and item["score"] == 100 and item["photo_url"]
    page = c.get("/gallery?limit=2", headers=S1).json()
    assert len(page["items"]) == 2 and page["more"]
    nxt = c.get(f"/gallery?limit=10&before={page['items'][-1]['created_at']}", headers=S1).json()["items"]
    assert not ({x["id"] for x in nxt} & {x["id"] for x in page["items"]})

    # 누구나 결과·기록 보기 (다른 반 교육생), 실패한 건 남이 못 봄
    assert c.get(f"/submissions/{a}", headers=S3).status_code == 200
    assert c.get(f"/submissions/{f}", headers=S3).status_code == 404
    assert c.get(f"/submissions/{f}", headers=T1).status_code == 200
    assert {x["id"] for x in c.get(f"/students/{s1}/submissions", headers=S3).json()} == {a, old}
    assert len(c.get(f"/students/{s1}/submissions", headers=T1).json()) == 3
    info = c.get(f"/students/{s1}", headers=S3).json()
    assert info["name"] == "s1" and info["can_care"] is False and "login_id" not in info
    assert c.get(f"/students/{t1}", headers=S3).json()["role"] == "teacher"

    # AI 리포트: 다른 사람은 만들어진 것만 봄
    r = c.post(f"/submissions/{a}/report", headers=S3, json={"lang": "ko"})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "no_report"
    db.insert_rows("reports", {"submission_id": a, "user_id": s1, "lang": "en", "report": {"summary": "hi"},
                               "score": 100, "verdict": "pass"}, returning=False)
    r = c.post(f"/submissions/{a}/report", headers=S3, json={"lang": "ko"}).json()
    assert r["report"] == {"summary": "hi"} and r["lang"] == "en"

    # 반응: 하나만, 바꾸기, 지우기
    assert c.put(f"/submissions/{a}/reaction", headers=S2, json={"emoji": "nope"}).status_code == 400
    c.put(f"/submissions/{a}/reaction", headers=S2, json={"emoji": "heart"})
    c.put(f"/submissions/{a}/reaction", headers=S3, json={"emoji": "heart"})
    r = c.put(f"/submissions/{a}/reaction", headers=S2, json={"emoji": "wow"}).json()
    assert r["reactions"] == {"heart": 1, "wow": 1} and r["my_reaction"] == "wow"
    assert c.put(f"/submissions/{a}/reaction", headers=S3, json={"emoji": None}).json()["reactions"] == {"wow": 1}

    # 댓글 → 글쓴이(s1) 알림, 대댓글 → 댓글쓴이(s3) 알림, 자기 글에 단 댓글은 알림 없음
    cm = c.post(f"/submissions/{a}/comments", headers=S3, json={"body": "  멋져요  "}).json()
    assert cm["body"] == "멋져요" and cm["can_delete"] is True
    assert c.post(f"/submissions/{a}/comments", headers=S3, json={"body": " "}).status_code == 400
    assert c.post(f"/submissions/{a}/comments", headers=S3, json={"body": "x" * 501}).status_code == 400
    rp = c.post(f"/submissions/{a}/comments", headers=S1, json={"body": "고마워", "parent_id": cm["id"]}).json()
    rp2 = c.post(f"/submissions/{a}/comments", headers=S2, json={"body": "나도", "parent_id": rp["id"]}).json()
    assert rp2["parent_id"] == cm["id"]  # 대댓글의 답도 같은 묶음
    c.post(f"/submissions/{a}/comments", headers=S1, json={"body": "내 글"})
    assert c.get("/notifications/unread", headers=S1).json()["count"] == 1
    n = c.get("/notifications", headers=S1).json()
    assert n[0]["kind"] == "comment" and n[0]["actor_name"] == "s3" and n[0]["body"] == "멋져요" and n[0]["submission_id"] == a
    assert c.get("/notifications/unread", headers=S3).json()["count"] == 2  # s1, s2 의 대댓글
    c.post("/notifications/read", headers=S1, json={})
    assert c.get("/notifications/unread", headers=S1).json()["count"] == 0
    soc = c.get(f"/submissions/{a}/social", headers=S2).json()
    assert [x["body"] for x in soc["comments"]] == ["멋져요", "고마워", "나도", "내 글"]
    assert [x["can_delete"] for x in soc["comments"]] == [False, False, True, False]
    assert soc["can_moderate"] is False and c.get(f"/submissions/{a}/social", headers=T1).json()["can_moderate"] is True
    # 지우기: 남의 댓글 X, 다른 반 교사 X, 같은 반 교사 O (대댓글도 함께)
    assert c.delete(f"/comments/{cm['id']}", headers=S2).status_code == 403
    assert c.delete(f"/comments/{cm['id']}", headers=T2).status_code == 403
    assert c.delete(f"/comments/{cm['id']}", headers=T1).status_code == 200
    assert [x["body"] for x in c.get(f"/submissions/{a}/social", headers=S2).json()["comments"]] == ["내 글"]

    # 내리기: 교육생 X, 다른 반 교사 X, 같은 반 교사 O → 갤러리·남에게 안 보임, 본인은 보임
    assert c.post(f"/submissions/{a}/hide", headers=S2, json={"hidden": True}).status_code == 403
    assert c.post(f"/submissions/{a}/hide", headers=T2, json={"hidden": True}).status_code == 403
    assert c.post(f"/submissions/{a}/hide", headers=T1, json={"hidden": True}).status_code == 200
    assert a not in [x["id"] for x in c.get("/gallery", headers=S3).json()["items"]]
    assert c.get(f"/submissions/{a}", headers=S3).status_code == 404
    assert c.get(f"/submissions/{a}", headers=S1).status_code == 200
    c.post(f"/submissions/{a}/hide", headers=A, json={"hidden": False})
    assert a in [x["id"] for x in c.get("/gallery", headers=S3).json()["items"]]

    # 랭킹: 교육생만, 같은 용접법·자세, 최고 점수, 같으면 먼저 낸 사람 위
    r = c.get("/ranking?process=SMAW&position=1G&period=day", headers=S3).json()
    assert [x["name"] for x in r["rows"]] == ["s2", "s1", "s3"], r
    assert [x["rank"] for x in r["rows"]] == [1, 2, 3] and r["me"]["rank"] == 3 and r["me"]["name"] == "s3"
    assert r["rows"][0]["submission_id"] == b and r["rows"][0]["courses"] == ["뉴딜2기"]
    r = c.get(f"/ranking?process=SMAW&position=1G&period=week&course={c2}", headers=S1).json()
    assert [x["name"] for x in r["rows"]] == ["s3"] and r["me"] is None
    r = c.get("/ranking?process=SMAW&position=1G&period=all", headers=S1).json()
    assert r["rows"][0]["name"] == "s1" and r["rows"][0]["submission_id"] == old  # 예전 100점이 먼저
    assert c.get("/ranking?process=GTAW&position=1G&period=all", headers=S1).json()["rows"][0]["name"] == "s3"
    assert c.get("/ranking?process=SMAW&position=1G&period=year", headers=S1).status_code == 400
    assert week <= today and month <= today

    # 계정 삭제하면 댓글·반응·알림도 사라짐
    c.post(f"/submissions/{b}/comments", headers=S3, json={"body": "bye"})
    c.post("/me/delete", headers=S3, json={"password": "p"})
    assert not any(x["user_id"] == s3 for x in db.TABLES["comments"])
    print("갤러리·댓글·랭킹 시험 통과")


if __name__ == "__main__":
    main()
