/**
 * Phone / tablet controls: an on-screen overlay with two wheels, plus optional tilt steering from the motion sensor.
 *
 *   left wheel   up/down = pitch · left/right = yaw
 *   right wheel  up/down = throttle forward/back · left/right = roll
 *   buttons      GUN (hold) beside the right wheel · MSL · FLR · BOMB · NAP · LASER above it
 *   indicator    between the thumbs: a ball for pitch/roll input, a bar for yaw, a gauge for throttle
 *   top right    ⏸ pause · TILT · ☾/☀ night/day · ⛶ fullscreen
 *
 * TILT: tilting the phone steers pitch and roll ("level" = how you hold it when you switch it on), softly — a wide
 * range, a dead zone, an expo curve and smoothing — and the screen keeps only the throttle (the right wheel, locked
 * to up/down); a little yaw follows the roll so turns stay coordinated.
 *
 * It switches on for touch screens (coarse pointer) or at the first touch anywhere. Values land in `touchAxes`,
 * which input.js adds to the gamepad axes, so flight.js needs no touch-specific code. Mouse steering is turned
 * off for the session (not saved), since taps would otherwise move the steering cursor.
 * Fullscreen and the iPhone motion permission need a completed tap, so those buttons act on touchend/click.
 * Tilt needs a secure page (https:// or localhost).
 */
import { state } from '../state.js';
import { setSetting, settings } from '../core/settings.js';
import { _steerCursorEl } from './dom.js';
import { aimingLaser } from '../player/plane.js';
import { tryDeployFlares, tryDropBomb, tryDropNapalm, tryFireMissile } from '../combat/weapons.js';
import { togglePause } from '../game/session.js';
import { showNotification } from './notifications.js';

export const touchAxes = { pitch: 0, roll: 0, yaw: 0, throttleUp: 0, throttleDown: 0, shoot: false };

const WHEEL_TRAVEL = 56;   // px — knob travel from the centre
const WHEEL_DEADZONE = 0.12;
const TILT = Object.freeze({
    max: 40,        // degrees of tilt for full deflection (was 25: far too twitchy)
    deadzone: 5,    // degrees ignored around "level"
    expo: 1.7,      // response curve: gentle near centre, full at the edge
    smoothing: 0.18, // per sensor event: low-pass to remove hand jitter
    yawMix: 0.3,    // roll input also yaws a little (the yaw wheel is hidden while tilting)
});
let enabled = false, tilt = null, laserButton = null; // tilt: { neutralPitch, neutralRoll, pitch, roll } while tilt steering is on
const wheels = {};         // name → { id, x, y, release, lockX }
let indicator = null;      // { ball, yaw, thr }

const flying = () => !state.awaitingStart && !state.isPaused && !state.isGameOver && !document.getElementById('splash-screen');
const clamp1 = v => Math.max(-1, Math.min(1, v));
const dead = v => (Math.abs(v) < WHEEL_DEADZONE ? 0 : Math.sign(v) * (Math.abs(v) - WHEEL_DEADZONE) / (1 - WHEEL_DEADZONE));
const local = text => showNotification(text, false, { local: true }); // device messages are never shared

/** A wheel follows one finger: x, y in -1…1 (y down = +1), back to 0 when released. lockX: only up/down. */
function makeWheel(name, el) {
    const knob = el.querySelector('.tc-knob'), w = { id: null, x: 0, y: 0, lockX: false };
    const move = t => {
        const r = el.getBoundingClientRect();
        let dx = w.lockX ? 0 : t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
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
        <div class="tc-wheel tc-left" aria-label="Pitch and yaw"><span class="tc-hint tc-up">PITCH</span><span class="tc-hint tc-left-hint">YAW</span><div class="tc-knob"></div></div>
        <div class="tc-wheel tc-right" aria-label="Throttle and roll"><span class="tc-hint tc-up">FWD</span><span class="tc-hint tc-down">BACK</span><span class="tc-hint tc-left-hint tc-roll-hint">ROLL</span><div class="tc-knob"></div></div>
        <div class="tc-indicator" aria-hidden="true">
            <div class="tc-ind-ring"><div class="tc-ind-cross"></div><div class="tc-ind-ball"></div></div>
            <div class="tc-ind-yaw"><div></div></div>
            <div class="tc-ind-thr"><div></div></div>
        </div>
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
            <button type="button" data-activate="tilt" aria-pressed="false">TILT</button>
            <button type="button" data-tap="daynight" aria-label="Day or night">☾</button>
            <button type="button" data-activate="fullscreen" aria-label="Fullscreen">⛶</button>
        </div>
        <div class="tc-rotate">Turn your phone sideways ⟲</div>`;
    document.body.appendChild(root);
    makeWheel('left', root.querySelector('.tc-left'));
    makeWheel('right', root.querySelector('.tc-right'));
    laserButton = root.querySelector('[data-tap="laser"]');
    indicator = { ball: root.querySelector('.tc-ind-ball'), yaw: root.querySelector('.tc-ind-yaw div'), thr: root.querySelector('.tc-ind-thr div') };

    // Hold button (gun)
    for (const b of root.querySelectorAll('[data-hold]')) {
        const set = on => { touchAxes.shoot = on; b.classList.toggle('held', on); };
        b.addEventListener('touchstart', e => { e.preventDefault(); set(true); }, { passive: false });
        b.addEventListener('touchend', e => { e.preventDefault(); set(false); }, { passive: false });
        b.addEventListener('touchcancel', () => set(false));
    }
    // Tap buttons fire on touch-down (fast); a click from a mouse or keyboard works too
    for (const b of root.querySelectorAll('[data-tap]')) {
        b.addEventListener('touchstart', e => { e.preventDefault(); tap(b.dataset.tap, b); }, { passive: false });
        b.addEventListener('click', () => tap(b.dataset.tap, b));
    }
    // Fullscreen and motion permission need a user activation, which browsers grant on touchend/click, not touchstart
    for (const b of root.querySelectorAll('[data-activate]')) {
        b.addEventListener('touchend', e => { e.preventDefault(); activate(b.dataset.activate, b); }, { passive: false });
        b.addEventListener('click', () => activate(b.dataset.activate, b));
    }
    // Losing the page (call, app switch) must not leave the gun firing or a wheel held
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) return;
        for (const w of Object.values(wheels)) w.release();
        touchAxes.shoot = false; root.querySelector('[data-hold]').classList.remove('held');
    });
    document.addEventListener('fullscreenchange', () => root.querySelector('[data-activate="fullscreen"]').setAttribute('aria-pressed', String(!!document.fullscreenElement)));
}

function tap(action, button) {
    if (action === 'pause') { togglePause(); return; }
    if (action === 'daynight') { setSetting('timeOfDay', settings.timeOfDay === 'night' ? 'day' : 'night'); button.textContent = settings.timeOfDay === 'night' ? '☀' : '☾'; return; }
    if (action === 'laser') { aimingLaser.visible = !aimingLaser.visible; button.setAttribute('aria-pressed', String(aimingLaser.visible)); return; }
    if (!flying()) return;
    if (action === 'missile') tryFireMissile();
    else if (action === 'flare') tryDeployFlares();
    else if (action === 'bomb') tryDropBomb();
    else if (action === 'napalm') tryDropNapalm();
}
function activate(action, button) {
    if (action === 'fullscreen') toggleFullscreen();
    else if (action === 'tilt') toggleTilt(button);
}

function toggleFullscreen() {
    const doc = document, el = doc.documentElement;
    const isFull = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (isFull) { (doc.exitFullscreen || doc.webkitExitFullscreen)?.call(doc); return; }
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) { local('Fullscreen isn’t available here — on iPhone use Share → Add to Home Screen'); return; }
    try {
        const p = request.call(el, { navigationUI: 'hide' });
        const lock = () => screen.orientation?.lock?.('landscape').catch(() => {});
        if (p?.then) p.then(lock).catch(() => local('Fullscreen was blocked by the browser'));
        else lock();
    } catch { local('Fullscreen was blocked by the browser'); }
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
/** Degrees away from level → -1…1: dead zone, then an expo curve for fine control near the centre. */
function tiltAxis(v, neutral) {
    const d = v - neutral, a = Math.abs(d);
    if (a < TILT.deadzone) return 0;
    const t = Math.min(1, (a - TILT.deadzone) / (TILT.max - TILT.deadzone));
    return Math.sign(d) * Math.pow(t, TILT.expo);
}
function onOrientation(e) {
    if (!tilt) return;
    const t = screenTilt(e);
    if (tilt.neutralPitch === null) { tilt.neutralPitch = t.pitch; tilt.neutralRoll = t.roll; } // first reading = level
    tilt.pitch += (tiltAxis(t.pitch, tilt.neutralPitch) - tilt.pitch) * TILT.smoothing;
    tilt.roll += (tiltAxis(t.roll, tilt.neutralRoll) - tilt.roll) * TILT.smoothing;
}
function setTiltMode(on) {
    document.body.classList.toggle('tilt-on', on);
    wheels.right.lockX = on; // throttle only
    wheels.left.release(); wheels.right.release();
}
async function toggleTilt(button) {
    if (tilt) {
        tilt = null; window.removeEventListener('deviceorientation', onOrientation);
        button.setAttribute('aria-pressed', 'false'); setTiltMode(false); local('Tilt steering off');
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
    button.setAttribute('aria-pressed', 'true'); setTiltMode(true);
    local('Tilt steering on — hold the phone as "level" now');
}

/** Once per frame from input.js, before the axes are read: fold the wheels and tilt into touchAxes. */
export function updateTouchAxes() {
    if (!enabled) return;
    if (laserButton && laserButton.getAttribute('aria-pressed') !== String(aimingLaser.visible)) laserButton.setAttribute('aria-pressed', String(aimingLaser.visible)); // F key / gamepad too
    // Axes follow flight.js: +pitch = nose down, +roll = right, +yaw = left. Wheel up = nose up, like the ↑ key;
    // tilting the top edge away = nose down, like pushing a flight stick.
    const L = wheels.left, R = wheels.right;
    if (tilt) {
        touchAxes.pitch = clamp1(tilt.pitch);
        touchAxes.roll = clamp1(tilt.roll);
        touchAxes.yaw = -touchAxes.roll * TILT.yawMix;
    } else {
        touchAxes.pitch = dead(L.y);
        touchAxes.yaw = -dead(L.x);
        touchAxes.roll = dead(R.x);
    }
    const thrust = -dead(R.y); // right wheel up = forward
    touchAxes.throttleUp = Math.max(0, thrust);
    touchAxes.throttleDown = Math.max(0, -thrust);
    // Movement indicator: the ball shows pitch/roll input (up = nose up), the bar yaw, the gauge throttle
    if (indicator) {
        indicator.ball.style.transform = `translate(${touchAxes.roll * 22}px, ${touchAxes.pitch * 22}px)`;
        indicator.yaw.style.transform = `translateX(${-touchAxes.yaw * 22}px)`;
        indicator.thr.style.height = `${Math.round((state.speed / 0.8) * 100)}%`;
    }
}

// Switch on for touch-first devices, or at the first touch on anything else (e.g. a touch-screen laptop)
if (matchMedia('(pointer: coarse)').matches) enable();
else window.addEventListener('touchstart', enable, { once: true, passive: true });
