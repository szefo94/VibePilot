/**
 * Freaky mode quest HUD (game/quests.js, through the 'questEvent' hook):
 *   comms     a radio briefing when a quest starts: speaker, role, and the line typed out
 *   tracker   top left: the arc and act, the quest and its step, the objective with progress, distance and bearing
 *             to the beacon
 *   banners   "QUEST COMPLETE +XP", "ARC COMPLETE", "IT'S BACK"
 */
import { onHook } from '../game/hooks.js';
import { questStatus } from '../game/quests.js';
import { plane } from '../player/plane.js';
import { state } from '../state.js';
import { _playCollectCyan, _playKillConfirm } from '../audio.js';

const tracker = document.createElement('div');
tracker.id = 'quest-tracker'; tracker.hidden = true; tracker.setAttribute('role', 'status');
tracker.innerHTML = '<div class="qt-arc"></div><div class="qt-title"></div><div class="qt-goal"><span class="qt-text"></span><span class="qt-dist"><span class="qt-arrow">▲</span><span class="qt-km"></span></span></div><div class="qt-bar"><div></div></div>';
document.body.appendChild(tracker);
const comms = document.createElement('div');
comms.id = 'quest-comms'; comms.hidden = true; comms.setAttribute('role', 'log');
comms.innerHTML = '<div class="qc-who"><span class="qc-dot"></span><span class="qc-name"></span><span class="qc-role"></span></div><div class="qc-text"></div>';
document.body.appendChild(comms);
const banner = document.createElement('div');
banner.id = 'quest-banner'; banner.hidden = true;
document.body.appendChild(banner);

const $ = (root, s) => root.querySelector(s);
let typed = '', typeAt = 0, commsTimer = 0, bannerTimer = 0;
const _f = new THREE.Vector3();
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

function say(speaker, text) {
    comms.style.setProperty('--speaker', speaker.color);
    $(comms, '.qc-name').textContent = speaker.name; $(comms, '.qc-role').textContent = speaker.role;
    typed = text; typeAt = 0; $(comms, '.qc-text').textContent = '';
    comms.hidden = false; commsTimer = 4 + text.length / 28;
    _playCollectCyan();
}
function shout(html, kind, seconds = 3.5) {
    banner.className = kind; banner.innerHTML = html; banner.hidden = false; bannerTimer = seconds;
    banner.style.animation = 'none'; void banner.offsetWidth; banner.style.animation = '';
}

onHook('questEvent', (event, q) => {
    if (event === 'start') { say(q.speaker, q.text); shout(`<div class="qb-kicker">☣ ${q.arc.toUpperCase()} · ${q.step + 1}/${q.steps}</div><div class="qb-name">${q.title}</div>`, 'start', 3); }
    else if (event === 'complete') { _playKillConfirm(); shout(`<div class="qb-name">✔ QUEST COMPLETE</div><div class="qb-line">${q.title} · +${q.xp} XP</div>`, 'done'); }
    else if (event === 'arcComplete') shout(`<div class="qb-kicker">★ ARC COMPLETE ★</div><div class="qb-name">${q.arc}</div><div class="qb-line">+${q.xp} XP bonus</div>`, 'arc', 5);
    else if (event === 'bossReturn') shout('<div class="qb-name">IT\'S BACK!</div>', 'done', 2.5);
});

/** Once per rendered frame. */
export function updateQuestHud(rawDelta) {
    if (commsTimer > 0) {
        typeAt = Math.min(typed.length, typeAt + rawDelta * 55);
        $(comms, '.qc-text').textContent = typed.slice(0, Math.floor(typeAt));
        if ((commsTimer -= rawDelta) <= 0) comms.hidden = true;
    }
    if (bannerTimer > 0 && (bannerTimer -= rawDelta) <= 0) banner.hidden = true;
    const q = questStatus();
    const visible = !!q && !state.isGameOver;
    if (tracker.hidden === visible) { tracker.hidden = !visible; document.body.classList.toggle('questing', visible); }
    if (!visible) return;
    $(tracker, '.qt-arc').textContent = `☣ ACT ${ROMAN[q.act] ?? q.act} · ${q.arc}`;
    $(tracker, '.qt-title').textContent = `${q.step + 1}/${q.steps} · ${q.title}`;
    $(tracker, '.qt-text').textContent = q.objective;
    $(tracker, '.qt-bar div').style.width = `${Math.round((q.done / Math.max(1, q.need)) * 100)}%`;
    const f = q.focus;
    $(tracker, '.qt-dist').hidden = !f;
    if (f) {
        const dx = f.x - plane.position.x, dz = f.z - plane.position.z;
        _f.set(0, 0, 1).applyQuaternion(plane.quaternion);
        const rel = Math.atan2(dx, dz) - Math.atan2(_f.x, _f.z);
        $(tracker, '.qt-arrow').style.transform = `rotate(${-Math.atan2(Math.sin(rel), Math.cos(rel))}rad)`;
        $(tracker, '.qt-km').textContent = `${(Math.hypot(dx, dz) / 1000).toFixed(1)} km`;
    }
}
