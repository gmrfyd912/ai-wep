"""G1 시험: 웰디의 조선소 (공부 → 자원, 짓기·올리기·공장·배 건조·즉시 완료권·처음 따라 하기·관리자 설정).
실행: python -m tests.game_check"""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

import accounts
import app as server
import daily
import game
from tests import fake_db as db
from tests.textbook_check import H

TOC = [{"title": "제1편 기초", "page": 4, "chapters": [{"title": "제1장 아크", "page": 4, "sections": []},
                                                    {"title": "제2장 가스", "page": 6, "sections": []}]}]
KST = timezone(timedelta(hours=9))
NOW = [datetime(2026, 12, 1, 1, 0, tzinfo=timezone.utc)]  # 한국 시간 12/1 오전 10시


def tick(sec):
    NOW[0] += timedelta(seconds=sec)


def main():
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    game._now = lambda: NOW[0]
    daily.today = lambda now=None: (now or NOW[0]).astimezone(KST).date()
    c = TestClient(server.app)

    def user(lid, role):
        u = db.insert_rows("users", {"login_id": lid, "login_key": lid, "name": lid, "role": role, "status": "active",
                                     "password_hash": accounts.hash_password("p")})[0]
        tok = c.post("/auth/login", json={"login_id": lid, "password": "p"}).json()["token"]
        return u["id"], H(tok)

    s1, S1 = user("s1", "student")
    _, T1 = user("t1", "teacher")
    _, A = user("admin", "admin")

    bid = db.insert_rows("textbooks", {"title": "용접 교재", "pages": 9, "page_offset": 0, "toc": TOC, "is_current": True,
                                       "status": "ready", "show_students": True, "use_for_ai": True})[0]["id"]
    qs = [db.insert_rows("quiz_questions", {"book_id": bid, "unit_key": "0-0", "unit_title": "제1장", "kind": k, "question": f"문제{i}",
                                            "choices": [], "answer": 0, "status": "active", "translations": {}})[0]["id"]
          for i, k in enumerate(["mc", "mc", "short"])]

    # 교사는 못 들어감
    assert c.get("/game/state", headers=T1).status_code == 403

    # 처음: 기본 건물 3개 + 환영 자원
    d = c.get("/game/state", headers=S1).json()
    types = sorted(b["type"] for b in d["buildings"])
    assert types == ["cutting", "dock", "hq"], types
    assert d["resources"]["steel"] == 500 and d["resources"]["rods"] == 300, d["resources"]
    assert d["run_today"] is False and d["tips"][0]["id"] == "daily"
    assert d["tutorial"]["step"] == 0 and not d["tutorial"]["done"]
    assert d["rewards"]["steel"] == 500

    # 공부 안 한 날: 공장이 안 돈다
    tick(3600)
    d = c.get("/game/state", headers=S1).json()
    assert d["pending"]["steel"] == 0, d["pending"]
    assert d["rewards"] is None

    # 오늘 매일 문제 3개: 2개 맞힘(객관식 1·서술형 1), 1개 틀림
    day = "2026-12-01"
    db.insert_rows("daily_sets", {"user_id": s1, "day": day, "book_id": bid, "question_ids": qs})
    db.insert_rows("daily_answers", {"user_id": s1, "day": day, "question_id": qs[0], "book_id": bid, "kind": "mc", "score": 10})
    db.insert_rows("daily_answers", {"user_id": s1, "day": day, "question_id": qs[1], "book_id": bid, "kind": "mc", "score": 0})
    d = c.get("/game/state", headers=S1).json()
    assert d["run_today"] is False  # 아직 2/3
    db.insert_rows("daily_answers", {"user_id": s1, "day": day, "question_id": qs[2], "book_id": bid, "kind": "short", "score": 8})
    d = c.get("/game/state", headers=S1).json()
    r = d["rewards"]
    assert r["steel"] == 300 and r["rods"] == 200, r  # 객관식 100 은 앞에서 이미 받음
    assert d["run_today"] is True
    assert d["resources"]["steel"] == 800 and d["resources"]["rods"] == 600
    assert d["tutorial"]["step"] == 1 and d["tutorial"]["spot"], d["tutorial"]
    # 다시 열어도 또 주지 않음
    d = c.get("/game/state", headers=S1).json()
    assert d["rewards"] is None and d["resources"]["steel"] == 800
    # 공장: 오늘 매일 문제를 다 풀었으니 지은 뒤 1시간치(시간당 60)가 쌓임
    assert d["pending"]["steel"] == 60, d["pending"]

    # 받기
    out = c.post("/game/collect", headers=S1).json()
    assert out["collected"]["steel"] == 60, out["collected"]
    assert out["resources"]["steel"] == 860
    # 창고가 가득 차면 남는 자리만큼만 (본관 기본 1000)
    tick(8 * 3600)
    out = c.post("/game/collect", headers=S1).json()
    assert out["collected"]["steel"] == 140 and out["resources"]["steel"] == 1000, out["collected"]

    # 야적장 짓기: 처음 따라 하기 자리에
    sp = d["tutorial"]["spot"]
    assert c.post("/game/build", headers=S1, json={"type": "yard", "x": 6, "y": 6}).status_code == 400  # 본관 자리
    assert c.post("/game/build", headers=S1, json={"type": "welding", "x": 0, "y": 10}).json()["detail"]["code"] == "hq_level"
    out = c.post("/game/build", headers=S1, json={"type": "yard", **sp}).json()
    yard = next(b for b in out["buildings"] if b["type"] == "yard")
    assert yard["level"] == 0 and yard["left"] == 60
    assert out["resources"]["steel"] == 800
    assert c.post("/game/build", headers=S1, json={"type": "yard", "x": 0, "y": 12}).json()["detail"]["code"] == "already"
    # 작업 반장 2명: 하나 더 (용접봉 창고), 세 번째는 막힘
    c.post("/game/build", headers=S1, json={"type": "rodstore", "x": 0, "y": 11})
    cut = next(b for b in out["buildings"] if b["type"] == "cutting")
    assert c.post("/game/upgrade", headers=S1, json={"id": cut["id"]}).json()["detail"]["code"] in ("builders", "hq_level")
    tick(61)
    d = c.get("/game/state", headers=S1).json()
    yard = next(b for b in d["buildings"] if b["type"] == "yard")
    assert yard["level"] == 1 and yard["just_done"], yard
    assert d["caps"]["steel"] == 1000 + 1500
    assert any(t["id"] == "built" for t in d["tips"])
    d = c.get("/game/state", headers=S1).json()
    assert not next(b for b in d["buildings"] if b["type"] == "yard")["just_done"]

    # 본관 2레벨: 장 완료 1개 필요 → 아직 0개
    hq = next(b for b in d["buildings"] if b["type"] == "hq")
    assert hq["block"] == "units" and hq["next"]["units_need"] == 1
    assert any(t["id"] == "units" for t in d["tips"])
    assert c.post("/game/upgrade", headers=S1, json={"id": hq["id"]}).json()["detail"]["code"] == "units"
    # 1장(쪽 4~5) 다 보고 + 1장 문제 2개 맞힘 → 장 완료, 기술 포인트 30
    for p in (4, 5):
        db.insert_rows("textbook_progress", {"user_id": s1, "book_id": bid, "page": p})
    d = c.get("/game/state", headers=S1).json()
    assert d["units"]["done"] == 1 and d["units"]["total"] == 2, d["units"]
    assert d["rewards"]["tech"] == 30 and d["rewards"]["why"] == {"unit_done": 1}, d["rewards"]
    hq = next(b for b in d["buildings"] if b["type"] == "hq")
    assert hq["block"] is None
    tick(4 * 3600)  # 공장 4시간 → 강판 240 (본관 비용 800 모으기)
    d = c.post("/game/collect", headers=S1).json()
    steel0 = d["resources"]["steel"]
    assert steel0 >= 800, d["resources"]
    out = c.post("/game/upgrade", headers=S1, json={"id": hq["id"]}).json()
    assert "resources" in out, (out, d["resources"])
    assert out["resources"]["steel"] == steel0 - 800 and out["resources"]["rods"] == d["resources"]["rods"] - 200
    hq = next(b for b in out["buildings"] if b["type"] == "hq")
    assert hq["left"] == 600 and hq["speed"]["tech"] == 1
    # 기술 포인트 1개로 바로 끝 (10분)
    out = c.post("/game/speedup", headers=S1, json={"target": hq["id"], "using": "tech"}).json()
    assert out["resources"]["tech"] == 29
    d = c.get("/game/state", headers=S1).json()
    assert d["hq_level"] == 2
    assert d["tutorial"]["steps"][4]["ok"]

    # 옮기기: 도크는 못 옮김, 겹치면 안 됨
    dock = next(b for b in d["buildings"] if b["type"] == "dock")
    assert c.post("/game/move", headers=S1, json={"id": dock["id"], "x": 0, "y": 0}).json()["detail"]["code"] == "fixed"
    cut = next(b for b in d["buildings"] if b["type"] == "cutting")
    assert c.post("/game/move", headers=S1, json={"id": cut["id"], "x": 6, "y": 6}).status_code == 400
    out = c.post("/game/move", headers=S1, json={"id": cut["id"], "x": 0, "y": 0}).json()
    assert next(b for b in out["buildings"] if b["type"] == "cutting")["x"] == 0

    # 배: 바지선 → 공정 5개 → 인도 명성 10
    assert next(x for x in d["ships"] if x["kind"] == "bulk")["lock"] == "dock"
    assert c.post("/game/ship/start", headers=S1, json={"kind": "barge"}).json()["detail"]["code"] == "money"
    db.insert_rows("game_ledger", {"user_id": s1, "key": "test_gift", "steel": 5000, "rods": 3000})  # 시험용 자원
    out = c.post("/game/ship/start", headers=S1, json={"kind": "barge"}).json()
    assert out["ship"]["stage"] == 0 and out["ship"]["left"] == 60
    assert c.post("/game/ship/next", headers=S1).json()["detail"]["code"] == "not_ready"
    for sec in game.STAGE_SECONDS:
        tick(sec)
        out = c.post("/game/ship/next", headers=S1).json()
    assert out["delivered_now"] == {"kind": "barge", "fame": 10}, out.get("delivered_now")
    assert out["resources"]["fame"] == 10 and out["ship"] is None and out["delivered"] == ["barge"]

    # 실습: 92점(높은 점수·첫 합격) → 완료권 하루 최대 2장 + 강판 200
    def sub(score_parts, when, pos="1G", width=8.0):
        w0, w1, dev = score_parts
        db.insert_rows("submissions", {"user_id": s1, "status": "ok", "work_type": "plate", "process": "GTAW", "position": pos,
                                       "created_at": when, "width_mean_mm": width, "width_min_mm": w0, "width_max_mm": w1,
                                       "straight_max_dev_mm": dev, "defect_count": 0, "defect_types": []})
    sub((7.9, 8.1, 0.2), NOW[0].isoformat())
    d = c.get("/game/state", headers=S1).json()
    assert d["rewards"]["passes"] == 2 and d["rewards"]["steel"] == 200, d["rewards"]
    # 같은 사진 다시 올림 (측정값 같음) → 안 줌
    sub((7.9, 8.1, 0.2), (NOW[0] + timedelta(seconds=5)).isoformat())
    d = c.get("/game/state", headers=S1).json()
    assert d["rewards"] is None
    # 완료권으로 공사 바로 끝
    out = c.post("/game/build", headers=S1, json={"type": "welding", "x": 0, "y": 6}).json()
    wel = next(b for b in out["buildings"] if b["type"] == "welding")
    out = c.post("/game/speedup", headers=S1, json={"target": wel["id"], "using": "pass"}).json()
    assert out["resources"]["passes"] == 1
    d = c.get("/game/state", headers=S1).json()
    assert next(b for b in d["buildings"] if b["type"] == "welding")["level"] == 1

    # 다음 날: 매일 문제 안 풀면 공장 멈춤 (전날 몫만 쌓임)
    c.post("/game/collect", headers=S1)
    tick(24 * 3600)
    d = c.get("/game/state", headers=S1).json()
    assert d["run_today"] is False
    p_before = d["pending"]["steel"]
    tick(3600)
    d = c.get("/game/state", headers=S1).json()
    assert d["pending"]["steel"] == p_before, (p_before, d["pending"])

    # 전에 틀린 문제를 다시 맞힘 → 기술 포인트 5 + 용접봉
    day2 = daily.today().isoformat()
    db.insert_rows("daily_sets", {"user_id": s1, "day": day2, "book_id": bid, "question_ids": [qs[1]]})
    db.insert_rows("daily_answers", {"user_id": s1, "day": day2, "question_id": qs[1], "book_id": bid, "kind": "mc", "score": 10,
                                     "created_at": NOW[0].isoformat()})
    d = c.get("/game/state", headers=S1).json()
    assert d["rewards"]["tech"] == 5 and d["rewards"]["rods"] == 100 and d["rewards"]["steel"] == 300, d["rewards"]
    assert d["run_today"] is True

    # 처음 따라 하기 끄기
    out = c.post("/game/tutorial", headers=S1, json={"done": True}).json()
    assert out["tutorial"]["done"]

    # 관리자 설정: 게임 끄기 → 교육생 못 들어감, 관리자는 들어감
    assert c.get("/admin/game-settings", headers=S1).status_code == 403
    st = c.get("/admin/game-settings", headers=A).json()
    assert st["settings"]["daily_done_steel"] == 300
    assert c.put("/admin/game-settings", headers=A, json={"daily_done_steel": -1}).status_code == 400
    assert c.put("/admin/game-settings", headers=A, json={"enabled": False, "daily_done_steel": 500}).json()["settings"]["daily_done_steel"] == 500
    assert c.get("/game/state", headers=S1).json()["detail"]["code"] == "game_off"
    assert c.get("/game/state", headers=A).status_code == 200
    print("game_check OK")


if __name__ == "__main__":
    main()
