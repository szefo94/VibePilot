/** Small shared helpers: random ranges and group disposal. */
// --- Helper Functions ---
export function randomRange(min, max) { return Math.random() * (max - min) + min; }
// rng helper for CHAIN_PATTERNS: [min,max] → randomRange; number → pass-through (§3.4)
export const rng = v => Array.isArray(v) ? randomRange(v[0], v[1]) : v;

// Recursively dispose geometries + materials of a Group/Mesh (memory leak fix)
export function disposeGroup(obj) {
    obj.traverse(child => {
        if (!child.isMesh && !child.isLine) return;
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material?.dispose();
    });
}
