/**
 * Other players' shots, drawn on this screen — visuals only (hits are decided by the shooter, see index.js).
 *
 *   gun      tracers from the nose of every remote plane whose snapshot says it is firing (STATE.f)
 *   missile  the pair from FIRE: drop, then accelerate and home on the target player (or fly straight)
 *   flare    a burst of bright particles around the plane
 *   bomb     falls under gravity and explodes at the water line
 *   napalm   a spray of burning orbs that bursts into fire at the water line
 *
 * Timing and speeds follow the real weapons (config.js), so it looks like what the shooter sees.
 */
import { MISSILE_ACCEL, MISSILE_DROP_PHASE, MISSILE_FINAL_SPEED, MISSILE_INITIAL_SPEED, bulletSpeed, gravity, missileLife, shootCooldownTime, waterLevel } from '../config.js';
import { scene } from '../core/scene.js';
import { _up3 } from '../core/scratch.js';
import { createExplosion } from '../effects/effects.js';
import { plane } from '../player/plane.js';
import { _bombBodyGeo, _createMissileMesh, _flarePGeo, _flarePMatBase, _missileTrailGeo, _missileTrailMat, _napClusterOrbGeo, _napClusterOrbMat, bombMaterial } from '../combat/resources.js';
import { net } from '../net/net.js';
import { peerPosition, remoteViews } from './remotePlanes.js';

const TRACER_LIFE = 90;                                   // frames
const tracerGeo = new THREE.CylinderGeometry(0.12, 0.12, 3, 5); // Y-aligned; oriented along the velocity
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffcc44 });
const fx = [];        // { mesh, vel, life, kind, … }
const tracerPool = [];
const _v = new THREE.Vector3(), _fwd = new THREE.Vector3(), _to = new THREE.Vector3();

function add(mesh, props) { scene.add(mesh); fx.push({ mesh, ...props }); }
function remove(i) {
    const f = fx[i];
    scene.remove(f.mesh);
    if (f.kind === 'tracer') tracerPool.push(f.mesh);
    else if (f.ownMaterial) f.mesh.material.dispose();
    else if (f.kind === 'missile') f.mesh.children.at(-1).material.dispose(); // its cloned engine glow
    fx.splice(i, 1);
}

// --- Gun: follows the firing flag in the snapshots ---
const gunTimers = new WeakMap(); // view → frames until its next tracer
function gunfire(dt) {
    for (const v of remoteViews()) {
        if (!v.firing) { gunTimers.delete(v); continue; }
        let t = (gunTimers.get(v) ?? 0) - dt;
        for (let n = 0; t <= 0 && n < 3; n++, t += shootCooldownTime) {
            _fwd.set(0, 0, 1).applyQuaternion(v.group.quaternion);
            const m = tracerPool.pop() || new THREE.Mesh(tracerGeo, tracerMat);
            m.position.copy(v.group.position).addScaledVector(_fwd, 3);
            m.quaternion.setFromUnitVectors(_up3, _fwd);
            add(m, { kind: 'tracer', vel: _fwd.clone().multiplyScalar(bulletSpeed + v.speed), life: TRACER_LIFE });
        }
        gunTimers.set(v, t);
    }
}

// --- Discrete shots from FIRE ---
export function onRemoteFire(m) {
    if (m.w === 'missile') {
        for (const p of [m.p, m.p2]) {
            if (!p) continue;
            const mesh = _createMissileMesh();
            mesh.position.fromArray(p);
            const vel = new THREE.Vector3().fromArray(m.d ?? [0, 0, 1]).multiplyScalar(MISSILE_INITIAL_SPEED);
            vel.y -= 0.18;
            add(mesh, { kind: 'missile', vel, speed: MISSILE_INITIAL_SPEED, drop: MISSILE_DROP_PHASE, life: missileLife, target: m.tg ?? null, trail: 0 });
        }
    } else if (m.w === 'flare') {
        for (let i = 0; i < 20; i++) {
            const a = Math.random() * Math.PI * 2;
            const mesh = new THREE.Mesh(_flarePGeo, _flarePMatBase.clone());
            mesh.position.fromArray(m.p);
            const vel = new THREE.Vector3(Math.cos(a), -0.3 - Math.random() * 0.3, Math.sin(a)).normalize().multiplyScalar(0.05 + Math.random() * 0.05);
            add(mesh, { kind: 'flare', vel, life: 180, maxLife: 180, ownMaterial: true });
        }
    } else if (m.w === 'bomb') {
        const mesh = new THREE.Mesh(_bombBodyGeo, bombMaterial);
        mesh.position.fromArray(m.p);
        add(mesh, { kind: 'bomb', vel: new THREE.Vector3().fromArray(m.v ?? [0, 0, 0]), life: 1200 });
    } else if (m.w === 'napalm') {
        const v = new THREE.Vector3().fromArray(m.v ?? [0, 0, 0.4]), speed = v.length(), d = v.normalize().toArray(); // v = heading × speed
        for (let i = 0; i < 14; i++) {
            const mesh = new THREE.Mesh(_napClusterOrbGeo, _napClusterOrbMat.clone());
            mesh.position.fromArray(m.p);
            const bias = 0.75 + Math.random() * 0.5;
            const vel = new THREE.Vector3(d[0] * bias + (Math.random() - 0.5) * 0.18, 0.04 + Math.random() * 0.14, d[2] * bias + (Math.random() - 0.5) * 0.18)
                .normalize().multiplyScalar(speed * (0.5 + Math.random() * 1.1));
            add(mesh, { kind: 'napalm', vel, life: 1200, ownMaterial: true, fire: i < 4 }); // a few orbs make the big fire bursts
        }
    }
}

/** Per rendered frame; dt in 60 fps frames. */
export function updateRemoteFx(dt) {
    gunfire(dt);
    for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i], p = f.mesh.position;
        f.life -= dt;
        if (f.kind === 'tracer') {
            p.addScaledVector(f.vel, dt);
        } else if (f.kind === 'missile') {
            if (f.drop > 0) { f.drop -= dt; f.vel.y -= 0.045 * dt; }
            else {
                f.speed = Math.min(MISSILE_FINAL_SPEED, f.speed + MISSILE_ACCEL * dt);
                const target = f.target === null ? null : f.target === net.id ? plane.position : peerPosition(f.target);
                if (target) f.vel.lerp(_to.subVectors(target, p).normalize().multiplyScalar(f.speed), Math.min(1, 0.09 * dt));
                else f.vel.lerp(_v.copy(f.vel).normalize().multiplyScalar(f.speed), Math.min(1, 0.08 * dt));
                if (target && p.distanceToSquared(target) < 36) { createExplosion(p, 0.8); remove(i); continue; }
            }
            p.addScaledVector(f.vel, dt);
            f.mesh.quaternion.setFromUnitVectors(_up3, _v.copy(f.vel).normalize());
            if ((f.trail -= dt) <= 0) { // smoke puffs, like the local missiles
                f.trail = 2.5;
                const puff = new THREE.Mesh(_missileTrailGeo, _missileTrailMat.clone());
                puff.position.copy(p);
                add(puff, { kind: 'puff', vel: new THREE.Vector3(), life: 20, maxLife: 20, ownMaterial: true });
            }
            if (f.life <= 0 || p.y < waterLevel) { createExplosion(p, 0.8); remove(i); continue; }
        } else if (f.kind === 'flare' || f.kind === 'puff') {
            p.addScaledVector(f.vel, dt);
            if (f.kind === 'flare') f.vel.y -= 0.001 * dt;
            f.mesh.material.opacity = Math.max(0, f.life / f.maxLife);
        } else { // bomb, napalm: fall until the water line
            f.vel.y -= gravity * dt;
            p.addScaledVector(f.vel, dt);
            if (f.kind === 'bomb') f.mesh.quaternion.setFromUnitVectors(_fwd.set(0, 0, 1), _v.copy(f.vel).normalize());
            if (p.y <= waterLevel) { if (f.kind === 'bomb' || f.fire) createExplosion(p, f.kind === 'bomb' ? 1.5 : 1); remove(i); continue; }
        }
        if (f.life <= 0) remove(i);
    }
}

/** Remove everything (connection lost). */
export function clearRemoteFx() { for (let i = fx.length - 1; i >= 0; i--) remove(i); }
