/**
 * Low-poly modelling kit: build a model from primitive parts, then bake it into ONE geometry with per-part vertex
 * colours — the equivalent of joining objects in Blender and painting vertex colours, with flat shading for the
 * faceted look. One mesh per model instead of one per part means fewer draw calls. The baked geometry keeps a box
 * per part (geometry.userData.boxes), so collisions follow the real shape: wings, tails, turrets (combat/hitShapes.js).
 *
 *   const geo = bake([
 *       part(new THREE.BoxGeometry(4, 1, 6), 0x55663a, { y: 0.5 }),
 *       part(new THREE.CylinderGeometry(1, 1, 2, 8), 0x333333, { x: 1, rz: Math.PI / 2 }),
 *   ]);
 *   new THREE.Mesh(geo, kitMaterial());
 */

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

/**
 * One part: geometry, colour (hex or THREE.Color), placement { x, y, z, rx, ry, rz, sx, sy, sz, s, order }.
 * Rotations use three.js Euler order 'XYZ' by default, which applies rz first and rx last; pass order: 'ZYX' to
 * apply rx first (e.g. lay a cylinder down with rx, then turn it about the vertical with ry).
 */
export function part(geo, color, t = {}) { return { geo, color, t }; }

/** Merge parts into one non-indexed BufferGeometry with position, normal and color. The part geometries are consumed. */
export function bake(parts) {
    const pos = [], nor = [], col = [], boxes = [];
    for (const { geo, color, t } of parts) {
        const g = geo.index ? geo.toNonIndexed() : geo;
        _e.set(t.rx || 0, t.ry || 0, t.rz || 0, t.order || 'XYZ');
        _m.compose(_p.set(t.x || 0, t.y || 0, t.z || 0), _q.setFromEuler(_e), _s.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1));
        g.applyMatrix4(_m);
        if (!g.attributes.normal) g.computeVertexNormals();
        g.computeBoundingBox(); boxes.push({ size: g.boundingBox.getSize(_p).length(), boxes: partBoxes(g) });
        const p = g.attributes.position.array, n = g.attributes.normal.array;
        for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
        if (color === null && g.attributes.color) { const k = g.attributes.color.array; for (let i = 0; i < k.length; i++) col.push(k[i]); } // an already-baked piece keeps its colours
        else { _c.set(color); for (let i = 0; i < p.length; i += 3) col.push(_c.r, _c.g, _c.b); }
        if (g !== geo) g.dispose();
        geo.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.computeBoundingBox(); out.computeBoundingSphere();
    // Collision boxes: every part but the tiny details (rivets, decals), largest parts first, at most 64 boxes
    const diag = out.boundingBox.getSize(new THREE.Vector3()).length();
    out.userData.boxes = boxes.filter(b => b.size > diag * 0.06).sort((a, b) => b.size - a.size).flatMap(b => b.boxes).slice(0, 64);
    return out;
}

/**
 * Collision boxes for one transformed part: its bounding box, or — for a long part like a swept wing, where one
 * box would be mostly air — up to 6 slices along its length, each fitted to points sampled over the part's faces.
 */
/**
 * Collision boxes for one transformed part: its bounding box, or — for a long part like a swept wing, where one
 * box would be mostly air — up to 6 slices along its length, each the exact bounds of the faces clipped to it.
 */
function partBoxes(g) {
    const bb = g.boundingBox, size = bb.getSize(new THREE.Vector3());
    const axes = ['x', 'y', 'z'].sort((a, b) => size[b] - size[a]), ax = axes[0], n = Math.min(6, Math.round(size[ax] / Math.max(size[axes[1]], 1e-6)));
    if (n < 3) return [bb.clone()];
    const p = g.attributes.position.array, slices = [];
    for (let k = 0; k < n; k++) {
        const lo = bb.min[ax] + (size[ax] * k) / n, hi = bb.min[ax] + (size[ax] * (k + 1)) / n, box = new THREE.Box3();
        for (let i = 0; i < p.length; i += 9) {
            let poly = [0, 1, 2].map(c => new THREE.Vector3().fromArray(p, i + c * 3));
            poly = clip(poly, ax, lo, 1); poly = clip(poly, ax, hi, -1); // keep lo ≤ v[ax] ≤ hi
            for (const v of poly) box.expandByPoint(v);
        }
        if (!box.isEmpty()) slices.push(box.expandByScalar(0.02));
    }
    return slices;
}
/** Sutherland–Hodgman: the part of polygon `poly` with sign·(v[ax] − at) ≥ 0. */
function clip(poly, ax, at, sign) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], da = sign * (a[ax] - at), db = sign * (b[ax] - at);
        if (da >= 0) out.push(a);
        if ((da >= 0) !== (db >= 0)) out.push(a.clone().lerp(b, da / (da - db)));
    }
    return out;
}

/** The kit's material: vertex colours, flat shading. One per model instance, so damage tints stay per unit. */
export const kitMaterial = (opts = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.1, ...opts });

/** A 2-D profile (array of [x, y]) extruded along Z by `depth`, centred — for hulls, wedges, sloped armour. */
export function profile(points, depth, bevel = 0) {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1 });
    g.translate(0, 0, -depth / 2);
    return g;
}
