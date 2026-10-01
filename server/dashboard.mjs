// Live dashboard lines for the server's terminal, pinned above the memory line (memwatch.mjs) and redrawn twice a second:
//
//   ROOMS  tdm:lobby ▕██▒▒▒▒▒▒▒·▏ 2+7 @kraken   coop:war ▕█·········▏ 1          (a room flashes when someone joins)
//   NET ⠹  in  12.3 KB/s ▂▃▅▇▅▃▂▁   out  85.1 KB/s ▃▅▇█▇▅▃▂   · 240 msg/s
//   TICK ♥ 0.42 ms ▁▁▂▁▃▁▁▂  max 1.3 ms of 50 ms
//
// The spinner turns only while traffic flows; the heart beats with every redraw (the server is alive); the sparklines
// are the last DASH.history samples, scaled to the highest in view. Lines never get wider than the terminal.

export const DASH = Object.freeze({ history: 16, flashFrames: 6 });
const SPARK = '▁▂▃▄▅▆▇█', SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const ansi = (code, text) => `\x1b[${code}m${text}\x1b[0m`;
const kb = b => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB/s` : `${(b / 1024).toFixed(1)} KB/s`).padStart(10);
function spark(values) {
    const hi = Math.max(...values, 1e-9);
    return values.map(v => SPARK[Math.min(SPARK.length - 1, Math.floor((v / hi) * (SPARK.length - 1) + (v > 0 ? 0.5 : 0)))]).join('').padStart(DASH.history, ' ');
}

/** A dashboard over `load()` (server.mjs srv.load). Returns lines(cols, colour) → string[]. */
export function createDashboard(load, now = () => Date.now()) {
    const hist = { in: [], out: [], msgs: [], tick: [] };
    let last = null, frame = 0;
    const seen = new Map(); // room key → { players, flash }
    const push = (list, v) => { list.push(v); if (list.length > DASH.history) list.shift(); };

    return function lines(cols = 100, colour = true) {
        const paint = (code, text) => (colour ? ansi(code, text) : text);
        const L = load(), t = now();
        frame++;
        // Rates since the last redraw
        const dt = last ? Math.max(0.001, (t - last.t) / 1000) : 1;
        const rate = k => (last ? Math.max(0, (L.traffic[k] - last.traffic[k]) / dt) : 0);
        const inB = rate('inBytes'), outB = rate('outBytes'), msgs = rate('inMsgs') + rate('outMsgs');
        push(hist.in, inB); push(hist.out, outB); push(hist.msgs, msgs);
        if (L.tick.n) push(hist.tick, L.tick.avg);
        last = { t, traffic: L.traffic };

        // ROOMS: a bar per room — players █, bots ▒, free ·; the room flashes when its player count rises
        const parts = [];
        let width = 7;
        for (const r of L.rooms) {
            const was = seen.get(r.key), flash = was && r.players > was.players ? DASH.flashFrames : Math.max(0, (was?.flash ?? 0) - 1);
            seen.set(r.key, { players: r.players, flash });
            const p = Math.min(r.max, r.players), b = Math.min(r.max - p, r.bots);
            const plain = `${r.key} ▕${'█'.repeat(p)}${'▒'.repeat(b)}${'·'.repeat(r.max - p - b)}▏ ${r.players}${r.bots ? `+${r.bots}` : ''}${r.boss ? ` @${r.boss}` : ''}`;
            if (width + plain.length + 3 > cols) { parts.push(paint('2', `+${L.rooms.length - parts.length} more`)); break; }
            width += plain.length + 3;
            const name = flash && frame % 2 ? paint('7;32', r.key) : paint('1', r.key);
            parts.push(`${name} ▕${paint('32', '█'.repeat(p))}${paint('34', '▒'.repeat(b))}${paint('2', '·'.repeat(r.max - p - b))}▏ ${r.players}${r.bots ? paint('2', `+${r.bots}`) : ''}${r.boss ? paint('1;35', ` @${r.boss}`) : ''}`);
        }
        for (const key of seen.keys()) if (!L.rooms.some(r => r.key === key)) seen.delete(key);
        const rooms = `${paint('1;36', 'ROOMS')}  ${parts.length ? parts.join('   ') : paint('2', 'none running — waiting for players')}`;

        // NET: traffic in and out with sparklines; the spinner turns while messages flow
        const spin = msgs > 0 ? paint('36', SPIN[frame % SPIN.length]) : paint('2', '·');
        const netPlain = `NET ·  in ${kb(inB)} ${spark(hist.in)}   out ${kb(outB)} ${spark(hist.out)}   · ${Math.round(msgs)} msg/s`;
        const net = netPlain.length <= cols
            ? `${paint('1;36', 'NET')} ${spin}  in ${kb(inB)} ${paint('32', spark(hist.in))}   out ${kb(outB)} ${paint('33', spark(hist.out))}   ${paint('2', `· ${Math.round(msgs)} msg/s`)}`
            : `${paint('1;36', 'NET')} ${spin}  in ${kb(inB).trim()} · out ${kb(outB).trim()}`;

        // TICK: how long a server tick takes, against its budget; the heart beats every redraw
        const use = L.tick.budget ? L.tick.max / L.tick.budget : 0, code = use > 0.5 ? "31" : use > 0.2 ? "33" : "32";
        const heart = frame % 2 ? paint('1;31', '♥') : paint('2;31', '♡');
        const tick = `${paint('1;36', 'TICK')} ${heart} ${(hist.tick.at(-1) ?? 0).toFixed(2).padStart(5)} ms ${paint(code, spark(hist.tick))}  ${paint('2', `max ${L.tick.max.toFixed(1)} ms of ${L.tick.budget.toFixed(0)} ms`)}`;
        return [rooms, net, tick];
    };
}
