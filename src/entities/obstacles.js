/** Obstacle pillars and hoops. */
import { MAP_BOUNDARY, ceilingLevel, groundLevel } from '../config.js';
import { scene } from '../core/scene.js';
import { markShared, randomRange } from '../core/utils.js';
import { caveWallMaterial } from '../world/world.js';
import { obstacles } from './registry.js';
import { spawnSingleHoopWithMarker } from './collectibles.js';

// --- Obstacle resources ---
export const torusMaterial = markShared(new THREE.MeshStandardMaterial({ color: 16711680, roughness: .6 }));
export const numObstacles = 80, targetHoopCount = 0, numHoopChains = 8;
export function createObstacles() {
    const pGeo = new THREE.CylinderGeometry(1, 1, 1, 12), rGeo = new THREE.ConeGeometry(1, 1, 8);
    let c = 0;
    for (let i = 0; i < numObstacles; i++) {
        const f = (targetHoopCount - c) >= numObstacles - i;
        let m, x, z;
        const safeZoneRadius = 200;
        do { x = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9); z = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9); } while (x * x + z * z < safeZoneRadius * safeZoneRadius);
        const t = Math.random(), n = 1 - targetHoopCount / numObstacles, a = f ? 0 : n * .4, s = f ? 0 : a + n * .3;
        if (!f && t < a) {
            const R = randomRange(5, 25), H = ceilingLevel - groundLevel;
            m = new THREE.Mesh(pGeo, caveWallMaterial); m.scale.set(R, H, R); m.position.set(x, groundLevel + H / 2, z);
            m.updateMatrixWorld(true); m.userData = { type: 'pillar', pillarX: x, pillarZ: z, pillarRadius: R };
            obstacles.push(m); scene.add(m);
        } else if (!f && t < s) {
            const b = randomRange(4, 20), h = randomRange(15, ceilingLevel - (groundLevel + 50));
            m = new THREE.Mesh(rGeo, caveWallMaterial); m.scale.set(b, h, b); m.rotation.x = Math.PI; m.position.set(x, ceilingLevel - h / 2, z);
            m.updateMatrixWorld(true);
            const stApex = new THREE.Vector3(0, 0.5, 0); m.localToWorld(stApex);
            const stBase = new THREE.Vector3(0, -0.5, 0); m.localToWorld(stBase);
            m.userData = { type: 'stalactite', coneApex: stApex, coneBase: stBase, coneBaseRadius: b, boundingBox: new THREE.Box3().setFromObject(m) };
            obstacles.push(m); scene.add(m);
        } else {
            if (c < targetHoopCount || f) { spawnSingleHoopWithMarker(); c++; }
            else {
                const b = randomRange(4, 20), h = randomRange(15, ceilingLevel - (groundLevel + 50));
                m = new THREE.Mesh(rGeo, caveWallMaterial); m.scale.set(b, h, b); m.position.set(x, groundLevel + h / 2, z);
                m.updateMatrixWorld(true);
                const smApex = new THREE.Vector3(0, 0.5, 0); m.localToWorld(smApex);
                const smBase = new THREE.Vector3(0, -0.5, 0); m.localToWorld(smBase);
                m.userData = { type: 'stalagmite', coneApex: smApex, coneBase: smBase, coneBaseRadius: b, boundingBox: new THREE.Box3().setFromObject(m) };
                obstacles.push(m); scene.add(m);
            }
        }
    }
}
