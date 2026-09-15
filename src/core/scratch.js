/** Scratch vectors/quaternions reused each frame to avoid allocations. Never hold references across calls. */
// --- Scratch vectors — reused each frame to avoid allocations (§2.6) ---
export const _sv1 = new THREE.Vector3();
export const _sv2 = new THREE.Vector3();
export const _sv3 = new THREE.Vector3();
export const _sq1 = new THREE.Quaternion(); // scratch quaternion for steering
export const _sq2 = new THREE.Quaternion(); // scratch quaternion for steering
export const _camOffset = new THREE.Vector3();
export const _lookAt = new THREE.Vector3();
export const _wp = new THREE.Vector3(); // scratch for getWorldPosition
// --- Weapon-fire scratch vectors — reused per-shot to avoid per-shot allocations (§3.2) ---
export const _wv1 = new THREE.Vector3();
export const _bombOffset  = new THREE.Vector3(0, -1.5,   0);   // bomb/napalm drop offset (const — never mutated)
export const _bombDroop   = new THREE.Vector3(0, -0.05,  0);   // bomb/napalm droop (const — never mutated)
export const _missileLTip = new THREE.Vector3(-5.9, -0.12, 0.55); // left wing-tip local coords
export const _missileRTip = new THREE.Vector3( 5.9, -0.12, 0.55); // right wing-tip local coords
// Deduplicated enemy bullet spawning (§3.2) — used by ground turrets and air units
export const _up3 = new THREE.Vector3(0, 1, 0);
