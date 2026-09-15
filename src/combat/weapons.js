/** Player weapon actions: gun, bombs, missiles, napalm, flares. */
import { FLARE_DURATION, MISSILE_DROP_PHASE, MISSILE_INITIAL_SPEED, bombAoERadius, bombDamage, bulletDamage, bulletLife, bulletSpeed, missileLife } from '../config.js';
import { state } from '../state.js';
import { scene } from '../core/scene.js';
import { _bombDroop, _bombOffset, _missileLTip, _missileRTip, _sv1, _sv2, _sv3, _up3, _wv1 } from '../core/scratch.js';
import { _playBombDrop, _playGunShot, _playMissileLaunch, _playNapalmDrop } from '../audio.js';
import { _playerMuzzleLight, plane } from '../player/plane.js';
import { airUnits, bombs, bullets, enemies, flareParticles, groundUnits, missiles, napalmBombs } from '../entities/registry.js';
import { _bombBodyGeo, _bombFinGeo, _bombNoseGeo, _createMissileMesh, _flarePGeo, _flarePMatBase, _napClusterOrbGeo, _napClusterOrbMat, bombMaterial, bombRadius } from './resources.js';
import { _tracerMat } from '../effects/effects.js';

// --- Shared player-bullet resources (avoids per-shot alloc) ---
const _playerBulletGeo = new THREE.SphereGeometry(.3, 8, 8);
const _playerBulletMat = new THREE.MeshBasicMaterial({ color: 0xffa500 });
export const _playerBulletPool = [];

// --- Actions & Events ---
export function fireBullet() {
    const b = _playerBulletPool.pop() || new THREE.Mesh(_playerBulletGeo, _playerBulletMat);
    plane.getWorldDirection(_sv1);
    b.position.copy(plane.position).addScaledVector(_sv1, 3);
    b.velocity = _sv1.clone().multiplyScalar(bulletSpeed); // clone needed — velocity persists on bullet
    b.life = bulletLife;
    b.userData = { type: 'bullet', collisionRadius: .3, damage: Math.round(bulletDamage * state.playerDamageMultiplier) };
    bullets.push(b); scene.add(b);
    // V5: tracer line
    const _tGeo = new THREE.BufferGeometry().setFromPoints([b.position.clone(), b.position.clone()]);
    b.tracer = new THREE.Line(_tGeo, _tracerMat); scene.add(b.tracer);
    _playGunShot();
    _playerMuzzleLight.intensity = 2.5; // V13
}
function _createBombMesh(mat) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(_bombBodyGeo, mat), new THREE.Mesh(_bombNoseGeo, mat));
    for (let _f = 0; _f < 4; _f++) {
        const fin = new THREE.Mesh(_bombFinGeo, mat);
        fin.rotation.z = _f * Math.PI / 2;
        fin.position.set(Math.sin(_f * Math.PI / 2) * 0.9, Math.cos(_f * Math.PI / 2) * 0.9, -1.6);
        g.add(fin);
    }
    return g;
}
export function dropBomb() {
    const b = _createBombMesh(bombMaterial);
    _wv1.set(0, 0, 1).applyQuaternion(plane.quaternion); // forward direction
    b.position.copy(plane.position).add(_bombOffset);
    b.velocity = _wv1.clone().multiplyScalar(state.speed).add(_bombDroop);
    b.userData = { type: 'bomb', collisionRadius: bombRadius, damage: Math.round(bombDamage * state.playerDamageMultiplier), aoERadius: bombAoERadius };
    bombs.push(b); scene.add(b);
    _playBombDrop();
}
export function fireMissile() {
    // Find nearest hostile target to home on
    let target = null, nearestSq = Infinity;
    const tryTarget = (pos, alive) => {
        const d = pos().distanceToSquared(plane.position);
        if (d < nearestSq) { nearestSq = d; target = { pos, alive }; }
    };
    groundUnits.forEach(u => { if (u.userData.hp > 0 && u.userData.isHostile) tryTarget(() => u.position, () => u.userData.hp > 0); });
    airUnits.forEach(au => { if (au.hp > 0) tryTarget(() => au.group.position, () => au.hp > 0); });
    enemies.forEach(en => { if (en.parts.some(p => p.userData.hp > 0)) tryTarget(() => en.parts[0].position, () => en.parts.some(p => p.userData.hp > 0)); });
    plane.getWorldDirection(_sv1); // forward
    // World positions of wing-tip barrels — reuse pre-allocated vectors (§3.2)
    _wv1.copy(_missileLTip).applyMatrix4(plane.matrixWorld); // lTip
    _sv3.copy(_missileRTip).applyMatrix4(plane.matrixWorld); // rTip
    const spawnOne = (origin) => {
        const m = _createMissileMesh();
        m.position.copy(origin);
        // Initial velocity: slow forward + downward drop
        m.velocity = _sv1.clone().multiplyScalar(MISSILE_INITIAL_SPEED);
        m.velocity.y -= 0.18;
        m.target = target;
        m.life = missileLife;
        m.speed = MISSILE_INITIAL_SPEED;
        m.dropPhase = MISSILE_DROP_PHASE;
        m.trailTimer = 0;
        _sv2.copy(m.velocity).normalize();
        m.quaternion.setFromUnitVectors(_up3, _sv2);
        missiles.push(m); scene.add(m);
    };
    spawnOne(_wv1); // lTip
    spawnOne(_sv3); // rTip
    _playMissileLaunch();
}
export function dropNapalm() {
    _wv1.set(0, 0, 1).applyQuaternion(plane.quaternion); // forward
    const fwdX = _wv1.x, fwdZ = _wv1.z;
    for (let _ci = 0; _ci < 50; _ci++) {
        const orb = new THREE.Mesh(_napClusterOrbGeo, _napClusterOrbMat.clone());
        orb.position.copy(plane.position).add(_bombOffset);
        const spd = state.speed * (0.5 + Math.random() * 1.1);
        const sx = (Math.random() - 0.5) * 0.18, sz = (Math.random() - 0.5) * 0.18;
        const fwdBias = 0.75 + Math.random() * 0.5; // strong forward bias
        orb.velocity = new THREE.Vector3(fwdX * fwdBias + sx, 0.04 + Math.random() * 0.14, fwdZ * fwdBias + sz)
            .normalize().multiplyScalar(spd).add(_bombDroop.clone().multiplyScalar(0.2));
        orb.userData = { isNapalmCluster: true };
        napalmBombs.push(orb); scene.add(orb);
    }
    _playNapalmDrop();
}
export function deployFlareEffect() {
    // Angel-wings pattern: two arcs of bright particles spreading left and right
    plane.getWorldDirection(_sv1); // forward
    _sv2.crossVectors(_up3, _sv1).normalize(); // right — reuse _up3 (§3.2)
    const COUNT = 10; // particles per wing
    for (let wing = -1; wing <= 1; wing += 2) { // -1 = left, +1 = right
        for (let j = 0; j < COUNT; j++) {
            const t = j / (COUNT - 1); // 0..1 across the arc
            // Arc spans from roughly forward-side to backward-side (~18° to ~162° of π)
            const arc = Math.PI * (0.1 + t * 0.8);
            // Direction = sideways component (sin) + backward component (-cos) + downward bias
            _sv3.set(
                Math.sin(arc) * wing * _sv2.x + (-Math.cos(arc)) * _sv1.x,
                -0.25 - t * 0.15,  // tips arc slightly lower, like spread wings
                Math.sin(arc) * wing * _sv2.z + (-Math.cos(arc)) * _sv1.z
            ).normalize();
            const fp = new THREE.Mesh(_flarePGeo, _flarePMatBase.clone());
            fp.position.copy(plane.position);
            fp.velocity = _sv3.clone().multiplyScalar(0.05 + Math.random() * 0.05);
            fp.life = fp.maxLife = FLARE_DURATION;
            flareParticles.push(fp); scene.add(fp);
        }
    }
}
