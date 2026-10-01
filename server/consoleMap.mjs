// Live map of a room for the server's terminal (press M; N for the next room). The relief comes from the room's
// first player (MSG.MAP: the same heightfield as the minimap, as characters by height); the server puts on top what
// it knows live: players (their state reports), bots (the host's BOT), the boss (BOSS) and the tdm flag.
//
//   ~ sea   . beach   : - lowland   = + upland   # rock   ^ summit
//   A-Z players (first letter; red/blue by team)   a-z bots   ! ace   @ boss   F flag
//
// Orientation as on the minimap facing north: up is north (+z), left is west (+x).

export const MAP_CHARS = ' ~.:-=+#^';
export const MAP_GRID = Object.freeze({ maxW: 120, maxH: 60 });

const ansi = (code, text) => `\x1b[${code}m${text}\x1b[0m`;
const RELIEF_COLOUR = { '~': '34', '.': '33', ':': '32', '-': '32', '=': '33', '+': '33', '#': '37', '^': '1;37', ' ': '0' };
const TEAM_COLOUR = team => (team === 0 ? '1;31' : team === 1 ? '1;34' : '1;35');

/** Whether a MAP message's grid is well-formed: { w, h, rows: [h strings of w MAP_CHARS] }. */
export function validMap(m) {
    return Number.isInteger(m?.w) && Number.isInteger(m?.h) && m.w > 0 && m.h > 0 && m.w <= MAP_GRID.maxW && m.h <= MAP_GRID.maxH
        && Array.isArray(m.rows) && m.rows.length === m.h && m.rows.every(r => typeof r === 'string' && r.length === m.w && [...r].every(ch => MAP_CHARS.includes(ch)));
}

/**
 * The map as terminal lines, fitted into `cols` × `rows` characters (shrunk if needed).
 * view: { title, map: { w, h, rows } | null, bound, players: [{ name, team, x, z, alive }], bots: [{ name, team, x, z, ace }],
 *         boss: { name, x, z } | null, flag: { x, z } | null }
 */
export function renderMap(view, { cols = 100, rows = 40, colour = true } = {}) {
    const paint = (code, ch) => (colour ? ansi(code, ch) : ch);
    if (!view) return [paint('2', 'MAP  no room running · [M] hide')];
    const head = paint('1;36', 'MAP') + `  ${view.title}`;
    if (!view.map) return [head, paint('2', '     (waiting for a player to send the terrain)')];
    const k = Math.max(1, Math.ceil(Math.max(view.map.w / cols, view.map.h / Math.max(1, rows - 2))));
    const w = Math.floor(view.map.w / k), h = Math.floor(view.map.h / k);
    // Relief, shrunk by k: the highest character of each block wins (islands never vanish)
    const grid = Array.from({ length: h }, (_, j) => Array.from({ length: w }, (_, i) => {
        let best = ' ';
        for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) { const ch = view.map.rows[j * k + y][i * k + x]; if (MAP_CHARS.indexOf(ch) > MAP_CHARS.indexOf(best)) best = ch; }
        return { ch: best, code: RELIEF_COLOUR[best] ?? '0' };
    }));
    const put = (x, z, ch, code) => {
        const i = Math.floor(((view.bound - x) / (2 * view.bound)) * w), j = Math.floor(((view.bound - z) / (2 * view.bound)) * h);
        if (i >= 0 && i < w && j >= 0 && j < h) grid[j][i] = { ch, code };
    };
    if (view.flag) put(view.flag.x, view.flag.z, 'F', '1;33');
    for (const b of view.bots) put(b.x, b.z, b.ace ? '!' : (b.name[0] ?? 'b').toLowerCase(), b.ace ? '1;35' : TEAM_COLOUR(b.team).replace('1;', ''));
    if (view.boss) put(view.boss.x, view.boss.z, '@', '1;41;33');
    for (const p of view.players) if (p.alive) put(p.x, p.z, (p.name[0] ?? '?').toUpperCase(), TEAM_COLOUR(p.team));
    const lines = [head];
    for (const row of grid) {
        let line = '', run = '', code = null;
        for (const c of row) { // group runs of one colour: far fewer escape codes
            if (c.code !== code) { if (run) line += code === '0' ? run : paint(code, run); run = ''; code = c.code; }
            run += c.ch;
        }
        if (run) line += code === '0' ? run : paint(code, run);
        lines.push(`  ${line}`);
    }
    return lines;
}
