/** Initial world population: bases, fleets, squadrons, collectibles, obstacles. */
import { MAP_BOUNDARY, ceilingLevel, groundLevel, numAirbases, numCarrierGroups, numDestroyerSquadrons, numEnemies, numForwardBases, numHoverWings, numStrikeWings } from '../config.js';
import { randomRange } from '../core/utils.js';
import { _pointInPolygon, createIslets, isOnAnyIslet, islets } from './world.js';
import { spawnAirbase, spawnCarrierStrikeGroup, spawnDestroyerSquadron, spawnForwardBase } from '../entities/bases.js';
import { spawnHoverWing, spawnSingleEnemy, spawnStrikeWing } from '../entities/airUnits.js';
import { numCollectibleChains, spawnCollectibleChains, spawnHoopChains } from '../entities/collectibles.js';
import { spawnTube } from '../entities/tubes.js';
import { createObstacles, numHoopChains } from '../entities/obstacles.js';

const MAX_PLACEMENT_TRIES = 200;

// Rejection sampling with a bounded number of attempts; `generate` may return null for an invalid candidate
function sample(generate, valid) {
    for (let tries = 0; tries < MAX_PLACEMENT_TRIES; tries++) {
        const p = generate();
        if (p && valid(p)) return p;
    }
    return null;
}
const outsideSpawnZone = minDist => p => p.x * p.x + p.z * p.z >= minDist * minDist;
// A point inside a random islet's actual polygon, not just its bounding circle
function pointOnIslet() {
    const isl = islets[~~(Math.random() * islets.length)], a = Math.random() * Math.PI * 2, d = Math.random() * isl.radius * .9;
    const p = { x: isl.x + Math.cos(a) * d, z: isl.z + Math.sin(a) * d, islet: isl };
    return _pointInPolygon(p.x, p.z, isl.polygon) ? p : null;
}
function pointInWater() {
    const p = { x: randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9), z: randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9) };
    return isOnAnyIslet(p.x, p.z) ? null : p;
}
function place(count, generate, minDistFromSpawn, spawn, what) {
    for (let i = 0; i < count; i++) {
        const p = sample(generate, outsideSpawnZone(minDistFromSpawn));
        if (p) spawn(p);
        else console.warn(`populate: no valid position for ${what} after ${MAX_PLACEMENT_TRIES} tries; skipped`);
    }
}

export function createAllUnits() {
    createIslets(10); createObstacles();
    for (let i = 0; i < numEnemies; i++) spawnSingleEnemy();
    place(numCarrierGroups, pointInWater, 450, p => spawnCarrierStrikeGroup(p.x, p.z), 'carrier strike group');
    place(numDestroyerSquadrons, pointInWater, 300, p => spawnDestroyerSquadron(p.x, p.z), 'destroyer squadron');
    place(numAirbases, pointOnIslet, 400, p => spawnAirbase(p.x, p.z, p.islet), 'airbase');
    place(numForwardBases, pointOnIslet, 300, p => spawnForwardBase(p.x, p.z, p.islet), 'forward base');
    spawnCollectibleChains(numCollectibleChains);
    spawnHoopChains(numHoopChains);
    // Spawn challenge tubes (cyan, one-pass with orb ratio scoring) and free tubes (orange, open entry)
    for (let _ti = 0; _ti < 3; _ti++) { spawnTube(randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), randomRange(groundLevel + 55, ceilingLevel - 55), randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), 'challenge'); }
    for (let _ti = 0; _ti < 3; _ti++) { spawnTube(randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), randomRange(groundLevel + 55, ceilingLevel - 55), randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), 'free'); }
    const sz2_100 = 400 * 400;
    for (let i = 0; i < numHoverWings; i++) { const p = { x: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), z: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8) }; if (p.x * p.x + p.z * p.z < sz2_100) { p.x += 500; p.z += 500; } spawnHoverWing(p.x, p.z); }
    for (let i = 0; i < numStrikeWings; i++) { const p = { x: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), z: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8) }; if (p.x * p.x + p.z * p.z < sz2_100) { p.x -= 500; p.z -= 500; } spawnStrikeWing(p.x, p.z); }
}
