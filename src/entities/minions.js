/**
 * Boss minions (entities/bosses.js 'minions' attack): the kraken's squidlings and Specimen 47's facehuggers.
 *
 *   flying   they home in on a pilot (slower than a missile, faster than a cruising plane) and can be shot down
 *   latched  one that reaches its pilot clings to the plane and bites: it drains MINION.drain of the pilot's max HP
 *            over MINION.latch frames, then drops off dead
 *   shake    rolling hard (MINION.shakeRate of the max roll rate, for MINION.shakeFrames) throws every latched
 *            minion off
 *
 * Targets come from `minionTargets()` (the local player; multiplayer's host adds the others through
 * setMinionTargets). Damage to a remote target goes to `remoteBite(targetId, damage)`.
 */
import { maxRollRate } from '../config.js';
import { state } from '../state.js';
import { scene } from '../core/scene.js';
import { plane } from '../player/plane.js';
import { bullets } from './registry.js';
import { damagePlayer, removeBullet } from '../combat/collision.js';
import { createExplosion } from '../effects/effects.js';
import { difficulty } from '../core/settings.js';
import { showNotification } from '../ui/notifications.js';

export const MINION = Object.freeze({ max: 8, speed: 1.15, turn: 0.045, life: 720, drain: 0.12, latch: 360, bites: 12, shakeRate: 0.7, shakeFrames: 45, hp: 3 });

const minions = []; // { kind, group, v, phase: 'fly' | 'latched', life, target, offset, bitten, hp, t, anim }
const localTarget = { id: 'local', local: true, get position() { return plane.position; }, get alive() { return !state.isGameOver && !state._playerDown; } };
let targetsFn = () => [localTarget], remoteBite = null, shake = 0;
const warn = document.createElement('div');
warn.id = 'parasite-warning'; warn.hidden = true; warn.setAttribute('role', 'alert');
document.body.appendChild(warn);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/** Multiplayer: who minions may chase ([{ id, local, position, alive }]) and how bites on others are delivered. */
export function setMinionTargets(targets, onBite) { targetsFn = targets || (() => [localTarget]); remoteBite = onBite || null; }

// --- Models ------------------------------------------------------------------------------------------------------------
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, flatShading: true, ...o });
const glow = color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.3, flatShading: true });
function squidling() {
    const g = new THREE.Group(), skin = mat(0xc04a7a), eye = glow(0xffe27a);
    const mantle = new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 10), skin); mantle.scale.set(1, 1.7, 1); mantle.position.z = -0.8; mantle.rotation.x = Math.PI / 2; g.add(mantle);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), eye); e.position.set(s * 0.6, 0.3, 0.5); g.add(e); }
    const arms = [];
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2, arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.2, 2.4, 8), skin);
        arm.geometry.translate(0, -1.2, 0); arm.position.set(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.6); arm.rotation.x = -Math.PI / 2;
        g.add(arm); arms.push(arm);
    }
    return { group: g, animate: (t, latched) => arms.forEach((a, i) => { a.rotation.y = Math.sin(t * (latched ? 22 : 9) + i) * 0.5; }) };
}
function facehugger() {
    const g = new THREE.Group(), flesh = mat(0xd8c49a, { roughness: 0.4 }), dark = mat(0x8a7350), eye = glow(0x8aff66);
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 10), flesh); body.scale.set(1, 0.45, 1.2); g.add(body);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), eye); e.position.set(s * 0.4, 0.4, 0.9); g.add(e); }
    const legs = [];
    for (let i = 0; i < 8; i++) {
        const side = i < 4 ? -1 : 1, k = i % 4, leg = new THREE.Group();
        leg.position.set(side * 0.8, 0, 0.7 - k * 0.5);
        const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.4, 8), dark); upper.position.x = side * 0.6; upper.rotation.z = side * 1.2;
        const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.2, 8), dark); lower.position.set(side * 1.2, -0.45, 0); lower.rotation.z = -side * 0.4;
        leg.add(upper, lower); g.add(leg); legs.push(leg);
    }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.2, 3.2, 8), flesh); tail.position.z = -2.4; tail.rotation.x = Math.PI / 2; g.add(tail);
    return { group: g, animate: (t, latched) => { legs.forEach((l, i) => { l.rotation.z = Math.sin(t * (latched ? 16 : 7) + i) * 0.35; }); tail.rotation.y = Math.sin(t * 6) * 0.4; } };
}
const MODELS = { squid: squidling, hugger: facehugger };

// --- Behaviour -----------------------------------------------------------------------------------------------------

/** Launch `count` minions of `kind` ('squid' | 'hugger') from `from`, aimed roughly at the nearest target. */
export function spawnMinions(kind, from, count) {
    for (let i = 0; i < count && minions.length < MINION.max; i++) {
        const { group, animate } = MODELS[kind]();
        group.position.copy(from).add(_v.set((Math.random() - 0.5) * 8, Math.random() * 4, (Math.random() - 0.5) * 8));
        group.scale.setScalar(1.6);
        scene.add(group);
        const target = nearestTarget(group.position);
        const v = target ? _w.subVectors(target.position, group.position).normalize().multiplyScalar(0.7).add(_v.set((Math.random() - 0.5) * 0.6, 0.35, (Math.random() - 0.5) * 0.6)) : _w.set(0, 0.5, 0);
        minions.push({ kind, group, v: v.clone(), phase: 'fly', life: MINION.life, target, offset: null, bitten: 0, hp: MINION.hp, t: Math.random() * 5, anim: animate });
    }
}
function nearestTarget(p) {
    let best = null, bestD = Infinity;
    for (const t of targetsFn()) { const d = t.alive ? t.position.distanceTo(p) : Infinity; if (d < bestD) { bestD = d; best = t; } }
    return best;
}
function kill(i, splat = true) {
    const m = minions[i];
    if (splat) createExplosion(m.group.position, 0.5);
    scene.remove(m.group);
    minions.splice(i, 1);
}
/** Remove them all (the boss is gone). */
export function clearMinions() { for (let i = minions.length - 1; i >= 0; i--) kill(i, false); }

/** Every step (entities/bosses.js). */
export function updateMinions(dt) {
    // Rolling hard shakes latched minions off the local plane
    shake = Math.abs(state.rollRate) > maxRollRate * MINION.shakeRate ? shake + dt : Math.max(0, shake - dt * 0.5);
    let onMe = 0, worst = 0;
    for (let i = minions.length - 1; i >= 0; i--) {
        const m = minions[i], g = m.group;
        m.t += dt / 60; m.life -= dt;
        m.anim(m.t, m.phase === 'latched');
        if (m.phase === 'fly') {
            if (!m.target?.alive) m.target = nearestTarget(g.position);
            if (m.target) { // home in, with a wobble
                _v.subVectors(m.target.position, g.position).normalize().multiplyScalar(MINION.speed);
                m.v.lerp(_v, MINION.turn * dt);
                m.v.x += Math.sin(m.t * 7) * 0.01; m.v.y += Math.cos(m.t * 5) * 0.01;
            }
            g.position.addScaledVector(m.v, dt);
            g.lookAt(_w.copy(g.position).add(m.v));
            // Shot down by the player's bullets
            for (let b = bullets.length - 1; b >= 0; b--) if (bullets[b].position.distanceTo(g.position) < 3) { removeBullet(bullets[b], b); m.hp--; }
            if (m.hp <= 0 || m.life <= 0) { kill(i); continue; }
            if (m.target && m.target.position.distanceTo(g.position) < 5) { // it latches on
                m.phase = 'latched'; m.life = MINION.latch;
                m.offset = new THREE.Vector3((Math.random() - 0.5) * 8, 0.8, (Math.random() - 0.5) * 3);
                if (m.target.local) showNotification(m.kind === 'squid' ? '⚠ A SQUIDLING LATCHED ON — ROLL HARD!' : '⚠ A FACEHUGGER LATCHED ON — ROLL HARD!', true, { local: true });
            }
        } else {
            const t = m.target;
            if (!t?.alive) { kill(i); continue; }
            // Ride the plane (the local one exactly; a remote one by its position)
            if (t.local) { g.position.copy(m.offset).applyMatrix4(plane.matrixWorld); g.quaternion.copy(plane.quaternion); }
            else g.position.copy(t.position).add(m.offset);
            // Bite: MINION.drain of max HP over the latch, in MINION.bites bites
            const every = MINION.latch / MINION.bites, before = Math.floor((MINION.latch - m.life - dt) / every), now = Math.floor((MINION.latch - m.life) / every);
            if (now > before && m.bitten < MINION.bites) {
                m.bitten++;
                const dmg = Math.max(1, Math.round((state.maxHP * MINION.drain * difficulty().enemyDamage) / MINION.bites));
                if (t.local) damagePlayer(dmg, g.position); else remoteBite?.(t.id, dmg);
            }
            if (t.local) { onMe++; worst = Math.max(worst, 1 - m.life / MINION.latch); }
            if (m.life <= 0 || (t.local && shake > MINION.shakeFrames)) {
                if (t.local && m.life > 0) showNotification('Shook it off!', false, { local: true });
                kill(i);
            }
        }
    }
    if (shake > MINION.shakeFrames && !onMe) shake = 0;
    warn.hidden = !onMe;
    if (onMe) warn.textContent = `⚠ ${onMe} PARASITE${onMe > 1 ? 'S' : ''} BITING — ROLL HARD TO SHAKE ${onMe > 1 ? 'THEM' : 'IT'} OFF ${'▮'.repeat(Math.ceil((1 - worst) * 6))}`;
}

/** For tests and the multiplayer host: the minions in flight or latched. */
export const minionList = () => minions;
