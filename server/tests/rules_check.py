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


def hd_set():
    """교육원 규정 같은 세트: 균열·기공·오버랩 불허, 언더컷 깊이 0.5(12t), 가운데 150mm, 덧살 공식."""
    def item(found, **kw):
        return {"found": found, "note": "", "source": SRC, **kw}
    out = {"name": "교육원 육안", "society": "교육원", "notes": "", "items": {
        "crack": item(True, allowed=False), "porosity": item(True, allowed=False),
        "undercut": item(True, allowed=True, max_depth_mm=0.5), "overlap": item(True, allowed=False),
        "spatter": item(False), "width_variation": item(False), "straightness": item(False)},
        "manual": [
            {"name": "덧살 높이", "rule": "h ≤ 1mm + 0.15b, 최대 7mm", "source": SRC, "joint": "butt",
             "formula": {"base": 1, "coef": 0.15, "cap": 7}},
            {"name": "볼록 높이", "rule": "h ≤ 1mm + 0.15b, 최대 4mm", "source": SRC, "joint": "fillet",
             "formula": {"base": 1, "coef": 0.15, "cap": 4}},
            {"name": "융합 불량", "rule": "불허", "source": SRC, "joint": "", "formula": None}],
        "options": {"plate_zone_mm": 150, "next_tests": {"plate_butt": "RT 또는 UT", "plate_fillet": "파단 시험",
                                                         "pipe_butt": "RT", "pipe_fillet": "마크로 시험"}}}
    return {"id": "hd", **rules.draft_from_ai(out)}


def check_hd():
    rs = hd_set()
    assert rs["options"]["plate_zone_mm"] == 150 and rs["options"]["crack_ends"] is True
    # 저장 모양(items 안 _options)으로도 같은 설정을 읽는다
    stored = {"id": "hd", "items": rules.stored_items(rs["items"], rs["options"]), "manual": rs["manual"]}
    assert rules.options_of(stored)["next_tests"]["plate_fillet"] == "파단 시험"
    assert "_options" not in rules.clean_items(stored["items"])
    j = rules.judge(result([]), stored, "2G", "plate")
    assert j["verdict"] == "pass" and j["joint"] == "butt" and j["next_test"] == "RT 또는 UT", j
    assert j["zone"] == {"start_mm": 25.0, "end_mm": 175.0, "length_mm": 150}, j["zone"]
    # 맞대기는 덧살만 (비드 폭 7.8 → 1 + 1.17 = 2.2mm), 필릿 항목은 빠짐
    names = {m["name"]: m for m in j["manual"]}
    assert set(names) == {"덧살 높이", "융합 불량"} and names["덧살 높이"]["limit_mm"] == 2.2, names
    assert names["덧살 높이"]["basis_mm"] == 7.8 and "limit_mm" not in names["융합 불량"]
    jf = rules.judge(result([]), stored, "3F", "plate")
    assert jf["joint"] == "fillet" and {m["name"] for m in jf["manual"]} == {"볼록 높이", "융합 불량"}
    assert jf["next_test"] == "파단 시험"
    # 넓은 비드는 최대값까지만: 폭 30 → 1 + 4.5 = 5.5 (맞대기 7 이하), 필릿은 4.0
    wide = result([]); wide["bead"]["width"]["mean_mm"] = 30
    assert {m["name"]: m.get("limit_mm") for m in rules.judge(wide, stored, "3F")["manual"]}["볼록 높이"] == 4.0
    # 언더컷 보이면 '확인 필요' (불합격 아님)
    j = rules.judge(result([("Undercut", 12, 90)]), stored, "2G", "plate")
    uc = [i for i in j["items"] if i["key"] == "undercut"][0]
    assert j["verdict"] == "review" and uc["ok"] is None and uc["check"] == "depth" and uc["limit"] == 0.5, j
    # 언더컷 + 기공 → 불합격이 우선
    assert rules.judge(result([("Undercut", 12, 90), ("Porosity", 1, 100)]), stored, "2G")["verdict"] == "fail"
    # 가운데 150mm 밖(25mm 전) 기공은 검사 범위 밖
    assert rules.judge(result([("Porosity", 1, 15)]), stored, "2G", "plate")["verdict"] == "pass"
    # 균열은 양 끝 10mm 도 본다 (크레이터 균열)
    r = result([]); r["bead"]["length_mm"] = 120  # 150 보다 짧으면 범위 제한 없음
    r["defects_end_zone"] = [{"type": "crack", "length_mm": 2, "pos_along_bead_mm": 115}, {"type": "Porosity", "length_mm": 1, "pos_along_bead_mm": 3}]
    j = rules.judge(r, stored, "2G", "plate")
    assert j["zone"] is None and j["verdict"] == "fail" and j["items"][0]["ends"] is True, j
    assert [i["key"] for i in j["items"] if i["ok"] is False] == ["crack"]  # 끝의 기공은 지금처럼 뺀다
    # 배관은 가운데 150mm 제한 없이, 나머지 둘레는 교사 확인 표시
    jp = rules.judge(result([("Porosity", 1, 15)]), stored, "6G", "pipe")
    assert jp["zone"] is None and jp["pipe_partial"] is True and jp["verdict"] == "fail" and jp["next_test"] == "RT"
    # 공식이 이상하면 버린다
    assert rules.clean_manual([{"name": "x", "formula": {"base": "a", "coef": 1}}])[0]["formula"] is None
    assert rules.clean_manual([{"name": "x", "joint": "weird"}])[0]["joint"] == ""


def check_schema():
    import json
    # strict 형식 검사는 anyOf(값 또는 null)를 요청 전체에서 16개까지만 받는다 (넘으면 400 "Schema is too complex")
    assert json.dumps(rules.SCHEMA).count("anyOf") <= 16
    # AI 는 '없음'을 -1, 쪽 모름을 0 으로 보낸다
    out = {"name": "n", "society": "", "notes": "", "items": {
        "crack": {"found": True, "allowed": False, "note": "", "source": {"page": 0, "ref": "T8", "quote": "q"}},
        "porosity": {"found": True, "allowed": True, "max_diameter_mm": 3, "max_count": -1, "per_length_mm": -1,
                     "note": "", "source": {"page": 2, "ref": "", "quote": ""}},
        "undercut": {"found": True, "allowed": True, "max_length_mm": -1, "max_depth_mm": 0.5, "note": "",
                     "source": {"page": 1, "ref": "", "quote": "x"}}},
        "manual": [{"name": "덧살", "rule": "r", "joint": "butt", "source": {"page": 1, "ref": "", "quote": ""},
                    "formula": {"base": 1, "coef": 0.15, "cap": 7}},
                   {"name": "목 두께", "rule": "r", "joint": "fillet", "source": {"page": 1, "ref": "", "quote": ""},
                    "formula": {"base": -1, "coef": -1, "cap": -1}}],
        "options": {"plate_zone_mm": -1, "next_tests": {"plate_butt": "RT", "plate_fillet": "", "pipe_butt": "", "pipe_fillet": ""}}}
    d = rules.draft_from_ai(out)
    assert d["items"]["crack"]["source"]["page"] is None and d["items"]["porosity"]["max_count"] is None
    assert d["items"]["porosity"]["max_diameter_mm"] == 3 and d["items"]["undercut"]["max_length_mm"] is None
    assert d["items"]["undercut"]["max_depth_mm"] == 0.5
    assert d["manual"][0]["formula"] == {"base": 1.0, "coef": 0.15, "cap": 7.0} and d["manual"][1]["formula"] is None
    assert d["options"]["plate_zone_mm"] is None and d["options"]["next_tests"]["plate_butt"] == "RT"
    # 큰 사진은 줄여서 보낸다
    import cv2
    import numpy as np
    big = cv2.imencode(".png", np.random.randint(0, 255, (3000, 4000, 3), np.uint8))[1].tobytes()
    mt, small = rules.shrink_image("image/png", big)
    img = cv2.imdecode(np.frombuffer(small, np.uint8), 1)
    assert mt == "image/jpeg" and max(img.shape[:2]) == rules.MAX_EDGE and len(small) <= rules.MAX_IMAGE_BYTES
    tiny = cv2.imencode(".jpg", np.zeros((100, 100, 3), np.uint8))[1].tobytes()
    assert rules.shrink_image("image/jpeg", tiny) == ("image/jpeg", tiny)
    assert rules.shrink_image("application/pdf", b"%PDF") == ("application/pdf", b"%PDF")


def main():
    check_schema()
    check_judge()
    check_hd()
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
    assert d["options"] == {"plate_zone_mm": None, "crack_ends": True,
                            "next_tests": {k: "" for k in rules.NEXT_TESTS}}, d["options"]
    # 설정(가운데 150mm·다음 시험)은 options 로 저장, 안 보내면 그대로 둔다
    opts = {"plate_zone_mm": 150, "crack_ends": True, "next_tests": {"plate_butt": "RT 또는 UT"}}
    r = c.put(f"/admin/rules/{rid}", json={**body, "name": "교육원 외관검사", "items": items, "options": opts}, headers=A)
    assert r.json()["options"]["plate_zone_mm"] == 150 and r.json()["options"]["next_tests"]["plate_butt"] == "RT 또는 UT"
    r = c.put(f"/admin/rules/{rid}", json={**body, "name": "교육원 외관검사", "items": items}, headers=A)
    assert r.json()["options"]["plate_zone_mm"] == 150
    r = c.put(f"/admin/rules/{rid}", json={**body, "name": "교육원 외관검사", "items": items, "options": {}}, headers=A)
    assert r.json()["options"]["plate_zone_mm"] is None and "_options" not in r.json()["items"]

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
