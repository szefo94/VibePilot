/** Collision math and per-frame collision resolution. */
import { TARGET_FPS } from '../config.js';
import { state } from '../state.js';
import { scene } from '../core/scene.js';
import { _sv1 } from '../core/scratch.js';
import { _playCollectCyan, _playCollectGreen, _playCollectYellow, _playKeyClick, _playPlayerHit } from '../audio.js';
import { hpElement, scoreElement } from '../ui/dom.js';
import { plane, planePartBoxes, planeSphereRadius } from '../player/plane.js';
import { airUnits, bullets, collectibles, enemies, enemyBullets, groundUnits, markers, obstacles } from '../entities/registry.js';
import { constellations, corridors } from '../entities/names.js';
import { _gridBuild, _gridQuery } from './spatialGrid.js';
import { _enemyBulletPool } from './enemyBullets.js';
import { _dyingMarkers, collectibleBursts, createExplosion } from '../effects/effects.js';
import { updateUnitLabel } from '../ui/labels.js';
import { addToConqueredRow, showNotification } from '../ui/notifications.js';
import { _healPlayer, addXP } from '../game/progression.js';
import { triggerGameOver } from '../game/gameOver.js';
import { killGroundUnit } from '../entities/groundUnits.js';
import { destroyAirUnit, destroyLogicalEnemy } from '../entities/airUnits.js';
import { collectibleRadius, markerRadius, spawnSingleHoopWithMarker } from '../entities/collectibles.js';
import { TUBE_XP, _nearestTubeT, _tubeStatusEl, showTubeRibbon, tubes } from '../entities/tubes.js';
import { _playerBulletPool } from './weapons.js';

// --- Collision Math ---
function pillarHitsBox(px, pz, pr, box) {
    const cx = Math.max(box.min.x, Math.min(box.max.x, px)), cz = Math.max(box.min.z, Math.min(box.max.z, pz));
    return (cx - px) ** 2 + (cz - pz) ** 2 < pr * pr;
}
function coneHitsSphere(apex, base, baseR, center, sphereR) {
    const ax = base.x - apex.x, ay = base.y - apex.y, az = base.z - apex.z;
    const h = Math.sqrt(ax * ax + ay * ay + az * az);
    const dx = ax / h, dy = ay / h, dz = az / h;
    const vx = center.x - apex.x, vy = center.y - apex.y, vz = center.z - apex.z;
    const t = vx * dx + vy * dy + vz * dz;
    if (t < -sphereR || t > h + sphereR) return false;
    const tc = Math.max(0, Math.min(h, t));
    const px = vx - t * dx, py = vy - t * dy, pz = vz - t * dz;
    return Math.sqrt(px * px + py * py + pz * pz) < baseR * tc / h + sphereR;
}

// Scratch Box3 for plane pickup AABB (covers full wingspan, recomputed each resolveCollisions call)
const _planePickupBox = new THREE.Box3();
const _planeMarkerBox = new THREE.Box3();
export function resolveCollisions() {
    // Build plane AABB (union of all part boxes) expanded by collectible radius — covers full wingspan
    _planePickupBox.makeEmpty();
    planePartBoxes.forEach(pb => _planePickupBox.union(pb));
    _planeMarkerBox.copy(_planePickupBox).expandByScalar(markerRadius);
    _planePickupBox.expandByScalar(collectibleRadius);

    // Player vs Markers — full-plane AABB pickup (expanded by markerRadius for generous hitbox)
    for (let i = markers.length - 1; i >= 0; i--) {
        const m = markers[i];
        if (_planeMarkerBox.containsPoint(m.position)) {
            // Yellow burst particles on marker pickup (idea 1 equivalent)
            const _mPos = m.position.clone();
            for (let _b = 0; _b < 8; _b++) {
                const _a = (_b / 8) * Math.PI * 2;
                const _bm = new THREE.Mesh(new THREE.SphereGeometry(0.5, 4, 3), new THREE.MeshBasicMaterial({ color: 0xFFD700, transparent: true }));
                _bm.position.copy(_mPos); scene.add(_bm);
                collectibleBursts.push({ mesh: _bm, velocity: new THREE.Vector3(Math.cos(_a) * 0.18, 0.12 + Math.random() * 0.1, Math.sin(_a) * 0.18), life: 35, maxLife: 35 });
            }
            scene.remove(m); // yellow sphere disappears immediately (idea 2)
            markers.splice(i, 1);
            if (m.userData.hoopMesh) {
                // Remove from collision but leave in scene for blink-out animation (idea 2)
                obstacles.splice(obstacles.indexOf(m.userData.hoopMesh), 1);
                _dyingMarkers.push({ mesh: m.userData.hoopMesh, timer: 3 * TARGET_FPS });
            }
            state.score += 10; scoreElement.textContent = state.score; addXP(15);
            _playCollectYellow();
            const cid = m.userData.corridorId;
            if (cid && corridors[cid] && !corridors[cid].completed) {
                const cor = corridors[cid];
                cor.remaining--;
                const done = cor.remaining <= 0;
                if (done) {
                    cor.completed = true;
                    if (cor.axisLine) { scene.remove(cor.axisLine); cor.axisLine.geometry.dispose(); cor.axisLine.material.dispose(); cor.axisLine = null; }
                    showNotification(`◆ ${cor.name} — ALL RINGS  +75 XP`, true);
                    if (!state.isGameOver) { addXP(75); _healPlayer(30); } // G6
                    addToConqueredRow(`◆ ${cor.name}`, 'row3-scroll');
                } else {
                    showNotification(`◆ ${cor.name}  ${cor.total - cor.remaining}/${cor.total}`);
                }
            }
            spawnSingleHoopWithMarker();
        }
    }
    // Player vs Collectibles — full-plane AABB pickup (idea 3 fix)
    for (let i = collectibles.length - 1; i >= 0; i--) {
        const _col = collectibles[i];
        if (_planePickupBox.containsPoint(_col.position)) {
            const sid = _col.userData.constellationId;
            // Idea 1: burst particles at pickup position
            const _bPos = _col.position.clone();
            scene.remove(_col); collectibles.splice(i, 1);
            for (let _b = 0; _b < 8; _b++) {
                const _a = (_b / 8) * Math.PI * 2;
                const _bm = new THREE.Mesh(new THREE.SphereGeometry(0.4, 4, 3), new THREE.MeshBasicMaterial({ color: 0x00ff44, transparent: true }));
                _bm.position.copy(_bPos);
                scene.add(_bm);
                collectibleBursts.push({ mesh: _bm, velocity: new THREE.Vector3(Math.cos(_a) * 0.16, 0.1 + Math.random() * 0.1, Math.sin(_a) * 0.16), life: 30, maxLife: 30 });
            }
            state.score += 5; scoreElement.textContent = state.score; addXP(8);
            if (!state.isGameOver && state.planeHP < 100) { state.planeHP = Math.min(100, state.planeHP + 5); hpElement.textContent = Math.max(0, state.planeHP); }
            _playCollectGreen();
            if (sid && constellations[sid] && !constellations[sid].completed) {
                const con = constellations[sid];
                con.remaining--;
                const collected = con.total - con.remaining;
                if (con.remaining <= 0) {
                    con.completed = true;
                    showNotification(`★ ${con.name} Constellation — COMPLETE  +50 XP`, true);
                    if (!state.isGameOver) { addXP(50); _healPlayer(15); } // G6
                    addToConqueredRow(`★ ${con.name}`, 'row2-scroll');
                } else {
                    showNotification(`★ ${con.name}  ${collected}/${con.total}`);
                }
            }
        }
    }
    // Player vs Tube collectibles (ideas 7-9)
    for (const tube of tubes) {
        if (tube.completed) continue;
        // Challenge tubes: only collect orbs while actively running (entered state)
        if (tube.isChallenge && tube.state !== 'entered') continue;
        for (let i = tube.collectibles.length - 1; i >= 0; i--) {
            const tc = tube.collectibles[i];
            if (_planePickupBox.containsPoint(tc.position)) {
                const _bPos = tc.position.clone();
                scene.remove(tc); tc.geometry.dispose(); tc.material.dispose();
                tube.collectibles.splice(i, 1);
                const burstColor = tube.isChallenge ? 0x00ccff : 0xff8800;
                for (let _b = 0; _b < 6; _b++) {
                    const _a = (_b / 6) * Math.PI * 2;
                    const _bm = new THREE.Mesh(new THREE.SphereGeometry(0.4, 4, 3), new THREE.MeshBasicMaterial({ color: burstColor, transparent: true }));
                    _bm.position.copy(_bPos); scene.add(_bm);
                    collectibleBursts.push({ mesh: _bm, velocity: new THREE.Vector3(Math.cos(_a) * 0.2, 0.15, Math.sin(_a) * 0.2), life: 25, maxLife: 25 });
                }
                state.score += 5; scoreElement.textContent = state.score; addXP(10);
                _playCollectCyan();
                state._hitMarkerTimer = 9;
                if (tube.isChallenge) {
                    tube.inRunCollected++;
                    _tubeStatusEl.textContent = `${tube.name}  ${tube.inRunCollected} / ${tube.totalOrbs}`;
                } else if (tube.collectibles.length === 0) {
                    // Free tube: complete when all orbs collected
                    tube.completed = true;
                    scene.remove(tube.mesh); tube.geo.dispose(); tube.mesh.material.dispose();
                    if (!state.isGameOver) { addXP(TUBE_XP); state.score += TUBE_XP; scoreElement.textContent = state.score; _healPlayer(20); } // G6
                    showNotification(`⚡ ${tube.name} COMPLETE  +${TUBE_XP} XP`, true);
                    showTubeRibbon(tube.name);
                    addToConqueredRow(`⚡ ${tube.name}`, 'row4-scroll');
                }
            }
        }
    }
    // Challenge tube entry / exit / wall-collision logic
    let _inAnyChallengeTube = false;
    for (const tube of tubes) {
        if (!tube.isChallenge || tube.completed || tube.state === 'done') continue;
        const { t, d } = _nearestTubeT(tube.curve, plane.position);
        const inside   = d < tube.tubeRadius - planeSphereRadius;
        const nearEnd  = t < 0.12 || t > 0.88;
        if (tube.state === 'idle') {
            if (inside && nearEnd) {
                // Valid entry through a cap
                tube.state    = 'entered';
                tube.entryT   = t < 0.5 ? 0 : 1;
                tube.inRunCollected = 0;
                tube.wasInside = true;
                _inAnyChallengeTube = true;
                _tubeStatusEl.style.display = 'block';
                _tubeStatusEl.textContent   = `${tube.name}  0 / ${tube.totalOrbs}`;
            } else if (inside && !nearEnd) {
                // Flew in through the wall from outside — fatal
                triggerGameOver();
            }
        } else if (tube.state === 'entered') {
            if (inside) {
                tube.wasInside = true;
                _inAnyChallengeTube = true;
            } else {
                // Transition: just left the tube volume
                if (!nearEnd) {
                    // Exited through the wall — fatal
                    triggerGameOver();
                } else {
                    const exitEnd = t < 0.5 ? 0 : 1;
                    if (exitEnd !== tube.entryT) {
                        // Correct exit — score based on orb ratio
                        const ratio = tube.totalOrbs > 0 ? tube.inRunCollected / tube.totalOrbs : 0;
                        const xp    = Math.max(20, Math.round(TUBE_XP * ratio));
                        tube.state  = 'done'; tube.completed = true;
                        scene.remove(tube.mesh); tube.geo.dispose(); tube.mesh.material.dispose();
                        tube.collectibles.forEach(tc => { scene.remove(tc); tc.geometry.dispose(); tc.material.dispose(); });
                        tube.collectibles = [];
                        _tubeStatusEl.style.display = 'none';
                        if (!state.isGameOver) { addXP(xp); state.score += xp; scoreElement.textContent = state.score; _healPlayer(20); } // G6
                        const pct = Math.round(ratio * 100);
                        showNotification(`⚡ ${tube.name}  ${tube.inRunCollected}/${tube.totalOrbs} orbs (${pct}%)  +${xp} XP`, true);
                        showTubeRibbon(tube.name, xp);
                        addToConqueredRow(`⚡ ${tube.name}`, 'row4-scroll');
                    } else {
                        // Turned back — exit through same end resets run
                        tube.state = 'idle';
                        tube.wasInside = false;
                        _tubeStatusEl.style.display = 'none';
                        showNotification(`✕ ${tube.name} aborted`);
                    }
                }
            }
        }
    }
    if (!_inAnyChallengeTube) _tubeStatusEl.style.display = 'none';
    // Player vs World obstacles
    for (const o of obstacles) {
        if (o.userData.type === 'torus') continue;
        if (o.userData.type === 'pillar') {
            if (planePartBoxes.some(pb => pillarHitsBox(o.userData.pillarX, o.userData.pillarZ, o.userData.pillarRadius, pb))) { triggerGameOver(); break; }
        } else if (o.userData.type === 'stalactite' || o.userData.type === 'stalagmite') {
            if (coneHitsSphere(o.userData.coneApex, o.userData.coneBase, o.userData.coneBaseRadius, plane.position, planeSphereRadius)) { triggerGameOver(); break; }
        }
    }
    // Player vs Torus tube (§2.2 — use cached inverse matrix)
    if (!state.isGameOver) {
        for (const o of obstacles) {
            if (o.userData.type !== 'torus') continue;
            _sv1.copy(plane.position).applyMatrix4(o.userData.matrixWorldInverse);
            const { radius: R, tube } = o.geometry.parameters;
            const rho = Math.sqrt(_sv1.x * _sv1.x + _sv1.y * _sv1.y);
            if (Math.sqrt((rho - R) ** 2 + _sv1.z ** 2) < tube + planeSphereRadius) { triggerGameOver(); break; }
        }
    }
    // Player vs Ground units (§2.1 — use worldBox from precomputed local boxes)
    if (!state.isGameOver) {
        for (const u of groundUnits) {
            if (u.userData.partBoxes && u.userData.partBoxes.some(upb => planePartBoxes.some(ppb => ppb.intersectsBox(upb.worldBox)))) { triggerGameOver(); break; }
        }
    }
    if (!state.isGameOver) {
        for (const e of enemies) {
            if (e.boundingBox && planePartBoxes.some(pb => pb.intersectsBox(e.boundingBox))) { triggerGameOver(); break; }
        }
    }
    if (!state.isGameOver) {
        for (const au of airUnits) {
            if (au.hp > 0 && au.group.position.distanceToSquared(plane.position) < (au.collisionRadius + planeSphereRadius) ** 2) { triggerGameOver(); break; }
        }
    }
    // Player vs Enemy Bullets (flares block damage)
    if (!state.isGameOver) {
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
            const b = enemyBullets[i];
            if (plane.position.distanceToSquared(b.position) < (planeSphereRadius + b.userData.collisionRadius) ** 2) {
                createExplosion(b.position);
                scene.remove(b); _enemyBulletPool.push(b); enemyBullets.splice(i, 1);
                if (state.flareTimer > 0 || state._graceTimer > 0) continue; // deflect: flares or spawn grace period
                state.planeHP -= b.userData.damage; hpElement.textContent = Math.max(0, state.planeHP);
                document.body.style.backgroundColor = '#500'; setTimeout(() => document.body.style.backgroundColor = '#111', 100);
                state._playerBlinkTimer = 45; // idea 3: plane red-emissive blink on damage
                _playPlayerHit();
                if (state.planeHP <= 0) { triggerGameOver(); break; }
            }
        }
    }
    // Player Bullets vs Units (§2.3 — spatial grid reduces checks)
    _gridBuild();
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]; if (!b.parent) continue;
        let hit = false;
        // vs Enemies (no grid — enemy fighters scattered with bounding boxes)
        for (const e of enemies) {
            if (e.parts.some(p => { const _cr = b.userData.collisionRadius + (p.userData.collisionRadius || 1); return p.userData.hp > 0 && b.position.distanceToSquared(p.position) < _cr * _cr; })) {
                if (b.tracer) { scene.remove(b.tracer); b.tracer.geometry.dispose(); b.tracer = null; }
                scene.remove(b); _playerBulletPool.push(b); bullets.splice(i, 1); hit = true;
                const part = e.parts.find(p => { const _cr = b.userData.collisionRadius + (p.userData.collisionRadius || 1); return p.userData.hp > 0 && b.position.distanceToSquared(p.position) < _cr * _cr; });
                if (part) part.userData.hp -= b.userData.damage;
                let totalHp = 0; e.parts.forEach(p => totalHp += p.userData.hp);
                updateUnitLabel(e.label, totalHp);
                if (totalHp <= 0) destroyLogicalEnemy(e.id);
                state._hitMarkerTimer = 9; // idea 4
                _playKeyClick();
                break;
            }
        }
        if (hit) continue;
        // vs Air + Ground Units via spatial grid
        const nearby = _gridQuery(b.position.x, b.position.z, 100);
        for (const obj of nearby) {
            if (hit) break;
            // Air unit?
            if ('group' in obj) {
                const au = obj;
                if (au.hp <= 0) continue;
                // Main fuselage sphere check
                let _auHit = b.position.distanceToSquared(au.group.position) < (b.userData.collisionRadius + au.collisionRadius) ** 2;
                // Wing/rotor sub-sphere checks (corrects for scale×3 models with large wingspans)
                if (!_auHit && au.wingHalfSpan) {
                    let _wwx, _wwz;
                    if (au.wingType === 'q') { _sv1.set(1, 0, 0).applyQuaternion(au.group.quaternion); _wwx = _sv1.x; _wwz = _sv1.z; }
                    else { const _ry = au.group.rotation.y; _wwx = Math.sin(_ry); _wwz = Math.cos(_ry); }
                    const _wr2 = (b.userData.collisionRadius + au.wingR) ** 2, _hs = au.wingHalfSpan, _gp = au.group.position;
                    const _dx1 = b.position.x-(_gp.x+_wwx*_hs), _dy = b.position.y-_gp.y, _dz1 = b.position.z-(_gp.z+_wwz*_hs);
                    const _dx2 = b.position.x-(_gp.x-_wwx*_hs),                              _dz2 = b.position.z-(_gp.z-_wwz*_hs);
                    _auHit = (_dx1*_dx1+_dy*_dy+_dz1*_dz1 < _wr2) || (_dx2*_dx2+_dy*_dy+_dz2*_dz2 < _wr2);
                }
                if (_auHit) {
                    if (b.tracer) { scene.remove(b.tracer); b.tracer.geometry.dispose(); b.tracer = null; }
                    scene.remove(b); _playerBulletPool.push(b); bullets.splice(i, 1); hit = true;
                    au.hp -= b.userData.damage; au.userData.hp = au.hp;
                    updateUnitLabel(au.label, au.hp);
                    if (au.hp <= 0) destroyAirUnit(au);
                    state._hitMarkerTimer = 9; // idea 4
                    _playKeyClick();
                }
            } else {
                // Ground unit
                const u = obj;
                if (u.userData.bombOnly || u.userData.hp <= 0) continue;
                if (u.userData.protector && u.userData.protector.userData.hp > 0) continue; // §4.1: immune while protector lives
                if (b.position.distanceToSquared(u.position) < (b.userData.collisionRadius + u.userData.collisionRadius) ** 2) {
                    if (b.tracer) { scene.remove(b.tracer); b.tracer.geometry.dispose(); b.tracer = null; }
                    scene.remove(b); _playerBulletPool.push(b); bullets.splice(i, 1); hit = true;
                    u.userData.hp -= b.userData.damage; updateUnitLabel(u.userData.label, u.userData.hp);
                    if (u.userData.hp <= 0) killGroundUnit(u); // (§2.3)
                    state._hitMarkerTimer = 9; // idea 4
                    _playKeyClick();
                }
            }
        }
    }
}
