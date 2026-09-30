/**
 * Ace rival: a hostile aircraft with the player's flight model and weapon kit (gun bursts, paired
 * homing missiles, flares) that hunts the player across the whole map.
 *
 *   Ace Hunt (Settings, Shift+H)  the first ace launches RIVAL.firstDelay into the run, a stronger one
 *                                 RIVAL.respawnDelay after each kill
 *   Ace AI (Settings)             Easy / Medium / Hard — config.js RIVAL_SKILL, read live
 *   H                             spawn one ace now (debug / on demand)
 *
 * The ace is an ordinary AirUnit in `airUnits`, so bullets, missiles, the lock-on reticle, the
 * spatial grid, the minimap and kill rewards work without changes. ai.js hands it to updateRival()
 * instead of the generic velocity/orbit movement.
 *
 * Sensors: inside the tier's visualRange the ace tracks continuously; outside it, a map-wide radar ping
 * every scanInterval refreshes the player's last known position (extrapolated in between).
 * A player below groundLevel + RIVAL.radarFloor is masked by terrain and missed by the ping.
 */
import { MAP_BOUNDARY, RIVAL, acceleration, ceilingLevel, deceleration, groundLevel, maxPitchRate, maxRollRate, maxSpeed, maxYawRate, minSpeed, rotAccel } from '../config.js';
import { state } from '../state.js';
import { scene } from '../core/scene.js';
import { _up3 } from '../core/scratch.js';
import { plane } from '../player/plane.js';
import { airUnits, enemyBullets, missiles } from './registry.js';
import { spawnEnemyBullet } from '../combat/enemyBullets.js';
import { damagePlayer } from '../combat/collision.js';
import { createExplosion } from '../effects/effects.js';
import { createUnitLabel } from '../ui/labels.js';
import { showNotification } from '../ui/notifications.js';
import { destroyAirUnit } from './airUnits.js';
import { difficulty, onSettingChange, rivalSkill, setSetting, settings } from '../core/settings.js';
import { RULES } from '../game/rules.js';
import { heightAt } from '../world/terrain.js';
import { runHooks } from '../game/hooks.js';

// --- Targets: who the aces hunt ----------------------------------------------------------------------------
// By default only the local player. Multiplayer's host adds the other players (setRivalTargets): an ace hunts the
// nearest living target, and hits on a remote one are handed to `remoteHit` (that player applies the damage).
const localTarget = {
    id: 'local', local: true, position: plane.position, quaternion: plane.quaternion,
    get speed() { return state.speed; }, get alive() { return !state.isGameOver && !state._playerDown; }, get flares() { return state.flareTimer > 0; },
};
let targetsFn = () => [localTarget], remoteHit = null;
/** targets(ace): [{ id, local, position, quaternion, speed, alive, flares }] that ace may hunt; onRemoteHit(targetId, damage, weapon, ace). */
export function setRivalTargets(targets, onRemoteHit) { targetsFn = targets || (() => [localTarget]); remoteHit = onRemoteHit || null; }
export const localRivalTarget = localTarget;
let T = localTarget; // the target of the ace being updated this frame
function pickTarget(au) {
    let best = null, bestD = Infinity;
    for (const t of targetsFn(au)) {
        if (!t.alive) continue;
        const d = t.position.distanceToSquared(au.group.position) * (t.id === au.ai.targetId ? 0.5 : 1); // sticky: switch only for a clearly closer target
        if (d < bestD) { bestD = d; best = t; }
    }
    au.ai.targetId = best ? best.id : null;
    return best;
}
const targetById = (id, au) => targetsFn(au).find(t => t.id === id) || null;
/** Every ace in the air (multiplayer's host shares them with the other players). */
export const rivalList = () => rivals;

const CALLSIGNS = ['Strzyga', 'Upiór', 'Licho', 'Bies', 'Południca', 'Żmij', 'Wij'];
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const ENABLE_DELAY = 5 * 60; // Ace Hunt switched on mid-run (after firstDelay): launch this soon

// Module-private scratch (never pass these into spawnEnemyBullet — it uses the shared _sv* scratch)
const _fwd = new THREE.Vector3(), _pFwd = new THREE.Vector3(), _pVel = new THREE.Vector3(), _toP = new THREE.Vector3();
const _des = new THREE.Vector3(), _loc = new THREE.Vector3(), _aim = new THREE.Vector3(), _muzzle = new THREE.Vector3();
const _tmp = new THREE.Vector3(), _tmp2 = new THREE.Vector3(), _qInv = new THREE.Quaternion();

// Session bookkeeping
const rivals = [];          // every ace spawned and not yet reaped
const rivalMissiles = [];   // hostile homing missiles in flight
let activeRival = null, aceLevel = 0, acesDowned = 0, respawnTimer = RIVAL.firstDelay;
const warnEl = document.getElementById('rival-warning');
let warnText = '', bannerEl = null;

onSettingChange((key, value) => {
    if (key === 'aceHunt' && value && !activeRival && state._gameElapsed >= RIVAL.firstDelay) respawnTimer = Math.min(respawnTimer, ENABLE_DELAY);
    if (key === 'rivalSkill') for (const r of rivals) clampAmmo(r.wpn); // a lower tier takes away missiles/flares at once
});

// Shared missile mesh resources — never disposed
const _mslGeo = new THREE.CylinderGeometry(0.22, 0.22, 2.4, 6); // Y-aligned, oriented with setFromUnitVectors(_up3, dir)
const _mslMat = new THREE.MeshBasicMaterial({ color: 0xff2233 });

// --- Public API -------------------------------------------------------------------------------

export function spawnRival() {
    if (!RULES.ace || state.isGameOver || state.awaitingStart) return null;
    aceLevel++;
    const callsign = CALLSIGNS[(aceLevel - 1) % CALLSIGNS.length];
    const group = createRivalVisual();
    // Enter from the side of the map opposite the player, mid-altitude, nose toward the centre
    const ang = Math.atan2(plane.position.z, plane.position.x) + Math.PI + (Math.random() - 0.5);
    const r = MAP_BOUNDARY * RIVAL.spawnDist;
    group.position.set(Math.cos(ang) * r, (groundLevel + ceilingLevel) / 2 + 30, Math.sin(ang) * r);
    group.lookAt(_tmp.set(0, group.position.y, 0)); // lookAt points +Z at the target, same forward axis as the player
    scene.add(group);
    const tier = rivalSkill();
    const hp = Math.round(RIVAL.baseHp * tier.hp * (1 + RIVAL.hpPerAce * (aceLevel - 1)) * state.playerDamageMultiplier);
    const label = createUnitLabel(`ACE ${callsign}`, aceLevel, hp, hp); scene.add(label.sprite);
    const au = makeAce({ callsign, group, hp, label, xp: RIVAL.xpPerAce * aceLevel, tier });
    airUnits.push(au); rivals.push(au); activeRival = au;
    banner(`☠ ACE ${callsign.toUpperCase()} (LV ${aceLevel} · ${tier.label.toUpperCase()}) IS HUNTING YOU`, 'threat');
    return au;
}

function makeAce({ callsign, group, hp, label, xp, tier }) {
    return {
        // AirUnit contract (entities/contract.js) — 'fighter' so minimap/reticle treat it like one
        id: THREE.MathUtils.generateUUID(), type: 'fighter', group, hp, maxHp: hp,
        collisionRadius: RIVAL.collisionRadius, xpValue: xp,
        isHostile: true, baseId: null, label, shootCooldown: 0, userData: { baseId: null },
        wingHalfSpan: RIVAL.wingHalfSpan, wingR: RIVAL.wingRadius, wingType: 'q',
        velocity: new THREE.Vector3(), // kept current for anyone reading it; ai.js skips generic movement for rivals
        // Rival-only
        isRival: true, callsign, crashed: false,
        fl: { speed: maxSpeed * 0.8, pitchRate: 0, rollRate: 0, yawRate: 0 },
        wpn: {
            gunAmmo: RIVAL.gunAmmo, gunReload: 0, gunCd: 60, burstLeft: 0,
            mslAmmo: tier.mslAmmo, mslReload: 0, mslCd: RIVAL.mslCooldown, lock: 0,
            flareAmmo: tier.flareAmmo, flareReload: 0, flareTimer: 0,
        },
        ai: {
            mode: 'hunt', timer: 0, react: 0, evadeCd: 0, scan: 0, sinceFix: 0, contact: false,
            lastKnown: plane.position.clone(), lastVel: new THREE.Vector3(), breakDir: new THREE.Vector3(),
        },
    };
}

/**
 * An ace outside Ace Hunt (e.g. multiplayer team bots): no banners, own level and colour. `friendly` aces are on the
 * player's side: the player's weapons, lock-on and minimap treat them as allies. Returns the air unit.
 */
export function spawnAce({ callsign, level = 1, position, heading = 0, color, friendly = false, blipColor, xp = RIVAL.xpPerAce * level }) {
    const group = createRivalVisual(color);
    group.position.copy(position); group.rotation.set(0, heading, 0);
    scene.add(group);
    const tier = rivalSkill(), hp = Math.round(RIVAL.baseHp * tier.hp * (1 + RIVAL.hpPerAce * (level - 1)));
    const label = createUnitLabel(callsign, level, hp, hp); scene.add(label.sprite);
    const au = makeAce({ callsign, group, hp, label, xp, tier });
    Object.assign(au, { quiet: true, friendly, isHostile: !friendly, blipColor, blipLabel: callsign, level });
    airUnits.push(au); rivals.push(au);
    return au;
}

/** Shift+H: flip the persisted Ace Hunt setting; switching it on mid-flight launches an ace at once. */
export function toggleRivalMode() {
    setSetting('aceHunt', !settings.aceHunt);
    showNotification(settings.aceHunt ? '☠ Ace Hunt on (Shift+H)' : 'Ace Hunt off (Shift+H)', false, { local: true });
    if (settings.aceHunt && !activeRival) spawnRival();
}

/** For the HUD: the ace in the air (or null), and whether / when the next one launches. */
export function rivalStatus() {
    return { hunt: RULES.ace && settings.aceHunt, active: activeRival, nextIn: Math.max(0, respawnTimer / 60), downed: acesDowned, tier: rivalSkill() };
}
export const acesShotDown = () => acesDowned;
/** Hostile missiles in flight — minimap blips. */
export const rivalMissilesInFlight = () => rivalMissiles;

/** Reaction/aim quality for the current tier; grows with each ace. The flight envelope is the tier's, not the skill's. */
function skillOf(au) {
    const t = rivalSkill();
    return Math.min(t.skillMax, t.skill + t.skillPerAce * ((au?.level ?? aceLevel) - 1));
}

/** Once per updateAI(): missiles, death bookkeeping, Ace Hunt respawns, HUD warnings. */
export function updateRivalSystem(dt) {
    updateRivalMissiles(dt);
    for (let i = rivals.length - 1; i >= 0; i--) {
        const r = rivals[i];
        if (airUnits.includes(r)) continue;
        rivals.splice(i, 1);
        runHooks('rivalDown', r);
        if (r.quiet) { /* team bots: whoever spawned them reports it */ } else if (r.crashed) { acesDowned++; banner(`✈ ACE ${r.callsign.toUpperCase()} CRASHED`, 'win'); }
        else if (r.hp <= 0) { acesDowned++; banner(`★ ACE ${r.callsign.toUpperCase()} SHOT DOWN  +${r.xpValue} XP`, 'win'); }
        if (r === activeRival) { activeRival = null; respawnTimer = RIVAL.respawnDelay; }
    }
    if (RULES.ace && settings.aceHunt && !activeRival && !state.isGameOver && (respawnTimer -= dt) <= 0) spawnRival();
    updateWarnings();
}

/** Per-frame brain + flight for one ace. Called from the airUnits loop in ai.js. */
export function updateRival(au, dt) {
    const { ai, fl, wpn, group } = au, pos = group.position, target = pickTarget(au), alive = !!target && !(target.local && state.isGameOver);
    T = target || localTarget;
    _fwd.set(0, 0, 1).applyQuaternion(group.quaternion);
    _pFwd.set(0, 0, 1).applyQuaternion(T.quaternion);
    _pVel.copy(_pFwd).multiplyScalar(T.speed);
    _toP.subVectors(T.position, pos);
    const dist = _toP.length(), tier = rivalSkill();

    // 1. Sensors — continuous in visual range, otherwise a map-wide radar ping every scanInterval
    const visual = alive && dist < tier.visualRange;
    ai.sinceFix += dt; ai.scan -= dt;
    if (visual || (alive && ai.scan <= 0)) {
        if (!visual) ai.scan = tier.scanInterval;
        if (visual || T.position.y > groundLevel + RIVAL.radarFloor) {
            ai.lastKnown.copy(T.position); ai.lastVel.copy(_pVel); ai.sinceFix = 0;
        }
    }
    if (visual && !ai.contact && T.local && !au.quiet) banner(`⚠ ACE ${au.callsign.toUpperCase()} — VISUAL CONTACT`, 'alert');
    ai.contact = visual;
    tickWeapons(wpn, dt);

    // 2. Decide: hunt (radar picture) · engage (visual) · evade (timed break turn)
    ai.timer -= dt; ai.react -= dt; ai.evadeCd -= dt;
    if (alive) checkThreats(au, dist);
    if (ai.mode === 'evade' && ai.timer <= 0) ai.evadeCd = RIVAL.evadeCooldown;
    if (ai.mode !== 'evade' || ai.timer <= 0) ai.mode = visual ? 'engage' : 'hunt';

    // 3. Where the nose should point
    if (!alive) _des.set(_fwd.x, 0, _fwd.z);                        // player dead: level off and cruise
    else if (ai.mode === 'evade') _des.copy(ai.breakDir);
    else if (ai.mode === 'engage') leadPoint(au, dist, _des).sub(pos);
    else _des.copy(ai.lastKnown).addScaledVector(ai.lastVel, Math.min(ai.sinceFix, 240)).sub(pos);
    if (_des.lengthSq() < 1e-6) _des.copy(_fwd);
    _des.normalize();
    applySafety(au, _des);

    // 4. Fly — same rate limits, rotational acceleration and throttle constants as the player
    const offBore = _fwd.angleTo(_toP);
    setThrottle(au, dist, offBore, dt);
    steer(au, _des, dt);
    _fwd.set(0, 0, 1).applyQuaternion(group.quaternion);
    pos.addScaledVector(_fwd, fl.speed * dt);
    au.velocity.copy(_fwd).multiplyScalar(fl.speed);
    group.updateMatrixWorld(true);
    au.label.sprite.position.copy(pos).add(_tmp.set(0, RIVAL.collisionRadius + 8, 0));

    // 5. Same hard limits that end the player's run: ground, ceiling, map edge (counts as a kill)
    if (pos.y > ceilingLevel - 2) pos.y = ceilingLevel - 2; // the same altitude limit as the player
    if (pos.y < heightAt(pos.x, pos.z) + 1.5 || Math.abs(pos.x) > MAP_BOUNDARY || Math.abs(pos.z) > MAP_BOUNDARY) {
        au.crashed = true;
        destroyAirUnit(au, { reward: true });
        return;
    }

    // 6. Weapons
    if (alive && ai.mode === 'engage') { fireGuns(au, dist); updateMissileLock(au, dist, offBore, dt); }
    else wpn.lock = 0;
}

// --- Flight -----------------------------------------------------------------------------------

// Largest rate from which the ace can still stop on target with rotAccel (bang-bang braking curve)
const rateFor = (err, max) => Math.sign(err) * Math.min(max, Math.sqrt(2 * rotAccel * Math.abs(err)) * 0.85);
const approach = (rate, target, dt) => rate + THREE.MathUtils.clamp(target - rate, -rotAccel * dt, rotAccel * dt);

function steer(au, des, dt) {
    const fl = au.fl, g = au.group;
    _qInv.copy(g.quaternion).invert();
    _loc.copy(des).applyQuaternion(_qInv);           // desired direction in the ace's frame (+Z nose, +Y canopy)
    const offBore = Math.acos(THREE.MathUtils.clamp(_loc.z, -1, 1));
    const pitchErr = -Math.atan2(_loc.y, _loc.z);    // +rotateX = nose down
    const yawErr = Math.atan2(_loc.x, _loc.z);       // +rotateY = nose toward +X
    let rollErr;
    if (offBore < RIVAL.fineAimAngle) {
        // Fine aim: pitch/yaw do the work, roll back toward wings-level
        _tmp.copy(WORLD_UP).applyQuaternion(_qInv);
        rollErr = -Math.atan2(_tmp.x, _tmp.y);
    } else {
        // Big turn: bank so the target sits above the canopy, then the pitch pull does the turning
        const phi = Math.atan2(_loc.x, _loc.y);
        rollErr = Math.abs(phi) > 2.6 ? 0 : -phi;    // target almost straight "below": push instead of a slow 180° roll
    }
    const k = rivalSkill().rateScale; // lower tiers fly a softer envelope than the player's
    fl.pitchRate = approach(fl.pitchRate, rateFor(pitchErr, maxPitchRate * k), dt);
    fl.rollRate  = approach(fl.rollRate,  rateFor(rollErr,  maxRollRate * k),  dt);
    fl.yawRate   = approach(fl.yawRate,   rateFor(yawErr * RIVAL.yawAuthority, maxYawRate * k), dt);
    g.rotateX(fl.pitchRate * dt); g.rotateZ(fl.rollRate * dt); g.rotateY(fl.yawRate * dt); // same order as flight.js
}

function setThrottle(au, dist, offBore, dt) {
    const fl = au.fl, top = maxSpeed * rivalSkill().speedScale;
    let target = top;
    if (au.ai.mode === 'engage' && !state.isGameOver) {
        if (offBore > RIVAL.cornerAngle) target = top * RIVAL.cornerSpeed;                    // rates are per frame → slower = tighter turn
        else if (dist < RIVAL.parkRange && offBore < 0.5) target = Math.min(top, Math.max(T.speed, maxSpeed * 0.35)); // on the six: match speed, don't overshoot
    }
    if (fl.speed < target - 0.005) fl.speed = Math.min(target, fl.speed + acceleration * dt);
    else if (fl.speed > target + 0.005) fl.speed = Math.max(minSpeed, fl.speed - deceleration * dt);
}

/** Bend the desired heading away from the floor, ceiling and map edge (1 s look-ahead). */
function applySafety(au, des) {
    const p = au.group.position;
    _tmp.set(0, 0, 1).applyQuaternion(au.group.quaternion);
    const yAhead = p.y + _tmp.y * au.fl.speed * 60;
    // Floor: the terrain under the ace and 1 s ahead of it
    const floor = Math.max(heightAt(p.x, p.z), heightAt(p.x + _tmp.x * au.fl.speed * 60, p.z + _tmp.z * au.fl.speed * 60)) + RIVAL.groundMargin, roof = ceilingLevel - RIVAL.ceilingMargin;
    if (p.y < floor || yAhead < floor) des.y = Math.max(des.y, 0.5);
    else if (p.y > roof || yAhead > roof) des.y = Math.min(des.y, -0.3);
    const lim = MAP_BOUNDARY * RIVAL.boundaryFrac;
    if (Math.abs(p.x) > lim || Math.abs(p.z) > lim) des.lerp(_tmp2.set(-p.x, 0, -p.z).normalize(), 0.6);
    des.normalize();
}

// --- Tactics ----------------------------------------------------------------------------------

/** Where to point for guns: bullet-time lead inside ~gun range, a short pursuit lead beyond it. */
function leadPoint(au, dist, out) {
    if (dist > RIVAL.gunRange * 1.5) return out.copy(T.position).addScaledVector(_pVel, RIVAL.pursuitLead);
    const v = RIVAL.bulletSpeed + au.fl.speed;
    out.copy(T.position).addScaledVector(_pVel, dist / v);
    const t = out.distanceTo(au.group.position) / v; // one refinement pass
    return out.copy(T.position).addScaledVector(_pVel, t);
}

function checkThreats(au, dist) {
    const { ai, wpn } = au, pos = au.group.position;
    // Player missiles past their drop phase and heading at the ace. While the ace's flares burn they lose lock.
    let inbound = null;
    const detSq = RIVAL.flareDetectRange ** 2;
    for (const m of missiles) {
        if (m.dropPhase > 0) continue;
        _tmp.subVectors(pos, m.position);
        if (_tmp.lengthSq() > detSq) continue;
        if (_tmp.normalize().dot(_tmp2.copy(m.velocity).normalize()) < 0.8) continue;
        if (wpn.flareTimer > 0) m.target = null; // decoyed — projectiles.js "no target" branch flies it straight on
        else inbound = m;
    }
    if (ai.react > 0) return;                    // decisions run on a reaction clock, not every frame
    const tier = rivalSkill();
    ai.react = tier.reactInterval;
    const reacts = Math.random() < skillOf(au);
    if (inbound) {
        if (wpn.flareAmmo > 0 && wpn.flareTimer <= 0 && reacts) popFlares(au);
        if (ai.mode !== 'evade' && (tier.evades || reacts)) startBreak(au, _tmp.subVectors(pos, inbound.position).normalize(), 90);
        return;
    }
    // Head-on merge / ram avoidance
    if (dist < 35 || (dist < 90 && _fwd.dot(_pFwd) < -0.5)) {
        startBreak(au, _tmp.subVectors(pos, T.position).normalize(), 40, true);
        return;
    }
    // Player's nose is on the ace inside gun range → break turn
    if (tier.evades && ai.mode !== 'evade' && ai.evadeCd <= 0 && dist < RIVAL.gunRange && reacts) {
        _tmp.subVectors(pos, T.position).normalize();
        if (_pFwd.dot(_tmp) > Math.cos(RIVAL.threatCone)) {
            startBreak(au, _tmp, RIVAL.breakTime[0] + Math.random() * (RIVAL.breakTime[1] - RIVAL.breakTime[0]));
        }
    }
}

/** Turn perpendicular to the threat line so the shooter's nose can't follow; random side, a little climb/dive. */
function startBreak(au, threatDir, frames, away = false) {
    const ai = au.ai;
    ai.breakDir.crossVectors(threatDir, WORLD_UP);
    if (ai.breakDir.lengthSq() < 1e-4) ai.breakDir.set(1, 0, 0);
    ai.breakDir.normalize().multiplyScalar(Math.random() < 0.5 ? 1 : -1);
    if (away) ai.breakDir.add(threatDir);
    ai.breakDir.y += (Math.random() - 0.5) * 0.6;
    ai.breakDir.normalize();
    ai.mode = 'evade'; ai.timer = frames;
}

function popFlares(au) {
    const w = au.wpn;
    w.flareTimer = RIVAL.flareDuration;
    if (--w.flareAmmo <= 0) w.flareReload = RIVAL.flareReload;
    au.group.localToWorld(_tmp.set(4, -1, -2)); createExplosion(_tmp, 0.25);
    au.group.localToWorld(_tmp.set(-4, -1, -2)); createExplosion(_tmp, 0.25);
}

// --- Weapons ----------------------------------------------------------------------------------

function tickWeapons(w, dt) {
    const tier = rivalSkill();
    w.gunCd -= dt; w.mslCd -= dt; w.flareTimer = Math.max(0, w.flareTimer - dt);
    if (w.gunAmmo <= 0 && (w.gunReload -= dt) <= 0) w.gunAmmo = RIVAL.gunAmmo;
    if (w.mslAmmo <= 0 && tier.mslAmmo > 0 && (w.mslReload -= dt) <= 0) w.mslAmmo = tier.mslAmmo;
    if (w.flareAmmo <= 0 && tier.flareAmmo > 0 && (w.flareReload -= dt) <= 0) w.flareAmmo = tier.flareAmmo;
}
/** Keep magazines within the current tier's (Ace AI changed mid-fight). */
function clampAmmo(w) {
    const tier = rivalSkill();
    w.mslAmmo = Math.min(w.mslAmmo, tier.mslAmmo); w.flareAmmo = Math.min(w.flareAmmo, tier.flareAmmo);
    if (!tier.mslAmmo) w.lock = 0;
}

function fireGuns(au, dist) {
    const w = au.wpn;
    if (w.gunAmmo <= 0 || w.gunCd > 0 || dist > RIVAL.gunRange) return;
    leadPoint(au, dist, _aim);
    _tmp.subVectors(_aim, au.group.position);
    _fwd.set(0, 0, 1).applyQuaternion(au.group.quaternion);
    if (_fwd.angleTo(_tmp) > Math.atan2(RIVAL.aimTolerance, dist) + 0.02) { w.burstLeft = 0; return; } // no solution
    if (w.burstLeft <= 0) w.burstLeft = RIVAL.burst;
    const spread = (1 - skillOf(au)) * dist * RIVAL.aimSpread;
    _aim.x += (Math.random() - 0.5) * spread; _aim.y += (Math.random() - 0.5) * spread; _aim.z += (Math.random() - 0.5) * spread;
    const damage = Math.max(1, Math.round(RIVAL.gunDamage * rivalSkill().gunDamage * difficulty().enemyDamage));
    au.firingAt = performance.now(); // multiplayer shows the ace's tracers
    if (T.local) {
        au.group.localToWorld(_muzzle.set(0, 0, 3.2));
        const n = enemyBullets.length;
        spawnEnemyBullet(_muzzle, _aim); // pooled mesh, muzzle flash, range-gated sound, flare deflection all come for free
        if (enemyBullets.length > n) {
            const b = enemyBullets[n];
            b.velocity.setLength(RIVAL.bulletSpeed + au.fl.speed); // player-grade muzzle velocity + own speed (1.2 can't catch a fleeing player)
            b.userData.damage = damage;
        }
    } else if (!T.flares && Math.random() < 0.25 + 0.45 * skillOf(au)) remoteHit?.(T.id, damage, 'gun', au); // aimed round: hit roll by skill
    w.burstLeft--;
    if (--w.gunAmmo <= 0) w.gunReload = RIVAL.gunReload;
    w.gunCd = w.burstLeft > 0 ? RIVAL.gunInterval : RIVAL.burstPause * difficulty().enemyFireInterval;
}

/** Missiles need the player held in a cone for mslLockTime — the HUD shows "ACE LOCKING" meanwhile (the tell). */
function updateMissileLock(au, dist, offBore, dt) {
    const w = au.wpn;
    const ok = w.mslAmmo > 0 && w.mslCd <= 0 && dist > RIVAL.mslRangeMin && dist < RIVAL.mslRangeMax && offBore < RIVAL.mslLockCone;
    w.lock = ok ? w.lock + dt : Math.max(0, w.lock - 2 * dt);
    if (!ok || w.lock < rivalSkill().mslLockTime) return;
    w.lock = 0; w.mslCd = RIVAL.mslCooldown;
    if (--w.mslAmmo <= 0) w.mslReload = RIVAL.mslReload;
    launchMissile(au, 1); launchMissile(au, -1); // paired, from the wingtips — like the player's
}

function launchMissile(au, side) {
    const m = new THREE.Mesh(_mslGeo, _mslMat);
    au.group.localToWorld(m.position.set(side * 5.9, -0.3, 0.5));
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(au.group.quaternion);
    m.userData = { dir, speed: RIVAL.mslLaunchSpeed, life: RIVAL.mslLife, decoyed: false, targetId: T.id, owner: au };
    m.quaternion.setFromUnitVectors(_up3, dir);
    scene.add(m); rivalMissiles.push(m);
}

function turnToward(dir, desired, maxAngle) {
    const ang = dir.angleTo(desired);
    if (ang <= maxAngle) { dir.copy(desired); return; }
    dir.lerp(desired, maxAngle / ang);
    if (dir.lengthSq() < 1e-8) dir.copy(desired);
    dir.normalize();
}

function updateRivalMissiles(dt) {
    const fuseSq = RIVAL.mslFuse ** 2, flareSq = RIVAL.mslFlareRange ** 2;
    for (let i = rivalMissiles.length - 1; i >= 0; i--) {
        const m = rivalMissiles[i], d = m.userData;
        d.life -= dt;
        d.speed = Math.min(RIVAL.mslMaxSpeed, d.speed + RIVAL.mslAccel * dt);
        const t = targetById(d.targetId, d.owner);
        // Its target's flares only spoof it in the terminal phase → timing matters, not spamming
        if (!d.decoyed && (!t || !t.alive || (t.local && state.isGameOver) || (t.flares && m.position.distanceToSquared(t.position) < flareSq))) d.decoyed = true;
        // Turn rate is capped: a hard break perpendicular to the missile makes it overshoot
        if (!d.decoyed) turnToward(d.dir, _tmp.subVectors(t.position, m.position).normalize(), RIVAL.mslTurnRate * dt);
        m.position.addScaledVector(d.dir, d.speed * dt);
        m.quaternion.setFromUnitVectors(_up3, d.dir);
        let hit = false;
        if (!d.decoyed && m.position.distanceToSquared(t.position) < fuseSq) {
            const damage = Math.max(1, Math.round(RIVAL.mslDamage * difficulty().enemyDamage));
            if (t.local) damagePlayer(damage, m.position); else remoteHit?.(t.id, damage, 'missile', d.owner);
            hit = true;
        }
        const out = d.life <= 0 || m.position.y < groundLevel || m.position.y > ceilingLevel
            || Math.abs(m.position.x) > MAP_BOUNDARY || Math.abs(m.position.z) > MAP_BOUNDARY;
        if (hit || out) { createExplosion(m.position, hit ? 0.6 : 0.3); scene.remove(m); rivalMissiles.splice(i, 1); }
    }
}

// --- HUD ---------------------------------------------------------------------------------------

/** Centre-screen callout; a new one replaces the previous. kind: threat · alert · win (style.css .rival-banner). */
function banner(text, kind) {
    if (state.isGameOver) return;
    bannerEl?.remove();
    const el = bannerEl = document.createElement('div');
    el.className = `rival-banner ${kind}`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => { el.remove(); if (bannerEl === el) bannerEl = null; }, 3500);
}

function setWarning(text) {
    if (text === warnText) return;
    warnText = text; warnEl.textContent = text; warnEl.hidden = !text;
}

function updateWarnings() {
    const missile = rivalMissiles.some(m => !m.userData.decoyed && m.userData.targetId === 'local'); // only threats to this player
    const locking = rivals.some(r => r.wpn.lock > 0 && r.ai.targetId === 'local');
    setWarning(state.isGameOver ? '' : missile ? '⚠ MISSILE — FLARES (Q) / BREAK TURN' : locking ? '⚠ ACE LOCKING ON' : '');
}

// --- Visual -----------------------------------------------------------------------------------

/** The player's airframe in dark red (or `color`) and black, scaled up so it is hittable. */
export function createRivalVisual(color = 0x7a0d12) {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 4, 12).rotateX(Math.PI / 2), body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 12).rotateX(Math.PI / 2), trim); nose.position.z = 2.6;
    const wings = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 1.5), body);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 1), trim); fin.position.set(0, 0.75, -1.8);
    const hStab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.15, 0.8), body); hStab.position.z = -1.8;
    g.add(fus, nose, wings, fin, hStab);
    g.scale.setScalar(RIVAL.scale);
    return g;
}
