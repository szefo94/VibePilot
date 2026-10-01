/**
 * Freaky mode's giant bosses, one at a time: each the finale of a story arc (game/quests.js); K summons one now.
 *
 *   kaiju   GORGAZON          rises from the sea           atomic breath beam, energy volleys
 *   kraken  KRAKOTH           surfaces from the deep       tentacles burst from the water under you, volleys, squidlings
 *   golem   MAGMAROK          erupts from the volcano      lava bombs, volleys        (on the highest peak)
 *   robot   TITAN-9           awakens in a village         homing missiles, eye laser
 *   alien   SPECIMEN 47       breaks out of a base         acid spray, volleys, facehuggers (a hangar or airbase is lost)
 *   zombot  STAHLMOND ZOMBOT  descends from the Moon       plasma bursts, beam        (flies)
 *
 * A boss is an ordinary hostile air unit in `airUnits` (`isBoss`), so bullets, missiles, bombs, the lock-on and
 * the lead marker work on it; ai.js hands it to updateBoss(). Every attack is telegraphed (glow, a warning line, a
 * ring on the water) and can be dodged. Below half HP it is ENRAGED and attacks faster; after BOSS.life it escapes.
 * ui/bossHud.js draws the alert, the HP frame and the vignette from the 'bossEvent' hook.
 */
import { MAP_BOUNDARY, ceilingLevel, waterLevel } from '../config.js';
import { state } from '../state.js';
import { scene } from '../core/scene.js';
import { plane, planeSphereRadius } from '../player/plane.js';
import { airUnits, groundUnits } from './registry.js';
import { killGroundUnit } from './groundUnits.js';
import { civilianSites } from './civilians.js';
import { createUnitLabel } from '../ui/labels.js';
import { createExplosion } from '../effects/effects.js';
import { damagePlayer } from '../combat/collision.js';
import { groundUnitWorldPos } from '../combat/damage.js';
import { heightAt } from '../world/terrain.js';
import { difficulty } from '../core/settings.js';
import { RULES } from '../game/rules.js';
import { runHooks } from '../game/hooks.js';
import { MISSILE_CLOSE, THREAT, reportThreat } from '../ui/threatTone.js';
import { clearMinions, spawnMinions, updateMinions } from './minions.js';
import { buildAlien, buildGolem, buildKaiju, buildKraken, buildRobot, buildZombot } from './bossModels.js';
import { acidBlob, lavaRock, missile as missileModel, orb, plasmaBolt } from '../effects/projectileModels.js';

/** Times in frames at 60 fps, distances in world units. */
export const BOSS = Object.freeze({
    life: 300 * 60,                  // escapes after 5 min
    emerge: 240,                     // rising out of the sea / ground / sky
    attackEvery: 170, enragedFactor: 0.62,
    range: 1500,                     // attacks only within this distance of the player
    hpPerLevel: 0.2,                 // tougher as the player levels up
});

export const BOSS_TYPES = Object.freeze({
    kaiju: { name: 'GORGAZON', title: 'Kaiju of the Deep', verb: 'rises from the sea', where: 'sea', build: buildKaiju, hp: 1500, xp: 900, radius: 42, color: '#59c8ff', shot: 0x8fe4ff, attacks: ['beam', 'volley'], speed: 0.16 },
    kraken: { name: 'KRAKOTH', title: 'Terror of the Tides', verb: 'surfaces from the deep', where: 'sea', build: buildKraken, hp: 1300, xp: 850, radius: 40, color: '#ff5c9a', shot: 0xff7ab8, attacks: ['tentacles', 'volley', 'minions'], speed: 0.1, minion: 'squid' },
    golem: { name: 'MAGMAROK', title: 'Heart of the Volcano', verb: 'erupts from the volcano', where: 'peak', build: buildGolem, hp: 1600, xp: 950, radius: 44, color: '#ff7a1a', shot: 0xff5a10, attacks: ['lava', 'volley'], speed: 0 },
    robot: { name: 'TITAN-9', title: 'Rampaging Mech', verb: 'awakens in a village', where: 'village', build: buildRobot, hp: 1400, xp: 900, radius: 46, color: '#ff4848', shot: 0xff4a3a, attacks: ['missiles', 'beam'], speed: 0.12 },
    alien: { name: 'SPECIMEN 47', title: 'Escaped from a military facility', verb: 'breaks out of the base', where: 'base', build: buildAlien, hp: 1100, xp: 850, radius: 36, color: '#66ff55', shot: 0x66ff55, attacks: ['acid', 'volley', 'minions'], speed: 0.28, minion: 'hugger' },
    zombot: { name: 'STAHLMOND ZOMBOT', title: 'Iron robo-zombie from the dark side of the Moon', verb: 'descends from the Moon', where: 'sky', build: buildZombot, hp: 1200, xp: 950, radius: 36, color: '#ff3a3a', shot: 0xff3a3a, attacks: ['plasma', 'beam'], speed: 0.6 },
});

let active = null, lastKind = null;
const shots = [];      // { mesh, v, gravity, dmg, r, life, homing, aoe, decoyed }
const effects = [];    // { mesh, life, update(dt) } — beams, warning rings, tentacles, the volcano
const pending = [];    // { at, fn } — delayed explosions (a defeat), in frames
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);


const surface = (x, z) => Math.max(heightAt(x, z), waterLevel);
const inMap = (x, z, m = 0.82) => Math.abs(x) < MAP_BOUNDARY * m && Math.abs(z) < MAP_BOUNDARY * m;
const dmg = base => Math.max(1, Math.round(base * difficulty().enemyDamage));

// --- Where a boss can appear -----------------------------------------------------------------------------------------
let peak = null;
function highestPeak() {
    if (peak) return peak;
    let best = { x: 0, z: 0, h: -Infinity };
    for (let x = -MAP_BOUNDARY * 0.8; x <= MAP_BOUNDARY * 0.8; x += 40) for (let z = -MAP_BOUNDARY * 0.8; z <= MAP_BOUNDARY * 0.8; z += 40) {
        const h = heightAt(x, z);
        if (h > best.h) best = { x, z, h };
    }
    return (peak = best);
}
/** Where a boss of this kind can appear, around `from` (the player by default), or null. */
export function findSpot(where, from = plane.position) {
    const p = from;
    if (where === 'sea') {
        for (let i = 0; i < 120; i++) {
            const a = Math.random() * Math.PI * 2, d = 650 + Math.random() * 550, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
            if (!inMap(x, z)) continue;
            if ([[0, 0], [45, 0], [-45, 0], [0, 45], [0, -45]].every(([dx, dz]) => heightAt(x + dx, z + dz) < waterLevel)) return { x, z, ground: waterLevel };
        }
        return null;
    }
    if (where === 'peak') {
        const pk = highestPeak();
        return pk.h > waterLevel + 12 ? { x: pk.x, z: pk.z, ground: pk.h } : null;
    }
    if (where === 'village') {
        const villages = civilianSites().filter(s => s.kind === 'village');
        if (!villages.length) return null;
        const v = villages[Math.floor(Math.random() * villages.length)];
        return { x: v.x, z: v.z, ground: heightAt(v.x, v.z) };
    }
    if (where === 'base') {
        const sites = groundUnits.filter(u => (u.userData.type === 'hangar' || u.userData.type === 'airport') && u.userData.hp > 0);
        if (!sites.length) return null;
        const u = sites[Math.floor(Math.random() * sites.length)], w = groundUnitWorldPos(u);
        return { x: w.x, z: w.z, ground: heightAt(w.x, w.z), facility: u };
    }
    // sky: somewhere ahead of the player
    const a = Math.random() * Math.PI * 2, d = 450 + Math.random() * 300;
    const x = THREE.MathUtils.clamp(p.x + Math.cos(a) * d, -MAP_BOUNDARY * 0.8, MAP_BOUNDARY * 0.8), z = THREE.MathUtils.clamp(p.z + Math.sin(a) * d, -MAP_BOUNDARY * 0.8, MAP_BOUNDARY * 0.8);
    return { x, z, ground: surface(x, z) };
}
/** Where the body's centre rests once it has emerged. */
function restY(kind, h, ground) {
    if (kind === 'kaiju') return waterLevel + h * 0.22;   // wading, waist-deep
    if (kind === 'kraken') return waterLevel + h * 0.12;  // mantle above the waves
    if (kind === 'zombot') return Math.min(ceilingLevel - 25, Math.max(ground + 85, plane.position.y));
    if (kind === 'alien') return ground + h * 0.36;       // low on its legs
    return ground + h * 0.48;
}

// --- Spawning --------------------------------------------------------------------------------------------------------

/** Summon a boss now (a given kind, or a random one that has somewhere to appear). Returns the air unit, or null. */
export function spawnBoss(kind = null, { near = null, hpMul = 1 } = {}) {
    if (active || !RULES.bosses || state.isGameOver || state.awaitingStart) return null;
    const kinds = kind ? [kind] : Object.keys(BOSS_TYPES).filter(k => k !== lastKind).sort(() => Math.random() - 0.5);
    let def = null, spot = null, k = null;
    for (k of kinds) { def = BOSS_TYPES[k]; spot = def && (findSpot(def.where, near ?? plane.position) ?? (near && findSpot(def.where))); if (spot) break; }
    if (!spot) return null;
    const model = def.build(), g = model.group, h = model.height;
    const rest = restY(k, h, spot.ground);
    const start = k === 'zombot' ? rest + 380 : rest - h * 1.05;
    g.position.set(spot.x, start, spot.z);
    g.lookAt(plane.position.x, start, plane.position.z);
    scene.add(g);
    if (spot.facility) killGroundUnit(spot.facility, { reward: false }); // it breaks out
    if (k === 'golem') effects.push(volcano(spot));
    const hp = Math.round(def.hp * (1 + BOSS.hpPerLevel * (state.level - 1)) * hpMul);
    const b = { kind: k, def, model, rest, start, home: new THREE.Vector3(spot.x, spot.ground, spot.z), t: 0, frames: 0, phase: 'emerge',
        attackIn: 120, attack: null, attackT: 0, charge: 0, enraged: false, walking: false, beam: null, aim: new THREE.Vector3() };
    const au = {
        id: THREE.MathUtils.generateUUID(), type: 'boss', group: g, hp, maxHp: hp, collisionRadius: def.radius, xpValue: def.xp + 40 * (state.level - 1),
        isHostile: true, baseId: null, label: createUnitLabel(def.name, 99, hp, hp), shootCooldown: 0, userData: { baseId: null },
        isBoss: true, boss: b, blip: { color: def.color, shape: 'ace', label: `☠ ${def.name}` },
    };
    airUnits.push(au);
    active = au; lastKind = k;
    runHooks('bossEvent', 'spawn', au);
    return au;
}


/** For the HUD and tests: the boss in the air, or null. */
export function bossStatus() {
    if (!active) return null;
    const b = active.boss;
    return { kind: b.kind, name: b.def.name, title: b.def.title, color: b.def.color, hp: Math.max(0, active.hp), maxHp: active.maxHp, enraged: b.enraged, phase: b.phase, position: active.group.position };
}
export const bossShots = () => shots;

// --- Per frame -------------------------------------------------------------------------------------------------------

/** Once per simulation step (ai.js): the event timer, shots, effects, and the end of a boss. */
export function updateBossSystem(dt) {
    for (let i = pending.length - 1; i >= 0; i--) if ((pending[i].at -= dt) <= 0) { pending[i].fn(); pending.splice(i, 1); }
    updateShots(dt);
    updateMinions(dt);
    for (let i = effects.length - 1; i >= 0; i--) if (!effects[i].update(dt)) { scene.remove(effects[i].mesh); effects.splice(i, 1); }
    if (active && !airUnits.includes(active)) finish(active);
    // Homing boss missiles sound the warning tone like an ace's
    let near = Infinity, homing = false;
    for (const s of shots) if (s.homing && !s.decoyed) { homing = true; near = Math.min(near, s.mesh.position.distanceTo(plane.position)); }
    reportThreat('bosses', !homing ? THREAT.none : near < MISSILE_CLOSE ? THREAT.missile : THREAT.locked);
}

function finish(au) {
    const b = au.boss, p = au.group.position.clone();
    if (au.hp <= 0) { // shot down: a chain of explosions, then the reward banner (the kill reward came from hits.js)
        for (let i = 0; i < 9; i++) pending.push({ at: i * 12, fn: () => createExplosion(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 50, (Math.random() - 0.3) * 50, (Math.random() - 0.5) * 50)), 2 + Math.random() * 2) });
        runHooks('bossEvent', 'defeat', au);
    } else runHooks('bossEvent', 'escape', au);
    clearAttack(b);
    clearMinions();
    for (const e of effects) scene.remove(e.mesh);
    effects.length = 0;
    active = null;
}

/** One boss's behaviour, every step (ai.js). */
export function updateBoss(au, dt) {
    const b = au.boss, g = au.group, def = b.def;
    b.t += dt / 60; b.frames += dt;
    // Face the player (yaw only for walkers; the zombot also pitches a little)
    const yaw = Math.atan2(plane.position.x - g.position.x, plane.position.z - g.position.z);
    const dy = ((yaw - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    g.rotation.y += THREE.MathUtils.clamp(dy, -0.02 * dt, 0.02 * dt);

    if (b.phase === 'emerge') {
        const k = Math.min(1, b.frames / BOSS.emerge), e = 1 - Math.pow(1 - k, 3);
        g.position.y = b.start + (b.rest - b.start) * e;
        if (Math.floor(b.frames / 14) !== Math.floor((b.frames - dt) / 14) && b.kind !== 'zombot') { // splashes / rubble round the base
            const a = Math.random() * Math.PI * 2;
            createExplosion(_v.set(g.position.x + Math.cos(a) * def.radius, surface(g.position.x, g.position.z) + 2, g.position.z + Math.sin(a) * def.radius), 1.5);
        }
        if (k >= 1) b.phase = 'fight';
    } else if (b.phase === 'fight') {
        move(au, dt);
        if (!b.enraged && au.hp < au.maxHp / 2) { b.enraged = true; runHooks('bossEvent', 'enrage', au); }
        if (b.frames > BOSS.life) { b.phase = 'leave'; b.leaveAt = b.frames; clearAttack(b); runHooks('bossEvent', 'leaving', au); }
        else attack(au, dt);
    } else { // leave: sink back / fly off, then vanish (an escape)
        g.position.y += (b.kind === 'zombot' ? 1.2 : -0.5) * dt;
        if (b.frames - b.leaveAt > 260) { const i = airUnits.indexOf(au); if (i >= 0) airUnits.splice(i, 1); scene.remove(g); }
    }
    b.charge = Math.max(0, b.charge - 0.01 * dt);
    b.model.animate(b.t, b);
}

function move(au, dt) {
    const b = au.boss, g = au.group, p = g.position, def = b.def;
    const dist = Math.hypot(plane.position.x - p.x, plane.position.z - p.z);
    b.walking = false;
    if (b.kind === 'zombot') { // circles the player at a distance, bobbing
        const a = Math.atan2(p.z - plane.position.z, p.x - plane.position.x) + 0.004 * dt;
        const tx = plane.position.x + Math.cos(a) * 280, tz = plane.position.z + Math.sin(a) * 280;
        _v.set(tx - p.x, 0, tz - p.z);
        if (_v.length() > 1) p.addScaledVector(_v.normalize(), Math.min(def.speed * dt, _v.length()));
        const ty = Math.min(ceilingLevel - 25, Math.max(surface(p.x, p.z) + 70, plane.position.y + 10)) + Math.sin(b.t * 1.3) * 8;
        p.y += THREE.MathUtils.clamp(ty - p.y, -0.6 * dt, 0.6 * dt);
    } else if (def.speed > 0 && dist > 220) {
        _v.set(plane.position.x - p.x, 0, plane.position.z - p.z).normalize().multiplyScalar(def.speed * dt);
        const nx = p.x + _v.x, nz = p.z + _v.z;
        const water = heightAt(nx, nz) < waterLevel, nearHome = Math.hypot(nx - b.home.x, nz - b.home.z) < (b.kind === 'alien' ? 320 : 150);
        if (inMap(nx, nz) && ((def.where === 'sea' && water) || (def.where !== 'sea' && nearHome))) {
            p.x = nx; p.z = nz; b.walking = true;
            if (def.where !== 'sea') p.y = heightAt(p.x, p.z) + (b.rest - b.home.y);
        }
    }
}

// --- Attacks ---------------------------------------------------------------------------------------------------------

function attack(au, dt) {
    const b = au.boss;
    if (state._playerDown || state.isGameOver) { clearAttack(b); return; }
    if (!b.attack) {
        const far = plane.position.distanceTo(au.group.position) > BOSS.range;
        if (far || (b.attackIn -= dt) > 0) return;
        const list = b.def.attacks;
        b.attack = list[Math.floor(Math.random() * list.length)]; b.attackT = 0;
        b.attackIn = BOSS.attackEvery * difficulty().enemyFireInterval * (b.enraged ? BOSS.enragedFactor : 1);
    }
    b.attackT += dt;
    const done = ATTACKS[b.attack](au, b, dt);
    if (done) clearAttack(b);
}
function clearAttack(b) {
    b.attack = null;
    if (b.beam) { scene.remove(b.beam.mesh, b.beam.warn); b.beam = null; }
}
const emitterPos = (b, out) => b.model.emitter.getWorldPosition(out);
/** Where the player will be in `frames`, flying straight. */
const predict = (frames, out) => out.set(0, 0, 1).applyQuaternion(plane.quaternion).multiplyScalar(state.speed * frames).add(plane.position);
const crossed = (b, dt, at) => b.attackT >= at && b.attackT - dt < at;

const ATTACKS = {
    // A spread of glowing orbs at where the player is going
    volley(au, b, dt) {
        b.charge = Math.min(1, b.attackT / 40);
        if (!crossed(b, dt, 40)) return b.attackT > 60;
        const from = emitterPos(b, new THREE.Vector3()), n = b.enraged ? 7 : 5;
        const to = predict(from.distanceTo(plane.position) / 1.3, new THREE.Vector3());
        for (let i = 0; i < n; i++) {
            _v.subVectors(to, from).normalize().applyAxisAngle(_up, (i - (n - 1) / 2) * 0.07).multiplyScalar(1.3);
            fire(from, _v, { dmg: 9, r: 3.4, color: b.def.shot, look: 'orb' });
        }
        return false;
    },
    acid(au, b, dt) {
        b.charge = Math.min(1, b.attackT / 30);
        if (!crossed(b, dt, 30)) return b.attackT > 50;
        const from = emitterPos(b, new THREE.Vector3()), n = 9;
        for (let i = 0; i < n; i++) {
            _v.subVectors(plane.position, from).normalize().applyAxisAngle(_up, (i - (n - 1) / 2) * 0.09).multiplyScalar(1.15);
            _v.y += 0.12;
            fire(from, _v, { dmg: 7, r: 3, color: b.def.shot, gravity: 0.0025, look: 'acid' });
        }
        return false;
    },
    plasma(au, b, dt) {
        b.charge = 1;
        for (const at of [20, 34, 48]) if (crossed(b, dt, at)) {
            const from = emitterPos(b, new THREE.Vector3());
            for (let i = -1; i <= 1; i++) { _v.subVectors(predict(25, _w), from).normalize().applyAxisAngle(_up, i * 0.05).multiplyScalar(2.2); fire(from, _v, { dmg: 6, r: 2.4, color: b.def.shot, look: 'plasma' }); }
        }
        return b.attackT > 60;
    },
    // Lava bombs lobbed to land around the player
    lava(au, b, dt) {
        b.charge = Math.min(1, b.attackT / 50);
        if (!crossed(b, dt, 50)) return b.attackT > 70;
        const from = emitterPos(b, new THREE.Vector3()).add(_w.set(0, 10, 0)), n = b.enraged ? 6 : 4, T = 110, G = 0.02;
        for (let i = 0; i < n; i++) {
            const to = predict(T, new THREE.Vector3()).add(_w.set((Math.random() - 0.5) * 70, 0, (Math.random() - 0.5) * 70));
            const v = to.sub(from).divideScalar(T); v.y += 0.5 * G * T;
            fire(from, v, { dmg: 14, r: 4.5, color: b.def.shot, gravity: G, aoe: 26, look: 'lava' });
        }
        return false;
    },
    // Homing missiles from the shoulder pods: outturn them, or flares
    missiles(au, b, dt) {
        b.charge = Math.min(1, b.attackT / 40);
        for (const [i, at] of [40, 52, 64, 76].entries()) if (crossed(b, dt, at)) {
            const pod = b.model.pods[i % 2].getWorldPosition(new THREE.Vector3());
            fire(pod, _v.set(0, 0.9, 0), { dmg: 15, r: 2.4, color: b.def.shot, homing: true, life: 460, look: 'missile' });
        }
        return b.attackT > 90;
    },
    // A sweeping beam: a warning line while it charges, then it fires and slowly follows the player
    beam(au, b, dt) {
        const from = emitterPos(b, new THREE.Vector3());
        if (!b.beam) {
            const warn = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: b.def.shot, transparent: true, opacity: 0.35, depthWrite: false }));
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: b.def.shot, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
            mesh.visible = false; scene.add(warn, mesh);
            b.beam = { warn, mesh, len: 1300 };
            b.aim.subVectors(plane.position, from).normalize();
        }
        const firing = b.attackT > 85;
        b.charge = firing ? 1 : b.attackT / 85;
        _v.subVectors(plane.position, from).normalize();
        b.aim.lerp(_v, (firing ? 0.012 : 0.05) * dt).normalize(); // fast to aim while charging, slow to follow while firing
        for (const m of [b.beam.warn, b.beam.mesh]) {
            m.position.copy(from).addScaledVector(b.aim, b.beam.len / 2);
            m.quaternion.setFromUnitVectors(_up, b.aim);
            m.scale.set(1, b.beam.len, 1);
        }
        b.beam.warn.visible = !firing; b.beam.mesh.visible = firing;
        if (firing) {
            b.beam.mesh.scale.x = b.beam.mesh.scale.z = 0.8 + 0.3 * Math.sin(b.t * 40);
            // Damage ticks while the player is inside the beam
            _w.subVectors(plane.position, from);
            const along = _w.dot(b.aim), off = _w.addScaledVector(b.aim, -along).length();
            if (along > 0 && along < b.beam.len && off < 6 + planeSphereRadius && Math.floor(b.attackT / 12) !== Math.floor((b.attackT - dt) / 12)) damagePlayer(dmg(7), from);
        }
        return b.attackT > 85 + (b.enraged ? 130 : 100);
    },
    // A brood of minions that latch on and bite (entities/minions.js)
    minions(au, b, dt) {
        b.charge = Math.min(1, b.attackT / 50);
        if (crossed(b, dt, 50)) spawnMinions(b.def.minion, emitterPos(b, new THREE.Vector3()), b.enraged ? 5 : 3);
        return b.attackT > 70;
    },
    // Tentacles burst from the water under the player, after a warning ring
    tentacles(au, b, dt) {
        b.charge = 1;
        for (const at of [0.5, 40, 80]) if (crossed(b, dt, at)) {
            const spot = predict(70, new THREE.Vector3());
            if (heightAt(spot.x, spot.z) < waterLevel) effects.push(tentacleStrike(spot, b.def.shot));
        }
        return b.attackT > 200;
    },
};

const LOOKS = { orb: c => orb(c), lava: () => lavaRock(), acid: c => acidBlob(c), plasma: c => plasmaBolt(c), missile: c => missileModel(c, 'z') };
function fire(from, v, { dmg: d, r, color, gravity = 0, homing = false, aoe = 0, life = 300, look = 'orb' }) {
    const mesh = LOOKS[look](color); // detailed, animated shots (effects/projectileModels.js)
    mesh.position.copy(from);
    if (look !== 'missile') mesh.scale.setScalar(r * (look === 'plasma' ? 0.8 : 0.7)); else mesh.scale.setScalar(2.2);
    if (look === 'plasma' || look === 'missile') mesh.quaternion.setFromUnitVectors(_w.set(0, 0, 1), _v.copy(v).normalize());
    scene.add(mesh);
    shots.push({ mesh, v: v.clone(), gravity, dmg: dmg(d), r, life, homing, aoe, decoyed: false, t: Math.random() * 10 });
}

function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i], p = s.mesh.position;
        s.life -= dt; s.t += dt / 60;
        s.mesh.userData.animate?.(s.t);
        if (s.homing) {
            if (!s.decoyed && state.flareTimer > 0 && p.distanceTo(plane.position) < 160) s.decoyed = true; // flares spoof it up close
            if (!s.decoyed && !state._playerDown) { const speed = Math.min(1.25, s.v.length() + 0.012 * dt); s.v.lerp(_v.subVectors(plane.position, p).normalize().multiplyScalar(speed), 0.03 * dt).setLength(speed); }
            s.mesh.quaternion.setFromUnitVectors(_w.set(0, 0, 1), _v.copy(s.v).normalize());
        }
        s.v.y -= s.gravity * dt;
        p.addScaledVector(s.v, dt);
        let hit = !state._playerDown && !state.isGameOver && p.distanceTo(plane.position) < s.r + planeSphereRadius;
        const ground = p.y < surface(p.x, p.z);
        if (hit) damagePlayer(s.dmg, p);
        else if (ground && s.aoe && p.distanceTo(plane.position) < s.aoe) { damagePlayer(s.dmg, p); hit = true; }
        if (hit || ground || s.life <= 0 || p.y > ceilingLevel + 60) {
            if (hit || ground) createExplosion(p, s.aoe ? 1.4 : 0.6);
            scene.remove(s.mesh); shots.splice(i, 1);
        }
    }
}

/** A warning ring on the water, then a tentacle shoots up there and sinks back. */
function tentacleStrike(spot, color) {
    const group = new THREE.Group();
    group.position.set(spot.x, waterLevel + 0.3, spot.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(20, 26, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; group.add(ring);
    const flesh = new THREE.MeshStandardMaterial({ color: 0x9a3a5e, flatShading: true, roughness: 0.5 });
    const arm = new THREE.Group(); group.add(arm);
    for (let i = 0; i < 8; i++) { const seg = new THREE.Mesh(new THREE.CylinderGeometry(5.5 - i * 0.6, 6 - i * 0.6, 14, 8), flesh); seg.position.y = 7 + i * 13; seg.rotation.z = Math.sin(i) * 0.12; arm.add(seg); }
    arm.scale.y = 0.01; arm.visible = false;
    scene.add(group);
    let t = 0;
    return {
        mesh: group,
        update(dt) {
            t += dt;
            ring.material.opacity = t < 70 ? 0.35 + 0.35 * Math.abs(Math.sin(t * 0.25)) : 0;
            if (t >= 70) {
                arm.visible = true;
                arm.scale.y = t < 82 ? (t - 70) / 12 : t < 130 ? 1 : Math.max(0.01, 1 - (t - 130) / 30);
                arm.rotation.y = t * 0.05;
                if (t < 95 && !state._playerDown && Math.hypot(plane.position.x - spot.x, plane.position.z - spot.z) < 28 && plane.position.y < waterLevel + 110 * arm.scale.y && Math.floor(t / 10) !== Math.floor((t - dt) / 10)) damagePlayer(dmg(18), group.position);
                if (t >= 70 && t - dt < 70) createExplosion(group.position, 1.6);
            }
            return t < 160;
        },
    };
}

/** The golem's volcano: a glowing crater and eruptions while it lives. */
function volcano(spot) {
    const group = new THREE.Group();
    group.position.set(spot.x, spot.ground + 1, spot.z);
    const lava = new THREE.MeshStandardMaterial({ color: 0xff5a10, emissive: 0xff3a00, emissiveIntensity: 1.6, flatShading: true });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(34, 5, 6, 18), new THREE.MeshStandardMaterial({ color: 0x2a2220, flatShading: true, roughness: 1 }));
    rim.rotation.x = Math.PI / 2; group.add(rim);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(32, 18), lava); pool.rotation.x = -Math.PI / 2; group.add(pool);
    scene.add(group);
    let t = 0;
    return {
        mesh: group,
        update(dt) {
            t += dt;
            lava.emissiveIntensity = 1.3 + 0.5 * Math.sin(t * 0.08);
            if (Math.floor(t / 50) !== Math.floor((t - dt) / 50)) createExplosion(_v.copy(group.position).add(_w.set((Math.random() - 0.5) * 40, 4, (Math.random() - 0.5) * 40)), 1.2);
            return !!active && active.boss.kind === 'golem';
        },
    };
}
