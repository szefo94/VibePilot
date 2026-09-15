// Seeded Math.random. Classic script loaded before three.min.js and the game modules.
// Every run is seeded — from ?seed=<number> when given, otherwise a random seed — so any map can be replayed:
// the seed is exposed as window.__vpSeed and "Replay this map" reloads with ?seed=<that seed>.
// (Frame timing still varies, so a long flight will eventually diverge.)
(function () {
    const param = new URLSearchParams(location.search).get('seed');
    const seed = param !== null ? ((Number(param) >>> 0) || 1) : ((crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1);
    window.__vpSeed = seed;
    let s = seed;
    // mulberry32
    Math.random = function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    if (param !== null) console.info(`VibePilot: map seed ${seed}`);
})();
