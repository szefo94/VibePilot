// Deterministic Math.random for profiling and bug reproduction: add ?seed=<number> to the URL.
// Classic script loaded before three.min.js and the game modules, so world generation replays the same
// layout (frame timing still varies, so a long flight will eventually diverge).
(function () {
    const param = new URLSearchParams(location.search).get('seed');
    if (param === null) return;
    let s = (Number(param) >>> 0) || 1;
    // mulberry32
    Math.random = function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    console.info(`VibePilot: Math.random seeded with ${param}`);
})();
