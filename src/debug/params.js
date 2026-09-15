/**
 * Debug URL parameters:
 *   ?perf            profiler overlay (src/debug/perf.js); ?perf=quiet collects without the overlay
 *   ?invulnerable    the run never ends (for profiling flights)
 *   ?autostart       skip the start menu (restart, tests, benchmark)
 *   ?seed=N          deterministic Math.random (src/debug/seed-random.js, loaded before the game)
 *   ?disable=a,b     switch features off to measure their cost: searchlights, fences, labels
 */
const params = new URLSearchParams(location.search);

export const DEBUG_PARAMS = Object.freeze({
    perf: params.get('perf'), // null when absent
    invulnerable: params.has('invulnerable'),
    autostart: params.has('autostart'), // skip the start menu (tests, benchmark, restart)
    seed: params.get('seed'),
    disable: new Set((params.get('disable') || '').split(',').map(s => s.trim()).filter(Boolean)),
});
