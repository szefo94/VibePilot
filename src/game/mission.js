/**
 * Mission loop (review §5.1). The current objective is the nearest base that isn't eliminated yet; the HUD shows its
 * name, remaining units, distance and bearing plus overall progress, the minimap rings it, and eliminating every
 * base completes the mission — a victory end state with its own debrief.
 */
import { state } from '../state.js';
import { baseMarkers } from '../entities/registry.js';
import { plane } from '../player/plane.js';
import { triggerGameOver } from './gameOver.js';

const panel = document.getElementById('objective');
const arrowEl = document.getElementById('objective-arrow');
const nameEl = document.getElementById('objective-name');
const unitsEl = document.getElementById('objective-units');
const distanceEl = document.getElementById('objective-distance');
const progressEl = document.getElementById('objective-progress');
const _forward = new THREE.Vector3();
let current = null, uiTimer = 0;

export const currentObjective = () => current;

export function missionProgress() {
    return { conquered: baseMarkers.filter(bm => bm.eliminated).length, total: baseMarkers.length };
}

function nearestRemainingBase() {
    let best = null, bestSq = Infinity;
    for (const bm of baseMarkers) {
        if (bm.eliminated) continue;
        const d = bm.position.distanceToSquared(plane.position);
        if (d < bestSq) { bestSq = d; best = bm; }
    }
    return best;
}

/** Bearing of (x, z) relative to the plane's heading, in radians: 0 ahead, positive = to the right on screen. */
export function relativeBearing(x, z) {
    plane.getWorldDirection(_forward);
    // The chase camera looks along the plane's +Z, so world +X appears on the left of the screen
    let angle = Math.atan2(_forward.x, _forward.z) - Math.atan2(x - plane.position.x, z - plane.position.z);
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
}

export function updateMission(rawDelta) {
    if (!baseMarkers.length || state.isGameOver) return; // world not populated yet, or the run has ended
    if (!current || current.eliminated) current = nearestRemainingBase(); // objectives stay put until eliminated
    if (!current) { panel.hidden = true; triggerGameOver({ victory: true }); return; }
    uiTimer -= rawDelta;
    if (uiTimer > 0) return;
    uiTimer = 0.1;
    const { conquered, total } = missionProgress();
    panel.hidden = false;
    nameEl.textContent = current.name;
    unitsEl.textContent = `${current.alive}/${current.total} units`;
    distanceEl.textContent = `${Math.round(Math.hypot(current.position.x - plane.position.x, current.position.z - plane.position.z))} m`;
    arrowEl.style.transform = `rotate(${relativeBearing(current.position.x, current.position.z)}rad)`;
    progressEl.textContent = `${conquered}/${total}`;
}
