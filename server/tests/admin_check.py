"""6-4단계 시험: 시스템관리자 설정(검사기준·합격점수·리포트 한도·비밀번호 규칙)과 학습용 사진 ZIP.
실행: python -m tests.admin_check"""
import io
import json
import zipfile

from fastapi.testclient import TestClient

import accounts
import app as server
import scoring
from tests import fake_db as db


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def main():
    db.install()
    scoring.clear_cache()
    db.SETTINGS["signup"] = {"avatar_required": False}
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
    s2, S2 = user("s2", "student", [c2])
    st, ST = user("st", "staff")
    ad, A = user("ad", "admin")

    # 관리자만
    for h in (S1, ST):
        assert c.get("/admin/settings", headers=h).status_code == 403
    v = c.get("/admin/settings", headers=A).json()
    assert v["pass_score"] == 80 and v["width"] == {"points": 40, "full_mm": 1.0, "zero_mm": 4.0}
    assert v["defects"]["porosity"] == 10 and v["defects"]["spatter"] == 0 and v["crack_fail"] is True
    assert v["report_daily_limit"] == 5 and v["password_min_length"] == 0 and v["reset_password"] == "0000"

    # 점수가 기준에 따라 바뀌는 분석 하나 (폭 차이 2mm, 직진 1mm, 기공 1개)
    sid = db.insert_rows("submissions", {
        "user_id": s1, "device_id": "-", "status": "ok", "created_at": "2026-11-10T01:00:00+00:00",
        "process": "SMAW", "position": "1G", "photo_path": f"{s1}/a.jpg",
        "result": {"image": {"width": 800, "height": 600},
                   "bead": {"width": {"min_mm": 7, "max_mm": 9}, "straightness": {"max_dev_mm": 1.0}},
                   "defects": [{"type": "Porosity"}],
                   "detections": {"boxes": [{"class": "Bead", "confidence": 0.9, "x": 10, "y": 20, "w": 300, "h": 40},
                                            {"class": "Porosity", "confidence": 0.7, "x": 50, "y": 25, "w": 8, "h": 8}]}}})[0]["id"]
    before = c.get(f"/submissions/{sid}", headers=S1).json()["score"]["score"]

    body = {**{k: v[k] for k in ("pass_score", "width", "straight", "crack_fail", "fail_score_cap",
                                  "report_daily_limit", "password_min_length", "reset_password")},
            "defects": dict(v["defects"])}
    bad = json.loads(json.dumps(body))
    bad["width"]["points"] = 50
    r = c.put("/admin/settings", headers=A, json=bad)
    assert r.status_code == 400 and r.json()["detail"] == {"code": "points_sum", "total": 110}
    bad = json.loads(json.dumps(body))
    bad["straight"]["zero_mm"] = 0.2
    assert c.put("/admin/settings", headers=A, json=bad).json()["detail"]["code"] == "bad_range"
    bad = json.loads(json.dumps(body))
    bad["password_min_length"] = 6
    assert c.put("/admin/settings", headers=A, json=bad).json()["detail"] == {"code": "reset_too_short", "min": 6}

    # 기공 감점 20, 합격 점수 90, 한도 2, 비밀번호 4자 이상·초기화 1234
    good = json.loads(json.dumps(body))
    good["defects"]["porosity"] = 20
    good.update(pass_score=90, report_daily_limit=2, password_min_length=4, reset_password="1234")
    out = c.put("/admin/settings", headers=A, json=good).json()
    assert out["pass_score"] == 90 and out["defects"]["porosity"] == 20 and out["updated_by"] == "ad"
    after = c.get(f"/submissions/{sid}", headers=S1).json()["score"]
    assert after["score"] == before - 10 and after["pass_score"] == 90  # 지난 분석도 새 기준으로
    assert scoring.criteria()["report_daily_limit"] == 2
    crit = next(r["value"] for r in db.TABLES["app_settings"] if r["key"] == "criteria")
    assert crit["defects"]["deduct"]["porosity"] == 20 and crit["fail_types"] == ["crack"]
    # 비밀번호 규칙·초기화 비밀번호가 실제로 쓰인다
    r = c.post("/me/password", headers=S1, json={"current": "p", "new": "abc"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "password_short"
    assert c.post(f"/manage/members/{s1}/reset-password", headers=A).json()["password"] == "1234"

    # ---- 학습용 사진 받기 ----
    sid2 = db.insert_rows("submissions", {  # 예전 사진 (라벨 없음), 다른 반
        "user_id": s2, "device_id": "-", "status": "ok", "created_at": "2026-11-15T01:00:00+00:00",
        "process": "GTAW", "position": "2G", "photo_path": f"{s2}/b.jpg",
        "result": {"bead": {"width": {"min_mm": 7, "max_mm": 8}, "straightness": {"max_dev_mm": 0.5}}, "defects": []}})[0]["id"]
    db.insert_rows("submissions", {"user_id": s2, "device_id": "-", "status": "ok", "created_at": "2026-11-16T01:00:00+00:00",
                                   "photo_path": f"{s2}/h.jpg", "hidden": True, "result": {}})  # 내린 것: 빠짐
    db.insert_rows("submissions", {"user_id": s2, "device_id": "-", "status": "no_bead",
                                   "created_at": "2026-11-16T02:00:00+00:00", "photo_path": f"{s2}/f.jpg"})  # 실패: 빠짐
    db.FILES[f"photos/{s1}/a.jpg"] = b"JPEG-A"
    db.FILES[f"photos/{s2}/b.jpg"] = b"JPEG-B"

    assert c.post("/admin/training-export", headers=ST, json={}).status_code == 403
    s = c.post("/admin/training-export", headers=A, json={"range": "all"}).json()
    assert s["total"] == 2 and s["labeled"] == 1 and len(s["parts"]) == 1 and s["last_export_at"] is None
    assert c.post("/admin/training-export", headers=A, json={"range": "all", "course": c2}).json()["total"] == 1
    assert c.post("/admin/training-export", headers=A, json={"range": "all", "process": "SMAW"}).json()["total"] == 1
    p = c.post("/admin/training-export", headers=A, json={"range": "period", "date_from": "2026-11-15", "date_to": "2026-11-15"}).json()
    assert p["total"] == 1

    r = c.get(s["parts"][0]["path"])  # 로그인 없이 링크로
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(z.namelist())
    assert {"labeled/000001.jpg", "unlabeled/000002.jpg", "labeled/_annotations.coco.json", "list.csv", "README.txt"} <= names
    assert z.read("labeled/000001.jpg") == b"JPEG-A"
    coco = json.loads(z.read("labeled/_annotations.coco.json"))
    assert coco["images"] == [{"id": 1, "file_name": "000001.jpg", "width": 800, "height": 600}]
    assert [a["bbox"] for a in coco["annotations"]] == [[10, 20, 300, 40], [50, 25, 8, 8]]
    assert sorted(x["name"] for x in coco["categories"]) == ["Bead", "Porosity"]
    listing = z.read("list.csv").decode("utf-8-sig")
    assert "s1" not in listing and "뉴딜3기" in listing  # 이름은 넣지 않음

    # 지난번 이후: 새 사진만
    n = c.post("/admin/training-export", headers=A, json={"range": "new"}).json()
    assert n["total"] == 0 and n["last_export_at"] == "2026-11-15T01:00:00+00:00"
    db.insert_rows("submissions", {"user_id": s1, "device_id": "-", "status": "ok", "created_at": "2026-11-20T01:00:00+00:00",
                                   "photo_path": f"{s1}/c.jpg", "result": {}})
    assert c.post("/admin/training-export", headers=A, json={"range": "new"}).json()["total"] == 1

    # 링크 위조·만료
    path = s["parts"][0]["path"]
    assert c.get(path[:-3] + "abc").status_code == 403
    import admin_settings
    old = admin_settings._sign({"ids": [sid], "start": 1, "exp": 1})
    assert c.get(f"/admin/training-export/download?t={old}").status_code == 410
    # 200장씩 나눔
    admin_settings.PART_SIZE = 2
    assert [len(range(x["first"], x["last"] + 1)) for x in
            c.post("/admin/training-export", headers=A, json={"range": "all"}).json()["parts"]] == [2, 1]
    admin_settings.PART_SIZE = 200
    _ = sid2
    print("시스템관리자 설정·학습용 사진 시험 통과")


if __name__ == "__main__":
    main()
