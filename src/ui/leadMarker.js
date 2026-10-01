/**
 * Lead marker: where to point the guns to hit the target you are aiming at.
 *
 * The target is the hostile closest to the nose (within LEAD_RANGE and a forward cone). Its velocity is measured
 * from frame to frame, so it works on every target: aces, fighters, ground units, bosses, other players. The
 * intercept point assumes it keeps flying straight — a turning target still needs a pilot's judgement.
 *
 *   gun pipper  small ring: where your bullets will be at that distance
 *   lead ring   the intercept point; spinning arcs close in as your aim gets better, with a dotted guide line
 *               from the pipper to it
 *   HOT         on target and in gun range: the ring turns gold, glows and pulses, "» FIRE «" chevrons
 *   hit         each hit sends a ring out; a kill bursts "SPLASH!"
 */
import { bulletLife, bulletSpeed } from '../config.js';
import { camera } from '../core/scene.js';
import { state } from '../state.js';
import { plane } from '../player/plane.js';
import { entityKind, entityPosition, isAlive, isHostile, missileTargets } from '../entities/contract.js';

const LEAD_RANGE = 650;                        // world units: the marker appears within this
const GUN_RANGE = bulletLife * bulletSpeed;     // how far a bullet flies
const CONE = Math.cos(0.6);                     // targets within ~34° of the nose
const COLD = '#33e6ff', WARM = '#ffb020', HOT = '#ffe066';

const canvas = document.createElement('canvas');
canvas.id = 'lead-marker';
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:101;';
document.body.appendChild(canvas);
const g = canvas.getContext('2d');
const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
resize(); addEventListener('resize', resize);

const tracks = new WeakMap(); // entity → { p: last position, v: smoothed velocity per frame }
const _fwd = new THREE.Vector3(), _to = new THREE.Vector3(), _lead = new THREE.Vector3(), _gun = new THREE.Vector3(), _s = new THREE.Vector3();
let target = null, pickFrame = 0, spin = 0, hotTime = 0, lastHitTimer = 0;
const bursts = []; // { x, y, age, kind: 'hit' | 'kill' }
let lastScreen = null, lastTargetAlive = null, stats = { target: null, inRange: false, aligned: false };

const radiusOf = e => (entityKind(e) === 'ground' ? e.userData.collisionRadius : entityKind(e) === 'air' ? e.collisionRadius : 5) ?? 5;

/** The hostile closest to the nose, within range and the forward cone. */
function pickTarget() {
    plane.getWorldDirection(_fwd);
    let best = null, bestCos = CONE;
    for (const e of missileTargets()) {
        if (!isAlive(e) || !isHostile(e)) continue;
        _to.copy(entityPosition(e)).sub(plane.position);
        const d = _to.length();
        if (d > LEAD_RANGE || d < 1) continue;
        const c = _fwd.dot(_to.divideScalar(d));
        if (c > bestCos) { bestCos = c; best = e; }
    }
    return best;
}

/** Screen position of a world point, or null when behind the camera. */
function toScreen(p) {
    _s.copy(p).project(camera);
    if (_s.z > 1) return null;
    return { x: (_s.x * 0.5 + 0.5) * canvas.width, y: (-_s.y * 0.5 + 0.5) * canvas.height };
}

/** Once per rendered frame. */
export function drawLeadMarker(rawDelta) {
    g.clearRect(0, 0, canvas.width, canvas.height);
    const frames = Math.min(rawDelta * 60, 6);
    if (state.isGameOver || state.isPaused || state.awaitingStart || state._playerDown) { target = null; bursts.length = 0; return; }

    if (++pickFrame >= 4 || (target && !isAlive(target))) { pickFrame = 0; target = pickTarget(); }
    // A kill of the marked target: SPLASH!
    if (lastTargetAlive && !isAlive(lastTargetAlive) && lastScreen) bursts.push({ x: lastScreen.x, y: lastScreen.y, age: 0, kind: 'kill' });
    lastTargetAlive = target;
    drawBursts(frames);
    if (!target) { lastScreen = null; stats = { target: null, inRange: false, aligned: false }; return; }

    // Velocity from frame to frame (smoothed), then the intercept point: bullets fly bulletSpeed per frame along the nose
    const pos = entityPosition(target);
    let tr = tracks.get(target);
    if (!tr) tracks.set(target, tr = { p: pos.clone(), v: new THREE.Vector3() });
    else if (frames > 0) { _to.subVectors(pos, tr.p).divideScalar(frames); tr.v.lerp(_to, 0.35); tr.p.copy(pos); }
    let t = pos.distanceTo(plane.position) / bulletSpeed;
    for (let i = 0; i < 2; i++) { _lead.copy(pos).addScaledVector(tr.v, t); t = _lead.distanceTo(plane.position) / bulletSpeed; }
    const dist = _lead.distanceTo(plane.position);
    plane.getWorldDirection(_fwd);
    _gun.copy(plane.position).addScaledVector(_fwd, dist);
    const err = _fwd.angleTo(_to.subVectors(_lead, plane.position));
    const tol = Math.atan2(radiusOf(target) + 1, dist);
    const inRange = dist < GUN_RANGE, aligned = err < tol, hot = inRange && aligned;
    stats = { target: target.id ?? target.userData?.id ?? 'enemy', inRange, aligned, dist: Math.round(dist), err: +err.toFixed(3), tol: +tol.toFixed(3) };

    const L = toScreen(_lead), G = toScreen(_gun);
    lastScreen = L;
    if (!L) return;
    hotTime = hot ? hotTime + rawDelta : 0;
    spin += rawDelta * (hot ? 9 : 2.5);
    const colour = hot ? HOT : inRange ? WARM : COLD;
    const close = THREE.MathUtils.clamp(err / (tol * 6), 0, 1); // 0 = dead on … 1 = far off
    const R = 13 + 30 * close;

    // A hit on anything while marked: a ring goes out
    if (state._hitMarkerTimer > lastHitTimer && hot) bursts.push({ x: L.x, y: L.y, age: 0, kind: 'hit' });
    lastHitTimer = state._hitMarkerTimer;

    g.save();
    g.lineCap = 'round';
    // Guide line from the gun pipper to the lead ring
    if (G && !aligned) {
        g.setLineDash([3, 7]); g.lineDashOffset = -spin * 6;
        g.strokeStyle = colour; g.globalAlpha = 0.55; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(G.x, G.y); g.lineTo(L.x, L.y); g.stroke();
        g.setLineDash([]);
    }
    // Gun pipper
    if (G) {
        g.globalAlpha = 0.85; g.strokeStyle = '#e8fff4'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(G.x, G.y, 5, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.arc(G.x, G.y, 1.2, 0, Math.PI * 2); g.fillStyle = '#e8fff4'; g.fill();
    }
    // Lead ring: three spinning arcs closing in, a centre diamond
    const pulse = hot ? 1 + 0.12 * Math.sin(hotTime * 18) : 1;
    g.globalAlpha = 1; g.strokeStyle = colour; g.lineWidth = hot ? 3 : 2;
    if (hot) { g.shadowColor = HOT; g.shadowBlur = 16; }
    for (let i = 0; i < 3; i++) {
        const a = spin + i * (Math.PI * 2 / 3);
        g.beginPath(); g.arc(L.x, L.y, R * pulse, a, a + 1.25); g.stroke();
    }
    const d = 4.5 * pulse;
    g.beginPath(); g.moveTo(L.x, L.y - d); g.lineTo(L.x + d, L.y); g.lineTo(L.x, L.y + d); g.lineTo(L.x - d, L.y); g.closePath();
    g.fillStyle = colour; g.fill();
    g.shadowBlur = 0;
    // Range and time to target; FIRE chevrons when hot
    g.font = 'bold 11px "Share Tech Mono", monospace'; g.textAlign = 'center'; g.fillStyle = colour;
    g.fillText(`${Math.round(dist)} m · ${(t / 60).toFixed(1)} s`, L.x, L.y + R * pulse + 16);
    if (hot) {
        const off = R * pulse + 14 + 4 * Math.sin(hotTime * 14);
        g.font = 'bold 16px "Share Tech Mono", monospace';
        g.fillText('»', L.x - off, L.y + 5); g.fillText('«', L.x + off, L.y + 5);
        g.font = 'bold 12px "Share Tech Mono", monospace'; g.fillText('FIRE', L.x, L.y - R * pulse - 10);
    }
    g.restore();
}

function drawBursts(frames) {
    for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.age += frames;
        const life = b.kind === 'kill' ? 48 : 18, k = b.age / life;
        if (k >= 1) { bursts.splice(i, 1); continue; }
        g.save();
        g.globalAlpha = 1 - k;
        g.strokeStyle = b.kind === 'kill' ? HOT : '#ffffff'; g.lineWidth = b.kind === 'kill' ? 3 : 2;
        g.beginPath(); g.arc(b.x, b.y, 10 + k * (b.kind === 'kill' ? 70 : 34), 0, Math.PI * 2); g.stroke();
        if (b.kind === 'kill') {
            g.font = `bold ${20 + 10 * (1 - k)}px "Share Tech Mono", monospace`; g.textAlign = 'center';
            g.fillStyle = HOT; g.shadowColor = '#ff8800'; g.shadowBlur = 12;
            g.fillText('SPLASH!', b.x, b.y - 26 - k * 20);
        }
        g.restore();
    }
}

/** For tests: the current target and solution. */
export const leadStats = () => stats;
