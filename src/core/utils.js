/** Small shared helpers: random ranges and resource ownership/disposal. */
// --- Helper Functions ---
export function randomRange(min, max) { return Math.random() * (max - min) + min; }
// rng helper for CHAIN_PATTERNS: [min,max] → randomRange; number → pass-through (§3.4)
export const rng = v => Array.isArray(v) ? randomRange(v[0], v[1]) : v;

// Geometries/materials used by many meshes. A WeakSet rather than userData: clone() copies userData,
// and clones are owned by whoever made them.
const _sharedResources = new WeakSet();
/** Mark a geometry/material used by many meshes, so per-entity cleanup never disposes it. */
export function markShared(resource) {
    _sharedResources.add(resource);
    return resource;
}
/** Dispose a geometry/material owned by a single entity; shared resources are left alone. */
export function disposeOwned(resource) {
    if (resource && !_sharedResources.has(resource)) resource.dispose();
}

// Recursively dispose the instance-owned geometries + materials of a Group/Mesh (memory leak fix).
// Shared resources (markShared) and debug helpers (owned by effects/debug.js) are skipped.
export function disposeGroup(obj) {
    obj.traverse(child => {
        if (!child.isMesh && !child.isLine && !child.isPoints) return;
        if (child.userData?.debugHelper) return;
        disposeOwned(child.geometry);
        if (Array.isArray(child.material)) child.material.forEach(disposeOwned);
        else disposeOwned(child.material);
    });
}
