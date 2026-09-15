// Performance benchmark: plays a scripted flight in a real browser and reports frame timing, draw calls,
// long tasks, GL resource counts, and — for builds that have src/debug/perf.js — CPU time per system,
// GPU render time and scene size.
//
//   npm run bench                                   # working tree, hover scenario
//   npm run bench -- --ref edc4f4b                  # any git commit/branch (exported to a temp dir)
//   npm run bench -- --compare edc4f4b,WORKTREE     # side by side, same seed and scenario
//   npm run bench -- --compare "WORKTREE,WORKTREE?disable=searchlights"   # cost of one feature (see src/debug/params.js)
//
// Options:
//   --scenario hover|circle|combat   hover: no input (most comparable); circle: steady turn; combat: circle +
//                              every weapon (default hover). The player is kept alive in every build.
//   --seed N                   deterministic Math.random for all builds (default 1)
//   --warmup S --duration S    seconds before / during measurement (default 5 / 20)
//   --gpu                      real GPU flags (default); --swiftshader forces CPU rendering (CI)
//   --vsync                    keep the 60 Hz cap (default: uncapped, so faster builds show higher fps)
//   --headed                   visible window (most reliable way to get the real GPU)
//   --cpuprofile FILE          save a V8 CPU profile (open in Chrome DevTools → Performance) + print top functions
//   --json FILE                write all results as JSON
//   --browser PATH             Chromium-based executable (or BROWSER_PATH); otherwise Playwright's Chromium
import { chromium } from 'playwright-core';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { startServer } from '../scripts/serve.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { values: opt } = parseArgs({
    options: {
        ref: { type: 'string' }, compare: { type: 'string' },
        scenario: { type: 'string', default: 'hover' }, seed: { type: 'string', default: '1' },
        warmup: { type: 'string', default: '5' }, duration: { type: 'string', default: '20' },
        gpu: { type: 'boolean', default: true }, swiftshader: { type: 'boolean', default: false },
        vsync: { type: 'boolean', default: false }, headed: { type: 'boolean', default: false },
        cpuprofile: { type: 'string' }, json: { type: 'string' }, browser: { type: 'string' },
    },
});
if (!['hover', 'circle', 'combat'].includes(opt.scenario)) throw new Error(`unknown scenario ${opt.scenario}`);
const targets = opt.compare ? opt.compare.split(',').map(s => s.trim()) : [opt.ref || 'WORKTREE'];
const wait = ms => new Promise(r => setTimeout(r, ms));

// --- Build under test: the working tree, or `git archive` of a commit into a temp dir.
// A target may carry extra URL parameters: `WORKTREE?disable=searchlights` ---
function prepareTarget(spec) {
    const [ref, query = ''] = spec.split('?');
    const suffix = query ? ` ?${query}` : '';
    if (ref === 'WORKTREE') {
        const head = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
        const dirty = execSync('git status --porcelain', { cwd: ROOT }).toString().trim() ? '+changes' : '';
        return { label: `WORKTREE (${head}${dirty})${suffix}`, root: ROOT, query, cleanup() {} };
    }
    const commit = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: ROOT }).toString().trim();
    const dir = mkdtempSync(join(tmpdir(), 'vibepilot-bench-'));
    const tar = execFileSync('git', ['archive', '--format=tar', commit], { cwd: ROOT, maxBuffer: 1 << 30 });
    execFileSync('tar', ['-x', '-C', dir], { input: tar });
    return { label: `${ref} (${commit.slice(0, 7)})${suffix}`, root: dir, query, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// --- Injected before any page script; works for every version of the game ---
function instrument(seed) {
    let s = (Number(seed) >>> 0) || 1;
    Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const B = window.__bench = { intervals: [], draws: [], tris: [], frameDraws: 0, frameTris: 0, longTasks: 0, longTaskMs: 0, live: { buffers: 0, textures: 0, programs: 0 } };
    // Remember the game's WebGL context (the page also has 2D canvases)
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        const ctx = getContext.call(this, type, ...rest);
        if (ctx && /webgl/.test(type) && !window.__benchGl) window.__benchGl = ctx;
        return ctx;
    };
    const raf = window.requestAnimationFrame.bind(window);
    let last = 0;
    raf(function tick(t) {
        if (last) { B.intervals.push(t - last); B.draws.push(B.frameDraws); B.tris.push(B.frameTris); }
        last = t; B.frameDraws = 0; B.frameTris = 0;
        raf(tick);
    });
    const TRIANGLES = 4;
    for (const proto of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype].filter(Boolean)) {
        const wrap = (name, fn) => { const orig = proto[name]; if (orig) proto[name] = function (...a) { fn(a); return orig.apply(this, a); }; };
        wrap('drawElements', a => { B.frameDraws++; if (a[0] === TRIANGLES) B.frameTris += a[1] / 3; });
        wrap('drawArrays', a => { B.frameDraws++; if (a[0] === TRIANGLES) B.frameTris += a[2] / 3; });
        wrap('drawElementsInstanced', a => { B.frameDraws++; if (a[0] === TRIANGLES) B.frameTris += a[1] / 3 * a[4]; });
        wrap('drawArraysInstanced', a => { B.frameDraws++; if (a[0] === TRIANGLES) B.frameTris += a[2] / 3 * a[3]; });
        wrap('createBuffer', () => B.live.buffers++); wrap('deleteBuffer', () => B.live.buffers--);
        wrap('createTexture', () => B.live.textures++); wrap('deleteTexture', () => B.live.textures--);
        wrap('createProgram', () => B.live.programs++); wrap('deleteProgram', () => B.live.programs--);
    }
    try {
        new PerformanceObserver(list => { for (const e of list.getEntries()) { B.longTasks++; B.longTaskMs += e.duration; } }).observe({ type: 'longtask', buffered: true });
    } catch { /* longtask observer unsupported */ }
}

// --- Keep any build alive: module builds get ?invulnerable; the classic single-file build exposes its
// top-level `let`s to page scripts, so its HP and spawn protection can be pinned directly ---
function keepAlive() {
    try {
        /* eslint-disable no-undef */
        if (typeof planeHP === 'number') planeHP = 100;
        if (typeof _graceTimer === 'number') _graceTimer = 5;
        /* eslint-enable no-undef */
    } catch { /* module build */ }
    const el = document.getElementById('game-over');
    return !(el && getComputedStyle(el).display !== 'none');
}

// --- Scripted flight (input only, so it drives any version) ---
//   hover:  no input — the plane drifts forward at spawn; most comparable between builds
//   circle: steady mouse-steered turn near spawn;  combat: circle + every weapon
async function fly(page, seconds, scenario) {
    const t0 = Date.now(), steering = scenario !== 'hover';
    let alive = true, nudge = 0;
    if (steering) { await page.mouse.move(550, 450); await page.keyboard.down('w'); await wait(600); await page.keyboard.up('w'); }
    if (scenario === 'combat') await page.keyboard.down(' ');
    const every = { e: 2500, r: 4000, x: 6000, q: 8000 }, lastPress = { e: 0, r: 0, x: 0, q: 0 };
    while (Date.now() - t0 < seconds * 1000) {
        alive = await page.evaluate(keepAlive);
        if (!alive) break;
        // The steering cursor decays to centre while the mouse is idle; keep it held left of centre
        if (steering) await page.mouse.move(550 + (nudge ^= 1) * 2, 450);
        if (scenario === 'combat') {
            for (const k of Object.keys(every)) {
                if (Date.now() - lastPress[k] > every[k]) { lastPress[k] = Date.now(); await page.keyboard.press(k); }
            }
        }
        await wait(200);
    }
    if (scenario === 'combat') await page.keyboard.up(' ');
    return alive;
}

const stats = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b), at = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    const r = v => Math.round(v * 100) / 100;
    return { avg: r(s.reduce((a, b) => a + b, 0) / s.length), p50: r(at(0.5)), p95: r(at(0.95)), p99: r(at(0.99)), max: r(s[s.length - 1]) };
};

// V8 CPU profile → self time per function
function summariseProfile(profile, top = 25) {
    const byId = new Map(profile.nodes.map(n => [n.id, n]));
    const self = new Map();
    let total = 0;
    profile.samples.forEach((id, i) => {
        const dt = (profile.timeDeltas[i] || 0) / 1000;
        total += dt;
        const f = byId.get(id).callFrame;
        const file = f.url ? f.url.split('/').slice(-2).join('/') : '';
        const key = `${f.functionName || '(anonymous)'}  ${file}${file ? ':' + (f.lineNumber + 1) : ''}`;
        self.set(key, (self.get(key) || 0) + dt);
    });
    return { totalMs: Math.round(total), top: [...self].sort((a, b) => b[1] - a[1]).slice(0, top).map(([fn, ms]) => ({ fn, ms: Math.round(ms), pct: Math.round(ms / total * 1000) / 10 })) };
}

async function runTarget(browser, target) {
    const server = await startServer(0, '127.0.0.1', target.root);
    const entry = existsSync(join(target.root, 'index.html')) ? 'index.html' : 'Index.html';
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(instrument, opt.seed);
    try {
        await page.goto(`http://127.0.0.1:${server.address().port}/${entry}?perf=quiet&invulnerable${target.query ? '&' + target.query : ''}`, { waitUntil: 'load' });
        // World ready = the populated scene is being drawn
        await page.waitForFunction(() => { const d = window.__bench.draws; return d.length > 5 && d[d.length - 1] > 150; }, null, { timeout: 60000 });
        const info = await page.evaluate(() => {
            const gl = window.__benchGl, ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
            return {
                renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : 'no WebGL context',
                webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
                timings: window.__vpPerf?.snapshot().timings ?? null,
            };
        });
        await fly(page, Number(opt.warmup), opt.scenario);
        await page.evaluate(() => { const B = window.__bench; B.intervals = []; B.draws = []; B.tris = []; B.longTasks = 0; B.longTaskMs = 0; window.__vpPerf?.reset(); });
        let cdp = null;
        if (opt.cpuprofile) { cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }
        const over = !(await fly(page, Number(opt.duration), opt.scenario));
        let profile = null;
        if (cdp) ({ profile } = await cdp.send('Profiler.stop'));
        const raw = await page.evaluate(() => ({ B: window.__bench, perf: window.__vpPerf?.snapshot() ?? null, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10 : null }));
        const interval = stats(raw.B.intervals);
        return {
            target: target.label, scenario: opt.scenario, seed: opt.seed, renderer: info.renderer, webgl2: info.webgl2,
            gameOverDuringRun: over, pageErrors: errors,
            frames: raw.B.intervals.length, fps: interval ? Math.round(10000 / interval.avg) / 10 : null,
            frameInterval: interval, longFramesOver33ms: raw.B.intervals.filter(v => v > 33.4).length,
            // Frames drawing under a quarter of the busiest frames usually mean the camera left the world
            worldInViewPct: raw.B.draws.length ? Math.round(raw.B.draws.filter(d => d >= 0.25 * stats(raw.B.draws).p95).length / raw.B.draws.length * 100) : null,
            drawCalls: stats(raw.B.draws), triangles: stats(raw.B.tris), longTasks: raw.B.longTasks, longTaskMs: Math.round(raw.B.longTaskMs),
            liveGl: raw.B.live, heapMB: raw.heapMB, init: info.timings,
            perf: raw.perf && { frameCpu: raw.perf.frameCpu, gpuTimer: raw.perf.gpuTimer, gpuRender: raw.perf.gpuRender, sections: raw.perf.sections, scene: raw.perf.scene, programs: raw.perf.gpuResources.programs },
            profile, // stripped before JSON output
        };
    } finally {
        await page.close();
        server.close();
    }
}

// --- Report ---
function printReport(results) {
    const cols = results.map(r => r.target);
    const width = Math.max(18, ...cols.map(c => c.length + 2));
    const row = (label, fn, digits = 1, lowerIsBetter = true) => {
        const vals = results.map(fn);
        const base = vals[0];
        const cells = vals.map((v, i) => {
            if (v == null || Number.isNaN(v)) return '—'.padEnd(width);
            let text = typeof v === 'number' ? v.toFixed(digits) : String(v);
            if (i > 0 && typeof v === 'number' && typeof base === 'number' && base !== 0) {
                const pct = (v - base) / Math.abs(base) * 100;
                if (Math.abs(pct) >= 3) text += ` (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%${(pct > 0) === lowerIsBetter ? ' worse' : ' better'})`;
            }
            return text.padEnd(width);
        });
        console.log(label.padEnd(24) + cells.join(''));
    };
    console.log('\n' + ''.padEnd(24) + cols.map(c => c.padEnd(width)).join(''));
    row('renderer', r => r.renderer.slice(0, width - 2));
    row('scenario / seed', r => `${r.scenario} / ${r.seed}`);
    row('game over during run', r => (r.gameOverDuringRun ? 'YES (discard)' : 'no'));
    row('world in view %', r => r.worldInViewPct, 0, false);
    row('frames', r => r.frames, 0, false);
    row('fps (avg)', r => r.fps, 1, false);
    row('frame ms p50', r => r.frameInterval?.p50);
    row('frame ms p95', r => r.frameInterval?.p95);
    row('frame ms p99', r => r.frameInterval?.p99);
    row('frames > 33 ms', r => r.longFramesOver33ms, 0);
    row('long tasks (ms)', r => r.longTaskMs, 0);
    row('draw calls / frame', r => r.drawCalls?.avg, 0);
    row('triangles / frame (k)', r => r.triangles && r.triangles.avg / 1000, 1);
    row('live GL buffers', r => r.liveGl.buffers, 0);
    row('live GL textures', r => r.liveGl.textures, 0);
    row('GL programs', r => r.liveGl.programs, 0);
    row('JS heap MB', r => r.heapMB, 1);
    row('init createAllUnits ms', r => r.init?.['init.createAllUnits']);
    row('init buildBaseFences ms', r => r.init?.['init.buildBaseFences']);
    row('CPU ms / frame', r => r.perf?.frameCpu?.avg, 2);
    row('GPU render ms', r => r.perf?.gpuRender?.avg, 2);
    row('lights in shaders', r => r.perf?.scene.lightsInShaders, 0);
    const sectionNames = [...new Set(results.flatMap(r => Object.keys(r.perf?.sections || {})))];
    for (const name of sectionNames) row(`  ${name} ms`, r => r.perf?.sections?.[name]?.avg, 2);
    for (const r of results) {
        if (r.pageErrors.length) console.log(`\n${r.target}: ${r.pageErrors.length} page error(s): ${r.pageErrors.slice(0, 3).join(' | ')}`);
        if (r.profileSummary) {
            console.log(`\nCPU profile ${r.target}: ${r.profileSummary.totalMs} ms sampled — top self time`);
            for (const t of r.profileSummary.top) console.log(`  ${String(t.ms).padStart(6)} ms ${String(t.pct).padStart(5)}%  ${t.fn}`);
        }
    }
    if (results.some(r => r.perf && !r.perf.gpuTimer)) console.log('\nGPU render time unavailable (browser does not expose EXT_disjoint_timer_query_webgl2).');
    if (results.some(r => /swiftshader/i.test(r.renderer))) console.log('Note: SwiftShader renders on the CPU — frame times are not representative of a real GPU.');
}

const browserPath = opt.browser || process.env.BROWSER_PATH;
const args = ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--enable-webgl-draft-extensions', '--enable-privileged-webgl-extensions'];
if (opt.swiftshader) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
else if (opt.gpu) args.push('--ignore-gpu-blocklist', '--enable-gpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []));
if (!opt.vsync) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const browser = await chromium.launch({ executablePath: browserPath || undefined, headless: !opt.headed, args });

const results = [];
try {
    for (const ref of targets) {
        const target = prepareTarget(ref);
        try {
            console.log(`Benchmarking ${target.label}: ${opt.scenario}, warmup ${opt.warmup}s, measure ${opt.duration}s…`);
            const result = await runTarget(browser, target);
            if (result.profile) {
                result.profileSummary = summariseProfile(result.profile);
                const file = targets.length > 1 ? opt.cpuprofile.replace(/(\.cpuprofile)?$/, `-${ref.replace(/[^\w.-]/g, '_')}.cpuprofile`) : opt.cpuprofile;
                writeFileSync(file, JSON.stringify(result.profile));
                console.log(`  CPU profile written to ${file}`);
            }
            delete result.profile;
            results.push(result);
        } finally {
            target.cleanup();
        }
    }
} finally {
    await browser.close();
}
printReport(results);
if (opt.json) { writeFileSync(opt.json, JSON.stringify(results, null, 2)); console.log(`\nResults written to ${opt.json}`); }
