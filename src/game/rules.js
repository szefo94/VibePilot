/**
 * Game rules: which systems a session runs. The defaults are the single-player game. Another mode (e.g. the
 * multiplayer branch) changes them with setRules() at import time, before the world is populated.
 */
export const RULES = {
    enemies: true,      // bases, fleets, squadrons (world/populate.js)
    roamingFighters: true, // the legacy fighters that wander the map and respawn at random places
    interceptors: true, // timed interceptor waves (main.js) and the I key
    ace: true,          // ace rivals: Ace Hunt and the H key (entities/rival.js)
    bosses: true,       // Freaky mode bosses and the K key (entities/bosses.js)
    mission: true,      // objective panel and "Mission complete" (game/mission.js)
    respawn: false,     // false: being shot down ends the run; true: game/respawn.js takes over
};
export function setRules(patch) { Object.assign(RULES, patch); }
