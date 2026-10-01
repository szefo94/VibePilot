/** Score, XP, levelling, healing and kill-streak multiplier. */
import { HP_PER_LEVEL } from '../config.js';
import { state } from '../state.js';
import { hpElement, levelElement, scoreElement, xpElement, xpToNextLevelElement } from '../ui/dom.js';
import { showLevelUpBanner, showNotification } from '../ui/notifications.js';
import { updateDamageUI } from '../ui/hud.js';

// Combo: each kill within COMBO_WINDOW of the last raises the score multiplier (ui/comboHud.js shows it draining).
// A gun kill closer than CLOSE_KILL_RANGE is worth CLOSE_BONUS × score and XP (combat/hits.js marks it).
export const COMBO_WINDOW = 5000, MAX_COMBO = 5, CLOSE_KILL_RANGE = 150, CLOSE_BONUS = 1.5;
let combo = 0, lastKillAt = -Infinity, closeNext = false, closeAt = -Infinity;
/** For the HUD: kills in the combo, its multiplier, the share of the window left (1 → 0), and the last close kill's time. */
export function comboState() {
    const left = Math.max(0, 1 - (performance.now() - lastKillAt) / COMBO_WINDOW);
    return { combo: left > 0 ? combo : 0, multi: left > 0 ? Math.min(combo, MAX_COMBO) : 1, left, closeAt };
}
/** combat/hits.js: the next rewarded kill was a gun kill up close (or not). */
export function markCloseKill(close) { closeNext = close; }

export function addXP(a) {
    if (state.isGameOver) return;
    state.xp += a;
    while (state.xp >= state.xpToNextLevel) {
        state.level++; state.xp -= state.xpToNextLevel; state.xpToNextLevel = Math.floor(state.xpToNextLevel * 1.5);
        state.playerDamageMultiplier += Math.max(0, .25 - .01 * Math.max(0, state.level - 20)); // §4.3: gain shrinks by 0.01 per level above 20
        state.gunMaxAmmo += 5;
        state.maxHP += HP_PER_LEVEL; state.planeHP += HP_PER_LEVEL; hpElement.textContent = Math.max(0, state.planeHP); // tougher airframe, and the new HP comes filled
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
    state.planeHP = Math.min(state.maxHP, state.planeHP + amount);
    if (state.planeHP > prev) { hpElement.textContent = Math.max(0, state.planeHP); showNotification(`+${state.planeHP - prev} HP`, false, { local: true }); }
}
/** Record a kill; returns the combo multiplier it earns. */
export function _addKill() {
    const now = performance.now();
    combo = now - lastKillAt <= COMBO_WINDOW ? combo + 1 : 1;
    lastKillAt = now;
    state._scoreMulti = Math.min(combo, MAX_COMBO);
    return state._scoreMulti;
}
/** The single kill reward: score × combo multiplier (× CLOSE_BONUS up close), and XP (× CLOSE_BONUS up close). No reward after game over. */
export function awardKill(xpValue) {
    const close = closeNext;
    closeNext = false;
    if (state.isGameOver) return;
    const bonus = close ? CLOSE_BONUS : 1;
    if (close) closeAt = performance.now();
    state.score += Math.round(xpValue * _addKill() * bonus);
    scoreElement.textContent = state.score;
    addXP(Math.round(xpValue * bonus));
}
