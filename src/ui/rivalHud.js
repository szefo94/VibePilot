/**
 * Ace rival panel (top right, under Targets): the ace's callsign, level and AI tier, an HP bar, bearing arrow,
 * distance and what it is doing — or, between aces in Ace Hunt, a countdown to the next launch.
 */
import { state } from '../state.js';
import { plane } from '../player/plane.js';
import { relativeBearing } from '../game/mission.js';
import { rivalStatus } from '../entities/rival.js';

const panel = document.getElementById('rival-panel');
const nameEl = document.getElementById('rival-name');
const tierEl = document.getElementById('rival-tier');
const hpTrack = document.getElementById('rival-hp-track');
const hpBar = document.getElementById('rival-hp-bar');
const arrowEl = document.getElementById('rival-arrow');
const infoEl = document.getElementById('rival-info');
const MODE_TEXT = { hunt: 'Hunting you', engage: 'Engaged', evade: 'Evading' };
let uiTimer = 0;

export function updateRivalHud(rawDelta) {
    if (state.isGameOver) { panel.hidden = true; return; }
    uiTimer -= rawDelta;
    if (uiTimer > 0) return;
    uiTimer = 0.1;
    const { hunt, active, nextIn, downed, tier } = rivalStatus();
    panel.hidden = !active && !hunt;
    if (panel.hidden) return;
    tierEl.textContent = tier.label;
    panel.classList.toggle('engaged', !!active && active.ai.mode !== 'hunt');
    hpTrack.hidden = arrowEl.hidden = !active;
    if (active) {
        const p = active.group.position;
        nameEl.textContent = `Ace ${active.callsign} · Lv ${active.label.level}`;
        hpBar.style.width = `${Math.max(0, active.hp / active.maxHp) * 100}%`;
        arrowEl.style.transform = `rotate(${relativeBearing(p.x, p.z)}rad)`;
        infoEl.textContent = `${Math.round(p.distanceTo(plane.position))} m · ${MODE_TEXT[active.ai.mode]}`;
    } else {
        nameEl.textContent = 'Ace Hunt';
        infoEl.textContent = `Next ace in ${Math.ceil(nextIn)} s${downed ? ` · downed ${downed}` : ''}`;
    }
}
