/**
 * Hit shapes: the boxes an aircraft or boss really occupies, instead of one sphere.
 *
 * Every baked model records one box per part (core/meshkit.js bake → geometry.userData.boxes): a fighter is its
 * fuselage, wings, tail and pods, so you can no longer fly through a tanker's wing or shoot through an AC-130's.
 * Other meshes use their geometry's bounding box. A unit's shape is all its meshes' boxes, each placed by the
 * mesh's live world matrix — so a boss's swinging arms and waving tentacles collide where they are drawn.
 * Tests run in each box's own frame (an oriented box) and measure back in world units, so scaled models are exact.
 */
const shapes = new WeakMap(); // root Object3D → { parts: [{ mesh, box }], radius }
const _inv = new THREE.Matrix4(), _l = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _w = new THREE.Box3();
const _min = new THREE.Vector3(), _max = new THREE.Vector3();

/** The boxes of `root` (built once; call invalidateShape() if its meshes change). */
export function shapeOf(root) {
    let s = shapes.get(root);
    if (s) return s;
    root.updateMatrixWorld(true);
    const parts = [];
    root.traverse(o => {
        if (!o.isMesh || o.userData.debugHelper || o.userData.noHit) return;
        const boxes = o.geometry.userData?.boxes;
        if (boxes?.length) for (const box of boxes) parts.push({ mesh: o, box });
        else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); parts.push({ mesh: o, box: o.geometry.boundingBox }); }
    });
    // Broad-phase radius: the farthest box corner from the root, plus room for moving parts
    root.getWorldPosition(_c);
    let r = 0;
    for (const p of parts) { _w.copy(p.box).applyMatrix4(p.mesh.matrixWorld); r = Math.max(r, _w.min.distanceTo(_c), _w.max.distanceTo(_c)); }
    s = { parts, radius: r * 1.15 + 1 };
    shapes.set(root, s);
    return s;
}
export function invalidateShape(root) { shapes.delete(root); }

/** Distance from world point `p` to the shape (0 inside it); Infinity when farther than `within`. */
export function shapeDistance(root, p, within = 0) {
    const s = shapeOf(root);
    root.getWorldPosition(_c);
    if (p.distanceTo(_c) > s.radius + within) return Infinity;
    let best = Infinity;
    for (const { mesh, box } of s.parts) {
        _inv.copy(mesh.matrixWorld).invert();
        _l.copy(p).applyMatrix4(_inv).clamp(box.min, box.max).applyMatrix4(mesh.matrixWorld);
        const d = _l.distanceTo(p);
        if (d < best) { best = d; if (d === 0) break; }
    }
    return best;
}
/** Is world point `p` within `r` of the shape? */
export const shapeHits = (root, p, r) => shapeDistance(root, p, r) < r;

/** Does the segment a → b (a bullet's path this step) pass within `r` of the shape? */
export function segmentHits(root, a, b, r) {
    const s = shapeOf(root);
    root.getWorldPosition(_c);
    // broad phase: the segment's closest approach to the root
    _l.subVectors(b, a);
    const len2 = _l.lengthSq(), t = len2 > 0 ? THREE.MathUtils.clamp(_a.subVectors(_c, a).dot(_l) / len2, 0, 1) : 0;
    if (_a.copy(a).addScaledVector(_l, t).distanceTo(_c) > s.radius + r) return false;
    for (const { mesh, box } of s.parts) {
        _inv.copy(mesh.matrixWorld).invert();
        const k = r / mesh.matrixWorld.getMaxScaleOnAxis(); // the margin in the box's own units
        _min.copy(box.min).subScalar(k); _max.copy(box.max).addScalar(k);
        if (segmentInBox(_a.copy(a).applyMatrix4(_inv), _b.copy(b).applyMatrix4(_inv), _min, _max)) return true;
    }
    return false;
}

/** Slab test: does the segment p → q touch the box [min, max]? */
function segmentInBox(p, q, min, max) {
    let t0 = 0, t1 = 1;
    for (const ax of ['x', 'y', 'z']) {
        const d = q[ax] - p[ax];
        if (Math.abs(d) < 1e-9) { if (p[ax] < min[ax] || p[ax] > max[ax]) return false; continue; }
        let u = (min[ax] - p[ax]) / d, v = (max[ax] - p[ax]) / d;
        if (u > v) [u, v] = [v, u];
        t0 = Math.max(t0, u); t1 = Math.min(t1, v);
        if (t0 > t1) return false;
    }
    return true;
}

/** Any of the world points (each with its radius) within the shape? — a plane checked at its nose, tail and wingtips. */
export function pointsHit(root, points) {
    for (const [p, r] of points) if (shapeHits(root, p, r)) return true;
    return false;
}
