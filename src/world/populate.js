/** Initial world population: bases, fleets, squadrons, collectibles, obstacles. */
import { MAP_BOUNDARY, ceilingLevel, groundLevel, numAirbases, numCarrierGroups, numDestroyerSquadrons, numEnemies, numForwardBases, numHoverWings, numStrikeWings } from '../config.js';
import { randomRange } from '../core/utils.js';
import { _pointInPolygon, createIslets, distanceToAnyCoast, distanceToCoast, isOnAnyIslet, islets } from './world.js';
import { spawnAirbase, spawnCarrierStrikeGroup, spawnDestroyerSquadron, spawnForwardBase } from '../entities/bases.js';
import { spawnHoverWing, spawnSingleEnemy, spawnStrikeWing } from '../entities/airUnits.js';
import { numCollectibleChains, spawnCollectibleChains, spawnHoopChains } from '../entities/collectibles.js';
import { spawnTube } from '../entities/tubes.js';
import { createObstacles, numHoopChains } from '../entities/obstacles.js';

const MAX_PLACEMENT_TRIES = 200;
// Base footprints, from how far each spawner places its units: land bases need that much clearance inland
// from the coast, fleets that much open water around them
export const BASE_RULES = Object.freeze({
    airbase:           { onIslet: true,  coastClearance: 120, minDistFromSpawn: 400 }, // runway 200 long, tanks 100–180 out
    forwardBase:       { onIslet: true,  coastClearance: 90,  minDistFromSpawn: 300 }, // hangars 110 behind, trucks ≤ 90
    carrierGroup:      { onIslet: false, coastClearance: 150, minDistFromSpawn: 450 }, // carrier hull radius 144
    destroyerSquadron: { onIslet: false, coastClearance: 60,  minDistFromSpawn: 300 },
});
export const MIN_BASE_SEPARATION = 300;   // between base centres
const RELAXED = 0.6;                       // after half the tries, accept 60 % of clearance and separation

/** What the last createAllUnits() placed (read by tests/browser-probes.mjs). */
export const placementReport = { bases: [], skipped: [] };

// Rejection sampling with a bounded number of attempts; `generate` may return null for an invalid candidate
function sample(generate, valid, tries) {
    for (let i = 0; i < tries; i++) {
        const p = generate();
        if (p && valid(p)) return p;
    }
    return null;
}
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
const coastDistance = (p, rule) => (rule.onIslet ? distanceToCoast(p.x, p.z, p.islet) : distanceToAnyCoast(p.x, p.z));

function place(kind, count, spawn) {
    const rule = BASE_RULES[kind];
    const generate = rule.onIslet ? pointOnIslet : pointInWater;
    const valid = scale => p =>
        p.x * p.x + p.z * p.z >= rule.minDistFromSpawn ** 2
        && placementReport.bases.every(b => Math.hypot(p.x - b.x, p.z - b.z) >= MIN_BASE_SEPARATION * scale)
        && coastDistance(p, rule) >= rule.coastClearance * scale;
    for (let i = 0; i < count; i++) {
        let relaxed = false;
        let p = sample(generate, valid(1), MAX_PLACEMENT_TRIES / 2);
        if (!p) { relaxed = true; p = sample(generate, valid(RELAXED), MAX_PLACEMENT_TRIES / 2); }
        if (!p) { placementReport.skipped.push(kind); console.warn(`populate: no valid position for ${kind} after ${MAX_PLACEMENT_TRIES} tries; skipped`); continue; }
        placementReport.bases.push({ kind, x: p.x, z: p.z, relaxed, coast: Math.round(coastDistance(p, rule)) });
        spawn(p);
    }
}

export function createAllUnits() {
    createIslets(10); createObstacles();
    for (let i = 0; i < numEnemies; i++) spawnSingleEnemy();
    place('carrierGroup', numCarrierGroups, p => spawnCarrierStrikeGroup(p.x, p.z));
    place('destroyerSquadron', numDestroyerSquadrons, p => spawnDestroyerSquadron(p.x, p.z));
    place('airbase', numAirbases, p => spawnAirbase(p.x, p.z, p.islet));
    place('forwardBase', numForwardBases, p => spawnForwardBase(p.x, p.z, p.islet));
    spawnCollectibleChains(numCollectibleChains);
    spawnHoopChains(numHoopChains);
    // Spawn challenge tubes (cyan, one-pass with orb ratio scoring) and free tubes (orange, open entry)
    for (let _ti = 0; _ti < 3; _ti++) { spawnTube(randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), randomRange(groundLevel + 55, ceilingLevel - 55), randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), 'challenge'); }
    for (let _ti = 0; _ti < 3; _ti++) { spawnTube(randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), randomRange(groundLevel + 55, ceilingLevel - 55), randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), 'free'); }
    const sz2_100 = 400 * 400;
    for (let i = 0; i < numHoverWings; i++) { const p = { x: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), z: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8) }; if (p.x * p.x + p.z * p.z < sz2_100) { p.x += 500; p.z += 500; } spawnHoverWing(p.x, p.z); }
    for (let i = 0; i < numStrikeWings; i++) { const p = { x: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), z: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8) }; if (p.x * p.x + p.z * p.z < sz2_100) { p.x -= 500; p.z -= 500; } spawnStrikeWing(p.x, p.z); }
}
