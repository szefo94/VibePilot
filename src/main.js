/** Entry point: world initialisation and the per-frame update loop. */
import { MINIMAP_REFRESH_S, MOUSE_STEERING, SPLASH_ENABLED, STEER_CURSOR_RADIUS, STEER_RETURN_DECAY, TARGET_FPS } from './config.js';
import { state } from './state.js';
import { camera, renderer, scene } from './core/scene.js';
import { _sv1 } from './core/scratch.js';
import { _steerCursorEl, enemyDistanceElement, groundDistanceElement, hpElement, markerDistanceElement, posXElement, posYElement, posZElement, rotBnkElement, rotHdgElement, rotPchElement } from './ui/dom.js';
import { enemyArrow, groundTargetArrow, markerArrow, plane } from './player/plane.js';
import { _fenceRegistry, _flagMeshes } from './entities/registry.js';
import { updateEffects } from './effects/effects.js';
import { updateDebugBoxes } from './effects/debug.js';
import { updateDamageUI, updateHUD } from './ui/hud.js';
import { _statHp, _statLvl, _statScore, _statXp } from './ui/debrief.js';
import { _drawReticle } from './ui/reticle.js';
import { runSplash, splashActive } from './ui/splash.js';
import { updateMinimap, updateRadarSnapshot } from './ui/minimap.js';
import { _searchlights, buildBaseFences } from './entities/fences.js';
import { spawnInterceptors } from './entities/airUnits.js';
import { createAllUnits } from './world/populate.js';
import { resolveCollisions } from './combat/collision.js';
import { updateProjectiles } from './combat/projectiles.js';
import { updatePhysics } from './player/flight.js';
import { updateCamera } from './player/camera.js';
import { updateAI } from './ai.js';
import { pollGamepad } from './input.js';
import * as perf from './debug/perf.js';
import { DEBUG_PARAMS } from './debug/params.js';

// --- THREE.Clock for delta-time (§3.6) ---
const clock = new THREE.Clock();

// --- Initialization ---
hpElement.textContent = state.planeHP; updateDamageUI();
// Defer heavy world init to after the first frame renders — avoids blocking the splash screen
requestAnimationFrame(() => requestAnimationFrame(() => {
    const t0 = performance.now();
    createAllUnits();
    const t1 = performance.now();
    if (!DEBUG_PARAMS.disable.has('fences')) buildBaseFences();
    perf.record('init.createAllUnits', t1 - t0);
    perf.record('init.buildBaseFences', performance.now() - t1);
    // ?disable=… cost experiments: hidden lights drop out of every lit shader; hidden sprites skip their draws
    if (DEBUG_PARAMS.disable.has('searchlights')) _searchlights.forEach(sl => { sl.spot.visible = false; });
    if (DEBUG_PARAMS.disable.has('labels')) scene.traverse(o => { if (o.isSprite) o.visible = false; });
}));
let firstFrame = true;
function animate() {
    requestAnimationFrame(animate);
    if (firstFrame) { firstFrame = false; perf.record('startup.firstFrameAt', performance.now()); }
    perf.frameBegin();
    perf.begin('gamepad'); pollGamepad(); perf.end('gamepad');
    const rawDelta = clock.getDelta();
    const dt = Math.min(rawDelta * TARGET_FPS, 6); // cap at 6 frames — prevents spiral-of-death on tab switch

    // Stat sampling (~1 s interval) for death debrief
    if (!state.isGameOver && !state.isPaused && !splashActive) {
        state._statTimer -= dt;
        if (state._statTimer <= 0) { state._statTimer = 60; _statHp.push(Math.max(0, state.planeHP)); _statScore.push(state.score); _statXp.push(state.xp); _statLvl.push(state.level); }
    }
    // Interceptor event timer
    if (!state.isGameOver && !state.isPaused && !splashActive) {
        state._gameElapsed += dt;
        if (state._gameElapsed >= 60 * TARGET_FPS) { // arm after 1 minute
            state._interceptorTimer -= dt;
            if (state._interceptorTimer <= 0) {
                spawnInterceptors();
                state._interceptorTimer = (90 + Math.random() * 60) * TARGET_FPS; // next wave 90–150 s
            }
        }
    }
    if (!state.isGameOver && !state.isPaused && !splashActive) {
        // Spawn protection is simulation state in seconds; dt is in 60 fps frame units
        if (state._graceTimer > 0) state._graceTimer = Math.max(0, state._graceTimer - dt / TARGET_FPS);
        perf.begin('physics'); updatePhysics(dt); perf.end('physics');
        perf.begin('ai'); updateAI(dt); perf.end('ai');
        perf.begin('collisions'); resolveCollisions(); perf.end('collisions');
        perf.begin('hud'); updateHUD(); perf.end('hud');
        perf.begin('projectiles'); updateProjectiles(dt); perf.end('projectiles');
        perf.begin('effects'); updateEffects(dt); perf.end('effects'); // ideas 1-6, 10
    } else if (state.isGameOver) {
        markerArrow.visible = false; groundTargetArrow.visible = false; enemyArrow.visible = false;
        markerDistanceElement.textContent = 'N/A'; groundDistanceElement.textContent = 'N/A'; enemyDistanceElement.textContent = 'N/A';
        posXElement.textContent = '-'; posYElement.textContent = '-'; posZElement.textContent = '-';
        rotHdgElement.textContent = '-'; rotPchElement.textContent = '-'; rotBnkElement.textContent = '-';
        perf.begin('effects'); updateEffects(dt); perf.end('effects'); // debris physics still runs on game over
    }
    perf.begin('debugBoxes'); updateDebugBoxes(); perf.end('debugBoxes');
    perf.begin('camera'); updateCamera(dt); perf.end('camera');
    perf.begin('cursor');
    // Decay steering cursor toward center when mouse is idle
    if (MOUSE_STEERING) {
        const _decay = Math.pow(1 - STEER_RETURN_DECAY, dt);
        state._mouseNDC.x *= _decay;
        state._mouseNDC.y *= _decay;
    }
    // Update steering cursor position (clamped to effective steering circle)
    if (_steerCursorEl.style.display !== 'none') {
        let cx = state._mouseNDC.x, cy = state._mouseNDC.y;
        const cr = Math.sqrt(cx * cx + cy * cy);
        if (cr > STEER_CURSOR_RADIUS) { cx *= STEER_CURSOR_RADIUS / cr; cy *= STEER_CURSOR_RADIUS / cr; }
        _steerCursorEl.style.left = ((cx + 1) * 0.5 * window.innerWidth)  + 'px';
        _steerCursorEl.style.top  = ((-cy + 1) * 0.5 * window.innerHeight) + 'px';
    }
    perf.end('cursor');
    // F6: searchlight sweep + alarm state detection
    perf.begin('searchlights');
    if (!state.isPaused && !state.isGameOver && _searchlights.length > 0) {
        for (const sl of _searchlights) {
            sl.angle += sl.speed * rawDelta * TARGET_FPS;
            // PointLights don't use a target — skip target update
            // Detect player in cone
            const dx = plane.position.x - sl.worldPos.x, dz = plane.position.z - sl.worldPos.z;
            const distXZ = Math.sqrt(dx * dx + dz * dz);
            if (distXZ < sl.range) {
                const dot = (dx / distXZ) * Math.cos(sl.angle) + (dz / distXZ) * Math.sin(sl.angle);
                if (dot > Math.cos(sl.halfAngle)) {
                    for (const bid of sl.baseIds) {
                        const reg = _fenceRegistry[bid];
                        if (reg) { reg.alarmState = true; reg.alarmTimer = 480; }
                    }
                    if (!sl.idleColor) sl.idleColor = sl.spot.color.clone();
                    sl.spot.color.setHex(0xff4400); // turn red when alarmed
                    sl.alarmed = true;
                }
            }
            // Fade back to the idle colour (tracked explicitly: the alarm red already has r = 1)
            if (sl.alarmed) {
                sl.spot.color.lerp(sl.idleColor, Math.min(1, 0.02 * rawDelta * TARGET_FPS));
                if (Math.abs(sl.spot.color.g - sl.idleColor.g) + Math.abs(sl.spot.color.b - sl.idleColor.b) < 0.01) { sl.spot.color.copy(sl.idleColor); sl.alarmed = false; }
            }
        }
        // Decay alarm timers
        for (const reg of Object.values(_fenceRegistry)) {
            if (reg.alarmState) { reg.alarmTimer = (reg.alarmTimer || 0) - rawDelta * TARGET_FPS; if (reg.alarmTimer <= 0) { reg.alarmState = false; } }
        }
    }
    perf.end('searchlights');
    // F9: flag animation — pivot Group rotates to face wind direction; flag extends sideways from pole tip
    if (_flagMeshes.length > 0) {
        _sv1.set(0, 0, 1).applyQuaternion(plane.quaternion);
        const windAngle = Math.atan2(_sv1.x, _sv1.z);
        const wave = Math.sin(Date.now() * 0.0025) * 0.12;
        const wy = windAngle + wave;
        for (const f of _flagMeshes) {
            if (!f.mesh.parent) continue; // removed from scene
            f.mesh.rotation.y = wy;
        }
    }
    // Radar cycle — one full sweep per 3 s; snapshot taken at each revolution end (pauses when game is paused)
    perf.begin('minimap');
    if (!state.isPaused && !state.isGameOver) {
        state._radarSweepAngle += rawDelta * (Math.PI * 2 / 3);
        state._radarCycleTimer += rawDelta;
        if (state._radarCycleTimer >= 3.0) {
            state._radarCycleTimer -= 3.0;
            state._radarSweepAngle = -Math.PI / 2; // snap back to north, keeping sweep in sync
            updateRadarSnapshot();
        }
    }
    // Throttled minimap redraw — 15 fps regardless of game frame rate (§2.5)
    state._minimapTimer += rawDelta;
    if (state._minimapTimer >= MINIMAP_REFRESH_S) { updateMinimap(); state._minimapTimer = 0; }
    perf.end('minimap');
    perf.renderBegin(); renderer.render(scene, camera); perf.renderEnd();
    perf.begin('reticle'); _drawReticle(); perf.end('reticle');
    perf.frameEnd();
}
// Start rendering immediately — script is at end of <body> so DOM is ready.
// window.onload would block until fonts finish loading, causing a blank screen.
animate();
if (SPLASH_ENABLED) runSplash(); // shows the steering cursor itself when dismissed
else if (MOUSE_STEERING) _steerCursorEl.style.display = 'block';
