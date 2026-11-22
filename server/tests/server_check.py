"""분석 서버(app.py) 흐름 시험: Supabase는 메모리 가짜, Roboflow는 합성 윤곽으로 대체.
실행: python -m tests.server_check"""
import cv2
import numpy as np
from fastapi.testclient import TestClient

import app as server
from engine import roboflow_client
from engine.config import Config
from tests.synthetic_check import camera, make_plane

from tests import fake_db as db

def main():
    cfg = Config()
    rng = np.random.default_rng(2)
    plane, poly, _ = make_plane(cfg, rng, lambda t: 8.0 + 0 * t, lambda t: 0 * t)
    img, pts = camera(plane, poly, rng, 15, 20)
    roboflow_client.predict = lambda im, c, timeout=60: [
        {"class": "Weld_Bead", "confidence": 0.9, "polygon": pts, "box": (*pts.min(0), *pts.max(0))}]
    ok, jpg = cv2.imencode(".jpg", img)
    db.install()
    c = TestClient(server.app)
    assert c.get("/health").json()["ok"]
    dev = "test-device-1234"
    cid = db.insert_rows("courses", {"name": "뉴딜2기"})[0]["id"]
    me = c.post("/auth/signup", json={"login_id": "u1", "password": "p", "name": "갑", "role": "student",
                                      "course_ids": [cid]}).json()
    other = c.post("/auth/signup", json={"login_id": "u2", "password": "p", "name": "을", "role": "student",
                                         "course_ids": [cid]}).json()  # 같은 반 교육생끼리도 남의 기록은 못 봄
    H = {"Authorization": f"Bearer {me['token']}"}
    assert c.post("/analyze", data={"device_id": dev}, files={"photo": ("a.jpg", b"1", "image/jpeg")}).status_code == 401
    r = c.post("/analyze", headers=H, data={"device_id": dev, "process": "SMAW", "position": "1G", "material": "CS",
                                  "job_id": "job-test-0001"},
               files={"photo": ("a.jpg", jpg.tobytes(), "image/jpeg")})
    assert r.status_code == 200, r.text
    js = r.json()
    print("status", js["status"], "폭 평균", js["width_mean_mm"], "직진도", js["straight_max_dev_mm"], "check", js["check_url"])
    assert js["status"] == "ok" and abs(js["width_mean_mm"] - 8.0) < 0.5 and js["check_url"]
    assert c.get("/progress/job-test-0001").json()["stage"] == "done"
    assert db.TABLES["submissions"][0]["user_id"] == me["user"]["id"]
    assert db.TABLES["submissions"][0]["photo_path"].startswith(me["user"]["id"] + "/")
    assert len(c.get("/submissions", headers=H).json()) == 1
    assert c.get(f"/submissions/{js['id']}", headers=H).status_code == 200
    H2 = {"Authorization": f"Bearer {other['token']}"}
    assert c.get(f"/submissions/{js['id']}", headers=H2).status_code == 404
    assert c.get("/submissions", headers=H2).json() == []
    assert c.post("/analyze", headers=H, files={"photo": ("a.jpg", b"1", "image/jpeg")}).status_code == 400
    # 마커 없는 사진
    blank = cv2.imencode(".jpg", np.full((600, 800, 3), 120, np.uint8))[1].tobytes()
    r2 = c.post("/analyze", headers=H, data={"device_id": dev}, files={"photo": ("b.jpg", blank, "image/jpeg")}).json()
    print("빈 사진 status", r2["status"])
    assert r2["status"] == "marker_not_found"
    print("서버 흐름 시험 통과")


if __name__ == "__main__":
    main()
