/** Base and fleet spawners (airbases, forward bases, carrier groups, destroyer squadrons). */
import { groundLevel, waterLevel } from '../config.js';
import { state } from '../state.js';
import { scene } from '../core/scene.js';
import { randomRange } from '../core/utils.js';
import { clampToIslet, getNearestIslet, isOnAnyIslet } from '../world/world.js';
import { baseMarkers, basesById, groundUnits } from './registry.js';
import { aibaseLetters, fleetNames, forwardBaseNames, squadronNames } from './names.js';
import { updateUnitLabel } from '../ui/labels.js';
import { createGroundUnit, createHangar } from './groundUnits.js';
import { _searchlights } from './fences.js';
import { createVirtualLight } from '../effects/lightBudget.js';

// Shared base finalisation — avoids repetition in every spawner (§3.3)
export function finaliseBase(bm, startIdx, arr, bonusXp) {
    bm.units = arr.slice(startIdx);
    bm.units.forEach(u => {
        if (u.userData) u.userData.baseId = bm.id;
        if ('baseId' in u) { u.baseId = bm.id; if (u.userData) u.userData.baseId = bm.id; }
    });
    bm.total = bm.alive = bm.units.length;
    bm.bonusXp = bonusXp;
}

// --- Fleet & Base Spawners ---
export function spawnCarrierStrikeGroup(cx, cz) {
    const startIdx = groundUnits.length;
    const bm = { id: THREE.MathUtils.generateUUID(), position: new THREE.Vector3(cx, waterLevel, cz), name: `Fleet ${fleetNames[state.fleetIdx++ % fleetNames.length]}`, isHostile: true, units: [], alive: 0, total: 0, bonusXp: 0, eliminated: false };
    baseMarkers.push(bm); basesById[bm.id] = bm;
    const carrier = createGroundUnit('carrier'); carrier.position.set(cx, carrier.position.y, cz); carrier.rotation.y = Math.random() * Math.PI * 2;
    groundUnits.push(carrier); scene.add(carrier);
    carrier.userData.label.name = bm.name; updateUnitLabel(carrier.userData.label, carrier.userData.hp);
    const escorts = ~~randomRange(3, 5);
    for (let i = 0; i < escorts; i++) {
        let a = (i / escorts) * Math.PI * 2, ex, ez, tries = 0;
        do { const dist = randomRange(200, 320); ex = cx + Math.cos(a) * dist; ez = cz + Math.sin(a) * dist; a += 0.3; } while (isOnAnyIslet(ex, ez) && ++tries < 12);
        const ship = createGroundUnit('destroyer'); ship.position.set(ex, ship.position.y, ez); ship.rotation.y = a + Math.PI / 2;
        groundUnits.push(ship); scene.add(ship);
    }
    const nearIsl = getNearestIslet(cx, cz);
    if (nearIsl) {
        const heading = Math.random() * Math.PI * 2, cos = Math.cos(heading), sin = Math.sin(heading);
        const numH = ~~randomRange(2, 4);
        for (let i = 0; i < numH; i++) {
            const off = (i - (numH - 1) / 2) * 55;
            const tp = clampToIslet(nearIsl.x + cos * off, nearIsl.z + sin * off, nearIsl);
            const h = createHangar('arch'); h.position.x = tp.x; h.position.z = tp.z; h.rotation.y = heading;
            groundUnits.push(h); scene.add(h);
        }
    }
    finaliseBase(bm, startIdx, groundUnits, 400);
}
export function spawnDestroyerSquadron(cx, cz) {
    const startIdx = groundUnits.length;
    const bm = { id: THREE.MathUtils.generateUUID(), position: new THREE.Vector3(cx, waterLevel, cz), name: `Squadron ${squadronNames[state.squadronIdx++ % squadronNames.length]}`, isHostile: true, units: [], alive: 0, total: 0, bonusXp: 0, eliminated: false };
    baseMarkers.push(bm); basesById[bm.id] = bm;
    const count = ~~randomRange(2, 4), heading = Math.random() * Math.PI * 2, pa = heading + Math.PI / 2;
    for (let i = 0; i < count; i++) {
        let off = (i - (count - 1) / 2) * 150, sx = cx + Math.cos(pa) * off, sz = cz + Math.sin(pa) * off, tries = 0;
        while (isOnAnyIslet(sx, sz) && ++tries < 12) { off += 30; sx = cx + Math.cos(pa) * off; sz = cz + Math.sin(pa) * off; }
        const ship = createGroundUnit('destroyer'); ship.position.set(sx, ship.position.y, sz); ship.rotation.y = heading;
        groundUnits.push(ship); scene.add(ship);
    }
    finaliseBase(bm, startIdx, groundUnits, 150);
}
export function spawnAirbase(cx, cz, islet) {
    const startIdx = groundUnits.length;
    const abName = `Airbase ${aibaseLetters[state.aibaseIdx++ % aibaseLetters.length]}`;
    const bm = { id: THREE.MathUtils.generateUUID(), position: new THREE.Vector3(cx, groundLevel + 2, cz), name: abName, isHostile: false, units: [], alive: 0, total: 0, bonusXp: 0, eliminated: false };
    baseMarkers.push(bm); basesById[bm.id] = bm;
    const airport = createGroundUnit('airport'); const heading = Math.random() > .5 ? 0 : Math.PI / 2;
    airport.position.x = cx; airport.position.z = cz; airport.rotation.y = heading;
    groundUnits.push(airport); scene.add(airport);
    airport.userData.label.name = abName; updateUnitLabel(airport.userData.label, airport.userData.hp);
    // Searchlight on control tower (local pos 25, 34, -25 rotated by heading)
    const _cth = Math.cos(heading), _sth = Math.sin(heading);
    const _slTx = cx + 25 * _cth - (-25) * _sth, _slTy = groundLevel + 38, _slTz = cz + 25 * (-_sth) + (-25) * _cth;
    const _slAb = createVirtualLight(0xffffaa, 1.5, 200, _slTx, _slTy, _slTz); // lit via the light budget
    const _slAbInitA = Math.random() * Math.PI * 2;
    _searchlights.push({ spot: _slAb, worldPos: new THREE.Vector3(_slTx, _slTy, _slTz),
        angle: _slAbInitA, speed: (0.003 + Math.random() * 0.003) * (Math.random() > 0.5 ? 1 : -1),
        range: 140, halfAngle: Math.PI / 8, baseIds: [bm.id] });
    bm._spotLight = _slAb; // reference for cleanup on base elimination
    const runX = Math.sin(heading), runZ = Math.cos(heading), perpX = Math.cos(heading), perpZ = -Math.sin(heading);
    const side = Math.random() > .5 ? 1 : -1, numHangars = ~~randomRange(3, 6);
    for (let i = 0; i < numHangars; i++) {
        const along = (i - (numHangars - 1) / 2) * 55;
        const tp = clampToIslet(cx + perpX * side * 65 + runX * along, cz + perpZ * side * 65 + runZ * along, islet);
        const h = createHangar(i % 2 === 0 ? 'arch' : 'box'); h.position.x = tp.x; h.position.z = tp.z; h.rotation.y = heading;
        groundUnits.push(h); scene.add(h);
    }
    const numDef = ~~randomRange(3, 6);
    for (let i = 0; i < numDef; i++) {
        const a = (i / numDef) * Math.PI * 2, dist = randomRange(100, 180);
        const tp = clampToIslet(cx + Math.cos(a) * dist, cz + Math.sin(a) * dist, islet);
        const tank = createGroundUnit('tank'); tank.position.set(tp.x, tank.position.y, tp.z); tank.rotation.y = a + Math.PI;
        groundUnits.push(tank); scene.add(tank);
    }
    const numLog = ~~randomRange(3, 5);
    for (let i = 0; i < numLog; i++) {
        const tp = clampToIslet(cx + randomRange(-60, 60), cz + randomRange(-60, 60), islet);
        const truck = createGroundUnit('truck'); truck.position.set(tp.x, truck.position.y, tp.z); truck.rotation.y = Math.random() * Math.PI * 2;
        groundUnits.push(truck); scene.add(truck);
    }
    finaliseBase(bm, startIdx, groundUnits, 500);
}
export function spawnForwardBase(cx, cz, islet) {
    const startIdx = groundUnits.length;
    const bm = { id: THREE.MathUtils.generateUUID(), position: new THREE.Vector3(cx, groundLevel + 2, cz), name: `Forward Base ${forwardBaseNames[state.forwardBaseIdx++ % forwardBaseNames.length]}`, isHostile: true, units: [], alive: 0, total: 0, bonusXp: 0, eliminated: false };
    baseMarkers.push(bm); basesById[bm.id] = bm;
    const heading = Math.random() * Math.PI * 2, cos = Math.cos(heading), sin = Math.sin(heading);
    const pcos = Math.cos(heading + Math.PI / 2), psin = Math.sin(heading + Math.PI / 2);
    const numTanks = ~~randomRange(3, 6);
    for (let i = 0; i < numTanks; i++) {
        const col = i % 3 - 1, row = ~~(i / 3);
        const tp = clampToIslet(cx + pcos * col * 45 + cos * row * 45, cz + psin * col * 45 + sin * row * 45, islet);
        const tank = createGroundUnit('tank'); tank.position.set(tp.x, tank.position.y, tp.z); tank.rotation.y = heading + randomRange(-0.25, 0.25);
        groundUnits.push(tank); scene.add(tank);
    }
    const numTrucks = ~~randomRange(2, 4);
    for (let i = 0; i < numTrucks; i++) {
        const tp = clampToIslet(cx - cos * randomRange(40, 90) + pcos * randomRange(-40, 40), cz - sin * randomRange(40, 90) + psin * randomRange(-40, 40), islet);
        const truck = createGroundUnit('truck'); truck.position.set(tp.x, truck.position.y, tp.z); truck.rotation.y = Math.random() * Math.PI * 2;
        groundUnits.push(truck); scene.add(truck);
    }
    const numH = ~~randomRange(1, 3);
    for (let i = 0; i < numH; i++) {
        const off = (i - (numH - 1) / 2) * 55;
        const tp = clampToIslet(cx - cos * 110 + pcos * off, cz - sin * 110 + psin * off, islet);
        const h = createHangar(i % 2 === 0 ? 'arch' : 'box'); h.position.x = tp.x; h.position.z = tp.z; h.rotation.y = heading;
        groundUnits.push(h); scene.add(h);
    }
    finaliseBase(bm, startIdx, groundUnits, 250);
}
