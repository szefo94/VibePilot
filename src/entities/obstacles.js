/** Sea stacks (rock columns off the coasts) and the hoop-chain count. */
import { MAP_BOUNDARY, groundLevel } from '../config.js';
import { scene } from '../core/scene.js';
import { markShared, randomRange } from '../core/utils.js';
import { distanceToAnyCoast, isOnAnyIslet } from '../world/world.js';
import { placementReport } from '../world/populate.js';
import { bake, kitMaterial, part } from '../core/meshkit.js';
import { obstacles } from './registry.js';

// --- Obstacle resources ---
export const torusMaterial = markShared(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.5, metalness: 0.2, emissive: 0x220000 })); // hoops: striped (collectibles.js)
export const numHoopChains = 8;
/**
 * Sea stacks: weathered rock columns rising from the sea near the coasts (they replace the old cave pillars,
 * stalactites and stalagmites). Each is a jittered low-poly column — dark wet rock at the waterline, lighter rock
 * above, a grassy cap — and collides as the cone from its base to its top ('stalagmite' in combat/collision.js).
 * Placed after the bases, clear of them and of the start area.
 */
const STACKS = 26, STACK_COL = { wet: 0x34393d, rock: 0x6a635a, rock2: 0x837b70, grass: 0x5d7a3a };
export function createObstacles() {
    for (let i = 0; i < STACKS; i++) {
        let x = 0, z = 0, ok = false;
        for (let tries = 0; tries < 40 && !ok; tries++) {
            x = randomRange(-MAP_BOUNDARY * 0.88, MAP_BOUNDARY * 0.88); z = randomRange(-MAP_BOUNDARY * 0.88, MAP_BOUNDARY * 0.88);
            const coast = distanceToAnyCoast(x, z);
            ok = x * x + z * z > 260 * 260 && !isOnAnyIslet(x, z) && coast > 20 && coast < 260
                && placementReport.bases.every(b => Math.hypot(b.x - x, b.z - z) > 220);
        }
        if (!ok) continue;
        const h = randomRange(22, 78), r = randomRange(7, 16);
        const m = new THREE.Mesh(seaStackGeometry(h, r), stackMaterial);
        m.position.set(x, groundLevel, z); m.rotation.y = Math.random() * Math.PI * 2;
        m.updateMatrixWorld(true);
        // Collision cone: the column's base radius up to its (narrower) top
        m.userData = { type: 'stalagmite', coneApex: new THREE.Vector3(x, groundLevel + h, z), coneBase: new THREE.Vector3(x, groundLevel, z), coneBaseRadius: r, boundingBox: new THREE.Box3().setFromObject(m) };
        obstacles.push(m); scene.add(m);
    }
}
const stackMaterial = markShared(kitMaterial({ roughness: 0.95 }));
/** A jittered, tapering rock column in three bands plus a grass cap. */
function seaStackGeometry(h, r) {
    const bands = [[0, 0.3, STACK_COL.wet], [0.3, 0.72, STACK_COL.rock], [0.72, 1, STACK_COL.rock2]];
    const radius = t => r * (1 - 0.5 * t);
    const jitter = Array.from({ length: 8 }, () => 0.8 + Math.random() * 0.4); // one per side, shared by the bands so they line up
    const parts = bands.map(([t0, t1, color]) => {
        const g = new THREE.CylinderGeometry(radius(t1), radius(t0), h * (t1 - t0), 8, 1);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), k = jitter[Math.round(((a + Math.PI) / (Math.PI * 2)) * 8) % 8]; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
        return part(g, color, { y: h * (t0 + t1) / 2 });
    });
    parts.push(part(new THREE.ConeGeometry(radius(1) * 0.95, h * 0.07, 8), STACK_COL.grass, { y: h * 1.03 }));
    return bake(parts);
}
