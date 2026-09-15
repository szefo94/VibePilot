/** Ground/sea unit models (tanks, trucks, turrets, ships, airports) and their destruction. */
import { groundLevel, hostileUnitShootingCooldownTime, waterLevel } from '../config.js';
import { state } from '../state.js';
import { scene } from '../core/scene.js';
import { markShared, randomRange } from '../core/utils.js';
import { scoreElement } from '../ui/dom.js';
import { groundUnits } from './registry.js';
import { _dyingGround, createExplosion } from '../effects/effects.js';
import { createUnitLabel, destroyLabel } from '../ui/labels.js';
import { notifyBase } from '../ui/notifications.js';
import { awardKill } from '../game/progression.js';
import { groundUnitWorldPos, refreshGroundUnitWorldPos } from '../combat/damage.js';

// --- Unit Creation & Spawning ---
// Pre-baked tank part geometries
const _tankLowerHullGeo = markShared(new THREE.BoxGeometry(4.4, 0.8, 5.5));
const _tankUpperHullGeo = markShared(new THREE.BoxGeometry(3.5, 0.65, 4.8));
const _tankTrackGeo     = markShared(new THREE.BoxGeometry(0.55, 0.65, 5.9));
const _tankTurretGeo    = markShared(new THREE.CylinderGeometry(1.3, 1.55, 0.7, 8));
const _tankHatchGeo     = markShared(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 8));
const _tankBarrelGeo    = markShared((() => { const g = new THREE.CylinderGeometry(0.18, 0.28, 4.8, 8); g.rotateX(Math.PI / 2); g.translate(0, 0, 2.4); return g; })());
// Pre-baked truck part geometries (shared across all truck instances)
const _truckChassisGeo    = markShared(new THREE.BoxGeometry(1.8, 0.25, 6.5));
const _truckHoodGeo       = markShared(new THREE.BoxGeometry(1.6, 0.75, 1.4));
const _truckCabGeo        = markShared(new THREE.BoxGeometry(1.75, 1.4, 2.0));
const _truckCargoFloorGeo = markShared(new THREE.BoxGeometry(1.75, 0.15, 3.2));
const _truckCargoSideGeo  = markShared(new THREE.BoxGeometry(0.1,  0.7,  3.2));
const _truckCargoWallGeo  = markShared(new THREE.BoxGeometry(1.75, 0.7,  0.1));
const _truckWheelGeo      = markShared((() => { const g = new THREE.CylinderGeometry(0.45, 0.45, 0.22, 8); g.rotateZ(Math.PI / 2); return g; })());
export function createGroundUnit(type) {
    const u = new THREE.Group();
    let hp, collR, hpY, xp, n, turretPivotRef = null, barrelPivotRef = null, hostile = false, l = 1;
    const UNIT_MAT_COLORS = { tank: 4957216, truck: 8388608, airport: 6710886, destroyer: 5592422, carrier: 4473925, turret: 3355443 };
    const unitMat = new THREE.MeshStandardMaterial({ color: UNIT_MAT_COLORS[type] }); // one material per call, not 6
    switch (type) {
        case 'tank':
            n = "Tank"; l = ~~randomRange(1, 4); hp = 20 * l; collR = 3.5 * 3; hpY = 1.5 * 3 + 5; xp = 35 * l; hostile = true;
            u.position.y = groundLevel + 2 + 1.5 * 3 / 2;
            {
                const lowerHull = new THREE.Mesh(_tankLowerHullGeo, unitMat);
                const upperHull = new THREE.Mesh(_tankUpperHullGeo, unitMat); upperHull.position.y = 0.72;
                const trackL    = new THREE.Mesh(_tankTrackGeo, unitMat); trackL.position.set(-2.5, -0.02, 0);
                const trackR    = new THREE.Mesh(_tankTrackGeo, unitMat); trackR.position.set( 2.5, -0.02, 0);
                u.add(lowerHull, upperHull, trackL, trackR);
                const tp = new THREE.Group(); tp.position.y = 1.38;
                const hatch = new THREE.Mesh(_tankHatchGeo, unitMat); hatch.position.set(-0.25, 0.46, -0.2);
                const bp = new THREE.Group();
                bp.add(new THREE.Mesh(_tankBarrelGeo, unitMat));
                tp.add(new THREE.Mesh(_tankTurretGeo, unitMat), hatch, bp);
                u.add(tp); turretPivotRef = tp; barrelPivotRef = bp;
            }
            u.scale.set(3, 3, 3); break;
        case 'turret':
            n = "Turret"; l = ~~randomRange(2, 5); hp = 15 * l; collR = 2.5 * 3; hpY = 1.5 * 3 + 5; xp = 30 * l; hostile = true;
            u.position.y = groundLevel + 2 + 1.5 * 3 / 2;
            u.add(new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, 4), unitMat));
            { const tp = new THREE.Group(); tp.position.y = 1.25;
              const bp = new THREE.Group(); const tb = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, 4, 12), unitMat); tb.position.set(0, 0, 2); tb.rotation.x = Math.PI / 2; bp.add(tb);
              tp.add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), unitMat), bp); u.add(tp); turretPivotRef = tp; barrelPivotRef = bp; }
            u.scale.set(3, 3, 3); break;
        case 'truck':
            n = "Truck"; l = 1; hp = 5; collR = 3 * 2.5; hpY = 2 * 2.5 + 4; xp = 10;
            u.position.y = groundLevel + 2 + 2 * 2.5 / 2;
            { // --- truck body ---
                const chassis    = new THREE.Mesh(_truckChassisGeo,    unitMat);
                const hood       = new THREE.Mesh(_truckHoodGeo,       unitMat); hood.position.set(0, 0.5,  2.8);
                const cab        = new THREE.Mesh(_truckCabGeo,        unitMat); cab.position.set( 0, 0.95, 1.2);
                const cargoFloor = new THREE.Mesh(_truckCargoFloorGeo, unitMat); cargoFloor.position.set(0, 0.2, -1.4);
                const cargoL     = new THREE.Mesh(_truckCargoSideGeo,  unitMat); cargoL.position.set(-0.85, 0.55, -1.4);
                const cargoR     = new THREE.Mesh(_truckCargoSideGeo,  unitMat); cargoR.position.set( 0.85, 0.55, -1.4);
                const cargoFront = new THREE.Mesh(_truckCargoWallGeo,  unitMat); cargoFront.position.set(0, 0.55,  0.25);
                const cargoTail  = new THREE.Mesh(_truckCargoWallGeo,  unitMat); cargoTail.position.set( 0, 0.55, -3.05);
                const wFL = new THREE.Mesh(_truckWheelGeo, unitMat); wFL.position.set(-1.05, 0,  2.5);
                const wFR = new THREE.Mesh(_truckWheelGeo, unitMat); wFR.position.set( 1.05, 0,  2.5);
                const wRL = new THREE.Mesh(_truckWheelGeo, unitMat); wRL.position.set(-1.05, 0, -1.8);
                const wRR = new THREE.Mesh(_truckWheelGeo, unitMat); wRR.position.set( 1.05, 0, -1.8);
                u.add(chassis, hood, cab, cargoFloor, cargoL, cargoR, cargoFront, cargoTail, wFL, wFR, wRL, wRR);
            }
            u.scale.set(2.5, 2.5, 2.5); break;
        case 'airport': {
            n = "Airbase"; l = 5; hp = 150; collR = 100; hpY = 25; xp = 200; u.position.y = groundLevel + 2;
            const runway = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 200), unitMat);
            const mainBuilding = new THREE.Mesh(new THREE.BoxGeometry(10, 20, 10), unitMat); mainBuilding.position.set(25, 10, 0);
            const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 30, 8), unitMat); towerBase.position.set(25, 15, -25);
            const towerCab = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 10), new THREE.MeshStandardMaterial({ color: 0x87CEEB, transparent: true, opacity: 0.5 }));
            towerCab.position.set(25, 34, -25);
            u.add(runway, mainBuilding, towerBase, towerCab);
            const t1 = createGroundUnit('turret'); t1.position.set(30, 0, 60); t1.userData.protector = u; u.add(t1); groundUnits.push(t1);
            const t2 = createGroundUnit('turret'); t2.position.set(-30, 0, -60); t2.userData.protector = u; u.add(t2); groundUnits.push(t2);
            break;
        }
        case 'destroyer':
            n = "Destroyer"; l = ~~randomRange(3, 6); hp = 40 * l; collR = 10 * 5; hpY = 4 * 5; xp = 75 * l; hostile = true; u.position.y = waterLevel;
            u.add(new THREE.Mesh(new THREE.BoxGeometry(3, 2, 20), unitMat), new THREE.Mesh(new THREE.BoxGeometry(2.5, 2, 4), unitMat));
            u.children[1].position.set(0, 2, -2);
            { const tp = new THREE.Group(); tp.position.set(0, 1.5, 5);
              const bp = new THREE.Group(); const tb = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, 4, 8), unitMat); tb.position.set(0, 0, 2); tb.rotation.x = Math.PI / 2; bp.add(tb);
              tp.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 1.5), unitMat), bp); u.add(tp); turretPivotRef = tp; barrelPivotRef = bp; }
            u.scale.set(5, 5, 5); break;
        case 'carrier':
            n = "Carrier"; l = 10; hp = 200; collR = 18 * 8; hpY = 6 * 8; xp = 300; u.position.y = waterLevel;
            u.add(new THREE.Mesh(new THREE.BoxGeometry(8, 3, 35), unitMat), new THREE.Mesh(new THREE.BoxGeometry(12, .5, 32), unitMat), new THREE.Mesh(new THREE.BoxGeometry(2, 3, 6), unitMat));
            u.children[1].position.y = 1.75; u.children[2].position.set(5, 3.5, -2); u.scale.set(8, 8, 8); break;
    }
    const label = createUnitLabel(n, l, hp, hp); scene.add(label.sprite);
    u.userData = { type, hp, maxHp: hp, collisionRadius: collR, label, hpOffsetY: hpY, isHostile: hostile, shootCooldown: hostile ? Math.random() * hostileUnitShootingCooldownTime : 0, xpValue: xp, id: THREE.MathUtils.generateUUID(), partBoxes: null, turretPivot: turretPivotRef, barrelPivot: barrelPivotRef, dependents: [] };
    // Populate dependents for units with protected children (§2.5)
    for (const child of u.children) { if (child.userData?.type === 'turret') u.userData.dependents.push(child); }
    return u;
}
export function createHangar(variant = 'box') {
    const u = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7 });
    if (variant === 'arch') {
        const r = 12, len = 44;
        const archGeo = new THREE.CylinderGeometry(r, r, len, 16, 1, true, -Math.PI / 2, Math.PI);
        archGeo.rotateX(-Math.PI / 2);
        u.add(new THREE.Mesh(archGeo, mat));
        const backWall = new THREE.Mesh(new THREE.BoxGeometry(r * 2, r, 0.8), mat); backWall.position.set(0, r / 2, -len / 2);
        const frontWall = new THREE.Mesh(new THREE.BoxGeometry(r * 2, r, 0.8), mat); frontWall.position.set(0, r / 2, len / 2);
        u.add(backWall, frontWall);
    } else {
        const base = new THREE.Mesh(new THREE.BoxGeometry(28, 1, 44), mat); base.position.y = 0.5;
        const walls = new THREE.Mesh(new THREE.BoxGeometry(24, 10, 40), mat); walls.position.y = 6;
        const roof = new THREE.Mesh(new THREE.BoxGeometry(26, 3, 42), mat); roof.position.y = 12.5;
        u.add(base, walls, roof);
    }
    u.position.y = groundLevel + 2;
    const hp = 200, n = 'Hangar', l = 3, xpVal = 150;
    const label = createUnitLabel(n, l, hp, hp); scene.add(label.sprite);
    u.userData = { type: 'hangar', hp, maxHp: hp, collisionRadius: 30, label, hpOffsetY: 20, isHostile: false, bombOnly: true, shootCooldown: 0, xpValue: xpVal, id: THREE.MathUtils.generateUUID(), partBoxes: null };
    return u;
}
// (§2.3) Centralised ground-unit death — called by combat/hits.js for every weapon
export function killGroundUnit(gu, { reward = true } = {}) {
    if (!gu.userData._alive) return; // double-kill guard
    gu.userData._alive = false;
    // Dependents (airport turrets) are exposed, not destroyed: move them into the world keeping their
    // world transform, so the parent's disposal doesn't take them along, and drop their protection.
    if (gu.userData.dependents?.length) {
        for (const dep of gu.userData.dependents) {
            scene.attach(dep);
            dep.userData.protector = null;
            refreshGroundUnitWorldPos(dep);
        }
        gu.userData.dependents.length = 0;
    }
    createExplosion(groundUnitWorldPos(gu));
    destroyLabel(gu.userData.label);
    // Don't dispose immediately — blink animation (idea 5); dispose happens in updateEffects
    const ui = groundUnits.indexOf(gu); if (ui > -1) groundUnits.splice(ui, 1);
    if (reward) awardKill(gu.userData.xpValue);
    notifyBase(gu.userData.baseId);
    _dyingGround.push({ mesh: gu, timer: 50 });
}
