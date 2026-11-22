"""5단계: AI 종합리포트 (Claude Haiku 5.5).

AI에는 사진을 보내지 않고 측정 숫자만 보낸다. 점수·합격 판정은 scoring.py 가 이미 정했고,
AI는 그 결과를 교육생이 이해하기 쉬운 말로 설명만 한다.

환경 변수 (Render 설정 화면에만 넣는다. 저장소가 공개라 코드·채팅에는 절대 넣지 않는다):
  ANTHROPIC_API_KEY  Anthropic 콘솔에서 만든 키
  ANTHROPIC_MODEL    (선택) 다른 모델로 바꿀 때만. 기본 claude-haiku-5-5
"""
import json
import os

DEFAULT_MODEL = "claude-haiku-5-5"

LANGS = {
    "ko": "Korean (한국어)",
    "en": "English",
    "vi": "Vietnamese (Tiếng Việt)",
    "th": "Thai (ภาษาไทย)",
    "fil": "Filipino (Tagalog)",
    "uz": "Uzbek (O'zbekcha, Latin script)",
    "id": "Indonesian (Bahasa Indonesia)",
    "es": "Spanish (Español)",
}

SYSTEM = """You are an experienced welding instructor at a Korean vocational welding training institute.
Trainees photograph their practice bead next to a reference marker; a measuring program measures the bead from the photo.
You receive those measurements as JSON and write a short, encouraging, practical feedback report for the trainee.

Rules:
- Write every field entirely in {language}. Many trainees are foreign workers learning welding, so use short, plain sentences and everyday words. Translate defect names into {language} (porosity, undercut, overlap, spatter, crack).
- Use only the numbers in the JSON. Never invent measurements, causes you cannot connect to the data, or results for things that were not measured (bead height, penetration, back side, internal defects were NOT measured).
- Mention the actual numbers (mm) when you praise or point out something, so the trainee can see why.
- The score and the pass/fail verdict were already calculated by fixed rules (fail if a crack is found, or if the score is below pass_score). Do not change, recalculate or question them. The verdict is a preliminary AI judgment; the teacher makes the final decision.
- Width uniformity: smaller (max width − min width) is better. Straightness: smaller max deviation from the straight baseline is better. The first and last 10 mm of the bead are excluded from inspection.
- For causes, give the most likely technique causes (travel speed, electrode/torch angle, arc length, weaving, current, hand steadiness, preparation), worded as likely, not certain.
- Practice methods must be concrete drills the trainee can try in the next session.
- strengths: 2-3 items. improvements: 2-3 items, each with the number and the likely cause. practice: 2-3 items. Each item 1-2 sentences.
- work_type tells plate or pipe. For a pipe, mention pipe-specific technique (following the curve, changing torch/electrode angle around the pipe) where it fits the numbers.
- comparison: compare with the trainee's earlier records of the same work type (plate/pipe), process and position (oldest to newest). Say what improved or got worse with numbers. If there is no earlier record, say this is the first record and it will be the baseline.
- summary: one sentence overall comment.
- class_rule_judgment (only when present): a separate preliminary check against the institute's classification society rule set. If an item failed, mention it in improvements with the measured value and the limit (and the rule name). Do not change that verdict either, and do not mix it with the 100-point score. Items in its "teacher_check" list could not be judged from the photo: do not judge them; you may remind the trainee that the teacher checks them."""

SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "improvements": {"type": "array", "items": {"type": "string"}},
        "practice": {"type": "array", "items": {"type": "string"}},
        "comparison": {"type": "string"},
    },
    "required": ["summary", "strengths", "improvements", "practice", "comparison"],
    "additionalProperties": False,
}


class ReportError(Exception):
    def __init__(self, code, detail=""):
        super().__init__(f"{code}: {detail}")
        self.code = code


def configured():
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def model_name():
    return os.environ.get("ANTHROPIC_MODEL") or DEFAULT_MODEL


def _num(v, nd=2):
    return None if v is None else round(float(v), nd)


def build_input(row, score, history, class_judgment=None):
    """AI에 보낼 숫자 묶음. history = 같은 용접법·자세의 이전 기록(오래된 → 최근, 최대 10개, 이번 제외)."""
    res = row.get("result") or {}
    bead = res.get("bead") or {}
    w = bead.get("width") or {}
    st = bead.get("straightness") or {}
    hist = []
    for h in history:
        sc = h.get("_score") or {}
        hist.append({
            "date": (h.get("created_at") or "")[:10],
            "score": sc.get("score"),
            "verdict": sc.get("verdict"),
            "width_mean_mm": _num(h.get("width_mean_mm")),
            "width_range_mm": None if h.get("width_min_mm") is None or h.get("width_max_mm") is None
            else _num(float(h["width_max_mm"]) - float(h["width_min_mm"])),
            "straightness_max_dev_mm": _num(h.get("straight_max_dev_mm")),
            "defects": [x.get("type") if isinstance(x, dict) else x for x in (h.get("defect_types") or [])],
        })
    pipe = row.get("work_type") == "pipe"
    pz = bead.get("pipe") or {}
    out = {
        "work_type": "pipe (circumferential weld on a pipe)" if pipe else "plate",
        **({"pipe_outer_diameter_mm": _num(row.get("pipe_od_mm"), 1)} if pipe else {}),
        "process": row.get("process"),
        "position": row.get("position"),
        "material": row.get("material"),
        "bead_length_mm": _num(bead.get("length_mm"), 0),
        "inspected_zone": (f"pipe: only the middle of the photo, 45 degrees to each side of the pipe top "
                           f"(about {_num(pz.get('zone_arc_mm'), 0)} mm of circumference); straightness is measured "
                           f"against a curved baseline; positions are measured along the bead as seen in the photo")
        if pipe else "bead excluding first and last 10 mm",
        "width": {
            "mean_mm": _num(w.get("mean_mm")),
            "min_mm": _num(w.get("min_mm")),
            "min_at_mm_from_start": _num(w.get("min_pos_mm"), 0),
            "max_mm": _num(w.get("max_mm")),
            "max_at_mm_from_start": _num(w.get("max_pos_mm"), 0),
            "range_max_minus_min_mm": None if w.get("min_mm") is None or w.get("max_mm") is None
            else _num(float(w["max_mm"]) - float(w["min_mm"])),
            "std_dev_mm": _num(w.get("std_mm")),
        },
        "straightness": {
            "max_deviation_mm": _num(st.get("max_dev_mm")),
            "at_mm_from_start": _num(st.get("max_dev_pos_mm"), 0),
        },
        "defects": [
            {"type": d.get("type"), "length_mm": _num(d.get("length_mm"), 1),
             "at_mm_from_start": _num(d.get("pos_along_bead_mm"), 0)}
            for d in (res.get("defects") or []) if isinstance(d, dict)
        ],
        "score_and_verdict_fixed_by_rules": score,
        "earlier_records_same_process_position": hist,
    }
    if class_judgment:
        cj = class_judgment
        out["class_rule_judgment"] = {
            "rule_set": " ".join(x for x in (cj.get("society"), cj.get("name")) if x),
            "verdict_fixed_by_rules": cj.get("verdict"),
            "items": [{"item": i["key"], "check": i["check"], "ok": i["ok"], "measured": i["measured"],
                       "limit": i["limit"], "unit": i["unit"]} for i in cj.get("items") or []],
            "teacher_check": [m.get("name") or m.get("rule") for m in cj.get("manual") or []],
        }
    return out


def generate(data, lang):
    """Claude 호출 → (리포트 dict, 사용량 dict). 실패하면 ReportError."""
    if not configured():
        raise ReportError("ai_not_configured")
    import anthropic  # 키가 없을 때도 서버가 뜨도록 여기서 불러온다

    language = LANGS.get(lang, LANGS["en"])
    client = anthropic.Anthropic(timeout=90, max_retries=2)
    try:
        resp = client.messages.create(
            model=model_name(),
            max_tokens=6000,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
            system=SYSTEM.replace("{language}", language),
            messages=[{
                "role": "user",
                "content": "Measurements (JSON):\n" + json.dumps(data, ensure_ascii=False)
                + f"\n\nWrite the report in {language}.",
            }],
        )
    except anthropic.AuthenticationError as e:
        raise ReportError("ai_key_invalid", str(e)[:200])
    except anthropic.RateLimitError as e:
        raise ReportError("ai_busy", str(e)[:200])
    except anthropic.APIStatusError as e:
        raise ReportError("ai_failed", f"{e.status_code} {str(e)[:200]}")
    except anthropic.APIConnectionError as e:
        raise ReportError("ai_failed", f"connection {str(e)[:200]}")

    if resp.stop_reason == "refusal":
        raise ReportError("ai_failed", "refusal")
    if resp.stop_reason == "max_tokens":
        raise ReportError("ai_failed", "max_tokens")
    text = next((b.text for b in resp.content if b.type == "text"), None)
    try:
        out = json.loads(text or "")
    except json.JSONDecodeError:
        raise ReportError("ai_failed", "bad_json")
    usage = {"input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens}
    return out, usage
