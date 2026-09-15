/**
 * Session flow: ready (start menu) → playing ⇄ paused → game over → restart.
 *
 * Menus are real <button>/<input> elements in index.html, so mouse, keyboard (Tab, Enter/Space, Esc) and
 * gamepad (D-pad to move, A to select, B to close settings, Start) all work. Restart reloads the page with
 * ?autostart (world init takes ~30 ms); "Replay this map" also keeps the current ?seed.
 */
import { state } from '../state.js';
import { DEBUG_PARAMS } from '../debug/params.js';
import { onSettingChange, setSetting, settings } from '../core/settings.js';
import { _steerCursorEl, gameOverElement, pausedElement } from '../ui/dom.js';
import { _deathGraphEl } from '../ui/debrief.js';

const startMenu = document.getElementById('start-menu');
const settingsDialog = document.getElementById('settings-dialog');
const releaseHandlers = [];
let settingsReturnFocus = null;

/** input.js registers a callback that drops held keys/buttons when a menu takes over. */
export function onInputRelease(fn) { releaseHandlers.push(fn); }

export function sessionPhase() {
    return state.isGameOver ? 'game over' : state.awaitingStart ? 'ready' : state.isPaused ? 'paused' : 'playing';
}

function activeMenu() {
    if (!settingsDialog.hidden) return settingsDialog;
    if (state.awaitingStart) return startMenu;
    if (state.isPaused) return pausedElement;
    if (state.isGameOver) return _deathGraphEl.style.display === 'block' ? _deathGraphEl : gameOverElement;
    return null;
}
export const menuOpen = () => !!activeMenu();
export const settingsOpen = () => !settingsDialog.hidden;

function focusables(container) {
    return [...container.querySelectorAll('button, input, select')].filter(el => el.offsetParent !== null && !el.disabled);
}
function focusFirst(container) { if (container) focusables(container)[0]?.focus(); }

function refresh() {
    const playing = sessionPhase() === 'playing' && settingsDialog.hidden;
    _steerCursorEl.style.display = playing && settings.mouseSteering ? 'block' : 'none';
    document.body.classList.toggle('menu-open', !playing);
    if (!playing) releaseHandlers.forEach(fn => fn());
}

export function startGame() {
    if (!state.awaitingStart) return;
    state.awaitingStart = false;
    startMenu.hidden = true;
    closeSettings();
    document.activeElement?.blur?.();
    refresh();
}

export function setPaused(paused) {
    if (state.awaitingStart || state.isGameOver || state.isPaused === paused) return;
    state.isPaused = paused;
    pausedElement.style.display = paused ? 'block' : 'none';
    if (paused) focusFirst(pausedElement);
    else { closeSettings(); document.activeElement?.blur?.(); }
    refresh();
}
export const togglePause = () => setPaused(!state.isPaused);

/** Called by gameOver.js once the game-over panel is filled in. */
export function onGameOver() {
    refresh();
    focusFirst(gameOverElement);
}

export function restart({ sameMap = false } = {}) {
    const url = new URL(location.href);
    if (sameMap && window.__vpSeed != null) url.searchParams.set('seed', window.__vpSeed);
    else url.searchParams.delete('seed');
    url.searchParams.set('autostart', '');
    location.assign(url.href);
}

// --- Settings dialog ---
function syncSettingsForm() {
    for (const input of settingsDialog.querySelectorAll('[data-setting]')) {
        const key = input.dataset.setting;
        if (input.type === 'checkbox') input.checked = settings[key];
        else input.value = settings[key];
    }
}
export function openSettings() {
    settingsReturnFocus = document.activeElement;
    settingsDialog.hidden = false;
    syncSettingsForm();
    focusFirst(settingsDialog);
    refresh();
}
export function closeSettings() {
    if (settingsDialog.hidden) return;
    settingsDialog.hidden = true;
    settingsReturnFocus?.focus?.();
    refresh();
}
settingsDialog.addEventListener('input', e => {
    const el = e.target.closest('[data-setting]');
    if (el) setSetting(el.dataset.setting, el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : Number(el.value));
});
const applyReferencePanels = () => document.body.classList.toggle('hide-reference', !settings.showReferencePanels);
onSettingChange(key => {
    if (key === 'showReferencePanels') applyReferencePanels();
    if (key === 'mouseSteering') refresh();
    if (!settingsDialog.hidden) syncSettingsForm();
});

// --- Buttons (data-action) and gamepad navigation ---
document.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'start') startGame();
    else if (action === 'resume') setPaused(false);
    else if (action === 'restart') restart();
    else if (action === 'replay') restart({ sameMap: true });
    else if (action === 'settings') openSettings();
    else if (action === 'close-settings') closeSettings();
});
/** Move focus through the open menu's controls (D-pad up/down). */
export function menuNavigate(delta) {
    const menu = activeMenu();
    if (!menu) return;
    const items = focusables(menu);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    items[(i + delta + items.length) % items.length].focus();
}
/** Activate the focused control (gamepad A); focus the first one if nothing in the menu is focused. */
export function menuActivate() {
    const menu = activeMenu(), el = document.activeElement;
    if (menu && el && menu.contains(el) && el !== menu) el.click();
    else focusFirst(menu);
}

// --- Initial state ---
applyReferencePanels();
document.getElementById('start-best').textContent = state._highScore;
if (DEBUG_PARAMS.autostart) {
    state.awaitingStart = false;
    startMenu.hidden = true;
} else {
    startMenu.hidden = false;
    focusFirst(startMenu);
}
refresh();
