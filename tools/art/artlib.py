"""조선소 그림 만들기 공통 도구 (Blender 파이썬 모듈 bpy).

게임 칸 (x, y) 는 Blender (X = x, Y = -y) 에 놓는다. 건물은 발자국이 X 0..w, Y -h..0 이 되게 만든다.
카메라는 게임 지도와 같은 각도(가로 2 : 세로 1 마름모 칸)로 고정.
"""
import bpy, bmesh, math, random
from mathutils import Vector

CELL_PX = 128                      # 한 칸의 가로 폭(px)
S = CELL_PX / math.sqrt(2)         # Blender 1 단위가 화면에서 몇 px 인가
RX, RZ = math.radians(60), math.radians(45)
SUN_RX = math.radians(34)          # 해 높이 (작을수록 그림자가 짧음)

col = None
_m = {}


def reset():
    global col
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _m.clear()
    col = bpy.context.scene.collection


def hexc(h):
    h = h.lstrip("#")
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))


def mat(name, color, rough=0.6, metal=0.0, emit=0.0, noise=0.0):
    if name in _m:
        return _m[name]
    rgb = hexc(color) if isinstance(color, str) else color
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*rgb, 1)
        b.inputs["Emission Strength"].default_value = emit
    if noise:
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = noise
        n.inputs["Detail"].default_value = 6
        mix = nt.nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MULTIPLY"
        mix.inputs["Fac"].default_value = 0.3
        mix.inputs["Color1"].default_value = (*rgb, 1)
        nt.links.new(n.outputs["Fac"], mix.inputs["Color2"])
        nt.links.new(mix.outputs["Color"], b.inputs["Base Color"])
    _m[name] = m
    return m


def M(name):
    """자주 쓰는 색 (밝고 단순한 화풍)"""
    table = {
        "conc": ("#B9B4A8", 0.9, 0, 0, 3), "conc2": ("#A29D91", 0.9, 0, 0, 5), "asph": ("#5E6570", 0.85, 0, 0, 6),
        "yel": ("#F4B81F", 0.5), "white": ("#F2F1EC", 0.5), "navy": ("#24487E", 0.45), "blue": ("#3F7FC4", 0.4),
        "glass": ("#7FD0F2", 0.08, 0.3), "orange": ("#E8642A", 0.45), "red": ("#C8382E", 0.5),
        "oxide": ("#9A4A36", 0.7, 0, 0, 8), "steel": ("#8E9AA8", 0.35, 0.8), "dark": ("#2E3540", 0.6),
        "roof": ("#5F7FA3", 0.4, 0.4), "wood": ("#8A6A47", 0.8), "green": ("#2E9D5B", 0.5),
        "tree": ("#3F8F45", 0.9), "tree2": ("#57A851", 0.9), "smoke": ("#F4F4F4", 1.0), "skin": ("#F0C29A", 0.7),
        "water": ("#2C8FD0", 0.1), "purple": ("#7A5FB0", 0.5),
    }
    if name == "spark":
        return mat("spark", (1.0, 0.55, 0.12), emit=40)
    if name == "lamp":
        return mat("lamp", (1.0, 0.9, 0.6), emit=6)
    return mat(name, *table[name])


def add(obj, m=None, bevel=0.0, smooth=False):
    col.objects.link(obj)
    if m:
        obj.data.materials.append(m if not isinstance(m, str) else M(m))
    if bevel:
        md = obj.modifiers.new("b", "BEVEL")
        md.width = bevel
        md.segments = 2
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def box(x, y, z, sx, sy, sz, m, bevel=0.03, rot=0.0):
    """바닥 가운데가 (x, y, z) 인 상자"""
    me = bpy.data.meshes.new("box")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("box", me)
    o.scale = (sx, sy, sz)
    o.location = (x, y, z + sz / 2)
    o.rotation_euler[2] = rot
    return add(o, m, bevel)


def cyl(x, y, z, r, h, m, seg=24, r2=None, rot=None):
    me = bpy.data.meshes.new("cyl")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("cyl", me)
    o.location = (x, y, z + h / 2)
    if rot:
        o.rotation_euler = rot
    return add(o, m, smooth=True)


def ball(x, y, z, r, m, sz=1.0):
    me = bpy.data.meshes.new("ball")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=r)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("ball", me)
    o.location = (x, y, z)
    o.scale = (1, 1, sz)
    return add(o, m, smooth=True)


def wedge(x0, x1, y0, y1, z0, z1, m, bevel=0.02):
    """톱니 지붕 한 조각: x0 쪽이 높고(z1) x1 쪽이 낮은(z0) 삼각 기둥"""
    me = bpy.data.meshes.new("wedge")
    bm = bmesh.new()
    a = [bm.verts.new(p) for p in ((x0, y0, z0), (x1, y0, z0), (x0, y0, z1))]
    c = [bm.verts.new(p) for p in ((x0, y1, z0), (x1, y1, z0), (x0, y1, z1))]
    bm.faces.new(a)
    bm.faces.new(list(reversed(c)))
    for k in range(3):
        bm.faces.new((a[k], c[k], c[(k + 1) % 3], a[(k + 1) % 3]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return add(bpy.data.objects.new("wedge", me), m, bevel)


def hazard(x, y, sx, sy, t=0.06):
    """바닥의 노란 안전선 네모"""
    for (px, py, wx, wy) in ((x, y - sy / 2, sx, t), (x, y + sy / 2, sx, t), (x - sx / 2, y, t, sy), (x + sx / 2, y, t, sy)):
        box(px, py, 0.004, wx, wy, 0.004, "yel", 0)


def worker(x, y, z=0.0, body="navy"):
    cyl(x, y, z, 0.07, 0.2, body, 10)
    ball(x, y, z + 0.27, 0.065, "skin")
    ball(x, y, z + 0.31, 0.075, "yel", 0.6)


def render(path, w, h, max_z, samples=64, pad=40):
    """발자국 w×h 칸(높이 max_z)인 물체를 배경 없이 그린다. 돌려주는 값 = 그림 크기와 기준점(px).

    기준점 (ax, ay) = 발자국의 뒤쪽 꼭짓점(게임 칸 x, y)이 그림에서 놓이는 자리.
    """
    sc = bpy.context.scene
    reach = int(max_z * math.tan(SUN_RX) * S) + 8          # 그림자가 뻗는 거리(px)
    left = pad
    right = pad + reach
    top = pad + int(max_z * math.cos(math.radians(30)) * S)
    bottom = pad
    half = CELL_PX / 2
    pw = int(left + (w + h) * half + right)
    ph = int(top + (w + h) * half / 2 + bottom)
    ax, ay = left + h * half, top
    # 그림 가운데가 가리키는 땅 위의 점
    u, v = pw / 2 - ax, ph / 2 - ay
    a, b = u / (S * math.sqrt(0.5)), v / (S * math.sqrt(0.5) * 0.5)
    target = Vector(((a + b) / 2, (a - b) / 2, 0))

    plane = box(0, 0, -0.02, 60, 60, 0.02, "conc", 0)
    plane.is_shadow_catcher = True
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.2
    sun.angle = math.radians(6)
    sun.color = (1, 0.96, 0.88)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (SUN_RX, 0, math.radians(-25))
    col.objects.link(so)
    wd = bpy.data.worlds.new("w")
    wd.use_nodes = True
    wd.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.75, 1.0, 1)
    wd.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    sc.world = wd

    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    cam.ortho_scale = max(pw, ph) / S
    co = bpy.data.objects.new("cam", cam)
    co.rotation_euler = (RX, 0, RZ)
    d = Vector((math.sin(RX) * math.sin(RZ), -math.sin(RX) * math.cos(RZ), math.cos(RX)))
    co.location = target + d * 60
    col.objects.link(co)
    sc.camera = co

    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.render.film_transparent = True
    sc.render.resolution_x, sc.render.resolution_y = pw, ph
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Standard"
    try:
        sc.view_settings.look = "Medium High Contrast"
    except Exception:
        pass
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    # 그림자 받이 판이 남기는 아주 옅은 막(알파 3% 아래)을 지워 그림 둘레가 깨끗하게
    import numpy as np
    img = bpy.data.images.load(path)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    a = np.clip((px[:, 3] - 0.03) / 0.97, 0, 1)
    px[:, 3] = a
    img.pixels = px.ravel()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return {"w": w, "h": h, "pw": pw, "ph": ph, "ax": round(ax, 1), "ay": round(ay, 1)}
