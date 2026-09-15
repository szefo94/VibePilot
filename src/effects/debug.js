/** Collision debug box helpers (B key). */
import { state } from '../state.js';
import { corePlaneComponents } from '../player/plane.js';
import { airUnits, collectibles, enemies, groundUnits, obstacles } from '../entities/registry.js';
import { collectibleRadius } from '../entities/collectibles.js';

// Debug
const debugHelpers = [];

export function updateDebugBoxes() {
    debugHelpers.forEach(h => { if (h.parent) h.parent.remove(h); });
    debugHelpers.length = 0;
    if (!state.debugCollision) return;
    const addOBB = (obj, color) => {
        if (!obj.geometry) return;
        obj.geometry.computeBoundingBox();
        const h = new THREE.Box3Helper(obj.geometry.boundingBox.clone(), color);
        obj.add(h); debugHelpers.push(h);
    };
    corePlaneComponents.forEach(m => addOBB(m, 0x00ff00));
    obstacles.forEach(o => {
        if (o.userData.type === 'torus' || o.userData.type === 'pillar' || o.userData.type === 'stalactite' || o.userData.type === 'stalagmite') {
            const h = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ color: o.userData.type === 'torus' ? 0xff4444 : 0xffff00, wireframe: true }));
            o.add(h); debugHelpers.push(h);
        } else { addOBB(o, 0xffff00); }
    });
    collectibles.forEach(c => { const h = new THREE.Mesh(new THREE.SphereGeometry(collectibleRadius, 8, 6), new THREE.MeshBasicMaterial({ color: 0x00ff44, wireframe: true })); c.add(h); debugHelpers.push(h); });
    groundUnits.forEach(u => u.traverse(child => { if (child.isMesh) addOBB(child, 0xff8800); }));
    enemies.forEach(e => e.parts.forEach(p => addOBB(p, 0xff0000)));
    airUnits.forEach(au => { if (au.hp <= 0) return; au.group.traverse(child => { if (child.isMesh) addOBB(child, 0xff44ff); }); });
}
