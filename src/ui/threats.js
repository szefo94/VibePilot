/**
 * Readable threats (review §5.2): a red arc at the screen edge points toward where damage came from, and a blinking
 * warning calls out the ground, the ceiling, the map boundary and low HP before they end the run.
 */
import { MAP_BOUNDARY, ceilingLevel, groundLevel } from '../config.js';
import { state } from '../state.js';
import { plane } from '../player/plane.js';
import { relativeBearing } from '../game/mission.js';

const container = document.getElementById('hit-indicators');
const warningEl = document.getElementById('flight-warning');
const ARC_VISIBLE_MS = 900;
const arcs = Array.from({ length: 4 }, () => {
    const el = document.createElement('div');
    el.className = 'hit-arc';
    container.appendChild(el);
    return el;
});
let nextArc = 0;

/** Flash an edge arc pointing at `source` (world position the damage came from). */
export function showHitDirection(source) {
    const el = arcs[nextArc++ % arcs.length];
    el.style.setProperty('--bearing', `${relativeBearing(source.x, source.z)}rad`);
    el.style.opacity = '1';
    clearTimeout(el.hideTimer);
    el.hideTimer = setTimeout(() => { el.style.opacity = '0'; }, ARC_VISIBLE_MS);
}

/** Show the most urgent flight warning; call every simulated frame. */
export function updateFlightWarnings() {
    const p = plane.position;
    let text = '';
    if (p.y < groundLevel + 15) text = 'PULL UP';
    else if (p.y > ceilingLevel - 15) text = 'CEILING';
    else if (Math.max(Math.abs(p.x), Math.abs(p.z)) > MAP_BOUNDARY - 200) text = 'BOUNDARY — TURN BACK';
    else if (state.planeHP <= 30) text = 'LOW HP';
    if (warningEl.textContent !== text) warningEl.textContent = text;
    warningEl.hidden = !text;
}
