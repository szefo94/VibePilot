/**
 * Phone / tablet controls: an on-screen overlay with two wheels, plus optional tilt steering from the motion sensor.
 *
 *   left wheel   up/down = pitch · left/right = roll
 *   right wheel  up/down = throttle forward/back · left/right = yaw
 *   buttons      GUN (hold) beside the right wheel · MSL · FLR · BOMB · NAP · LASER above it
 *   indicator    between the thumbs: a ball for pitch/roll input, a bar for yaw, a gauge for throttle
 *   top right    ⏸ pause · TILT · ☾/☀ night/day · ⛶ fullscreen
 *
 * TILT: tilting the phone steers pitch and roll, relative to however you hold it when you switch it on (LEVEL
 * recentres). It reads the accelerometer's gravity vector (DeviceMotionEvent.accelerationIncludingGravity), turned
 * into the screen's frame and low-passed so hand shake doesn't register — the usual approach for tilt games; it has
 * no compass drift and none of the landscape gimbal problems of orientation angles. Response is soft: a wide range,
 * a dead zone and an expo curve. The left wheel hides; the right wheel (yaw, throttle) stays.
 * Phones that report no accelerometer data fall back to orientation angles (DeviceOrientationEvent).
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
    max: 40,          // degrees away from the reference for full deflection
    deadzone: 5,      // degrees ignored around the reference
    expo: 1.7,        // response curve: gentle near centre, full at the edge
    lowPass: 0.15,    // per sensor event: gravity-vector low-pass (hand shake and bumps don't register)
    calibration: 8,   // readings averaged into the reference when tilt starts or LEVEL is tapped
    yawMix: 0.2,      // roll also yaws a little, so turns stay coordinated
});
let enabled = false, tilt = null, laserButton = null; // tilt: { g, ref, samples, pitch, roll, source } while tilt steering is on
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
        <div class="tc-wheel tc-left" aria-label="Pitch and roll"><span class="tc-hint tc-up">PITCH</span><span class="tc-hint tc-left-hint">ROLL</span><div class="tc-knob"></div></div>
        <div class="tc-wheel tc-right" aria-label="Throttle and yaw"><span class="tc-hint tc-up">FWD</span><span class="tc-hint tc-down">BACK</span><span class="tc-hint tc-left-hint">YAW</span><div class="tc-knob"></div></div>
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
            <button type="button" data-tap="level" class="tc-level" aria-label="Recentre tilt">LEVEL</button>
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
    if (action === 'level') { if (tilt) { recalibrate(); local('Tilt recentred — this is level now'); } return; }
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
// Gravity (the accelerometer's reaction vector, "up" in the device frame) turned into the screen's frame:
// sx = screen right, sy = screen up, sz = out of the screen. Pitch and roll are angles of that vector, measured
// against the reference captured when tilt starts.

/** Device-frame vector → screen frame for the current screen rotation (0, 90, 180, 270). */
function toScreen(x, y, z) {
    const a = ((screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return { sx: x * c - y * s, sy: x * s + y * c, sz: z };
}
const pitchOf = v => Math.atan2(v.sy, v.sz);                    // leaning the top edge away lowers it
const rollOf = v => Math.atan2(v.sx, Math.hypot(v.sy, v.sz));   // dipping the right edge lowers it
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
/** Radians away from the reference → -1…1: dead zone, then an expo curve for fine control near the centre. */
function tiltAxis(rad) {
    const deg = (rad * 180) / Math.PI, a = Math.abs(deg);
    if (a < TILT.deadzone) return 0;
    return Math.sign(deg) * Math.pow(Math.min(1, (a - TILT.deadzone) / (TILT.max - TILT.deadzone)), TILT.expo);
}
function recalibrate() { tilt.ref = null; tilt.samples = []; tilt.pitch = tilt.roll = 0; }
/** One gravity reading (screen frame): calibrate first, then steer by the change from the reference. */
function onGravity(raw) {
    if (!tilt) return;
    const g = tilt.g ? { sx: tilt.g.sx + (raw.sx - tilt.g.sx) * TILT.lowPass, sy: tilt.g.sy + (raw.sy - tilt.g.sy) * TILT.lowPass, sz: tilt.g.sz + (raw.sz - tilt.g.sz) * TILT.lowPass } : raw;
    tilt.g = g;
    if (!tilt.ref) {
        tilt.samples.push(raw);
        if (tilt.samples.length < TILT.calibration) return;
        const n = tilt.samples.length, avg = k => tilt.samples.reduce((t, v) => t + v[k], 0) / n;
        tilt.ref = { sx: avg('sx'), sy: avg('sy'), sz: avg('sz') };
        // Some browsers report the vector with the opposite sign: hold posture always has "up" towards the screen's
        // top and face, so flip everything if the reference points the other way
        tilt.sign = tilt.ref.sy + tilt.ref.sz < 0 ? -1 : 1;
        tilt.g = { ...tilt.ref };
        return;
    }
    const s = tilt.sign, cur = { sx: g.sx * s, sy: g.sy * s, sz: g.sz * s }, ref = { sx: tilt.ref.sx * s, sy: tilt.ref.sy * s, sz: tilt.ref.sz * s };
    tilt.pitch = -tiltAxis(wrap(pitchOf(cur) - pitchOf(ref))); // +pitch = nose down: top edge tipped away
    tilt.roll = -tiltAxis(rollOf(cur) - rollOf(ref));          // +roll = right: right edge dipped
}
function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null) return;
    tilt.source = 'motion';
    onGravity(toScreen(a.x, a.y, a.z));
}
/** Fallback for phones without accelerometer data: gravity rebuilt from orientation angles. */
function onOrientation(e) {
    if (!tilt || tilt.source === 'motion' || e.beta === null) return;
    const b = (e.beta * Math.PI) / 180, g = (e.gamma * Math.PI) / 180;
    onGravity(toScreen(-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)));
}
function setTiltMode(on) {
    document.body.classList.toggle('tilt-on', on);
    wheels.left.release(); wheels.right.release();
}
async function toggleTilt(button) {
    if (tilt) {
        tilt = null; window.removeEventListener('devicemotion', onMotion); window.removeEventListener('deviceorientation', onOrientation);
        button.setAttribute('aria-pressed', 'false'); setTiltMode(false); local('Tilt steering off');
        return;
    }
    if (!('DeviceMotionEvent' in window) || !window.isSecureContext) {
        local(window.isSecureContext ? 'No motion sensor on this device' : 'Tilt needs https:// — use the wheels');
        return;
    }
    try { // iPhone: both sensors need the player's permission, asked from this tap
        for (const Ev of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) {
            if (typeof Ev?.requestPermission === 'function' && await Ev.requestPermission() !== 'granted') { local('Motion sensor permission denied'); return; }
        }
    } catch { local('Motion sensor permission denied'); return; }
    tilt = { g: null, ref: null, samples: [], sign: 1, pitch: 0, roll: 0, source: null };
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrientation);
    button.setAttribute('aria-pressed', 'true'); setTiltMode(true);
    local('Tilt steering on — your current hold is level (LEVEL recentres)');
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
        touchAxes.yaw = clamp1(-dead(R.x) - touchAxes.roll * TILT.yawMix);
    } else {
        touchAxes.pitch = dead(L.y);
        touchAxes.roll = dead(L.x);
        touchAxes.yaw = -dead(R.x);
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
