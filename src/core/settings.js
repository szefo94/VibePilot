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
    freakyMode: false,        // random giant boss events (entities/bosses.js)
    timeOfDay: 'day',         // key of TIME_OF_DAY (config.js); world/sky.js
    touchWheels: 'pitch,yaw,throttle,roll', // phone wheels (ui/touch.js): left ↕, left ↔, right ↕, right ↔
});
const ENUMS = { difficulty: DIFFICULTY_PRESETS, timeOfDay: TIME_OF_DAY };
/** Difficulty also sets how the aces fly and fight (config.js RIVAL_SKILL). */
const ACE_TIER = Object.freeze({ easy: 'easy', normal: 'medium', hard: 'hard' });
/** Other constrained settings: each of the four flight axes on exactly one wheel direction. */
const VALID = { touchWheels: v => v.split(',').sort().join() === 'pitch,roll,throttle,yaw' };

function load() {
    let saved;
    try { saved = JSON.parse(storageGet(KEY) || '{}') || {}; } catch { saved = {}; }
    const loaded = { ...DEFAULTS };
    for (const [key, def] of Object.entries(DEFAULTS)) if (typeof saved[key] === typeof def) loaded[key] = saved[key];
    if (saved.muted === undefined && storageGet('vibepilot_muted') === '1') loaded.muted = true; // pre-settings mute key
    loaded.volume = Math.min(1, Math.max(0, loaded.volume));
    for (const [key, table] of Object.entries(ENUMS)) if (!Object.hasOwn(table, loaded[key])) loaded[key] = DEFAULTS[key];
    for (const [key, ok] of Object.entries(VALID)) if (!ok(loaded[key])) loaded[key] = DEFAULTS[key];
    return loaded;
}

export const settings = load();
const listeners = [];

export function onSettingChange(fn) { listeners.push(fn); }

/** Multipliers for the selected difficulty, read at the moment they apply (changes take effect immediately). */
export const difficulty = () => DIFFICULTY_PRESETS[settings.difficulty];
/** The ace AI tier for the selected difficulty (config.js RIVAL_SKILL), also read live. */
export const rivalSkill = () => RIVAL_SKILL[ACE_TIER[settings.difficulty]];

/** Validate, store and broadcast one setting. */
export function setSetting(key, value) {
    if (!(key in DEFAULTS) || typeof value !== typeof DEFAULTS[key]) return;
    if (key in ENUMS && !Object.hasOwn(ENUMS[key], value)) return;
    if (key in VALID && !VALID[key](value)) return;
    settings[key] = key === 'volume' ? Math.min(1, Math.max(0, value)) : value;
    storageSet(KEY, JSON.stringify(settings));
    for (const fn of listeners) fn(key, settings[key]);
}
