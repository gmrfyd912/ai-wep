"""조선소 지도 그림 뽑기.

쓰는 법 (Blender 파이썬 모듈이 깔린 파이썬으로):
    pip install bpy
    python tools/art/sprites.py            # 전부
    python tools/art/sprites.py hq dock    # 고른 것만
결과: assets/yard/<이름>.png 와 src/game/yardArt.json (그림 크기·기준점).
"""
import json, math, os, random, sys

sys.path.insert(0, os.path.dirname(__file__))
import artlib as A
from artlib import box, cyl, ball, wedge, hazard, worker

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "yard")
META = os.path.join(ROOT, "src", "game", "yardArt.json")


# ---------- 건물 (발자국: X 0..w, Y -h..0). t = 겉모습 단계 1~3 (레벨 1~3 / 4~6 / 7~8) ----------
def roof_kit(x, y, z, t):
    """옥상 설비: 단계가 오르면 환기 장치·물탱크·안테나가 늘어남"""
    box(x, y, z, 0.3, 0.24, 0.12, "steel", 0.02)
    if t >= 2:
        cyl(x + 0.45, y + 0.05, z, 0.11, 0.2, "white", 14)
        box(x - 0.4, y - 0.1, z, 0.22, 0.22, 0.1, "dark", 0.02)
    if t >= 3:
        cyl(x - 0.1, y + 0.4, z, 0.015, 0.6, "steel", 6)
        ball(x - 0.1, y + 0.4, z + 0.62, 0.035, "red")


def hq(t=1):
    """본관 3×3: 유리창 사무동 (단계마다 한 층씩 높아짐) + 옥상 + 깃발"""
    cx, cy = 1.5, -1.5
    floors = 1 + t
    box(cx, cy, 0, 2.8, 2.8, 0.1, "conc2", 0.03)
    for f in range(floors):
        z = 0.1 + f * 0.56
        box(cx, cy, z, 2.5, 2.5, 0.56, "navy" if f == 0 else "blue", 0.03)
        box(cx, cy - 1.26, z + 0.15, 2.2, 0.04, 0.3, "glass", 0.005)
        box(cx + 1.26, cy, z + 0.15, 0.04, 2.2, 0.3, "glass", 0.005)
        for k in range(-2, 3):
            box(cx + k * 0.45, cy - 1.29, z + 0.13, 0.05, 0.03, 0.34, "white", 0)
            box(cx + 1.29, cy + k * 0.45, z + 0.13, 0.03, 0.05, 0.34, "white", 0)
    top = 0.1 + floors * 0.56
    box(cx, cy, top, 2.7, 2.7, 0.1, "white", 0.03)
    box(cx - 0.5, cy + 0.5, top + 0.1, 0.9, 0.9, 0.35, "white", 0.03)
    roof_kit(cx + 0.55, cy - 0.5, top + 0.1, t)
    if t >= 3:                                   # 헬기 내리는 곳
        cyl(cx + 0.55, cy + 0.55, top + 0.1, 0.42, 0.03, "dark", 24)
        cyl(cx + 0.55, cy + 0.55, top + 0.13, 0.3, 0.005, "yel", 24)
        cyl(cx + 0.55, cy + 0.55, top + 0.135, 0.24, 0.005, "dark", 24)
    cyl(cx - 0.5, cy + 0.5, top + 0.45, 0.025, 0.75, "steel", 8)
    box(cx - 0.3, cy + 0.5, top + 0.96, 0.4, 0.02, 0.24, "orange", 0)
    # 현관 (앞 왼쪽 면)
    box(cx + 0.2, cy - 1.5, 0.52, 0.9, 0.5, 0.06, "orange", 0.02)
    box(cx + 0.2, cy - 1.28, 0.1, 0.6, 0.05, 0.42, "glass", 0)
    for dx in (-0.35, 0.35):
        cyl(cx + 0.2 + dx, cy - 1.7, 0.1, 0.03, 0.42, "white", 8)
    return 3, 3, top + 1.3


def shop(wall="orange", t=1):
    """공장 2×2: 톱니 지붕 + 큰 문 + 굴뚝 (단계가 오르면 높아지고 굴뚝·설비가 늘어남)"""
    cx, cy, L, D = 1.0, -1.0, 1.7, 1.7
    H = 0.65 + 0.12 * t
    box(cx, cy, 0, L, D, H, "white", 0.03)
    box(cx, cy, 0, L + 0.04, D + 0.04, 0.26, wall, 0.02)
    if t >= 2:
        box(cx, cy, H - 0.1, L + 0.04, D + 0.04, 0.06, wall, 0.01)
    teeth = 3
    tw = L / teeth
    for i in range(teeth):
        x0 = cx - L / 2 + i * tw
        wedge(x0, x0 + tw, cy - D / 2, cy + D / 2, H, H + 0.4, "roof")
        box(x0 + 0.02, cy, H + 0.07, 0.03, D - 0.3, 0.26, "glass", 0)
    # 큰 문 (앞 왼쪽 면) + 옆문 (앞 오른쪽 면)
    box(cx, cy - D / 2 - 0.02, 0, 0.9, 0.05, 0.58, "steel", 0.01)
    for s in range(4):
        box(cx, cy - D / 2 - 0.05, 0.08 + s * 0.13, 0.9, 0.02, 0.02, "dark", 0)
    box(cx + L / 2 + 0.02, cy + 0.3, 0, 0.05, 0.35, 0.5, wall, 0.01)
    if t >= 2:
        for k in (-0.5, 0.0):
            box(cx + L / 2 + 0.02, cy + k - 0.1, 0.38, 0.03, 0.3, 0.2, "glass", 0)
    # 굴뚝 (뒤쪽) — 연기는 게임에서 따로 그림. 자리: 발자국 (0.45, 0.45)
    kx, ky = cx - L / 2 + 0.3, cy + D / 2 - 0.3
    cyl(kx, ky, H, 0.11, 1.0, "white", 16)
    cyl(kx, ky, H + 0.85, 0.12, 0.2, "red", 16)
    if t >= 3:
        cyl(kx + 0.32, ky, H, 0.09, 0.7, "white", 16)
        cyl(kx + 0.32, ky, H + 0.55, 0.1, 0.16, "red", 16)
        cyl(cx + L / 2 + 0.16, cy + D / 2 - 0.3, 0, 0.14, 0.7, "steel", 16)      # 가스 탱크
    return 2, 2, H + 1.15


def welding(t=1):
    r = shop("orange", t)
    ball(1.0, -2.0, 0.12, 0.05, "spark")                 # 문 앞 용접 불빛
    worker(0.82, -2.02, 0, "navy")
    if t >= 2:
        box(1.6, -1.98, 0, 0.3, 0.2, 0.2, "steel", 0.02)  # 용접기
    return r


def cutting(t=1):
    r = shop("blue", t)
    for k in range(2 + t):                               # 문 앞에 잘라 둔 철판
        box(1.55, -1.98, k * 0.04, 0.4, 0.28, 0.03, "steel", 0.004)
    return r


def yard(t=1):
    """강판 야적장 2×2: 철판 더미 + 작은 문형 크레인 (단계가 오르면 더미가 높아지고 크레인이 커짐)"""
    random.seed(3)
    box(1.0, -1.0, 0, 1.84, 1.84, 0.05, "conc2", 0.02)
    hazard(1.0, -1.0, 1.7, 1.7)
    for (dx, dy, n) in ((-0.42, 0.42, 9), (0.42, 0.45, 5), (-0.42, -0.4, 4), (0.45, -0.42, 11)):
        for k in range(n + (t - 1) * 4):
            box(1.0 + dx + random.uniform(-.02, .02), -1.0 + dy, 0.05 + k * 0.045, 0.66, 0.6, 0.035, "steel" if k % 5 else "oxide", 0.005)
    ch = 0.85 + 0.25 * t
    for sx in (0.14, 1.86):
        box(sx, -1.0, 0.05, 0.1, 0.12, ch, "yel", 0.02)
        box(sx, -1.0, 0, 0.2, 0.4, 0.08, "dark", 0.02)
    box(1.0, -1.0, ch + 0.05, 1.9, 0.16, 0.14, "yel", 0.02)
    box(0.7, -1.0, ch - 0.07, 0.22, 0.2, 0.12, "dark", 0.02)
    cyl(0.7, -1.0, ch - 0.4, 0.012, 0.35, "dark", 6)
    if t >= 3:
        box(1.0, -1.0, ch + 0.19, 0.3, 0.3, 0.16, "white", 0.02)
    return 2, 2, ch + 0.4


def rodstore(t=1):
    """용접봉 창고 2×2: 둥근 지붕 창고 + 문 앞 용접봉 상자·드럼 (단계가 오르면 길쭉한 저장 탱크가 늘어남)"""
    cx, cy = 0.85, -1.0
    box(cx, cy, 0, 1.3, 1.7, 0.6, "white", 0.03)
    box(cx, cy, 0, 1.34, 1.74, 0.22, "yel", 0.02)
    r = cyl(cx, cy, 0, 0.65, 1.7, "roof", 32, rot=(math.pi / 2, 0, 0))      # 눕힌 원통을 납작하게 = 둥근 지붕
    r.location[2] = 0.6
    r.scale = (1, 0.5, 1)
    box(cx, cy - 0.86, 0, 0.7, 0.05, 0.5, "steel", 0.01)
    for s in range(3):
        box(cx, cy - 0.89, 0.1 + s * 0.13, 0.7, 0.02, 0.02, "dark", 0)
    for k in range(t + 1):                                # 용접봉 상자 더미
        box(0.35 + (k % 2) * 0.3, -1.95, (k // 2) * 0.17, 0.26, 0.2, 0.16, "wood", 0.01)
    for k in range(t):                                    # 저장 탱크
        cyl(1.72, -0.4 - k * 0.55, 0, 0.2, 0.7 + 0.15 * t, "orange", 18)
        cyl(1.72, -0.4 - k * 0.55, 0.7 + 0.15 * t, 0.2, 0.08, "steel", 18, r2=0.08)
    return 2, 2, 1.4


def academy(t=1):
    """무기 연구소 2×2: 보라색 연구동 + 둥근 관측 돔 + 접시 안테나 (단계가 오르면 층·장비가 늘어남)"""
    cx, cy = 1.0, -1.0
    box(cx, cy, 0, 1.8, 1.8, 0.06, "conc2", 0.02)
    H = 0.5 + 0.2 * t
    box(cx, cy, 0.06, 1.6, 1.6, H, "white", 0.03)
    box(cx, cy, 0.06, 1.64, 1.64, 0.2, "purple", 0.02)
    for f in range(t):
        z = 0.34 + f * 0.24
        box(cx, cy - 0.81, z, 1.3, 0.03, 0.14, "glass", 0)
        box(cx + 0.81, cy, z, 0.03, 1.3, 0.14, "glass", 0)
    top = 0.06 + H
    box(cx, cy, top, 1.7, 1.7, 0.06, "purple", 0.02)
    ball(cx - 0.3, cy + 0.3, top + 0.06, 0.42, "white", 0.8)       # 돔
    cyl(cx + 0.45, cy - 0.4, top + 0.06, 0.03, 0.3, "steel", 8)   # 접시 안테나
    d = cyl(cx + 0.45, cy - 0.4, top + 0.36, 0.26, 0.08, "white", 20, r2=0.05)
    d.rotation_euler = (0.5, 0.4, 0)
    if t >= 2:
        box(cx + 0.5, cy + 0.45, top + 0.06, 0.4, 0.3, 0.16, "steel", 0.02)
    if t >= 3:
        cyl(cx - 0.6, cy - 0.6, top + 0.06, 0.02, 0.8, "steel", 6)
        ball(cx - 0.6, cy - 0.6, top + 0.88, 0.04, "red")
    box(cx + 0.1, cy - 0.83, 0.06, 0.4, 0.04, 0.34, "dark", 0.005)  # 문
    return 2, 2, top + 1.0


def trainhall(t=1):
    """기술교육원 2×2: 초록 지붕 교실동 + 실습용 용접대·깃발 (단계가 오르면 2층·실습 장비가 늘어남)"""
    cx, cy = 0.9, -0.9
    box(1.0, -1.0, 0, 1.84, 1.84, 0.05, "conc2", 0.02)
    fl = 1 if t == 1 else 2
    H = 0.5 * fl
    box(cx, cy, 0.05, 1.5, 1.5, H, "white", 0.03)
    for f in range(fl):
        z = 0.2 + f * 0.5
        for k in (-0.45, 0, 0.45):
            box(cx + k, cy - 0.76, z, 0.28, 0.03, 0.22, "glass", 0)
            box(cx + 0.76, cy + k, z, 0.03, 0.28, 0.22, "glass", 0)
    # 박공 지붕
    wedge(cx, cx + 0.82, cy - 0.8, cy + 0.8, 0.05 + H, 0.05 + H + 0.4, "green")
    wedge(cx, cx - 0.82, cy + 0.8, cy - 0.8, 0.05 + H, 0.05 + H + 0.4, "green")
    box(cx + 0.3, cy - 0.78, 0.05, 0.3, 0.04, 0.36, "wood", 0.005)   # 문
    # 깃대
    cyl(1.75, -0.2, 0, 0.02, 1.1, "steel", 8)
    box(1.93, -0.2, 0.85, 0.34, 0.02, 0.22, "orange", 0)
    # 실습대 (앞마당)
    box(0.5, -1.82, 0, 0.5, 0.22, 0.16, "steel", 0.01)
    ball(0.5, -1.82, 0.2, 0.04, "spark")
    worker(0.25, -1.84, 0, "green")
    if t >= 2:
        box(1.2, -1.82, 0, 0.5, 0.22, 0.16, "steel", 0.01)
        worker(1.5, -1.84, 0, "navy")
    if t >= 3:
        box(1.75, -1.2, 0, 0.2, 0.9, 0.5, "yel", 0.02)                # 연습용 구조물
        box(1.75, -1.2, 0.5, 0.26, 0.96, 0.04, "dark", 0.01)
    return 2, 2, H + 0.9


def pier(t=1):
    """군항 부두 2×3: 콘크리트 잔교 + 계선주 + 등 (2단계: 초소·작은 크레인)"""
    box(1.0, -1.5, 0, 1.9, 2.9, 0.14, "conc", 0.02)
    box(1.0, -1.5, 0.14, 1.7, 2.7, 0.01, "conc2", 0)
    box(1.92, -1.5, 0.14, 0.06, 2.9, 0.012, "yel", 0)
    for k in range(4):
        cyl(1.8, -0.3 - k * 0.8, 0.14, 0.07, 0.16, "dark", 10)
        cyl(1.8, -0.3 - k * 0.8, 0.3, 0.1, 0.04, "dark", 10)
    for k in range(3):                                   # 방충재 (바다 쪽)
        cyl(1.99, -0.5 - k * 1.0, 0.0, 0.07, 0.16, "dark", 10)
    cyl(0.2, -0.2, 0.14, 0.025, 0.9, "steel", 8)
    ball(0.2, -0.2, 1.06, 0.06, "lamp")
    for k in range(2):                                   # 보급 상자
        box(0.4 + k * 0.32, -2.6, 0.14, 0.28, 0.28, 0.24, "green", 0.02)
    if t >= 2:
        box(0.5, -1.0, 0.14, 0.6, 0.6, 0.5, "white", 0.02)           # 초소
        box(0.5, -1.0, 0.64, 0.7, 0.7, 0.06, "navy", 0.02)
        box(0.5, -1.31, 0.34, 0.36, 0.02, 0.18, "glass", 0)
        cyl(1.2, -2.0, 0.14, 0.09, 0.9, "yel", 12)                    # 작은 크레인
        o = box(1.5, -2.0, 0.95, 0.9, 0.08, 0.08, "yel", 0.01)
        cyl(1.9, -2.0, 0.6, 0.01, 0.36, "dark", 6)
    return 2, 3, 1.3 if t >= 2 else 1.2


def battery(t=1):
    """해안포대 1×1: 둥근 진지 + 포탑 + 바다(+X) 쪽 포신 (단계: 포신 1 → 2 → 큰 포탑)"""
    cx, cy = 0.5, -0.5
    cyl(cx, cy, 0, 0.44, 0.16, "conc", 20)
    cyl(cx, cy, 0.16, 0.4, 0.03, "yel", 20)
    cyl(cx, cy, 0.16, 0.36, 0.035, "conc2", 20)
    r = 0.2 + 0.04 * t
    cyl(cx, cy, 0.19, r, 0.2 + 0.03 * t, "green", 16)
    ball(cx, cy, 0.39 + 0.03 * t, r * 0.95, "green", 0.45)
    guns = (0,) if t == 1 else (-0.07, 0.07)
    for g in guns:
        cyl(cx + 0.38, cy + g, 0.32 + 0.03 * t - 0.03, 0.03 + 0.008 * t, 0.62, "dark", 10, rot=(0, math.radians(82), 0))
    if t >= 3:
        box(cx - 0.05, cy + 0.02, 0.5, 0.12, 0.12, 0.1, "steel", 0.01)
    return 1, 1, 0.9


def missile(t=1):
    """미사일 기지 2×2: 받침대 + 비스듬히 선 발사관 (2 → 4 → 6개) + 작은 통제실"""
    box(1.0, -1.0, 0, 1.84, 1.84, 0.08, "conc2", 0.02)
    hazard(1.0, -1.0, 1.7, 1.7)
    n = 2 * t
    box(1.05, -0.9, 0.08, 1.2, 1.0, 0.16, "steel", 0.02)
    cyl(1.05, -0.9, 0.24, 0.3, 0.12, "dark", 16)
    for i in range(n):
        row, k = i // 2, i % 2
        x = 1.05 + (row - (t - 1) / 2) * 0.3
        y = -0.9 + (k - 0.5) * 0.34
        c = cyl(x + 0.1, y, 0.42, 0.11, 0.95, "white", 14, rot=(0, math.radians(38), 0))
        cyl(x + 0.39, y, 0.8, 0.112, 0.1, "red", 14, rot=(0, math.radians(38), 0))
    box(0.4, -1.65, 0.08, 0.5, 0.36, 0.3, "green", 0.02)             # 통제실
    box(0.4, -1.84, 0.2, 0.3, 0.02, 0.1, "glass", 0)
    if t >= 3:
        cyl(0.4, -1.65, 0.38, 0.015, 0.4, "steel", 6)
        ball(0.4, -1.65, 0.8, 0.035, "red")
    return 2, 2, 1.4


def mine():
    """기뢰밭 1×1 (바다): 물에 뜬 빨간 기뢰 3개"""
    for (x, y) in ((0.3, -0.3), (0.72, -0.45), (0.42, -0.78)):
        ball(x, y, 0.03, 0.13, "red")
        for a in range(6):
            an = a * math.pi / 3
            cyl(x + math.cos(an) * 0.13, y + math.sin(an) * 0.13, 0.05, 0.016, 0.07, "dark", 6, rot=(0, math.pi / 2, an))
        cyl(x, y, 0.13, 0.016, 0.07, "dark", 6)
    return 1, 1, 0.3


def wall(t=1):
    """방파 장벽 1×1 (바다): 콘크리트 블록 (단계가 오르면 높아지고 위에 철판)"""
    h = 0.22 + 0.14 * t
    box(0.5, -0.5, 0, 0.92, 1.0, h, "conc", 0.03)
    box(0.5, -0.5, 0, 0.98, 1.0, 0.1, "conc2", 0.02)
    box(0.5, -0.5, h, 0.5, 1.0, 0.012, "yel", 0)
    if t >= 2:
        box(0.5, -0.5, h, 0.3, 1.0, 0.1, "steel", 0.02)
    if t >= 3:
        for y in (-0.2, -0.8):
            box(0.5, y, h + 0.1, 0.12, 0.12, 0.14, "dark", 0.02)
    return 1, 1, h + 0.3


def asw(t=1):
    """대잠 기지 1×2: 낮은 통제동 + 폭뢰 발사대(바다 쪽) + 안테나"""
    box(0.5, -1.0, 0, 0.9, 1.9, 0.06, "conc2", 0.02)
    box(0.42, -0.55, 0.06, 0.66, 0.8, 0.4, "white", 0.03)
    box(0.42, -0.55, 0.06, 0.7, 0.84, 0.16, "navy", 0.02)
    box(0.76, -0.55, 0.28, 0.02, 0.5, 0.12, "glass", 0)
    box(0.42, -0.55, 0.46, 0.72, 0.86, 0.05, "navy", 0.02)
    cyl(0.3, -0.35, 0.51, 0.018, 0.5 + 0.15 * t, "steel", 6)
    ball(0.3, -0.35, 1.03 + 0.15 * t, 0.04, "yel")
    # 폭뢰 발사대
    box(0.5, -1.5, 0.06, 0.6, 0.5, 0.1, "steel", 0.02)
    for i in range(1 + t):
        y = -1.5 + (i - t / 2) * 0.16
        cyl(0.62, y, 0.2, 0.06, 0.4, "dark", 10, rot=(0, math.radians(55), 0))
    if t >= 2:
        d = cyl(0.55, -0.75, 0.51, 0.16, 0.05, "white", 16, r2=0.04)
        d.rotation_euler = (0.4, 0.5, 0)
    return 1, 2, 1.1 + 0.15 * t


def radar(t=1):
    """레이더 탑 1×1: 받침 + 격자 탑 + 접시 (단계가 오르면 높아지고 접시가 커짐)"""
    cx, cy = 0.5, -0.5
    box(cx, cy, 0, 0.8, 0.8, 0.12, "conc", 0.02)
    box(cx, cy, 0.12, 0.5, 0.5, 0.22, "white", 0.02)
    box(cx, cy, 0.12, 0.54, 0.54, 0.08, "navy", 0.01)
    h = 0.7 + 0.25 * t
    for (dx, dy) in ((-.12, -.12), (.12, -.12), (.12, .12), (-.12, .12)):
        cyl(cx + dx, cy + dy, 0.34, 0.02, h, "steel", 6)
    for k in range(1, int(h / 0.25) + 1):
        box(cx, cy, 0.34 + k * 0.25 - 0.02, 0.28, 0.28, 0.02, "steel", 0)
    top = 0.34 + h
    cyl(cx, cy, top, 0.06, 0.08, "dark", 10)
    r = 0.26 + 0.06 * t
    d = cyl(cx + 0.05, cy - 0.05, top + 0.12, r, 0.1, "white", 24, r2=0.06)
    d.rotation_euler = (0.9, 0, 0.8)
    ball(cx, cy, top + 0.1, 0.035, "red")
    return 1, 1, top + 0.5


def rally():
    """집결장 3×3: 밝은 광장 + 둘레 안전선 + 깃대 + 안내판 (대원·장비는 게임에서 그 위에 그림)"""
    box(1.5, -1.5, 0, 2.84, 2.84, 0.04, "conc2", 0.02)
    box(1.5, -1.5, 0.04, 2.7, 2.7, 0.01, "white", 0)
    box(1.5, -1.5, 0.05, 2.5, 2.5, 0.005, "conc", 0)
    hazard(1.5, -1.5, 2.6, 2.6)
    cyl(0.35, -0.35, 0, 0.09, 0.08, "dark", 12)
    cyl(0.35, -0.35, 0, 0.025, 1.45, "steel", 8)
    box(0.57, -0.35, 1.15, 0.42, 0.02, 0.26, "orange", 0)
    box(2.5, -0.25, 0.04, 0.7, 0.05, 0.4, "navy", 0.01)                 # 안내판
    box(2.5, -0.285, 0.14, 0.6, 0.01, 0.24, "white", 0)
    return 3, 3, 1.6


def site(w, h):
    """새로 짓는 중: 바닥 + 노란 비계 뼈대 + 자재"""
    def f():
        box(w / 2, -h / 2, 0, w - 0.16, h - 0.16, 0.07, "conc2", 0.02)
        zt = 0.75
        xs = [0.14 + i * (w - 0.28) / max(1, w) for i in range(w + 1)]
        ys = [-0.14 - j * (h - 0.28) / max(1, h) for j in range(h + 1)]
        for x in xs:
            for y in ys:
                if x in (xs[0], xs[-1]) or y in (ys[0], ys[-1]):
                    cyl(x, y, 0.07, 0.022, zt, "yel", 6)
        for z in (0.07 + zt * 0.5, 0.07 + zt):
            for y in (ys[0], ys[-1]):
                box(w / 2, y, z, w - 0.28, 0.03, 0.03, "yel", 0)
            for x in (xs[0], xs[-1]):
                box(x, -h / 2, z, 0.03, h - 0.28, 0.03, "yel", 0)
        box(w / 2, ys[-1], 0.07 + zt * 0.5 + 0.03, w - 0.28, 0.16, 0.02, "wood", 0)     # 발판
        box(w * 0.35, -h * 0.4, 0.07, min(0.5, w * 0.4), min(0.4, h * 0.3), 0.12, "wood", 0.01)   # 자재
        if w * h >= 4:
            for k in range(3):
                box(w * 0.65, -h * 0.6, 0.07 + k * 0.04, 0.5, 0.4, 0.03, "steel", 0.004)
        return w, h, 1.0
    return f


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


def T3(fn):
    return {f"{fn.__name__}_{t}": (lambda t=t: fn(t)) for t in (1, 2, 3)}


SPRITES = {
    **T3(hq), **T3(welding), **T3(cutting), **T3(yard), **T3(rodstore), **T3(academy), **T3(trainhall),
    **T3(battery), **T3(missile), **T3(asw), **T3(radar), **T3(wall),
    "pier_1": lambda: pier(1), "pier_2": lambda: pier(2), "mine_1": mine, "rally_1": rally,
    "site_1x1": site(1, 1), "site_2x2": site(2, 2), "site_3x3": site(3, 3), "site_1x2": site(1, 2), "site_2x3": site(2, 3),
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
    # --meta-out=파일: 여러 개를 나눠 동시에 뽑을 때 결과를 따로 적음 (나중에 합침)
    out = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--meta-out=")), None)
    got = {}
    for n in names:
        A.reset()
        w, h, mz = SPRITES[n]()
        got[n] = A.render(os.path.join(OUT, n + ".png"), w, h, mz)
        got[n]["z"] = round(mz, 2)
        print("OK", n, got[n], flush=True)
    if out:
        json.dump(got, open(out, "w"))
    else:
        meta["sprites"].update(got)
        json.dump(meta, open(META, "w"), indent=1, sort_keys=True)
