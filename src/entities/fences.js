/**
 * Base compounds: a fenced perimeter around every land base's core (hangars, airport, trucks — the tanks patrol
 * outside the wire), watchtowers with searchlights at the corners, and a gate facing the map centre.
 *
 * What the fence means in play:
 *   alert zone   flying low inside the perimeter trips the base alarm — its turrets fire faster, its searchlights
 *                turn red, and you get a warning (updateBasePerimeters)
 *   towers       hold the searchlights; bombs and missiles knock towers and fence sections down (_damageFenceNear),
 *                and a fallen tower's searchlight goes dark. Towers are solid: flying into one is a crash.
 *   damage       the fence scorches and sags as the base loses units (_updateFenceDamageState)
 *
 * The perimeter is the smallest-area rectangle (any heading) around the core's footprint, plus a margin; posts
 * stand on the terrain and the fence stops where the rectangle reaches the sea (the shore is the barrier there).
 */
import { waterLevel } from '../config.js';
import { scene } from '../core/scene.js';
import { heightAt } from '../world/terrain.js';
import { _fenceRegistry, _flagMeshes, baseMarkers } from './registry.js';
import { disposeGroup, markShared } from '../core/utils.js';
import { createVirtualLight, removeVirtualLight } from '../effects/lightBudget.js';
import { bake, kitMaterial, part } from '../core/meshkit.js';
import { plane } from '../player/plane.js';
import { triggerGameOver } from '../game/gameOver.js';
import { showNotification } from '../ui/notifications.js';

export const _searchlights = []; // F6: searchlight sweepers (towers here, control towers in bases.js)
const perimeters = [];           // { name, reg, bases, cx, cz, cos, sin, hu, hv, ground, towers: [{ x, z, top, mesh }], warned }

const FENCE = Object.freeze({
    margin: 16,        // beyond the core footprint
    minHalf: 32,       // smallest half-size of a compound
    postGap: 10,       // posts every 10 units
    chunkPanels: 5,    // fence sections (the destructible pieces) are 5 panels long
    height: 4.4,
    gateWidth: 18,
    towerTop: 16.5,
    alertAltitude: 70, // above the compound's ground: lower than this inside the fence trips the alarm
});

// --- Shared resources -------------------------------------------------------------------------------------
const chainLinkTexture = markShared((() => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(210,210,200,1)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(32, 32); g.moveTo(32, 0); g.lineTo(0, 32); g.stroke(); // diamond mesh
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
})());
const flagMat = new THREE.MeshBasicMaterial({ color: 0xcc2200, side: THREE.DoubleSide });
const COL = { steel: 0x7d7f78, darkSteel: 0x4a4c48, wood: 0x6b5236, roof: 0x3f4a35, lamp: 0xe8e0b0, red: 0xb3261e, white: 0xe8e4da, cream: 0xcfc6a8, window: 0x223038, sand: 0xa89668 };
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

// Baked, shared geometries (local space, one mesh each)
const towerGeo = markShared(bake([
    ...CORNERS.map(([sx, sz]) => part(new THREE.BoxGeometry(0.45, 12.6, 0.45), COL.wood, { x: sx * 2.1, y: 6.2, z: sz * 2.1, rx: -sz * 0.08, rz: sx * 0.08 })), // splayed legs
    ...[4, 8.5].flatMap(y => [0, 1, 2, 3].map(i => part(new THREE.BoxGeometry(0.2, 0.2, 5.4), COL.wood, { x: [0, 2.0, 0, -2.0][i], y, z: [2.0, 0, -2.0, 0][i], ry: i % 2 ? 0 : Math.PI / 2, rx: i % 2 ? 0.6 : 0, rz: i % 2 ? 0 : 0.6 }))), // braces
    part(new THREE.BoxGeometry(6.2, 0.5, 6.2), COL.wood, { y: 12.4 }),                                  // platform
    part(new THREE.BoxGeometry(6.2, 1.1, 0.18), COL.wood, { y: 13.2, z: 3 }),                           // railings
    part(new THREE.BoxGeometry(6.2, 1.1, 0.18), COL.wood, { y: 13.2, z: -3 }),
    part(new THREE.BoxGeometry(0.18, 1.1, 6.2), COL.wood, { y: 13.2, x: 3 }),
    part(new THREE.BoxGeometry(0.18, 1.1, 6.2), COL.wood, { y: 13.2, x: -3 }),
    ...CORNERS.map(([sx, sz]) => part(new THREE.BoxGeometry(0.22, 2.6, 0.22), COL.wood, { x: sx * 2.9, y: 13.9, z: sz * 2.9 })), // roof posts
    part(new THREE.ConeGeometry(4.6, 1.9, 4), COL.roof, { y: 16.1, ry: Math.PI / 4 }),                   // hipped roof
    part(new THREE.CylinderGeometry(0.55, 0.7, 1.1, 8), COL.darkSteel, { y: 13.3, z: 1.8, rx: Math.PI / 2 }), // searchlight housing
    part(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 8), COL.lamp, { y: 13.3, z: 2.37, rx: Math.PI / 2 }),
]));
const gatePillarGeo = markShared(bake([0, 1, 2, 3, 4].map(i => part(new THREE.BoxGeometry(1.3, 1.25, 1.3), i % 2 ? COL.white : COL.red, { y: 0.62 + i * 1.25 }))));
const boomGeo = markShared(bake([0, 1, 2, 3, 4, 5].map(i => part(new THREE.BoxGeometry(0.32, 0.32, 2.6), i % 2 ? COL.white : COL.red, { z: 1.3 + i * 2.6 }))));
const boothGeo = markShared(bake([
    part(new THREE.BoxGeometry(3.6, 3.2, 3.6), COL.cream, { y: 1.6 }),
    part(new THREE.BoxGeometry(3.7, 0.9, 3.7), COL.window, { y: 2.3 }),       // window band
    part(new THREE.BoxGeometry(4.6, 0.35, 4.6), COL.roof, { y: 3.4 }),
]));
const sandbagWallGeo = markShared(bake(
    [0, 1, 2].flatMap(row => [-3, -1, 1, 3].map(i => part(new THREE.CylinderGeometry(0.55, 0.62, 1.9, 6), COL.sand, { x: i + (row % 2) * 0.9 - 0.45, y: 0.45 + row * 0.62, rz: Math.PI / 2, sx: 0.8 })))
));

// --- Build ---------------------------------------------------------------------------------------------------
const _wp = new THREE.Vector3();
/** Local airport footprint (runway 40 × 200 along its Z, terminal and tower at +X) — see groundUnits.js. */
const AIRPORT_FOOTPRINT = [[-24, -106], [24, -106], [24, 106], [-24, 106], [36, -34], [36, 10]];

function footprint(bm) {
    const pts = [];
    for (const u of bm.units) {
        const type = u.userData?.type;
        if (!type || type === 'tank') continue; // tanks guard the approaches outside the wire
        u.getWorldPosition(_wp);
        if (type === 'airport') {
            const c = Math.cos(u.rotation.y), s = Math.sin(u.rotation.y);
            for (const [lx, lz] of AIRPORT_FOOTPRINT) pts.push([_wp.x + lx * c + lz * s, _wp.z - lx * s + lz * c]);
        } else {
            const r = type === 'hangar' ? 25 : 7;
            pts.push([_wp.x - r, _wp.z - r], [_wp.x + r, _wp.z - r], [_wp.x + r, _wp.z + r], [_wp.x - r, _wp.z + r]);
        }
    }
    if (!pts.length) pts.push([bm.position.x, bm.position.z]);
    return pts;
}

/** Smallest-area rectangle around the points, over headings 0…90° in 2.5° steps. */
function fitRectangle(pts) {
    let best = null;
    for (let a = 0; a < Math.PI / 2; a += Math.PI / 72) {
        const c = Math.cos(a), s = Math.sin(a);
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const [x, z] of pts) { const u = x * c + z * s, v = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
        const area = (u1 - u0 + 2 * FENCE.margin) * (v1 - v0 + 2 * FENCE.margin);
        if (!best || area < best.area) best = { area, c, s, u: (u0 + u1) / 2, v: (v0 + v1) / 2, hu: Math.max(FENCE.minHalf, (u1 - u0) / 2 + FENCE.margin), hv: Math.max(FENCE.minHalf, (v1 - v0) / 2 + FENCE.margin) };
    }
    return { cx: best.u * best.c - best.v * best.s, cz: best.u * best.s + best.v * best.c, cos: best.c, sin: best.s, hu: best.hu, hv: best.hv };
}

const onLand = (x, z) => heightAt(x, z) > waterLevel + 0.4;

export function buildBaseFences() {
    for (const bm of baseMarkers) {
        if (!bm.units.length || bm.position.y <= waterLevel + 0.5) continue; // land bases only (fleets are at sea)
        const R = fitRectangle(footprint(bm));
        const toWorld = (u, v) => [R.cx + u * R.cos - v * R.sin, R.cz + u * R.sin + v * R.cos];
        const reg = { posts: [], bases: [bm] };
        _fenceRegistry[bm.id] = reg;
        // One frame material and one mesh material per compound, so damage tints stay within it
        const frameMat = markShared(kitMaterial());
        const meshMat = markShared(new THREE.MeshStandardMaterial({ map: chainLinkTexture, alphaTest: 0.35, side: THREE.DoubleSide, color: 0xb8b8ae, metalness: 0.35, roughness: 0.6 }));
        const P = { name: bm.name, reg, bases: [bm], cx: R.cx, cz: R.cz, cos: R.cos, sin: R.sin, hu: R.hu, hv: R.hv, ground: heightAt(R.cx, R.cz), towers: [], warned: false };
        perimeters.push(P);

        // Corners (counter-clockwise) and the gate edge: the one whose outward normal faces the map centre
        const corners = CORNERS.map(([su, sv]) => toWorld(su * R.hu, sv * R.hv));
        let gateEdge = 0, bestDot = -Infinity;
        for (let e = 0; e < 4; e++) {
            const [ax, az] = corners[e], [bx, bz] = corners[(e + 1) % 4], nx = (ax + bx) / 2 - R.cx, nz = (az + bz) / 2 - R.cz;
            const dot = (nx * -R.cx + nz * -R.cz) / (Math.hypot(nx, nz) * (Math.hypot(R.cx, R.cz) || 1));
            if (dot > bestDot) { bestDot = dot; gateEdge = e; }
        }

        // Fence sections along each edge (leaving the gate gap), posts on the terrain, none over water
        for (let e = 0; e < 4; e++) {
            const [ax, az] = corners[e], [bx, bz] = corners[(e + 1) % 4];
            const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
            const n = Math.max(1, Math.round(len / FENCE.postGap)), step = len / n;
            const gapFrom = e === gateEdge ? len / 2 - FENCE.gateWidth / 2 : Infinity, gapTo = len / 2 + FENCE.gateWidth / 2;
            const posts = [];
            for (let k = 0; k <= n; k++) {
                const t = k * step, x = ax + dx * t, z = az + dz * t;
                posts.push(t > gapFrom && t < gapTo || !onLand(x, z) ? null : { x, z, y: heightAt(x, z) });
            }
            for (let k = 0; k < n; k += FENCE.chunkPanels) buildSection(posts.slice(k, k + FENCE.chunkPanels + 1), dx, dz, reg, frameMat, meshMat);
        }
        // Watchtowers at the corners that stand on land
        for (const [x, z] of corners) if (onLand(x, z)) buildTower(x, z, bm, reg, frameMat, P);
        buildGate(corners[gateEdge], corners[(gateEdge + 1) % 4], R, reg, frameMat);
    }
}

/** One destructible fence section: posts, top rail and a barbed-wire coil (one baked frame), and chain-link panels. */
function buildSection(posts, dx, dz, reg, frameMat, meshMat) {
    const H = FENCE.height, parts = [], quads = [];
    for (let i = 0; i < posts.length; i++) {
        const p = posts[i];
        if (!p) continue;
        parts.push(part(new THREE.BoxGeometry(0.28, H + 0.6, 0.28), COL.steel, { x: p.x, y: p.y + (H + 0.6) / 2, z: p.z }));
        parts.push(part(new THREE.BoxGeometry(0.12, 0.12, 0.9), COL.darkSteel, { x: p.x - dz * 0.3, y: p.y + H + 0.55, z: p.z + dx * 0.3, ry: Math.atan2(-dz, dx) + Math.PI / 2, rx: -0.5 })); // outrigger
        const q = posts[i + 1];
        if (!q) continue;
        quads.push([p, q]);
        const len = Math.hypot(q.x - p.x, q.z - p.z), top = Math.max(p.y, q.y) + H;
        parts.push(part(new THREE.BoxGeometry(0.1, 0.1, len), COL.darkSteel, { x: (p.x + q.x) / 2, y: top, z: (p.z + q.z) / 2, ry: Math.atan2(q.x - p.x, q.z - p.z) }));
        for (let s = 0; s < 6; s++) { // concertina coil: short slanted strands zig-zagging along the top (baked, no extra draw call)
            const t = (s + 0.5) / 6;
            parts.push(part(new THREE.BoxGeometry(0.07, 0.07, 0.9), 0x9a9a90, { x: p.x + (q.x - p.x) * t, y: top + 0.75, z: p.z + (q.z - p.z) * t, ry: Math.atan2(q.x - p.x, q.z - p.z) + (s % 2 ? 0.9 : -0.9), rx: s % 2 ? 0.5 : -0.5 }));
        }
    }
    if (!parts.length) return;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(bake(parts), frameMat));
    if (quads.length) {
        const pos = [], uv = [], r = H / 1.6; // the texture repeats every 1.6 units
        for (const [p, q] of quads) {
            const u = Math.hypot(q.x - p.x, q.z - p.z) / 1.6;
            pos.push(p.x, p.y, p.z, q.x, q.y, q.z, q.x, q.y + H, q.z, p.x, p.y, p.z, q.x, q.y + H, q.z, p.x, p.y + H, p.z);
            uv.push(0, 0, u, 0, u, r, 0, 0, u, r, 0, r);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.computeVertexNormals();
        g.add(new THREE.Mesh(geo, meshMat));
    }
    scene.add(g);
    const standing = posts.filter(Boolean), mid = standing[Math.floor(standing.length / 2)];
    reg.posts.push({ mesh: g, worldPos: new THREE.Vector3(mid.x, mid.y + H / 2, mid.z) });
}

/** A corner watchtower with a sweeping searchlight (range 90 — the airport control-tower lights use 140). */
function buildTower(x, z, bm, reg, frameMat, P) {
    const y = heightAt(x, z);
    const m = new THREE.Mesh(towerGeo, frameMat);
    m.position.set(x, y, z); m.rotation.y = Math.atan2(x - P.cx, z - P.cz); // searchlight side faces out
    scene.add(m);
    const slY = y + 13.3;
    const spot = createVirtualLight(0xffffaa, 1.2, 120, x, slY, z); // lit via the light budget
    reg.posts.push({ mesh: m, worldPos: new THREE.Vector3(x, y + 8, z), light: spot });
    reg.posts.push({ mesh: spot, worldPos: new THREE.Vector3(x, slY, z) });
    P.towers.push({ x, z, top: y + FENCE.towerTop, mesh: m });
    _searchlights.push({ spot, worldPos: new THREE.Vector3(x, slY, z), angle: Math.random() * Math.PI * 2,
        speed: (0.004 + Math.random() * 0.004) * (Math.random() > 0.5 ? 1 : -1), range: 90, halfAngle: Math.PI / 7, baseIds: [bm.id] });
}

/** Striped pillars, a boom barrier, a guard booth inside and a sandbag chicane outside; one part down takes all. */
function buildGate([ax, az], [bx, bz], R, reg, frameMat) {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (!onLand(mx, mz)) return;
    const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
    const ol = Math.hypot(mx - R.cx, mz - R.cz), ox = (mx - R.cx) / ol, oz = (mz - R.cz) / ol; // outward
    const along = Math.atan2(dx, dz), half = FENCE.gateWidth / 2, gy = heightAt(mx, mz), start = reg.posts.length;
    const add = (geo, x, z, ry, y = gy) => { const m = new THREE.Mesh(geo, frameMat); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); reg.posts.push({ mesh: m, worldPos: new THREE.Vector3(x, y + 2, z) }); };
    add(gatePillarGeo, mx - dx * half, mz - dz * half, along);
    add(gatePillarGeo, mx + dx * half, mz + dz * half, along);
    add(boomGeo, mx - dx * half, mz - dz * half, along, gy + 3.1);                 // pivots at one pillar, spans the gap
    add(boothGeo, mx - dx * (half + 4) - ox * 6, mz - dz * (half + 4) - oz * 6, along);
    add(sandbagWallGeo, mx + ox * 12 - dx * 4, mz + oz * 12 - dz * 4, along + Math.PI / 2);
    add(sandbagWallGeo, mx + ox * 20 + dx * 4, mz + oz * 20 + dz * 4, along + Math.PI / 2);
    // Flag over the gate (main.js turns it with the wind)
    const fp = new THREE.Group(); fp.position.set(mx + dx * half, gy + 9.5, mz + dz * half);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 5), frameMat); pole.position.y = -1.7;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 1.8), flagMat.clone()); flag.position.set(1.75, -0.9, 0);
    fp.add(pole, flag); scene.add(fp);
    reg.posts.push({ mesh: fp, worldPos: fp.position.clone() });
    _flagMeshes.push({ mesh: fp });
    const gate = reg.posts.slice(start);
    for (const g of gate) g.gateGroup = gate;
}

// --- Play ------------------------------------------------------------------------------------------------------
/** Per simulated frame while flying: low flight inside a compound trips its alarm; towers are solid. */
export function updateBasePerimeters() {
    const p = plane.position;
    for (const P of perimeters) {
        if (P.bases.every(b => b.eliminated)) continue;
        const dx = p.x - P.cx, dz = p.z - P.cz, u = dx * P.cos + dz * P.sin, v = -dx * P.sin + dz * P.cos;
        if (Math.abs(u) < P.hu + 6 && Math.abs(v) < P.hv + 6) {
            for (const t of P.towers) if (t.mesh.parent && (p.x - t.x) ** 2 + (p.z - t.z) ** 2 < 3.6 * 3.6 && p.y < t.top) { triggerGameOver(); return; }
        }
        if (Math.abs(u) < P.hu && Math.abs(v) < P.hv && p.y < P.ground + FENCE.alertAltitude) {
            P.reg.alarmState = true; P.reg.alarmTimer = 480; // ai.js: this base's turrets fire faster
            for (const sl of _searchlights) {
                if (!sl.baseIds.some(id => P.bases.some(b => b.id === id))) continue;
                if (!sl.idleColor) sl.idleColor = sl.spot.color.clone();
                sl.spot.color.setHex(0xff4400); sl.alarmed = true;
            }
            if (!P.warned) { P.warned = true; showNotification(`⚠ ${P.name} — perimeter breached, defences alerted`, false, { local: true }); }
        } else if (!P.reg.alarmState) P.warned = false;
    }
}

// F5: knock down fence sections, towers and gates within `radius` of an explosion
export function _damageFenceNear(pos, radius) {
    const rSq = radius * radius;
    for (const reg of new Set(Object.values(_fenceRegistry))) {
        const toRemove = new Set();
        for (const p of reg.posts) {
            if (pos.distanceToSquared(p.worldPos) >= rSq) continue;
            toRemove.add(p.mesh);
            if (p.light) toRemove.add(p.light);                       // a tower takes its searchlight with it
            if (p.gateGroup) p.gateGroup.forEach(gp => toRemove.add(gp.mesh));
        }
        if (!toRemove.size) continue;
        for (let pi = reg.posts.length - 1; pi >= 0; pi--) {
            const m = reg.posts[pi].mesh;
            if (!toRemove.has(m)) continue;
            if (m.isVirtualLight) {
                // Virtual searchlight: the real light pool is fixed, so removal never recompiles shaders
                removeVirtualLight(m);
                const i = _searchlights.findIndex(sl => sl.spot === m);
                if (i > -1) _searchlights.splice(i, 1);
            } else {
                scene.remove(m);
                disposeGroup(m); // frees only what this piece owns; shared geometries and compound materials stay
                const fi = _flagMeshes.findIndex(f => f.mesh === m);
                if (fi > -1) _flagMeshes.splice(fi, 1);
            }
            reg.posts.splice(pi, 1);
        }
    }
}

// F10: scorch and sag the compound as its base loses units
export function _updateFenceDamageState(bmId) {
    const reg = _fenceRegistry[bmId];
    if (!reg) return;
    let alive = 0, total = 0;
    for (const bm of reg.bases) { alive += bm.alive; total += bm.total; }
    const dmg = total > 0 ? 1 - alive / total : 0; // 0 intact … 1 wiped out
    const tint = new THREE.Color(1, 1, 1).lerp(new THREE.Color(0.45, 0.28, 0.16), dmg);
    reg.posts.forEach(p => {
        if (p.mesh.isVirtualLight) return;
        p.mesh.traverse(child => { if (child.isMesh && child.material?.color && !child.material.map) child.material.color.copy(tint); });
        if (!p.tiltApplied && dmg > 0.15 && Math.random() < dmg * 0.2) {
            p.mesh.rotation.z += (Math.random() - 0.5) * 0.3 * dmg;
            p.mesh.rotation.x += (Math.random() - 0.5) * 0.2 * dmg;
            p.tiltApplied = true;
        }
    });
}
