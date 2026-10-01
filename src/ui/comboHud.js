/**
 * Combo meter (Luftrausers-style risk and reward): every kill within COMBO_WINDOW of the previous one raises the
 * score multiplier (×2 … ×5); the bar drains in real time, so keeping the combo alive means staying aggressive.
 * Gun kills up close (game/progression.js CLOSE_KILL_RANGE) flash "CLOSE KILL ×1.5".
 */
import { comboState } from '../game/progression.js';
import { state } from '../state.js';

const el = document.createElement('div');
el.id = 'combo-meter'; el.setAttribute('aria-live', 'polite'); el.hidden = true;
el.innerHTML = '<div class="cm-multi"></div><div class="cm-bar"><div></div></div><div class="cm-close">CLOSE KILL ×1.5</div>';
document.body.appendChild(el);
const multiEl = el.querySelector('.cm-multi'), fill = el.querySelector('.cm-bar div'), closeEl = el.querySelector('.cm-close');
let shownMulti = 0, closeShown = -Infinity;

/** Once per rendered frame. */
export function updateComboHud() {
    const c = comboState(), comboOn = c.multi > 1 && c.left > 0;
    const visible = (comboOn || performance.now() - c.closeAt < 1600) && !state.isGameOver; // a close kill shows even without a combo
    if (el.hidden === visible) el.hidden = !visible;
    if (c.closeAt !== closeShown) { closeShown = c.closeAt; closeEl.classList.remove('flash'); void closeEl.offsetWidth; closeEl.classList.add('flash'); }
    el.classList.toggle('solo', !comboOn); // just the close-kill flash
    if (!visible || !comboOn) { shownMulti = 0; return; }
    if (c.multi !== shownMulti) {
        shownMulti = c.multi;
        multiEl.textContent = `×${c.multi} COMBO`;
        el.dataset.level = String(Math.min(c.multi, 5));
        el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); // restart the pop animation
    }
    fill.style.width = `${(c.left * 100).toFixed(1)}%`;
}
