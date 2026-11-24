"""윤곽 2차 검토(Claude 비전) 시험: 검토용 그림 폴더를 AI에 보내 판단을 표로 만든다.
사용 (server 폴더에서, ANTHROPIC_API_KEY 필요):
  python tools/outline_review_eval.py 그림폴더 [--out 결과.csv]
그림은 엔진의 extras["review_img"] 와 같은 것 (초록 선 = 측정에 쓴 비드 가장자리)."""
import argparse
import csv
import glob
import os
import sys

import cv2

sys.path.insert(0, os.getcwd())
import outline_review  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--out", default="outline_review_eval.csv")
    a = ap.parse_args()
    rows = []
    for f in sorted(glob.glob(os.path.join(a.folder, "*.jpg"))):
        r = outline_review.review(cv2.imread(f))
        rows.append({"image": os.path.basename(f), **r})
        print(rows[-1])
    with open(a.out, "w", newline="", encoding="utf-8-sig") as fp:
        w = csv.DictWriter(fp, fieldnames=["image", "status", "reason", "where", "model", "error"], extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    n = sum(r["status"] == "check" for r in rows)
    print(f"{len(rows)}장 중 윤곽 확인 필요 {n}장 → {a.out}")


if __name__ == "__main__":
    main()
