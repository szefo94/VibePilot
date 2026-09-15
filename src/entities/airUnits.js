/** Air unit visuals, factory, squadron spawners, interceptor waves and legacy fighters. */
import { MAP_BOUNDARY, ceilingLevel, defaultEnemyHpOffsetY, enemyColors, enemyPartHP, enemyScale, enemySpeed, groundLevel, hostileUnitShootingCooldownTime } from '../config.js';
import { state } from '../state.js';
import { scene } from '../core/scene.js';
import { randomRange } from '../core/utils.js';
import { _sv1 } from '../core/scratch.js';
import { plane } from '../player/plane.js';
import { airUnits, baseMarkers, basesById, enemies } from './registry.js';
import { hoverWingNames, strikeWingNames } from './names.js';
import { _dyingAirUnits, _dyingEnemies, createExplosion } from '../effects/effects.js';
import { createUnitLabel, destroyLabel } from '../ui/labels.js';
import { notifyBase } from '../ui/notifications.js';
import { awardKill } from '../game/progression.js';
import { finaliseBase } from './bases.js';

// --- Airborne Unit Visuals ---
function createHelicopterVisual() {
    const outer = new THREE.Group(), g = new THREE.Group();
    g.rotation.y = -Math.PI / 2;
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a5240, roughness: 0.7 });
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2, 10, 8), mat); fuselage.rotation.x = Math.PI / 2;
    const rotorA = new THREE.Mesh(new THREE.BoxGeometry(18, 0.3, 1.2), mat); rotorA.position.y = 2.2; rotorA.userData.spinY = 0.18;
    const rotorB = new THREE.Mesh(new THREE.BoxGeometry(18, 0.3, 1.2), mat); rotorB.position.y = 2.2; rotorB.rotation.y = Math.PI / 2; rotorB.userData.spinY = 0.18;
    const tailBoom = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 8), mat); tailBoom.position.set(0, -0.3, -7);
    const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 0.8), mat); tailRotor.position.set(0, 0, -11); tailRotor.rotation.z = Math.PI / 2; tailRotor.userData.spinZ = 0.25;
    g.add(fuselage, rotorA, rotorB, tailBoom, tailRotor); outer.add(g); return outer;
}
function createBalloonVisual() {
    const g = new THREE.Group();
    const envelopeMat = new THREE.MeshStandardMaterial({ color: 0xdde8f0, roughness: 0.4 });
    const gondolaMat = new THREE.MeshStandardMaterial({ color: 0x8a7050, roughness: 0.7 });
    const envelope = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 8), envelopeMat); envelope.position.y = 9;
    const gondola = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 3), gondolaMat); gondola.position.y = -1;
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 10, 4), gondolaMat); cable.position.y = 4;
    g.add(envelope, cable, gondola); return g;
}
function createFighterVisual() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1c4e80, roughness: 0.5 });
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 16, 8), mat); fuselage.rotation.x = Math.PI / 2;
    const wings = new THREE.Mesh(new THREE.BoxGeometry(22, 0.4, 7), mat);
    const vTail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 4), mat); vTail.position.set(0, 2.5, -7);
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.8, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat); cockpit.position.set(0, 1.2, 3);
    g.add(fuselage, wings, vTail, cockpit); return g;
}
function createTankerVisual() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4 });
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 32, 10), mat); fuselage.rotation.x = Math.PI / 2;
    const wings = new THREE.Mesh(new THREE.BoxGeometry(50, 1.2, 12), mat);
    const vTail = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 6), mat); vTail.position.set(0, 5, -15);
    const hTail = new THREE.Mesh(new THREE.BoxGeometry(20, 0.8, 5), mat); hTail.position.set(0, 3, -14);
    const eng = ox => { const e = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 6, 8), mat); e.rotation.z = Math.PI / 2; e.position.set(ox, -2.5, 2); return e; };
    g.add(fuselage, wings, vTail, hTail, eng(-10), eng(-6), eng(6), eng(10)); return g;
}
function createAC130Visual() {
    const outer = new THREE.Group(), g = new THREE.Group();
    g.rotation.y = -Math.PI / 2;
    const mat = new THREE.MeshStandardMaterial({ color: 0x3d3d2e, roughness: 0.8 });
    const fuselage = new THREE.Mesh(new THREE.BoxGeometry(32, 8, 10), mat); fuselage.rotation.y = Math.PI / 2;
    const wings = new THREE.Mesh(new THREE.BoxGeometry(55, 1.5, 13), mat); wings.position.y = -1;
    const vTail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 12, 6), mat); vTail.position.set(0, 6, -14);
    const hTail = new THREE.Mesh(new THREE.BoxGeometry(22, 1, 6), mat); hTail.position.set(0, 4, -13);
    const eng = ox => { const e = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 7, 8), mat); e.rotation.z = Math.PI / 2; e.position.set(ox, -3, 2); return e; };
    g.add(fuselage, wings, vTail, hTail, eng(-12), eng(-7), eng(7), eng(12)); outer.add(g); return outer;
}

// --- Air Unit Factory & Destruction ---
function createAirUnit(type, x, y, z) {
    let visual, hp, collR, xp, hostile, name, level = 1;
    switch (type) {
        // collR is fuselage/body sphere; all models are scaled 3× so local units × 3 = world units
        case 'helicopter': visual = createHelicopterVisual(); hp = 60;  collR = 15; xp = 80;  hostile = true;  name = 'Helicopter'; break;
        case 'balloon':    visual = createBalloonVisual();    hp = 15;  collR = 21; xp = 40;  hostile = false; name = 'Balloon';    break;
        case 'fighter':    visual = createFighterVisual();    hp = 40;  collR = 14; xp = 100; hostile = true;  name = 'Fighter';    level = ~~randomRange(1, 3); hp *= level; xp *= level; break;
        case 'tanker':     visual = createTankerVisual();     hp = 200; collR = 15; xp = 200; hostile = false; name = 'Tanker';     break;
        case 'ac130':      visual = createAC130Visual();      hp = 150; collR = 20; xp = 250; hostile = true;  name = 'AC-130';     break;
    }
    visual.position.set(x, y, z); visual.scale.set(3, 3, 3); scene.add(visual);
    const label = createUnitLabel(name, level, hp, hp); scene.add(label.sprite);
    const au = { id: THREE.MathUtils.generateUUID(), type, group: visual, hp, maxHp: hp, collisionRadius: collR, xpValue: xp, isHostile: hostile, baseId: null, label, shootCooldown: hostile ? Math.random() * hostileUnitShootingCooldownTime : 0, userData: { hp, baseId: null } };
    // Wing/rotor sub-sphere colliders (worldUnits = local × scale 3)
    // wingType 'q' = quaternion right (fighter/tanker use lookAt), 'z' = outer-Z direction (orbit types with inner g rotated -PI/2)
    if (type === 'helicopter') { au.wingHalfSpan = 25; au.wingR = 10; au.wingType = 'z'; } // rotor disc ±25 along outer Z
    if (type === 'fighter')    { au.wingHalfSpan = 28; au.wingR = 10; au.wingType = 'q'; } // wing tips ±28 along group right
    if (type === 'tanker')     { au.wingHalfSpan = 65; au.wingR = 13; au.wingType = 'q'; } // wide airliner wings
    if (type === 'ac130')      { au.wingHalfSpan = 70; au.wingR = 14; au.wingType = 'z'; } // gunship wings ±70 along outer Z
    return au;
}
export function destroyAirUnit(au, { reward = true } = {}) {
    const idx = airUnits.indexOf(au);
    if (idx < 0) return; // already removed
    createExplosion(au.group.position);
    // Don't dispose immediately — blink animation (idea 5)
    destroyLabel(au.label);
    airUnits.splice(idx, 1);
    if (reward) awardKill(au.xpValue);
    notifyBase(au.userData.baseId);
    _dyingAirUnits.push({ group: au.group, timer: 50 });
}

// --- Airborne Squadron Spawners ---
export function spawnHoverWing(cx, cz) {
    const startIdx = airUnits.length;
    const name = `Hover Wing ${hoverWingNames[state.hoverWingIdx++ % hoverWingNames.length]}`;
    const bm = { id: THREE.MathUtils.generateUUID(), position: new THREE.Vector3(cx, groundLevel + 80, cz), name, isHostile: true, units: [], alive: 0, total: 0, bonusXp: 350, eliminated: false };
    baseMarkers.push(bm); basesById[bm.id] = bm;
    const numHeli = 2 + ~~(Math.random() * 2), numBall = 1 + ~~(Math.random() * 2);
    for (let i = 0; i < numHeli; i++) {
        const ox = randomRange(-150, 150), oz = randomRange(-150, 150), y = randomRange(groundLevel + 90, groundLevel + 120);
        const au = createAirUnit('helicopter', cx + ox, y, cz + oz);
        au.orbitCenter = new THREE.Vector3(cx + ox, y, cz + oz);
        au.orbitAngle = Math.random() * Math.PI * 2;
        au.orbitRadius = randomRange(50, 120);
        au.orbitSpeed = randomRange(0.003, 0.006) * (Math.random() > 0.5 ? 1 : -1);
        au.orbitAltitude = y; airUnits.push(au);
    }
    for (let i = 0; i < numBall; i++) {
        const ox = randomRange(-200, 200), oz = randomRange(-200, 200), y = randomRange(groundLevel + 120, groundLevel + 150);
        airUnits.push(createAirUnit('balloon', cx + ox, y, cz + oz));
    }
    finaliseBase(bm, startIdx, airUnits, 350);
}
export function spawnStrikeWing(cx, cz) {
    const startIdx = airUnits.length;
    const name = `Strike Wing ${strikeWingNames[state.strikeWingIdx++ % strikeWingNames.length]}`;
    const bm = { id: THREE.MathUtils.generateUUID(), position: new THREE.Vector3(cx, groundLevel + 80, cz), name, isHostile: true, units: [], alive: 0, total: 0, bonusXp: 500, eliminated: false };
    baseMarkers.push(bm); basesById[bm.id] = bm;
    const numFighters = 2 + ~~(Math.random() * 2);
    for (let i = 0; i < numFighters; i++) {
        const ox = randomRange(-200, 200), oz = randomRange(-200, 200), y = randomRange(groundLevel + 100, groundLevel + 160);
        const au = createAirUnit('fighter', cx + ox, y, cz + oz);
        const speed = randomRange(0.10, 0.14), angle = Math.random() * Math.PI * 2;
        au.velocity = new THREE.Vector3(Math.sin(angle) * speed, 0, Math.cos(angle) * speed);
        airUnits.push(au);
    }
    if (Math.random() > 0.4) {
        const ox = randomRange(-250, 250), oz = randomRange(-250, 250), y = randomRange(groundLevel + 140, groundLevel + 180);
        const au = createAirUnit('tanker', cx + ox, y, cz + oz);
        const speed = randomRange(0.03, 0.05), angle = Math.random() * Math.PI * 2;
        au.velocity = new THREE.Vector3(Math.sin(angle) * speed, 0, Math.cos(angle) * speed);
        airUnits.push(au);
    }
    if (Math.random() > 0.5) {
        const ox = randomRange(-300, 300), oz = randomRange(-300, 300), y = randomRange(groundLevel + 110, groundLevel + 150);
        const au = createAirUnit('ac130', cx + ox, y, cz + oz);
        au.orbitCenter = new THREE.Vector3(cx + ox, y, cz + oz);
        au.orbitAngle = Math.random() * Math.PI * 2;
        au.orbitRadius = randomRange(200, 300);
        au.orbitSpeed = randomRange(0.001, 0.003) * (Math.random() > 0.5 ? 1 : -1);
        au.orbitAltitude = y; airUnits.push(au);
    }
    finaliseBase(bm, startIdx, airUnits, 500);
}
export function spawnInterceptors() {
    state._interceptorWave++;
    const count = Math.min(2 + state._interceptorWave, 6); // 3, 4, 5, 6 … cap at 6
    const warnEl = document.createElement('div');
    warnEl.style.cssText = 'position:fixed;top:22%;left:50%;transform:translateX(-50%);color:#ff4455;font:bold 18px monospace;letter-spacing:3px;z-index:500;pointer-events:none;text-shadow:0 0 12px #ff0000;';
    warnEl.textContent = `⚠ INTERCEPTORS INBOUND — WAVE ${state._interceptorWave} (${count} fighters)`;
    document.body.appendChild(warnEl);
    setTimeout(() => warnEl.remove(), 4000);
    for (let _ii = 0; _ii < count; _ii++) {
        // Spawn from a random map-edge position, well above ground
        const _iedge = Math.random() * Math.PI * 2;
        const _iex = Math.cos(_iedge) * MAP_BOUNDARY * 0.88;
        const _iez = Math.sin(_iedge) * MAP_BOUNDARY * 0.88;
        const _iey = randomRange(groundLevel + 80, groundLevel + 200);
        const au = createAirUnit('fighter', _iex, _iey, _iez);
        // Velocity initially toward player with slight spread
        const _ispd = randomRange(0.16, 0.22 + state._interceptorWave * 0.01);
        _sv1.copy(plane.position).sub(au.group.position);
        _sv1.y = 0; _sv1.normalize().multiplyScalar(_ispd);
        _sv1.x += (Math.random() - 0.5) * 0.05;
        _sv1.z += (Math.random() - 0.5) * 0.05;
        au.velocity = _sv1.clone();
        au.isInterceptor = true;
        au.interceptSpeed = _ispd;
        airUnits.push(au);
    }
}
export function spawnSingleEnemy() {
    const l = { id: THREE.MathUtils.generateUUID(), parts: [], velocity: new THREE.Vector3(), label: null, hpOffsetY: defaultEnemyHpOffsetY, type: "unknown", boundingBox: new THREE.Box3(), partLocalBoxes: null };
    const c = enemyColors[~~(Math.random() * enemyColors.length)], mat = new THREE.MeshStandardMaterial({ color: c }), lvl = ~~randomRange(1, 4);
    l.parts = [
        new THREE.Mesh(new THREE.CylinderGeometry(.4, .5, 3, 10).rotateX(Math.PI / 2), mat),
        new THREE.Mesh(new THREE.BoxGeometry(5, .2, 1), mat),
        new THREE.Mesh(new THREE.BoxGeometry(5, .2, 1), mat),
        new THREE.Mesh(new THREE.BoxGeometry(.2, 1.5, 1), mat),
    ];
    l.parts[1].position.x = -2.5; l.parts[2].position.x = 2.5; l.parts[3].position.set(0, .5, -1.3);
    const totalHp = Math.min(enemyPartHP * 4 * lvl, 5 * lvl);
    let sX, sZ, sY = randomRange(groundLevel + 20 + l.hpOffsetY, ceilingLevel - l.hpOffsetY);
    sX = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9); sZ = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9);
    const cP = new THREE.Vector3(sX, sY, sZ);
    // Split the displayed total over the parts (remainder on the fuselage) so label HP equals actual HP
    const perPartHp = Math.floor(totalHp / l.parts.length), extraHp = totalHp - perPartHp * l.parts.length;
    l.parts.forEach((p, pi) => {
        const h = perPartHp + (pi === 0 ? extraHp : 0);
        p.position.add(cP); p.scale.set(enemyScale, enemyScale, enemyScale);
        p.userData = { type: "enemy_part", hp: h, logicalEnemyId: l.id, collisionRadius: enemyScale };
        scene.add(p);
    });
    l.velocity.set(Math.random() > .5 ? enemySpeed : -enemySpeed, 0, Math.random() > .5 ? enemySpeed : -enemySpeed);
    l.label = createUnitLabel("Fighter", lvl, totalHp, totalHp); scene.add(l.label.sprite);
    enemies.push(l);
}
/**
 * Remove a legacy fighter and spawn its replacement. Mutates `enemies` (splice + push),
 * so callers iterating `enemies` must collect ids first and call this after the loop.
 * `reward: false` is used for non-combat removal (e.g. leaving the map): no score, XP or streak.
 */
export function destroyLogicalEnemy(id, { reward = true } = {}) {
    const i = enemies.findIndex(e => e.id === id);
    if (i > -1) {
        const e = enemies[i];
        destroyLabel(e.label);
        enemies.splice(i, 1);
        if (reward) awardKill(25);
        // Defer geometry disposal — blink animation (idea 5)
        _dyingEnemies.push({ parts: e.parts, mat: e.parts.length > 0 ? e.parts[0].material : null, timer: 50 });
        spawnSingleEnemy();
    }
}
