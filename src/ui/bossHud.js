/**
 * Freaky mode HUD (entities/bosses.js events through the 'bossEvent' hook):
 *   alert     a siren and a big "FREAKY EVENT" banner: the boss's name, what it does, how far and which way
 *   vignette  the screen edges pulse in the boss's colour for a few seconds
 *   frame     top centre while it lives: name, title, distance with a bearing arrow, a segmented HP bar whose lost
 *             part trails behind the fill, the 50 % mark where it turns ENRAGED, and its HP
 *   endings   "DEFEATED +XP" or "ESCAPED"
 */
import { onHook } from '../game/hooks.js';
import { bossStatus } from '../entities/bosses.js';
import { plane } from '../player/plane.js';
import { state } from '../state.js';
import { playBossRoar, playSiren } from '../audio.js';

const frame = document.createElement('div');
frame.id = 'boss-frame'; frame.hidden = true; frame.setAttribute('role', 'status');
frame.innerHTML = `
    <div class="bf-head"><span class="bf-skull">☠</span><span class="bf-name"></span><span class="bf-title"></span><span class="bf-dist"><span class="bf-arrow">▲</span><span class="bf-km"></span></span></div>
    <div class="bf-bar"><div class="bf-lag"></div><div class="bf-fill"></div><div class="bf-mark"></div></div>
    <div class="bf-foot"><span class="bf-phase"></span><span class="bf-hp"></span></div>`;
document.body.appendChild(frame);
const alertEl = document.createElement('div');
alertEl.id = 'boss-alert'; alertEl.hidden = true; alertEl.setAttribute('role', 'alert');
document.body.appendChild(alertEl);
const vignette = document.createElement('div');
vignette.id = 'boss-vignette';
document.body.appendChild(vignette);

const $ = s => frame.querySelector(s);
const nameEl = $('.bf-name'), titleEl = $('.bf-title'), kmEl = $('.bf-km'), arrowEl = $('.bf-arrow'), fill = $('.bf-fill'), lag = $('.bf-lag'), phaseEl = $('.bf-phase'), hpEl = $('.bf-hp');
let lagPct = 100, alertTimer = 0, shown = '';
const _f = new THREE.Vector3();

/** Distance in km and the bearing of the boss relative to the plane's heading (radians, clockwise). */
function whereIs(pos) {
    const dx = pos.x - plane.position.x, dz = pos.z - plane.position.z;
    _f.set(0, 0, 1).applyQuaternion(plane.quaternion);
    const rel = Math.atan2(dx, dz) - Math.atan2(_f.x, _f.z);
    return { km: Math.hypot(dx, dz) / 1000, bearing: -Math.atan2(Math.sin(rel), Math.cos(rel)) };
}
const compass = pos => { const a = (Math.atan2(pos.x - plane.position.x, pos.z - plane.position.z) * 180 / Math.PI + 360) % 360; return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(a / 45) % 8]; };

function showAlert(kind, html, color, seconds = 4) {
    alertEl.className = `boss-alert-${kind}`;
    alertEl.style.setProperty('--boss', color);
    alertEl.innerHTML = html;
    alertEl.hidden = false;
    alertEl.style.animation = 'none'; void alertEl.offsetWidth; alertEl.style.animation = '';
    alertTimer = seconds;
}
function pulseVignette(color, seconds = 3) {
    vignette.style.setProperty('--boss', color);
    vignette.classList.remove('on'); void vignette.offsetWidth; vignette.classList.add('on');
    vignette.style.animationDuration = `${seconds / 3}s`;
    setTimeout(() => vignette.classList.remove('on'), seconds * 1000);
}

onHook('bossEvent', (event, au) => {
    const b = au.boss, d = b.def, at = whereIs(au.group.position);
    if (event === 'spawn') {
        playSiren(); setTimeout(playBossRoar, 1400);
        showAlert('spawn', `<div class="ba-kicker">⚠ FREAKY EVENT ⚠</div><div class="ba-name">${d.name}</div><div class="ba-line">${d.verb} · ${at.km.toFixed(1)} km ${compass(au.group.position)}</div>`, d.color, 4.5);
        pulseVignette(d.color, 3.6);
        lagPct = 100;
    } else if (event === 'enrage') {
        playBossRoar();
        showAlert('enrage', `<div class="ba-name">${d.name} IS ENRAGED</div><div class="ba-line">faster attacks · finish it!</div>`, d.color, 2.8);
        pulseVignette(d.color, 1.8);
    } else if (event === 'defeat') {
        showAlert('defeat', `<div class="ba-kicker">★ BOSS DEFEATED ★</div><div class="ba-name">${d.name}</div><div class="ba-line">+${au.xpValue} XP</div>`, '#ffdd33', 4.5);
    } else if (event === 'leaving') {
        showAlert('escape', `<div class="ba-name">${d.name} IS LEAVING</div><div class="ba-line">last chance</div>`, d.color, 2.5);
    } else if (event === 'escape') {
        showAlert('escape', `<div class="ba-name">${d.name} ESCAPED</div>`, '#aaaaaa', 2.5);
    }
});

/** Once per rendered frame. */
export function updateBossHud(rawDelta) {
    if (alertTimer > 0 && (alertTimer -= rawDelta) <= 0) alertEl.hidden = true;
    const s = bossStatus();
    const visible = !!s && s.phase !== 'leave' && !state.isGameOver;
    if (frame.hidden === visible) frame.hidden = !visible;
    if (!visible) return;
    if (shown !== s.name) { shown = s.name; nameEl.textContent = s.name; titleEl.textContent = s.title; frame.style.setProperty('--boss', s.color); }
    const pct = Math.max(0, (s.hp / s.maxHp) * 100);
    lagPct = Math.max(pct, lagPct - rawDelta * 18); // the lost HP drains behind the fill
    fill.style.width = `${pct}%`; lag.style.width = `${lagPct}%`;
    frame.classList.toggle('enraged', s.enraged);
    phaseEl.textContent = s.phase === 'emerge' ? 'EMERGING' : s.enraged ? 'ENRAGED' : '';
    hpEl.textContent = `${Math.ceil(s.hp)} / ${s.maxHp}`;
    const w = whereIs(s.position);
    kmEl.textContent = `${w.km.toFixed(1)} km`;
    arrowEl.style.transform = `rotate(${w.bearing}rad)`;
}
