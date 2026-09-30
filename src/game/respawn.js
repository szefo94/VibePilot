/**
 * Respawn instead of game over (RULES.respawn). playerDown() leaves a wreck — the plane is hidden and frozen,
 * the camera orbits the crash site — and runs the 'playerDown' hook; whoever owns the session (e.g. a
 * multiplayer server) later calls respawnPlayer() with the new position and heading.
 */
import { GRACE_PERIOD, minSpeed } from '../config.js';
import { state } from '../state.js';
import { hpElement } from '../ui/dom.js';
import { plane } from '../player/plane.js';
import { createExplosion } from '../effects/effects.js';
import { _gameOverPos } from '../player/camera.js';
import { runHooks } from './hooks.js';

export function playerDown() {
    if (state._playerDown) return;
    state._playerDown = true;
    createExplosion(plane.position, 1);
    _gameOverPos.copy(plane.position);
    state._goOrbitYaw = 0; state._goOrbitPitch = 0.3;
    plane.visible = false;
    state.speed = 0; state.pitchRate = state.rollRate = state.yawRate = 0;
    runHooks('playerDown');
}

/** Put the player back in the air at `position` facing `quaternion`, full HP, with spawn protection. */
export function respawnPlayer(position, quaternion) {
    plane.position.copy(position);
    plane.quaternion.copy(quaternion);
    plane.updateMatrixWorld(true);
    state.planeHP = 100; hpElement.textContent = state.planeHP;
    state.speed = Math.max(minSpeed, 0.3);
    state.pitchRate = state.rollRate = state.yawRate = 0;
    state._graceTimer = GRACE_PERIOD;
    plane.visible = true;
    state._playerDown = false;
}
