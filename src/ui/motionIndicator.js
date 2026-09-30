/**
 * Motion indicator (desktop and phones): the plane's actual rotation rates and speed at a glance.
 *   ball   pitch and roll rate (ball up = nose coming up, right = rolling right), full deflection at the max rate
 *   bar    yaw rate
 *   gauge  airspeed
 * Phones place it between the thumbs (style.css, body.touch); on desktop it sits left of the ammo panel.
 */
import { maxPitchRate, maxRollRate, maxSpeed, maxYawRate } from '../config.js';
import { state } from '../state.js';

const el = document.createElement('div');
el.id = 'motion-indicator'; el.setAttribute('aria-hidden', 'true');
el.innerHTML = '<div class="mi-ring"><div class="mi-cross"></div><div class="mi-ball"></div><div class="mi-yaw"><div></div></div></div><div class="mi-thr"><div></div></div>';
document.body.appendChild(el);
const ball = el.querySelector('.mi-ball'), yaw = el.querySelector('.mi-yaw div'), thr = el.querySelector('.mi-thr div');
const R = 22; // px of travel
let last = '';

/** Per rendered frame. */
export function updateMotionIndicator() {
    const c = v => Math.max(-1, Math.min(1, v));
    // +pitchRate = nose down (flight.js), so the ball moves down; +rollRate = right; +yawRate = left
    const bx = Math.round(c(state.rollRate / maxRollRate) * R), by = Math.round(c(state.pitchRate / maxPitchRate) * R), yx = Math.round(c(-state.yawRate / maxYawRate) * R);
    const tp = Math.round(Math.min(1, state.speed / maxSpeed) * 100);
    const key = `${bx}|${by}|${yx}|${tp}`;
    if (key === last) return; // only touch the DOM when something changed
    last = key;
    ball.style.transform = `translate(${bx}px, ${by}px)`;
    yaw.style.transform = `translateX(${yx}px)`;
    thr.style.height = `${tp}%`;
}
