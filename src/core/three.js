/**
 * Three.js, vendored as the ES module build `three.module.min.js` (r164), published as the global `THREE` the game
 * is written against. main.js imports this module first, so it runs before any other module touches `THREE`.
 *
 * The game was made on r128; newer releases changed two defaults that would change how it looks:
 *   colour management (r152)  hex colours were reinterpreted as sRGB and converted → switched off here, and
 *                             core/scene.js renders to linear output, as r128 did
 *   light units (r155)        "physically correct" intensities and decay → core/scene.js keeps the legacy lights
 *                             (renderer.useLegacyLights; it exists up to r164, the reason this release is used)
 */
import * as THREE from '../../three.module.min.js';

THREE.ColorManagement.enabled = false;
globalThis.THREE = { ...THREE }; // a plain, writable object like r128's global (a module namespace is read-only)
