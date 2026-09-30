/**
 * Game rules: which systems a session runs. The defaults are the single-player game. Another mode (e.g. the
 * multiplayer branch) changes them with setRules() at import time, before the world is populated.
 */
export const RULES = {
    enemies: true,      // bases, fleets, squadrons, legacy fighters (world/populate.js)
    interceptors: true, // timed interceptor waves (main.js) and the I key
    ace: true,          // ace rivals: Ace Hunt and the H key (entities/rival.js)
    mission: true,      // objective panel and "Mission complete" (game/mission.js)
    respawn: false,     // false: being shot down ends the run; true: game/respawn.js takes over
};
export function setRules(patch) { Object.assign(RULES, patch); }
