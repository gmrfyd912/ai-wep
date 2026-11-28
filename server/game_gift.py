"""G3 자재 지원 (박사 승인 2026-11-28): 같은 반 친구끼리 하루 한 번 자재를 보내 돕기. 채팅·게시판은 없음.

- 할 일 창의 '우리 반 자재 지원'에서 같은 과정(진행 중) 친구 목록을 본다 (본관 레벨, 오늘 필요한 자재).
- 하루 1번, 친구 1명에게 강판 또는 용접봉 gift_amount 개를 보낸다. 내 창고에서 빠지고, 보낸 사람은 기술 gift_tech.
  받는 친구 창고 자리가 모자라면 못 보냄. 한 사람이 하루에 받을 수 있는 횟수는 gift_recv_max (한 사람에게 몰아주기 방지).
- '자재가 필요해요': 하루 1번, 강판·용접봉 중 하나를 골라 누르면 그날 같은 반 친구들 목록에 표시된다 (글 쓰는 칸 없음).
- 장부 열쇠: 보낸 사람 gift:<날짜>, 받은 사람 gift_in:<날짜>:<보낸 사람>, 요청 need:<날짜> (두 번 받기 방지).
- 숫자는 모두 예시 (관리자 설정). 수료생·다른 반은 목록에 없음.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

import game
import store
from game import _err, need_player

router = APIRouter()
KINDS = ("steel", "rods")


def _live_courses(uid):
    cids = [r["course_id"] for r in store.select("user_courses", {"user_id": f"eq.{uid}", "select": "course_id"})]
    if not cids:
        return set()
    return {c["id"] for c in store.select("courses", {"id": f"in.({','.join(cids)})", "active": "eq.true", "select": "id"})}


def classmates(uid):
    """같은 진행 중 과정의 교육생 (나 빼고, 조선소가 있는 사람만) → [{id, name}]."""
    mine = _live_courses(uid)
    if not mine:
        return []
    links = store.select("user_courses", {"course_id": f"in.({','.join(mine)})", "select": "user_id"})
    ids = sorted({l["user_id"] for l in links} - {uid})
    if not ids:
        return []
    got = game._par(
        users=lambda: store.select("users", {"id": f"in.({','.join(ids)})", "role": "eq.student", "status": "eq.active",
                                             "select": "id,name"}),
        bases=lambda: store.select("game_bases", {"user_id": f"in.({','.join(ids)})", "select": "user_id"}),
    )
    has = {b["user_id"] for b in got["bases"]}
    return [u for u in got["users"] if u["id"] in has]


def _day():
    return game._kday()


def class_view(user):
    uid = user["id"]
    st = game.settings()
    day = _day()
    mates = classmates(uid)
    ids = [m["id"] for m in mates]
    hq, need = {}, {}
    if ids:
        got = game._par(
            hq=lambda: store.select("game_buildings", {"user_id": f"in.({','.join(ids)})", "type": "eq.hq", "select": "user_id,level"}),
            need=lambda: store.select("game_ledger", {"user_id": f"in.({','.join(ids)})", "key": f"eq.need:{day}",
                                                      "select": "user_id,note"}),
        )
        hq = {r["user_id"]: int(r["level"]) for r in got["hq"]}
        need = {r["user_id"]: (r.get("note") or "").split("|")[-1] for r in got["need"]}
    rows = game.ledger(uid)
    mine = {r["key"]: r for r in rows}
    sent = mine.get(f"gift:{day}")
    my_need = mine.get(f"need:{day}")
    got_in = [r for r in rows if str(r.get("key", "")).startswith(f"gift_in:{day}:")]
    members = [{"id": m["id"], "name": m.get("name") or "", "hq": hq.get(m["id"], 1), "need": need.get(m["id"]) or None}
               for m in mates]
    members.sort(key=lambda m: (m["need"] is None, m["name"]))
    return {"members": members, "amount": int(st["gift_amount"]), "tech": int(st["gift_tech"]),
            "sent": (sent.get("note") or "").split("|")[1] if sent else None,
            "need": (my_need.get("note") or "").split("|")[-1] if my_need else None,
            "got_today": [{"from": (r.get("note") or "").split("|")[1] if "|" in (r.get("note") or "") else "",
                           "steel": int(r.get("steel") or 0), "rods": int(r.get("rods") or 0)} for r in got_in],
            "on": bool(st["gift_on"])}


@router.get("/game/class")
def get_class(user=Depends(need_player)):
    return class_view(user)


class GiftBody(BaseModel):
    to: str
    kind: str


@router.post("/game/gift")
def send_gift(body: GiftBody, user=Depends(need_player)):
    import game_pvp as pv
    uid = user["id"]
    st = game.settings()
    if not st["gift_on"]:
        _err(400, "gift_off")
    if body.kind not in KINDS:
        _err(400, "bad_kind")
    if body.to == uid or body.to not in {m["id"] for m in classmates(uid)}:
        _err(400, "gift_not_mate")
    amt = int(st["gift_amount"])
    day = _day()
    la, lb = pv._pair_locks(uid, body.to)
    with la, lb:
        rows = game.ledger(uid)
        if any(r["key"] == f"gift:{day}" for r in rows):
            _err(400, "gift_sent")
        if game.balance(rows)[body.kind] < amt:
            _err(400, "gift_short", n=amt)
        trows = game.ledger(body.to)
        n_in = sum(1 for r in trows if str(r.get("key", "")).startswith(f"gift_in:{day}:"))
        mx = int(st["gift_recv_max"])
        if mx and n_in >= mx:
            _err(400, "gift_recv_max", n=mx)
        room = game.clip_storage({body.kind: amt}, game.balance(trows), game.caps(game._buildings(body.to)))
        if room.get(body.kind, 0) < amt:
            _err(400, "gift_full")
        game._add(uid, [{"key": f"gift:{day}", body.kind: -amt, "tech": int(st["gift_tech"]), "fame": int(st["gift_fame"]),
                         "note": f"gift|{body.to}|{body.kind}"}])
        game._add(body.to, [{"key": f"gift_in:{day}:{uid}", body.kind: amt, "note": f"gift_in|{user.get('name') or ''}|{body.kind}"}])
    return {"class": class_view(user), "state": game._fresh(user)}


class NeedBody(BaseModel):
    kind: str


@router.post("/game/need")
def ask_need(body: NeedBody, user=Depends(need_player)):
    if body.kind not in KINDS:
        _err(400, "bad_kind")
    if not game.settings()["gift_on"]:
        _err(400, "gift_off")
    day = _day()
    if any(r["key"] == f"need:{day}" for r in game.ledger(user["id"])):
        _err(400, "need_done")
    game._add(user["id"], [{"key": f"need:{day}", "note": f"need|{body.kind}"}])
    return {"class": class_view(user)}
