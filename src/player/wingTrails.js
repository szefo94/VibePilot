/** Wing-tip particle trails. */
import { scene } from '../core/scene.js';
import { plane } from './plane.js';

// --- Wing Trails ---
const TRAIL_LENGTH = 70;
const _trailTip = new THREE.Vector3();
export const _wingTipL = new THREE.Vector3(-6, 0, 0);
export const _wingTipR = new THREE.Vector3(6, 0, 0);
export const _rotFwd = new THREE.Vector3();
function createWingTrail() {
    const positions = new Float32Array(TRAIL_LENGTH * 3);
    const colors = new Float32Array(TRAIL_LENGTH * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({ size: 0.55, vertexColors: true, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    return { pts, positions, colors, count: 0 };
}
export function updateWingTrail(trail, tipLocal) {
    _trailTip.copy(tipLocal);
    plane.localToWorld(_trailTip);
    const pos = trail.positions, col = trail.colors;
    pos.copyWithin(3, 0, (TRAIL_LENGTH - 1) * 3);
    pos[0] = _trailTip.x; pos[1] = _trailTip.y; pos[2] = _trailTip.z;
    trail.count = Math.min(trail.count + 1, TRAIL_LENGTH);
    for (let i = 0; i < trail.count; i++) {
        const t = Math.pow(1 - i / TRAIL_LENGTH, 1.8);
        col[i*3] = 0.72 * t + 0.067; col[i*3+1] = 0.90 * t + 0.067; col[i*3+2] = 1.0 * t + 0.067;
    }
    trail.pts.geometry.attributes.position.needsUpdate = true;
    trail.pts.geometry.attributes.color.needsUpdate = true;
    trail.pts.geometry.setDrawRange(0, trail.count);
}
export const wingTrailL = createWingTrail(); wingTrailL.pts.frustumCulled = false; wingTrailL.pts.visible = false;
export const wingTrailR = createWingTrail(); wingTrailR.pts.frustumCulled = false; wingTrailR.pts.visible = false;
