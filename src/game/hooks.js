/**
 * Named extension points, so optional systems plug in without editing the core loop.
 *   frame       (rawDelta)   every rendered frame, after the scene is drawn (main.js)
 *   playerDown  ()           the player was shot down or crashed while RULES.respawn is on (game/respawn.js)
 *   radarBlips  (blips)      push extra minimap blips at each radar sweep (ui/minimap.js)
 *   notification (text, highlight)  a gameplay notification was shown (ui/notifications.js; device-only ones are not)
 *   worldReady  ()           the world is populated: every unit exists (main.js)
 *   unitHit     (target, amount, weapon)  the player's weapon damaged a unit (combat/hits.js; not for remote-applied hits)
 *   rivalDown   (ace)        an ace left the sky: shot down or crashed (entities/rival.js)
 *   playerFired (weapon, detail)  the player fired: 'gun' | 'missile' | 'bomb' | 'napalm' | 'flare' (combat/weapons.js);
 *                            detail holds live/scratch vectors — read them immediately, don't keep them
 */
const lists = new Map();
export function onHook(name, fn) { if (!lists.has(name)) lists.set(name, []); lists.get(name).push(fn); }
export function runHooks(name, ...args) { const fns = lists.get(name); if (fns) for (const fn of fns) fn(...args); }
