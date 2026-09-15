/** Colour-lines wireframe display mode (C key). */
import { groundLevel } from '../config.js';
import { scene } from '../core/scene.js';

// Color-lines mode (webgl_lines_colors aesthetic — wireframe on black)
let _colorMode = false;
let _colorModeBg = null;
const _colorModeOrigMats = new Map();

// webgl_lines_colors mode — swap all mesh materials to vibrant HSL wireframe on black background
export function _toggleColorMode() {
    _colorMode = !_colorMode;
    const col = new THREE.Color();
    if (_colorMode) {
        _colorModeBg = scene.background;
        scene.background = new THREE.Color(0x000000);
        let idx = 0;
        scene.traverse(obj => {
            if (!obj.isMesh || _colorModeOrigMats.has(obj)) return;
            _colorModeOrigMats.set(obj, obj.material);
            // Three HSL schemes cycling by index, modulated by world Y for depth variation
            const scheme = idx % 3; // 0=cyan, 1=pink, 2=rainbow
            const yFrac  = Math.max(0, Math.min(1, (obj.getWorldPosition(new THREE.Vector3()).y - groundLevel) / 200));
            const h = scheme === 0 ? 0.55 + yFrac * 0.1
                    : scheme === 1 ? 0.88 + yFrac * 0.08
                    : (idx * 0.137 + yFrac * 0.3) % 1.0;
            col.setHSL(h, 1.0, 0.5);
            obj.material = new THREE.MeshBasicMaterial({ color: col.clone(), wireframe: true });
            idx++;
        });
    } else {
        scene.background = _colorModeBg;
        _colorModeOrigMats.forEach((mat, mesh) => {
            if (mesh.material && mesh.material !== mat) mesh.material.dispose();
            mesh.material = mat;
        });
        _colorModeOrigMats.clear();
    }
}
