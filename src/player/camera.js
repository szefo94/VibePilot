/** Chase camera and game-over orbit camera. */
import { state } from '../state.js';
import { camera } from '../core/scene.js';
import { _camOffset, _lookAt, _sv1 } from '../core/scratch.js';
import { plane } from './plane.js';
import { keys } from '../input.js';
import { maxSpeed } from '../config.js';

// Game-over free-look orbit
export const _gameOverPos = new THREE.Vector3();
const _goOrbitDist = 35;

// Speed you can feel: the field of view widens with airspeed (dives included), less with prefers-reduced-motion
const BASE_FOV = 75, FAST_FOV = matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 88;
let fov = BASE_FOV;
function updateSpeedFov(dt) {
    const k = THREE.MathUtils.clamp((state.speed - 0.3 * maxSpeed) / (1.3 * maxSpeed), 0, 1); // ~cruise → nothing; full dive → all
    fov += (BASE_FOV + (FAST_FOV - BASE_FOV) * k * k * (3 - 2 * k) - fov) * (1 - Math.pow(0.94, dt)); // smoothstep, eased
    if (Math.abs(camera.fov - fov) > 0.02) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

export function updateCamera(dt) {
    if (state.isGameOver || state._playerDown) { // game over or waiting to respawn: orbit the crash site
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
    if (!state.isPaused) { camera.position.lerp(camTarget, 1 - Math.pow(1 - 0.06, dt)); updateSpeedFov(dt); } // 6 % per 60 fps frame, frame-rate independent
    camera.lookAt(_lookAt);
}
