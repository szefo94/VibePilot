/**
 * Tube challenges. Two kinds that must never be confused:
 *   challenge (teal)  SOLID: a glassy wall with a wire cage — flying through the wall destroys the plane. Enter and
 *                     leave through the glowing gates at its two ends (rings with chevrons pointing in).
 *   free (orange)     FLY-THROUGH: only a loose cloud of dots, no wall — cross it anywhere, collect its orbs.
 *
 * Tubes move: each drifts on a slow loop around where it was placed and sways about its vertical axis
 * (TUBE_MOTION), and its orbs slide back and forth along it. The curve, the mesh and the orbs (children of the mesh)
 * live in the tube's own frame, centred on its home; collisions test the plane in that frame (worldToLocal).
 * The motion uses no Math.random, so the seeded map is unchanged.
 */
import { ceilingLevel, groundLevel } from '../config.js';
import { scene } from '../core/scene.js';
import { markShared, randomRange } from '../core/utils.js';
import { onHook } from '../game/hooks.js';
import { collectibleGeo } from './collectibles.js';

// Shared looks (one set for every tube; per-tube meshes reuse the tube's own geometry)
const WALL_MAT = markShared(new THREE.MeshStandardMaterial({ color: 0x00ccff, emissive: 0x00505e, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
const GATE_MAT = markShared(new THREE.MeshBasicMaterial({ color: 0xaaffff, transparent: true, opacity: 0.95 }));
const GATE_GEO = markShared(new THREE.TorusGeometry(1, 0.07, 10, 40));
const CHEVRON_GEO = markShared(new THREE.ConeGeometry(0.16, 0.3, 4));
onHook('frame', () => { const t = performance.now() / 1000; GATE_MAT.opacity = 0.6 + 0.4 * Math.abs(Math.sin(t * 3)); WALL_MAT.opacity = 0.16 + 0.06 * Math.sin(t * 1.7); });
/** A challenge tube's gate at one end of its curve: a glowing ring with chevrons pointing into the tube. */
function gate(curve, end, radius) {
    const g = new THREE.Group(), at = curve.getPoint(end), inward = curve.getTangent(end).multiplyScalar(end === 0 ? 1 : -1);
    g.add(new THREE.Mesh(GATE_GEO, GATE_MAT));
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4, c = new THREE.Mesh(CHEVRON_GEO, GATE_MAT);
        c.position.set(Math.cos(a) * 1.25, Math.sin(a) * 1.25, -0.35); c.rotation.x = Math.PI / 2; // tips point along +Z: into the tube
        g.add(c);
    }
    g.position.copy(at); g.scale.setScalar(radius + 1.2);
    g.lookAt(at.clone().add(inward));
    return g;
}

// --- Tube challenges (ideas 7-9) ---
export const tubes = [];
export const TUBE_MOTION = Object.freeze({ drift: 42, rise: 9, period: 52, sway: 0.22, swayPeriod: 70, orbSlide: 0.025 }); // m, m, s, rad, s, share of the tube
export const TUBE_XP = 200;
// Persistent HUD for challenge tube runs
export const _tubeStatusEl = (() => { const el = document.createElement('div'); el.id = 'tube-status'; el.style.cssText = 'display:none;position:fixed;top:42%;left:50%;transform:translate(-50%,-50%);color:#00ccff;font:bold 20px monospace;text-align:center;text-shadow:0 0 10px #00ccff,0 0 20px #00ccff;pointer-events:none;z-index:200;letter-spacing:2px;'; document.body.appendChild(el); return el; })();
// --- Tube Challenges (ideas 7-9) ---
// Sample the curve at N points and return half the minimum pairwise distance
// between non-adjacent samples — gives the largest tube radius that won't self-intersect.
function computeSafeTubeRadius(curve, maxRadius, samples = 40, skipWindow = 4) {
    const pts = [];
    for (let i = 0; i < samples; i++) pts.push(curve.getPoint(i / (samples - 1)));
    let minDist = Infinity;
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + skipWindow; j < pts.length; j++) {
            const d = pts[i].distanceTo(pts[j]);
            if (d < minDist) minDist = d;
        }
    }
    return Math.min(maxRadius, minDist * 0.5 - 1); // leave 1-unit gap
}
// Find nearest t ∈ [0,1] on a CatmullRomCurve3 and distance to that point
export function _nearestTubeT(curve, pos) {
    const N = 24; let bestT = 0, bestD = Infinity;
    for (let i = 0; i <= N; i++) { const t = i / N, d = pos.distanceTo(curve.getPoint(t)); if (d < bestD) { bestD = d; bestT = t; } }
    const step = 1 / N;
    for (let i = 0; i <= 10; i++) { const t = Math.max(0, Math.min(1, bestT - step / 2 + (i / 10) * step)); const d = pos.distanceTo(curve.getPoint(t)); if (d < bestD) { bestD = d; bestT = t; } }
    return { t: bestT, d: bestD };
}
// Tubes are mathematical hollow tunnels; fly inside and collect all orbs for big XP
const MIN_TUBE_RADIUS = 12, MAX_TUBE_RADIUS = 20, TUBE_PATH_TRIES = 6;
// Random helix / S-curve / corkscrew control points around (cx, cy, cz), clamped into valid airspace
function buildTubePath(cx, cy, cz) {
    const patType = ~~(Math.random() * 3);
    const pts = [];
    if (patType === 0) { // Helix
        const turns = randomRange(2, 3.5), r = randomRange(55, 90), h = randomRange(40, 75);
        for (let k = 0; k <= 22; k++) {
            const t = k / 22;
            pts.push(new THREE.Vector3(cx + Math.cos(t * Math.PI * 2 * turns) * r, cy + (t - 0.5) * h, cz + Math.sin(t * Math.PI * 2 * turns) * r));
        }
    } else if (patType === 1) { // Sine S-curve
        const amp = randomRange(30, 55), len = randomRange(260, 420);
        for (let k = 0; k <= 22; k++) {
            const t = k / 22;
            pts.push(new THREE.Vector3(cx + (t - 0.5) * len, cy + Math.sin(t * Math.PI * 4) * amp * 0.5, cz + Math.sin(t * Math.PI * 2) * amp));
        }
    } else { // Corkscrew dive
        const r = randomRange(45, 75);
        for (let k = 0; k <= 22; k++) {
            const t = k / 22;
            const ang = t * Math.PI * 3;
            pts.push(new THREE.Vector3(cx + Math.cos(ang) * r * (1 - t * 0.3), cy + Math.sin(ang * 0.7) * 18, cz + Math.sin(ang) * r * (1 - t * 0.3)));
        }
    }
    // Clamp Y into valid airspace
    pts.forEach(p => { p.y = Math.max(groundLevel + 30, Math.min(ceilingLevel - 30, p.y)); });
    return pts;
}
export function spawnTube(cx, cy, cz, type = 'challenge') {
    const labels = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
    const name = `Tube ${labels[tubes.length % labels.length]}`;
    // Regenerate the path until it can hold the minimum radius without self-intersecting,
    // rather than forcing the radius up past the safe bound
    let curve = null, tubeRadius = -Infinity;
    for (let attempt = 0; attempt < TUBE_PATH_TRIES && tubeRadius < MIN_TUBE_RADIUS; attempt++) {
        const candidate = new THREE.CatmullRomCurve3(buildTubePath(cx, cy, cz));
        const safeRadius = computeSafeTubeRadius(candidate, MAX_TUBE_RADIUS);
        if (safeRadius > tubeRadius) { curve = candidate; tubeRadius = safeRadius; }
    }
    if (tubeRadius < MIN_TUBE_RADIUS) { console.warn(`spawnTube: no self-intersection-free path near (${Math.round(cx)}, ${Math.round(cz)}); skipped`); return; }
    const home = new THREE.Vector3(cx, cy, cz); // the tube lives in its own frame around here, so it can move
    curve = new THREE.CatmullRomCurve3(curve.points.map(p => p.clone().sub(home)));
    const tubeGeo = new THREE.TubeGeometry(curve, 48, tubeRadius, 8, false);
    const isChallenge = type === 'challenge';
    const tubeColor  = isChallenge ? 0x00ccff : 0xff8800; // cyan = challenge, orange = free
    const orbColor   = isChallenge ? 0x00ccff : 0xff8800;
    // Challenge: wire cage + glassy wall + gates (solid). Free: just dots (fly-through).
    const tubeMesh = isChallenge
        ? new THREE.Mesh(tubeGeo, new THREE.MeshBasicMaterial({ color: tubeColor, wireframe: true, transparent: true, opacity: 0.55 }))
        : new THREE.Points(tubeGeo, new THREE.PointsMaterial({ color: tubeColor, size: 1.4, transparent: true, opacity: 0.6, depthWrite: false }));
    if (isChallenge) { tubeMesh.add(new THREE.Mesh(tubeGeo, WALL_MAT), gate(curve, 0, tubeRadius), gate(curve, 1, tubeRadius)); }
    tubeMesh.position.copy(home);
    scene.add(tubeMesh);
    // Place collectibles at even intervals along the curve
    const numTC = 10, tubeCols = [];
    for (let k = 0; k <= numTC; k++) {
        const pos = curve.getPoint(k / numTC).clone().add(home);
        pos.y = Math.max(groundLevel + 5, Math.min(ceilingLevel - 5, pos.y));
        pos.sub(home); // in the tube's frame
        const tcm = new THREE.Mesh(collectibleGeo, new THREE.MeshStandardMaterial({ color: orbColor, emissive: orbColor, emissiveIntensity: 0.4 }));
        tcm.rotation.z = Math.PI; // match regular hearts — flip upside-down ExtrudeGeometry
        tcm.position.copy(pos);
        tcm.userData = { originY: pos.y, bobPhase: Math.random() * Math.PI * 2, t: k / numTC, dy: pos.y - curve.getPoint(k / numTC).y };
        tubeMesh.add(tcm); // rides with the tube
        tubeCols.push(tcm);
    }
    const totalOrbs = tubeCols.length;
    // challenge-specific state; free tubes carry the same fields but logic ignores them
    tubes.push({ mesh: tubeMesh, geo: tubeGeo, curve, tubeRadius, name, collectibles: tubeCols,
        completed: false, cx, cz, home, phase: tubes.length * 1.7, isChallenge,
        state: 'idle',   // 'idle' | 'entered' | 'done'
        entryT: null, inRunCollected: 0, totalOrbs,
        wasInside: false });
}
/** Move a tube for `time` seconds of flight: drift on a slow loop, rise and sink, sway; its orbs slide along it. */
export function moveTube(tube, time) {
    const M = TUBE_MOTION, a = (time / M.period) * Math.PI * 2 + tube.phase;
    tube.mesh.position.set(tube.home.x + Math.sin(a) * M.drift, tube.home.y + Math.sin(a * 2) * M.rise, tube.home.z + Math.sin(a + Math.PI / 2) * Math.cos(a * 0.5) * M.drift);
    tube.mesh.rotation.y = Math.sin((time / M.swayPeriod) * Math.PI * 2 + tube.phase) * M.sway;
    tube.mesh.updateMatrixWorld(true);
    for (const o of tube.collectibles) { // slide along the tube (bobbing on top: effects.js)
        const t = Math.min(1, Math.max(0, o.userData.t + Math.sin(time * 0.7 + o.userData.t * 9) * M.orbSlide)), p = tube.curve.getPoint(t);
        o.position.x = p.x; o.position.z = p.z; o.userData.originY = p.y + o.userData.dy;
    }
}
/** The plane's position in a tube's own frame (for its walls and gates). */
export const tubeLocal = (tube, world, out) => tube.mesh.worldToLocal(out.copy(world));

// --- Visual Effects Subsystem (ideas 1-6, 10) ---
// Idea 7-9 tube ribbon banner
export function showTubeRibbon(name, xp = TUBE_XP) {
    const el = document.createElement('div');
    el.className = 'tube-ribbon';
    el.innerHTML = `&#9889; ${name} &mdash; COMPLETE &#9889;<br><span style="font-size:16px">+${xp} XP &mdash; STRENGTH ENHANCED</span>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
    setTimeout(() => { el.classList.remove('visible'); el.classList.add('fade-out'); setTimeout(() => el.remove(), 800); }, 3500);
}
