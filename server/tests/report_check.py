"""5단계 점수·AI 리포트 흐름 시험. Supabase·Claude 는 가짜로 대체 (돈 안 듦).
실행: python -m tests.report_check"""
import json
import os
import types

from fastapi.testclient import TestClient

import app as server
import report
import scoring
import store

DEV = "test-device-1234"


def row(sid, created, width=(7.5, 8.5), dev=0.8, defects=(), status="ok", process="SMAW", position="1G"):
    return {
        "id": sid, "device_id": DEV, "status": status, "process": process, "position": position,
        "material": "CS", "created_at": created, "photo_path": None, "check_path": None,
        "width_mean_mm": sum(width) / 2, "straight_max_dev_mm": dev, "defect_count": len(defects),
        "result": {"status": status, "bead": {
            "length_mm": 180, "width": {"mean_mm": sum(width) / 2, "min_mm": width[0], "max_mm": width[1],
                                        "std_mm": 0.3, "min_pos_mm": 40, "max_pos_mm": 120},
            "straightness": {"max_dev_mm": dev, "max_dev_pos_mm": 90}},
            "defects": [{"type": t, "length_mm": 2.0, "pos_along_bead_mm": 50} for t in defects]},
    }


def check_scoring():
    c = scoring.DEFAULT_CRITERIA
    s = scoring.score(8.0, 8.8, 0.4, [], c)  # 폭차 0.8 → 40, 직진 0.4 → 30, 결함 없음 30
    assert s["score"] == 100 and s["verdict"] == "pass", s
    s = scoring.score(7.0, 9.5, 1.75, ["Porosity", "Spatter"], c)  # 폭차 2.5 → 20, 직진 1.75 → 15, 기공 −10 → 20
    assert s["score"] == 55 and s["verdict"] == "fail" and s["fail_low_score"] and not s["fail_reasons"], s  # 60 미만
    s = scoring.score(7.5, 9.0, 1.0, ["Porosity"], c)  # 폭차 1.5 → 33.3, 직진 1.0 → 24, 결함 20 → 77 (80 미만)
    assert s["score"] == 77 and s["verdict"] == "fail" and s["fail_low_score"], s  # 균열이 아니라 59로 깎이지 않음
    s = scoring.score(7.5, 9.0, 1.0, [], c)  # 87
    assert s["score"] == 87 and s["verdict"] == "pass", s
    assert scoring.score(7.5, 9.0, 1.0, ["Porosity"], scoring._merge(c, {"pass_score": 60}))["verdict"] == "pass"
    s = scoring.score(8.0, 8.5, 0.3, ["Crack"], c)  # 균열 → 불합격, 최대 59
    assert s["score"] == 59 and s["verdict"] == "fail" and s["fail_reasons"] == ["Crack"], s
    s = scoring.score(6.0, 11.0, 4.0, ["porosity"] * 4, c)  # 전부 0점 아래로 안 내려감
    assert s["score"] == 0, s
    assert scoring.score(None, 8, 1, [], c) is None
    # 관리자 설정이 기본값을 덮어씀
    merged = scoring._merge(c, {"defects": {"deduct": {"spatter": 2}}, "report_daily_limit": 5})
    assert merged["defects"]["deduct"]["porosity"] == 10 and merged["defects"]["deduct"]["spatter"] == 2
    assert merged["report_daily_limit"] == 5
    print("점수 공식 시험 통과")


def main():
    check_scoring()
    DB = {
        "a": row("00000000-0000-4000-8000-00000000000a", "2026-11-10T01:00:00Z", (7, 10), 2.5, ["Porosity"]),
        "b": row("00000000-0000-4000-8000-00000000000b", "2026-11-15T01:00:00Z", (7.5, 9), 1.5),
        "x": row("00000000-0000-4000-8000-00000000000c", "2026-11-16T01:00:00Z", position="2F"),
        "c": row("00000000-0000-4000-8000-00000000000d", "2026-11-20T01:00:00Z", (7.8, 8.6), 0.7, ["Spatter"]),
        "f": row("00000000-0000-4000-8000-00000000000e", "2026-11-20T02:00:00Z", status="no_bead"),
    }
    REPORTS = []
    store.get = lambda sid: next((r for r in DB.values() if r["id"] == sid), None)
    store.list_by_device = lambda d, n: [
        dict(r, width_min_mm=r["result"]["bead"]["width"]["min_mm"], width_max_mm=r["result"]["bead"]["width"]["max_mm"],
             defect_types=r["result"]["defects"], result=None)
        for r in DB.values() if r["device_id"] == d]
    store.signed_url = lambda b, p, expires=3600: None
    SETTINGS = {"report_daily_limit": 2}
    store.get_setting = lambda k: SETTINGS
    store.get_report = lambda sid, lang: next((r for r in REPORTS if r["submission_id"] == sid and r["lang"] == lang), None)
    store.insert_report = lambda r: REPORTS.append(r)
    store.count_reports_since = lambda d, since: sum(1 for r in REPORTS if r["device_id"] == d)
    scoring._CACHE.update(at=0, value=None)

    sent = []

    class FakeMessages:
        def create(self, **kw):
            sent.append(kw)
            data = json.loads(kw["messages"][0]["content"].split("\n", 1)[1].rsplit("\n\nWrite", 1)[0])
            hist = data["earlier_records_same_process_position"]
            assert [h["date"] for h in hist] == ["2026-11-10", "2026-11-15"], hist  # 같은 자세만, 오래된 순
            assert data["score_and_verdict_fixed_by_rules"]["score"] >= 0
            out = {"summary": "s", "strengths": ["a"], "improvements": ["b"], "practice": ["c"], "comparison": "d"}
            return types.SimpleNamespace(
                stop_reason="end_turn", usage=types.SimpleNamespace(input_tokens=1200, output_tokens=600),
                content=[types.SimpleNamespace(type="thinking"), types.SimpleNamespace(type="text", text=json.dumps(out))])

    fake = types.ModuleType("anthropic")
    fake.Anthropic = lambda **kw: types.SimpleNamespace(messages=FakeMessages())
    for n in ("AuthenticationError", "RateLimitError", "APIStatusError", "APIConnectionError"):
        setattr(fake, n, type(n, (Exception,), {}))
    import sys
    sys.modules["anthropic"] = fake

    c = TestClient(server.app)
    sid = DB["c"]["id"]
    # 상세 화면에 점수가 들어감
    d = c.get(f"/submissions/{sid}", params={"device_id": DEV}).json()
    assert d["score"]["verdict"] == "pass" and d["score"]["score"] > 80, d["score"]
    lst = c.get("/submissions", params={"device_id": DEV}).json()
    assert all("score" in r for r in lst)

    os.environ.pop("ANTHROPIC_API_KEY", None)
    r = c.post(f"/submissions/{sid}/report", json={"device_id": DEV, "lang": "vi"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "ai_not_configured", r.text

    os.environ["ANTHROPIC_API_KEY"] = "test"
    r = c.post(f"/submissions/{sid}/report", json={"device_id": DEV, "lang": "vi"})
    assert r.status_code == 200, r.text
    js = r.json()
    assert js["cached"] is False and js["report"]["summary"] == "s" and js["remaining"] == 1
    assert "Vietnamese" in sent[-1]["system"] and sent[-1]["model"] == "claude-haiku-5-5"
    assert "temperature" not in sent[-1] and sent[-1]["output_config"]["effort"] == "low"
    # 같은 사진·같은 언어 → 저장된 것, 돈 안 듦
    r = c.post(f"/submissions/{sid}/report", json={"device_id": DEV, "lang": "vi"})
    assert r.json()["cached"] is True and len(sent) == 1
    # 언어 바꾸면 새로 (2건째)
    assert c.post(f"/submissions/{sid}/report", json={"device_id": DEV, "lang": "ko"}).status_code == 200
    # 3건째는 하루 한도(2건)에 걸림
    r = c.post(f"/submissions/{DB['b']['id']}/report", json={"device_id": DEV, "lang": "ko"})
    assert r.status_code == 429 and r.json()["detail"] == {"code": "daily_limit", "limit": 2}, r.text
    # 이미 만든 리포트는 한도와 상관없이 다시 볼 수 있음
    assert c.post(f"/submissions/{sid}/report", json={"device_id": DEV, "lang": "vi"}).status_code == 200
    # 한도 없는 기기(박사 시험용)는 한도를 넘어도 만들 수 있음
    SETTINGS["report_unlimited_devices"] = [DEV]
    scoring._CACHE.update(at=0, value=None)
    r = c.post(f"/submissions/{sid}/report", json={"device_id": DEV, "lang": "th"})
    assert r.status_code == 200 and "remaining" not in r.json(), r.text
    del SETTINGS["report_unlimited_devices"]
    scoring._CACHE.update(at=0, value=None)
    # 분석 실패 사진, 남의 기기
    assert c.post(f"/submissions/{DB['f']['id']}/report", json={"device_id": DEV}).status_code == 409
    assert c.post(f"/submissions/{sid}/report", json={"device_id": "other-device-999"}).status_code == 404
    # 기준이 바뀌어 판정이 달라지면 저장된 리포트를 다시 만든다 (한도 초과여도)
    REPORTS[0]["verdict"] = "fail"
    n = len(sent)
    store.update_report = lambda rid, f: REPORTS[0].update(f)
    REPORTS[0]["id"] = "r1"
    r = c.post(f"/submissions/{sid}/report", json={"device_id": DEV, "lang": "vi"})
    assert r.status_code == 200 and r.json()["cached"] is False and len(sent) == n + 1, r.text
    assert REPORTS[0]["verdict"] == "pass" and len(REPORTS) == 3
    assert REPORTS[0]["input_tokens"] == 1200 and REPORTS[0]["score"] == d["score"]["score"]
    print("AI 리포트 흐름 시험 통과")


if __name__ == "__main__":
    main()
