"""T1 시험: 교재 올리기(쪽 나누기)·목차·진도·권한. Claude 는 부르지 않음. 실행: python -m tests.textbook_check"""
import io

from fastapi.testclient import TestClient

import accounts
import app as server
import report
import textbook
from tests import fake_db as db


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def make_pdf(pages):
    """글자만 있는 아주 작은 PDF (쪽마다 줄 목록)."""
    objs = []

    def add(body):
        objs.append(body)
        return len(objs)

    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    pages_id = len(objs) + 1 + 2 * len(pages)
    kids = []
    for lines in pages:
        stream = b"BT /F1 12 Tf 50 780 Td 14 TL " + b" ".join(b"(" + ln.encode() + b") Tj T*" for ln in lines) + b" ET"
        c = add(b"<< /Length %d >>stream\n" % len(stream) + stream + b"\nendstream")
        kids.append(add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
                        % (pages_id, font, c)))
    assert add(b"<< /Type /Pages /Kids [" + b" ".join(b"%d 0 R" % k for k in kids) + b"] /Count %d >>" % len(kids)) == pages_id
    cat = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offs = []
    for i, body in enumerate(objs, 1):
        offs.append(out.tell())
        out.write(b"%d 0 obj\n" % i + body + b"\nendobj\n")
    x = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
    for o in offs:
        out.write(b"%010d 00000 n \n" % o)
    out.write(b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, cat, x))
    return out.getvalue()


def book_pdf():
    pages = [["Title"], ["Preface"], ["Contents", "Chapter 1 Basics ...... 4", "1. Intro ...... 4", "2. Arc ...... 5",
                                      "Chapter 2 Gas ...... 6", "3. Gas ...... 6"]]
    for p in range(4, 9):
        pages.append([f"{p}  Chapter text", "body", f"page {p}"])
    return make_pdf(pages)


def check_helpers():
    texts = {3: "Contents\nChapter 1 ...... 4", 4: "x", 10: "8 Part one\nbody", 11: "9 Part\nx", 12: "10 a\nb", 13: "x\n11"}
    assert textbook.find_toc_pages(texts) == "3", textbook.find_toc_pages(texts)
    assert textbook.detect_offset(texts) == 2, textbook.detect_offset(texts)
    assert textbook.parse_range("5-8", 10) == [5, 6, 7, 8]
    assert textbook.parse_range("9-12", 10) == []
    assert textbook.parse_range("abc", 10) == []
    raw = [{"title": " Part 1 ", "page": 0, "chapters": [
        {"title": "Ch 1", "page": 4, "sections": [{"title": "1. A", "page": 4}, {"title": "", "page": 5}]},
        {"title": "Ch 2", "page": 6, "sections": []}]},
        {"title": "", "chapters": []}, {"title": "Appendix", "page": 99}]
    toc = textbook.clean_toc(raw, 8, 0)
    assert [p["title"] for p in toc] == ["Part 1", "Appendix"], toc
    assert toc[0]["page"] == 4 and toc[1]["page"] is None  # 편 쪽이 없으면 첫 장 쪽, 범위 밖이면 None
    assert len(toc[0]["chapters"][0]["sections"]) == 1
    pr = textbook.toc_with_progress(toc, 0, 8, {4, 5, 7})
    ch = pr[0]["chapters"]
    assert (ch[0]["pdf_page"], ch[0]["end_pdf_page"], ch[0]["done"], ch[0]["total"]) == (4, 5, 2, 2), ch[0]
    assert (ch[1]["end_pdf_page"], ch[1]["done"], ch[1]["total"]) == (8, 1, 3), ch[1]
    assert pr[0]["done"] == 3 and pr[0]["total"] == 5
    pr2 = textbook.toc_with_progress(toc, 2, 10, {6})
    assert pr2[0]["chapters"][0]["pdf_page"] == 6 and pr2[0]["chapters"][0]["done"] == 1


def main():
    check_helpers()
    db.install()
    db.SETTINGS["signup"] = {"avatar_required": False}
    report.configured = lambda: False  # AI 목차는 부르지 않음
    textbook._start_job = textbook.process_book  # 시험에서는 쪽 나누기를 바로 실행
    c = TestClient(server.app)

    def user(lid, role):
        u = db.insert_rows("users", {"login_id": lid, "login_key": lid, "name": lid, "role": role,
                                     "password_hash": accounts.hash_password("p")})[0]
        tok = c.post("/auth/login", json={"login_id": lid, "password": "p"}).json()["token"]
        return u["id"], H(tok)

    s1, S1 = user("s1", "student")
    t1, T1 = user("t1", "teacher")
    ad, A = user("ad", "admin")

    assert c.get("/textbook", headers=S1).json() == {"book": None}
    for h in (S1, T1):
        assert c.get("/admin/textbooks", headers=h).status_code == 403
        assert c.post("/admin/textbooks/upload", files={"file": ("a.pdf", b"%PDF-1", "application/pdf")}, headers=h).status_code == 403
    assert c.post("/admin/textbooks/upload", files={"file": ("a.txt", b"hello", "text/plain")}, headers=A).json()["detail"]["code"] == "tb_bad_file"

    pdf = book_pdf()
    r = c.post("/admin/textbooks/upload", files={"file": ("용접 교재.pdf", pdf, "application/pdf")}, headers=A)
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    b = c.get(f"/admin/textbooks/{bid}", headers=A).json()
    assert b["status"] == "ready" and b["pages"] == 8 and b["processed"] == 8, b
    assert b["title"] == "용접 교재" and b["toc_pages"] == "3" and b["page_offset"] == 0, b
    assert len(db.TABLES["textbook_pages"]) == 8 and all(f"photos/textbook/{bid}/" in k for k in db.FILES)
    assert "Chapter 1" in db.TABLES["textbook_pages"][2]["text"]
    assert textbook._job["book_id"] is None and textbook._job_lock.acquire(blocking=False)
    textbook._job_lock.release()

    # 같은 PDF 로 이어서 나누기: 이미 있는 쪽은 건너뜀, 다른 PDF 는 거절
    db.TABLES["textbook_pages"] = db.TABLES["textbook_pages"][:5]
    r = c.post("/admin/textbooks/upload", data={"book_id": bid}, files={"file": ("x.pdf", pdf, "application/pdf")}, headers=A)
    assert r.status_code == 200 and len(db.TABLES["textbook_pages"]) == 8, r.text
    r = c.post("/admin/textbooks/upload", data={"book_id": bid}, files={"file": ("x.pdf", make_pdf([["a"]]), "application/pdf")}, headers=A)
    assert r.json()["detail"]["code"] == "tb_different_pdf"

    # 아직 지금 쓰는 교재가 아니면 교육생에게 안 보임
    assert c.get("/textbook", headers=S1).json() == {"book": None}
    toc = [{"title": "Part 1", "page": 4, "chapters": [{"title": "Chapter 1 Basics", "page": 4, "sections": [{"title": "1. Intro", "page": 4}]},
                                                       {"title": "Chapter 2 Gas", "page": 6, "sections": []}]}]
    r = c.put(f"/admin/textbooks/{bid}", json={"toc": toc, "is_current": True, "title": "임시 교재"}, headers=A)
    assert r.status_code == 200 and r.json()["is_current"] and r.json()["toc"][0]["chapters"][1]["page"] == 6, r.text
    assert c.put(f"/admin/textbooks/{bid}", json={"toc_pages": "20-30"}, headers=A).json()["detail"]["code"] == "tb_bad_pages"

    # AI 목차 (가짜)
    textbook.make_toc = lambda book_id, pl, off, pages: (_ for _ in ()).throw(textbook.TocError("ai_not_configured"))
    assert c.post(f"/admin/textbooks/{bid}/toc/ai", json={"pages": "3"}, headers=A).status_code == 503
    textbook.make_toc = lambda book_id, pl, off, pages: textbook.clean_toc(toc, pages, off) if pl == [3] else []
    assert c.post(f"/admin/textbooks/{bid}/toc/ai", json={"pages": "3"}, headers=A).json()["toc_pages"] == "3"
    assert c.post(f"/admin/textbooks/{bid}/toc/ai", json={"pages": "99"}, headers=A).status_code == 400

    # 교육생: 목차·쪽 보기·진도
    me = c.get("/textbook", headers=S1).json()
    assert me["book"]["title"] == "임시 교재" and me["can_view"] and me["last_page"] is None and me["done_count"] == 0, me
    ch = me["toc"][0]["chapters"]
    assert (ch[0]["pdf_page"], ch[0]["end_pdf_page"], ch[0]["total"]) == (4, 5, 2), ch
    pg = c.get(f"/textbook/pages?book_id={bid}&start=3&end=5", headers=S1).json()["items"]
    assert [p["page"] for p in pg] == [3, 4, 5] and pg[0]["url"].startswith("https://fake/photos/textbook/"), pg
    assert c.get(f"/textbook/pages?book_id={bid}&start=1&end=100", headers=S1).json()["items"][-1]["page"] == 8
    r = c.post("/textbook/progress", json={"book_id": bid, "done": [4, 4, 5, 99, 0], "last": 6}, headers=S1)
    assert r.json() == {"ok": True, "saved": 2}, r.text
    c.post("/textbook/progress", json={"book_id": bid, "done": [5, 6], "last": 7}, headers=S1)
    me = c.get("/textbook", headers=S1).json()
    assert me["done_count"] == 3 and me["last_page"] == 7, me
    assert me["toc"][0]["chapters"][0]["done"] == 2 and me["toc"][0]["chapters"][1]["done"] == 1
    assert c.get("/textbook", headers=T1).json()["done_count"] == 0  # 사람마다 따로
    assert me["done_pages"] == [4, 5, 6], me

    # 화질 올려 다시 나누기: 예전 화질 쪽만 새로 만들고, 교재는 계속 '준비됨', 진도·목차 그대로
    assert c.get(f"/admin/textbooks/{bid}", headers=A).json()["low_quality"] is False
    for r0 in db.TABLES["textbook_pages"]:
        r0["quality"] = 1
    assert c.get(f"/admin/textbooks/{bid}", headers=A).json()["low_quality"] is True
    old_key = c.get(f"/textbook/pages?book_id={bid}&start=3&end=3", headers=S1).json()["items"][0]["key"]
    seen = []
    real_patch = textbook.store.patch
    textbook.store.patch = lambda t, f, v: (seen.append(v.get("status")), real_patch(t, f, v))[1]
    r = c.post("/admin/textbooks/upload", data={"book_id": bid}, files={"file": ("x.pdf", pdf, "application/pdf")}, headers=A)
    textbook.store.patch = real_patch
    assert r.status_code == 200 and "processing" not in seen, (r.text, seen)
    b = c.get(f"/admin/textbooks/{bid}", headers=A).json()
    assert b["low_quality"] is False and b["status"] == "ready" and len(db.TABLES["textbook_pages"]) == 8, b
    new_key = c.get(f"/textbook/pages?book_id={bid}&start=3&end=3", headers=S1).json()["items"][0]["key"]
    assert old_key != new_key, (old_key, new_key)  # 휴대폰에 저장된 예전 그림을 다시 쓰지 않게
    me2 = c.get("/textbook", headers=S1).json()
    assert me2["done_count"] == 3 and me2["toc"] == me["toc"], me2

    # 교육생에게 쪽 숨기기: 교육생은 쪽 못 봄, 교사는 봄
    c.put(f"/admin/textbooks/{bid}", json={"show_students": False}, headers=A)
    assert c.get("/textbook", headers=S1).json()["can_view"] is False
    assert c.get(f"/textbook/pages?book_id={bid}&start=1&end=2", headers=S1).status_code == 403
    assert c.get(f"/textbook/pages?book_id={bid}&start=1&end=2", headers=T1).status_code == 200

    # 다른 교재를 지금 쓰는 교재로 바꾸면 하나만 남음, 삭제하면 파일·쪽도 지움
    r = c.post("/admin/textbooks/upload", files={"file": ("b.pdf", make_pdf([["a"], ["b"]]), "application/pdf")}, headers=A)
    b2 = r.json()["id"]
    c.put(f"/admin/textbooks/{b2}", json={"is_current": True}, headers=A)
    cur = [x["id"] for x in c.get("/admin/textbooks", headers=A).json()["items"] if x["is_current"]]
    assert cur == [b2], cur
    removed = []
    db_remove = textbook.store.remove_files
    textbook.store.remove_files = lambda bucket, paths: removed.extend(paths)
    assert c.delete(f"/admin/textbooks/{bid}", headers=A).json() == {"ok": True}
    textbook.store.remove_files = db_remove
    assert removed and all(f"textbook/{bid}/" in p for p in removed) and len(removed) == 8, removed
    assert [x["id"] for x in c.get("/admin/textbooks", headers=A).json()["items"]] == [b2]
    print("textbook_check OK")


if __name__ == "__main__":
    main()
