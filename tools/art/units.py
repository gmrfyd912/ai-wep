"""배·대원·장비 그림 (sprites.py 가 불러 씀).

배는 뱃머리가 +X 를 보게, 가운데가 원점, 길이 4.4 로 만든 뒤 group() 으로 크기·방향·자리를 한 번에 옮긴다.
"""
import bpy, bmesh, math, random
import artlib as A
from artlib import box, cyl, ball, wedge


def group(fn, loc=(0, 0, 0), scale=1.0, rz=0.0):
    """fn() 이 만든 물체들을 한 덩어리로 묶어 옮김·크기·돌림"""
    before = set(A.col.objects)
    fn()
    e = bpy.data.objects.new("grp", None)
    A.col.objects.link(e)
    for o in set(A.col.objects) - before:
        if o is not e and o.parent is None:
            o.parent = e
    e.location = loc
    e.scale = (scale, scale, scale)
    e.rotation_euler[2] = rz
    return e


def hull(L, B, H, m, z=0.0, bow=0.28, m_low=None, low=0.0):
    """배 몸통: 앞이 뾰족한 윤곽을 위로 세움 (위가 조금 넓음). low>0 이면 아랫부분을 다른 색으로"""
    def solid(z0, z1, mat, grow0, grow1):
        me = bpy.data.meshes.new("hull")
        bm = bmesh.new()
        def ring(zz, g):
            b = B / 2 * g
            pts = [(-L / 2, -b * 0.8), (-L / 2 + 0.15, -b), (L / 2 - L * bow, -b), (L / 2, 0),
                   (L / 2 - L * bow, b), (-L / 2 + 0.15, b), (-L / 2, b * 0.8)]
            return [bm.verts.new((x, y, zz)) for x, y in pts]
        r0, r1 = ring(z0, grow0), ring(z1, grow1)
        bm.faces.new(list(reversed(r0)))
        bm.faces.new(r1)
        n = len(r0)
        for i in range(n):
            bm.faces.new((r0[i], r0[(i + 1) % n], r1[(i + 1) % n], r1[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        return A.add(bpy.data.objects.new("hull", me), mat, 0.02)
    if m_low and low > 0:
        solid(z, z + low, m_low, 0.86, 0.92)
        solid(z + low, z + H, m, 0.92, 1.0)
    else:
        solid(z, z + H, m, 0.86, 1.0)


def house(x, z, w=0.6, d=0.9, floors=2, m="white"):
    """선교(뒤쪽 건물): 층마다 창 띠"""
    for f in range(floors):
        box(x, 0, z + f * 0.26, w - f * 0.06, d - f * 0.08, 0.26, m, 0.02)
        box(x + (w - f * 0.06) / 2, 0, z + f * 0.26 + 0.1, 0.02, d - f * 0.08 - 0.12, 0.1, "glass", 0)
        box(x, -(d - f * 0.08) / 2, z + f * 0.26 + 0.1, w - f * 0.06 - 0.12, 0.02, 0.1, "glass", 0)
    top = z + floors * 0.26
    cyl(x - 0.12, 0, top, 0.07, 0.3, "orange", 12)          # 굴뚝
    cyl(x + 0.12, 0, top, 0.012, 0.35, "steel", 6)          # 돛대
    return top


# ---------- 상선 (도크에서 짓는 배) ----------
def cargo_hull(L=4.4, B=1.25, H=0.5):
    hull(L, B, H, "red", 0, m_low="oxide", low=0.2)
    box(-0.1, 0, H, L * 0.86, B * 0.88, 0.02, "dark", 0)


def ship_barge():
    L = 3.2
    hull(L, 1.2, 0.36, "oxide", 0, bow=0.16)
    box(0.1, 0, 0.36, 2.2, 0.9, 0.03, "dark", 0)
    random.seed(4)
    for i in range(4):
        for j in range(2):
            box(-0.6 + i * 0.55, -0.22 + j * 0.44, 0.39, 0.45, 0.36, 0.2 + random.random() * 0.15, random.choice(["steel", "wood", "yel"]), 0.02)
    house(-1.3, 0.36, 0.4, 0.7, 1)


def ship_bulk():
    cargo_hull()
    for i in range(5):
        box(-0.75 + i * 0.6, 0, 0.52, 0.5, 0.85, 0.1, "green", 0.02)
        box(-0.75 + i * 0.6, 0, 0.62, 0.42, 0.75, 0.03, "steel", 0.01)
    house(-1.75, 0.52, 0.55, 1.0, 3)


def ship_container():
    cargo_hull()
    random.seed(8)
    cols = ["red", "blue", "yel", "green", "orange", "white"]
    for i in range(6):
        for j in range(3):
            for k in range(random.choice([2, 3, 3])):
                box(-1.05 + i * 0.5, -0.36 + j * 0.36, 0.52 + k * 0.2, 0.46, 0.32, 0.19, random.choice(cols), 0.012)
    house(-1.8, 0.52, 0.5, 1.0, 4)


def ship_lng():
    cargo_hull()
    for i in range(4):
        ball(-0.9 + i * 0.78, 0, 0.62, 0.42, "white")
        box(-0.9 + i * 0.78, 0, 0.52, 0.7, 0.9, 0.12, "orange", 0.02)
    box(0.25, 0, 0.98, 3.0, 0.08, 0.04, "steel", 0.005)
    house(-1.8, 0.52, 0.5, 1.0, 3)


def ship_offshore():
    hull(4.0, 1.5, 0.5, "orange", 0, bow=0.2, m_low="dark", low=0.2)
    box(0, 0, 0.5, 3.4, 1.3, 0.03, "dark", 0)
    # 시추 탑
    for (dx, dy) in ((-.22, -.22), (.22, -.22), (.22, .22), (-.22, .22)):
        o = cyl(0.2 + dx, dy, 0.53, 0.025, 1.6, "yel", 6)
        o.rotation_euler = (-dy * 0.4, dx * 0.4, 0)
    for k in range(1, 5):
        s = 0.5 - k * 0.07
        box(0.2, 0, 0.53 + k * 0.36, s, s, 0.02, "yel", 0)
    # 헬기 내리는 곳 (앞)
    cyl(1.45, 0, 0.75, 0.5, 0.04, "green", 20)
    cyl(1.45, 0, 0.79, 0.34, 0.005, "white", 20)
    cyl(1.45, 0, 0.53, 0.06, 0.22, "steel", 8)
    # 크레인 (가운데 뒤)
    cyl(-0.7, 0.4, 0.53, 0.09, 0.6, "white", 10)
    o = box(-0.35, 0.4, 1.1, 0.9, 0.07, 0.07, "yel", 0.01)
    o.rotation_euler[1] = -0.35
    house(-1.5, 0.53, 0.6, 1.1, 3)


# ---------- 전투함 ----------
def gun(x, z, s=1.0):
    cyl(x, 0, z, 0.13 * s, 0.1 * s, "steel", 12)
    ball(x, 0, z + 0.1 * s, 0.12 * s, "steel", 0.7)
    cyl(x + 0.2 * s, 0, z + 0.1 * s, 0.02 * s, 0.34 * s, "dark", 8, rot=(0, math.radians(80), 0))


def war_hull(L, B=0.95, H=0.42):
    hull(L, B, H, "steel", 0, bow=0.34, m_low="dark", low=0.14)
    box(-0.05, 0, H, L * 0.8, B * 0.8, 0.015, "dark", 0)


def ship_patrol():
    war_hull(3.0, 0.85, 0.36)
    box(-0.2, 0, 0.36, 0.9, 0.6, 0.26, "white", 0.02)
    box(0.26, 0, 0.46, 0.02, 0.5, 0.1, "glass", 0)
    box(-0.2, -0.3, 0.46, 0.7, 0.02, 0.1, "glass", 0)
    cyl(-0.3, 0, 0.62, 0.012, 0.45, "steel", 6)
    ball(-0.3, 0, 1.08, 0.03, "red")
    gun(0.75, 0.37, 0.8)
    box(-1.05, 0, 0.36, 0.5, 0.5, 0.1, "orange", 0.02)     # 구조용 보트


def ship_frigate():
    war_hull(3.9)
    box(-0.2, 0, 0.43, 1.5, 0.7, 0.26, "steel", 0.02)
    box(0.1, 0, 0.69, 0.7, 0.6, 0.24, "white", 0.02)
    box(0.46, 0, 0.77, 0.02, 0.5, 0.1, "glass", 0)
    cyl(-0.1, 0, 0.93, 0.02, 0.6, "steel", 6)
    box(-0.1, 0, 1.3, 0.04, 0.5, 0.03, "steel", 0)
    d = cyl(-0.45, 0, 0.95, 0.16, 0.05, "white", 16, r2=0.04)
    d.rotation_euler = (0, 0.6, 0)
    cyl(-0.6, 0, 0.69, 0.1, 0.3, "dark", 12)
    gun(1.1, 0.44)
    box(-1.4, 0, 0.43, 0.7, 0.7, 0.02, "dark", 0)         # 헬기 갑판
    cyl(-1.4, 0, 0.455, 0.22, 0.004, "yel", 18)


def ship_destroyer():
    war_hull(4.4, 1.0, 0.45)
    box(-0.3, 0, 0.46, 2.0, 0.76, 0.28, "steel", 0.02)
    box(0.25, 0, 0.74, 0.8, 0.66, 0.3, "white", 0.02)
    box(0.66, 0, 0.86, 0.02, 0.56, 0.1, "glass", 0)
    for sy in (-0.2, 0.2):
        box(0.2, sy, 1.04, 0.3, 0.02, 0.3, "steel", 0)     # 판 모양 레이더
    cyl(0.0, 0, 1.04, 0.025, 0.7, "steel", 6)
    cyl(-0.8, 0, 0.74, 0.12, 0.34, "dark", 12)
    gun(1.35, 0.47, 1.1)
    for i in range(4):
        for j in range(2):
            box(0.95 + i * 0.0 - 0.0 + (i % 2) * 0.12 - 0.06, -0.12 + j * 0.24, 0.47 + (i // 2) * 0.0, 0.1, 0.1, 0.03, "white", 0.005)
    gun(-1.5, 0.47, 0.8)


def ship_submarine():
    c = cyl(0, 0, 0, 0.42, 3.8, "dark", 20, rot=(0, math.pi / 2, 0))
    c.location[2] = 0.34
    ball(1.9, 0, 0.34, 0.42, "dark")
    o = cyl(-2.2, 0, 0, 0.42, 0.7, "dark", 20, r2=0.1, rot=(0, -math.pi / 2, 0))
    o.location[2] = 0.34
    box(0.3, 0, 0.7, 0.8, 0.22, 0.42, "dark", 0.04)        # 함교탑
    box(0.3, 0, 0.95, 0.12, 0.8, 0.03, "dark", 0.01)
    cyl(0.4, 0, 1.12, 0.015, 0.3, "steel", 6)
    box(-2.3, 0, 0.3, 0.3, 0.9, 0.03, "dark", 0.01)
    box(-2.3, 0, 0.3, 0.3, 0.03, 0.6, "dark", 0.01)
    box(0, 0, 0.75, 3.0, 0.3, 0.012, "steel", 0)


def ship_landing():
    hull(4.2, 1.3, 0.5, "steel", 0, bow=0.12, m_low="dark", low=0.16)
    box(0.3, 0, 0.5, 3.0, 1.1, 0.02, "dark", 0)
    box(2.0, 0, 0.2, 0.08, 1.0, 0.5, "yel", 0.02)          # 앞 내림 문
    box(-1.5, 0, 0.5, 0.8, 1.1, 0.3, "steel", 0.02)
    box(-1.5, 0, 0.8, 0.6, 0.9, 0.26, "white", 0.02)
    box(-1.19, 0, 0.9, 0.02, 0.8, 0.1, "glass", 0)
    cyl(-1.6, 0, 1.06, 0.015, 0.5, "steel", 6)
    for i in range(3):                                      # 갑판 위 장비
        box(-0.3 + i * 0.7, -0.25 + (i % 2) * 0.5, 0.52, 0.45, 0.3, 0.2, "green", 0.02)


CARGO = {"barge": ship_barge, "bulk": ship_bulk, "container": ship_container, "lng": ship_lng, "offshore": ship_offshore}
WAR = {"patrol": ship_patrol, "frigate": ship_frigate, "destroyer": ship_destroyer, "submarine": ship_submarine, "landing": ship_landing}


def in_dock(fn):
    """도크(2×5) 안에 누운 배: 뱃머리가 화면 아래쪽(-Y)"""
    def f():
        group(fn, loc=(1.05, -2.45, 0.16), scale=0.93, rz=-math.pi / 2)
        return 2, 5, 2.3
    return f


def dock_blocks(n, war):
    """짓기 시작: 받침 위 선체 조각 n 개 + 노란 발판"""
    def f():
        m = "steel" if war else "oxide"
        for k in range(n):
            y = -0.9 - k * 1.15
            box(1.05, y, 0.16, 1.1, 1.0, 0.42, m, 0.03)
            box(1.05, y, 0.58, 0.9, 0.8, 0.02, "dark", 0)
            for sx in (0.42, 1.68):
                cyl(sx, y - 0.4, 0.1, 0.02, 0.7, "yel", 6)
                cyl(sx, y + 0.4, 0.1, 0.02, 0.7, "yel", 6)
                box(sx, y, 0.6, 0.12, 0.84, 0.02, "wood", 0)
            ball(1.05 + (k % 2) * 0.3, y - 0.5, 0.4, 0.035, "spark")
        return 2, 5, 1.0
    return f


def dock_hull(war, with_house):
    def f():
        def g():
            if war:
                war_hull(3.6 if not with_house else 4.2)
                if with_house:
                    box(-0.2, 0, 0.43, 1.4, 0.7, 0.26, "steel", 0.02)
            else:
                cargo_hull(3.4 if not with_house else 4.1)
                if with_house:
                    box(-1.75, 0, 0.52, 0.55, 1.0, 0.5, "white", 0.02)
        group(g, loc=(1.05, -2.3 if not with_house else -2.5, 0.16), rz=-math.pi / 2)
        for y in (-1.2, -3.4):                               # 발판
            for sx in (0.3, 1.8):
                cyl(sx, y, 0.1, 0.02, 0.8, "yel", 6)
        return 2, 5, 1.4
    return f


def at_pier(fn):
    """부두 옆 바다에 뜬 전투함 (2×1 칸, 뱃머리 +X). 물에 잠긴 만큼 아래로"""
    def f():
        group(fn, loc=(1.0, -0.5, -0.06), scale=0.43)
        return 2, 1, 0.7
    return f


# ---------- 대원 (사람) ----------
def person(body, tool=None, s=1.0):
    def f():
        x, y = 0.5, -0.5
        for dx in (-0.045, 0.045):
            cyl(x + dx * s, y, 0, 0.035 * s, 0.2 * s, "dark", 8)
        cyl(x, y, 0.19 * s, 0.085 * s, 0.24 * s, body, 12, r2=0.07 * s)
        box(x, y - 0.07 * s, 0.3 * s, 0.14 * s, 0.01, 0.03 * s, "yel", 0)       # 안전 띠
        for dx in (-0.1, 0.1):
            o = cyl(x + dx * s, y, 0.22 * s, 0.026 * s, 0.2 * s, body, 8)
            o.rotation_euler[1] = dx * 2
        ball(x, y, 0.5 * s, 0.075 * s, "skin")
        ball(x, y, 0.545 * s, 0.085 * s, "yel" if body != "yel" else "white", 0.62)
        cyl(x, y, 0.53 * s, 0.1 * s, 0.012 * s, "yel" if body != "yel" else "white", 14)
        if tool == "torch":
            box(x + 0.14 * s, y - 0.06 * s, 0.24 * s, 0.03 * s, 0.14 * s, 0.03 * s, "dark", 0)
            ball(x + 0.14 * s, y - 0.15 * s, 0.25 * s, 0.03 * s, "spark")
        elif tool == "hammer":
            cyl(x + 0.14 * s, y, 0.2 * s, 0.012 * s, 0.22 * s, "wood", 6)
            box(x + 0.14 * s, y, 0.4 * s, 0.1 * s, 0.04 * s, 0.05 * s, "steel", 0.005)
        elif tool == "pipe":
            cyl(x, y - 0.1 * s, 0.33 * s, 0.03 * s, 0.5 * s, "steel", 10, rot=(0, math.pi / 2, 0))
        elif tool == "flag":
            cyl(x + 0.14 * s, y, 0.2 * s, 0.01 * s, 0.4 * s, "white", 6)
            box(x + 0.2 * s, y, 0.47 * s, 0.12 * s, 0.01, 0.1 * s, "red", 0)
        return 1, 1, 0.75
    return f


# ---------- 장비 ----------
def wheel(x, y, r=0.07, w=0.05):
    cyl(x, y, 0, r, w, "dark", 14, rot=(math.pi / 2, 0, 0)).location[2] = r


def forklift_model(load=True):
    """지게차: 뱃머리(포크) +X, 가운데 원점, 길이 약 0.6"""
    box(-0.08, 0, 0.06, 0.4, 0.26, 0.16, "orange", 0.02)
    box(-0.22, 0, 0.22, 0.14, 0.26, 0.1, "dark", 0.02)                 # 뒤 무게추
    for (dx, dy) in ((-0.2, -0.11), (-0.2, 0.11), (0.02, -0.11), (0.02, 0.11)):
        cyl(-0.08 + dx, dy, 0.22, 0.012, 0.26, "dark", 6)              # 지붕 기둥
    box(-0.17, 0, 0.48, 0.26, 0.26, 0.02, "orange", 0.01)
    for (wx, wy) in ((0.05, -0.14), (0.05, 0.14), (-0.22, -0.14), (-0.22, 0.14)):
        wheel(wx, wy)
    for dy in (-0.08, 0.08):
        box(0.14, dy, 0.03, 0.025, 0.025, 0.5, "dark", 0.004)          # 마스트
        box(0.3, dy, 0.08, 0.3, 0.035, 0.015, "steel", 0)               # 포크
    ball(-0.08, 0, 0.36, 0.045, "skin")
    ball(-0.08, 0, 0.39, 0.05, "yel", 0.6)
    if load:
        for k in range(3):
            box(0.32, 0, 0.1 + k * 0.035, 0.26, 0.3, 0.028, "steel", 0.004)


def transporter_model():
    """트랜스포터: 낮고 긴 노란 평판차 + 바퀴 여러 줄 + 선체 조각"""
    box(0, 0, 0.1, 0.8, 0.34, 0.08, "yel", 0.015)
    for i in range(5):
        for dy in (-0.15, 0.15):
            wheel(-0.32 + i * 0.16, dy, 0.055, 0.05)
    box(-0.34, 0, 0.18, 0.1, 0.2, 0.1, "white", 0.01)
    box(0.06, 0, 0.18, 0.5, 0.3, 0.2, "oxide", 0.02)


def crane_model():
    """이동식 크레인: 차체 + 운전실 + 비스듬한 붐"""
    box(0, 0, 0.08, 0.6, 0.3, 0.12, "yel", 0.02)
    for (wx, wy) in ((-0.2, -0.16), (-0.2, 0.16), (0.0, -0.16), (0.0, 0.16), (0.2, -0.16), (0.2, 0.16)):
        wheel(wx, wy, 0.065)
    box(-0.1, 0.06, 0.2, 0.22, 0.16, 0.16, "white", 0.02)
    box(0.02, 0.06, 0.26, 0.02, 0.12, 0.08, "glass", 0)
    o = box(0.18, -0.08, 0.2, 1.0, 0.07, 0.07, "yel", 0.01)
    o.rotation_euler[1] = -0.75
    o.location = (0.2, -0.08, 0.55)
    cyl(0.56, -0.08, 0.5, 0.006, 0.4, "dark", 6)
    box(0.56, -0.08, 0.44, 0.06, 0.06, 0.06, "red", 0.01)


def machine(fn, rz=0.0, scale=1.0, z=0.8):
    def f():
        group(fn, loc=(0.5, -0.5, 0), scale=scale, rz=rz)
        return 1, 1, z
    return f


# 지도에서 달리는 방향: 게임 +x = Blender +X, 게임 +y = Blender -Y
DIRS = {"px": 0.0, "nx": math.pi, "py": -math.pi / 2, "ny": math.pi / 2}


# ---------- 폐자재 ----------
def scrap(kind):
    def f():
        random.seed(5)
        if kind == "pipe":
            for i in range(3):
                cyl(0.5, -0.35 - i * 0.14, 0, 0.06, 0.7, "steel", 10, rot=(0, math.pi / 2, 0)).location[2] = 0.06
            cyl(0.5, -0.42, 0, 0.06, 0.6, "oxide", 10, rot=(0, math.pi / 2, 0.15)).location[2] = 0.17
        elif kind == "plate":
            for k in range(4):
                box(0.5 + random.uniform(-.05, .05), -0.5 + random.uniform(-.05, .05), k * 0.04, 0.6, 0.45, 0.03, "oxide" if k % 2 else "steel", 0.004, rot=random.uniform(-.3, .3))
        else:
            cyl(0.36, -0.42, 0, 0.13, 0.36, "red", 14)
            cyl(0.64, -0.5, 0, 0.13, 0.36, "blue", 14)
            cyl(0.48, -0.68, 0, 0.13, 0.13 * 2, "yel", 14, rot=(math.pi / 2, 0, 0.5)).location[2] = 0.13
        return 1, 1, 0.5
    return f


SPRITES = {
    **{f"ship_{k}": in_dock(fn) for k, fn in {**CARGO, **WAR}.items()},
    "ship_c0": dock_blocks(2, False), "ship_c1": dock_blocks(3, False), "ship_c2": dock_hull(False, False), "ship_c3": dock_hull(False, True),
    "ship_w0": dock_blocks(2, True), "ship_w1": dock_blocks(3, True), "ship_w2": dock_hull(True, False), "ship_w3": dock_hull(True, True),
    **{f"war_{k}": at_pier(fn) for k, fn in WAR.items()},
    "crew_welder": person("navy", "torch", 1.25), "crew_fitter": person("green", "hammer", 1.25),
    "crew_piper": person("wood", "pipe", 1.25), "crew_safety": person("yel", "flag", 1.25),
    "crew_forklift": machine(lambda: forklift_model(True), rz=-0.6, scale=1.15),
    "crew_transporter": machine(transporter_model, rz=-0.5, scale=1.0, z=0.6),
    "crew_crane": machine(crane_model, rz=-0.5, scale=1.25, z=1.5),
    **{f"lift_{d}": machine(lambda: forklift_model(True), rz=a, scale=1.15) for d, a in DIRS.items()},
    "scrap_pipe": scrap("pipe"), "scrap_plate": scrap("plate"), "scrap_drum": scrap("drum"),
}
