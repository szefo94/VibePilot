/**
 * Colour-lines display mode (C key): everything renders as a normal-coloured wireframe on black.
 *
 * Uses scene.overrideMaterial with one shared material, so units spawned or destroyed while the mode is on are
 * covered automatically and no per-mesh materials or references are kept. The previous per-mesh material swap
 * missed later spawns and held strong references to removed meshes until toggled off.
 */
import { scene } from '../core/scene.js';
import { markShared } from '../core/utils.js';

const wireframe = markShared(new THREE.MeshNormalMaterial({ wireframe: true }));
const black = new THREE.Color(0x000000);
let savedBackground = null;

export const colorModeEnabled = () => scene.overrideMaterial === wireframe;

export function _toggleColorMode() {
    if (colorModeEnabled()) {
        scene.overrideMaterial = null;
        scene.background = savedBackground;
    } else {
        savedBackground = scene.background;
        scene.background = black;
        scene.overrideMaterial = wireframe;
    }
}
