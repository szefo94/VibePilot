/**
 * Phone / tablet controls: an on-screen overlay with two wheels (like a gamepad's two sticks), plus optional tilt
 * steering from the motion sensor.
 *
 *   left wheel   up/down = throttle forward/back · left/right = yaw
 *   right wheel  up/down = pitch · left/right = roll
 *   buttons      GUN (hold) · MSL · FLR · BOMB · NAP · LASER, above the right wheel
 *   top right    ⏸ pause · TILT (the phone's tilt steers pitch/roll; "level" = how you hold it when tapped) · ⛶ fullscreen
 *
 * It switches on for touch screens (coarse pointer) or at the first touch anywhere. Values land in `touchAxes`,
 * which input.js adds to the gamepad axes, so flight.js needs no touch-specific code. Mouse steering is turned
 * off for the session (not saved), since taps would otherwise move the steering cursor.
 * Tilt needs a secure page (https:// or localhost); iPhones also ask for permission when TILT is tapped.
 */
import { state } from '../state.js';
import { settings } from '../core/settings.js';
import { _steerCursorEl } from './dom.js';
import { aimingLaser } from '../player/plane.js';
import { tryDeployFlares, tryDropBomb, tryDropNapalm, tryFireMissile } from '../combat/weapons.js';
import { togglePause } from '../game/session.js';
import { showNotification } from './notifications.js';

export const touchAxes = { pitch: 0, roll: 0, yaw: 0, throttleUp: 0, throttleDown: 0, shoot: false };

const WHEEL_TRAVEL = 56;   // px — knob travel from the centre
const WHEEL_DEADZONE = 0.12;
const TILT_MAX = 25;       // degrees of tilt for full deflection
const TILT_DEADZONE = 3;   // degrees
let enabled = false, tilt = null, laserButton = null; // tilt: { neutralPitch, neutralRoll, pitch, roll } while tilt steering is on
const wheels = {};         // name → { id, x, y, release }

const flying = () => !state.awaitingStart && !state.isPaused && !state.isGameOver && !document.getElementById('splash-screen');
const clamp1 = v => Math.max(-1, Math.min(1, v));
const dead = v => (Math.abs(v) < WHEEL_DEADZONE ? 0 : Math.sign(v) * (Math.abs(v) - WHEEL_DEADZONE) / (1 - WHEEL_DEADZONE));
const local = text => showNotification(text, false, { local: true }); // device messages are never shared

/** A wheel follows one finger: x, y in -1…1 (y down = +1), back to 0 when released. */
function makeWheel(name, el) {
    const knob = el.querySelector('.tc-knob'), w = { id: null, x: 0, y: 0 };
    const move = t => {
        const r = el.getBoundingClientRect();
        let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
        const len = Math.hypot(dx, dy);
        if (len > WHEEL_TRAVEL) { dx *= WHEEL_TRAVEL / len; dy *= WHEEL_TRAVEL / len; }
        w.x = dx / WHEEL_TRAVEL; w.y = dy / WHEEL_TRAVEL;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    w.release = () => { w.id = null; w.x = w.y = 0; knob.style.transform = ''; };
    el.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; w.id = t.identifier; move(t); }, { passive: false });
    el.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === w.id) move(t); }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === w.id) w.release(); };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    wheels[name] = w;
}

/** Build the overlay once. */
function enable() {
    if (enabled) return;
    enabled = true;
    document.body.classList.add('touch');
    settings.mouseSteering = false; // session only — taps must not steer
    _steerCursorEl.style.display = 'none';

    const root = document.createElement('div');
    root.id = 'touch-controls';
    root.innerHTML = `
        <div class="tc-wheel tc-thrust" aria-label="Throttle and yaw"><span class="tc-hint tc-up">FWD</span><span class="tc-hint tc-down">BACK</span><span class="tc-hint tc-left">YAW</span><div class="tc-knob"></div></div>
        <div class="tc-wheel tc-flight" aria-label="Pitch and roll"><span class="tc-hint tc-up">PITCH</span><span class="tc-hint tc-left">ROLL</span><div class="tc-knob"></div></div>
        <div class="tc-weapons">
            <button type="button" class="tc-gun" data-hold="shoot">GUN</button>
            <button type="button" data-tap="missile">MSL</button>
            <button type="button" data-tap="flare">FLR</button>
            <button type="button" data-tap="bomb">BOMB</button>
            <button type="button" data-tap="napalm">NAP</button>
            <button type="button" data-tap="laser" aria-pressed="true">LASER</button>
        </div>
        <div class="tc-system">
            <button type="button" data-tap="pause" aria-label="Pause">⏸</button>
            <button type="button" data-tap="tilt" aria-pressed="false">TILT</button>
            <button type="button" data-tap="fullscreen" aria-label="Fullscreen">⛶</button>
        </div>
        <div class="tc-rotate">Turn your phone sideways ⟲</div>`;
    document.body.appendChild(root);
    makeWheel('thrust', root.querySelector('.tc-thrust'));
    makeWheel('flight', root.querySelector('.tc-flight'));
    laserButton = root.querySelector('[data-tap="laser"]');

    // Hold button (gun) and tap buttons (weapons, laser, system)
    for (const b of root.querySelectorAll('[data-hold]')) {
        const set = on => { touchAxes.shoot = on; b.classList.toggle('held', on); };
        b.addEventListener('touchstart', e => { e.preventDefault(); set(true); }, { passive: false });
        b.addEventListener('touchend', e => { e.preventDefault(); set(false); }, { passive: false });
        b.addEventListener('touchcancel', () => set(false));
    }
    for (const b of root.querySelectorAll('[data-tap]')) {
        b.addEventListener('touchstart', e => { e.preventDefault(); tap(b.dataset.tap, b); }, { passive: false });
        b.addEventListener('click', () => tap(b.dataset.tap, b)); // mouse / accessibility
    }
    // Losing the page (call, app switch) must not leave the gun firing or a wheel held
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) return;
        for (const w of Object.values(wheels)) w.release();
        touchAxes.shoot = false; root.querySelector('[data-hold]').classList.remove('held');
    });
}

function tap(action, button) {
    if (action === 'pause') { togglePause(); return; }
    if (action === 'fullscreen') { toggleFullscreen(); return; }
    if (action === 'tilt') { toggleTilt(button); return; }
    if (action === 'laser') { aimingLaser.visible = !aimingLaser.visible; button.setAttribute('aria-pressed', String(aimingLaser.visible)); return; }
    if (!flying()) return;
    if (action === 'missile') tryFireMissile();
    else if (action === 'flare') tryDeployFlares();
    else if (action === 'bomb') tryDropBomb();
    else if (action === 'napalm') tryDropNapalm();
}

function toggleFullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
}

// --- Tilt steering ---------------------------------------------------------------------------------

/** Device tilt in the screen's frame: pitch = nose down when the top edge tips away, roll = right when tilted right. */
function screenTilt(e) {
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    const b = e.beta ?? 0, g = e.gamma ?? 0;
    if (angle === 90) return { pitch: g, roll: b };
    if (angle === 270 || angle === -90) return { pitch: -g, roll: -b };
    return { pitch: -b, roll: g }; // portrait
}
function onOrientation(e) {
    if (!tilt) return;
    const t = screenTilt(e);
    if (tilt.neutralPitch === null) { tilt.neutralPitch = t.pitch; tilt.neutralRoll = t.roll; } // first reading = level
    const axis = (v, n) => { const d = v - n; return Math.abs(d) < TILT_DEADZONE ? 0 : clamp1((d - Math.sign(d) * TILT_DEADZONE) / (TILT_MAX - TILT_DEADZONE)); };
    tilt.pitch = axis(t.pitch, tilt.neutralPitch);
    tilt.roll = axis(t.roll, tilt.neutralRoll);
}
async function toggleTilt(button) {
    if (tilt) {
        tilt = null; window.removeEventListener('deviceorientation', onOrientation);
        button.setAttribute('aria-pressed', 'false'); local('Tilt steering off');
        return;
    }
    if (!('DeviceOrientationEvent' in window) || !window.isSecureContext) {
        local(window.isSecureContext ? 'No motion sensor on this device' : 'Tilt needs https:// — use the wheels');
        return;
    }
    try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function' && await DeviceOrientationEvent.requestPermission() !== 'granted') {
            local('Motion sensor permission denied'); return;
        }
    } catch { local('Motion sensor permission denied'); return; }
    tilt = { neutralPitch: null, neutralRoll: null, pitch: 0, roll: 0 };
    window.addEventListener('deviceorientation', onOrientation);
    button.setAttribute('aria-pressed', 'true');
    local('Tilt steering on — hold the phone as "level" now');
}

/** Once per frame from input.js, before the axes are read: fold the wheels and tilt into touchAxes. */
export function updateTouchAxes() {
    if (!enabled) return;
    // Axes follow flight.js: +pitch = nose down, +roll = right, +yaw = left. Wheel up = nose up, like the ↑ key;
    // tilting the top edge away = nose down, like pushing a flight stick.
    const f = wheels.flight, t = wheels.thrust;
    if (laserButton && laserButton.getAttribute('aria-pressed') !== String(aimingLaser.visible)) laserButton.setAttribute('aria-pressed', String(aimingLaser.visible)); // F key / gamepad too
    touchAxes.pitch = clamp1(dead(f.y) + (tilt?.pitch ?? 0));
    touchAxes.roll = clamp1(dead(f.x) + (tilt?.roll ?? 0));
    touchAxes.yaw = -dead(t.x);
    const thrust = -dead(t.y); // wheel up = forward
    touchAxes.throttleUp = Math.max(0, thrust);
    touchAxes.throttleDown = Math.max(0, -thrust);
}

// Switch on for touch-first devices, or at the first touch on anything else (e.g. a touch-screen laptop)
if (matchMedia('(pointer: coarse)').matches) enable();
else window.addEventListener('touchstart', enable, { once: true, passive: true });
