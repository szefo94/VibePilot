/**
 * Fire and smoke on ground targets.
 *
 *   buildings (hangars, airports) burn once they drop below 75 % HP, harder as they lose more
 *   napalm sets any ground unit alight for BURN.napalmFrames; a burning building keeps taking fire damage, so
 *            napalm can bring a hangar down on its own
 *   wrecks   every destroyed ground unit smoulders for a while
 *
 * Particles are two GPU point clouds (additive flames, soft smoke) — one draw call each, however many fires burn.
 */
import { scene } from '../core/scene.js';
import { markShared } from '../core/utils.js';
import { beginHits } from '../combat/hits.js';

const BURN = Object.freeze({
    buildingFrom: 0.25,    // damage share (1 − hp/maxHp) at which a building starts to burn
    napalmFrames: 600,     // 10 s alight after a napalm hit
    burnTick: 30,          // frames between fire-damage ticks while napalm-alight
    burnDamage: { hangar: 3, airport: 3 }, // per tick; other units only look alight (napalm patches already hurt them)
    wreckFrames: 900,      // destroyed units smoulder 15 s
});
const BUILDINGS = new Set(['hangar', 'airport']);
const MAX = 900;

/** One point cloud: positions, per-particle size, alpha and colour. */
function cloud(additive) {
    const geo = new THREE.BufferGeometry();
    const attr = (n, size) => { const a = new THREE.BufferAttribute(new Float32Array(MAX * size), size); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(n, a); return a; };
    const c = { pos: attr('position', 3), size: attr('size', 1), alpha: attr('alpha', 1), color: attr('color', 3), n: 0, p: [] };
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC;
            void main() { vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * 520.0 / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying float vA; varying vec3 vC;
            void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC, a); }`,
    });
    c.points = new THREE.Points(geo, markShared(mat));
    c.points.frustumCulled = false;
    scene.add(c.points);
    return c;
}
const flames = cloud(true), smoke = cloud(false);

function emit(c, x, y, z, vx, vy, vz, life, s0, s1, col0, col1, a0) {
    if (c.p.length >= MAX) return;
    c.p.push({ x, y, z, vx, vy, vz, life, max: life, s0, s1, col0, col1, a0 });
}

const burning = new Map(); // ground unit → { anchors: [Vector3], napalm, tick, building }
const wrecks = [];         // { anchors, life, size }
const _box = new THREE.Box3(), _c = new THREE.Vector3();

/** Where flames rise from: the tops of a unit's structures (flat pieces like runways are skipped). */
function anchorsOf(unit) {
    const out = [];
    unit.updateMatrixWorld(true);
    for (const child of unit.children) {
        if (!child.isMesh) continue;
        _box.setFromObject(child);
        const h = _box.max.y - _box.min.y;
        if (h < 2) continue;
        _box.getCenter(_c);
        out.push(new THREE.Vector3(_c.x, _box.max.y - 0.5, _c.z));
        const sx = _box.max.x - _box.min.x, sz = _box.max.z - _box.min.z;
        if (Math.max(sx, sz) > 25) { // long roofs: two more fires along them
            const along = sx > sz ? new THREE.Vector3(sx * 0.3, 0, 0) : new THREE.Vector3(0, 0, sz * 0.3);
            out.push(out[out.length - 1].clone().add(along), out[out.length - 1].clone().sub(along));
        }
    }
    if (!out.length) { _box.setFromObject(unit); _box.getCenter(_c); out.push(new THREE.Vector3(_c.x, _box.max.y, _c.z)); }
    return out;
}

/** Called by combat/hits.js for every damaged ground unit. `remote`: applied from another player (no fire damage here). */
export function onUnitDamaged(unit, weapon, remote = false) {
    const building = BUILDINGS.has(unit.userData.type);
    if (!building && weapon !== 'napalm') return;
    let e = burning.get(unit);
    if (!e) { e = { anchors: anchorsOf(unit), napalm: 0, tick: BURN.burnTick, building, remote }; burning.set(unit, e); }
    if (weapon === 'napalm') { e.napalm = BURN.napalmFrames; e.remote = remote; }
}

/** Called when a ground unit is destroyed: it keeps smouldering for a while. */
export function onUnitKilled(unit) {
    const e = burning.get(unit);
    wrecks.push({ anchors: e ? e.anchors : anchorsOf(unit), life: BURN.wreckFrames, size: BUILDINGS.has(unit.userData.type) ? 1.4 : 0.8 });
    burning.delete(unit);
}

const FIRE0 = [1, 0.85, 0.35], FIRE1 = [0.9, 0.2, 0.05], SMOKE0 = [0.22, 0.2, 0.19], SMOKE1 = [0.45, 0.44, 0.43];
function burnAt(a, strength, spread) {
    if (Math.random() < strength) emit(flames, a.x + (Math.random() - 0.5) * spread, a.y, a.z + (Math.random() - 0.5) * spread, (Math.random() - 0.5) * 0.04, 0.12 + Math.random() * 0.12, (Math.random() - 0.5) * 0.04, 26 + Math.random() * 20, 3 + strength * 4, 1, FIRE0, FIRE1, 0.9);
    if (Math.random() < strength * 0.45) emit(smoke, a.x + (Math.random() - 0.5) * spread, a.y + 2, a.z + (Math.random() - 0.5) * spread, 0.02 + Math.random() * 0.03, 0.09 + Math.random() * 0.05, (Math.random() - 0.5) * 0.03, 150 + Math.random() * 60, 4, 16 + strength * 10, SMOKE0, SMOKE1, 0.55);
}

/** Per simulated frame (effects.js). */
export function updateFires(dt) {
    for (const [unit, e] of burning) {
        const ud = unit.userData;
        if (!(ud.hp > 0) || ud._alive === false) { burning.delete(unit); continue; }
        const damage = e.building ? 1 - ud.hp / ud.maxHp : 0;
        const strength = Math.max(damage >= BURN.buildingFrom ? 0.35 + damage * 0.65 : 0, e.napalm > 0 ? 0.8 : 0);
        if (strength > 0) for (const a of e.anchors) for (let k = 0; k < Math.ceil(dt); k++) burnAt(a, strength, e.building ? 6 : 2.5);
        if (e.napalm > 0) {
            e.napalm -= dt; e.tick -= dt;
            const dmg = BURN.burnDamage[ud.type];
            if (dmg && e.tick <= 0 && !e.remote) { e.tick = BURN.burnTick; const hits = beginHits('napalm'); hits.damage(unit, dmg); hits.finish(); }
        }
    }
    for (let i = wrecks.length - 1; i >= 0; i--) {
        const w = wrecks[i];
        w.life -= dt;
        const s = Math.max(0, w.life / BURN.wreckFrames) * 0.7 * w.size;
        for (const a of w.anchors) for (let k = 0; k < Math.ceil(dt); k++) burnAt(a, s, 4 * w.size);
        if (w.life <= 0) wrecks.splice(i, 1);
    }
    for (const c of [flames, smoke]) {
        let n = 0;
        for (let i = c.p.length - 1; i >= 0; i--) {
            const q = c.p[i];
            q.life -= dt;
            if (q.life <= 0) { c.p[i] = c.p[c.p.length - 1]; c.p.pop(); continue; }
            q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        }
        for (const q of c.p) {
            const t = 1 - q.life / q.max; // 0 → 1 over the particle's life
            c.pos.array[n * 3] = q.x; c.pos.array[n * 3 + 1] = q.y; c.pos.array[n * 3 + 2] = q.z;
            c.size.array[n] = q.s0 + (q.s1 - q.s0) * t;
            c.alpha.array[n] = q.a0 * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
            c.color.array[n * 3] = q.col0[0] + (q.col1[0] - q.col0[0]) * t; c.color.array[n * 3 + 1] = q.col0[1] + (q.col1[1] - q.col0[1]) * t; c.color.array[n * 3 + 2] = q.col0[2] + (q.col1[2] - q.col0[2]) * t;
            n++;
        }
        c.points.geometry.setDrawRange(0, n);
        c.pos.needsUpdate = c.size.needsUpdate = c.alpha.needsUpdate = c.color.needsUpdate = true;
    }
}

/** For tests: how much is burning. */
export const fireStats = () => ({ burning: burning.size, wrecks: wrecks.length, flames: flames.p.length, smoke: smoke.p.length });
