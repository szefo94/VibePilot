/**
 * Phone / tablet controls: an on-screen overlay, plus optional tilt steering from the motion sensor.
 *
 *   left thumb   joystick → pitch (up/down) and roll (left/right, with a little yaw); ▲ ▼ throttle
 *   right thumb  GUN (hold) · MSL · FLR · BOMB · NAP
 *   top right    ⏸ pause · TILT steering on/off (calibrates "level" to how you hold the phone) · ⛶ fullscreen
 *
 * It switches on for touch screens (coarse pointer) or at the first touch anywhere. Values land in `touchAxes`,
 * which input.js adds to the gamepad axes, so flight.js needs no touch-specific code. Mouse steering is turned
 * off for the session (not saved), since taps would otherwise move the steering cursor.
 * Tilt needs a secure page (https:// or localhost); iPhones also ask for permission when TILT is tapped.
 */
import { state } from '../state.js';
import { settings } from '../core/settings.js';
import { _steerCursorEl } from './dom.js';
import { tryDeployFlares, tryDropBomb, tryDropNapalm, tryFireMissile } from '../combat/weapons.js';
import { togglePause } from '../game/session.js';
import { showNotification } from './notifications.js';

export const touchAxes = { pitch: 0, roll: 0, yaw: 0, throttleUp: 0, throttleDown: 0, shoot: false };

const STICK_RADIUS = 56;   // px — knob travel
const TILT_MAX = 25;       // degrees of tilt for full deflection
const TILT_DEADZONE = 3;   // degrees
const YAW_MIX = 0.35;      // roll input also yaws a little, so small corrections don't need a bank
let enabled = false, tilt = null; // tilt: { neutralPitch, neutralRoll, pitch, roll } while tilt steering is on
const stick = { id: null, x: 0, y: 0 };

const flying = () => !state.awaitingStart && !state.isPaused && !state.isGameOver && !document.getElementById('splash-screen');
const clamp1 = v => Math.max(-1, Math.min(1, v));

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
        <div class="tc-stick" aria-label="Pitch and roll"><div class="tc-knob"></div></div>
        <div class="tc-throttle">
            <button type="button" data-hold="throttleUp" aria-label="Throttle up">▲</button>
            <button type="button" data-hold="throttleDown" aria-label="Throttle down">▼</button>
        </div>
        <div class="tc-weapons">
            <button type="button" class="tc-gun" data-hold="shoot">GUN</button>
            <button type="button" data-tap="missile">MSL</button>
            <button type="button" data-tap="flare">FLR</button>
            <button type="button" data-tap="bomb">BOMB</button>
            <button type="button" data-tap="napalm">NAP</button>
        </div>
        <div class="tc-system">
            <button type="button" data-tap="pause" aria-label="Pause">⏸</button>
            <button type="button" data-tap="tilt" aria-pressed="false">TILT</button>
            <button type="button" data-tap="fullscreen" aria-label="Fullscreen">⛶</button>
        </div>
        <div class="tc-rotate">Turn your phone sideways ⟲</div>`;
    document.body.appendChild(root);

    const stickEl = root.querySelector('.tc-stick'), knob = root.querySelector('.tc-knob');
    const moveStick = t => {
        const r = stickEl.getBoundingClientRect();
        let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
        stick.x = dx / STICK_RADIUS; stick.y = dy / STICK_RADIUS;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const releaseStick = () => { stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; };
    stickEl.addEventListener('touchstart', e => {
        e.preventDefault();
        const t = e.changedTouches[0];
        stick.id = t.identifier; moveStick(t);
    }, { passive: false });
    stickEl.addEventListener('touchmove', e => {
        e.preventDefault();
        for (const t of e.changedTouches) if (t.identifier === stick.id) moveStick(t);
    }, { passive: false });
    const endStick = e => { for (const t of e.changedTouches) if (t.identifier === stick.id) releaseStick(); };
    stickEl.addEventListener('touchend', endStick);
    stickEl.addEventListener('touchcancel', endStick);

    // Hold buttons (throttle, gun) and tap buttons (weapons, system)
    for (const b of root.querySelectorAll('[data-hold]')) {
        const key = b.dataset.hold;
        const set = on => { touchAxes[key] = key === 'shoot' ? on : (on ? 1 : 0); b.classList.toggle('held', on); };
        b.addEventListener('touchstart', e => { e.preventDefault(); set(true); }, { passive: false });
        b.addEventListener('touchend', e => { e.preventDefault(); set(false); }, { passive: false });
        b.addEventListener('touchcancel', () => set(false));
    }
    for (const b of root.querySelectorAll('[data-tap]')) {
        b.addEventListener('touchstart', e => { e.preventDefault(); tap(b.dataset.tap, b); }, { passive: false });
        b.addEventListener('click', () => tap(b.dataset.tap, b)); // mouse / accessibility
    }
    // Losing the page (call, app switch) must not leave the gun firing
    document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseStick(); for (const k in touchAxes) touchAxes[k] = typeof touchAxes[k] === 'boolean' ? false : 0; } });
}

function tap(action, button) {
    if (action === 'pause') { togglePause(); return; }
    if (action === 'fullscreen') { toggleFullscreen(); return; }
    if (action === 'tilt') { toggleTilt(button); return; }
    if (!flying()) return;
    if (action === 'missile') tryFireMissile();
    else if (action === 'flare') tryDeployFlares();
    else if (action === 'bomb') tryDropBomb();
    else if (action === 'napalm') tryDropNapalm();
}

function toggleFullscreen() {
    const doc = document.documentElement;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    doc.requestFullscreen?.({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
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
        button.setAttribute('aria-pressed', 'false'); showNotification('Tilt steering off');
        return;
    }
    if (!('DeviceOrientationEvent' in window) || !window.isSecureContext) {
        showNotification(window.isSecureContext ? 'No motion sensor on this device' : 'Tilt needs https:// — use the joystick');
        return;
    }
    try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function' && await DeviceOrientationEvent.requestPermission() !== 'granted') {
            showNotification('Motion sensor permission denied'); return;
        }
    } catch { showNotification('Motion sensor permission denied'); return; }
    tilt = { neutralPitch: null, neutralRoll: null, pitch: 0, roll: 0 };
    window.addEventListener('deviceorientation', onOrientation);
    button.setAttribute('aria-pressed', 'true');
    showNotification('Tilt steering on — hold the phone as "level" now');
}

/** Once per frame from input.js, before the axes are read: fold the stick and tilt into touchAxes. */
export function updateTouchAxes() {
    if (!enabled) return;
    // Axes follow flight.js: +pitch = nose down, +roll = right. Stick up = nose up, like the ↑ key; tilting the top
    // edge away = nose down, like pushing a flight stick.
    const roll = clamp1(stick.x + (tilt?.roll ?? 0)), pitch = clamp1(stick.y + (tilt?.pitch ?? 0));
    touchAxes.roll = roll;
    touchAxes.pitch = pitch;
    touchAxes.yaw = -roll * YAW_MIX;
}

// Switch on for touch-first devices, or at the first touch on anything else (e.g. a touch-screen laptop)
if (matchMedia('(pointer: coarse)').matches) enable();
else window.addEventListener('touchstart', enable, { once: true, passive: true });
