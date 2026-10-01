/**
 * Projectile models: detailed, glowing shots for enemies, aces and bosses. Geometry and materials are shared (one
 * set per colour); each call returns a Group to place and orient, plus an optional `animate(t)` for spin and pulse.
 *
 *   tracer(color)        Y-aligned enemy round: white-hot core, glowing sheath, rounded nose
 *   missile(color, axis) a missile with nose cone, body, four fins and a burning exhaust ('y' or 'z' forward)
 *   orb(color)           energy ball: bright core, translucent shell, a spinning ring
 *   lavaRock()           a basalt chunk with molten cracks
 *   acidBlob(color)      a wobbling glob of acid with droplets
 *   plasmaBolt(color)    a Z-aligned capsule bolt with a glow
 */
import { markShared } from '../core/utils.js';

const geo = {
    core: markShared(new THREE.CylinderGeometry(0.42, 0.42, 4.6, 12)),
    sheath: markShared(new THREE.CylinderGeometry(0.85, 0.6, 6.2, 12, 1, true)),
    nose: markShared(new THREE.SphereGeometry(0.62, 12, 8)),
    mBody: markShared(new THREE.CylinderGeometry(0.28, 0.28, 2.6, 14)),
    mNose: markShared(new THREE.ConeGeometry(0.28, 0.8, 14)),
    mFin: markShared(new THREE.BoxGeometry(0.05, 0.55, 0.45)),
    mFlame: markShared(new THREE.ConeGeometry(0.26, 1.4, 12)),
    ball: markShared(new THREE.IcosahedronGeometry(1, 2)),
    shell: markShared(new THREE.IcosahedronGeometry(1.55, 1)),
    ring: markShared(new THREE.TorusGeometry(1.75, 0.12, 8, 28)),
    rock: markShared(new THREE.DodecahedronGeometry(1, 1)),
    magma: markShared(new THREE.IcosahedronGeometry(0.88, 1)),
    blob: markShared(new THREE.SphereGeometry(1, 18, 14)),
    drop: markShared(new THREE.SphereGeometry(0.32, 10, 8)),
    bolt: markShared(new THREE.CapsuleGeometry(0.5, 3.2, 6, 12).rotateX(Math.PI / 2)),
    boltGlow: markShared(new THREE.CylinderGeometry(1, 0.6, 5.5, 12, 1, true).rotateX(Math.PI / 2)),
};
const mats = new Map();
/** One shared material per kind and colour. */
function m(kind, color) {
    const key = `${kind}|${color}`;
    if (!mats.has(key)) {
        const c = new THREE.Color(color);
        mats.set(key, markShared(
            kind === 'hot' ? new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color(0xffffff), 0.3) }) // bright, still its colour
            : kind === 'glow' ? new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }) // readable on a bright sky too
            : kind === 'solid' ? new THREE.MeshBasicMaterial({ color: c })
            : kind === 'metal' ? new THREE.MeshStandardMaterial({ color: c, metalness: 0.6, roughness: 0.35, flatShading: true })
            : new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true })));
    }
    return mats.get(key);
}
const mesh = (g, mat, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, mat); o.position.set(x, y, z); return o; };

/** Enemy round (Y-aligned, like the pool expects). */
export function tracer(color = 0xff5a1a) {
    const g = new THREE.Group();
    g.add(mesh(geo.core, m('hot', color)), mesh(geo.sheath, m('glow', color), 0, -0.4, 0), mesh(geo.nose, m('hot', color), 0, 2.4, 0));
    return g;
}

/** A missile; `axis` 'y' (rival.js orients by Y) or 'z' (bosses.js orients by Z). */
export function missile(color = 0xd02030, axis = 'y') {
    const inner = new THREE.Group();
    inner.add(mesh(geo.mBody, m('metal', 0xd8dde2)), mesh(geo.mNose, m('metal', color), 0, 1.7, 0));
    for (let i = 0; i < 4; i++) { const f = mesh(geo.mFin, m('metal', color), Math.cos(i * Math.PI / 2) * 0.3, -1.05, Math.sin(i * Math.PI / 2) * 0.3); f.rotation.y = -i * Math.PI / 2; inner.add(f); }
    const flame = mesh(geo.mFlame, m('glow', 0xffa040), 0, -2, 0); flame.rotation.x = Math.PI; inner.add(flame);
    const g = new THREE.Group(); g.add(inner);
    if (axis === 'z') inner.rotation.x = Math.PI / 2;
    g.userData.animate = t => { flame.scale.set(1, 0.8 + 0.4 * Math.abs(Math.sin(t * 30)), 1); };
    return g;
}

export function orb(color) {
    const g = new THREE.Group(), ring = mesh(geo.ring, m('glow', color));
    g.add(mesh(geo.ball, m('hot', color)), mesh(geo.shell, m('glow', color)), ring);
    g.userData.animate = t => { ring.rotation.set(t * 4, t * 2.6, 0); g.children[1].scale.setScalar(1 + 0.12 * Math.sin(t * 14)); };
    return g;
}

export function lavaRock() {
    const g = new THREE.Group(), rock = mesh(geo.rock, m('rock', 0x2d2522));
    rock.scale.set(1, 0.85, 1.1);
    g.add(rock, mesh(geo.magma, m('hot', 0xff5a10)), mesh(geo.shell, m('glow', 0xff4a00)));
    g.children[2].scale.setScalar(0.9);
    g.userData.animate = t => { g.rotation.set(t * 2.1, t * 1.3, 0); };
    return g;
}

export function acidBlob(color = 0x66ff55) {
    const g = new THREE.Group(), blob = mesh(geo.blob, m('glow', color));
    g.add(mesh(geo.ball, m('hot', color)), blob);
    g.children[0].scale.setScalar(0.6);
    const drops = [0, 1, 2].map(i => { const d = mesh(geo.drop, m('solid', color)); g.add(d); return d; });
    g.userData.animate = t => {
        blob.scale.set(1 + 0.15 * Math.sin(t * 11), 1 - 0.12 * Math.sin(t * 11), 1 + 0.1 * Math.cos(t * 9));
        drops.forEach((d, i) => d.position.set(Math.cos(t * 5 + i * 2.1) * 1.3, Math.sin(t * 7 + i) * 0.6 - 0.4, Math.sin(t * 5 + i * 2.1) * 1.3));
    };
    return g;
}

export function plasmaBolt(color) {
    const g = new THREE.Group();
    g.add(mesh(geo.bolt, m('hot', color)), mesh(geo.boltGlow, m('glow', color)));
    g.userData.animate = t => { g.children[1].scale.setScalar(1 + 0.2 * Math.sin(t * 25)); };
    return g;
}
