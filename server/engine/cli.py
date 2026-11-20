"""명령줄 실행: python -m engine.cli 사진.jpg [사진2.jpg ...] --out 결과폴더"""
import argparse
import json
import os

import cv2

from .analyze import analyze_image
from .config import Config


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--out", default="out")
    ap.add_argument("--marker-size", type=float, help="마커 한 변 실측 길이(mm)")
    ap.add_argument("--marker-dict")
    ap.add_argument("--marker-id", type=int)
    a = ap.parse_args()
    cfg = Config()
    if a.marker_size:
        cfg.marker_size_mm = a.marker_size
    if a.marker_dict:
        cfg.marker_dict = a.marker_dict
    if a.marker_id is not None:
        cfg.marker_id = a.marker_id
    os.makedirs(a.out, exist_ok=True)
    for path in a.images:
        name = os.path.splitext(os.path.basename(path))[0]
        res, vis, rect = analyze_image(path, cfg)
        with open(os.path.join(a.out, name + ".json"), "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=2)
        if vis is not None:
            cv2.imwrite(os.path.join(a.out, name + "_check.jpg"), vis, [cv2.IMWRITE_JPEG_QUALITY, 90])
        w = res.get("bead", {}).get("width", {})
        print(f"{name}: {res['status']}  폭 평균 {w.get('mean_mm')} mm  최소 {w.get('min_mm')}  최대 {w.get('max_mm')}")


if __name__ == "__main__":
    main()
