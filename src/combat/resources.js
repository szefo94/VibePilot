/** Shared geometries and materials for bombs, missiles, napalm, flares and explosions. */
import { markShared } from '../core/utils.js';


// --- Bomb & explosion resources ---
export const bombMaterial = markShared(new THREE.MeshStandardMaterial({ color: "#222", roughness: .7 }));
// --- Missile resources (Y-aligned so setFromUnitVectors(_up3, vel) points nose along velocity) ---
const _missileBodyGeo  = markShared(new THREE.CylinderGeometry(0.28, 0.35, 5.5, 7)); // Y-axis = missile length
const _missileNoseGeo  = markShared((() => { const g = new THREE.ConeGeometry(0.28, 2.2, 7); g.translate(0, 3.85, 0); return g; })()); // tip at +Y
const _missileFinGeo   = markShared((() => { const g = new THREE.BoxGeometry(0.1, 1.6, 1.1); g.translate(0, -2.6, 0); return g; })()); // delta fin at rear
const _missileBodyMat  = markShared(new THREE.MeshStandardMaterial({ color: 0xd4d0c8, roughness: 0.5, metalness: 0.6 }));
const _missileNoseMat  = markShared(new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4 }));
const _missileFinMat   = markShared(new THREE.MeshStandardMaterial({ color: 0x888880, roughness: 0.6 }));
const _missileGlowGeo  = markShared(new THREE.SphereGeometry(0.38, 5, 4));
const _missileGlowMat  = markShared(new THREE.MeshBasicMaterial({ color: 0xff8822, transparent: true, opacity: 0.9 }));
export function _createMissileMesh() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(_missileBodyGeo, _missileBodyMat));
    g.add(new THREE.Mesh(_missileNoseGeo, _missileNoseMat));
    for (let _fi = 0; _fi < 4; _fi++) {
        const fin = new THREE.Mesh(_missileFinGeo, _missileFinMat);
        fin.rotation.y = _fi * Math.PI / 2; // spread 4 fins radially
        fin.position.set(Math.sin(_fi * Math.PI / 2) * 0.35, 0, Math.cos(_fi * Math.PI / 2) * 0.35);
        g.add(fin);
    }
    const glow = new THREE.Mesh(_missileGlowGeo, _missileGlowMat.clone());
    glow.position.set(0, -2.8, 0); // engine exhaust at rear (-Y)
    g.add(glow);
    return g;
}
export const _missileTrailGeo = markShared(new THREE.SphereGeometry(0.18, 4, 3));
export const _missileTrailMat = markShared(new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true }));
// --- Napalm fire particle resources ---
export const _napalmFireGeo = markShared(new THREE.SphereGeometry(1.5, 6, 4));
export const _napalmFireMat = markShared(new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true }));
// --- Flare particle resources ---
export const _flarePGeo = markShared(new THREE.SphereGeometry(0.5, 6, 4));
export const _flarePMatBase = markShared(new THREE.MeshBasicMaterial({ color: 0xffdd55, transparent: true }));
// --- Napalm resources ---
export const napalmPatchMat = markShared(new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.65 }));
// --- Napalm cluster resources (50-orb scatter redesign) ---
export const _napClusterR = 15;
export const _napClusterPatchGeo = markShared(new THREE.CylinderGeometry(_napClusterR, _napClusterR, 0.3, 10));
export const _napClusterOrbGeo = markShared(new THREE.SphereGeometry(0.55, 5, 4));
export const _napClusterOrbMat = markShared(new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.9 }));
export const bombRadius = 1.5;
// Pre-baked bomb visual geometries (shared, avoids per-drop GC stall)
export const _bombBodyGeo = markShared((() => { const g = new THREE.CylinderGeometry(0.7, 0.9, 3.2, 8); g.rotateX(Math.PI / 2); return g; })());
export const _bombNoseGeo = markShared((() => { const g = new THREE.ConeGeometry(0.7, 1.8, 8); g.rotateX(-Math.PI / 2); g.translate(0, 0, 2.5); return g; })());
export const _bombFinGeo  = markShared(new THREE.BoxGeometry(0.12, 1.4, 0.7));
export const explosionGeometry = markShared(new THREE.SphereGeometry(1, 16, 16));
// --- Explosion material pool (§3.3) — eliminates material.clone() per explosion ---
export const _expMatPool = [];
for (let _i = 0; _i < 12; _i++) _expMatPool.push(new THREE.MeshBasicMaterial({ color: 0xffa500, transparent: true, opacity: 0.8 }));
