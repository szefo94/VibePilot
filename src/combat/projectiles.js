/** Per-frame projectile updates: bullets, bombs, missiles, napalm, flares. */
import { MAP_BOUNDARY, MISSILE_ACCEL, MISSILE_FINAL_SPEED, NAPALM_DURATION, NAPALM_TICK_INTERVAL, gravity, groundLevel, missileAoERadius, missileDamage, missileHomingStr, napalmDamage, napalmRadius, waterLevel } from '../config.js';
import { state } from '../state.js';
import { scene } from '../core/scene.js';
import { _sv1, _sv2, _up3 } from '../core/scratch.js';
import { airUnits, bombs, bullets, enemies, enemyBullets, flareParticles, groundUnits, missileTrailParticles, missiles, napalmBombs, napalmFireParticles, napalmPatches } from '../entities/registry.js';
import { _missileTrailGeo, _missileTrailMat, _napClusterPatchGeo, _napClusterR, _napalmFireGeo, _napalmFireMat, napalmPatchMat } from './resources.js';
import { _enemyBulletPool } from './enemyBullets.js';
import { createExplosion, updateExplosions } from '../effects/effects.js';
import { groundUnitWorldPos } from './damage.js';
import { beginHits } from './hits.js';
import { isOnAnyIslet } from '../world/world.js';
import { disposeGroup } from '../core/utils.js';
import { _damageFenceNear } from '../entities/fences.js';
import { _playerBulletPool } from './weapons.js';

export function updateProjectiles(dt) {
    // Player bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        (b.prevPosition || (b.prevPosition = new THREE.Vector3())).copy(b.position); // swept collision segment start
        b.position.addScaledVector(b.velocity, dt); b.life -= dt;
        // V5: update tracer endpoints
        if (b.tracer) {
            const _tp = b.tracer.geometry.attributes.position;
            _tp.setXYZ(0, b.position.x - b.velocity.x * 4, b.position.y - b.velocity.y * 4, b.position.z - b.velocity.z * 4);
            _tp.setXYZ(1, b.position.x, b.position.y, b.position.z);
            _tp.needsUpdate = true;
        }
        if (b.life <= 0 || Math.abs(b.position.x) > MAP_BOUNDARY || Math.abs(b.position.z) > MAP_BOUNDARY) {
            if (b.tracer) { scene.remove(b.tracer); b.tracer.geometry.dispose(); b.tracer = null; }
            scene.remove(b); _playerBulletPool.push(b); bullets.splice(i, 1);
        }
    }
    // Bombs
    for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.velocity.y -= gravity * dt; b.position.addScaledVector(b.velocity, dt);
        if (b.velocity.lengthSq() > 0.001) b.quaternion.setFromUnitVectors(_sv1.set(0, 0, 1), _sv2.copy(b.velocity).normalize());
        if (b.position.y <= groundLevel + b.userData.collisionRadius) {
            createExplosion(b.position);
            const hits = beginHits('bomb'), rSq = b.userData.aoERadius * b.userData.aoERadius;
            for (const gu of groundUnits) if (groundUnitWorldPos(gu).distanceToSquared(b.position) < rSq) hits.damage(gu, b.userData.damage);
            for (const au of airUnits) if (au.group.position.distanceToSquared(b.position) < rSq) hits.damage(au, b.userData.damage);
            for (const en of enemies) if (en.parts.some(p => p.position.distanceToSquared(b.position) < rSq)) hits.damage(en, b.userData.damage);
            hits.finish();
            _damageFenceNear(b.position, b.userData.aoERadius); // F5
            scene.remove(b); bombs.splice(i, 1);
        } else if (b.position.y < groundLevel - 30) { scene.remove(b); bombs.splice(i, 1); }
    }
    if (state.bombCooldown > 0) state.bombCooldown -= dt;
    if (state.gunAmmo   <= 0) { state.gunReloadTimer  -= dt; if (state.gunReloadTimer  <= 0) { state.gunAmmo  = state.gunMaxAmmo;    state.gunReloadTimer  = 0; } }
    if (state.bombAmmo  <= 0) { state.bombReloadTimer -= dt; if (state.bombReloadTimer <= 0) { state.bombAmmo = state.bombMaxAmmo;   state.bombReloadTimer = 0; } }
    if (state.missileAmmo <= 0) { state.missileReloadTimer -= dt; if (state.missileReloadTimer <= 0) { state.missileAmmo = state.missileMaxAmmo; state.missileReloadTimer = 0; } }
    if (state.flareAmmo   <= 0) { state.flareReloadTimer   -= dt; if (state.flareReloadTimer   <= 0) { state.flareAmmo  = state.flareMaxAmmo;   state.flareReloadTimer   = 0; } }
    if (state.flareTimer   > 0) state.flareTimer -= dt;
    // Flare angel-wing particles
    for (let i = flareParticles.length - 1; i >= 0; i--) {
        const fp = flareParticles[i];
        fp.position.addScaledVector(fp.velocity, dt);
        fp.velocity.y -= 0.001 * dt; // negligible droop — stays spread
        fp.life -= dt;
        fp.material.opacity = Math.max(0, fp.life / fp.maxLife);
        if (fp.life <= 0) { scene.remove(fp); fp.material.dispose(); flareParticles.splice(i, 1); }
    }
    if (state.napalmAmmo  <= 0) { state.napalmReloadTimer  -= dt; if (state.napalmReloadTimer  <= 0) { state.napalmAmmo = state.napalmMaxAmmo;   state.napalmReloadTimer  = 0; } }
    // Missiles (§5.7)
    for (let i = missiles.length - 1; i >= 0; i--) {
        const m = missiles[i];
        if (m.dropPhase > 0) {
            // Drop phase — fall downward, no homing, slow speed
            m.dropPhase -= dt;
            m.velocity.y -= 0.045 * dt; // pull down
        } else {
            // Cruise phase — speed ramp + homing
            m.speed = Math.min(MISSILE_FINAL_SPEED, m.speed + MISSILE_ACCEL * dt);
            if (m.target && m.target.alive()) {
                _sv1.subVectors(m.target.pos(), m.position).normalize().multiplyScalar(m.speed);
                m.velocity.lerp(_sv1, missileHomingStr * dt);
            } else {
                // No target: maintain direction at increasing speed
                _sv2.copy(m.velocity).normalize().multiplyScalar(m.speed);
                m.velocity.lerp(_sv2, 0.08 * dt);
            }
        }
        m.position.addScaledVector(m.velocity, dt);
        m.life -= dt;
        _sv2.copy(m.velocity).normalize();
        if (_sv2.length() > 0.001) m.quaternion.setFromUnitVectors(_up3, _sv2);
        // Trail particles
        m.trailTimer -= dt;
        if (m.trailTimer <= 0) {
            m.trailTimer = 2.5;
            const tp = new THREE.Mesh(_missileTrailGeo, _missileTrailMat.clone());
            tp.position.copy(m.position);
            tp.life = tp.maxLife = 20;
            missileTrailParticles.push(tp); scene.add(tp);
        }
        const expired = m.life <= 0 || Math.abs(m.position.x) > MAP_BOUNDARY || Math.abs(m.position.z) > MAP_BOUNDARY;
        const groundHit = m.position.y <= groundLevel + 3;
        // Collision check vs ground, air, enemies — remember the directly struck entity
        let struck = null;
        for (const u of groundUnits) {
            if (u.userData.hp > 0 && m.position.distanceToSquared(groundUnitWorldPos(u)) < (u.userData.collisionRadius + 2) ** 2) { struck = u; break; }
        }
        if (!struck) for (const au of airUnits) {
            if (au.hp > 0 && m.position.distanceToSquared(au.group.position) < (au.collisionRadius + 2) ** 2) { struck = au; break; }
        }
        if (!struck) for (const en of enemies) {
            if (en.parts.some(p => p.userData.hp > 0 && m.position.distanceToSquared(p.position) < 12 * 12)) { struck = en; break; }
        }
        if (struck || groundHit || expired) {
            if (struck || groundHit) {
                // AoE damage: the directly struck unit is always hit (large units detonate missiles far from
                // their centre), others when their collision surface lies within missileAoERadius.
                // Deaths are applied after all scans — removal mutates the arrays being scanned.
                const dmg = Math.round(missileDamage * state.playerDamageMultiplier);
                createExplosion(m.position); createExplosion(m.position); // double flash for missiles
                const inBlast = (pos, radius) => m.position.distanceTo(pos) - radius < missileAoERadius;
                const hits = beginHits('missile');
                for (const gu of groundUnits) if (gu === struck || inBlast(groundUnitWorldPos(gu), gu.userData.collisionRadius || 0)) hits.damage(gu, dmg);
                for (const au of airUnits) if (au === struck || inBlast(au.group.position, au.collisionRadius || 0)) hits.damage(au, dmg);
                for (const en of enemies) if (en === struck || en.parts.some(p => p.userData.hp > 0 && inBlast(p.position, p.userData.collisionRadius || 0))) hits.damage(en, dmg);
                hits.finish();
                _damageFenceNear(m.position, missileAoERadius * 0.5); // F5
            }
            scene.remove(m); disposeGroup(m); missiles.splice(i, 1); // frees the cloned exhaust material
        }
    }
    // Missile trail particles
    for (let i = missileTrailParticles.length - 1; i >= 0; i--) {
        const tp = missileTrailParticles[i];
        tp.life -= dt;
        tp.material.opacity = Math.max(0, (tp.life / tp.maxLife) * 0.75);
        if (tp.life <= 0) { scene.remove(tp); tp.material.dispose(); missileTrailParticles.splice(i, 1); }
    }
    // Napalm cluster orbs (§5.7) — scatter on drop, each creates a small fire patch on landing
    for (let i = napalmBombs.length - 1; i >= 0; i--) {
        const b = napalmBombs[i];
        b.velocity.y -= gravity * dt; b.position.addScaledVector(b.velocity, dt);
        if (b.position.y <= groundLevel + 0.8) {
            const pm = new THREE.Mesh(_napClusterPatchGeo, napalmPatchMat.clone());
            // Sit just above the surface the orb landed on (islet top or water), not below it
            pm.position.set(b.position.x, (isOnAnyIslet(b.position.x, b.position.z) ? groundLevel + 1 : waterLevel) + 0.2, b.position.z);
            scene.add(pm);
            napalmPatches.push({ pos: pm.position, life: 90, maxLife: 90, tick: 0, vTick: 0, mesh: pm, patchR: _napClusterR });
            scene.remove(b); b.material.dispose(); napalmBombs.splice(i, 1);
        } else if (b.position.y < groundLevel - 30) { scene.remove(b); b.material.dispose(); napalmBombs.splice(i, 1); }
    }
    // Napalm patches — tick damage over time (§5.7)
    for (let i = napalmPatches.length - 1; i >= 0; i--) {
        const p = napalmPatches[i];
        p.life -= dt; p.tick -= dt; p.vTick -= dt;
        const _pMaxLife = p.maxLife || NAPALM_DURATION;
        const _pR = p.patchR || napalmRadius;
        p.mesh.material.opacity = 0.45 * Math.max(0, p.life / _pMaxLife);
        // Spawn fire tongues: cluster patches get 1 particle per 14 frames, full patches get 4 per 7 frames
        const _vInterval = p.patchR ? 14 : 7;
        if (p.vTick <= 0) {
            p.vTick = _vInterval;
            for (let f = 0; f < (p.patchR ? 1 : 4); f++) {
                const angle = Math.random() * Math.PI * 2;
                const r = Math.sqrt(Math.random()) * _pR;
                const nfp = new THREE.Mesh(_napalmFireGeo, _napalmFireMat.clone());
                nfp.position.set(p.pos.x + Math.cos(angle) * r, p.pos.y + 0.3, p.pos.z + Math.sin(angle) * r);
                nfp.velocity = new THREE.Vector3(0, 0.07 + Math.random() * 0.09, 0);
                nfp.life = nfp.maxLife = (p.patchR ? 10 : 18) + Math.random() * 12;
                napalmFireParticles.push(nfp); scene.add(nfp);
            }
        }
        if (p.tick <= 0) {
            p.tick = NAPALM_TICK_INTERVAL;
            const dmg = Math.max(1, Math.round(napalmDamage * (p.patchR ? 0.05 : 1) * state.playerDamageMultiplier));
            const rSq = _pR * _pR;
            const hits = beginHits('napalm'); // burning ground only
            for (const gu of groundUnits) if (groundUnitWorldPos(gu).distanceToSquared(p.pos) < rSq) hits.damage(gu, dmg);
            hits.finish();
        }
        if (p.life <= 0) { scene.remove(p.mesh); p.mesh.material.dispose(); napalmPatches.splice(i, 1); }
    }
    // Napalm fire particle animation
    for (let i = napalmFireParticles.length - 1; i >= 0; i--) {
        const nfp = napalmFireParticles[i];
        nfp.position.addScaledVector(nfp.velocity, dt);
        nfp.life -= dt;
        const t = nfp.life / nfp.maxLife;           // 1→0 as it dies
        const s = Math.sin(t * Math.PI);             // bell curve: 0 → peak → 0
        nfp.scale.setScalar(s * 1.8 + 0.2);
        nfp.material.opacity = Math.min(1, s * 1.5);
        if (nfp.life <= 0) { scene.remove(nfp); nfp.material.dispose(); napalmFireParticles.splice(i, 1); }
    }
    // Enemy bullets
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.position.addScaledVector(b.velocity, dt); b.life -= dt;
        if (b.life <= 0 || b.position.y < groundLevel || Math.abs(b.position.x) > MAP_BOUNDARY || Math.abs(b.position.z) > MAP_BOUNDARY) {
            scene.remove(b); _enemyBulletPool.push(b); enemyBullets.splice(i, 1);
        }
    }
    updateExplosions(dt); // §4.5
}
