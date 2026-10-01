/**
 * The room's relief for the server's console map (server/consoleMap.mjs). The server asks the first player in a room
 * (WELCOME needMap); the answer is MSG.MAP: MAP_REPORT.w × MAP_REPORT.h characters by height above the sea — the
 * same heightfield as the minimap — with rows from north (+z) to south and each row from west (+x) to east.
 * A cell is land if any of its samples is, so small islands still show.
 */
import { MAP_BOUNDARY, waterLevel } from '../config.js';
import { heightGrid } from '../world/terrain.js';
import { onHook } from '../game/hooks.js';
import { MSG } from '../net/protocol.js';
import { netSend, onNet } from '../net/net.js';

export const MAP_REPORT = Object.freeze({ w: 96, h: 48, sub: 3 }); // 2:1, as terminal characters are about twice as tall as wide
const BANDS = [[3, '.'], [15, ':'], [30, '-'], [45, '='], [60, '+'], [75, '#'], [Infinity, '^']]; // m above the sea → character

let built = false, asked = false;
onHook('worldReady', () => { built = true; if (asked) send(); });

/** Answer the server's request for the relief (once the world is built). */
export function startMapReport() {
    onNet('online', m => { if (m.needMap) { asked = true; if (built) send(); } });
}
function send() { asked = false; netSend(MSG.MAP, reliefGrid()); }

/** { w, h, rows } of the current map. */
export function reliefGrid() {
    const { w, h, sub } = MAP_REPORT, n = w * sub, step = (2 * MAP_BOUNDARY) / n; // square samples: sub per column, 2·sub per row
    const heights = heightGrid(-MAP_BOUNDARY, -MAP_BOUNDARY, step, n, n);
    const rows = [];
    for (let r = 0; r < h; r++) {
        let line = '';
        for (let c = 0; c < w; c++) {
            let top = -Infinity;
            for (let y = 0; y < sub * 2; y++) for (let x = 0; x < sub; x++) {
                const i = n - 1 - (c * sub + x), j = n - 1 - (r * sub * 2 + y); // west (+x) first, north (+z) first
                top = Math.max(top, heights[j * n + i]);
            }
            const e = top - waterLevel;
            line += e <= 0 ? '~' : BANDS.find(([max]) => e < max)[1];
        }
        rows.push(line);
    }
    return { w, h, rows };
}
