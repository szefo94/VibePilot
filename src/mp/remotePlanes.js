/**
 * Other players' planes (shared skies). Each peer is drawn from the server's room snapshots, INTERP_DELAY behind
 * the server clock so there are always two snapshots to blend between: position lerp, rotation slerp. When
 * snapshots run late it extrapolates along the last velocity for up to EXTRAPOLATE_MAX, then holds.
 */
import { scene } from '../core/scene.js';
import { createExplosion } from '../effects/effects.js';
import { net, serverNow } from '../net/net.js';

const INTERP_DELAY = 100;    // ms — two snapshots at 20 Hz, plus jitter
const EXTRAPOLATE_MAX = 250; // ms
const STALE_MS = 3000;       // no snapshot for this long: hide the plane
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
const bodyMats = new Map(); // color → material

function buildPlane(slot) {
    const color = colorOf(slot);
    if (!bodyMats.has(color)) bodyMats.set(color, new THREE.MeshStandardMaterial({ color }));
    const body = bodyMats.get(color), g = new THREE.Group();
    const nose = new THREE.Mesh(noseGeo, trimMat); nose.position.z = 2.6;
    const fin = new THREE.Mesh(finGeo, body); fin.position.set(0, 0.75, -1.8);
    const stab = new THREE.Mesh(stabGeo, body); stab.position.z = -1.8;
    g.add(new THREE.Mesh(fuselageGeo, body), nose, new THREE.Mesh(wingGeo, body), fin, stab);
    return g;
}

/** Name tag: constant size on screen, drawn over terrain so a far-away friend stays findable. */
function buildLabel(name, slot) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 8, 256, 48);
    ctx.fillStyle = cssColor(slot); ctx.fillRect(0, 8, 8, 48);
    ctx.font = 'bold 30px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.fillText(name, 132, 33);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    sprite.scale.set(0.16, 0.04, 1); sprite.renderOrder = 2;
    return sprite;
}

const views = new Map(); // peer id → { group, label, alive, name, slot }
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

function viewFor(peer) {
    let v = views.get(peer.id);
    if (!v) {
        v = { group: buildPlane(peer.slot), label: buildLabel(peer.name, peer.slot), alive: true, name: peer.name, slot: peer.slot };
        v.group.visible = v.label.visible = false;
        scene.add(v.group, v.label);
        views.set(peer.id, v);
    }
    return v;
}
function dispose(id, v) {
    scene.remove(v.group, v.label);
    v.label.material.map.dispose(); v.label.material.dispose();
    views.delete(id);
}

/** Interpolated pose of `peer` at server time `t` into group; returns the sample's alive flag, or null if no data. */
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
        return s0.alive && s1.alive;
    }
    if (t > s0.t && n > 1) { // past the newest: extrapolate briefly along the last velocity
        const prev = samples[n - 2], ext = Math.min(t - s0.t, EXTRAPOLATE_MAX) / (s0.t - prev.t);
        group.position.fromArray(s0.p).addScaledVector(_b.fromArray(s0.p).sub(_a.fromArray(prev.p)), s0.alive && prev.alive ? ext : 0);
    } else group.position.fromArray(s0.p);
    group.quaternion.fromArray(s0.q);
    return s0.alive;
}

/** Once per rendered frame. */
export function updateRemotePlanes() {
    const now = serverNow(), t = now - INTERP_DELAY;
    for (const peer of net.peers.values()) {
        const v = viewFor(peer);
        const alive = sampleAt(peer.samples, t, v.group);
        const newest = peer.samples[peer.samples.length - 1];
        const shown = alive === true && now - newest.t < STALE_MS;
        if (v.alive && alive === false) createExplosion(v.group.position, 1); // shot down / crashed
        if (alive !== null) v.alive = alive;
        v.group.visible = v.label.visible = shown;
        if (shown) v.label.position.copy(v.group.position).y += 4;
    }
    for (const [id, v] of views) if (!net.peers.has(id)) dispose(id, v);
}

/** Minimap blips for visible peers (game/hooks.js 'radarBlips'). */
export function remoteRadarBlips(blips) {
    for (const v of views.values()) {
        if (v.group.visible) blips.push({ wx: v.group.position.x, wz: v.group.position.z, color: cssColor(v.slot), shape: 'ace', label: v.name });
    }
}

/** Remove every remote plane (connection lost). */
export function clearRemotePlanes() { for (const [id, v] of views) dispose(id, v); }
