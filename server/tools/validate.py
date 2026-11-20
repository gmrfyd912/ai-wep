"""실측값(캘리퍼스)과 엔진 결과 비교 보고서.
사용: python tools/validate.py 사진폴더 실측.csv --out 결과폴더
실측.csv 형식 (첫 줄 머리글, 빈칸은 측정 안 함):
  file,start_10mm,middle,end_10mm,note
  IMG_0001.jpg,8.2,7.9,8.4,정면
시작 = 마커에 가까운 쪽 끝. 각 값은 끝에서 10mm 안쪽, 가운데 위치의 폭(mm)."""
import argparse
import csv
import json
import os
import sys

import cv2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.analyze import analyze_image  # noqa: E402
from engine.config import Config  # noqa: E402

KEYS = [("start_10mm", "at_start_10mm"), ("middle", "at_middle"), ("end_10mm", "at_end_10mm")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("csv")
    ap.add_argument("--out", default="validation")
    ap.add_argument("--tol", type=float, default=0.5)
    ap.add_argument("--marker-size", type=float)
    a = ap.parse_args()
    cfg = Config()
    if a.marker_size:
        cfg.marker_size_mm = a.marker_size
    os.makedirs(a.out, exist_ok=True)
    rows, errs = [], []
    with open(a.csv, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            path = os.path.join(a.folder, r["file"])
            res, vis, _ = analyze_image(path, cfg)
            name = os.path.splitext(r["file"])[0]
            json.dump(res, open(os.path.join(a.out, name + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            if vis is not None:
                cv2.imwrite(os.path.join(a.out, name + "_check.jpg"), vis)
            w = res.get("bead", {}).get("width", {})
            row = {"file": r["file"], "status": res["status"], "note": r.get("note", "")}
            for ck, ek in KEYS:
                true = r.get(ck, "").strip()
                est = w.get(ek)
                row[ck + "_true"] = true
                row[ck + "_est"] = est
                if true and est is not None:
                    e = est - float(true)
                    row[ck + "_err"] = round(e, 2)
                    errs.append(e)
            row["mean_mm"] = w.get("mean_mm")
            rows.append(row)
    keys = list(rows[0].keys()) if rows else []
    for r in rows:
        for k in r:
            if k not in keys:
                keys.append(k)
    with open(os.path.join(a.out, "comparison.csv"), "w", newline="", encoding="utf-8-sig") as f:
        wr = csv.DictWriter(f, fieldnames=keys)
        wr.writeheader()
        wr.writerows(rows)
    if errs:
        within = sum(abs(e) <= a.tol for e in errs)
        mae = sum(abs(e) for e in errs) / len(errs)
        print(f"비교 {len(errs)}곳: ±{a.tol}mm 이내 {within}곳 ({100 * within / len(errs):.0f}%), "
              f"평균 절대오차 {mae:.2f}mm, 최대 {max(abs(e) for e in errs):.2f}mm, 평균 치우침 {sum(errs) / len(errs):+.2f}mm")


if __name__ == "__main__":
    main()
