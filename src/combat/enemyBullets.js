/** Pooled enemy bullets and hostile firing. */
import { ENEMY_AIM_ACCURACY, ENEMY_BULLET_POOL_SIZE, enemyBulletDamage, enemyBulletLife, enemyBulletSpeed, hostileUnitShootingRange } from '../config.js';
import { difficulty } from '../core/settings.js';
import { state } from '../state.js';
import { scene } from '../core/scene.js';
import { _sv1, _sv2, _up3 } from '../core/scratch.js';
import { _playEnemyShot } from '../audio.js';
import { plane } from '../player/plane.js';
import { enemyBullets } from '../entities/registry.js';
import { _muzzleFlashGeo, _muzzleFlashMat, _muzzleFlashes } from '../effects/effects.js';
import { tracer } from '../effects/projectileModels.js';

// --- Enemy Bullet Pool (§2.4) ---
function _createEnemyBulletMesh() {
    const b = tracer(0xff4a12); // white-hot core in a glowing sheath (effects/projectileModels.js)
    b.userData = { type: 'enemy_bullet', collisionRadius: 2.8, damage: 0 };
    return b;
}
export const _enemyBulletPool = [];
for (let i = 0; i < ENEMY_BULLET_POOL_SIZE; i++) _enemyBulletPool.push(_createEnemyBulletMesh());
export function spawnEnemyBullet(fromPos, targetPos) {
    const b = _enemyBulletPool.pop() || _createEnemyBulletMesh();
    // Save from position first — fromPos may alias a scratch vector used below
    b.position.copy(fromPos);
    // Predictive aim: lead the target by estimated bullet travel time, scaled by accuracy
    const dist = Math.sqrt(fromPos.distanceToSquared(targetPos));
    const travelTime = dist / enemyBulletSpeed;
    _sv1.set(0, 0, 1).applyQuaternion(plane.quaternion)
        .multiplyScalar(state.speed * travelTime * ENEMY_AIM_ACCURACY)
        .add(targetPos);
    // Random cone spread — wider when accuracy is lower
    const spread = dist * (1 - ENEMY_AIM_ACCURACY) * 0.4;
    _sv1.x += (Math.random() * 2 - 1) * spread;
    _sv1.y += (Math.random() * 2 - 1) * spread * 0.5;
    _sv1.z += (Math.random() * 2 - 1) * spread;
    // Direction from bullet origin to aim point
    _sv1.subVectors(_sv1, b.position).normalize();
    b.quaternion.setFromUnitVectors(_up3, _sv1);
    b.velocity = _sv1.clone().multiplyScalar(enemyBulletSpeed);
    b.life = enemyBulletLife;
    b.userData.damage = Math.max(1, Math.round(enemyBulletDamage * difficulty().enemyDamage)); // Settings → Difficulty
    enemyBullets.push(b); scene.add(b);
    // V4: muzzle flash at barrel origin
    const _mf = new THREE.Mesh(_muzzleFlashGeo, _muzzleFlashMat.clone());
    _mf.position.copy(fromPos); scene.add(_mf); _muzzleFlashes.push({ mesh: _mf, life: 5 });
    // Only play shot sound when enemy is close enough to hear (~half the shooting range)
    if (dist < hostileUnitShootingRange * 0.5) _playEnemyShot();
}
export function fireHostileBullet(u) {
    if (u.userData.turretPivot) {
        _sv2.set(0, 0, 4); u.userData.turretPivot.localToWorld(_sv2);
    } else {
        u.getWorldPosition(_sv2); _sv2.y += 5;
    }
    spawnEnemyBullet(_sv2, plane.position);
}
