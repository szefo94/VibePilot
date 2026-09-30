/**
 * Ground-unit hitboxes: oriented boxes that turn with the unit. One per mesh (its geometry's bounding box), or the
 * boxes listed in `mesh.userData.collisionBoxes` (geometry space: { min, max } or { center, size, ry }) when one
 * merged mesh is a poor fit — the carrier's hull, deck and island. Ground units don't move, so each box's world
 * matrix is baked once. The B key draws exactly these boxes (effects/debug.js).
 */
const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);

/** Boxes of one mesh in its own geometry space: [{ half: Vector3, offset: Matrix4 }] (offset: box centre + turn). */
export function meshBoxes(mesh) {
    const list = mesh.userData.collisionBoxes;
    if (list) {
        return list.map(b => {
            const center = b.center ? new THREE.Vector3(...b.center) : new THREE.Vector3(...b.min).add(new THREE.Vector3(...b.max)).multiplyScalar(0.5);
            const half = b.size ? new THREE.Vector3(...b.size).multiplyScalar(0.5) : new THREE.Vector3(...b.max).sub(new THREE.Vector3(...b.min)).multiplyScalar(0.5);
            return { half, offset: new THREE.Matrix4().compose(center, _q.setFromAxisAngle(THREE.Object3D.DefaultUp, b.ry || 0), _one) };
        });
    }
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    return [{ half: bb.getSize(new THREE.Vector3()).multiplyScalar(0.5), offset: new THREE.Matrix4().makeTranslation(...bb.getCenter(_c).toArray()) }];
}

/** Bake a unit's world-space boxes (call once its matrices are final). */
export function bakePartBoxes(unit) {
    unit.updateMatrixWorld(true);
    const out = [];
    unit.traverse(child => {
        if (!child.isMesh || child.userData.debugHelper) return;
        for (const { half, offset } of meshBoxes(child)) {
            const world = new THREE.Matrix4().multiplyMatrices(child.matrixWorld, offset);
            out.push({ half, world, inv: world.clone().invert() });
        }
    });
    return out;
}

/** Does a world AABB (a plane part) touch an oriented box? The AABB is taken as its bounding sphere. */
export function boxHitsPart(aabb, part) {
    aabb.getCenter(_c);
    const r = aabb.getSize(_p).length() / 2;
    _p.copy(_c).applyMatrix4(part.inv).clamp(_neg.copy(part.half).negate(), part.half) // nearest point of the box, box space
        .applyMatrix4(part.world);                                                      // back to world: the unit's scale counts
    return _p.distanceToSquared(_c) < r * r;
}
const _neg = new THREE.Vector3();

/** Ships are long and thin: their bounding sphere is far off the hull, so shots at them test the boxes instead. */
const PRECISE = new Set(['carrier', 'destroyer']);
/** Is `pos` within `r` of unit `u`? Ships (once baked) by their boxes, everything else by its sphere. */
export function nearGroundUnit(u, pos, r, center) {
    if (!PRECISE.has(u.userData.type) || !u.userData.partBoxes) return pos.distanceToSquared(center) < (r + u.userData.collisionRadius) ** 2;
    return u.userData.partBoxes.some(part => {
        _p.copy(pos).applyMatrix4(part.inv).clamp(_neg.copy(part.half).negate(), part.half).applyMatrix4(part.world);
        return _p.distanceToSquared(pos) < r * r;
    });
}
