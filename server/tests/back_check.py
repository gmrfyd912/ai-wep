"""이면(뒷면) 사진 시험: 정면+이면을 한 번에 올리면 둘 다 분석하고, 한 기록 안에 함께 저장한다.
Supabase 는 메모리 가짜, Roboflow 는 합성 윤곽, Claude 는 가짜. 실행: python -m tests.back_check"""
import cv2
import numpy as np
from fastapi.testclient import TestClient

import app as server
import report
import rules
import store
from engine import roboflow_client
from engine.config import Config
from tests import fake_db as db
from tests.synthetic_check import camera, make_plane


def photo(width_mm, seed):
    cfg = Config()
    rng = np.random.default_rng(seed)
    plane, poly, _ = make_plane(cfg, rng, lambda t: width_mm + 0 * t, lambda t: 0 * t)
    img, pts = camera(plane, poly, rng, 15, 20)
    return cv2.imencode(".jpg", img)[1].tobytes(), pts


def check_rules():
    """이면 판정: 이면 쪽 교사 확인 항목만, 허용치는 이면 폭으로. 정면에서는 이면 항목이 빠진다."""
    items = rules.empty_items()
    items["porosity"].update(check=True, allowed=False)
    rs = {"id": "x", "name": "HD", "society": "", "items": items, "manual": [
        {"name": "덧살 높이", "rule": "h ≤ 1 + 0.15b", "joint": "butt", "formula": {"base": 1, "coef": 0.15, "cap": 7}},
        {"name": "이면 덧살", "rule": "h ≤ 1 + 0.6b", "joint": "butt", "formula": {"base": 1, "coef": 0.6, "cap": 4}},
        {"name": "루트 오목", "rule": "h ≤ 0.5", "joint": "", "formula": None},
        {"name": "뒷면 기공", "rule": "불허", "joint": "", "formula": None},
        {"name": "융합 불량", "rule": "불허", "joint": "", "formula": None}]}
    res = {"bead": {"length_mm": 200, "width": {"min_mm": 9, "max_mm": 11, "mean_mm": 10}, "straightness": {"max_dev_mm": 1}},
           "defects": []}
    back = {"bead": {"length_mm": 200, "width": {"min_mm": 4, "max_mm": 6, "mean_mm": 5}, "straightness": {"max_dev_mm": 1}},
            "defects": [{"type": "Porosity", "length_mm": 1, "pos_along_bead_mm": 80}]}
    # 이면 없는 기록: 지금까지와 같음 (교사 확인 5개)
    j = rules.judgment_for({"result": res, "position": "1G"}, rs=rs)
    assert len(j["manual"]) == 5 and "side" not in j
    row = {"result": {**res, "back": {"status": "ok", "photo_path": "p", "result": back}}, "position": "1G"}
    f = rules.judgment_for(row, "front", rs)
    assert [m["name"] for m in f["manual"]] == ["덧살 높이", "융합 불량"], f["manual"]
    assert f["verdict"] == "pass"
    b = rules.judgment_for(row, "back", rs)
    assert [m["name"] for m in b["manual"]] == ["이면 덧살", "루트 오목"], b["manual"]  # 뒷면 기공은 자동 판정
    assert b["manual"][0]["limit_mm"] == 4.0 and b["manual"][0]["basis_mm"] == 5.0  # 1 + 0.6×5 = 4
    assert b["verdict"] == "fail" and b["side"] == "back"  # 이면 기공 1개 → 불합격
    # 이면 분석 실패면 이면 판정 없음
    row["result"]["back"]["status"] = "no_bead"
    assert rules.judgment_for(row, "back", rs) is None


def main():
    check_rules()
    front, fpts = photo(8.0, 2)
    back, bpts = photo(4.0, 3)
    polys = {}

    def fake_predict(im, c, timeout=60):
        pts = polys["next"]
        return [{"class": "Weld_Bead", "confidence": 0.9, "polygon": pts, "box": (*pts.min(0), *pts.max(0))}]

    order = []
    roboflow_client.predict = lambda im, c, timeout=60: fake_predict(im, c, timeout)
    real_analyze = server.analyze_image

    def analyze_image(img, *a, **kw):
        polys["next"] = fpts if not order else bpts
        order.append(1)
        return real_analyze(img, *a, **kw)

    server.analyze_image = analyze_image
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    c = TestClient(server.app)
    cid = db.insert_rows("courses", {"name": "뉴딜2기"})[0]["id"]
    me = c.post("/auth/signup", json={"login_id": "b1", "password": "p", "name": "갑", "role": "student",
                                      "course_ids": [cid]}).json()
    H = {"Authorization": f"Bearer {me['token']}"}
    files = {"photo": ("a.jpg", front, "image/jpeg"), "back_photo": ("b.jpg", back, "image/jpeg")}

    # 필렛·배관은 이면 사진을 받지 않는다
    r = c.post("/analyze", headers=H, data={"position": "1F"}, files=files)
    assert r.status_code == 400 and "back_not_allowed" in r.text
    r = c.post("/analyze", headers=H, data={"position": "1G", "work_type": "pipe", "pipe_od_mm": "114.3"}, files=files)
    assert r.status_code == 400 and "back_not_allowed" in r.text
    assert not db.TABLES.get("submissions")

    order.clear()
    r = c.post("/analyze", headers=H, data={"process": "SMAW", "position": "1G", "material": "CS", "job_id": "job-back-0001"},
               files=files)
    assert r.status_code == 200, r.text
    js = r.json()
    print("정면 폭", js["width_mean_mm"], "이면 폭", js["back"]["width_mean_mm"], "이면 점수", js["back"]["score"]["score"])
    assert len(order) == 2
    assert js["status"] == "ok" and abs(js["width_mean_mm"] - 8.0) < 0.5
    assert js["back"]["status"] == "ok" and abs(js["back"]["width_mean_mm"] - 4.0) < 0.5
    assert js["back"]["photo_url"] and js["back"]["check_url"] and js["back"]["score"]["verdict"] in ("pass", "fail")
    assert "back" not in js["result"]  # 정면 결과에는 이면을 섞지 않는다
    assert c.get("/progress/job-back-0001").json()["stage"] == "done"
    # 기록은 하나만, 이면은 그 안에
    assert len(db.TABLES["submissions"]) == 1
    row = db.TABLES["submissions"][0]
    assert row["result"]["back"]["photo_path"].endswith("_back.jpg")
    assert f"photos/{row['result']['back']['photo_path']}" in db.FILES
    assert f"results/{row['result']['back']['check_path']}" in db.FILES
    # 정면 점수는 정면 숫자로만 (랭킹·누적 분석은 정면)
    assert abs(row["width_mean_mm"] - 8.0) < 0.5
    lst = c.get("/submissions", headers=H).json()
    assert len(lst) == 1 and lst[0]["has_back"] is True
    d = c.get(f"/submissions/{js['id']}", headers=H).json()
    assert d["back"]["status"] == "ok"

    # 이면 없이 올리면 지금과 같다
    r = c.post("/analyze", headers=H, data={"position": "1G"}, files={"photo": ("a.jpg", front, "image/jpeg")}).json()
    assert "back" not in r and "has_back" not in r
    lst = {x["id"]: x for x in c.get("/submissions", headers=H).json()}
    assert "has_back" not in lst[r["id"]]

    # AI 리포트: 한 리포트에 이면도 함께
    sent = []
    report.configured = lambda: True
    report.generate = lambda data, lang: (sent.append(data) or {"summary": "s", "strengths": [], "improvements": [],
                                                               "practice": [], "comparison": ""}, {"input_tokens": 1, "output_tokens": 1})
    reps = []
    store.get_report = lambda s, lang: next((x for x in reps if x["submission_id"] == s and x["lang"] == lang), None)
    store.insert_report = lambda x: reps.append({**x, "id": "r1"})
    store.update_report = lambda i, f: reps[0].update(f)
    store.count_reports_since_user = lambda u, since: 0
    out = c.post(f"/submissions/{js['id']}/report", json={"lang": "ko"}, headers=H).json()
    assert out["cached"] is False
    bs = sent[-1]["back_side"]
    assert abs(bs["width"]["mean_mm"] - 4.0) < 0.5 and bs["back_score_and_verdict_fixed_by_rules"]["score"] >= 0
    assert abs(sent[-1]["width"]["mean_mm"] - 8.0) < 0.5
    c.post(f"/submissions/{r['id']}/report", json={"lang": "ko"}, headers=H)
    assert "back_side" not in sent[-1]

    # 계정 삭제 때 이면 사진·확인 그림도 지운다
    removed = []
    store.remove_files = lambda bucket, paths: removed.extend(p for p in paths if p)
    assert c.post("/me/delete", json={"password": "p"}, headers=H).json()["ok"] is True
    assert row["result"]["back"]["photo_path"] in removed and row["result"]["back"]["check_path"] in removed
    print("이면 사진 시험 통과")


if __name__ == "__main__":
    main()
