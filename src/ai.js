/** Enemy AI: movement, orbiting, targeting and firing for ground and air units. */
import { HOSTILE_SHOOT_RANGE_SQ, MAP_BOUNDARY, ceilingLevel, groundLevel, hostileUnitShootingCooldownTime } from './config.js';
import { state } from './state.js';
import { _sv1, _sv2, _sv3, _wp } from './core/scratch.js';
import { plane } from './player/plane.js';
import { _fenceRegistry, airUnits, enemies, groundUnits } from './entities/registry.js';
import { fireHostileBullet, spawnEnemyBullet } from './combat/enemyBullets.js';
import { destroyLogicalEnemy } from './entities/airUnits.js';

const _targetWorldPosition = new THREE.Vector3();
export function updateAI(dt) {
    // Enemy fighters
    enemies.forEach(e => {
        e.parts.forEach(p => p.position.addScaledVector(e.velocity, dt));
        e.boundingBox.makeEmpty();
        e.parts.forEach(p => { p.updateMatrixWorld(true); e.boundingBox.expandByObject(p); });
        if (e.label && e.parts.length > 0) {
            e.parts[0].getWorldPosition(_targetWorldPosition);
            e.label.sprite.position.copy(_targetWorldPosition).add(_sv2.set(0, e.hpOffsetY || 5, 0));
        }
        if (e.parts.length > 0 && (Math.abs(e.parts[0].position.x) > MAP_BOUNDARY || Math.abs(e.parts[0].position.z) > MAP_BOUNDARY)) destroyLogicalEnemy(e.id);
    });
    // Air units
    for (let i = airUnits.length - 1; i >= 0; i--) {
        const au = airUnits[i];
        if (au.hp <= 0) continue;
        if (au.velocity) {
            // Interceptor: steer toward player, track altitude
            if (au.isInterceptor && !state.isGameOver) {
                _sv1.copy(plane.position).sub(au.group.position);
                const _iTargetY = Math.max(groundLevel + 30, Math.min(ceilingLevel - 20, plane.position.y));
                _sv1.y = (_iTargetY - au.group.position.y) * 0.05;
                _sv1.normalize().multiplyScalar(au.interceptSpeed);
                au.velocity.lerp(_sv1, 0.025 * dt);
            }
            au.group.position.addScaledVector(au.velocity, dt);
            _sv3.addVectors(au.group.position, au.velocity); au.group.lookAt(_sv3);
            if (Math.abs(au.group.position.x) > MAP_BOUNDARY * 0.85 || Math.abs(au.group.position.z) > MAP_BOUNDARY * 0.85) {
                const len = au.velocity.length();
                _sv3.set(-au.group.position.x, 0, -au.group.position.z).normalize().multiplyScalar(len);
                au.velocity.lerp(_sv3, 0.08);
            }
        } else if (au.orbitCenter) {
            au.orbitAngle += au.orbitSpeed * dt;
            au.group.position.set(
                au.orbitCenter.x + Math.cos(au.orbitAngle) * au.orbitRadius,
                au.orbitAltitude,
                au.orbitCenter.z + Math.sin(au.orbitAngle) * au.orbitRadius
            );
            au.group.rotation.y = -au.orbitAngle + Math.sign(au.orbitSpeed) * Math.PI / 2;
        }
        if (au.label) au.label.sprite.position.copy(au.group.position).add(_sv3.set(0, au.collisionRadius + 8, 0));
        // V9: rotor / spinner animation
        au.group.traverse(child => { if (child.userData.spinY) child.rotation.y += child.userData.spinY * dt; if (child.userData.spinZ) child.rotation.z += child.userData.spinZ * dt; });
        if (au.isHostile) {
            au.shootCooldown = Math.max(0, au.shootCooldown - dt);
            if (au.shootCooldown <= 0 && au.group.position.distanceToSquared(plane.position) < HOSTILE_SHOOT_RANGE_SQ) {
                _sv3.copy(au.group.position).add(_sv2.set(0, 2, 0));
                spawnEnemyBullet(_sv3, plane.position);
                au.shootCooldown = hostileUnitShootingCooldownTime;
            }
        }
    }
    // Ground units (§2.1 — bake worldBoxes once at first visit; units are stationary so no per-frame update needed)
    groundUnits.forEach(u => {
        if (!u.userData.partBoxes) {
            u.updateMatrixWorld(true); // one-time: compute matrices before baking
            u.userData.partBoxes = [];
            u.traverse(child => {
                if (!child.isMesh) return;
                child.geometry.computeBoundingBox();
                u.userData.partBoxes.push({ worldBox: new THREE.Box3().copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld) });
            });
            u.userData._alive = true;
        }
        if (u.userData.label) { u.getWorldPosition(_targetWorldPosition); u.userData.label.sprite.position.copy(_targetWorldPosition).add(_sv3.set(0, u.userData.hpOffsetY, 0)); }
        if (u.userData.turretPivot && u.userData.hp > 0) {
            const _tp = u.userData.turretPivot;
            _tp.getWorldPosition(_wp);
            const _tpDx = plane.position.x - _wp.x, _tpDz = plane.position.z - _wp.z;
            _tp.rotation.y = Math.atan2(_tpDx, _tpDz) - u.rotation.y; // yaw only
            if (u.userData.barrelPivot) {
                const _tpHorizDist = Math.sqrt(_tpDx * _tpDx + _tpDz * _tpDz);
                const _tpRawPitch = Math.atan2(plane.position.y - _wp.y, Math.max(1, _tpHorizDist));
                u.userData.barrelPivot.rotation.x = -Math.max(-Math.PI / 12, Math.min(Math.PI / 4, _tpRawPitch));
            }
        }
        if (u.userData.isHostile && u.userData.hp > 0) {
            u.userData.shootCooldown = Math.max(0, u.userData.shootCooldown - dt);
            if (u.userData.shootCooldown <= 0 && u.position.distanceToSquared(plane.position) < HOSTILE_SHOOT_RANGE_SQ) {
                const _reg = u.userData.baseId ? _fenceRegistry[u.userData.baseId] : null;
                fireHostileBullet(u); u.userData.shootCooldown = (_reg?.alarmState ? hostileUnitShootingCooldownTime * 0.4 : hostileUnitShootingCooldownTime);
            }
        }
    });
}
