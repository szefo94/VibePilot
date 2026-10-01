/**
 * Missile warning tone, the Ace Combat way: you learn the flare timing by ear.
 *
 *   1 locking  slow beeps   something is trying to lock on to you
 *   2 locked   fast beeps   locked on, or a missile is on its way
 *   3 missile  solid tone   a missile is close: flares now (Q) or break hard
 *
 * Any system that can threaten the player reports its level under its own name (entities/rival.js for aces,
 * entities/bosses.js for homing boss shots, the multiplayer bots); the loudest wins. Silent in menus and after the run.
 */
import { updateWarningTone } from '../audio.js';
import { state } from '../state.js';

export const THREAT = Object.freeze({ none: 0, locking: 1, locked: 2, missile: 3 });
/** Within this distance an incoming missile sounds the solid tone. */
export const MISSILE_CLOSE = 300;

const levels = new Map(); // source → level

/** A source's current threat level (THREAT.*); report 0 when it no longer threatens. */
export function reportThreat(source, level) { levels.set(source, level); }

/** The level the player hears now. */
export function threatLevel() {
    if (state.isPaused || state.isGameOver || state.awaitingStart || state._playerDown) return 0;
    let level = 0;
    for (const l of levels.values()) level = Math.max(level, l);
    return level;
}

/** Once per rendered frame. */
export function updateThreatTone(rawDelta) { updateWarningTone(threatLevel(), rawDelta); }
