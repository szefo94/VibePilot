/**
 * Named extension points, so optional systems plug in without editing the core loop.
 *   frame       (rawDelta)   every rendered frame, after the scene is drawn (main.js)
 *   playerDown  ()           the player was shot down or crashed while RULES.respawn is on (game/respawn.js)
 *   radarBlips  (blips)      push extra minimap blips at each radar sweep (ui/minimap.js)
 */
const lists = new Map();
export function onHook(name, fn) { if (!lists.has(name)) lists.set(name, []); lists.get(name).push(fn); }
export function runHooks(name, ...args) { const fns = lists.get(name); if (fns) for (const fn of fns) fn(...args); }
