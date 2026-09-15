/** Score, XP, levelling, healing and kill-streak multiplier. */
import { state } from '../state.js';
import { hpElement, levelElement, xpElement, xpToNextLevelElement } from '../ui/dom.js';
import { showLevelUpBanner, showNotification } from '../ui/notifications.js';
import { updateDamageUI } from '../ui/hud.js';

// G20: kill-streak score multiplier
const _killTimes = [];
export const _multiEl = (() => { const el = document.createElement('div'); el.style.cssText = 'display:none;position:fixed;top:52%;left:50%;transform:translate(-50%,-50%);color:#ffdd00;font:bold 22px monospace;text-align:center;text-shadow:0 0 8px #ff8800,0 0 16px #ff8800;pointer-events:none;z-index:200;letter-spacing:3px;'; document.body.appendChild(el); return el; })();

export function addXP(a) {
    if (state.isGameOver) return;
    state.xp += a;
    while (state.xp >= state.xpToNextLevel) {
        state.level++; state.xp -= state.xpToNextLevel; state.xpToNextLevel = Math.floor(state.xpToNextLevel * 1.5);
        state.playerDamageMultiplier += Math.max(0, .25 - .01 * Math.max(0, state.level - 20)); // §4.3: gain shrinks by 0.01 per level above 20
        state.gunMaxAmmo += 5;
        if (state.level % 5  === 0) state.bombMaxAmmo++;
        if (state.level % 10 === 0) { state.missileMaxAmmo++; state.flareMaxAmmo++; state.napalmMaxAmmo++; }
        levelElement.textContent = state.level; updateDamageUI();
        showLevelUpBanner(state.level); // G18
    }
    xpElement.textContent = state.xp; xpToNextLevelElement.textContent = state.xpToNextLevel;
}
// G6: heal on collection group/pipe completion
export function _healPlayer(amount) {
    if (state.isGameOver) return;
    const prev = state.planeHP;
    state.planeHP = Math.min(100, state.planeHP + amount);
    if (state.planeHP > prev) { hpElement.textContent = Math.max(0, state.planeHP); showNotification(`+${state.planeHP - prev} HP`); }
}
// G20: record a kill, return current streak multiplier
export function _addKill() {
    const now = Date.now();
    _killTimes.push(now);
    while (_killTimes.length > 0 && now - _killTimes[0] > 5000) _killTimes.shift();
    const streak = _killTimes.length;
    state._scoreMulti = streak >= 4 ? 4 : streak >= 3 ? 3 : streak >= 2 ? 2 : 1;
    if (state._scoreMulti > 1) {
        state._multiDisplayTimer = 150;
        _multiEl.style.display = 'block';
        _multiEl.textContent = `×${state._scoreMulti}  STREAK`;
    }
    return state._scoreMulti;
}
