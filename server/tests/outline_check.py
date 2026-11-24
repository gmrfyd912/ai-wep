"""윤곽 2차 검토(Claude 비전) 흐름 시험: AI 호출은 가짜. 보이는 사람(끔/교사·관리자만/모두)과 목록 표시 확인.
실행: python -m tests.outline_check"""
import cv2
import numpy as np
from fastapi.testclient import TestClient

import app as server
import outline_review
import scoring
from engine import roboflow_client
from engine.config import Config
from tests import fake_db as db
from tests.synthetic_check import camera, make_plane


def main():
    cfg = Config()
    rng = np.random.default_rng(3)
    plane, poly, _ = make_plane(cfg, rng, lambda t: 8.0 + 0 * t, lambda t: 0 * t)
    img, pts = camera(plane, poly, rng, 10, 0)
    roboflow_client.predict = lambda im, c, timeout=60: [
        {"class": "Weld_Bead", "confidence": 0.9, "polygon": pts, "box": (*pts.min(0), *pts.max(0))}]
    seen = []

    def fake_review(im, timeout=30):
        seen.append(None if im is None else im.shape)
        return {"status": "check", "reason": "shadow", "where": "middle", "model": "fake"}

    outline_review.review = fake_review
    jpg = cv2.imencode(".jpg", img)[1].tobytes()
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    c = TestClient(server.app)
    cid = db.insert_rows("courses", {"name": "뉴딜2기"})[0]["id"]
    me = c.post("/auth/signup", json={"login_id": "o1", "password": "p", "name": "갑", "role": "student",
                                      "course_ids": [cid]}).json()
    H = {"Authorization": f"Bearer {me['token']}"}

    def set_mode(m):
        db.SETTINGS["criteria"] = {"outline_review": m}
        scoring.clear_cache()

    def upload():
        r = c.post("/analyze", headers=H, data={"process": "SMAW", "position": "1G"},
                   files={"photo": ("a.jpg", jpg, "image/jpeg")})
        assert r.status_code == 200, r.text
        return r.json()

    # 기본(교사·관리자만): 검토는 하고 저장되지만 교육생에게는 안 보임
    set_mode("staff")
    js = upload()
    assert seen and seen[-1] is not None and max(seen[-1][:2]) <= 1568, seen
    row = next(r for r in db.TABLES["submissions"] if r["id"] == js["id"])
    assert row["result"]["outline_review"]["status"] == "check"
    assert "outline_review" not in js["result"]
    assert "outline_review" not in c.get(f"/submissions/{js['id']}", headers=H).json()["result"]
    assert not any(x.get("outline_check") for x in c.get("/submissions", headers=H).json())
    # 모두 보임
    set_mode("all")
    d = c.get(f"/submissions/{js['id']}", headers=H).json()
    assert d["result"]["outline_review"]["reason"] == "shadow"
    assert any(x.get("outline_check") for x in c.get("/submissions", headers=H).json())
    # 끔: 검토하지 않음
    set_mode("off")
    n = len(seen)
    js2 = upload()
    assert len(seen) == n and "outline_review" not in js2["result"]
    # 검토가 실패해도 결과는 저장
    set_mode("all")
    outline_review.review = lambda im, timeout=30: (_ for _ in ()).throw(RuntimeError("x"))
    js3 = upload()
    assert js3["status"] == "ok" and js3["result"]["outline_review"]["status"] == "failed"
    print("윤곽 2차 검토 흐름 시험 통과")


if __name__ == "__main__":
    main()
