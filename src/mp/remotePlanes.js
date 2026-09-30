/**
 * Other players' planes. Each peer is drawn from the server's room snapshots, INTERP_DELAY behind the server
 * clock so there are always two snapshots to blend between: position lerp, rotation slerp. When snapshots run
 * late it extrapolates along the last velocity for up to EXTRAPOLATE_MAX, then holds.
 *
 * Each plane carries a name tag with an HP bar, sized in the world like the plane and shown only within LABEL_RANGE
 * (faded out towards its end), and the aiming laser when its pilot has it on (STATE.f). In PvP a plane is also a proxy air unit in `airUnits`, so every
 * weapon, the lock-on reticle and missile homing treat it as a target; hits.js hands its hits to `onHit`
 * (which reports them to the server) instead of damaging it locally.
 */
import { camera, scene } from '../core/scene.js';
import { createExplosion } from '../effects/effects.js';
import { airUnits } from '../entities/registry.js';
import { net, serverNow } from '../net/net.js';
import { FLAGS } from '../net/protocol.js';

const INTERP_DELAY = 100;    // ms — two snapshots at 20 Hz, plus jitter
const EXTRAPOLATE_MAX = 250; // ms
const STALE_MS = 3000;       // no snapshot for this long: hide the plane
const LABEL_RANGE = 320, LABEL_FADE = 90; // name tags: fully visible up to RANGE − FADE, gone beyond RANGE
const COLORS = [0xff5555, 0x55aaff, 0xffcc33, 0x66dd66, 0xcc66ff, 0xff9933, 0x33dddd, 0xff66aa];
export const colorOf = slot => COLORS[(slot ?? 0) % COLORS.length];
export const cssColor = slot => `#${colorOf(slot).toString(16).padStart(6, '0')}`;

// Shared geometry — the player's airframe (player/plane.js); never disposed
const fuselageGeo = new THREE.CylinderGeometry(0.45, 0.6, 4, 12).rotateX(Math.PI / 2);
const noseGeo = new THREE.ConeGeometry(0.45, 1.2, 12).rotateX(Math.PI / 2);
const wingGeo = new THREE.BoxGeometry(12, 0.2, 1.5);
const finGeo = new THREE.BoxGeometry(0.2, 1.5, 1);
const stabGeo = new THREE.BoxGeometry(2.5, 0.15, 0.8);
const trimMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 2), new THREE.Vector3(0, 0, 1500)]); // as player/plane.js
const laserMat = new THREE.LineBasicMaterial({ color: 0x00ff00 });
const bodyMats = new Map(); // color → material

function buildPlane(slot) {
    const color = colorOf(slot);
    if (!bodyMats.has(color)) bodyMats.set(color, new THREE.MeshStandardMaterial({ color }));
    const body = bodyMats.get(color), g = new THREE.Group();
    const nose = new THREE.Mesh(noseGeo, trimMat); nose.position.z = 2.6;
    const fin = new THREE.Mesh(finGeo, body); fin.position.set(0, 0.75, -1.8);
    const stab = new THREE.Mesh(stabGeo, body); stab.position.z = -1.8;
    const laser = new THREE.Line(laserGeo, laserMat); laser.visible = false;
    g.add(new THREE.Mesh(fuselageGeo, body), nose, new THREE.Mesh(wingGeo, body), fin, stab, laser);
    g.userData.laser = laser;
    return g;
}

/** Name tag + HP bar above the plane, a little wider than its 12-unit wingspan; it shrinks with distance like the plane. */
function buildLabel(name, slot) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160;
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }));
    sprite.scale.set(14, 4.4, 1); sprite.renderOrder = 2;
    const label = { sprite, canvas, texture, name, slot, hp: -1 };
    drawLabel(label, 100);
    return label;
}
function drawLabel(label, hp) {
    hp = Math.max(0, Math.min(100, Math.round(hp)));
    if (hp === label.hp) return;
    label.hp = hp;
    const ctx = label.canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 160);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, 512, 160);
    ctx.fillStyle = cssColor(label.slot); ctx.fillRect(0, 0, 14, 160);
    ctx.font = 'bold 64px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.fillText(label.name, 263, 52, 470);
    const x = 34, y = 100, w = 458, h = 40;
    ctx.fillStyle = 'rgba(255,68,68,0.45)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = hp > 50 ? '#00ff88' : hp > 25 ? '#ffcc00' : '#ff4444'; ctx.fillRect(x, y, w * hp / 100, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, h);
    label.texture.needsUpdate = true;
}

const views = new Map(); // peer id → { group, label, alive, name, slot, unit }
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
let onHit = null, targetable = false;

/**
 * PvP: make remote planes targets. `hit(peerId, amount, weapon)` is called for every hit a weapon lands on one;
 * it reports the hit, and the damage is applied by that player and comes back in the next snapshots.
 */
export function enablePvpTargets(hit) { onHit = hit; targetable = true; }

function viewFor(peer) {
    let v = views.get(peer.id);
    if (!v) {
        v = { group: buildPlane(peer.slot), label: buildLabel(peer.name, peer.slot), alive: true, name: peer.name, slot: peer.slot, unit: null };
        v.group.visible = v.label.sprite.visible = false;
        scene.add(v.group, v.label.sprite);
        if (targetable) {
            // A proxy air unit (entities/contract.js AirUnit shape): hits.js routes its hits to onHit, ai.js skips it
            v.unit = {
                id: `peer-${peer.id}`, type: 'fighter', group: v.group, hp: 0, maxHp: 100, xpValue: 0,
                collisionRadius: 5, wingHalfSpan: 5, wingR: 3, wingType: 'q', // the airframe spans 12 units
                isHostile: true, baseId: null, label: null, userData: { baseId: null }, shootCooldown: 0,
                proxy: { damage: (amount, weapon) => onHit?.(peer.id, amount, weapon) },
            };
            airUnits.push(v.unit);
        }
        views.set(peer.id, v);
    }
    return v;
}
function dispose(id, v) {
    scene.remove(v.group, v.label.sprite);
    v.label.texture.dispose(); v.label.sprite.material.dispose();
    if (v.unit) { const i = airUnits.indexOf(v.unit); if (i >= 0) airUnits.splice(i, 1); }
    views.delete(id);
}

/** Interpolated pose of the samples at server time `t` into group; returns the sample, or null if there is no data. */
function sampleAt(samples, t, group) {
    const n = samples.length;
    if (!n) return null;
    let i = n - 1;
    while (i > 0 && samples[i].t > t) i--;
    const s0 = samples[i], s1 = samples[i + 1];
    if (s1 && t >= s0.t) { // between two snapshots
        const k = (t - s0.t) / (s1.t - s0.t);
        group.position.lerpVectors(_a.fromArray(s0.p), _b.fromArray(s1.p), k);
        group.quaternion.slerpQuaternions(_qa.fromArray(s0.q), _qb.fromArray(s1.q), k);
        return s0.alive && s1.alive ? s0 : (s0.alive ? s1 : s0); // report "down" as soon as either side is down
    }
    if (t > s0.t && n > 1) { // past the newest: extrapolate briefly along the last velocity
        const prev = samples[n - 2], ext = Math.min(t - s0.t, EXTRAPOLATE_MAX) / (s0.t - prev.t);
        group.position.fromArray(s0.p).addScaledVector(_b.fromArray(s0.p).sub(_a.fromArray(prev.p)), s0.alive && prev.alive ? ext : 0);
    } else group.position.fromArray(s0.p);
    group.quaternion.fromArray(s0.q);
    return s0;
}

/** Once per rendered frame. */
export function updateRemotePlanes() {
    const now = serverNow(), t = now - INTERP_DELAY;
    for (const peer of net.peers.values()) {
        const v = viewFor(peer);
        const s = sampleAt(peer.samples, t, v.group);
        const newest = peer.samples[peer.samples.length - 1];
        const alive = s ? s.alive : null;
        const shown = alive === true && now - newest.t < STALE_MS;
        if (v.alive && alive === false) createExplosion(v.group.position, 1); // shot down / crashed
        if (alive !== null) v.alive = alive;
        v.group.visible = shown; v.label.sprite.visible = false;
        v.group.userData.laser.visible = shown && ((newest.f ?? 0) & FLAGS.laser) !== 0;
        if (shown) { // name tag only up close, fading out towards LABEL_RANGE
            const d = camera.position.distanceTo(v.group.position), fade = Math.min(1, (LABEL_RANGE - d) / LABEL_FADE);
            v.label.sprite.visible = fade > 0;
            if (fade > 0) { v.label.sprite.material.opacity = fade; v.label.sprite.position.copy(v.group.position).y += 5; drawLabel(v.label, newest.hp ?? 100); }
        }
        if (v.unit) v.unit.hp = shown ? Math.max(1, newest.hp ?? 100) : 0; // hp 0 = not targetable (down, respawning, stale)
        v.shown = shown; v.firing = shown && ((newest.f ?? 0) & FLAGS.gun) !== 0; v.speed = newest?.s ?? 0; // no snapshot yet for a player who just joined
    }
    for (const [id, v] of views) if (!net.peers.has(id)) dispose(id, v);
}

/** Every remote plane view: { group, shown, firing, speed, … } (remoteFx.js draws their gunfire). */
export const remoteViews = () => views.values();

/** Current world position of a peer's plane (for hit-direction arcs), or null. */
export const peerPosition = id => views.get(id)?.group.position ?? null;

/** Minimap blips for visible peers (game/hooks.js 'radarBlips'). */
export function remoteRadarBlips(blips) {
    for (const v of views.values()) {
        if (v.group.visible) blips.push({ wx: v.group.position.x, wz: v.group.position.z, color: cssColor(v.slot), shape: 'ace', label: v.name });
    }
}

/** Remove every remote plane (connection lost). */
export function clearRemotePlanes() { for (const [id, v] of views) dispose(id, v); }
