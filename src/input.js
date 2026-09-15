/** Keyboard, mouse and gamepad input. */
import { state } from './state.js';
import { memDebugEl, pausedElement } from './ui/dom.js';
import { aimingLaser } from './player/plane.js';
import { wingTrailL, wingTrailR } from './player/wingTrails.js';
import { _toggleColorMode } from './effects/colorMode.js';
import { _deathGraphEl } from './ui/debrief.js';
import { spawnInterceptors } from './entities/airUnits.js';
import { tryDeployFlares, tryDropBomb, tryDropNapalm, tryFireMissile } from './combat/weapons.js';

// --- Input Handling ---
export const keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, w: false, s: false, a: false, d: false, ' ': false };
export let _mouseLMB = false; // left mouse button held — machinegun

const splashActive = () => !!document.getElementById('splash-screen');
// Gameplay actions (weapons, spawns) are only accepted while actually flying
const canAct = () => !state.isGameOver && !state.isPaused && !splashActive();

/** Release every held input (keys, mouse gun, rotation rates). */
function clearHeldInput() {
    Object.keys(keys).forEach(k => keys[k] = false);
    _mouseLMB = false;
    state.pitchRate = state.rollRate = state.yawRate = 0;
}
function togglePause() {
    state.isPaused = !state.isPaused;
    pausedElement.style.display = state.isPaused ? 'block' : 'none';
    if (state.isPaused) clearHeldInput();
}
const heldKey = e => keys.hasOwnProperty(e.key.toLowerCase()) ? e.key.toLowerCase() : keys.hasOwnProperty(e.key) ? e.key : null;

window.addEventListener('contextmenu', e => e.preventDefault()); // suppress right-click menu
window.addEventListener('mousedown', e => {
    if (!canAct()) return;
    if (e.button === 0) _mouseLMB = true;
    if (e.button === 2) tryFireMissile();
});
window.addEventListener('mouseup', e => { if (e.button === 0) _mouseLMB = false; });
window.addEventListener('mousemove', e => {
    state._mouseNDC.x = (e.clientX / window.innerWidth)  * 2 - 1;
    state._mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
});
// Losing focus never delivers keyup/mouseup — clear held input so nothing sticks
window.addEventListener('blur', clearHeldInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearHeldInput(); });

document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    const held = heldKey(e);
    if (state.isGameOver) {
        if (held) keys[held] = true; // orbit controls during game-over free-look
        if (k === 'g' && !e.repeat) _deathGraphEl.style.display = _deathGraphEl.style.display === 'none' ? 'block' : 'none';
        return;
    }
    if (splashActive()) return;
    if (e.key === 'Escape') { if (!e.repeat) togglePause(); return; }
    // Display toggles work any time; ignore auto-repeat so holding a key doesn't flicker
    if (!e.repeat) {
        if (k === 'b') state.debugCollision = !state.debugCollision;
        else if (k === 'm') { memDebugEl.classList.toggle('active'); state._memDebugTimer = 0; }
        else if (k === 'n') { wingTrailL.pts.visible = !wingTrailL.pts.visible; wingTrailR.pts.visible = !wingTrailR.pts.visible; }
        else if (k === 'c') _toggleColorMode();
    }
    if (state.isPaused) return;
    if (held) { keys[held] = true; return; }
    if (e.repeat) return;
    if (k === 'f') aimingLaser.visible = !aimingLaser.visible;
    else if (k === 'e') tryDropBomb();
    else if (k === 'r') tryFireMissile();
    else if (k === 'q') tryDeployFlares();
    else if (k === 'x') tryDropNapalm();
    else if (k === 'i') spawnInterceptors(); // debug: instant interceptor wave
});
document.addEventListener('keyup', e => {
    const held = heldKey(e);
    if (held) keys[held] = false;
});

// --- Gamepad (Xbox controller) support ---
const GP_DEADZONE = 0.15;
// Continuous analog state read each frame
// Left stick: X = yaw, Y = throttle  |  Right stick: X = roll, Y = pitch  |  RT = shoot
export const _gpAxes = { pitch: 0, roll: 0, yaw: 0, throttleUp: 0, throttleDown: 0, shoot: false };
// Previous button states for one-shot edge detection
const _gpPrev = [];
export function pollGamepad() {
    const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
    if (!gp) { _gpAxes.pitch = _gpAxes.roll = _gpAxes.yaw = _gpAxes.throttleUp = _gpAxes.throttleDown = 0; _gpAxes.shoot = false; return; }
    const dz = v => Math.abs(v) > GP_DEADZONE ? v : 0;
    // Left stick X = yaw; left stick Y = throttle (up = accelerate, down = brake)
    _gpAxes.yaw         = -dz(gp.axes[0]); // lx right = yaw right (negate to match keys.d)
    const ly             =  dz(gp.axes[1]);
    _gpAxes.throttleUp   = ly < 0 ? -ly : 0; // stick up  → accelerate
    _gpAxes.throttleDown = ly > 0 ?  ly : 0; // stick down → decelerate
    // Right stick X = roll, Y = pitch
    _gpAxes.roll  =  dz(gp.axes[2]); // rx right = roll right
    _gpAxes.pitch =  dz(gp.axes[3]); // ry down  = pitch down
    // RT (button 7) → shoot (continuous while held)
    _gpAxes.shoot = (gp.buttons[7]?.value ?? 0) > 0.1;
    // One-shot actions — fire only on button press (not while held)
    const pressed = b => !!gp.buttons[b]?.pressed && !_gpPrev[b];
    if (!splashActive()) {
        // Start → pause/unpause during play, reload on game over
        if (pressed(9)) { if (state.isGameOver) location.reload(); else togglePause(); }
        if (canAct()) {
            if (pressed(0) || pressed(1)) tryDropBomb();              // A / B → bomb
            if (pressed(2)) tryFireMissile();                         // X → missile
            if (pressed(3)) tryDeployFlares();                        // Y → flares
            if (pressed(4)) tryDropNapalm();                          // LB → napalm
            if (pressed(5)) aimingLaser.visible = !aimingLaser.visible; // RB → laser
        }
    }
    // Save button states for next frame edge detection
    for (let i = 0; i < gp.buttons.length; i++) _gpPrev[i] = !!gp.buttons[i]?.pressed;
}
