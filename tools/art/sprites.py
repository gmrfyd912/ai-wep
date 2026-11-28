"""조선소 지도 그림 뽑기.

쓰는 법 (Blender 파이썬 모듈이 깔린 파이썬으로):
    pip install bpy
    python tools/art/sprites.py            # 전부
    python tools/art/sprites.py hq dock    # 고른 것만
결과: assets/yard/<이름>.png 와 src/game/yardArt.json (그림 크기·기준점).
"""
import json, os, random, sys

sys.path.insert(0, os.path.dirname(__file__))
import artlib as A
from artlib import box, cyl, ball, wedge, hazard, worker

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "yard")
META = os.path.join(ROOT, "src", "game", "yardArt.json")


# ---------- 건물 (발자국: X 0..w, Y -h..0) ----------
def hq():
    """본관 3×3: 유리창 사무동 + 옥상 + 깃발"""
    cx, cy = 1.5, -1.5
    box(cx, cy, 0, 2.8, 2.8, 0.1, "conc2", 0.03)
    for f in range(2):
        z = 0.1 + f * 0.62
        box(cx, cy, z, 2.5, 2.5, 0.62, "navy" if f == 0 else "blue", 0.03)
        box(cx, cy - 1.26, z + 0.17, 2.2, 0.04, 0.32, "glass", 0.005)
        box(cx + 1.26, cy, z + 0.17, 0.04, 2.2, 0.32, "glass", 0.005)
        for k in range(-2, 3):
            box(cx + k * 0.45, cy - 1.29, z + 0.15, 0.05, 0.03, 0.36, "white", 0)
            box(cx + 1.29, cy + k * 0.45, z + 0.15, 0.03, 0.05, 0.36, "white", 0)
    box(cx, cy, 1.34, 2.7, 2.7, 0.1, "white", 0.03)
    box(cx - 0.5, cy + 0.5, 1.44, 0.9, 0.9, 0.35, "white", 0.03)
    box(cx + 0.6, cy - 0.5, 1.44, 0.55, 0.45, 0.2, "steel", 0.03)
    cyl(cx - 0.5, cy + 0.5, 1.79, 0.025, 0.75, "steel", 8)
    box(cx - 0.3, cy + 0.5, 2.3, 0.4, 0.02, 0.24, "orange", 0)
    # 현관 (앞 왼쪽 면)
    box(cx + 0.2, cy - 1.5, 0.52, 0.9, 0.5, 0.06, "orange", 0.02)
    box(cx + 0.2, cy - 1.28, 0.1, 0.6, 0.05, 0.42, "glass", 0)
    for dx in (-0.35, 0.35):
        cyl(cx + 0.2 + dx, cy - 1.7, 0.1, 0.03, 0.42, "white", 8)
    return 3, 3, 2.6


def shop(wall="orange", smoke=True):
    """공장 2×2: 톱니 지붕 + 큰 문 + 굴뚝"""
    cx, cy, L, D = 1.0, -1.0, 1.7, 1.7
    box(cx, cy, 0, L, D, 0.75, "white", 0.03)
    box(cx, cy, 0, L + 0.04, D + 0.04, 0.26, wall, 0.02)
    teeth = 3
    tw = L / teeth
    for i in range(teeth):
        x0 = cx - L / 2 + i * tw
        wedge(x0, x0 + tw, cy - D / 2, cy + D / 2, 0.75, 1.15, "roof")
        box(x0 + 0.02, cy, 0.82, 0.03, D - 0.3, 0.26, "glass", 0)
    # 큰 문 (앞 왼쪽 면) + 옆문 (앞 오른쪽 면)
    box(cx, cy - D / 2 - 0.02, 0, 0.9, 0.05, 0.58, "steel", 0.01)
    for s in range(4):
        box(cx, cy - D / 2 - 0.05, 0.08 + s * 0.13, 0.9, 0.02, 0.02, "dark", 0)
    box(cx + L / 2 + 0.02, cy + 0.3, 0, 0.05, 0.35, 0.5, wall, 0.01)
    # 굴뚝 (뒤쪽)
    kx, ky = cx - L / 2 + 0.3, cy + D / 2 - 0.3
    cyl(kx, ky, 0.75, 0.11, 1.0, "white", 16)
    cyl(kx, ky, 1.6, 0.12, 0.2, "red", 16)
    return 2, 2, 1.9


def welding():
    r = shop("orange")
    # 문 앞 용접 불빛
    ball(1.0, -2.0, 0.12, 0.05, "spark")
    worker(0.82, -2.02, 0, "navy")
    return r


def cutting():
    r = shop("blue")
    # 문 앞에 잘라 둔 철판
    for k in range(3):
        box(1.55, -1.98, k * 0.04, 0.4, 0.28, 0.03, "steel", 0.004)
    return r


def yard():
    """강판 야적장 2×2: 철판 더미 + 작은 문형 크레인"""
    random.seed(3)
    box(1.0, -1.0, 0, 1.84, 1.84, 0.05, "conc2", 0.02)
    hazard(1.0, -1.0, 1.7, 1.7)
    for (dx, dy, n) in ((-0.42, 0.42, 9), (0.42, 0.45, 5), (-0.42, -0.4, 4), (0.45, -0.42, 11)):
        for k in range(n):
            box(1.0 + dx + random.uniform(-.02, .02), -1.0 + dy, 0.05 + k * 0.045, 0.66, 0.6, 0.035, "steel", 0.005)
    # 작은 문형 크레인 (노랑)
    for sx in (0.14, 1.86):
        box(sx, -1.0, 0.05, 0.1, 0.12, 1.0, "yel", 0.02)
        box(sx, -1.0, 0, 0.2, 0.4, 0.08, "dark", 0.02)
    box(1.0, -1.0, 1.05, 1.9, 0.16, 0.14, "yel", 0.02)
    box(0.7, -1.0, 0.93, 0.22, 0.2, 0.12, "dark", 0.02)
    cyl(0.7, -1.0, 0.6, 0.012, 0.35, "dark", 6)
    return 2, 2, 1.25


def dock_base():
    """도크 바닥 2×5: 물이 찬 선대 + 벽 + 받침목 (바다 쪽 X=2 는 열림)"""
    w, h = 2, 5
    box(1.0, -2.5, 0, 2.0, 5.0, 0.05, "conc2", 0.01)
    box(1.08, -2.5, 0.05, 1.76, 4.6, 0.05, "water", 0)
    box(0.1, -2.5, 0, 0.2, 5.0, 0.2, "conc", 0.02)            # 육지 쪽 벽
    for yy in (-0.1, -4.9):
        box(1.0, yy, 0, 2.0, 0.2, 0.2, "conc", 0.02)          # 양 끝 벽
    for yy in (-0.1, -4.9):
        box(1.0, yy, 0.2, 2.0, 0.06, 0.012, "yel", 0)
    box(0.1, -2.5, 0.2, 0.06, 5.0, 0.012, "yel", 0)
    for k in range(9):                                        # 받침목
        box(1.05, -0.5 - k * 0.5, 0.1, 0.9, 0.12, 0.05, "wood", 0.01)
    for k in range(5):                                        # 계단식 벽 표시
        box(0.22, -0.6 - k * 0.95, 0.06, 0.04, 0.3, 0.12, "dark", 0)
    return w, h, 0.3


def dock_crane():
    """도크 위 골리앗 크레인 (발자국은 도크와 같음, 따로 그려 배 위에 겹침)"""
    y = -3.7
    for sx in (0.1, 1.9):
        for sy in (-1, 1):
            o = box(sx, y + sy * 0.3, 0.2, 0.13, 0.13, 2.25, "red", 0.02)
            o.rotation_euler[0] = sy * 0.1
        box(sx, y, 0.2, 0.2, 0.9, 0.14, "dark", 0.02)
        box(sx, y, 1.3, 0.1, 0.6, 0.1, "red", 0.02)
    box(1.0, y, 2.4, 2.3, 0.5, 0.4, "red", 0.03)
    box(1.0, y - 0.26, 2.55, 2.0, 0.02, 0.08, "white", 0)
    box(0.75, y, 2.8, 0.45, 0.42, 0.22, "yel", 0.03)
    box(1.45, y, 2.8, 0.3, 0.3, 0.16, "yel", 0.03)
    for dx in (-0.1, 0.1):
        cyl(0.75 + dx, y, 1.5, 0.012, 0.9, "dark", 6)
    box(0.75, y, 1.42, 0.4, 0.26, 0.08, "yel", 0.02)
    return 2, 5, 3.05


def tree(seed):
    def f():
        random.seed(seed)
        s = random.uniform(0.9, 1.2)
        cyl(0.5, -0.5, 0, 0.06 * s, 0.35 * s, "wood", 8)
        ball(0.5, -0.5, 0.68 * s, 0.38 * s, "tree" if seed % 2 else "tree2", 1.15)
        ball(0.66, -0.58, 0.5 * s, 0.26 * s, "tree2" if seed % 2 else "tree")
        return 1, 1, 1.2
    return f


def containers(seed, along_x):
    """컨테이너 더미 (2×1 또는 1×2 칸)"""
    def f():
        random.seed(seed)
        cols = ["red", "blue", "yel", "green", "orange"]
        w, h = (2, 1) if along_x else (1, 2)
        for i in range(2):
            for lv in range(random.choice([1, 2, 2, 3])):
                if along_x:
                    box(1.0, -0.28 - i * 0.44, lv * 0.42, 1.7, 0.4, 0.4, random.choice(cols), 0.02)
                else:
                    box(0.28 + i * 0.44, -1.0, lv * 0.42, 0.4, 1.7, 0.4, random.choice(cols), 0.02)
        return w, h, 1.3
    return f


SPRITES = {
    "hq": hq, "welding": welding, "cutting": cutting, "yard": yard,
    "dock_base": dock_base, "dock_crane": dock_crane,
    "tree1": tree(1), "tree2": tree(2),
    "cont_x1": containers(11, True), "cont_x2": containers(12, True),
    "cont_y1": containers(21, False), "cont_y2": containers(22, False),
}

if __name__ == "__main__":
    names = [a for a in sys.argv[1:] if not a.startswith("-")] or list(SPRITES)
    os.makedirs(OUT, exist_ok=True)
    meta = json.load(open(META)) if os.path.exists(META) else {"cellPx": A.CELL_PX, "sprites": {}}
    meta["cellPx"] = A.CELL_PX
    for n in names:
        A.reset()
        w, h, mz = SPRITES[n]()
        meta["sprites"][n] = A.render(os.path.join(OUT, n + ".png"), w, h, mz)
        print("OK", n, meta["sprites"][n])
    os.makedirs(os.path.dirname(META), exist_ok=True)
    json.dump(meta, open(META, "w"), indent=1, sort_keys=True)
