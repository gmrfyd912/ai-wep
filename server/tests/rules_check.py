"""6-4b 시험: 선급규정 세트 (AI 초안·저장·적용 하나만·결과 화면 선급 예비판정·AI 리포트 연결).
Claude 는 가짜로 대체 (돈 안 듦). 실행: python -m tests.rules_check"""
from fastapi.testclient import TestClient

import accounts
import app as server
import report
import rules
import scoring
from tests import fake_db as db


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


SRC = {"page": 3, "ref": "Table 4.2", "quote": "Cracks are not acceptable."}


def ai_out():
    def item(found, **kw):
        return {"found": found, "note": "", "source": SRC, **kw}
    return {
        "name": "외관검사 기준", "society": "DNV", "notes": "",
        "items": {
            "crack": item(True, allowed=False),
            "porosity": item(True, allowed=True, max_diameter_mm=3, max_count=2, per_length_mm=100),
            "undercut": item(True, allowed=True, max_length_mm=25),
            "overlap": item(True, allowed=False),
            "spatter": item(False, allowed=True),
            "width_variation": item(True, max_mm=2.0),
            "straightness": item(False, max_mm=None),
        },
        "manual": [{"name": "언더컷 깊이", "rule": "0.5mm 이하", "source": SRC},
                   {"name": "덧살 높이", "rule": "3mm 이하", "source": {"page": None, "ref": "", "quote": ""}}],
    }


def result(defects, wmin=7.0, wmax=8.5, dev=1.2):
    return {"bead": {"length_mm": 200, "width": {"min_mm": wmin, "max_mm": wmax, "mean_mm": 7.8},
                     "straightness": {"max_dev_mm": dev}},
            "defects": [{"type": t, "length_mm": ln, "pos_along_bead_mm": p} for t, ln, p in defects]}


def check_judge():
    rs = {"id": "x", "name": "n", "society": "DNV", **rules.draft_from_ai(ai_out())}
    j = rules.judge(result([]), rs)
    assert j["verdict"] == "pass", j
    keys = [(i["key"], i["check"]) for i in j["items"]]
    assert keys == [("crack", "none"), ("porosity", "max_diameter"), ("porosity", "count"),
                    ("undercut", "max_length"), ("overlap", "none"), ("width_variation", "max")], keys
    assert j["items"][0]["source"] == SRC and len(j["manual"]) == 2 and j["manual"][1]["source"] is None
    # 기공 3개가 100mm 안 → 개수 초과, 4mm 기공 → 지름 초과
    j = rules.judge(result([("Porosity", 2, 20), ("Porosity", 4, 60), ("Porosity", 1, 110)]), rs)
    bad = {(i["key"], i["check"]): i for i in j["items"] if not i["ok"]}
    assert j["verdict"] == "fail" and set(bad) == {("porosity", "max_diameter"), ("porosity", "count")}, bad
    assert bad[("porosity", "count")]["measured"] == 3 and bad[("porosity", "max_diameter")]["measured"] == 4
    # 100mm 넘게 떨어진 기공 2개씩은 통과
    j = rules.judge(result([("Porosity", 2, 10), ("Porosity", 2, 60), ("Porosity", 2, 170)]), rs)
    assert j["verdict"] == "pass", j
    # 균열 → 불합격, 폭 변화 2.5mm > 2.0 → 불합격, 언더컷 30mm > 25
    j = rules.judge(result([("crack", 5, 50), ("Undercut", 30, 80)], wmin=6.5, wmax=9.0), rs)
    bad = {i["key"] for i in j["items"] if not i["ok"]}
    assert bad == {"crack", "undercut", "width_variation"}, bad
    # 비드를 못 쟀으면 판정 없음, 세트 없으면 없음
    assert rules.judge({"status": "no_bead"}, rs) is None and rules.judge(result([]), None) is None
    # 균열은 허용으로 바꿀 수 없다
    assert rules.clean_items({"crack": {"check": True, "allowed": True}})["crack"]["allowed"] is False
    assert rules.pdf_pages(b"%PDF-1.4 /Type /Pages /Type /Page /Type/Page /Type /Page") == 3


def main():
    check_judge()
    db.install()
    scoring.clear_cache()
    rules.clear_cache()
    db.SETTINGS["signup"] = {"avatar_required": False}
    c = TestClient(server.app)

    def user(lid, role):
        u = db.insert_rows("users", {"login_id": lid, "login_key": lid, "name": lid, "role": role,
                                     "password_hash": accounts.hash_password("p")})[0]
        tok = c.post("/auth/login", json={"login_id": lid, "password": "p"}).json()["token"]
        return u["id"], H(tok)

    s1, S1 = user("s1", "student")
    t1, T1 = user("t1", "teacher")
    ad, A = user("ad", "admin")

    for h in (S1, T1):
        assert c.get("/admin/rules", headers=h).status_code == 403
        assert c.post("/admin/rules", json={}, headers=h).status_code == 403
    assert c.get("/admin/rules", headers=A).json()["items"] == []

    sid = db.insert_rows("submissions", {
        "user_id": s1, "device_id": "-", "status": "ok", "created_at": "2026-11-10T01:00:00+00:00",
        "process": "SMAW", "position": "1G", "photo_path": f"{s1}/a.jpg",
        "result": result([("Porosity", 2, 20), ("Porosity", 2, 40), ("Porosity", 2, 60)])})[0]["id"]
    assert "class_judgment" not in c.get(f"/submissions/{sid}", headers=S1).json()  # 적용 세트 없으면 카드 없음

    # AI 초안: 파일 검사
    calls = []

    def fake_extract(files):
        calls.append([mt for mt, _ in files])
        return ai_out()
    rules.extract = fake_extract
    pdf = b"%PDF-1.4\n" + b"/Type /Page\n" * 3
    r = c.post("/admin/rules/extract", headers=A, files=[("files", ("x.txt", b"hello", "text/plain"))])
    assert r.status_code == 415 and r.json()["detail"]["code"] == "bad_file", r.text
    r = c.post("/admin/rules/extract", headers=A, files=[("files", ("big.pdf", b"%PDF" + b"/Type /Page " * 21, "application/pdf"))])
    assert r.status_code == 413 and r.json()["detail"]["code"] == "too_many_pages", r.text
    assert not calls
    jpg = b"\xff\xd8\xff\xe0" + b"0" * 100
    r = c.post("/admin/rules/extract", headers=A, data={"name": ""},
               files=[("files", ("rule.pdf", pdf, "application/pdf")), ("files", ("p.jpg", jpg, "image/jpeg"))])
    assert r.status_code == 200, r.text
    d = r.json()
    assert calls == [["application/pdf", "image/jpeg"]]
    assert d["name"] == "외관검사 기준" and d["society"] == "DNV" and d["active"] is False
    assert d["items"]["porosity"] == {"check": True, "allowed": True, "max_diameter_mm": 3.0, "max_count": 2,
                                      "per_length_mm": 100.0, "source": SRC, "note": ""}, d["items"]["porosity"]
    assert d["items"]["spatter"]["check"] is False and len(d["manual"]) == 2
    assert [f["pages"] for f in d["files"]] == [3, 1] and all(f["url"] for f in d["files"])
    assert any(k.startswith(f"photos/rules/{d['id']}/1.pdf") for k in db.FILES)
    rid = d["id"]
    # 초안은 적용 전이라 결과에 안 나옴
    assert "class_judgment" not in c.get(f"/submissions/{sid}", headers=S1).json()

    # 수정 저장
    body = {"name": "", "society": "DNV", "notes": "", "items": d["items"], "manual": d["manual"]}
    assert c.put(f"/admin/rules/{rid}", json=body, headers=A).json()["detail"]["code"] == "no_name"
    bad = {**body, "name": "x", "items": {**d["items"], "width_variation": {"check": True, "max_mm": -1}}}
    assert c.put(f"/admin/rules/{rid}", json=bad, headers=A).json()["detail"]["code"] == "bad_value"
    items = {**d["items"], "porosity": {**d["items"]["porosity"], "max_count": 3}}
    r = c.put(f"/admin/rules/{rid}", json={**body, "name": "교육원 외관검사", "items": items}, headers=A)
    assert r.status_code == 200 and r.json()["items"]["porosity"]["max_count"] == 3 and r.json()["updated_by"] == "ad"

    # 적용 → 결과 화면에 선급 예비판정 (교사·본인 모두)
    assert c.post(f"/admin/rules/{rid}/activate", json={"active": True}, headers=A).json()["active"] is True
    for h in (S1, T1):
        cj = c.get(f"/submissions/{sid}", headers=h).json()["class_judgment"]
        assert cj["name"] == "교육원 외관검사" and cj["verdict"] == "pass", cj  # 기공 3개 ≤ 3
    # 점수(100점)는 그대로
    sc = c.get(f"/submissions/{sid}", headers=S1).json()["score"]
    assert sc["parts"]["defects"]["points"] == 0

    # 두 번째 세트를 적용하면 첫 세트는 꺼진다 (하나만)
    r2 = c.post("/admin/rules", json={"name": "KR"}, headers=A).json()
    assert r2["items"]["crack"]["check"] is False
    c.post(f"/admin/rules/{r2['id']}/activate", json={"active": True}, headers=A)
    lst = {x["id"]: x for x in c.get("/admin/rules", headers=A).json()["items"]}
    assert lst[rid]["active"] is False and lst[r2["id"]]["active"] is True and lst[rid]["checked"] == 5
    # 아무 항목도 없는 세트면 카드 없음
    assert "class_judgment" not in c.get(f"/submissions/{sid}", headers=S1).json()
    assert c.delete(f"/admin/rules/{r2['id']}", headers=A).json()["detail"]["code"] == "active"
    c.post(f"/admin/rules/{r2['id']}/activate", json={"active": False}, headers=A)
    assert c.delete(f"/admin/rules/{r2['id']}", headers=A).json()["ok"] is True
    assert c.get(f"/admin/rules/{r2['id']}", headers=A).status_code == 404
    assert c.get("/admin/rules/not-a-uuid", headers=A).status_code == 404

    # AI 리포트: 선급 판정이 함께 들어가고, 규정이 바뀌면 다시 만든다
    c.post(f"/admin/rules/{rid}/activate", json={"active": True}, headers=A)
    sent = []
    report.configured = lambda: True
    report.generate = lambda data, lang: (sent.append(data) or {"summary": "s", "strengths": [], "improvements": [],
                                                               "practice": [], "comparison": ""}, {"input_tokens": 1, "output_tokens": 1})
    import store
    reps = []
    store.get_report = lambda s, lang: next((x for x in reps if x["submission_id"] == s and x["lang"] == lang), None)
    store.insert_report = lambda x: reps.append({**x, "id": "r1"})
    store.update_report = lambda i, f: reps[0].update(f)
    store.count_reports_since_user = lambda u, since: 0
    r = c.post(f"/submissions/{sid}/report", json={"lang": "ko"}, headers=S1).json()
    assert r["cached"] is False and sent[0]["class_rule_judgment"]["verdict_fixed_by_rules"] == "pass"
    assert sent[0]["class_rule_judgment"]["teacher_check"] == ["언더컷 깊이", "덧살 높이"]
    assert c.post(f"/submissions/{sid}/report", json={"lang": "ko"}, headers=S1).json()["cached"] is True
    items["porosity"]["max_count"] = 2
    c.put(f"/admin/rules/{rid}", json={**body, "name": "교육원 외관검사", "items": items}, headers=A)
    r = c.post(f"/submissions/{sid}/report", json={"lang": "ko"}, headers=S1).json()
    assert r["cached"] is False and sent[-1]["class_rule_judgment"]["verdict_fixed_by_rules"] == "fail", sent[-1]
    # 규정을 끄면 선급 판정 없이 다시 만든다
    c.post(f"/admin/rules/{rid}/activate", json={"active": False}, headers=A)
    c.post(f"/submissions/{sid}/report", json={"lang": "ko"}, headers=S1)
    assert "class_rule_judgment" not in sent[-1]
    print("rules_check OK")


if __name__ == "__main__":
    main()
