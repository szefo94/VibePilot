/** Ground/sea unit models (tanks, trucks, turrets, ships, airports) and their destruction. */
import { GROUND_UNIT_TYPES, groundLevel, hostileUnitShootingCooldownTime, waterLevel } from '../config.js';
import { scene } from '../core/scene.js';
import { randomRange } from '../core/utils.js';
import { groundUnits } from './registry.js';
import { _dyingGround, createExplosion } from '../effects/effects.js';
import { createUnitLabel, destroyLabel } from '../ui/labels.js';
import { notifyBase } from '../ui/notifications.js';
import { awardKill } from '../game/progression.js';
import { groundUnitWorldPos, refreshGroundUnitWorldPos } from '../combat/damage.js';
import { kitMaterial } from '../core/meshkit.js';
import { onUnitKilled } from '../effects/fire.js';
import { aaBarrelGeo, aaBaseGeo, aaMountGeo, archHangarGeo, boxHangarGeo, carrierGeo, controlTowerGeo, destroyerBarrelGeo, destroyerHullGeo, destroyerTurretGeo, runwayGeo, tankBarrelGeo, tankHullGeo, tankTurretGeo, terminalGeo, truckGeo } from './models.js';

// --- Unit Creation & Spawning ---
// Models: entities/models.js (baked, shared geometries); one kit material per unit, so damage tints stay per unit
export function createGroundUnit(type) {
    const u = new THREE.Group();
    const stats = GROUND_UNIT_TYPES[type]; // config.js
    const l = Array.isArray(stats.level) ? ~~randomRange(stats.level[0], stats.level[1]) : stats.level;
    const hp = stats.perLevel ? stats.hp * l : stats.hp, xp = stats.perLevel ? stats.xp * l : stats.xp;
    let turretPivotRef = null, barrelPivotRef = null;
    const mat = kitMaterial();
    const mesh = geo => new THREE.Mesh(geo, mat);
    /** Turret on a pivot at `y`, barrel on its own pivot inside (ai.js aims both). */
    const turretOn = (at, turretGeo, barrelGeo) => {
        const tp = new THREE.Group(); tp.position.copy(at);
        const bp = new THREE.Group(); bp.add(mesh(barrelGeo));
        tp.add(mesh(turretGeo), bp); u.add(tp); turretPivotRef = tp; barrelPivotRef = bp;
    };
    switch (type) {
        case 'tank':
            u.position.y = groundLevel + 2 + 1.5 * 3 / 2;
            u.add(mesh(tankHullGeo));
            turretOn(new THREE.Vector3(0, 1.38, 0), tankTurretGeo, tankBarrelGeo);
            u.scale.set(3, 3, 3); break;
        case 'turret': // anti-aircraft emplacement
            u.position.y = groundLevel + 2 + 1.5 * 3 / 2;
            u.add(mesh(aaBaseGeo));
            turretOn(new THREE.Vector3(0, 1.25, 0), aaMountGeo, aaBarrelGeo);
            u.scale.set(3, 3, 3); break;
        case 'truck':
            u.position.y = groundLevel + 2 + 2 * 2.5 / 2;
            u.add(mesh(truckGeo));
            u.scale.set(2.5, 2.5, 2.5); break;
        case 'airport': {
            u.position.y = groundLevel + 2;
            u.add(mesh(runwayGeo), mesh(terminalGeo), mesh(controlTowerGeo)); // separate meshes: one collision box each
            const t1 = createGroundUnit('turret'); t1.position.set(30, 0, 60); t1.userData.protector = u; u.add(t1); groundUnits.push(t1);
            const t2 = createGroundUnit('turret'); t2.position.set(-30, 0, -60); t2.userData.protector = u; u.add(t2); groundUnits.push(t2);
            break;
        }
        case 'destroyer':
            u.position.y = waterLevel;
            u.add(mesh(destroyerHullGeo));
            turretOn(new THREE.Vector3(0, 1.5, 5), destroyerTurretGeo, destroyerBarrelGeo);
            u.scale.set(5, 5, 5); break;
        case 'carrier':
            u.position.y = waterLevel;
            u.add(mesh(carrierGeo));
            u.scale.set(8, 8, 8); break;
    }
    const label = createUnitLabel(stats.name, l, hp, hp); scene.add(label.sprite);
    u.userData = { type, hp, maxHp: hp, collisionRadius: stats.collisionRadius, label, hpOffsetY: stats.hpOffsetY, isHostile: stats.hostile, shootCooldown: stats.hostile ? Math.random() * hostileUnitShootingCooldownTime : 0, xpValue: xp, id: THREE.MathUtils.generateUUID(), partBoxes: null, turretPivot: turretPivotRef, barrelPivot: barrelPivotRef, dependents: [] };
    // Populate dependents for units with protected children (§2.5)
    for (const child of u.children) { if (child.userData?.type === 'turret') u.userData.dependents.push(child); }
    return u;
}
export function createHangar(variant = 'box') {
    const u = new THREE.Group();
    u.add(new THREE.Mesh(variant === 'arch' ? archHangarGeo : boxHangarGeo, kitMaterial({ roughness: 0.7 })));
    u.position.y = groundLevel + 2;
    const hp = 200, n = 'Hangar', l = 3, xpVal = 150;
    const label = createUnitLabel(n, l, hp, hp); scene.add(label.sprite);
    u.userData = { type: 'hangar', hp, maxHp: hp, collisionRadius: 30, label, hpOffsetY: 20, isHostile: false, bombOnly: true, shootCooldown: 0, xpValue: xpVal, id: THREE.MathUtils.generateUUID(), partBoxes: null };
    return u;
}
// (§2.3) Centralised ground-unit death — called by combat/hits.js for every weapon
export function killGroundUnit(gu, { reward = true } = {}) {
    if (gu.userData._alive === false) return; // double-kill guard (undefined = alive, not yet visited by the AI)
    gu.userData._alive = false;
    onUnitKilled(gu); // the wreck smoulders (effects/fire.js)
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
