/** Transient notifications, banners and the conquered-bases ticker. */
import { NOTIF_DURATION_MS, NOTIF_MAX_SLOTS, NOTIF_SLOT_HEIGHT } from '../config.js';
import { state } from '../state.js';
import { scoreElement } from './dom.js';
import { basesById } from '../entities/registry.js';
import { addXP } from '../game/progression.js';
import { _searchlights, _updateFenceDamageState } from '../entities/fences.js';

let notifSlot = 0;

// G18: level-up banner
export function showLevelUpBanner(lvl) {
    if (state.isGameOver) return;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:38%;left:50%;transform:translate(-50%,-50%) scale(0.6);background:linear-gradient(90deg,#ff6600,#ffdd00,#ff6600);color:#000;font:bold 26px "Orbitron",monospace;padding:12px 36px;border-radius:5px;letter-spacing:3px;pointer-events:none;z-index:300;opacity:0;transition:opacity 0.25s,transform 0.25s;white-space:nowrap;box-shadow:0 0 30px #ff8800;';
    el.textContent = `▲  LEVEL UP  —  LVL ${lvl}  ▲`;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translate(-50%,-50%) scale(1)'; }));
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translate(-50%,-50%) scale(0.8)'; setTimeout(() => el.remove(), 350); }, 1700);
}

export function showNotification(text, isEliminated = false) {
    if (state.isGameOver) return;
    const el = document.createElement('div');
    el.className = 'kill-notif' + (isEliminated ? ' eliminated' : '');
    el.textContent = text;
    el.style.bottom = (70 + (notifSlot % NOTIF_MAX_SLOTS) * NOTIF_SLOT_HEIGHT) + 'px';
    notifSlot++;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('slide')));
    setTimeout(() => el.remove(), NOTIF_DURATION_MS);
}
function showCongratsBanner(bmName) {
    if (state.isGameOver) return;
    const el = document.createElement('div');
    el.className = 'congrats-banner';
    el.textContent = `★  ${bmName}  Conquered  ★`;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
    setTimeout(() => { el.classList.remove('visible'); el.classList.add('fade-out'); setTimeout(() => el.remove(), 750); }, 3200);
}
export function addToConqueredRow(text, scrollId) {
    const scroll = document.getElementById(scrollId);
    const wrap = scroll && scroll.parentElement; // cpanel-scroll-wrap
    if (!scroll || !wrap) return;
    const entry = document.createElement('span'); entry.className = 'conquered-entry'; entry.textContent = text; scroll.appendChild(entry);
    wrap.closest('.cpanel-row').classList.add('has-content');
    requestAnimationFrame(() => {
        const overflow = scroll.scrollWidth - wrap.clientWidth;
        if (overflow > 0) {
            const duration = Math.max(4, scroll.scrollWidth / 50);
            scroll.style.animation = 'none';
            scroll.style.setProperty('--ticker-dist', `-${overflow}px`);
            requestAnimationFrame(() => { scroll.style.animation = `conquered-ticker ${duration}s ease-in-out infinite alternate`; });
        } else { scroll.style.animation = 'none'; }
    });
}
function addToConqueredPanel(bmName) { addToConqueredRow(`✓ ${bmName}`, 'row1-scroll'); }
export function notifyBase(baseId) { // (§2.2) unified signature — pass baseId string directly
    if (!baseId) return;
    const bm = basesById[baseId];
    if (!bm || bm.eliminated) return;
    bm.alive = bm.units.filter(x => x.userData.hp > 0).length;
    _updateFenceDamageState(bm.id); // F10
    if (bm.alive === 0) {
        showNotification(`◆ ${bm.name} ELIMINATED  +${bm.bonusXp} XP`, true);
        showCongratsBanner(bm.name);
        if (!state.isGameOver) { addXP(bm.bonusXp); state.score += Math.floor(bm.bonusXp / 2); scoreElement.textContent = state.score; }
        bm.eliminated = true; addToConqueredPanel(bm.name);
        // Silence any searchlights owned by this base (intensity=0, not scene.remove — avoids shader recompile)
        if (bm._spotLight) { bm._spotLight.intensity = 0; }
        for (let _si = _searchlights.length - 1; _si >= 0; _si--) {
            if (_searchlights[_si].baseIds && _searchlights[_si].baseIds.includes(bm.id)) _searchlights.splice(_si, 1);
        }
    } else {
        showNotification(`▶ ${bm.name}  ${bm.alive}/${bm.total}`);
    }
}
