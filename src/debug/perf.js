/**
 * In-game profiler. Enable with ?perf in the URL (?perf=quiet collects without the overlay) or toggle with P.
 *
 * main.js wraps each frame in frameBegin()/frameEnd() and each system in begin(name)/end(name); while
 * disabled these return immediately. Reported per frame, over the last 600 frames:
 * frame interval, CPU time per system, GPU render time (when the browser exposes
 * EXT_disjoint_timer_query_webgl2), draw calls and triangles; plus scene size, lights in shaders,
 * GPU resources and JS heap.
 * Automation: window.__vpPerf.snapshot() / reset() / enable({ overlay }) — used by tests/perf-bench.mjs.
 */
import { renderer, scene } from '../core/scene.js';
import { state } from '../state.js';
import { splashActive } from '../ui/splash.js';
import { lightBudgetStats } from '../effects/lightBudget.js';
import { DEBUG_PARAMS } from './params.js';

const WINDOW = 600; // frames kept for statistics (~10 s at 60 fps)
const round2 = v => Math.round(v * 100) / 100;

class Ring {
    constructor(size = WINDOW) { this.buf = new Float64Array(size); this.count = 0; this.next = 0; }
    push(v) {
        this.buf[this.next] = v;
        this.next = (this.next + 1) % this.buf.length;
        if (this.count < this.buf.length) this.count++;
    }
    clear() { this.count = 0; this.next = 0; }
    stats() {
        if (!this.count) return null;
        const s = Array.from(this.buf.subarray(0, this.count)).sort((a, b) => a - b);
        const at = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
        return { avg: round2(s.reduce((a, b) => a + b, 0) / s.length), p50: round2(at(0.5)), p95: round2(at(0.95)), p99: round2(at(0.99)), max: round2(s[s.length - 1]) };
    }
}

let enabled = false, overlayWanted = false, overlay = null;
const frameInterval = new Ring(), frameCpu = new Ring(), gpuRender = new Ring(), drawCalls = new Ring(), triangles = new Ring();
const simulated = new Ring(); // 1 when the gameplay simulation ran that frame (not paused / game over / splash)
let simulatedThisFrame = 0;
const sectionRings = new Map();   // name → Ring of per-frame ms
const sectionFrameMs = new Map(); // name → ms accumulated in the current frame
const sectionStart = new Map();   // name → start timestamp of the open section
const timings = {};               // record(): one-off timings (world init, first frame)
let frameStartAt = 0, lastFrameStartAt = 0, lastOverlayAt = 0;

// --- CPU sections ---
export function begin(name) { if (enabled) sectionStart.set(name, performance.now()); }
export function end(name) {
    if (!enabled) return;
    const start = sectionStart.get(name);
    if (start !== undefined) sectionFrameMs.set(name, (sectionFrameMs.get(name) || 0) + performance.now() - start);
}
/** Called by main.js when the gameplay simulation runs this frame. */
export function markSimulated() { simulatedThisFrame = 1; }
/** Always-on one-off timing, e.g. world initialisation. */
export function record(name, ms) { timings[name] = Math.round(ms * 10) / 10; }

export function frameBegin() {
    if (!enabled) return;
    const now = performance.now();
    if (lastFrameStartAt) frameInterval.push(now - lastFrameStartAt);
    lastFrameStartAt = frameStartAt = now;
}
export function frameEnd() {
    if (!enabled) return;
    const now = performance.now();
    frameCpu.push(now - frameStartAt);
    simulated.push(simulatedThisFrame);
    simulatedThisFrame = 0;
    for (const [name, ms] of sectionFrameMs) {
        let ring = sectionRings.get(name);
        if (!ring) sectionRings.set(name, ring = new Ring());
        ring.push(ms);
        sectionFrameMs.set(name, 0);
    }
    drawCalls.push(renderer.info.render.calls);
    triangles.push(renderer.info.render.triangles);
    pollGpuQueries();
    if (overlay && !overlay.hidden && now - lastOverlayAt > 500) { lastOverlayAt = now; renderOverlay(); }
}

// --- GPU render time (WebGL2 timer queries; Chromium needs --enable-webgl-draft-extensions or equivalent) ---
let gl = null, timerExt = null, activeQuery = null;
const pendingQueries = [];
function initGpuTimer() {
    gl = renderer.getContext();
    timerExt = typeof gl.createQuery === 'function' ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
}
export function renderBegin() {
    begin('render');
    if (!enabled || !timerExt || activeQuery || pendingQueries.length > 8) return;
    activeQuery = gl.createQuery();
    gl.beginQuery(timerExt.TIME_ELAPSED_EXT, activeQuery);
}
export function renderEnd() {
    if (activeQuery) { gl.endQuery(timerExt.TIME_ELAPSED_EXT); pendingQueries.push(activeQuery); activeQuery = null; }
    end('render');
}
function pollGpuQueries() {
    if (!timerExt || !pendingQueries.length) return;
    const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);
    while (pendingQueries.length && gl.getQueryParameter(pendingQueries[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pendingQueries.shift();
        if (!disjoint) gpuRender.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
    }
}

// --- Reporting ---
function sceneStats() {
    let objects = 0, meshes = 0, lines = 0, points = 0, sprites = 0;
    scene.traverse(o => { objects++; if (o.isMesh) meshes++; else if (o.isLine) lines++; else if (o.isPoints) points++; else if (o.isSprite) sprites++; });
    // Every visible light is compiled into the lit materials' shaders, even at intensity 0
    let lightsInShaders = 0, pointLights = 0, silentLights = 0, visibleMeshes = 0;
    scene.traverseVisible(o => {
        if (o.isMesh) visibleMeshes++;
        if (!o.isLight) return;
        lightsInShaders++;
        if (o.isPointLight) pointLights++;
        if (o.intensity === 0) silentLights++;
    });
    return { objects, meshes, visibleMeshes, lines, points, sprites, lightsInShaders, pointLights, silentLights };
}

export function snapshot() {
    const interval = frameInterval.stats(), sim = simulated.stats();
    return {
        enabled,
        gameState: state.isGameOver ? 'game over' : state.isPaused ? 'paused' : splashActive ? 'splash' : 'flying',
        simulatedPct: sim ? Math.round(sim.avg * 100) : null, // share of the window's frames that ran gameplay
        frames: frameInterval.count,
        fps: interval ? Math.round(10000 / interval.avg) / 10 : null,
        frameInterval: interval,
        frameCpu: frameCpu.stats(),
        gpuTimer: !!timerExt,
        gpuRender: gpuRender.stats(),
        sections: Object.fromEntries([...sectionRings].map(([name, ring]) => [name, ring.stats()]).sort((a, b) => (b[1]?.avg || 0) - (a[1]?.avg || 0))),
        drawCalls: drawCalls.stats(),
        triangles: triangles.stats(),
        gpuResources: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs ? renderer.info.programs.length : null },
        scene: sceneStats(),
        lights: lightBudgetStats(),
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10 : null,
        timings: { ...timings },
    };
}

export function reset() {
    [frameInterval, frameCpu, gpuRender, drawCalls, triangles, simulated].forEach(r => r.clear());
    sectionRings.forEach(r => r.clear());
    lastFrameStartAt = 0;
}

function renderOverlay() {
    const s = snapshot(), n = (v, d = 1) => v == null ? '–' : v.toFixed(d);
    const entries = Object.entries(s.sections).filter(([, v]) => v);
    const busy = entries.filter(([, v]) => v.max >= 0.05), idle = entries.filter(([, v]) => v.max < 0.05).map(([name]) => name);
    const lines = [
        `PERF [P]  ${n(s.fps)} fps   frame p50 ${n(s.frameInterval?.p50)} ms  p95 ${n(s.frameInterval?.p95)}  p99 ${n(s.frameInterval?.p99)}`,
        `state: ${s.gameState} — gameplay simulated in ${s.simulatedPct ?? '–'}% of the last ${s.frames} frames`,
        `CPU ${n(s.frameCpu?.avg)} ms/frame (p95 ${n(s.frameCpu?.p95)})   GPU render ${s.gpuTimer ? `${n(s.gpuRender?.avg)} ms (p95 ${n(s.gpuRender?.p95)})` : 'n/a'}`,
        '  system          avg     p95     max  (ms)',
        ...busy.map(([name, v]) => `  ${name.padEnd(13)}${n(v.avg, 2).padStart(6)}  ${n(v.p95, 2).padStart(6)}  ${n(v.max, 1).padStart(6)}`),
        ...(idle.length ? [`  idle or < 0.05 ms: ${idle.join(', ')}`] : []),
        `draw calls ${Math.round(s.drawCalls?.avg ?? 0)}   triangles ${Math.round((s.triangles?.avg ?? 0) / 1000)}k   programs ${s.gpuResources.programs}`,
        `geometries ${s.gpuResources.geometries}   textures ${s.gpuResources.textures}   heap ${s.heapMB ?? '–'} MB`,
        `objects ${s.scene.objects}   meshes ${s.scene.meshes} (visible ${s.scene.visibleMeshes})`,
        `lights in shaders ${s.scene.lightsInShaders} (point ${s.scene.pointLights})   searchlights ${s.lights.lit}/${s.lights.searchlights} lit, ${s.lights.pooledOn}/${s.lights.budget} real lights on`,
    ];
    overlay.textContent = lines.join('\n');
}

function setEnabled(on, { overlay: showOverlay = overlayWanted } = {}) {
    enabled = on;
    overlayWanted = showOverlay;
    reset();
    if (on && !gl) initGpuTimer();
    if (on && showOverlay && !overlay) {
        overlay = document.createElement('pre');
        overlay.id = 'perf-overlay';
        overlay.style.cssText = 'position:fixed;top:130px;right:10px;margin:0;padding:8px 10px;z-index:700;pointer-events:none;background:rgba(0,0,0,0.82);color:#9fe8b0;font:11px/1.45 monospace;border:1px solid #2a5;white-space:pre;';
        document.body.appendChild(overlay);
    }
    if (overlay) overlay.hidden = !(on && showOverlay);
}

window.addEventListener('keydown', e => { if (!e.repeat && e.key.toLowerCase() === 'p') setEnabled(!enabled, { overlay: true }); });
window.__vpPerf = { snapshot, reset, enable: opts => setEnabled(true, opts), disable: () => setEnabled(false) };
if (DEBUG_PARAMS.perf !== null) setEnabled(true, { overlay: DEBUG_PARAMS.perf !== 'quiet' });
