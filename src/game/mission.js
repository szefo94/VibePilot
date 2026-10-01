/**
 * The one objective panel. With a Freaky mode quest running (game/quests.js, the host's in multiplayer) it shows the
 * quest: act and arc, step and title, the objective with its progress bar, distance and bearing to its beacon — and
 * the bases still to conquer underneath. Otherwise:
 * Mission loop (review §5.1). The current objective is the nearest base that isn't eliminated yet; the HUD shows its
 * name, remaining units, distance and bearing plus overall progress, the minimap rings it, and eliminating every
 * base completes the mission — a victory end state with its own debrief.
 */
import { state } from '../state.js';
import { baseMarkers } from '../entities/registry.js';
import { plane } from '../player/plane.js';
import { triggerGameOver } from './gameOver.js';
import { RULES } from './rules.js';
import { questStatus } from './quests.js';

const panel = document.getElementById('objective');
const arrowEl = document.getElementById('objective-arrow');
const nameEl = document.getElementById('objective-name');
const unitsEl = document.getElementById('objective-units');
const distanceEl = document.getElementById('objective-distance');
const progressEl = document.getElementById('objective-progress');
const labelEl = document.getElementById('objective-label'), kickerEl = document.getElementById('objective-kicker');
const barEl = document.querySelector('#objective-bar div'), progressLabelEl = document.getElementById('objective-progress-label');
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
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
    if (state.isGameOver) return; // the run has ended
    const bases = RULES.mission && baseMarkers.length > 0; // a mission in this mode, once the world is populated
    if (bases) {
        if (!current || current.eliminated) current = nearestRemainingBase(); // objectives stay put until eliminated
        if (!current) { panel.hidden = true; triggerGameOver({ victory: true }); return; }
    }
    uiTimer -= rawDelta;
    if (uiTimer > 0) return;
    uiTimer = 0.1;
    const q = questStatus();
    panel.hidden = !q && !bases;
    panel.classList.toggle('quest', !!q);
    if (panel.hidden) return;
    const { conquered, total } = missionProgress();
    const at = q ? q.focus : current.position;
    if (q) {
        kickerEl.textContent = `☣ Act ${ROMAN[q.act] ?? q.act} · ${q.arc} · ${q.step + 1}/${q.steps}`;
        labelEl.textContent = 'Quest';
        nameEl.textContent = q.title;
        unitsEl.textContent = q.objective;
        barEl.style.width = `${Math.round((q.done / Math.max(1, q.need)) * 100)}%`;
    } else {
        labelEl.textContent = 'Objective';
        nameEl.textContent = current.name;
        unitsEl.textContent = `${current.alive}/${current.total} units`;
    }
    distanceEl.textContent = at ? fmtDistance(Math.hypot(at.x - plane.position.x, at.z - plane.position.z)) : '—';
    arrowEl.style.visibility = at ? 'visible' : 'hidden';
    if (at) arrowEl.style.transform = `rotate(${relativeBearing(at.x, at.z)}rad)`;
    progressLabelEl.parentElement.hidden = !bases;
    progressLabelEl.textContent = 'Bases conquered';
    progressEl.textContent = `${conquered}/${total}`;
}
const fmtDistance = d => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`);
