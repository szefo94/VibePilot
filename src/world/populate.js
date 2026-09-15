/** Initial world population: bases, fleets, squadrons, collectibles, obstacles. */
import { MAP_BOUNDARY, ceilingLevel, groundLevel, numAirbases, numCarrierGroups, numDestroyerSquadrons, numEnemies, numForwardBases, numHoverWings, numStrikeWings } from '../config.js';
import { randomRange } from '../core/utils.js';
import { createIslets, isOnAnyIslet, islets } from './world.js';
import { spawnAirbase, spawnCarrierStrikeGroup, spawnDestroyerSquadron, spawnForwardBase } from '../entities/bases.js';
import { spawnHoverWing, spawnSingleEnemy, spawnStrikeWing } from '../entities/airUnits.js';
import { numCollectibleChains, spawnCollectibleChains, spawnHoopChains } from '../entities/collectibles.js';
import { spawnTube } from '../entities/tubes.js';
import { createObstacles, numHoopChains } from '../entities/obstacles.js';

export function createAllUnits() {
    createIslets(10); createObstacles();
    for (let i = 0; i < numEnemies; i++) spawnSingleEnemy();
    const getSafeZ2 = r2 => { let p; do { p = { x: randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9), z: randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9) }; } while (p.x * p.x + p.z * p.z < r2); return p; };
    const getSpawnPointOnIslet = () => { const isl = islets[~~(Math.random() * islets.length)], a = Math.random() * Math.PI * 2, d = Math.random() * isl.radius * .9; return { x: isl.x + Math.cos(a) * d, z: isl.z + Math.sin(a) * d, islet: isl }; };
    const getSpawnPointInWater = () => { let p; do { p = getSafeZ2(0); } while (isOnAnyIslet(p.x, p.z)); return p; };
    const sz2 = 300 * 300;
    const sz2_150 = 450 * 450;
    const sz2_100 = 400 * 400;
    for (let i = 0; i < numCarrierGroups; i++) { let p; do { p = getSpawnPointInWater(); } while (p.x * p.x + p.z * p.z < sz2_150); spawnCarrierStrikeGroup(p.x, p.z); }
    for (let i = 0; i < numDestroyerSquadrons; i++) { let p; do { p = getSpawnPointInWater(); } while (p.x * p.x + p.z * p.z < sz2); spawnDestroyerSquadron(p.x, p.z); }
    for (let i = 0; i < numAirbases; i++) { let p; do { p = getSpawnPointOnIslet(); } while (p.x * p.x + p.z * p.z < sz2_100); spawnAirbase(p.x, p.z, p.islet); }
    for (let i = 0; i < numForwardBases; i++) { let p; do { p = getSpawnPointOnIslet(); } while (p.x * p.x + p.z * p.z < sz2); spawnForwardBase(p.x, p.z, p.islet); }
    spawnCollectibleChains(numCollectibleChains);
    spawnHoopChains(numHoopChains);
    // Spawn challenge tubes (cyan, one-pass with orb ratio scoring) and free tubes (orange, open entry)
    for (let _ti = 0; _ti < 3; _ti++) { spawnTube(randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), randomRange(groundLevel + 55, ceilingLevel - 55), randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), 'challenge'); }
    for (let _ti = 0; _ti < 3; _ti++) { spawnTube(randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), randomRange(groundLevel + 55, ceilingLevel - 55), randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), 'free'); }
    for (let i = 0; i < numHoverWings; i++) { const p = { x: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), z: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8) }; if (p.x * p.x + p.z * p.z < sz2_100) { p.x += 500; p.z += 500; } spawnHoverWing(p.x, p.z); }
    for (let i = 0; i < numStrikeWings; i++) { const p = { x: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), z: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8) }; if (p.x * p.x + p.z * p.z < sz2_100) { p.x -= 500; p.z -= 500; } spawnStrikeWing(p.x, p.z); }
}
