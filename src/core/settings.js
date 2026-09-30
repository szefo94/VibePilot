/** Player settings, persisted through the safe storage wrapper. */
import { DIFFICULTY_PRESETS, MOUSE_STEERING, RIVAL_SKILL, TIME_OF_DAY } from '../config.js';
import { storageGet, storageSet } from './storage.js';

const KEY = 'vibepilot_settings';
const DEFAULTS = Object.freeze({
    volume: 0.9,              // master volume 0..1
    muted: false,             // V key
    mouseSteering: MOUSE_STEERING,
    invertPitch: false,       // keyboard, gamepad and mouse pitch
    showReferencePanels: true, // controls / debug / coordinates panels
    difficulty: 'normal',     // key of DIFFICULTY_PRESETS (config.js)
    aceHunt: true,            // Shift+H — hostile aces hunt the player (entities/rival.js)
    rivalSkill: 'medium',     // key of RIVAL_SKILL (config.js)
    timeOfDay: 'day',         // key of TIME_OF_DAY (config.js); world/sky.js
});
const ENUMS = { difficulty: DIFFICULTY_PRESETS, rivalSkill: RIVAL_SKILL, timeOfDay: TIME_OF_DAY };

function load() {
    let saved;
    try { saved = JSON.parse(storageGet(KEY) || '{}') || {}; } catch { saved = {}; }
    const loaded = { ...DEFAULTS };
    for (const [key, def] of Object.entries(DEFAULTS)) if (typeof saved[key] === typeof def) loaded[key] = saved[key];
    if (saved.muted === undefined && storageGet('vibepilot_muted') === '1') loaded.muted = true; // pre-settings mute key
    loaded.volume = Math.min(1, Math.max(0, loaded.volume));
    for (const [key, table] of Object.entries(ENUMS)) if (!Object.hasOwn(table, loaded[key])) loaded[key] = DEFAULTS[key];
    return loaded;
}

export const settings = load();
const listeners = [];

export function onSettingChange(fn) { listeners.push(fn); }

/** Multipliers for the selected difficulty, read at the moment they apply (changes take effect immediately). */
export const difficulty = () => DIFFICULTY_PRESETS[settings.difficulty];
/** The selected ace AI tier (config.js RIVAL_SKILL), also read live. */
export const rivalSkill = () => RIVAL_SKILL[settings.rivalSkill];

/** Validate, store and broadcast one setting. */
export function setSetting(key, value) {
    if (!(key in DEFAULTS) || typeof value !== typeof DEFAULTS[key]) return;
    if (key in ENUMS && !Object.hasOwn(ENUMS[key], value)) return;
    settings[key] = key === 'volume' ? Math.min(1, Math.max(0, value)) : value;
    storageSet(KEY, JSON.stringify(settings));
    for (const fn of listeners) fn(key, settings[key]);
}
