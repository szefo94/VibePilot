// Live memory readout for the server's terminal: one status line pinned under the log, redrawn every few seconds.
//
//   MEM  rss 61.2 MB ▁▁▂▂▃▃▃▄▄▅  heap 14.8 / 22.1 MB  ext 2.3 MB · 1 room · 3 players · up 12m
//
// The bar is the process's resident memory (what the OS gives it) over the last few minutes, scaled between the
// lowest and highest value in view; the colour follows the heap's use of its current size. Log lines go through
// `log()`, which clears the status line, prints the log line and redraws it, so the two never mix.
// Interactive terminals only: when the output is piped to a file (`> mp.log`) a plain line is written every minute.
// `panel()` may return more lines to pin above the memory line (the console map, consoleMap.mjs); refresh() redraws.

const BARS = '▁▂▃▄▅▆▇█';
const MB = 1024 * 1024;
const fmt = bytes => `${(bytes / MB).toFixed(1)} MB`;
const ansi = (code, text) => `\x1b[${code}m${text}\x1b[0m`;

/**
 * Start the readout. `stats()` returns { rooms, players } (the server's own counts); `out` is the stream.
 * Returns { log } — use it instead of console.log — and stop().
 */
export function startMemWatch({ intervalMs = 2000, history = 60, stats = () => ({ rooms: 0, players: 0 }), out = process.stdout, panel = () => [] } = {}) {
    const live = !!out.isTTY;
    const samples = [];
    const started = Date.now();
    let status = '';

    const line = () => {
        const m = process.memoryUsage(), s = stats();
        samples.push(m.rss);
        if (samples.length > history) samples.shift();
        const lo = Math.min(...samples), hi = Math.max(...samples), span = hi - lo || 1;
        const bars = samples.map(v => BARS[Math.min(BARS.length - 1, Math.floor((v - lo) / span * BARS.length))]).join('');
        const heapUse = m.heapUsed / m.heapTotal, colour = heapUse > 0.9 ? 31 : heapUse > 0.75 ? 33 : 32; // red · yellow · green
        const up = Math.round((Date.now() - started) / 60000);
        const plain = `rss ${fmt(m.rss)} ${bars.padEnd(history, ' ')}  heap ${fmt(m.heapUsed)} / ${fmt(m.heapTotal)}  ext ${fmt(m.external)}`
            + ` · ${s.rooms} room${s.rooms === 1 ? '' : 's'} · ${s.players} player${s.players === 1 ? '' : 's'} · up ${up < 60 ? `${up}m` : `${Math.floor(up / 60)}h${up % 60}m`}`;
        return live ? `${ansi('1;36', 'MEM')}  ${ansi(colour, plain)}` : `MEM ${plain}`;
    };
    let shown = 0; // lines of the pinned block on screen (the cursor sits on its last line)
    const clear = () => { if (live && shown) out.write(`\r${shown > 1 ? `\x1b[${shown - 1}A` : ''}\x1b[J`); shown = 0; };
    const draw = () => {
        if (!live) return;
        const lines = [...panel(), status];
        clear();
        out.write(lines.join('\n'));
        shown = lines.length;
    };

    let ticks = 0;
    const timer = setInterval(() => {
        status = line();
        if (live) draw();
        else if (++ticks % Math.max(1, Math.round(60000 / intervalMs)) === 0) out.write(`${status}\n`); // piped: once a minute
    }, intervalMs);
    timer.unref(); // never keeps the process alive on its own
    status = line();
    draw();

    return {
        /** Print a log line above the status line. */
        log(...parts) {
            clear();
            out.write(`${parts.join(' ')}\n`);
            draw();
        },
        /** Redraw the pinned block now (the panel changed). */
        refresh: draw,
        stop() { clearInterval(timer); clear(); },
    };
}
