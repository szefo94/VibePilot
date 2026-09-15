/** Player settings, persisted through the safe storage wrapper. */
import { MOUSE_STEERING } from '../config.js';
import { storageGet, storageSet } from './storage.js';

const KEY = 'vibepilot_settings';
const DEFAULTS = Object.freeze({
    volume: 0.9,              // master volume 0..1
    muted: false,             // V key
    mouseSteering: MOUSE_STEERING,
    invertPitch: false,       // keyboard, gamepad and mouse pitch
    showReferencePanels: true, // controls / debug / coordinates panels
});

function load() {
    let saved;
    try { saved = JSON.parse(storageGet(KEY) || '{}') || {}; } catch { saved = {}; }
    const loaded = { ...DEFAULTS };
    for (const [key, def] of Object.entries(DEFAULTS)) if (typeof saved[key] === typeof def) loaded[key] = saved[key];
    if (saved.muted === undefined && storageGet('vibepilot_muted') === '1') loaded.muted = true; // pre-settings mute key
    loaded.volume = Math.min(1, Math.max(0, loaded.volume));
    return loaded;
}

export const settings = load();
const listeners = [];

export function onSettingChange(fn) { listeners.push(fn); }

/** Validate, store and broadcast one setting. */
export function setSetting(key, value) {
    if (!(key in DEFAULTS) || typeof value !== typeof DEFAULTS[key]) return;
    settings[key] = key === 'volume' ? Math.min(1, Math.max(0, value)) : value;
    storageSet(KEY, JSON.stringify(settings));
    for (const fn of listeners) fn(key, settings[key]);
}
