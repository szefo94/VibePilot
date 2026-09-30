/**
 * Low-poly modelling kit: build a model from primitive parts, then bake it into ONE geometry with per-part vertex
 * colours — the equivalent of joining objects in Blender and painting vertex colours, with flat shading for the
 * faceted look. One mesh per model instead of one per part means fewer draw calls and one collision box per
 * piece (ai.js bakes a box per mesh).
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
    const pos = [], nor = [], col = [];
    for (const { geo, color, t } of parts) {
        const g = geo.index ? geo.toNonIndexed() : geo;
        _e.set(t.rx || 0, t.ry || 0, t.rz || 0, t.order || 'XYZ');
        _m.compose(_p.set(t.x || 0, t.y || 0, t.z || 0), _q.setFromEuler(_e), _s.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1));
        g.applyMatrix4(_m);
        if (!g.attributes.normal) g.computeVertexNormals();
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
