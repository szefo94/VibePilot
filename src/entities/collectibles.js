/** Collectible heart chains, markers and hoop chains. */
import { heightAt } from '../world/terrain.js';
import { MAP_BOUNDARY, ceilingLevel, groundLevel } from '../config.js';
import { scene } from '../core/scene.js';
import { markShared, randomRange, rng } from '../core/utils.js';
import { collectibles, markers, obstacles } from './registry.js';
import { CONSTELLATION_NAMES, CORRIDOR_NAMES, constellations, corridors } from './names.js';
import { torusMaterial } from './obstacles.js';
import { bake, part } from '../core/meshkit.js';

// --- Marker / collectible resources ---
// Hoop markers: a faceted gold crystal (collision stays the markerRadius sphere)
export const markerRadius = 5, markerGeometry = markShared(new THREE.OctahedronGeometry(markerRadius * 0.85, 0).scale(0.8, 1.35, 0.8));
const markerMaterial = markShared(new THREE.MeshStandardMaterial({ color: 0xffcf33, emissive: 0xb07a00, emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.25, flatShading: true }));
export const collectibleRadius = 1.5, numCollectibleChains = 20;
const _hhs = collectibleRadius / 47.5; // scale heart to fit within collectibleRadius
const _hox = -25 * _hhs, _hoy = -47.5 * _hhs; // center heart at origin
const _heartShape = new THREE.Shape();
_heartShape.moveTo(_hox+25*_hhs,_hoy+25*_hhs);
_heartShape.bezierCurveTo(_hox+25*_hhs,_hoy+25*_hhs, _hox+20*_hhs,_hoy,          _hox,        _hoy);
_heartShape.bezierCurveTo(_hox-30*_hhs,_hoy,          _hox-30*_hhs,_hoy+35*_hhs,  _hox-30*_hhs,_hoy+35*_hhs);
_heartShape.bezierCurveTo(_hox-30*_hhs,_hoy+55*_hhs,  _hox-10*_hhs,_hoy+77*_hhs,  _hox+25*_hhs,_hoy+95*_hhs);
_heartShape.bezierCurveTo(_hox+60*_hhs,_hoy+77*_hhs,  _hox+80*_hhs,_hoy+55*_hhs,  _hox+80*_hhs,_hoy+35*_hhs);
_heartShape.bezierCurveTo(_hox+80*_hhs,_hoy+35*_hhs,  _hox+80*_hhs,_hoy,           _hox+50*_hhs,_hoy);
_heartShape.bezierCurveTo(_hox+35*_hhs,_hoy,           _hox+25*_hhs,_hoy+25*_hhs,  _hox+25*_hhs,_hoy+25*_hhs);
// Heart: a bevelled, faceted heart with a thin halo ring, baked into one geometry (no extra draw calls).
// Tube hearts reuse the geometry with their own colour material (which ignores the baked colours).
export const collectibleGeo = markShared((() => {
    const heart = new THREE.ExtrudeGeometry(_heartShape, { depth: collectibleRadius * 0.5, bevelEnabled: true, bevelSize: 0.22, bevelThickness: 0.2, bevelSegments: 2, curveSegments: 9 });
    heart.center();
    const halo = new THREE.TorusGeometry(collectibleRadius * 1.45, 0.06, 3, 28);
    return bake([part(heart, 0x28f07a), part(halo, 0xc6ffd9, { rx: 0.35 })]);
})());
export const collectibleMat = markShared(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, emissive: 0x0b7a34, metalness: 0.25, roughness: 0.35 }));
/** A hoop: a low-poly ring with red-and-white racing stripes. Collision reads its TorusGeometry radius and tube. */
function hoopGeometry(r) {
    const torus = new THREE.TorusGeometry(r, r * 0.2, 6, 20), g = torus.toNonIndexed(); // own vertices per face: crisp stripe edges
    g.parameters = torus.parameters; torus.dispose();
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i += 3) { // colour whole faces by the angle of their centre
        const x = p.getX(i) + p.getX(i + 1) + p.getX(i + 2), y = p.getY(i) + p.getY(i + 1) + p.getY(i + 2);
        const c = Math.floor(((Math.atan2(y, x) + Math.PI) / (Math.PI * 2)) * 10) % 2 ? [0.93, 0.92, 0.88] : [0.82, 0.12, 0.1];
        col.set(c, i * 3); col.set(c, i * 3 + 3); col.set(c, i * 3 + 6);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
}
/**
 * Hearts move: a constellation revolves slowly about its centre (`chain.spin` rad/s, alternating direction) while
 * each heart swirls on a small circle and bobs (effects.js, moveCollectible). No Math.random: the seeded map is unchanged.
 */
export const HEART_MOTION = Object.freeze({ swirl: 3.2, swirlRate: 0.9, clearance: 10 });
/** Place a heart for `time` seconds of flight (its chain turned, its swirl, its bob already in originY). */
export function moveCollectible(m, time) {
    const u = m.userData, c = u.chain;
    let x = u.originX, z = u.originZ;
    if (c) { const a = c.spin * time, dx = x - c.x, dz = z - c.z, co = Math.cos(a), si = Math.sin(a); x = c.x + dx * co - dz * si; z = c.z + dx * si + dz * co; }
    const w = time * HEART_MOTION.swirlRate + u.k;
    m.position.x = x + Math.cos(w) * HEART_MOTION.swirl; m.position.z = z + Math.sin(w) * HEART_MOTION.swirl;
}
function addCollectibleAt(x, y, z, constellationId, chain = null) {
    const m = new THREE.Mesh(collectibleGeo, collectibleMat);
    m.rotation.z = Math.PI; // heart shape is extruded with Y-up convention; flip to appear right-side up in world
    y = Math.max(heightAt(x, z) + 10, Math.min(ceilingLevel - 8, y)); // never inside a hill
    m.position.set(x, y, z);
    m.userData = { type: 'collectible', collisionRadius: collectibleRadius, constellationId: constellationId || null, originY: y, bobPhase: Math.random() * Math.PI * 2,
        originX: x, originZ: z, chain, k: collectibles.length * 2.39 };
    collectibles.push(m); scene.add(m);
}

// --- Chain Pattern Helpers (§3.4) ---
// Shared spatial patterns for collectibles and hoops — only the factory differs
const COLLECTIBLE_CFG = { helix: { n: 12, r: [15, 22], len: 120 }, circle: { n: 10, r: [20, 30] }, fig8: { n: 14, a: [28, 40], b: [14, 20] }, zigzag: { n: 10, amp: [10, 18], spacing: 16 } };
const HOOP_CFG        = { helix: { n:  5, r: 28,      len: 280 }, circle: { n:  5, r: 100       }, fig8: { n:  6, a: 90,       b: 45       }, zigzag: { n:  5, amp: 50,        spacing: 90 } };
function spawnChain(cx, cy, cz, cfg, addFn) {
    const pat = ~~(Math.random() * 5);
    if (pat === 0) {       // helix along Z
        const n = cfg.helix.n, r = rng(cfg.helix.r), len = cfg.helix.len;
        for (let j = 0; j < n; j++) { const t = (j / (n - 1)) * Math.PI * 3; addFn(cx + r * Math.cos(t), cy + r * Math.sin(t), cz + (j / (n - 1)) * len - len / 2); }
    } else if (pat === 1) { // helix along X
        const n = cfg.helix.n, r = rng(cfg.helix.r), len = cfg.helix.len;
        for (let j = 0; j < n; j++) { const t = (j / (n - 1)) * Math.PI * 3; addFn(cx + (j / (n - 1)) * len - len / 2, cy + r * Math.sin(t), cz + r * Math.cos(t)); }
    } else if (pat === 2) { // vertical circle in YZ
        const n = cfg.circle.n, r = rng(cfg.circle.r);
        for (let j = 0; j < n; j++) { const t = (j / n) * Math.PI * 2; addFn(cx, cy + r * Math.sin(t), cz + r * Math.cos(t)); }
    } else if (pat === 3) { // figure-8 (Lissajous 1:2)
        const n = cfg.fig8.n, a = rng(cfg.fig8.a), b = rng(cfg.fig8.b);
        for (let j = 0; j < n; j++) { const t = (j / (n - 1)) * Math.PI * 2; addFn(cx + a * Math.cos(t), cy + b * Math.sin(2 * t), cz + a * Math.sin(t) * Math.cos(t)); }
    } else {               // zigzag
        const n = cfg.zigzag.n, amp = rng(cfg.zigzag.amp), spacing = cfg.zigzag.spacing;
        for (let j = 0; j < n; j++) addFn(cx + (j % 2 === 0 ? amp : -amp), cy, cz + (j - n / 2) * spacing);
    }
}
export function spawnCollectibleChains(count) {
    for (let i = 0; i < count; i++) {
        const id = `c${i}`;
        const name = CONSTELLATION_NAMES[i % CONSTELLATION_NAMES.length];
        const before = collectibles.length;
        const cx = randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), cy = randomRange(groundLevel + 40, ceilingLevel - 40), cz = randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8);
        const chain = { x: cx, z: cz, spin: (i % 2 ? 1 : -1) * (0.05 + 0.02 * (i % 4)) }; // slow, alternating carousels
        spawnChain(cx, cy, cz, COLLECTIBLE_CFG, (x, y, z) => addCollectibleAt(x, y, z, id, chain));
        const total = collectibles.length - before;
        constellations[id] = { name, total, remaining: total, completed: false };
    }
}
// Dashed axis line through the hole of a torus — parented so it inherits rotation
const _hoopAxisMat = markShared(new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 3, gapSize: 3, opacity: 0.45, transparent: true }));
function _addHoopAxis(torusMesh, r) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -r * 1.3), new THREE.Vector3(0, 0, r * 1.3)]);
    const line = new THREE.Line(geo, _hoopAxisMat);
    line.computeLineDistances();
    torusMesh.add(line);
}
export function spawnHoopChains(count) {
    const addHoop = (x, y, z, corridorId) => {
        const r = randomRange(15, 30);
        y = Math.max(heightAt(x, z) + r + 8, Math.min(ceilingLevel - r - 8, y));
        const m = new THREE.Mesh(hoopGeometry(r), torusMaterial);
        m.position.set(x, y, z); m.rotation.set(randomRange(0, Math.PI), randomRange(0, Math.PI), 0);
        _addHoopAxis(m, r);
        const mk = new THREE.Mesh(markerGeometry, markerMaterial); mk.position.copy(m.position);
        mk.userData = { type: 'marker', collisionRadius: markerRadius, hoopMesh: m, corridorId: corridorId || null };
        m.updateMatrixWorld(true);
        m.userData = { type: 'torus', markerMesh: mk, boundingBox: new THREE.Box3().setFromObject(m), matrixWorldInverse: new THREE.Matrix4().copy(m.matrixWorld).invert() }; // (§2.2)
        markers.push(mk); obstacles.push(m); scene.add(m, mk);
    };
    for (let i = 0; i < count; i++) {
        const id = `r${i}`;
        const name = CORRIDOR_NAMES[i % CORRIDOR_NAMES.length];
        const before = markers.length;
        spawnChain(randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), randomRange(groundLevel + 50, ceilingLevel - 50), randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), HOOP_CFG, (x, y, z) => addHoop(x, y, z, id));
        const total = markers.length - before;
        // Chain axis line — dashed polyline through every hoop centre in order
        let axisLine = null;
        if (total >= 2) {
            const pts = markers.slice(before).map(mk => mk.position.clone());
            const ageo = new THREE.BufferGeometry().setFromPoints(pts);
            axisLine = new THREE.Line(ageo, new THREE.LineDashedMaterial({ color: 0xff8800, dashSize: 10, gapSize: 7, opacity: 0.35, transparent: true }));
            axisLine.computeLineDistances();
            scene.add(axisLine);
        }
        corridors[id] = { name, total, remaining: total, completed: false, axisLine };
    }
}
export function spawnSingleHoopWithMarker() {
    const x = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9), z = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9);
    const r = randomRange(15, 30);
    const m = new THREE.Mesh(hoopGeometry(r), torusMaterial);
    m.position.set(x, Math.max(heightAt(x, z) + r + 10, randomRange(groundLevel + r + 15, ceilingLevel - r - 15)), z);
    m.rotation.set(randomRange(0, Math.PI), randomRange(0, Math.PI), 0);
    _addHoopAxis(m, r);
    const mk = new THREE.Mesh(markerGeometry, markerMaterial); mk.position.copy(m.position);
    mk.userData = { type: 'marker', collisionRadius: markerRadius, hoopMesh: m };
    m.updateMatrixWorld(true);
    m.userData = { type: 'torus', markerMesh: mk, boundingBox: new THREE.Box3().setFromObject(m), matrixWorldInverse: new THREE.Matrix4().copy(m.matrixWorld).invert() }; // (§2.2)
    markers.push(mk); obstacles.push(m); scene.add(m, mk);
}
