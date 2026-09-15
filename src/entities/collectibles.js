/** Collectible heart chains, markers and hoop chains. */
import { MAP_BOUNDARY, ceilingLevel, groundLevel } from '../config.js';
import { scene } from '../core/scene.js';
import { markShared, randomRange, rng } from '../core/utils.js';
import { collectibles, markers, obstacles } from './registry.js';
import { CONSTELLATION_NAMES, CORRIDOR_NAMES, constellations, corridors } from './names.js';
import { torusMaterial } from './obstacles.js';

// --- Marker / collectible resources ---
export const markerRadius = 5, markerGeometry = markShared(new THREE.SphereGeometry(markerRadius, 16, 16));
const markerMaterial = markShared(new THREE.MeshStandardMaterial({ color: 0xFFD700, emissive: 0xccad00 }));
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
export const collectibleGeo = markShared(new THREE.ExtrudeGeometry(_heartShape, { depth: collectibleRadius * 0.45, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 2 }));
export const collectibleMat = markShared(new THREE.MeshStandardMaterial({ color: 0x00ff44, emissive: 0x006622 }));
function addCollectibleAt(x, y, z, constellationId) {
    const m = new THREE.Mesh(collectibleGeo, collectibleMat);
    m.rotation.z = Math.PI; // heart shape is extruded with Y-up convention; flip to appear right-side up in world
    y = Math.max(groundLevel + 8, Math.min(ceilingLevel - 8, y));
    m.position.set(x, y, z);
    m.userData = { type: 'collectible', collisionRadius: collectibleRadius, constellationId: constellationId || null, originY: y, bobPhase: Math.random() * Math.PI * 2 };
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
        spawnChain(randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), randomRange(groundLevel + 40, ceilingLevel - 40), randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), COLLECTIBLE_CFG, (x, y, z) => addCollectibleAt(x, y, z, id));
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
        y = Math.max(groundLevel + r + 8, Math.min(ceilingLevel - r - 8, y));
        const m = new THREE.Mesh(new THREE.TorusGeometry(r, r * .2, 8, 24), torusMaterial);
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
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, r * .2, 8, 24), torusMaterial);
    m.position.set(x, randomRange(groundLevel + r + 15, ceilingLevel - r - 15), z);
    m.rotation.set(randomRange(0, Math.PI), randomRange(0, Math.PI), 0);
    _addHoopAxis(m, r);
    const mk = new THREE.Mesh(markerGeometry, markerMaterial); mk.position.copy(m.position);
    mk.userData = { type: 'marker', collisionRadius: markerRadius, hoopMesh: m };
    m.updateMatrixWorld(true);
    m.userData = { type: 'torus', markerMesh: mk, boundingBox: new THREE.Box3().setFromObject(m), matrixWorldInverse: new THREE.Matrix4().copy(m.matrixWorld).invert() }; // (§2.2)
    markers.push(mk); obstacles.push(m); scene.add(m, mk);
}
