/** Player flight physics: throttle, rotation rates, mouse steering, boundaries. */
import { GUN_RELOAD_TIME, MAP_BOUNDARY, STEER_AUTO_BANK_K, STEER_BANK_SMOOTH, STEER_CURSOR_RADIUS, STEER_DEADZONE, STEER_LEVEL_RATE, STEER_MAX_ANGLE, STEER_MAX_TURN_RATE, STEER_SMOOTHING, acceleration, ceilingLevel, deceleration, groundLevel, maxPitchRate, maxRollRate, maxSpeed, maxYawRate, minSpeed, naturalDeceleration, rotAccel, rotDamping, shootCooldownTime } from '../config.js';
import { state } from '../state.js';
import { _sq1, _sq2, _sv1, _sv2, _sv3 } from '../core/scratch.js';
import { _playEmptyClip } from '../audio.js';
import { corePlaneComponents, plane, planePartBoxes, planePartLocalBoxes } from './plane.js';
import { _wingTipL, _wingTipR, updateWingTrail, wingTrailL, wingTrailR } from './wingTrails.js';
import { triggerGameOver } from '../game/gameOver.js';
import { fireBullet } from '../combat/weapons.js';
import { _gpAxes, _mouseLMB, keys } from '../input.js';
import { settings } from '../core/settings.js';

// --- Sub-System Functions (§1.2) ---
export function updatePhysics(dt) {
    // Speed control — keyboard OR gamepad left stick Y
    // Keys are full strength; stick deflection scales proportionally
    const throttleUp = keys.w ? 1 : _gpAxes.throttleUp, throttleDown = keys.s ? 1 : _gpAxes.throttleDown;
    if (throttleUp > 0) state.speed = Math.min(maxSpeed, state.speed + acceleration * dt * throttleUp);
    else if (throttleDown > 0) state.speed = Math.max(minSpeed, state.speed - deceleration * dt * throttleDown);
    else state.speed = Math.max(minSpeed, state.speed - naturalDeceleration * dt);
    // Dive boost: forward vector Y < 0 means nose-down — gravity adds speed up to +80 % of maxSpeed
    _sv2.set(0, 0, 1).applyQuaternion(plane.quaternion);
    const _diveY = -_sv2.y; // positive = diving, negative = climbing
    const _effectiveMax = maxSpeed + Math.max(0, _diveY) * maxSpeed * 0.8;
    if (_diveY > 0.05 && state.speed < _effectiveMax) state.speed = Math.min(_effectiveMax, state.speed + acceleration * _diveY * 2 * dt);
    else if (state.speed > maxSpeed) state.speed = Math.max(maxSpeed, state.speed - naturalDeceleration * 6 * dt); // bleed excess on level-out
    // ── Mouse-cursor quaternion steering (War Thunder style) ────────────
    if (settings.mouseSteering) {
        // Pre-check manual roll/pitch keys so corrections can be suppressed during manoeuvres
        const _rollKeyHeld  = keys.ArrowLeft || keys.ArrowRight || Math.abs(_gpAxes.roll)  > 0.1;
        const _pitchKeyHeld = keys.ArrowUp   || keys.ArrowDown  || Math.abs(_gpAxes.pitch) > 0.1;
        // Clamp effective cursor to STEER_CURSOR_RADIUS circle in NDC
        let cx = state._mouseNDC.x, cy = state._mouseNDC.y;
        const cr = Math.sqrt(cx * cx + cy * cy);
        if (cr > STEER_CURSOR_RADIUS) { cx *= STEER_CURSOR_RADIUS / cr; cy *= STEER_CURSOR_RADIUS / cr; }
        // Current forward in world space; save pre-rotation horizontal components for auto-bank
        _sv1.set(0, 0, 1).applyQuaternion(plane.quaternion);
        const oldFwdX = _sv1.x, oldFwdZ = _sv1.z;
        if (cr >= STEER_DEADZONE) {
            // Build desired direction in plane-local space (cursor center = plane forward, no camera bias)
            // Negate cx so left→left, cy positive so up→up
            const yawAng   = -(cx / STEER_CURSOR_RADIUS) * STEER_MAX_ANGLE;
            const pitchAng =  (cy / STEER_CURSOR_RADIUS) * STEER_MAX_ANGLE * (settings.invertPitch ? -1 : 1);
            _sv2.set(Math.sin(yawAng) * Math.cos(pitchAng), Math.sin(pitchAng), Math.cos(yawAng) * Math.cos(pitchAng));
            _sv2.applyQuaternion(plane.quaternion).normalize();
            // Angle between current forward and desired direction
            const cosA = Math.max(-1, Math.min(1, _sv1.dot(_sv2)));
            const angle = Math.acos(cosA);
            if (angle > 0.0001) {
                // Exponential approach (smooth), hard-clamped to max turn rate
                const smoothAng = angle * (1 - Math.pow(1 - STEER_SMOOTHING, dt));
                const applied   = Math.min(smoothAng, STEER_MAX_TURN_RATE * dt);
                _sq1.setFromUnitVectors(_sv1, _sv2);
                _sq2.identity().slerp(_sq1, applied / angle);
                plane.quaternion.premultiply(_sq2).normalize();
            }
        } else if (!_pitchKeyHeld) {
            // Cursor at rest and no manual pitch: gently level pitch toward horizontal flight
            _sv1.set(0, 0, 1).applyQuaternion(plane.quaternion);
            if (Math.abs(_sv1.y) > 0.005) plane.rotateX(_sv1.y * STEER_LEVEL_RATE * dt);
        }
        // Auto-banking: skip entirely when manual roll is held so full 360° rolls are possible
        if (!_rollKeyHeld) {
            _sv1.set(0, 0, 1).applyQuaternion(plane.quaternion); // new forward
            const hturn  = oldFwdX * _sv1.z - oldFwdZ * _sv1.x; // sin of horizontal turn
            _sv3.set(1, 0, 0).applyQuaternion(plane.quaternion);  // local right
            const bankErr = hturn * STEER_AUTO_BANK_K - _sv3.y;   // target bankY minus current
            // Cap correction to maxRollRate so auto-level is never faster than pressing the opposite key
            const bankCorr = Math.max(-maxRollRate, Math.min(maxRollRate, bankErr * STEER_BANK_SMOOTH));
            plane.rotateZ(bankCorr * dt);
        }
    }
    // ── Keyboard / gamepad fine-control (pitch, roll, yaw added on top) ──
    const pitchIn = Math.max(-1, Math.min(1, (keys.ArrowUp ? -1 : 0) + (keys.ArrowDown ? 1 : 0) + _gpAxes.pitch)) * (settings.invertPitch ? -1 : 1);
    const rollIn  = Math.max(-1, Math.min(1, (keys.ArrowLeft ? -1 : 0) + (keys.ArrowRight ? 1 : 0) + _gpAxes.roll));
    const yawIn   = Math.max(-1, Math.min(1, (keys.a ? 1 : 0) + (keys.d ? -1 : 0) + _gpAxes.yaw));
    if (pitchIn !== 0) state.pitchRate = Math.max(-maxPitchRate, Math.min(maxPitchRate, state.pitchRate + pitchIn * rotAccel * dt));
    else state.pitchRate *= Math.pow(rotDamping, dt);
    if (rollIn  !== 0) state.rollRate  = Math.max(-maxRollRate,  Math.min(maxRollRate,  state.rollRate  + rollIn  * rotAccel * dt));
    else state.rollRate  *= Math.pow(rotDamping, dt);
    if (yawIn   !== 0) state.yawRate   = Math.max(-maxYawRate,   Math.min(maxYawRate,   state.yawRate   + yawIn   * rotAccel * dt));
    else state.yawRate   *= Math.pow(rotDamping, dt);
    plane.rotateX(state.pitchRate * dt); plane.rotateZ(state.rollRate * dt); plane.rotateY(state.yawRate * dt);
    _sv1.set(0, 0, 1).applyQuaternion(plane.quaternion);
    plane.position.addScaledVector(_sv1, state.speed * dt);
    // Gun: the cooldown keeps its remainder, so the fire rate is the same at any frame rate (≤ 3 shots per frame)
    const trigger = keys[' '] || _mouseLMB || _gpAxes.shoot;
    state.shootCooldown -= dt;
    if (!trigger) state.shootCooldown = Math.max(0, state.shootCooldown);
    else {
        for (let shots = 0; shots < 3 && state.shootCooldown <= 0; shots++) {
            if (state.gunAmmo > 0) { fireBullet(); state.shootCooldown += shootCooldownTime; if (--state.gunAmmo <= 0) state.gunReloadTimer = GUN_RELOAD_TIME; }
            else { state._emptyClipFlash = 8; state.shootCooldown = shootCooldownTime; _playEmptyClip(); break; } // V13 / A11
        }
        state.shootCooldown = Math.max(state.shootCooldown, -shootCooldownTime); // don't bank shots past the cap
    }
    plane.updateMatrixWorld(true);
    // Update player bounding boxes (§2.1 — applyMatrix4 avoids per-vertex iteration)
    corePlaneComponents.forEach((m, i) => planePartBoxes[i].copy(planePartLocalBoxes[i]).applyMatrix4(m.matrixWorld));
    updateWingTrail(wingTrailL, _wingTipL);
    updateWingTrail(wingTrailR, _wingTipR);
    // Boundary check
    if (plane.position.y < groundLevel + 1.5 || plane.position.y > ceilingLevel - 1.5 || Math.abs(plane.position.x) > MAP_BOUNDARY || Math.abs(plane.position.z) > MAP_BOUNDARY) triggerGameOver();
}
