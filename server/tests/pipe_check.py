"""6-5 배관 측정 시험 (가짜 비드 모양). 실행: python -m tests.pipe_check"""
import math

import numpy as np

from engine import measure
from engine.config import Config


def bead(length=200.0, width=8.0, bend=0.0004):
    """가로로 누운 비드: 중심선이 y = bend·(x−100)² 로 휨 (배관을 비스듬히 찍은 모양)."""
    xs = np.arange(0, length + 0.5, 0.5)
    cy = bend * (xs - length / 2) ** 2
    top = np.stack([xs, cy - width / 2], 1)
    bot = np.stack([xs[::-1], cy[::-1] + width / 2], 1)
    return np.vstack([top, bot])


def main():
    cfg = Config()
    poly = bead()
    marker = np.array([100.0, 25.0])  # 비드 가운데 옆 (배관 꼭대기)
    # 평판 방식: 휘어 보이는 만큼 직진도가 나빠 보임
    plate, g = measure.measure_bead(poly, marker, cfg)
    assert plate["straightness"]["baseline"] == "line" and plate["straightness"]["max_dev_mm"] > 1.0, plate["straightness"]
    assert "pipe" not in plate and plate["width"]["zone_start_mm"] == 10.0
    # 배관 방식 (외경 114.3): 곡선 기준선이라 이탈 거의 0, 검사 구간 = 꼭대기 ±R·sin45
    pipe, g = measure.measure_bead(poly, marker, cfg, 114.3)
    R = 114.3 / 2
    st = pipe["straightness"]
    assert st["baseline"] == "curve" and st["max_dev_mm"] < 0.1, st
    z0, z1 = pipe["width"]["zone_start_mm"], pipe["width"]["zone_end_mm"]
    assert abs((z1 - z0) - 2 * R * math.sin(math.radians(45))) < 1.5, (z0, z1)
    assert abs(pipe["pipe"]["top_pos_mm"] - 100) < 1.0 and abs(pipe["pipe"]["zone_arc_mm"] - R * math.pi / 2) < 1.5, pipe["pipe"]
    assert abs(pipe["width"]["mean_mm"] - 8.0) < 0.2
    assert 0 <= pipe["width"]["min_pos_arc_mm"] <= pipe["pipe"]["zone_arc_mm"] + 0.1
    # 결함: 검사 구간 밖은 끝 구간으로, 안은 원둘레 위치
    pred = {"class": "Porosity", "confidence": 0.8, "polygon": None}
    sq = lambda x: np.array([[x - 1, -1], [x + 1, -1], [x + 1, 1], [x - 1, 1]], float)
    inside = measure.measure_defect(pred, sq(100), g, cfg)
    outside = measure.measure_defect(pred, sq(30), g, cfg)
    assert not inside["in_end_zone"] and outside["in_end_zone"], (inside, outside)
    assert abs(inside["pos_arc_mm"] - pipe["pipe"]["zone_arc_mm"] / 2) < 1.5, inside
    # 비드가 짧아 구간이 없으면 전체를 본다
    short, _ = measure.measure_bead(bead(length=30), np.array([15.0, 25.0]), cfg, 60.5)
    assert short["width"]["samples"] >= 3
    print("pipe_check OK")


if __name__ == "__main__":
    main()
