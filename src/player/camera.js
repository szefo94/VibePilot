/** Chase camera and game-over orbit camera. */
import { state } from '../state.js';
import { camera } from '../core/scene.js';
import { _camOffset, _lookAt, _sv1 } from '../core/scratch.js';
import { plane } from './plane.js';
import { keys } from '../input.js';

// Game-over free-look orbit
export const _gameOverPos = new THREE.Vector3();
const _goOrbitDist = 35;

export function updateCamera(dt) {
    if (state.isGameOver) {
        const ORBIT_SPEED = 0.025 * dt; // radians per 60 fps frame
        if (keys.ArrowLeft  || keys.a) state._goOrbitYaw   -= ORBIT_SPEED;
        if (keys.ArrowRight || keys.d) state._goOrbitYaw   += ORBIT_SPEED;
        if (keys.ArrowUp)              state._goOrbitPitch  = Math.min(state._goOrbitPitch + ORBIT_SPEED, Math.PI / 2 - 0.05);
        if (keys.ArrowDown)            state._goOrbitPitch  = Math.max(state._goOrbitPitch - ORBIT_SPEED, -0.3);
        const r = _goOrbitDist;
        camera.position.set(
            _gameOverPos.x + r * Math.cos(state._goOrbitPitch) * Math.sin(state._goOrbitYaw),
            _gameOverPos.y + r * Math.sin(state._goOrbitPitch),
            _gameOverPos.z + r * Math.cos(state._goOrbitPitch) * Math.cos(state._goOrbitYaw)
        );
        camera.lookAt(_gameOverPos);
        return;
    }
    _camOffset.set(0, 8, -22).applyQuaternion(plane.quaternion);
    const camTarget = _sv1.copy(plane.position).add(_camOffset);
    _lookAt.set(0, 1, 20).applyQuaternion(plane.quaternion).add(plane.position);
    if (!state.isPaused) camera.position.lerp(camTarget, 1 - Math.pow(1 - 0.06, dt)); // 6 % per 60 fps frame, frame-rate independent
    camera.lookAt(_lookAt);
}
