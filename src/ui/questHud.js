/**
 * Freaky mode quest HUD (game/quests.js, through the 'questEvent' hook):
 *   comms     a radio briefing when a quest starts: speaker, role, and the line typed out
 *   (the objective itself — quest, progress, distance and bearing — is in the one objective panel, game/mission.js)
 *   banners   "QUEST COMPLETE +XP", "ARC COMPLETE", "IT'S BACK"
 */
import { onHook } from '../game/hooks.js';
import { questStatus } from '../game/quests.js';
import { _playCollectCyan, _playKillConfirm } from '../audio.js';

const comms = document.createElement('div');
comms.id = 'quest-comms'; comms.hidden = true; comms.setAttribute('role', 'log');
comms.innerHTML = '<div class="qc-who"><span class="qc-dot"></span><span class="qc-name"></span><span class="qc-role"></span></div><div class="qc-text"></div>';
document.body.appendChild(comms);
const banner = document.createElement('div');
banner.id = 'quest-banner'; banner.hidden = true;
document.body.appendChild(banner);

const $ = (root, s) => root.querySelector(s);
let typed = '', typeAt = 0, commsTimer = 0, bannerTimer = 0;
const COMMS_MIN = 9, COMMS_CPS = 14; // the briefing stays up for COMMS_MIN s + its length at COMMS_CPS chars a second

function say(speaker, text) {
    comms.style.setProperty('--speaker', speaker.color);
    $(comms, '.qc-name').textContent = speaker.name; $(comms, '.qc-role').textContent = speaker.role;
    typed = text; typeAt = 0; $(comms, '.qc-text').textContent = '';
    comms.hidden = false; commsTimer = COMMS_MIN + text.length / COMMS_CPS; // long enough to read twice
    _playCollectCyan();
}
function shout(html, kind, seconds = 3.5) {
    banner.className = kind; banner.innerHTML = html; banner.hidden = false; bannerTimer = seconds;
    banner.style.animation = 'none'; void banner.offsetWidth; banner.style.animation = '';
}

onHook('questEvent', (event, q) => {
    if (event === 'start') { say(q.speaker, q.text); shout(`<div class="qb-kicker">☣ ${q.arc.toUpperCase()} · ${q.step + 1}/${q.steps}</div><div class="qb-name">${q.title}</div><div class="qb-line">${q.objective ?? questStatus()?.objective ?? ''}</div>`, 'start', 6); }
    else if (event === 'complete') { _playKillConfirm(); shout(`<div class="qb-name">✔ QUEST COMPLETE</div><div class="qb-line">${q.title} · +${q.xp} XP</div>`, 'done', 5); }
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
}
