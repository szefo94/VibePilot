/** Keyboard, mouse and gamepad input. */
import { BOMB_RELOAD_TIME, FLARE_DURATION, FLARE_RELOAD_TIME, MISSILE_RELOAD_TIME, NAPALM_RELOAD_TIME, bombCooldownTime } from './config.js';
import { state } from './state.js';
import { memDebugEl, pausedElement } from './ui/dom.js';
import { aimingLaser } from './player/plane.js';
import { wingTrailL, wingTrailR } from './player/wingTrails.js';
import { _toggleColorMode } from './effects/colorMode.js';
import { _deathGraphEl } from './ui/debrief.js';
import { spawnInterceptors } from './entities/airUnits.js';
import { deployFlareEffect, dropBomb, dropNapalm, fireMissile } from './combat/weapons.js';

// --- Input Handling ---
export const keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, w: false, s: false, a: false, d: false, ' ': false };
export let _mouseLMB = false; // left mouse button held — machinegun
window.addEventListener('contextmenu', e => e.preventDefault()); // suppress right-click menu
window.addEventListener('mousedown', e => {
    if (state.isGameOver || state.isPaused) return;
    if (document.getElementById('splash-screen')) return;
    if (e.button === 0) _mouseLMB = true;
    if (e.button === 2 && state.missileAmmo > 0) { fireMissile(); if (--state.missileAmmo <= 0) state.missileReloadTimer = MISSILE_RELOAD_TIME; }
});
window.addEventListener('mouseup', e => { if (e.button === 0) _mouseLMB = false; });
window.addEventListener('mousemove', e => {
    state._mouseNDC.x = (e.clientX / window.innerWidth)  * 2 - 1;
    state._mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
});
document.addEventListener('keydown', e => {
    if (state.isGameOver) {
        // Allow orbit controls during game-over free-look
        if (keys.hasOwnProperty(e.key)) keys[e.key] = true;
        const _k = e.key.toLowerCase();
        if (keys.hasOwnProperty(_k)) keys[_k] = true;
        return;
    }
    if (document.getElementById('splash-screen')) return;
    const k = e.key.toLowerCase();
    if (k === 'f') aimingLaser.visible = !aimingLaser.visible;
    else if (k === 'e') { if (state.bombCooldown <= 0 && state.bombAmmo > 0) { dropBomb(); state.bombCooldown = bombCooldownTime; if (--state.bombAmmo <= 0) state.bombReloadTimer = BOMB_RELOAD_TIME; } }
    else if (k === 'r') { if (state.missileAmmo > 0) { fireMissile(); if (--state.missileAmmo <= 0) state.missileReloadTimer = MISSILE_RELOAD_TIME; } }
    else if (k === 'q') { if (state.flareAmmo > 0) { state.flareTimer = FLARE_DURATION; deployFlareEffect(); if (--state.flareAmmo <= 0) state.flareReloadTimer = FLARE_RELOAD_TIME; } }
    else if (k === 'x') { if (state.napalmAmmo > 0) { dropNapalm(); if (--state.napalmAmmo <= 0) state.napalmReloadTimer = NAPALM_RELOAD_TIME; } }
    else if (k === 'i') { spawnInterceptors(); } // debug: instant interceptor wave
    else if (keys.hasOwnProperty(k)) keys[k] = true;
    else if (keys.hasOwnProperty(e.key)) keys[e.key] = true;
});
document.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
    else if (keys.hasOwnProperty(e.key)) keys[e.key] = false;
});
document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'b') state.debugCollision = !state.debugCollision;
    if (e.key.toLowerCase() === 'm') { memDebugEl.classList.toggle('active'); state._memDebugTimer = 0; }
    if (e.key.toLowerCase() === 'n') { wingTrailL.pts.visible = !wingTrailL.pts.visible; wingTrailR.pts.visible = !wingTrailR.pts.visible; }
    if (e.key.toLowerCase() === 'c') _toggleColorMode();
    if (e.key.toLowerCase() === 'g' && state.isGameOver) { _deathGraphEl.style.display = _deathGraphEl.style.display === 'none' ? 'block' : 'none'; }
    if (e.key === 'Escape' && !state.isGameOver && !document.getElementById('splash-screen')) {
        state.isPaused = !state.isPaused;
        pausedElement.style.display = state.isPaused ? 'block' : 'none';
        if (state.isPaused) { Object.keys(keys).forEach(k => keys[k] = false); state.pitchRate = state.rollRate = state.yawRate = 0; _mouseLMB = false; }
    }
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
    const p = b => !!gp.buttons[b]?.pressed;
    if (!document.getElementById('splash-screen')) {
        // Start → pause/unpause during play, reload on game over
        if (p(9) && !_gpPrev[9]) {
            if (state.isGameOver) { location.reload(); }
            else { state.isPaused = !state.isPaused; pausedElement.style.display = state.isPaused ? 'block' : 'none'; if (state.isPaused) { Object.keys(keys).forEach(k => keys[k] = false); state.pitchRate = state.rollRate = state.yawRate = 0; _mouseLMB = false; } }
        }
        if (!state.isGameOver && !state.isPaused) {
            if (p(1) && !_gpPrev[1]) { if (state.bombCooldown <= 0 && state.bombAmmo > 0) { dropBomb(); state.bombCooldown = bombCooldownTime; if (--state.bombAmmo <= 0) state.bombReloadTimer = BOMB_RELOAD_TIME; } }    // B → bomb
            if (p(2) && !_gpPrev[2]) { if (state.missileAmmo > 0) { fireMissile(); if (--state.missileAmmo <= 0) state.missileReloadTimer = MISSILE_RELOAD_TIME; } }                                             // X → missile
            if (p(3) && !_gpPrev[3]) { if (state.flareAmmo > 0) { state.flareTimer = FLARE_DURATION; deployFlareEffect(); if (--state.flareAmmo <= 0) state.flareReloadTimer = FLARE_RELOAD_TIME; } }                  // Y → flares
            if (p(4) && !_gpPrev[4]) { if (state.napalmAmmo > 0) { dropNapalm(); if (--state.napalmAmmo <= 0) state.napalmReloadTimer = NAPALM_RELOAD_TIME; } }                                                  // LB → napalm
            if (p(5) && !_gpPrev[5]) { aimingLaser.visible = !aimingLaser.visible; }                                                                                                           // RB → laser
            if (p(0) && !_gpPrev[0]) { if (state.bombCooldown <= 0 && state.bombAmmo > 0) { dropBomb(); state.bombCooldown = bombCooldownTime; if (--state.bombAmmo <= 0) state.bombReloadTimer = BOMB_RELOAD_TIME; } }    // A → bomb (alt)
        }
    }
    // Save button states for next frame edge detection
    for (let i = 0; i < gp.buttons.length; i++) _gpPrev[i] = !!gp.buttons[i]?.pressed;
}
