/**
 * Collision debug box helpers (B key). Helpers are built once per object, follow it as children, and are
 * disposed when the overlay is switched off or the object leaves the world — safe to leave enabled.
 */
import { state } from '../state.js';
import { corePlaneComponents } from '../player/plane.js';
import { airUnits, collectibles, enemies, groundUnits, obstacles } from '../entities/registry.js';
import { collectibleRadius } from '../entities/collectibles.js';

const _helpers = new Map(); // owner Object3D → helper objects attached to it or its descendants
let _shared = null;         // wireframe materials + collectible sphere, created on first use and kept

function sharedResources() {
    return _shared || (_shared = {
        torusMat: new THREE.MeshBasicMaterial({ color: 0xff4444, wireframe: true }),
        pillarMat: new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true }),
        collectibleMat: new THREE.MeshBasicMaterial({ color: 0x00ff44, wireframe: true }),
        collectibleGeo: new THREE.SphereGeometry(collectibleRadius, 8, 6),
    });
}
function attach(parent, helper, out) {
    helper.userData.debugHelper = true; // disposeGroup() skips helpers; this module owns them
    parent.add(helper); out.push(helper);
}
// Box3Helper owns its geometry and material; `deep` boxes every mesh in the hierarchy
function boxHelpers(root, color, deep) {
    const out = [];
    const add = obj => {
        if (!obj.geometry || obj.userData.debugHelper) return;
        obj.geometry.computeBoundingBox();
        const helper = new THREE.Box3Helper(obj.geometry.boundingBox.clone(), color);
        helper.userData.ownsResources = true; // r128 Box3Helper has no isBox3Helper flag
        attach(obj, helper, out);
    };
    if (deep) root.traverse(c => { if (c.isMesh) add(c); }); else add(root);
    return out;
}
function wireHelper(owner, geometry, material) {
    const out = [];
    attach(owner, new THREE.Mesh(geometry, material), out);
    return out;
}
function disposeHelper(h) {
    h.parent?.remove(h);
    if (h.userData.ownsResources) { h.geometry.dispose(); h.material.dispose(); }
}
function releaseAll() {
    for (const list of _helpers.values()) list.forEach(disposeHelper);
    _helpers.clear();
}

export function updateDebugBoxes() {
    if (!state.debugCollision) { if (_helpers.size) releaseAll(); return; }
    const live = new Set();
    const track = (owner, build) => { live.add(owner); if (!_helpers.has(owner)) _helpers.set(owner, build()); };
    corePlaneComponents.forEach(m => track(m, () => boxHelpers(m, 0x00ff00, false)));
    obstacles.forEach(o => track(o, () => {
        const t = o.userData.type;
        if (t === 'torus' || t === 'pillar' || t === 'stalactite' || t === 'stalagmite') {
            const r = sharedResources();
            return wireHelper(o, o.geometry, t === 'torus' ? r.torusMat : r.pillarMat);
        }
        return boxHelpers(o, 0xffff00, false);
    }));
    collectibles.forEach(c => track(c, () => { const r = sharedResources(); return wireHelper(c, r.collectibleGeo, r.collectibleMat); }));
    groundUnits.forEach(u => track(u, () => boxHelpers(u, 0xff8800, true)));
    enemies.forEach(e => e.parts.forEach(p => track(p, () => boxHelpers(p, 0xff0000, false))));
    airUnits.forEach(au => { if (au.hp > 0) track(au.group, () => boxHelpers(au.group, 0xff44ff, true)); });
    // Owners that left the world (destroyed, collected, dying) release their helpers
    for (const [owner, list] of _helpers) if (!live.has(owner)) { list.forEach(disposeHelper); _helpers.delete(owner); }
}
