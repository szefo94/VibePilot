/** Visual effects: explosions, tracers, muzzle flashes, pickup bursts, dying-unit blink, player debris. */
import { explosionMaxSize, gravity, groundLevel } from '../config.js';
import { state } from '../state.js';
import { scene } from '../core/scene.js';
import { disposeGroup, markShared, randomRange } from '../core/utils.js';
import { hitMarkerEl, memDebugEl } from '../ui/dom.js';
import { _planeMaterials, _playerMuzzleLight, plane } from '../player/plane.js';
import { _fenceRegistry, activeExplosions, airUnits, bullets, collectibles, enemies, enemyBullets, groundUnits, markers, missiles, napalmFireParticles } from '../entities/registry.js';
import { _expMatPool, explosionGeometry } from '../combat/resources.js';
import { _multiEl } from '../game/progression.js';
import { collectibleMat } from '../entities/collectibles.js';
import { tubes } from '../entities/tubes.js';

// V5: bullet tracer shared material
export const _tracerMat = markShared(new THREE.LineBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.55 }));
// V4: hostile muzzle flash small spheres
export const _muzzleFlashes = [];
export const _muzzleFlashGeo = markShared(new THREE.SphereGeometry(0.5, 5, 4));
export const _muzzleFlashMat = markShared(new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true }));
let _graceBlinking = false; // plane emissive currently driven by the spawn-grace blink
// --- Visual effects (ideas 1-6) ---
export const collectibleBursts = []; // green burst particles on collectible pickup (idea 1)
export const _dyingMarkers   = []; // torus rings blink-out after marker pickup (idea 2)
export const _dyingGround    = []; // ground units blink before final dispose (idea 5)
export const _dyingAirUnits  = []; // air units blink before final dispose (idea 5)
export const _dyingEnemies   = []; // enemy fighter parts blink before dispose (idea 5)
const _planeDebris    = []; // debris pieces after player destruction (idea 6)
export function createExplosion(p, size = 1) { // §4.5: tracked by updateExplosions(dt); size scales the final radius per weapon
    const mat = _expMatPool.pop() || new THREE.MeshBasicMaterial({ color: 0xffa500, transparent: true, opacity: 0.8 });
    mat.opacity = 0.8; // reset in case recycled
    const e = new THREE.Mesh(explosionGeometry, mat);
    e.position.copy(p); e.scale.set(.1, .1, .1); scene.add(e);
    activeExplosions.push({ mesh: e, scale: .1, maxSize: explosionMaxSize * size });
}
export function updateExplosions(dt) { // §4.5: frame-rate independent, no disposal race
    for (let i = activeExplosions.length - 1; i >= 0; i--) {
        const ex = activeExplosions[i];
        ex.scale *= Math.pow(1.15, dt);
        ex.mesh.scale.setScalar(ex.scale);
        ex.mesh.material.opacity *= Math.pow(0.96, dt);
        if (ex.scale > ex.maxSize || ex.mesh.material.opacity < .01) {
            scene.remove(ex.mesh);
            ex.mesh.material.opacity = 0.8; // reset before returning to pool
            _expMatPool.push(ex.mesh.material); // return to pool instead of dispose
            activeExplosions.splice(i, 1);
        }
    }
}
export function updateEffects(dt) {
    // ── Heart collectible spin + bob + heartbeat glow ─────────────
    state._heartbeatPhase += 0.028 * dt; // ~1 beat per 3.5 s
    // double-thump: two quick peaks close together, then rest
    const _hbRaw = Math.sin(state._heartbeatPhase) * 0.5 + Math.sin(state._heartbeatPhase * 2.1) * 0.5;
    const _hbGlow = Math.max(0, _hbRaw); // 0..1 positive-only pulse
    const _hbIntensity = 0.25 + _hbGlow * 1.4;
    collectibleMat.emissiveIntensity = _hbIntensity;
    for (let i = 0; i < collectibles.length; i++) {
        const _hc = collectibles[i];
        _hc.rotation.y += 0.018 * dt;
        _hc.userData.bobPhase += 0.022 * dt;
        _hc.position.y = _hc.userData.originY + Math.sin(_hc.userData.bobPhase) * 2.5;
    }
    // Tube-heart bob + glow
    for (const _tb of tubes) {
        for (const _tc of _tb.collectibles) {
            _tc.rotation.y += 0.018 * dt;
            if (_tc.userData.bobPhase !== undefined) {
                _tc.userData.bobPhase += 0.022 * dt;
                _tc.position.y = _tc.userData.originY + Math.sin(_tc.userData.bobPhase) * 2.5;
            }
            if (_tc.material && _tc.material.emissiveIntensity !== undefined) _tc.material.emissiveIntensity = _hbIntensity;
        }
    }
    // ── Idea 1: Collectible burst particles ──────────────────────
    for (let i = collectibleBursts.length - 1; i >= 0; i--) {
        const b = collectibleBursts[i];
        b.mesh.position.addScaledVector(b.velocity, dt);
        b.life -= dt;
        b.mesh.material.opacity = Math.max(0, b.life / b.maxLife);
        b.mesh.scale.setScalar(1 + (1 - b.life / b.maxLife) * 2.5);
        if (b.life <= 0) { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); collectibleBursts.splice(i, 1); }
    }
    // ── Idea 2: Dying markers (torus blink-out over 3 s) ─────────
    for (let i = _dyingMarkers.length - 1; i >= 0; i--) {
        const d = _dyingMarkers[i];
        d.timer -= dt;
        const bp = Math.max(2, Math.round(d.timer * 0.22));
        d.mesh.visible = (Math.floor(d.timer) % (bp * 2)) < bp;
        if (d.timer <= 0) { disposeGroup(d.mesh); scene.remove(d.mesh); _dyingMarkers.splice(i, 1); } // torus + its axis line
    }
    // ── Idea 5: Dying ground units (blink then dispose) ──────────
    for (let i = _dyingGround.length - 1; i >= 0; i--) {
        const d = _dyingGround[i];
        d.timer -= dt;
        const bp = Math.max(2, Math.round(d.timer * 0.22));
        d.mesh.visible = (Math.floor(d.timer) % (bp * 2)) < bp;
        if (d.timer <= 0) { disposeGroup(d.mesh); d.mesh.parent?.remove(d.mesh); _dyingGround.splice(i, 1); }
    }
    // ── Idea 5: Dying air units ───────────────────────────────────
    for (let i = _dyingAirUnits.length - 1; i >= 0; i--) {
        const d = _dyingAirUnits[i];
        d.timer -= dt;
        const bp = Math.max(2, Math.round(d.timer * 0.22));
        d.group.visible = (Math.floor(d.timer) % (bp * 2)) < bp;
        if (d.timer <= 0) { disposeGroup(d.group); scene.remove(d.group); _dyingAirUnits.splice(i, 1); }
    }
    // ── Idea 5: Dying enemy fighter parts ────────────────────────
    for (let i = _dyingEnemies.length - 1; i >= 0; i--) {
        const d = _dyingEnemies[i];
        d.timer -= dt;
        const bp = Math.max(2, Math.round(d.timer * 0.22));
        const vis = (Math.floor(d.timer) % (bp * 2)) < bp;
        d.parts.forEach(p => p.visible = vis);
        if (d.timer <= 0) { d.parts.forEach(p => { p.geometry.dispose(); scene.remove(p); }); if (d.mat) d.mat.dispose(); _dyingEnemies.splice(i, 1); }
    }
    // ── Idea 6: Plane debris physics ─────────────────────────────
    for (let i = _planeDebris.length - 1; i >= 0; i--) {
        const d = _planeDebris[i];
        d.velocity.y -= gravity * dt * 0.45;
        d.mesh.position.addScaledVector(d.velocity, dt);
        d.mesh.rotation.x += d.angVel.x * dt;
        d.mesh.rotation.y += d.angVel.y * dt;
        d.mesh.rotation.z += d.angVel.z * dt;
        d.life -= dt;
        if (d.mesh.position.y < groundLevel + 1 || d.life <= 0) {
            scene.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose(); _planeDebris.splice(i, 1);
        }
    }
    // ── Spawn grace period — white blink while invincible (timer ticks in main.js) ──
    if (state._graceTimer > 0) {
        const glow = Math.floor(state._graceTimer * 8) % 2 === 0; // 4 Hz blink
        _planeMaterials.forEach(m => m.emissive.setHex(glow ? 0xffffff : 0x000000));
        _graceBlinking = true;
    } else if (_graceBlinking) {
        _planeMaterials.forEach(m => m.emissive.setHex(0x000000));
        _graceBlinking = false;
    }
    // ── Idea 3: Player blink-on-damage ───────────────────────────
    if (state._playerBlinkTimer > 0) {
        state._playerBlinkTimer = Math.max(0, state._playerBlinkTimer - dt);
        const isRed = Math.floor(state._playerBlinkTimer / 3) % 2 === 0;
        _planeMaterials.forEach(m => m.emissive.setHex(isRed ? 0xff1100 : 0x000000));
        if (state._playerBlinkTimer <= 0) _planeMaterials.forEach(m => m.emissive.setHex(0x000000));
    }
    // ── Idea 4: Hit-confirm crosshair ────────────────────────────
    if (state._hitMarkerTimer > 0) {
        state._hitMarkerTimer = Math.max(0, state._hitMarkerTimer - dt);
        hitMarkerEl.style.opacity = state._hitMarkerTimer > 0 ? '1' : '0';
    }
    if (state._killMarkerTimer > 0) state._killMarkerTimer = Math.max(0, state._killMarkerTimer - dt);
    hitMarkerEl.classList.toggle('kill', state._killMarkerTimer > 0); // kills flash gold and larger
    // ── G20: streak multiplier display decay ─────────────────────
    if (state._multiDisplayTimer > 0) { state._multiDisplayTimer = Math.max(0, state._multiDisplayTimer - dt); if (state._multiDisplayTimer <= 0) { _multiEl.style.display = 'none'; state._scoreMulti = 1; } }
    // ── V13: muzzle light decay ───────────────────────────────────
    if (_playerMuzzleLight.intensity > 0) _playerMuzzleLight.intensity = Math.max(0, _playerMuzzleLight.intensity - 0.45 * dt);
    // ── V13: empty-clip flash ─────────────────────────────────────
    if (state._emptyClipFlash > 0) state._emptyClipFlash = Math.max(0, state._emptyClipFlash - dt);
    // ── V4: hostile muzzle flashes ────────────────────────────────
    for (let i = _muzzleFlashes.length - 1; i >= 0; i--) {
        const mf = _muzzleFlashes[i]; mf.life -= dt;
        mf.mesh.material.opacity = Math.max(0, mf.life / 5);
        mf.mesh.scale.setScalar(1 + (1 - mf.life / 5) * 2);
        if (mf.life <= 0) { scene.remove(mf.mesh); mf.mesh.material.dispose(); _muzzleFlashes.splice(i, 1); }
    }
    // ── Idea 10: Memory / entity debug panel ─────────────────────
    state._memDebugTimer = Math.max(0, state._memDebugTimer - dt);
    if (state._memDebugTimer <= 0 && memDebugEl.classList.contains('active')) {
        state._memDebugTimer = 120;
        let html = '<strong>MEM</strong><br>';
        if (performance.memory) {
            html += `heap: ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}` +
                    `/${(performance.memory.totalJSHeapSize / 1048576).toFixed(0)} MB<br>`;
        }
        const fencePosts = Object.values(_fenceRegistry).reduce((s, r) => s + r.posts.length, 0);
        // [label, value, unit]
        const counts = [
            ['scene',      scene.children.length,                                          'obj'],
            ['fencePosts', fencePosts,                                                     'meshes'],
            ['ground',     groundUnits.length,                                             'units'],
            ['air',        airUnits.length,                                                'units'],
            ['enemies',    enemies.length,                                                 'units'],
            ['bullet',     bullets.length,                                                 'proj'],
            ['eBullet',    enemyBullets.length,                                            'proj'],
            ['missiles',   missiles.length,                                                'proj'],
            ['expl',       activeExplosions.length,                                        'fx'],
            ['napFire',    napalmFireParticles.length,                                     'fx'],
            ['collect',    collectibles.length,                                            'items'],
            ['markers',    markers.length,                                                  'items'],
            ['tubeOrbs',   tubes.reduce((s, t) => s + t.collectibles.length, 0),          'items'],
        ].filter(c => c[1] > 0).sort((a, b) => b[1] - a[1]);
        html += counts.map(([n, v, u]) => `${n}: <b>${v}</b> ${u}`).join('<br>');
        memDebugEl.innerHTML = html;
    }
}
// Idea 6: shatter plane into tumbling debris pieces
export function spawnPlaneDebris() {
    plane.visible = false;
    const fwd   = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(plane.quaternion);
    const up    = new THREE.Vector3(0, 1, 0).applyQuaternion(plane.quaternion);
    const colors = [0xffffff, 0xffffff, 0x001f5a, 0xffffff, 0x333344, 0xffffff];
    for (let _i = 0; _i < 6; _i++) {
        const geo = new THREE.BoxGeometry(randomRange(1.5, 4.5), randomRange(0.15, 0.6), randomRange(1, 4.5));
        const mat = new THREE.MeshStandardMaterial({ color: colors[_i] });
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(plane.position)
            .addScaledVector(right, randomRange(-4.5, 4.5))
            .addScaledVector(fwd,   randomRange(-2, 3))
            .addScaledVector(up,    randomRange(-0.5, 2));
        m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        scene.add(m);
        _planeDebris.push({
            mesh: m,
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 0.45 + fwd.x * state.speed * 0.4,
                0.08 + Math.random() * 0.28,
                (Math.random() - 0.5) * 0.45 + fwd.z * state.speed * 0.4
            ),
            angVel: new THREE.Vector3(
                (Math.random() - 0.5) * 0.13,
                (Math.random() - 0.5) * 0.13,
                (Math.random() - 0.5) * 0.13
            ),
            life: 150 + ~~(Math.random() * 90)
        });
    }
}
