"""윤곽 2차 검토 (Claude 비전, 기본 Haiku 5.5).

엔진이 측정에 쓴 비드 양쪽 가장자리(초록 선)를 그린 그림을 보내, 선이 비드 끝(토우)을 제대로
따라가는지 묻는다. AI는 판단과 이유만 돌려주고, 폭 값은 바꾸지 않는다. 실패하면 검토만 건너뛴다.

환경 변수: ANTHROPIC_API_KEY (리포트와 같은 키), OUTLINE_REVIEW_MODEL (선택, 기본 claude-haiku-5-5)
"""
import base64
import os

import cv2

DEFAULT_MODEL = "claude-haiku-5-5"
REASONS = ("cuts_into_bead", "includes_plate", "shadow", "glare", "spatter", "other")

SYSTEM = """You check the outline of a weld bead found by a measuring program.
The photo is a top view of one weld bead on a steel plate or pipe. The two green lines are the bead edges (toe lines) that the program used to measure the bead width.
A long bead may be cut in two halves shown one above the other. Darkened parts at the ends are excluded from inspection: ignore them.

Decide if the green lines follow the real edges of the bead well enough for width measurement.
- "ok": both lines follow the bead edges. Small steps or about 1 mm wobble are normal; do not flag them.
- "check": somewhere a line clearly leaves the bead edge for a visible stretch: it cuts into the bead (misses part of it), or it runs out onto the plate, shadow, spatter or a reflection.
Be strict only about clear, visible mistakes. If the image is too unclear to judge, answer "ok".
reason: the main cause when "check" (cuts_into_bead, includes_plate, shadow, glare, spatter, other); "none" when ok.
where: when "check", which part, as "start", "middle", "end" or "whole" (the start is the left end of the top half); "none" when ok."""

SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["ok", "check"]},
        "reason": {"type": "string", "enum": ["none", *REASONS]},
        "where": {"type": "string", "enum": ["none", "start", "middle", "end", "whole"]},
    },
    "required": ["verdict", "reason", "where"],
    "additionalProperties": False,
}


def configured():
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def model_name():
    return os.environ.get("OUTLINE_REVIEW_MODEL") or DEFAULT_MODEL


def review(img_bgr, timeout=30):
    """반환: {"status": "ok"|"check"|"failed", "reason", "where", "model"} (실패 원인은 "error")."""
    out = {"status": "failed", "reason": "none", "where": "none", "model": model_name()}
    if img_bgr is None:
        return out | {"error": "no_image"}
    if not configured():
        return out | {"error": "ai_not_configured"}
    import json

    import anthropic

    ok, buf = cv2.imencode(".jpg", img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        return out | {"error": "encode"}
    data = base64.standard_b64encode(buf.tobytes()).decode("ascii")
    client = anthropic.Anthropic(timeout=timeout, max_retries=1)
    try:
        resp = client.messages.create(
            model=model_name(),
            max_tokens=2000,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
            system=SYSTEM,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
                {"type": "text", "text": "Do the green lines follow the bead edges?"},
            ]}],
        )
    except anthropic.APIStatusError as e:
        return out | {"error": f"api_{e.status_code}"}
    except anthropic.APIConnectionError:
        return out | {"error": "connection"}
    if resp.stop_reason in ("refusal", "max_tokens"):
        return out | {"error": resp.stop_reason}
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        js = json.loads(text)
    except json.JSONDecodeError:
        return out | {"error": "bad_json"}
    v = js.get("verdict")
    if v not in ("ok", "check"):
        return out | {"error": "bad_json"}
    out.update(status=v, reason=js.get("reason") if v == "check" else "none",
               where=js.get("where") if v == "check" else "none")
    return out
