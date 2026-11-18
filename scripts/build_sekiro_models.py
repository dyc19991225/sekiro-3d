import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix, Euler

OUT_DIR = r"e:\ai\sekiro-3d\public\models"
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_lin(c):
    return pow(c / 255.0, 2.2)


def make_mat(name, hex_rgb, metallic=0.0, roughness=0.55, emission_hex=None, emission_strength=0.0):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    r = srgb_to_lin((hex_rgb >> 16) & 0xFF)
    g = srgb_to_lin((hex_rgb >> 8) & 0xFF)
    b = srgb_to_lin(hex_rgb & 0xFF)
    bsdf.inputs['Base Color'].default_value = (r, g, b, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission_hex is not None and emission_strength > 0.0:
        er = srgb_to_lin((emission_hex >> 16) & 0xFF)
        eg = srgb_to_lin((emission_hex >> 8) & 0xFF)
        eb = srgb_to_lin(emission_hex & 0xFF)
        if 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = (er, eg, eb, 1.0)
            bsdf.inputs['Emission Strength'].default_value = emission_strength
    return mat


def ensure_box_uvs(mesh, scale=1.6):
    while len(mesh.uv_layers) > 0:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    uv_layer = mesh.uv_layers.new(name="UVMap")
    verts = mesh.vertices
    loops = mesh.loops
    for poly in mesh.polygons:
        nx, ny, nz = abs(poly.normal.x), abs(poly.normal.y), abs(poly.normal.z)
        for li in poly.loop_indices:
            co = verts[loops[li].vertex_index].co
            if nx >= ny and nx >= nz:
                u, v = co.y * scale, co.z * scale
            elif ny >= nx and ny >= nz:
                u, v = co.x * scale, co.z * scale
            else:
                u, v = co.x * scale, co.y * scale
            uv_layer.data[li].uv = (u + 0.5, v + 0.5)


def make_empty(name, parent=None, loc=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def bm_to_obj(name, bm, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), smooth=True, uv_scale=1.6):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name + "_mesh")
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = smooth
    ensure_box_uvs(mesh, scale=uv_scale)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def add_lofted_tube(name, sections, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), segs=12, smooth=True, cap=True, uv_scale=1.8):
    """
    sections: list of (z, rx, ry, ox, oy) where ox, oy are local X/Y center offsets at height z.
    """
    bm = bmesh.new()
    rings = []
    for (z, rx, ry, ox, oy) in sections:
        ring = []
        for i in range(segs):
            ang = (i / segs) * math.tau
            x = ox + math.cos(ang) * rx
            y = oy + math.sin(ang) * ry
            ring.append(bm.verts.new((x, y, z)))
        rings.append(ring)
    for r_idx in range(len(rings) - 1):
        r0 = rings[r_idx]
        r1 = rings[r_idx + 1]
        for i in range(segs):
            ni = (i + 1) % segs
            bm.faces.new((r0[i], r0[ni], r1[ni], r1[i]))
    if cap and len(rings) >= 2:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return bm_to_obj(name, bm, mat, parent=parent, loc=loc, rot=rot, smooth=smooth, uv_scale=uv_scale)


def add_box(name, sx, sy, sz, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, smooth=False, uv_scale=1.5):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    if bevel > 0.0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect='EDGES')
    return bm_to_obj(name, bm, mat, parent=parent, loc=loc, rot=rot, smooth=smooth, uv_scale=uv_scale)


def add_sphere(name, rx, ry, rz, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), u_segs=16, v_segs=12, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u_segs, v_segments=v_segs, radius=1.0)
    bmesh.ops.scale(bm, vec=(rx, ry, rz), verts=bm.verts)
    return bm_to_obj(name, bm, mat, parent=parent, loc=loc, rot=rot, smooth=smooth)


def add_katana_blade(name, length, width, curve, thickness, mat_blade, mat_spine, parent=None, loc=(0, 0, 0), rot=(0, 0, 0)):
    """
    Creates a curved Japanese katana blade extending along +Z_blender.
    Cutting edge faces -Y_blender (+Z_three forward!), spine faces +Y_blender (-Z_three back).
    """
    grp = make_empty(name, parent=parent, loc=loc, rot=rot)
    # Sharp diamond-wedge cross-section along Z
    bm = bmesh.new()
    steps = 16
    rings = []
    for s in range(steps + 1):
        t = s / steps
        z = t * length
        # Sori curvature bends backward (+Y_blender) as t grows
        sori = curve * (t * t)
        # Kissaki taper near tip
        w_scale = 1.0 - 0.18 * t if t < 0.86 else max(0.04, (1.0 - t) / 0.14 * 0.82)
        th_scale = 1.0 - 0.35 * t if t < 0.88 else max(0.05, (1.0 - t) / 0.12 * 0.65)
        w = width * w_scale
        th = thickness * th_scale
        # 4-vert katana profile: Edge (-Y), Right Ridge (-X), Spine (+Y), Left Ridge (+X)
        v_edge = bm.verts.new((0.0, sori - w * 0.62, z))
        v_r = bm.verts.new((-th * 0.5, sori + w * 0.10, z))
        v_spine = bm.verts.new((0.0, sori + w * 0.38, z))
        v_l = bm.verts.new((th * 0.5, sori + w * 0.10, z))
        rings.append((v_edge, v_r, v_spine, v_l))
    for s in range(steps):
        r0 = rings[s]
        r1 = rings[s + 1]
        for i in range(4):
            ni = (i + 1) % 4
            bm.faces.new((r0[i], r0[ni], r1[ni], r1[i]))
    bm.faces.new(list(reversed(rings[0])))
    # Tip point
    tip_v = bm.verts.new((0.0, curve * 1.02 - width * 0.08, length + 0.025))
    for i in range(4):
        ni = (i + 1) % 4
        bm.faces.new((rings[-1][i], rings[-1][ni], tip_v))
    bm_to_obj(name + "_Steel", bm, mat_blade, parent=grp, smooth=False, uv_scale=2.2)
    return grp


def export_glb(filepath):
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        export_yup=True,
        export_apply=False,
        export_materials='EXPORT',
    )
    print(f"[Exported] {filepath} ({os.path.getsize(filepath)} bytes)")


# ==============================================================================
# 1. SHINOBI WOLF ("狼" - One-Armed Shinobi Protagonist)
# ==============================================================================
def build_shinobi_wolf():
    clear_scene()
    m_haori = make_mat("MAT_Haori", 0xC85A1E, metallic=0.02, roughness=0.82)
    m_gi = make_mat("MAT_ShinobiIndigo", 0x1E2533, metallic=0.05, roughness=0.78)
    m_scarf = make_mat("MAT_ScarfCloth", 0x2B3242, metallic=0.02, roughness=0.85)
    m_skin = make_mat("MAT_ShinobiSkin", 0xCFA88A, metallic=0.0, roughness=0.62)
    m_ash_mark = make_mat("MAT_DragonrotAsh", 0xD8D8DE, metallic=0.0, roughness=0.75)
    m_hair = make_mat("MAT_WolfHair", 0x18171A, metallic=0.08, roughness=0.58)
    m_iron = make_mat("MAT_DarkIron", 0x2A2D32, metallic=0.84, roughness=0.36)
    m_brass = make_mat("MAT_AgedBrass", 0x9E7B38, metallic=0.82, roughness=0.34)
    m_rope = make_mat("MAT_HempRope", 0x9F8A63, metallic=0.0, roughness=0.88)
    m_crimson = make_mat("MAT_MortalCrimson", 0x7A1218, metallic=0.35, roughness=0.40)
    m_lacquer = make_mat("MAT_BlackLacquer", 0x151518, metallic=0.45, roughness=0.25)

    root = make_empty("CHAR_Root", loc=(0, 0, 0))
    pelvis = make_empty("JNT_Pelvis", parent=root, loc=(0, 0, 0.94))
    torso = make_empty("JNT_Torso", parent=pelvis, loc=(0, 0, 0.06))
    head = make_empty("JNT_Head", parent=torso, loc=(0, 0, 0.52))

    # Pelvis & Obi sash + Haori lower coat tails
    add_lofted_tube("Wolf_PelvisBlock", [
        (-0.10, 0.16, 0.12, 0, 0),
        (0.04, 0.17, 0.13, 0, 0),
        (0.11, 0.16, 0.12, 0, 0),
    ], m_gi, parent=pelvis, segs=12)
    # Rope Obi belt & Healing Gourd on right-back hip
    add_lofted_tube("Wolf_ObiBelt", [
        (0.02, 0.185, 0.145, 0, 0),
        (0.09, 0.185, 0.145, 0, 0),
    ], m_rope, parent=pelvis, segs=14)
    add_lofted_tube("Wolf_HealingGourd", [
        (-0.08, 0.02, 0.02, 0, 0),
        (-0.04, 0.055, 0.055, 0, 0),
        (0.01, 0.028, 0.028, 0, 0),
        (0.05, 0.042, 0.042, 0, 0),
        (0.09, 0.015, 0.015, 0, 0),
    ], m_brass, parent=pelvis, loc=(-0.18, 0.08, -0.02), rot=(0.2, 0, -0.25), segs=10)

    # Flared ochre haori coat skirt around hips
    coat_skirt = make_empty("JNT_Cape", parent=pelvis, loc=(0, 0, 0.03))
    add_lofted_tube("Wolf_HaoriSkirt", [
        (-0.34, 0.25, 0.19, 0, 0.03),
        (-0.16, 0.22, 0.16, 0, 0.015),
        (0.0, 0.18, 0.135, 0, 0),
    ], m_haori, parent=coat_skirt, segs=14, cap=False)

    # Torso: Indigo inner shinobi gi + Ochre sleeveless haori vest
    add_lofted_tube("Wolf_InnerTorso", [
        (0.0, 0.155, 0.115, 0, 0),
        (0.22, 0.18, 0.13, 0, -0.01),
        (0.42, 0.205, 0.135, 0, -0.01),
        (0.50, 0.13, 0.10, 0, 0),
    ], m_gi, parent=torso, segs=14)
    add_lofted_tube("Wolf_OchreHaori", [
        (-0.02, 0.175, 0.132, 0, 0.005),
        (0.20, 0.198, 0.145, 0, 0.0),
        (0.41, 0.225, 0.15, 0, 0.0),
        (0.46, 0.17, 0.125, 0, 0.01),
    ], m_haori, parent=torso, segs=14)
    # Crossed chest strap (for Mortal Blade scabbard)
    add_box("Wolf_ChestStrap", 0.045, 0.31, 0.50, m_lacquer, parent=torso, loc=(0, 0, 0.24), rot=(0, 0.62, 0), bevel=0.008)

    # Scarf collar & flowing scarf tail
    add_lofted_tube("Wolf_ScarfCollar", [
        (0.41, 0.155, 0.145, 0, -0.01),
        (0.51, 0.14, 0.135, 0, -0.01),
    ], m_scarf, parent=torso, segs=14)
    scarf_tail = make_empty("JNT_ScarfTail", parent=torso, loc=(0.04, 0.13, 0.46))
    add_box("Wolf_ScarfBanner", 0.09, 0.025, 0.44, m_scarf, parent=scarf_tail, loc=(0, 0.06, -0.20), rot=(0.28, 0, 0.08), bevel=0.005, smooth=True)

    # Kusabimaru Saya (Left Hip Scabbard)
    add_lofted_tube("Wolf_KusabimaruSaya", [
        (0.0, 0.016, 0.026, 0, 0),
        (0.48, 0.015, 0.024, 0, 0.02),
        (0.92, 0.012, 0.018, 0, 0.06),
    ], m_lacquer, parent=pelvis, loc=(0.19, 0.04, 0.02), rot=(-1.12, 0.12, -0.15), segs=8)

    # Mortal Blade Fushigiri Crimson Scabbard on Back!
    back_mortal = make_empty("JNT_BackMortalSaya", parent=torso, loc=(0.06, 0.16, 0.28))
    add_lofted_tube("Wolf_MortalSaya", [
        (-0.52, 0.018, 0.032, 0, 0.04),
        (0.0, 0.020, 0.035, 0, 0.01),
        (0.56, 0.021, 0.036, 0, 0.0),
    ], m_crimson, parent=back_mortal, rot=(0.12, -0.58, 0.05), segs=8)
    # Mortal Blade Hilt sticking above right shoulder when sheathed
    mortal_sheathed_hilt = make_empty("VIS_MortalSheathedHilt", parent=back_mortal, loc=(-0.31, -0.04, 0.47), rot=(0.12, -0.58, 0.05))
    add_sphere("Wolf_MortalTsuba", 0.055, 0.055, 0.014, m_iron, parent=mortal_sheathed_hilt, loc=(0, 0, 0))
    add_lofted_tube("Wolf_MortalGripSheathed", [
        (0.0, 0.016, 0.024, 0, 0),
        (0.28, 0.017, 0.025, 0, 0),
    ], m_crimson, parent=mortal_sheathed_hilt, segs=8)

    # Head: Sculpted Shinobi Face, White Brow Scar, Topknot Ponytail
    add_lofted_tube("Wolf_Neck", [
        (-0.04, 0.058, 0.058, 0, 0),
        (0.06, 0.054, 0.054, 0, 0),
    ], m_skin, parent=head, segs=10)
    add_sphere("Wolf_HeadSkull", 0.102, 0.118, 0.128, m_skin, parent=head, loc=(0, -0.01, 0.13))
    # Hair cap & bangs
    add_sphere("Wolf_HairCap", 0.108, 0.124, 0.125, m_hair, parent=head, loc=(0, 0.012, 0.148))
    # White Dragon-heritage streak on right temple/bangs (-X side)
    add_box("Wolf_WhiteStreak", 0.038, 0.055, 0.075, m_ash_mark, parent=head, loc=(-0.072, -0.088, 0.165), rot=(0.2, 0.25, -0.15), bevel=0.01, smooth=True)
    # Eyes (dark intense brow + pupils facing -Y_blender)
    add_box("Wolf_BrowL", 0.036, 0.018, 0.010, m_hair, parent=head, loc=(0.042, -0.112, 0.148), rot=(0, -0.15, 0))
    add_box("Wolf_BrowR", 0.036, 0.018, 0.010, m_hair, parent=head, loc=(-0.042, -0.112, 0.148), rot=(0, 0.15, 0))
    # Ponytail pivot
    ponytail = make_empty("JNT_Ponytail", parent=head, loc=(0, 0.105, 0.20))
    add_lofted_tube("Wolf_TopknotTie", [
        (0.0, 0.025, 0.025, 0, 0),
        (0.04, 0.022, 0.022, 0, 0.01),
    ], m_rope, parent=ponytail, rot=(-0.9, 0, 0), segs=8)
    add_lofted_tube("Wolf_PonytailHair", [
        (0.03, 0.038, 0.034, 0, 0),
        (0.14, 0.046, 0.040, 0, 0.02),
        (0.28, 0.028, 0.024, 0, 0.05),
        (0.36, 0.006, 0.006, 0, 0.07),
    ], m_hair, parent=ponytail, rot=(-1.25, 0, 0), segs=10)
    add_box("Wolf_PonytailSilver", 0.018, 0.018, 0.22, m_ash_mark, parent=ponytail, loc=(-0.02, 0.15, -0.04), rot=(-1.25, 0, 0), bevel=0.005, smooth=True)

    # RIGHT ARM (-X_blender): Sword Arm
    sh_r = make_empty("JNT_ShoulderR", parent=torso, loc=(-0.22, 0, 0.41))
    add_lofted_tube("Wolf_UpperArmR", [
        (-0.26, 0.055, 0.055, 0, 0),
        (-0.08, 0.072, 0.072, 0, 0),
        (0.03, 0.068, 0.068, 0, 0),
    ], m_gi, parent=sh_r, segs=10)
    add_lofted_tube("Wolf_HaoriShoulderR", [
        (-0.12, 0.082, 0.082, 0, 0),
        (0.04, 0.078, 0.078, 0, 0),
    ], m_haori, parent=sh_r, segs=10)

    el_r = make_empty("JNT_ElbowR", parent=sh_r, loc=(0, 0, -0.26))
    add_lofted_tube("Wolf_ForearmR", [
        (-0.23, 0.042, 0.042, 0, 0),
        (-0.05, 0.052, 0.052, 0, 0),
        (0.01, 0.054, 0.054, 0, 0),
    ], m_iron, parent=el_r, segs=10)
    add_lofted_tube("Wolf_ForearmWrapR", [
        (-0.20, 0.045, 0.045, 0, 0),
        (-0.08, 0.050, 0.050, 0, 0),
    ], m_rope, parent=el_r, segs=10)

    hand_r = make_empty("JNT_HandR", parent=el_r, loc=(0, 0, -0.24))
    add_box("Wolf_FistR", 0.065, 0.078, 0.075, m_skin, parent=hand_r, loc=(0, -0.01, -0.03), bevel=0.012, smooth=True)
    # WeaponSocketR: local +Z_blender (+Y_three) points forward (-Y_blender / +Z_three) when rotated +90 deg around X in Blender (-90 deg? Wait:
    # Let's keep WeaponSocketR at ZERO rotation in Blender so in Three.js we control WeaponSocketR.rotation explicitly and unmistakably!
    make_empty("SOCKET_WeaponR", parent=hand_r, loc=(0, -0.02, -0.04))

    # LEFT ARM (+X_blender): SHINOBI PROSTHETIC ARM (忍义手)!
    sh_l = make_empty("JNT_ShoulderL", parent=torso, loc=(0.22, 0, 0.41))
    add_lofted_tube("Wolf_UpperArmL", [
        (-0.22, 0.050, 0.050, 0, 0),
        (-0.06, 0.070, 0.070, 0, 0),
        (0.03, 0.066, 0.066, 0, 0),
    ], m_gi, parent=sh_l, segs=10)
    add_lofted_tube("Wolf_RopeBandUpperL", [
        (-0.25, 0.054, 0.054, 0, 0),
        (-0.18, 0.056, 0.056, 0, 0),
    ], m_rope, parent=sh_l, segs=10)

    el_l = make_empty("JNT_ElbowL", parent=sh_l, loc=(0, 0, -0.26))
    # Skeletal Mechanical Shinobi Prosthetic Forearm: central bone rod + twin brass hydraulic rods + shuriken launcher wheel + rope wrap!
    add_sphere("Wolf_ProstheticJoint", 0.048, 0.048, 0.048, m_brass, parent=el_l, loc=(0, 0, 0))
    add_lofted_tube("Wolf_ProstheticCoreBone", [
        (-0.23, 0.022, 0.022, 0, 0),
        (0.0, 0.026, 0.026, 0, 0),
    ], m_iron, parent=el_l, segs=8)
    add_box("Wolf_ProstheticRodA", 0.016, 0.016, 0.21, m_brass, parent=el_l, loc=(0.026, -0.02, -0.115), bevel=0.003)
    add_box("Wolf_ProstheticRodB", 0.016, 0.016, 0.21, m_brass, parent=el_l, loc=(-0.024, 0.02, -0.115), bevel=0.003)
    # Shuriken wheel launcher ring near wrist
    add_lofted_tube("Wolf_ShurikenLauncherRing", [
        (-0.20, 0.050, 0.050, 0, 0),
        (-0.15, 0.052, 0.052, 0, 0),
    ], m_iron, parent=el_l, segs=12)
    add_lofted_tube("Wolf_ProstheticRope", [
        (-0.14, 0.044, 0.044, 0, 0),
        (-0.08, 0.046, 0.046, 0, 0),
    ], m_rope, parent=el_l, segs=10)

    hand_l = make_empty("JNT_HandL", parent=el_l, loc=(0, 0, -0.24))
    add_box("Wolf_ProstheticHand", 0.058, 0.072, 0.075, m_iron, parent=hand_l, loc=(0, -0.01, -0.03), bevel=0.01)
    add_box("Wolf_ProstheticKnuckles", 0.062, 0.025, 0.025, m_brass, parent=hand_l, loc=(0, -0.035, -0.055), bevel=0.004)
    make_empty("SOCKET_WeaponL", parent=hand_l, loc=(0, -0.02, -0.04))

    # LEGS: Billowing Tattsuke-Bakama Shinobi Trousers + Kyahan Shin Wraps + Sandals
    for side, sx in (("L", 0.11), ("R", -0.11)):
        hip = make_empty(f"JNT_Hip{side}", parent=pelvis, loc=(sx, 0, -0.06))
        add_lofted_tube(f"Wolf_ThighHakama{side}", [
            (-0.42, 0.072, 0.072, 0, 0),
            (-0.26, 0.112, 0.115, 0, -0.005),
            (-0.10, 0.118, 0.118, 0, 0),
            (0.03, 0.098, 0.098, 0, 0),
        ], m_gi, parent=hip, segs=12)

        knee = make_empty(f"JNT_Knee{side}", parent=hip, loc=(0, 0, -0.43))
        add_lofted_tube(f"Wolf_ShinWrap{side}", [
            (-0.39, 0.044, 0.046, 0, 0),
            (-0.20, 0.058, 0.060, 0, 0.005),
            (0.0, 0.066, 0.066, 0, 0),
        ], m_rope, parent=knee, segs=10)
        add_box(f"Wolf_ShinPlate{side}", 0.062, 0.035, 0.26, m_iron, parent=knee, loc=(0, -0.042, -0.19), bevel=0.008, smooth=True)

        foot = make_empty(f"JNT_Foot{side}", parent=knee, loc=(0, 0, -0.40))
        add_box(f"Wolf_TabiFoot{side}", 0.088, 0.21, 0.065, m_ash_mark, parent=foot, loc=(0, -0.045, -0.02), bevel=0.015, smooth=True)
        add_box(f"Wolf_WarajiSole{side}", 0.096, 0.225, 0.022, m_rope, parent=foot, loc=(0, -0.045, -0.048), bevel=0.006)

    export_glb(os.path.join(OUT_DIR, "shinobi_wolf.glb"))


# ==============================================================================
# 2. BOSS 1: GENICHIRO ASHINA ("苇名弦一郎" + Way of Tomoe Phase 3 Toggle)
# ==============================================================================
def build_boss_genichiro():
    clear_scene()
    m_armor = make_mat("MAT_YoroiArmor", 0x262428, metallic=0.62, roughness=0.38)
    m_gold = make_mat("MAT_AshinaGold", 0xC99E3A, metallic=0.88, roughness=0.26)
    m_crimson = make_mat("MAT_AshinaCrimson", 0x7E191E, metallic=0.12, roughness=0.72)
    m_cape = make_mat("MAT_TatteredCape", 0x3A1E24, metallic=0.04, roughness=0.86)
    m_skin = make_mat("MAT_BossSkin", 0xC49E82, metallic=0.0, roughness=0.58)
    m_tomoe_scar = make_mat("MAT_TomoeLightningScar", 0xFFD452, metallic=0.2, roughness=0.3, emission_hex=0xFFAA22, emission_strength=2.8)
    m_cloth = make_mat("MAT_SamuraiCloth", 0x1D222E, metallic=0.05, roughness=0.78)
    m_hair = make_mat("MAT_WolfHair", 0x151418, metallic=0.08, roughness=0.55)
    m_wood = make_mat("MAT_BowLacquer", 0x4A1818, metallic=0.35, roughness=0.36)

    root = make_empty("CHAR_Root", loc=(0, 0, 0))
    pelvis = make_empty("JNT_Pelvis", parent=root, loc=(0, 0, 1.04))
    torso = make_empty("JNT_Torso", parent=pelvis, loc=(0, 0, 0.07))
    head = make_empty("JNT_Head", parent=torso, loc=(0, 0, 0.57))

    # Pelvis & Kusazuri Armored Tassets
    add_lofted_tube("Gen_PelvisCore", [
        (-0.12, 0.19, 0.14, 0, 0),
        (0.08, 0.20, 0.15, 0, 0),
    ], m_cloth, parent=pelvis, segs=12)
    # 4 Kusazuri Armored Skirt Plates (Front, Back, Left, Right)
    add_box("Gen_KusazuriF", 0.28, 0.035, 0.28, m_armor, parent=pelvis, loc=(0, -0.155, -0.13), rot=(-0.18, 0, 0), bevel=0.008)
    add_box("Gen_KusazuriB", 0.30, 0.035, 0.30, m_armor, parent=pelvis, loc=(0, 0.155, -0.14), rot=(0.20, 0, 0), bevel=0.008)
    add_box("Gen_KusazuriL", 0.035, 0.24, 0.29, m_armor, parent=pelvis, loc=(0.195, 0, -0.13), rot=(0, -0.22, 0), bevel=0.008)
    add_box("Gen_KusazuriR", 0.035, 0.24, 0.29, m_armor, parent=pelvis, loc=(-0.195, 0, -0.13), rot=(0, 0.22, 0), bevel=0.008)
    add_lofted_tube("Gen_GoldObi", [
        (0.01, 0.21, 0.16, 0, 0),
        (0.08, 0.21, 0.16, 0, 0),
    ], m_gold, parent=pelvis, segs=14)

    # Inner Muscular Scarred Torso (visible when Phase 3 Way of Tomoe sheds outer yoroi!)
    add_lofted_tube("Gen_InnerChest", [
        (0.0, 0.175, 0.13, 0, 0),
        (0.26, 0.215, 0.15, 0, -0.01),
        (0.46, 0.23, 0.155, 0, -0.01),
        (0.55, 0.14, 0.11, 0, 0),
    ], m_skin, parent=torso, segs=14)
    # Glowing Way of Tomoe Lightning Scars across chest & back (revealed in Phase 3!)
    tomoe_scars = make_empty("VIS_TomoeScars", parent=torso, loc=(0, 0, 0))
    add_box("Gen_LightningScar1", 0.025, 0.31, 0.42, m_tomoe_scar, parent=tomoe_scars, loc=(-0.06, -0.02, 0.28), rot=(0, 0.55, 0.08), bevel=0.006)
    add_box("Gen_LightningScar2", 0.018, 0.29, 0.32, m_tomoe_scar, parent=tomoe_scars, loc=(0.08, -0.02, 0.24), rot=(0, -0.45, -0.05), bevel=0.005)

    # Outer Sengoku Do-Maru Yoroi Armor & Cape (hidden in Phase 3!)
    outer_armor = make_empty("VIS_OuterArmor", parent=torso, loc=(0, 0, 0))
    add_lofted_tube("Gen_DoMaruCuirass", [
        (-0.02, 0.20, 0.155, 0, 0),
        (0.24, 0.235, 0.17, 0, -0.008),
        (0.45, 0.25, 0.175, 0, -0.008),
        (0.50, 0.19, 0.14, 0, 0),
    ], m_armor, parent=outer_armor, segs=14)
    add_box("Gen_ChestGoldCrest", 0.16, 0.025, 0.16, m_gold, parent=outer_armor, loc=(0, -0.172, 0.31), bevel=0.006)

    # Flowing Tattered Ashina Cape
    cape = make_empty("JNT_Cape", parent=torso, loc=(0, 0.16, 0.48))
    add_lofted_tube("Gen_AshinaCape", [
        (-0.98, 0.36, 0.04, 0, 0.16),
        (-0.52, 0.30, 0.035, 0, 0.09),
        (-0.15, 0.25, 0.03, 0, 0.03),
        (0.0, 0.22, 0.025, 0, 0),
    ], m_cape, parent=cape, segs=12)

    # Slung Greatbow on Back
    back_bow = make_empty("VIS_BackBow", parent=torso, loc=(0.05, 0.21, 0.28), rot=(0.08, 0.52, 0))
    add_lofted_tube("Gen_BackBowLimb", [
        (-0.82, 0.012, 0.018, 0, 0.12),
        (-0.35, 0.018, 0.024, 0, 0.02),
        (0.0, 0.022, 0.028, 0, -0.02),
        (0.45, 0.018, 0.024, 0, 0.03),
        (0.92, 0.012, 0.018, 0, 0.15),
    ], m_wood, parent=back_bow, segs=8)

    # Head: Fierce Face + Iconic Crescent-Horned Ashina Kabuto Helmet!
    add_sphere("Gen_HeadFace", 0.108, 0.122, 0.132, m_skin, parent=head, loc=(0, -0.01, 0.14))
    add_lofted_tube("Gen_LongHairBack", [
        (-0.18, 0.12, 0.06, 0, 0.08),
        (0.02, 0.115, 0.08, 0, 0.05),
        (0.14, 0.11, 0.10, 0, 0.03),
    ], m_hair, parent=head, segs=10)
    # Kabuto Dome & Shikoro Neck Guard
    add_sphere("Gen_KabutoBowl", 0.132, 0.148, 0.125, m_armor, parent=head, loc=(0, 0.005, 0.185))
    add_lofted_tube("Gen_ShikoroNeckGuard", [
        (0.04, 0.185, 0.175, 0, 0.04),
        (0.14, 0.145, 0.15, 0, 0.02),
    ], m_armor, parent=head, segs=12, cap=False)
    # Sweeping Golden Crescent Maedate Horns!
    for sgn in (-1.0, 1.0):
        add_lofted_tube(f"Gen_MaedateHorn_{'L' if sgn > 0 else 'R'}", [
            (0.0, 0.022, 0.012, 0, 0),
            (0.14, 0.028, 0.010, sgn * 0.09, -0.01),
            (0.30, 0.020, 0.008, sgn * 0.19, -0.015),
            (0.44, 0.005, 0.004, sgn * 0.25, -0.02),
        ], m_gold, parent=head, loc=(0, -0.135, 0.21), segs=8)
    add_sphere("Gen_MaedateSunDisc", 0.042, 0.015, 0.042, m_gold, parent=head, loc=(0, -0.145, 0.22))

    # ARMS with Sengoku O-Sode Shoulder Pauldrons
    for side, sx in (("L", 0.25), ("R", -0.25)):
        sh = make_empty(f"JNT_Shoulder{side}", parent=torso, loc=(sx, 0, 0.45))
        # Layered O-Sode shoulder armor plate
        sgn = 1.0 if side == "L" else -1.0
        add_box(f"Gen_OSode{side}", 0.04, 0.22, 0.25, m_armor, parent=sh, loc=(sgn * 0.075, 0, -0.06), rot=(0, -sgn * 0.28, 0), bevel=0.008)
        add_box(f"Gen_OSodeTrim{side}", 0.044, 0.225, 0.03, m_gold, parent=sh, loc=(sgn * 0.088, 0, -0.17), rot=(0, -sgn * 0.28, 0), bevel=0.004)
        add_lofted_tube(f"Gen_UpperArm{side}", [
            (-0.29, 0.062, 0.062, 0, 0),
            (0.02, 0.078, 0.078, 0, 0),
        ], m_cloth, parent=sh, segs=10)

        el = make_empty(f"JNT_Elbow{side}", parent=sh, loc=(0, 0, -0.29))
        add_lofted_tube(f"Gen_KoteForearm{side}", [
            (-0.26, 0.048, 0.048, 0, 0),
            (0.0, 0.060, 0.060, 0, 0),
        ], m_armor, parent=el, segs=10)
        add_box(f"Gen_KoteGold{side}", 0.025, 0.065, 0.18, m_gold, parent=el, loc=(sgn * 0.042, 0, -0.13), bevel=0.004)

        hand = make_empty(f"JNT_Hand{side}", parent=el, loc=(0, 0, -0.26))
        add_box(f"Gen_Gauntlet{side}", 0.072, 0.085, 0.082, m_armor, parent=hand, loc=(0, -0.01, -0.035), bevel=0.012, smooth=True)
        make_empty(f"SOCKET_Weapon{side}", parent=hand, loc=(0, -0.02, -0.04))

    # LEGS with Hakama & Suneate Armored Greaves
    for side, sx in (("L", 0.125), ("R", -0.125)):
        hip = make_empty(f"JNT_Hip{side}", parent=pelvis, loc=(sx, 0, -0.07))
        add_lofted_tube(f"Gen_Thigh{side}", [
            (-0.46, 0.082, 0.082, 0, 0),
            (-0.22, 0.125, 0.128, 0, 0),
            (0.02, 0.108, 0.108, 0, 0),
        ], m_crimson, parent=hip, segs=12)

        knee = make_empty(f"JNT_Knee{side}", parent=hip, loc=(0, 0, -0.47))
        add_lofted_tube(f"Gen_Suneate{side}", [
            (-0.43, 0.052, 0.055, 0, 0),
            (-0.18, 0.068, 0.072, 0, 0),
            (0.02, 0.076, 0.078, 0, 0),
        ], m_armor, parent=knee, segs=10)
        add_box(f"Gen_KneeGuard{side}", 0.085, 0.045, 0.09, m_gold, parent=knee, loc=(0, -0.065, -0.02), bevel=0.008)

        foot = make_empty(f"JNT_Foot{side}", parent=knee, loc=(0, 0, -0.44))
        add_box(f"Gen_Foot{side}", 0.098, 0.235, 0.072, m_armor, parent=foot, loc=(0, -0.05, -0.025), bevel=0.014, smooth=True)

    export_glb(os.path.join(OUT_DIR, "boss_genichiro.glb"))


# ==============================================================================
# 3. BOSS 2: SWORD SAINT ISSHIN ("剑圣·苇名一心" - Katana + Jumonji Spear + Pistol)
# ==============================================================================
def build_boss_isshin():
    clear_scene()
    m_robe = make_mat("MAT_IsshinIndigo", 0x1A2E52, metallic=0.08, roughness=0.72)
    m_hakama = make_mat("MAT_IsshinWhiteHakama", 0xD8D8DF, metallic=0.02, roughness=0.84)
    m_armor = make_mat("MAT_YoroiArmor", 0x23252B, metallic=0.68, roughness=0.35)
    m_gold = make_mat("MAT_AshinaGold", 0xD4A842, metallic=0.90, roughness=0.24)
    m_skin = make_mat("MAT_IsshinSkin", 0xC6A288, metallic=0.0, roughness=0.60)
    m_white_hair = make_mat("MAT_WhiteMane", 0xE6E6EE, metallic=0.05, roughness=0.65)

    root = make_empty("CHAR_Root", loc=(0, 0, 0))
    pelvis = make_empty("JNT_Pelvis", parent=root, loc=(0, 0, 1.08))
    torso = make_empty("JNT_Torso", parent=pelvis, loc=(0, 0, 0.07))
    head = make_empty("JNT_Head", parent=torso, loc=(0, 0, 0.59))

    # Wide Pleated White Samurai Hakama Skirt & Indigo Obi
    add_lofted_tube("Iss_ObiSash", [
        (-0.02, 0.195, 0.15, 0, 0),
        (0.09, 0.195, 0.15, 0, 0),
    ], m_gold, parent=pelvis, segs=14)
    cape = make_empty("JNT_Cape", parent=pelvis, loc=(0, 0, 0.02))
    add_lofted_tube("Iss_HakamaSkirt", [
        (-0.58, 0.34, 0.26, 0, 0.02),
        (-0.28, 0.27, 0.21, 0, 0.01),
        (0.0, 0.19, 0.145, 0, 0),
    ], m_hakama, parent=cape, segs=16, cap=False)

    # Open-chested Grandmaster Torso + Flowing Indigo Haori Coat
    add_lofted_tube("Iss_BareChest", [
        (0.0, 0.165, 0.125, 0, 0),
        (0.28, 0.20, 0.14, 0, -0.01),
        (0.48, 0.215, 0.145, 0, -0.01),
        (0.57, 0.13, 0.105, 0, 0),
    ], m_skin, parent=torso, segs=14)
    # Indigo Haori wrapping back & sides, open down front (-Y_blender)
    add_lofted_tube("Iss_IndigoHaoriBack", [
        (-0.18, 0.26, 0.17, 0, 0.05),
        (0.18, 0.235, 0.16, 0, 0.03),
        (0.48, 0.245, 0.165, 0, 0.02),
    ], m_robe, parent=torso, segs=14)
    add_box("Iss_LapelL", 0.08, 0.05, 0.52, m_robe, parent=torso, loc=(0.13, -0.125, 0.25), rot=(0, -0.08, 0), bevel=0.008)
    add_box("Iss_LapelR", 0.08, 0.05, 0.52, m_robe, parent=torso, loc=(-0.13, -0.125, 0.25), rot=(0, 0.08, 0), bevel=0.008)
    add_box("Iss_GoldTrimL", 0.022, 0.054, 0.52, m_gold, parent=torso, loc=(0.09, -0.13, 0.25), rot=(0, -0.08, 0))
    add_box("Iss_GoldTrimR", 0.022, 0.054, 0.52, m_gold, parent=torso, loc=(-0.09, -0.13, 0.25), rot=(0, 0.08, 0))

    # Head: Scarred Elder Grandmaster + Flowing White Mane + Towering Sword-Saint Kabuto!
    add_sphere("Iss_HeadSkull", 0.105, 0.120, 0.132, m_skin, parent=head, loc=(0, -0.01, 0.14))
    add_box("Iss_Goatee", 0.032, 0.035, 0.095, m_white_hair, parent=head, loc=(0, -0.122, 0.02), rot=(0.25, 0, 0), bevel=0.008, smooth=True)
    # Wild flowing white hair mane behind kabuto
    add_lofted_tube("Iss_WhiteMane", [
        (-0.34, 0.18, 0.09, 0, 0.16),
        (-0.12, 0.16, 0.10, 0, 0.10),
        (0.10, 0.13, 0.11, 0, 0.05),
    ], m_white_hair, parent=head, segs=12)
    # Towering Sword-Saint Kabuto Bowl + Tall Twin Forked Gold Crest!
    add_lofted_tube("Iss_TallKabuto", [
        (0.14, 0.135, 0.150, 0, 0.01),
        (0.26, 0.122, 0.135, 0, 0.02),
        (0.38, 0.095, 0.105, 0, 0.03),
    ], m_armor, parent=head, segs=14)
    add_lofted_tube("Iss_Shikoro", [
        (0.05, 0.185, 0.175, 0, 0.04),
        (0.15, 0.145, 0.150, 0, 0.02),
    ], m_armor, parent=head, segs=12, cap=False)
    for sgn in (-1.0, 1.0):
        add_lofted_tube(f"Iss_TallCrest_{'L' if sgn > 0 else 'R'}", [
            (0.0, 0.018, 0.010, 0, 0),
            (0.24, 0.024, 0.009, sgn * 0.055, -0.01),
            (0.52, 0.016, 0.008, sgn * 0.115, -0.02),
            (0.72, 0.004, 0.004, sgn * 0.145, -0.025),
        ], m_gold, parent=head, loc=(0, -0.145, 0.20), segs=8)

    # ARMS: Wide Indigo Haori Sleeves + Armored Gauntlets
    for side, sx in (("L", 0.25), ("R", -0.25)):
        sh = make_empty(f"JNT_Shoulder{side}", parent=torso, loc=(sx, 0, 0.47))
        add_lofted_tube(f"Iss_WideSleeve{side}", [
            (-0.30, 0.115, 0.125, 0, 0.02),
            (-0.12, 0.098, 0.105, 0, 0.01),
            (0.03, 0.082, 0.085, 0, 0),
        ], m_robe, parent=sh, segs=12)

        el = make_empty(f"JNT_Elbow{side}", parent=sh, loc=(0, 0, -0.30))
        add_lofted_tube(f"Iss_Forearm{side}", [
            (-0.27, 0.046, 0.046, 0, 0),
            (0.0, 0.058, 0.058, 0, 0),
        ], m_armor, parent=el, segs=10)

        hand = make_empty(f"JNT_Hand{side}", parent=el, loc=(0, 0, -0.27))
        add_box(f"Iss_Hand{side}", 0.070, 0.082, 0.080, m_skin, parent=hand, loc=(0, -0.01, -0.035), bevel=0.012, smooth=True)
        make_empty(f"SOCKET_Weapon{side}", parent=hand, loc=(0, -0.02, -0.04))

    # LEGS: Billowing White Hakama Trousers + Armored Greaves
    for side, sx in (("L", 0.13), ("R", -0.13)):
        hip = make_empty(f"JNT_Hip{side}", parent=pelvis, loc=(sx, 0, -0.07))
        add_lofted_tube(f"Iss_HakamaLeg{side}", [
            (-0.48, 0.115, 0.120, 0, 0),
            (-0.24, 0.145, 0.150, 0, 0),
            (0.02, 0.115, 0.115, 0, 0),
        ], m_hakama, parent=hip, segs=12)

        knee = make_empty(f"JNT_Knee{side}", parent=hip, loc=(0, 0, -0.49))
        add_lofted_tube(f"Iss_Greave{side}", [
            (-0.45, 0.048, 0.050, 0, 0),
            (-0.18, 0.062, 0.065, 0, 0),
            (0.02, 0.070, 0.072, 0, 0),
        ], m_armor, parent=knee, segs=10)

        foot = make_empty(f"JNT_Foot{side}", parent=knee, loc=(0, 0, -0.46))
        add_box(f"Iss_Sandal{side}", 0.095, 0.24, 0.068, m_armor, parent=foot, loc=(0, -0.05, -0.025), bevel=0.014, smooth=True)

    export_glb(os.path.join(OUT_DIR, "boss_isshin.glb"))


# ==============================================================================
# 4. WEAPONS & ASHINA MOONLIT ARENA PROPS
# ==============================================================================
def build_weapons_and_arena():
    clear_scene()
    m_blade = make_mat("MAT_BladeSteel", 0xDCE3EC, metallic=0.95, roughness=0.14)
    m_mortal_blade = make_mat("MAT_MortalBladeCrimson", 0xB81422, metallic=0.78, roughness=0.22, emission_hex=0xCC1122, emission_strength=1.2)
    m_black_blade = make_mat("MAT_BlackMortalBlade", 0x22242C, metallic=0.92, roughness=0.18)
    m_brass = make_mat("MAT_AgedBrass", 0xC89D3C, metallic=0.88, roughness=0.28)
    m_iron = make_mat("MAT_DarkIron", 0x2A2D34, metallic=0.84, roughness=0.35)
    m_grip = make_mat("MAT_TsukaWrap", 0x1D2330, metallic=0.05, roughness=0.82)
    m_crimson = make_mat("MAT_AshinaCrimson", 0x8A181E, metallic=0.15, roughness=0.68)
    m_cedar = make_mat("MAT_CedarWood", 0x3C2A20, metallic=0.02, roughness=0.86)
    m_rock = make_mat("MAT_CliffRock", 0x383C42, metallic=0.04, roughness=0.88)
    m_idol_stone = make_mat("MAT_IdolStone", 0x4E524E, metallic=0.06, roughness=0.82)
    m_spirit_flame = make_mat("MAT_SpiritFlame", 0x38A8FF, metallic=0.0, roughness=0.2, emission_hex=0x2890FF, emission_strength=4.5)
    m_lantern_glow = make_mat("MAT_LanternGlow", 0xFFB855, metallic=0.0, roughness=0.2, emission_hex=0xFFA030, emission_strength=3.8)
    m_banner_cloth = make_mat("MAT_BannerCloth", 0x5E1B1E, metallic=0.02, roughness=0.88)

    # --- WPN_Kusabimaru (1.02m blade along +Z_blender) ---
    kusa = make_empty("WPN_Kusabimaru", loc=(0, 0, 0))
    add_lofted_tube("Kusa_Tsuka", [
        (-0.24, 0.015, 0.022, 0, 0),
        (0.0, 0.016, 0.024, 0, 0),
    ], m_grip, parent=kusa, segs=8)
    add_sphere("Kusa_Kashira", 0.018, 0.025, 0.014, m_brass, parent=kusa, loc=(0, 0, -0.245))
    add_lofted_tube("Kusa_Tsuba", [
        (0.0, 0.044, 0.048, 0, 0),
        (0.012, 0.044, 0.048, 0, 0),
    ], m_brass, parent=kusa, segs=14)
    add_box("Kusa_Habaki", 0.014, 0.032, 0.032, m_brass, parent=kusa, loc=(0, 0, 0.026))
    add_katana_blade("Kusa_Blade", 0.98, 0.036, 0.042, 0.008, m_blade, m_iron, parent=kusa, loc=(0, 0, 0.04))

    # --- WPN_MortalBlade (不死斩·拜泪 - 1.30m Crimson Cursed Odachi) ---
    mortal = make_empty("WPN_MortalBlade", loc=(0.6, 0, 0))
    add_lofted_tube("Mortal_Tsuka", [
        (-0.32, 0.017, 0.026, 0, 0),
        (0.0, 0.018, 0.027, 0, 0),
    ], m_crimson, parent=mortal, segs=8)
    add_lofted_tube("Mortal_LotusTsuba", [
        (0.0, 0.062, 0.066, 0, 0),
        (0.018, 0.052, 0.056, 0, 0),
    ], m_iron, parent=mortal, segs=8)
    add_katana_blade("Mortal_Blade", 1.26, 0.046, 0.058, 0.010, m_mortal_blade, m_iron, parent=mortal, loc=(0, 0, 0.035))

    # --- WPN_GenichiroOdachi (1.42m Long Samurai Odachi) ---
    gen_swd = make_empty("WPN_GenichiroOdachi", loc=(1.2, 0, 0))
    add_lofted_tube("GenSwd_Tsuka", [
        (-0.34, 0.018, 0.026, 0, 0),
        (0.0, 0.019, 0.028, 0, 0),
    ], m_grip, parent=gen_swd, segs=8)
    add_lofted_tube("GenSwd_Tsuba", [
        (0.0, 0.056, 0.060, 0, 0),
        (0.014, 0.056, 0.060, 0, 0),
    ], m_gold_mat := m_brass, parent=gen_swd, segs=12)
    add_katana_blade("GenSwd_Blade", 1.38, 0.042, 0.062, 0.009, m_blade, m_iron, parent=gen_swd, loc=(0, 0, 0.035))

    # --- WPN_GenichiroBow (Asymmetrical Yumi Greatbow held in Left Hand) ---
    gen_bow = make_empty("WPN_GenichiroBow", loc=(1.8, 0, 0))
    add_lofted_tube("GenBow_Stave", [
        (-0.78, 0.012, 0.018, 0, 0.18),
        (-0.35, 0.020, 0.026, 0, 0.03),
        (0.0, 0.024, 0.030, 0, 0),
        (0.48, 0.020, 0.026, 0, 0.04),
        (1.05, 0.012, 0.018, 0, 0.22),
    ], m_crimson, parent=gen_bow, segs=8)
    add_box("GenBow_String", 0.005, 0.005, 1.82, m_Idol := m_blade, parent=gen_bow, loc=(0, 0.20, 0.135))

    # --- WPN_Arrow (War Arrow along +Z_blender) ---
    arrow = make_empty("WPN_Arrow", loc=(2.3, 0, 0))
    add_lofted_tube("Arrow_Shaft", [
        (-0.45, 0.007, 0.007, 0, 0),
        (0.45, 0.007, 0.007, 0, 0),
    ], m_cedar, parent=arrow, segs=6)
    add_lofted_tube("Arrow_Head", [
        (0.45, 0.024, 0.008, 0, 0),
        (0.58, 0.002, 0.002, 0, 0),
    ], m_blade, parent=arrow, segs=6)

    # --- WPN_IsshinKatana (1.22m Black Mortal Blade / Grandmaster Katana) ---
    iss_swd = make_empty("WPN_IsshinKatana", loc=(2.8, 0, 0))
    add_lofted_tube("IssSwd_Tsuka", [
        (-0.30, 0.017, 0.025, 0, 0),
        (0.0, 0.018, 0.026, 0, 0),
    ], m_grip, parent=iss_swd, segs=8)
    add_lofted_tube("IssSwd_Tsuba", [
        (0.0, 0.052, 0.055, 0, 0),
        (0.014, 0.052, 0.055, 0, 0),
    ], m_brass, parent=iss_swd, segs=12)
    add_katana_blade("IssSwd_Blade", 1.18, 0.040, 0.050, 0.009, m_blade, m_black_blade, parent=iss_swd, loc=(0, 0, 0.032))

    # --- WPN_IsshinSpear (2.68m Jumonji Yari Cross-Bladed Spear!) ---
    spear = make_empty("WPN_IsshinSpear", loc=(3.5, 0, 0))
    add_lofted_tube("Spear_Shaft", [
        (-0.85, 0.021, 0.021, 0, 0),
        (1.85, 0.022, 0.022, 0, 0),
    ], m_cedar, parent=spear, segs=10)
    add_lofted_tube("Spear_BrassCollar", [
        (1.72, 0.028, 0.028, 0, 0),
        (1.92, 0.026, 0.026, 0, 0),
    ], m_brass, parent=spear, segs=10)
    add_sphere("Spear_CrimsonTuft", 0.058, 0.058, 0.065, m_crimson, parent=spear, loc=(0, 0, 1.82))
    # Central Spearhead + Crossed Crescent Side-Blades (Jumonji Yari!)
    add_lofted_tube("Spear_CenterTip", [
        (1.90, 0.012, 0.034, 0, 0),
        (2.42, 0.008, 0.022, 0, 0),
        (2.68, 0.002, 0.003, 0, 0),
    ], m_blade, parent=spear, segs=6, smooth=False)
    add_box("Spear_CrossBlade", 0.010, 0.42, 0.055, m_blade, parent=spear, loc=(0, 0, 2.06), bevel=0.004)
    add_box("Spear_HookF", 0.009, 0.038, 0.16, m_blade, parent=spear, loc=(0, -0.20, 2.13), rot=(-0.22, 0, 0), bevel=0.003)
    add_box("Spear_HookB", 0.009, 0.038, 0.16, m_blade, parent=spear, loc=(0, 0.20, 2.13), rot=(0.22, 0, 0), bevel=0.003)

    # --- WPN_IsshinPistol (Tanegashima Multi-Shot Matchlock Pistol) ---
    pistol = make_empty("WPN_IsshinPistol", loc=(4.2, 0, 0))
    add_box("Pistol_Stock", 0.042, 0.18, 0.075, m_cedar, parent=pistol, loc=(0, 0.04, -0.02), rot=(0.55, 0, 0), bevel=0.008)
    add_lofted_tube("Pistol_Barrel", [
        (0.0, 0.022, 0.022, 0, 0),
        (0.36, 0.020, 0.020, 0, 0),
        (0.38, 0.026, 0.026, 0, 0),
    ], m_iron, parent=pistol, segs=8)
    add_box("Pistol_BrassBand", 0.048, 0.048, 0.035, m_brass, parent=pistol, loc=(0, 0, 0.22))

    # --- WPN_Shuriken (4-Pointed Spinning Iron Star) ---
    shuri = make_empty("WPN_Shuriken", loc=(4.8, 0, 0))
    for i in range(4):
        ang = i * (math.pi * 0.5)
        add_box(f"Shuri_Blade{i}", 0.22, 0.048, 0.008, m_blade, parent=shuri, rot=(0, 0, ang), bevel=0.002)
    add_lofted_tube("Shuri_Ring", [(-0.008, 0.028, 0.028, 0, 0), (0.008, 0.028, 0.028, 0, 0)], m_brass, parent=shuri, segs=10)

    # ==========================================================================
    # ENVIRONMENT LANDMARKS
    # ==========================================================================
    # 1. ENV_ToriiGate: Towering Weathered Sengoku Wooden Torii / Ashina Reservoir Gate
    torii = make_empty("ENV_ToriiGate", loc=(10.0, 0, 0))
    for sgn in (-1.0, 1.0):
        add_lofted_tube(f"Torii_Pillar_{'L' if sgn > 0 else 'R'}", [
            (0.0, 0.34, 0.34, sgn * 3.1, 0),
            (3.2, 0.29, 0.29, sgn * 2.95, 0),
            (6.4, 0.26, 0.26, sgn * 2.82, 0),
        ], m_cedar, parent=torii, segs=12)
        add_lofted_tube(f"Torii_BaseStone_{'L' if sgn > 0 else 'R'}", [
            (0.0, 0.52, 0.52, sgn * 3.1, 0),
            (0.55, 0.42, 0.42, sgn * 3.1, 0),
        ], m_rock, parent=torii, segs=10)
    # Nuki lower crossbeam & Kasagi curved upper lintel
    add_box("Torii_NukiBeam", 7.8, 0.28, 0.34, m_cedar, parent=torii, loc=(0, 0, 4.95), bevel=0.03)
    add_box("Torii_ShimakiBeam", 8.6, 0.38, 0.32, m_cedar, parent=torii, loc=(0, 0, 6.22), bevel=0.04)
    add_box("Torii_KasagiTop", 9.4, 0.56, 0.36, m_iron, parent=torii, loc=(0, 0, 6.52), bevel=0.05)
    add_box("Torii_TipUpL", 1.3, 0.58, 0.32, m_iron, parent=torii, loc=(4.8, 0, 6.68), rot=(0, -0.18, 0), bevel=0.04)
    add_box("Torii_TipUpR", 1.3, 0.58, 0.32, m_iron, parent=torii, loc=(-4.8, 0, 6.68), rot=(0, 0.18, 0), bevel=0.04)
    add_box("Torii_GakuzukaTablet", 0.72, 0.34, 1.15, m_cedar, parent=torii, loc=(0, 0, 5.58), bevel=0.03)

    # 2. ENV_RuinedPagoda: Ashina Secret Passage Watchtower Pavilion (Moonhouse silhouette!)
    pagoda = make_empty("ENV_RuinedPagoda", loc=(24.0, 0, 0))
    add_box("Pagoda_StoneFoundation", 7.6, 6.4, 1.8, m_rock, parent=pagoda, loc=(0, 0, 0.9), bevel=0.08)
    add_box("Pagoda_TimberFloor", 7.2, 6.0, 0.32, m_cedar, parent=pagoda, loc=(0, 0, 1.92), bevel=0.03)
    for px in (-2.9, 2.9):
        for py in (-2.3, 2.3):
            add_box(f"Pagoda_Col_{px}_{py}", 0.32, 0.32, 3.6, m_cedar, parent=pagoda, loc=(px, py, 3.8), bevel=0.02)
    add_box("Pagoda_WallCore", 5.2, 4.0, 3.4, m_cedar, parent=pagoda, loc=(0, 0, 3.75), bevel=0.04)
    # Tier 1 Swept Sengoku Gable Roof
    add_lofted_tube("Pagoda_Roof1", [
        (5.35, 6.2, 5.2, 0, 0),
        (6.45, 3.4, 2.8, 0, 0),
        (7.15, 0.4, 2.4, 0, 0),
    ], m_iron, parent=pagoda, segs=4, rot=(0, 0, math.pi * 0.25), smooth=False)
    # Tier 2 Watchtower Loft & Ridge Roof
    add_box("Pagoda_UpperLoft", 3.6, 2.8, 2.2, m_cedar, parent=pagoda, loc=(0, 0, 7.6), bevel=0.03)
    add_lofted_tube("Pagoda_Roof2", [
        (8.5, 4.4, 3.6, 0, 0),
        (9.6, 1.8, 1.5, 0, 0),
        (10.3, 0.2, 1.6, 0, 0),
    ], m_iron, parent=pagoda, segs=4, rot=(0, 0, math.pi * 0.25), smooth=False)
    add_box("Pagoda_RidgeGold", 3.2, 0.22, 0.26, m_brass, parent=pagoda, loc=(0, 0, 10.38), bevel=0.02)

    # 3. ENV_SculptorIdol: Carved Stone Sculptor's Idol (鬼佛) with Blue Spirit Flame!
    idol = make_empty("ENV_SculptorIdol", loc=(36.0, 0, 0))
    add_lofted_tube("Idol_LotusBase", [
        (0.0, 0.62, 0.56, 0, 0),
        (0.28, 0.50, 0.46, 0, 0),
        (0.45, 0.42, 0.38, 0, 0),
    ], m_rock, parent=idol, segs=10)
    add_lofted_tube("Idol_StatueBody", [
        (0.44, 0.26, 0.20, 0, 0),
        (0.85, 0.22, 0.17, 0, 0),
        (1.12, 0.14, 0.13, 0, 0),
    ], m_idol_stone, parent=idol, segs=10)
    add_sphere("Idol_StatueHead", 0.11, 0.11, 0.13, m_idol_stone, parent=idol, loc=(0, 0, 1.24))
    # Wrathful multi-arm stone silhouette & halo mandorla
    add_box("Idol_HaloArch", 0.62, 0.08, 0.96, m_idol_stone, parent=idol, loc=(0, 0.14, 0.98), bevel=0.03)
    for ang in (-0.6, 0.6, -1.1, 1.1):
        add_box(f"Idol_Arm_{ang:.1f}", 0.06, 0.06, 0.36, m_idol_stone, parent=idol, loc=(math.sin(ang) * 0.24, -0.02, 0.88), rot=(0, ang, 0), bevel=0.01)
    # Floating Spirit Flame wisps
    add_lofted_tube("Idol_SpiritFlameCore", [
        (0.50, 0.11, 0.11, 0, -0.24),
        (0.76, 0.14, 0.14, 0, -0.24),
        (1.06, 0.02, 0.02, 0, -0.23),
    ], m_spirit_flame, parent=idol, segs=8)

    # 4. ENV_StoneLantern: Mossy Sengoku Toro Stone Lantern
    lantern = make_empty("ENV_StoneLantern", loc=(40.0, 0, 0))
    add_lofted_tube("Lantern_Post", [
        (0.0, 0.36, 0.36, 0, 0),
        (0.35, 0.22, 0.22, 0, 0),
        (1.35, 0.18, 0.18, 0, 0),
        (1.52, 0.42, 0.42, 0, 0),
    ], m_rock, parent=lantern, segs=8)
    add_box("Lantern_FireBox", 0.46, 0.46, 0.42, m_lantern_glow, parent=lantern, loc=(0, 0, 1.74), bevel=0.02)
    for cx in (-0.21, 0.21):
        for cy in (-0.21, 0.21):
            add_box(f"Lantern_Frame_{cx}_{cy}", 0.07, 0.07, 0.46, m_rock, parent=lantern, loc=(cx, cy, 1.74))
    add_lofted_tube("Lantern_Roof", [
        (1.95, 0.66, 0.66, 0, 0),
        (2.30, 0.16, 0.16, 0, 0),
        (2.46, 0.06, 0.06, 0, 0),
    ], m_rock, parent=lantern, segs=6)

    # 5. ENV_WarBanner: Tattered Sengoku Samurai Nobori Flag
    banner = make_empty("ENV_WarBanner", loc=(44.0, 0, 0))
    add_lofted_tube("Banner_Pole", [
        (0.0, 0.045, 0.045, 0, 0),
        (4.6, 0.032, 0.032, 0, 0),
    ], m_cedar, parent=banner, segs=8)
    add_box("Banner_TopArm", 1.15, 0.04, 0.04, m_cedar, parent=banner, loc=(0.56, 0, 4.52))
    add_box("Banner_FlagCloth", 1.02, 0.025, 2.85, m_banner_cloth, parent=banner, loc=(0.56, 0, 3.05), bevel=0.01)

    # 6. ENV_CliffRock: Sculpted Jagged Sengoku Boulder / Cliff Outcrop
    rock = make_empty("ENV_CliffRock", loc=(48.0, 0, 0))
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for i, v in enumerate(bm.verts):
        # Deterministic craggy displacement
        h = math.sin(v.co.x * 3.7 + i * 0.9) * 0.22 + math.cos(v.co.y * 4.1 - v.co.z * 2.8) * 0.18
        v.co.x *= (2.4 + h)
        v.co.y *= (1.9 - h * 0.6)
        v.co.z = max(0.0, (v.co.z + 0.72) * (1.55 + h * 0.5))
    bm_to_obj("CliffRock_Mesh", bm, m_rock, parent=rock, smooth=False, uv_scale=0.35)

    export_glb(os.path.join(OUT_DIR, "weapons_and_arena.glb"))


if __name__ == "__main__":
    build_shinobi_wolf()
    build_boss_genichiro()
    build_boss_isshin()
    build_weapons_and_arena()
    print("=== ALL SEKIRO 3D MODELS EXPORTED SUCCESSFULLY ===")
