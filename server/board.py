"""T4(이론): 학습 보드 — 모든 사용자(교육생·교사·행정·관리자)가 보는 순위·통계.

- 문제 풀이 순위: 매일 문제(daily_answers) + 웰디 대화 중 문제(tutor_answers) (+ 나중에 게임)를 합친다.
  문제 하나 10점 만점 (OX·객관식은 맞으면 10점, 단답형·서술형은 채점 점수 0~10).
  같은 문제를 기간 안에 여러 번 풀면 처음 한 번만 센다 (반복으로 순위 올리기 방지). 채점 대기 답은 아직 안 셈.
  순위에는 교육생만, 실명. 정렬: 많이 푼 순(기본) / 점수 순 / 정답률 순(10문제 이상 푼 사람만).
- 많이 물어본 질문: 웰디 질문(tutor_messages, 설명·교재 밖, 저장된 답으로 대답한 것도 포함)을 AI 가 붙인 '주제'(topic)로 묶어 센다. 이름 없음.
  주제가 아직 없는 질문은 보드를 열 때 뒤에서 한 번에 40개씩 붙인다 (Claude Haiku, 비용 아주 적음).
- 많이 틀린 문제: 5명 이상 푼 문제 중 틀린 비율 순. 가장 많이 고른 오답. 이름 없음.
- 장별 정답률, 🔥 매일 문제 연속 일수, 내 위치(순위·정답률·약한 장).
- 지금 쓰는 교재만. 과정(course=all|과정 id)·기간(day/week/month/all, 한국 시간) 선택.
"""
import threading
import time
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

import accounts
import daily
import media
import social
import store
import textbook

router = APIRouter()
PAGE = 1000               # Supabase 한 번에 주는 최대 행 수
MIN_RATE_SOLVED = 10      # 정답률 순위에 들어가는 최소 문제 수
MIN_WRONG_USERS = 5       # 많이 틀린 문제에 들어가는 최소 인원
MIN_WEAK = 3              # 약한 장으로 보는 최소 풀이 수
TOP_ROWS = 100
TOP_TOPICS = 20
TOP_WRONG = 20
CACHE_SEC = 60
STREAK_DAYS = 60
TOPIC_KINDS = ("explain", "outside")
TAG_BATCH = 40
TAG_ROUNDS = 5
SORTS = ("solved", "score", "rate")
MIN_GROWTH = 5            # 성장왕: 두 주 모두 이만큼 이상 푼 사람
TOP_GROWTH = 3
STAFF_ROLES = ("teacher", "staff", "admin")

_cache_lock = threading.Lock()
_cache = {}               # (book_id, period) → (시각, 모은 자료)
_tag_lock = threading.Lock()


def _err(status, code):
    raise HTTPException(status, {"code": code})


def select_all(table, params, cap=100000):
    """1000행씩 나눠 끝까지 읽는다."""
    out, off = [], 0
    while True:
        rows = store.select(table, {**params, "limit": str(PAGE), "offset": str(off)})
        out += rows
        if len(rows) < PAGE or len(out) >= cap:
            return out
        off += PAGE


def clear_cache():
    with _cache_lock:
        _cache.clear()


# ---- 자료 모으기 (교재·기간마다 1분 동안 같이 씀) ----

def _gather(book, period):
    key = (book["id"], period)
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_SEC:
            return hit[1]
    start = _start(period)
    since = {"created_at": f"gte.{start}"} if start else {}
    bid = f"eq.{book['id']}"
    attempts = []
    for r in select_all("daily_answers", {"book_id": bid, **since,
                                          "select": "user_id,question_id,kind,answer,score,correct,created_at"}):
        if r.get("score") is None:  # 채점 대기
            continue
        attempts.append({"user_id": r["user_id"], "qid": r["question_id"], "src": "daily", "kind": r.get("kind"),
                         "answer": r.get("answer"), "score": int(r["score"]),
                         "correct": int(r["score"]) >= daily.PASS_SCORE, "at": r.get("created_at") or ""})
    try:
        for r in select_all("tutor_answers", {"book_id": bid, **since,
                                              "select": "user_id,question_id,kind,answer,correct,created_at"}):
            if r.get("correct") is None:  # 채점 대기 (대화 중 단답형)
                continue
            ok = bool(r["correct"])
            attempts.append({"user_id": r["user_id"], "qid": r["question_id"], "src": "tutor", "kind": r.get("kind"),
                             "answer": None if r.get("answer") is None else str(r["answer"]),
                             "score": 10 if ok else 0, "correct": ok, "at": r.get("created_at") or ""})
    except Exception as e:  # noqa: BLE001  (step9 SQL 전)
        print("[board] 웰디 문제 기록 못 읽음", str(e)[:160], flush=True)
    try:  # T5 수업 중 돌발 OX (맞으면 10점)
        for r in select_all("live_ox_answers", {"book_id": bid, **since,
                                                "select": "user_id,question_id,answer,correct,created_at"}):
            if not r.get("question_id"):
                continue
            ok = bool(r.get("correct"))
            attempts.append({"user_id": r["user_id"], "qid": r["question_id"], "src": "live", "kind": "ox",
                             "answer": None if r.get("answer") is None else str(r["answer"]),
                             "score": 10 if ok else 0, "correct": ok, "at": r.get("created_at") or ""})
    except Exception as e:  # noqa: BLE001  (step13 SQL 전)
        print("[board] 돌발 OX 기록 못 읽음", str(e)[:160], flush=True)
    attempts.sort(key=lambda a: a["at"])
    # 🔥 연속 일수용: 최근 60일 매일 문제 푼 날 (교재 상관없이, daily.streak_of 와 같은 기준)
    day0 = (daily.today() - timedelta(days=STREAK_DAYS)).isoformat()
    days = {}
    for r in select_all("daily_answers", {"day": f"gte.{day0}", "select": "user_id,day"}):
        d = days.setdefault(r["user_id"], {})
        d[r["day"]] = d.get(r["day"], 0) + 1
    try:
        msgs = select_all("tutor_messages", {"book_id": bid, "kind": f"in.({','.join(TOPIC_KINDS)})",
                                             **since, "select": "id,user_id,lang,question,answer,pages,topic,created_at",
                                             "order": "created_at.desc"})
    except Exception as e:  # noqa: BLE001  (step12 SQL 전이면 topic 칸이 없다)
        print("[board] 웰디 질문 못 읽음", str(e)[:160], flush=True)
        msgs = []
    qids = sorted({a["qid"] for a in attempts})
    qinfo = {}
    for i in range(0, len(qids), 150):  # 주소가 너무 길어지지 않게 나눠서
        part = qids[i:i + 150]
        for q in store.select("quiz_questions", {"id": f"in.({','.join(part)})", "select": "id,unit_key,kind"}):
            qinfo[q["id"]] = q
    data = {"attempts": attempts, "days": days, "msgs": msgs, "qinfo": qinfo}
    with _cache_lock:
        _cache[key] = (time.time(), data)
    return data


def _start(period):
    """기간 시작 (한국 시간). '2weeks' = 지난주 월요일부터 (성장왕 비교용)."""
    if period in ("2weeks", "3weeks"):
        n = 7 if period == "2weeks" else 14
        return (datetime.fromisoformat(social.period_start("week")) - timedelta(days=n)).isoformat()
    return social.period_start(period)


def _when(at):
    try:
        return datetime.fromisoformat(str(at).replace("Z", "+00:00"))
    except ValueError:
        return None


def growth(attempts, who, students):
    """이번 주 성장왕: 이번 주 정답률 − 지난주 정답률. 두 주 모두 MIN_GROWTH 문제 이상 푼 교육생, 오른 사람만."""
    this_start = datetime.fromisoformat(social.period_start("week"))
    weeks = {"this": [], "last": []}
    for a in attempts:
        w = _when(a["at"])
        if w is not None:
            weeks["this" if w >= this_start else "last"].append(a)
    rate = {}
    for k, rows in weeks.items():
        st = {}
        for a in first_attempts(rows, who):
            x = st.setdefault(a["user_id"], [0, 0])
            x[0] += 1
            x[1] += 1 if a["correct"] else 0
        rate[k] = {u: (n, round(c * 100 / n)) for u, (n, c) in st.items() if n >= MIN_GROWTH}
    out = []
    for u, (n, r) in rate["this"].items():
        if u in rate["last"] and r > rate["last"][u][1]:
            out.append({"user_id": u, "name": students[u]["name"], "last_rate": rate["last"][u][1], "this_rate": r,
                        "delta": r - rate["last"][u][1], "solved": n})
    out.sort(key=lambda x: (-x["delta"], -x["solved"], x["name"]))
    return out[:TOP_GROWTH]


def course_battle(firsts_all, students):
    """과정 대항전: 과정마다 교육생 수·참여율·1인 평균 푼 수·평균 정답률·1인 평균 점수."""
    courses = store.select("courses", {"active": "is.true", "select": "id,name,sort", "order": "sort.asc"})
    links = select_all("user_courses", {"select": "user_id,course_id"})
    members = {}
    for r in links:
        if r["user_id"] in students:
            members.setdefault(r["course_id"], set()).add(r["user_id"])
    per = {}
    for a in firsts_all:
        x = per.setdefault(a["user_id"], [0, 0, 0])
        x[0] += 1
        x[1] += 1 if a["correct"] else 0
        x[2] += a["score"]
    out = []
    for c in courses:
        m = members.get(c["id"], set())
        if not m:
            continue
        solved = sum(per.get(u, [0])[0] for u in m)
        correct = sum(per.get(u, [0, 0])[1] for u in m)
        score = sum(per.get(u, [0, 0, 0])[2] for u in m)
        active = sum(1 for u in m if u in per)
        out.append({"course_id": c["id"], "name": c["name"], "students": len(m), "active": active,
                    "participation": round(active * 100 / len(m)), "avg_solved": round(solved / len(m), 1),
                    "avg_rate": round(correct * 100 / solved) if solved else 0, "avg_score": round(score / len(m), 1)})
    return out


def staff_view(firsts_all, who, students, days, qinfo, units, course, period="week"):
    """교사·관리자 전용: 기간 안 안 푼 학생, 반별 약한 장, 최근 신고, 돌발 OX 놓친 학생."""
    solved = {a["user_id"] for a in firsts_all}
    idle = []
    for u in sorted(who - solved, key=lambda u: students[u]["name"]):
        d = sorted((days.get(u) or {}).keys())
        idle.append({"user_id": u, "name": students[u]["name"], "last_day": d[-1] if d else None})
    courses = store.select("courses", {"active": "is.true", "select": "id,name,sort", "order": "sort.asc"})
    if course != "all":
        courses = [c for c in courses if c["id"] == course]
    links = select_all("user_courses", {"select": "user_id,course_id"})
    weak = []
    for c in courses:
        m = {r["user_id"] for r in links if r["course_id"] == c["id"] and r["user_id"] in students}
        st = [u for u in unit_stats([a for a in firsts_all if a["user_id"] in m], qinfo, units) if u["attempts"] >= MIN_WEAK]
        st.sort(key=lambda u: (u["rate"], -u["attempts"]))
        if st:
            weak.append({"course_id": c["id"], "name": c["name"], "units": st[:2]})
    try:
        tutor_reports = store.select("tutor_messages", {"reported": "is.true", "select": "id,question,answer,report_note,reported_at",
                                                        "order": "reported_at.desc", "limit": "10"})
    except Exception:  # noqa: BLE001
        tutor_reports = []
    reps = store.select("question_reports", {"select": "question_id,reason,created_at", "order": "created_at.desc", "limit": "10"})
    qtext = {}
    if reps:
        ids = sorted({r["question_id"] for r in reps})
        qtext = {q["id"]: q for q in store.select("quiz_questions", {"id": f"in.({','.join(ids)})", "select": "id,question,book_id"})}
    question_reports = [{"question_id": r["question_id"], "question": (qtext.get(r["question_id"]) or {}).get("question") or "",
                         "book_id": (qtext.get(r["question_id"]) or {}).get("book_id"), "reason": r.get("reason") or "",
                         "created_at": r.get("created_at")} for r in reps]
    import live
    missed = live.missed_counts([c["id"] for c in courses], _start(period))
    live_missed = sorted(({"user_id": u, "name": students[u]["name"], "missed": m, "total": n}
                          for u, (m, n) in missed.items() if m and u in who and u in students),
                         key=lambda x: (-x["missed"], x["name"]))
    return {"idle": idle, "weak": weak, "tutor_reports": tutor_reports, "question_reports": question_reports,
            "live_missed": live_missed[:30]}


def _students():
    return {u["id"]: u for u in select_all("users", {"role": "eq.student", "status": "eq.active",
                                                      "select": "id,name,avatar_path"})}


def _scope(course):
    """과정 사람 id 모음 (all 이면 None = 모두)."""
    if course == "all":
        return None
    try:
        cid = str(uuid.UUID(course))
    except ValueError:
        _err(404, "not_found")
    return {r["user_id"] for r in store.select("user_courses", {"course_id": f"eq.{cid}", "select": "user_id"})}


def first_attempts(attempts, who):
    """사람·문제마다 처음 푼 것만 (attempts 는 시간 순)."""
    seen = set()
    out = []
    for a in attempts:
        if a["user_id"] not in who:
            continue
        k = (a["user_id"], a["qid"])
        if k in seen:
            continue
        seen.add(k)
        out.append(a)
    return out


def streak(days_of_user, need, today):
    full = {d for d, n in (days_of_user or {}).items() if n >= need}
    n, d = 0, today
    if d.isoformat() not in full:
        d -= timedelta(days=1)
    while d.isoformat() in full:
        n += 1
        d -= timedelta(days=1)
    return n


def rank_rows(stats, sort):
    """정렬 → 순위가 붙은 목록. 정답률 순은 MIN_RATE_SOLVED 문제 이상 푼 사람만."""
    rows = list(stats.values())
    if sort == "rate":
        rows = [r for r in rows if r["solved"] >= MIN_RATE_SOLVED]
        key = lambda r: (-r["rate"], -r["solved"], -r["score"], r["name"])
    elif sort == "score":
        key = lambda r: (-r["score"], -r["solved"], r["name"])
    else:
        key = lambda r: (-r["solved"], -r["score"], r["name"])
    rows.sort(key=key)
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return rows


def unit_stats(firsts, qinfo, units):
    by = {}
    for a in firsts:
        q = qinfo.get(a["qid"])
        if not q:
            continue
        u = by.setdefault(q["unit_key"], [0, 0])
        u[0] += 1
        u[1] += 1 if a["correct"] else 0
    return [{"unit_key": k, "title": title, "attempts": by[k][0], "correct": by[k][1],
             "rate": round(by[k][1] * 100 / by[k][0])} for k, title, _, _ in units if k in by]


def wrong_stats(firsts, qinfo):
    """문제마다 [푼 사람, 틀린 사람, {오답 보기: 수}] → 많이 틀린 순."""
    by = {}
    for a in firsts:
        if a["qid"] not in qinfo:  # 지워진 문제
            continue
        s = by.setdefault(a["qid"], {"attempts": 0, "wrong": 0, "picks": {}})
        s["attempts"] += 1
        if not a["correct"]:
            s["wrong"] += 1
            if a["kind"] in daily.CHOICE_KINDS and a["answer"] not in (None, ""):
                s["picks"][a["answer"]] = s["picks"].get(a["answer"], 0) + 1
    out = []
    for qid, s in by.items():
        if s["attempts"] < MIN_WRONG_USERS or not s["wrong"]:
            continue
        top = max(s["picks"].items(), key=lambda kv: kv[1]) if s["picks"] else None
        out.append({"qid": qid, "attempts": s["attempts"], "wrong": s["wrong"],
                    "rate": round((s["attempts"] - s["wrong"]) * 100 / s["attempts"]),
                    "top_wrong": int(top[0]) if top and str(top[0]).isdigit() else None,
                    "top_wrong_n": top[1] if top else 0})
    out.sort(key=lambda x: (x["rate"], -x["attempts"]))
    return out[:TOP_WRONG]


def topic_stats(msgs, who, lang, offset):
    by = {}
    for m in msgs:  # 최근 → 오래된
        t = (m.get("topic") or "").strip()
        if not t or m.get("user_id") not in who:
            continue
        s = by.setdefault(t, {"topic": t, "count": 0, "users": set(), "sample": None})
        s["count"] += 1
        s["users"].add(m["user_id"])
        if not (m.get("answer") or "").startswith("error") and (
                s["sample"] is None or (m.get("lang") == lang and s["sample"].get("lang") != lang)):
            s["sample"] = m
    out = []
    for s in sorted(by.values(), key=lambda s: (-len(s["users"]), -s["count"], s["topic"]))[:TOP_TOPICS]:
        m = s["sample"] or {}
        out.append({"topic": s["topic"], "count": s["count"], "users": len(s["users"]),
                    "question": m.get("question") or "", "answer": m.get("answer") or "",
                    "pages": [{"page": p, "printed": p - offset} for p in (m.get("pages") or [])]})
    return out


# ---- 질문 주제 붙이기 (뒤에서) ----

TOPIC_SYSTEM = """You group welding trainees' questions to a study assistant by topic, for a "most asked questions" board.
For each numbered question (any language), write a short KOREAN topic label of 2 to 6 words naming the concept asked,
for example: 언더컷 원인, GTAW 보호 가스 종류, 예열 온도.
Questions asking the same thing in different words or languages must get exactly the same label.
Reuse a label from EXISTING LABELS whenever it fits. No quotes, no numbers, no punctuation at the end.
Reply with ONLY: {"topics":["label for 1","label for 2", ...]} with exactly one label per question, in order."""


def untagged(book_id, limit):
    try:
        return store.select("tutor_messages", {"book_id": f"eq.{book_id}", "kind": f"in.({','.join(TOPIC_KINDS)})",
                                               "topic": "is.null", "select": "id,question",
                                               "order": "created_at.desc", "limit": str(limit)})
    except Exception:  # noqa: BLE001  (step12 SQL 전)
        return []


def tag_topics(book_id):
    """주제가 없는 웰디 질문에 주제를 붙인다. 한 번에 하나만 돈다."""
    import report
    if not report.configured() or not _tag_lock.acquire(blocking=False):
        return
    try:
        for _ in range(TAG_ROUNDS):
            rows = untagged(book_id, TAG_BATCH)
            if not rows:
                break
            known = {}
            for m in store.select("tutor_messages", {"book_id": f"eq.{book_id}", "topic": "not.is.null",
                                                     "select": "topic", "order": "created_at.desc", "limit": "1000"}):
                known[m["topic"]] = known.get(m["topic"], 0) + 1
            labels = [t for t, _ in sorted(known.items(), key=lambda kv: -kv[1])[:80]]
            text = ("EXISTING LABELS:\n" + ("\n".join(labels) or "(none)") + "\n\nQUESTIONS:\n"
                    + "\n".join(f"{i + 1}. {(r['question'] or '')[:200]}" for i, r in enumerate(rows)))
            try:
                out = daily._ask(report.model_name(), TOPIC_SYSTEM, text, 1500, timeout=60)
            except Exception as e:  # noqa: BLE001
                print("[board] 주제 붙이기 실패", str(e)[:160], flush=True)
                break
            topics = out.get("topics") if isinstance(out.get("topics"), list) else []
            if len(topics) != len(rows):
                print("[board] 주제 수가 안 맞음", len(topics), len(rows), flush=True)
                break
            for r, t in zip(rows, topics):
                t = str(t or "").strip().strip("\"'.。")[:40] or "기타"
                store.patch("tutor_messages", {"id": f"eq.{r['id']}"}, {"topic": t})
        clear_cache()
    finally:
        _tag_lock.release()


# ---- API ----

@router.get("/study-board")
def study_board(bg: BackgroundTasks, course: str = "all", period: str = "week", sort: str = "solved",
                lang: str = "ko", user=Depends(accounts.current_user)):
    if period not in social.PERIODS:
        _err(400, "bad_period")
    if sort not in SORTS:
        _err(400, "bad_sort")
    lang = daily._lang(lang)
    book = textbook.current_book()
    base = {"book": None, "period": period, "course": course, "sort": sort, "rows": [], "me": None, "total": 0,
            "topics": [], "tagging": 0, "wrong": [], "units": [], "min_rate_solved": MIN_RATE_SOLVED,
            "min_wrong_users": MIN_WRONG_USERS, "growth": [], "min_growth": MIN_GROWTH, "courses": [], "staff": None}
    if not book:
        return base
    if not textbook.can_view(user, book):  # 교육생에게 숨긴 교재
        return {**base, "book": {"id": book["id"], "title": book.get("title") or ""}, "hidden": True}
    offset = book.get("page_offset") or 0
    students = _students()
    members = _scope(course)
    who = set(students) if members is None else set(students) & members
    data = _gather(book, period)
    firsts_all = first_attempts(data["attempts"], set(students))
    firsts = [a for a in firsts_all if a["user_id"] in who]

    # 이번 주 성장왕 (기간 선택과 상관없이 이번 주 vs 지난주, 과정 선택은 따름)
    two = _gather(book, "2weeks")
    grow = growth(two["attempts"], who, students)
    if grow:
        av = media.avatars_of([students[g["user_id"]] for g in grow])
        grow = [{**g, **(av.get(g["user_id"]) or {})} for g in grow]

    # 문제 풀이 순위
    today = daily.today()
    need = daily.daily_total()
    stats = {}
    for a in firsts:
        u = students[a["user_id"]]
        s = stats.setdefault(a["user_id"], {"user_id": a["user_id"], "name": u["name"], "solved": 0, "correct": 0,
                                            "score": 0, "daily": 0, "tutor": 0, "live": 0})
        s["solved"] += 1
        s["correct"] += 1 if a["correct"] else 0
        s["score"] += a["score"]
        s[a["src"]] += 1
    for s in stats.values():
        s["rate"] = round(s["correct"] * 100 / s["solved"])
        s["streak"] = streak(data["days"].get(s["user_id"]), need, today)
    ordered = rank_rows(stats, sort)
    top = ordered[:TOP_ROWS]
    me = stats.get(user["id"])
    shown = top + ([me] if me and me not in top else [])
    courses = social._courses_of([x["user_id"] for x in shown])
    avatars = media.avatars_of([students[x["user_id"]] for x in shown])
    rows = [{**x, **(avatars.get(x["user_id"]) or {}), "rank": x.get("rank"),
             "courses": courses.get(x["user_id"], [])}
            for x in shown]

    # 장별 정답률·내 약한 장
    units = daily.book_units(book)
    all_units = unit_stats(firsts, data["qinfo"], units)
    if me is not None:
        mine = unit_stats([a for a in firsts if a["user_id"] == user["id"]], data["qinfo"], units)
        weak = sorted([u for u in mine if u["attempts"] >= MIN_WEAK and u["rate"] < 100], key=lambda u: (u["rate"], -u["attempts"]))
        me_row = next(r for r in rows if r["user_id"] == user["id"])
        me_row["weak_unit"] = weak[0] if weak else None
        if me_row["rank"] is None:
            me_row["rank_note"] = "need_more"  # 정답률 순인데 아직 문제 수가 모자람
    elif user["role"] == "student" and user["id"] in who:
        st = streak(data["days"].get(user["id"]), need, today)
        rows.append({"user_id": user["id"], "name": user.get("name") or "", "solved": 0, "correct": 0, "score": 0,
                     "daily": 0, "tutor": 0, "live": 0, "rate": 0, "streak": st, "rank": None, "courses": [], "weak_unit": None})

    # 많이 틀린 문제
    wrong = wrong_stats(firsts, data["qinfo"])
    if wrong:
        qs = daily._questions([w["qid"] for w in wrong])
        daily.ensure_translations([qs[w["qid"]] for w in wrong if w["qid"] in qs], lang)
        shown_wrong = []
        for w in wrong:
            q = qs.get(w["qid"])
            if not q:
                continue
            item = daily._public(q, {"answer": None, "correct": None, "score": None, "graded_by": "board"}, lang, offset)
            item["result"] = None  # 답·해설은 '풀어 보기' 뒤에만 앱이 보여 준다
            item["reveal"] = {"correct_choice": q.get("answer") if q["kind"] in daily.CHOICE_KINDS else None,
                              "model_answer": q.get("model_answer") or "", "explanation": q.get("explanation") or "",
                              "tr": ({"model_answer": (q.get("translations") or {}).get(lang, {}).get("model_answer") or "",
                                      "explanation": (q.get("translations") or {}).get(lang, {}).get("explanation") or ""}
                                     if lang != "ko" and (q.get("translations") or {}).get(lang) else None)}
            shown_wrong.append({**w, "item": item})
        wrong = shown_wrong

    # 많이 물어본 질문 (주제 없는 질문은 뒤에서 붙인다)
    topics = topic_stats(data["msgs"], who, lang, offset)
    waiting = len([m for m in data["msgs"] if not m.get("topic")])
    if waiting:
        bg.add_task(tag_topics, book["id"])

    me_out = next((r for r in rows if r["user_id"] == user["id"]), None)
    staff = None
    if user["role"] in STAFF_ROLES:
        staff = staff_view(firsts_all, who, students, data["days"], data["qinfo"], units,
                           "all" if members is None else str(uuid.UUID(course)), period)
    return {**base, "book": {"id": book["id"], "title": book.get("title") or ""},
            "rows": rows[:len(top)],
            "me": me_out, "total": len(ordered), "topics": topics, "tagging": waiting,
            "wrong": wrong, "units": all_units, "growth": grow, "min_growth": MIN_GROWTH,
            "courses": course_battle(firsts_all, students), "staff": staff}


@router.get("/study-board/user/{uid}")
def user_units(uid: str, period: str = "week", user=Depends(accounts.current_user)):
    """순위에서 사람을 누르면: 그 사람의 장별 정답률 (같은 기간)."""
    if period not in social.PERIODS:
        _err(400, "bad_period")
    try:
        uid = str(uuid.UUID(uid))
    except ValueError:
        _err(404, "not_found")
    book = textbook.current_book()
    if not book or not textbook.can_view(user, book):
        return {"units": []}
    data = _gather(book, period)
    firsts = first_attempts(data["attempts"], {uid})
    return {"units": unit_stats(firsts, data["qinfo"], daily.book_units(book))}


# ---- 월요일 인사말: 지난주 결산 ----

RECAP_COURSES = 3


def last_week_recap(book, user):
    """지난주(월~일, 한국 시간) 결산. 교육생: 내 기록, 교사·관리자: 맡은 반. 모두: 지난주 가장 많이 푼 교육생."""
    students = _students()
    data = _gather(book, "3weeks")
    this_start = datetime.fromisoformat(social.period_start("week"))
    last_start = this_start - timedelta(days=7)
    weeks = {"last": [], "prev": []}
    for a in data["attempts"]:
        w = _when(a["at"])
        if w is None or w >= this_start:
            continue
        weeks["last" if w >= last_start else "prev"].append(a)
    firsts = first_attempts(weeks["last"], set(students))
    per = {}
    for a in firsts:
        x = per.setdefault(a["user_id"], {"solved": 0, "correct": 0, "score": 0, "live": 0})
        x["solved"] += 1
        x["correct"] += 1 if a["correct"] else 0
        x["score"] += a["score"]
        x["live"] += 1 if a["src"] == "live" else 0
    ordered = sorted(per.items(), key=lambda kv: (-kv[1]["solved"], -kv[1]["score"], students[kv[0]]["name"]))
    out = {"monday": daily.today().weekday() == 0, "start": last_start.date().isoformat(),
           "end": (this_start - timedelta(days=1)).date().isoformat(), "me": None, "courses": [],
           "top": ({"name": students[ordered[0][0]]["name"], "solved": ordered[0][1]["solved"]} if ordered else None)}
    if user["role"] == "student":
        mine = per.get(user["id"])
        prev = first_attempts(weeks["prev"], {user["id"]})
        me = {"solved": 0, "rate": 0, "score": 0, "live": 0, "rank": None, "ranked": len(ordered),
              "prev_solved": len(prev), "prev_rate": round(sum(1 for a in prev if a["correct"]) * 100 / len(prev)) if prev else None,
              "weak_unit": None}
        if mine:
            me.update({"solved": mine["solved"], "rate": round(mine["correct"] * 100 / mine["solved"]),
                       "score": mine["score"], "live": mine["live"],
                       "rank": next(i + 1 for i, (u, _) in enumerate(ordered) if u == user["id"])})
            st = unit_stats([a for a in firsts if a["user_id"] == user["id"]], data["qinfo"], daily.book_units(book))
            weak = sorted([u for u in st if u["attempts"] >= MIN_WEAK and u["rate"] < 100], key=lambda u: (u["rate"], -u["attempts"]))
            me["weak_unit"] = weak[0]["title"] if weak else None
        out["me"] = me
    elif user["role"] in STAFF_ROLES:
        if user["role"] == "teacher":
            cs = accounts._courses_of(user["id"])
        else:
            cs = store.select("courses", {"active": "is.true", "select": "id,name,sort", "order": "sort.asc"})
        battle = {c["course_id"]: c for c in course_battle(firsts, students)}
        out["courses"] = [battle[c["id"]] for c in cs if c["id"] in battle][:RECAP_COURSES]
    return out


@router.get("/study-board/last-week")
def last_week(user=Depends(accounts.current_user)):
    book = textbook.current_book()
    if not book or not textbook.can_view(user, book):
        return {"monday": daily.today().weekday() == 0, "me": None, "courses": [], "top": None}
    return last_week_recap(book, user)
