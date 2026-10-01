/**
 * Ace rival: a hostile aircraft with the player's flight model and weapon kit (gun bursts, paired
 * homing missiles, flares) that hunts the player across the whole map.
 *
 *   Ace Hunt (Settings, Shift+H)  the first ace launches RIVAL.firstDelay into the run, a stronger one
 *                                 RIVAL.respawnDelay after each kill
 *   Difficulty (Settings)         Easy / Normal / Hard also picks the ace tier — config.js RIVAL_SKILL, read live
 *   H                             spawn one ace now (debug / on demand)
 *
 * The ace is an ordinary AirUnit in `airUnits`, so bullets, missiles, the lock-on reticle, the
 * spatial grid, the minimap and kill rewards work without changes. ai.js hands it to updateRival()
 * instead of the generic velocity/orbit movement.
 *
 * Sensors: the ace attacks only what it has seen — a target inside the tier's visualRange and the forward sight
 * cone (or very close) — and keeps it while it stays within trackFactor × visualRange. Until then an Ace Hunt ace
 * gets a rough radar ping every scanInterval (RIVAL.pingError off; a target below groundLevel + radarFloor is
 * masked), flies to the area and searches; a team bot (quiet) patrols the map instead. Hurt or out of ammo, it
 * patrols towards pickups.
 * Aces collide with other aircraft (both explode), gain XP from kills and markers (levels: HP, skill, full ammo)
 * and heal on collectibles. Farming aces (team bots) attack the enemy bases' units whenever no enemy pilot is close,
 * for XP: guns, plus bombs and napalm on ground units from a level run (the kill pays the bot, not the player).
 */
import { MAP_BOUNDARY, RIVAL, acceleration, bombAoERadius, bombDamage, ceilingLevel, deceleration, gravity, groundLevel, maxPitchRate, maxRollRate, maxSpeed, maxYawRate, minSpeed, napalmDamage, napalmRadius, rotAccel, waterLevel } from '../config.js';
import { state } from '../state.js';
import { scene } from '../core/scene.js';
import { _up3 } from '../core/scratch.js';
import { plane } from '../player/plane.js';
import { airUnits, collectibles, enemyBullets, groundUnits, markers, missiles } from './registry.js';
import { pointsHit } from '../combat/hitShapes.js';
import { beginHits } from '../combat/hits.js';
import { canDamageGround, groundUnitWorldPos } from '../combat/damage.js';
import { _bombBodyGeo, _napClusterOrbGeo, _napClusterOrbMat, bombMaterial } from '../combat/resources.js';
import { spawnEnemyBullet } from '../combat/enemyBullets.js';
import { damagePlayer } from '../combat/collision.js';
import { createExplosion } from '../effects/effects.js';
import { createUnitLabel, updateUnitLabel } from '../ui/labels.js';
import { showNotification } from '../ui/notifications.js';
import { destroyAirUnit } from './airUnits.js';
import { difficulty, onSettingChange, rivalSkill, setSetting, settings } from '../core/settings.js';
import { RULES } from '../game/rules.js';
import { heightAt } from '../world/terrain.js';
import { aceGeo } from './models.js';
import { kitMaterial } from '../core/meshkit.js';
import { markShared } from '../core/utils.js';
import { MISSILE_CLOSE, THREAT, reportThreat } from '../ui/threatTone.js';
import { runHooks } from '../game/hooks.js';

// --- Targets: who the aces hunt ----------------------------------------------------------------------------
// By default only the local player. Multiplayer's host adds the other players (setRivalTargets): an ace hunts the
// nearest living target, and hits on a remote one are handed to `remoteHit` (that player applies the damage).
const localTarget = {
    id: 'local', local: true, position: plane.position, quaternion: plane.quaternion,
    get speed() { return state.speed; }, get alive() { return !state.isGameOver && !state._playerDown; }, get flares() { return state.flareTimer > 0; },
};
let targetsFn = () => [localTarget], remoteHit = null, trafficFn = () => [];
/** targets(ace): [{ id, local, position, quaternion, speed, alive, flares }] that ace may hunt; onRemoteHit(targetId, damage, weapon, ace);
 *  traffic(): positions of other pilots to keep clear of (remote players, whatever their team). */
export function setRivalTargets(targets, onRemoteHit, traffic) { targetsFn = targets || (() => [localTarget]); remoteHit = onRemoteHit || null; trafficFn = traffic || (() => []); }
export const localRivalTarget = localTarget;
let T = localTarget; // the target of the ace being updated this frame
/** The target the ace can see: keeps a spotted one while in tracking range, else the nearest newly spotted, else null. */
function acquire(au, tier, range = tier.visualRange) {
    const pos = au.group.position, cur = au.ai.targetId != null ? targetById(au.ai.targetId, au) : null;
    if (cur && cur.alive && cur.position.distanceTo(pos) < range * RIVAL.trackFactor) return cur;
    const cosCone = Math.cos(RIVAL.sightCone);
    let best = null, bestD = Infinity;
    for (const t of targetsFn(au)) {
        if (!t.alive) continue;
        _tmp.subVectors(t.position, pos);
        const d = _tmp.length();
        if (d > range || d >= bestD) continue;
        if (d > RIVAL.nearAwareness && _fwd.dot(_tmp.divideScalar(d)) < cosCone) continue; // behind or beside: not seen
        best = t; bestD = d;
    }
    au.ai.targetId = best ? best.id : null;
    return best;
}
/** Radar intel for an Ace Hunt ace: the nearest target it may hunt, or null. */
function nearestTarget(au) {
    let best = null, bestD = Infinity;
    for (const t of targetsFn(au)) {
        const d = t.alive ? t.position.distanceToSquared(au.group.position) : Infinity;
        if (d < bestD) { bestD = d; best = t; }
    }
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
const _tmp = new THREE.Vector3(), _tmp2 = new THREE.Vector3(), _qInv = new THREE.Quaternion(), _hitA = new THREE.Vector3(), _hitB = new THREE.Vector3();

// Session bookkeeping
const rivals = [];          // every ace spawned and not yet reaped
const rivalMissiles = [];   // hostile homing missiles in flight
let activeRival = null, aceLevel = 0, acesDowned = 0, respawnTimer = RIVAL.firstDelay;
const warnEl = document.getElementById('rival-warning');
let warnText = '', bannerEl = null;

onSettingChange((key, value) => {
    if (key === 'aceHunt' && value && !activeRival && state._gameElapsed >= RIVAL.firstDelay) respawnTimer = Math.min(respawnTimer, ENABLE_DELAY);
    if (key === 'difficulty') for (const r of rivals) clampAmmo(r.wpn); // a lower tier takes away missiles/flares at once
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
    au.level = aceLevel;
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
            bombs: RIVAL.bombs, napalm: RIVAL.napalm, bombReload: RIVAL.bombReload, bombCd: 0,
        },
        ai: {
            mode: 'hunt', timer: 0, react: 0, evadeCd: 0, scan: 0, sinceFix: 0, contact: false, waypoint: null,
            lastKnown: plane.position.clone(), lastVel: new THREE.Vector3(), breakDir: new THREE.Vector3(),
        },
    };
}

/**
 * An ace outside Ace Hunt (e.g. multiplayer team bots): no banners, own level and colour. `waypoint`: where it flies
 * first — with `rally`, it takes no target on the way (bar a pilot right on top of it) until it gets there;
 * `patrol`: { center, radius } for the waypoints after that. `friendly` aces are on the
 * player's side: the player's weapons, lock-on and minimap treat them as allies. Returns the air unit.
 */
export function spawnAce({ callsign, level = 1, position, heading = 0, color, friendly = false, blipColor, xp = RIVAL.xpPerAce * level, waypoint = null, patrol = null, farms = false, rally = false }) {
    const group = createRivalVisual(color);
    group.position.copy(position); group.rotation.set(0, heading, 0);
    scene.add(group);
    const tier = rivalSkill(), hp = Math.round(RIVAL.baseHp * tier.hp * (1 + RIVAL.hpPerAce * (level - 1)));
    const label = createUnitLabel(callsign, level, hp, hp); scene.add(label.sprite);
    const au = makeAce({ callsign, group, hp, label, xp, tier });
    Object.assign(au, { quiet: true, friendly, isHostile: !friendly, blipColor, blipLabel: callsign, level });
    au.ai.sinceFix = RIVAL.searchTime; // no intel at spawn: patrol until something is spotted
    if (waypoint) au.ai.waypoint = waypoint.clone(); // first leg of the patrol (e.g. multiplayer's flag)
    if (waypoint && rally) au.ai.rally = waypoint.clone(); // go there before taking any target
    au.patrol = patrol; // { center: Vector3, radius }: where later waypoints fall (default: the middle of the map)
    au.farms = farms;   // attacks enemy units for XP when no enemy pilot is close
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
    updateAceBombs(dt);
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
    const { ai, fl, wpn, group } = au, pos = group.position, tier = rivalSkill();
    _fwd.set(0, 0, 1).applyQuaternion(group.quaternion);
    // Rallying (a fresh team bot on its way to the flag): only a pilot right on top of it is fought; nothing else
    if (ai.rally && Math.hypot(pos.x - ai.rally.x, pos.z - ai.rally.z) < RIVAL.rallyRadius) ai.rally = null;
    let target = acquire(au, tier, ai.rally ? RIVAL.nearAwareness : tier.visualRange);
    if (au.farms && !ai.rally && (!target || target.position.distanceTo(pos) > tier.visualRange * RIVAL.farmPilotRange)) target = farmTarget(au) ?? target;
    const alive = !!target && !(target.local && state.isGameOver);
    T = target || localTarget;
    _pFwd.set(0, 0, 1).applyQuaternion(T.quaternion);
    _pVel.copy(_pFwd).multiplyScalar(T.speed);
    _toP.subVectors(T.position, pos);
    const dist = _toP.length();

    // 1. Sensors — a seen target is tracked continuously; otherwise Ace Hunt gets a rough radar ping
    ai.sinceFix += dt; ai.scan -= dt;
    if (alive) { ai.lastKnown.copy(T.position); ai.lastVel.copy(_pVel); ai.sinceFix = 0; }
    else if (!au.quiet && ai.scan <= 0) {
        ai.scan = tier.scanInterval;
        const t = nearestTarget(au);
        if (t && t.position.y > groundLevel + RIVAL.radarFloor) {
            ai.lastKnown.copy(t.position).add(_tmp.set(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(2 * RIVAL.pingError));
            ai.lastVel.set(0, 0, 0); ai.sinceFix = 0;
        }
    }
    if (alive && !ai.contact && T.local && !au.quiet) banner(`⚠ ACE ${au.callsign.toUpperCase()} — VISUAL CONTACT`, 'alert');
    ai.contact = alive;
    tickWeapons(wpn, dt);
    if ((ai.pickupScan = (ai.pickupScan ?? 0) - dt) <= 0) { ai.pickupScan = 10; usePickups(au); }

    // 2. Decide: engage (target in sight) · hunt (flying to where it was seen / pinged) · patrol · evade (timed break)
    ai.timer -= dt; ai.react -= dt; ai.evadeCd -= dt;
    checkThreats(au, dist, alive);
    if (ai.mode === 'evade' && ai.timer <= 0) ai.evadeCd = RIVAL.evadeCooldown;
    if (ai.mode !== 'evade' || ai.timer <= 0) ai.mode = alive ? 'engage' : ai.sinceFix < RIVAL.searchTime ? 'hunt' : 'patrol';

    // 3. Where the nose should point
    if (ai.mode === 'evade') _des.copy(ai.breakDir);
    else if (ai.mode === 'engage' && bombRun(au)) _des.set(_toP.x, 0, _toP.z);                       // level run over the target
    else if (ai.mode === 'engage' && T.unit && !T.unit.group && dist < RIVAL.strafeBreak) _des.set(_fwd.x, 0.7, _fwd.z); // strafing run: pull out in time
    else if (ai.mode === 'engage') leadPoint(au, dist, _des).sub(pos);
    else if (ai.mode === 'hunt') _des.copy(ai.lastKnown).addScaledVector(ai.lastVel, Math.min(ai.sinceFix, 240)).sub(pos);
    else _des.copy(patrolPoint(au)).sub(pos);
    if (_des.lengthSq() < 1e-6) _des.copy(_fwd);
    _des.normalize();
    avoidTraffic(au, _des);
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
        destroyAirUnit(au, { reward: !au.quiet }); // Ace Hunt: counts as the player's kill
        return;
    }
    // Mid-air collision with any other aircraft: both explode, like the player on a direct impact
    const span = RIVAL.wingHalfSpan * 0.8;
    _tmp2.set(1, 0, 0).applyQuaternion(group.quaternion);
    const pts = [[pos, 4], [_hitA.copy(pos).addScaledVector(_tmp2, span), 2.5], [_hitB.copy(pos).addScaledVector(_tmp2, -span), 2.5]];
    for (const other of airUnits) {
        if (other === au || other.proxy || !(other.hp > 0)) continue;
        // its centre and wingtips against the other aircraft's real shape (combat/hitShapes.js)
        if (pointsHit(other.group, pts)) { if (other.isBoss) { au.crashed = true; destroyAirUnit(au, { reward: false }); } else midAir(au, other); return; } // into a boss: only the ace goes down
    }

    // 6. Weapons
    if (alive && ai.mode === 'engage' && bombRun(au)) tryBombRelease(au);
    if (alive && ai.mode === 'engage') { fireGuns(au, dist); if (!T.unit) updateMissileLock(au, dist, offBore, dt); else wpn.lock = 0; } // units: guns only
    else wpn.lock = 0;
}

// --- Flight -----------------------------------------------------------------------------------

// Largest rate from which the ace can still stop on target with rotAccel (bang-bang braking curve)
const ACE_ROT_ACCEL = rotAccel * RIVAL.rotAccelScale;
const rateFor = (err, max) => Math.sign(err) * Math.min(max, Math.sqrt(2 * ACE_ROT_ACCEL * Math.abs(err)) * 0.85);
const approach = (rate, target, dt) => rate + THREE.MathUtils.clamp(target - rate, -ACE_ROT_ACCEL * dt, ACE_ROT_ACCEL * dt);

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

/**
 * Keep clear of other aircraft, the player and other pilots (trafficFn) included — except a pilot being attacked:
 * steer away from anything within RIVAL.separation.
 */
function avoidTraffic(au, des) {
    const pos = au.group.position, sepSq = RIVAL.separation ** 2, attacking = au.ai.mode === 'engage' && !T.unit ? T.position : null;
    _tmp2.set(0, 0, 0);
    const away = p => {
        if (p === attacking) return; // a pilot it attacks: closes in (a unit: keeps clear)
        _tmp.subVectors(pos, p);
        const dSq = _tmp.lengthSq();
        if (dSq < sepSq && dSq > 1e-6) _tmp2.addScaledVector(_tmp, (sepSq - dSq) / (sepSq * Math.sqrt(dSq))); // stronger the closer it is
    };
    for (const other of airUnits) if (other !== au && other.hp > 0 && !other.proxy) away(other.group.position);
    if (!state.isGameOver && !state._playerDown) away(plane.position);
    for (const p of trafficFn()) away(p);
    if (_tmp2.lengthSq() > 0) des.addScaledVector(_tmp2, 1.5).normalize();
}

/** Bend the desired heading away from the floor, ceiling and map edge (1 s look-ahead). */
function applySafety(au, des) {
    const p = au.group.position;
    _tmp.set(0, 0, 1).applyQuaternion(au.group.quaternion);
    const ahead = au.fl.speed * 60 * RIVAL.safetyLookahead, yAhead = p.y + _tmp.y * ahead;
    // Floor: the terrain under the ace, halfway and all the way along its look-ahead (its gentle pitch rate needs room)
    const floor = Math.max(heightAt(p.x, p.z), heightAt(p.x + _tmp.x * ahead / 2, p.z + _tmp.z * ahead / 2), heightAt(p.x + _tmp.x * ahead, p.z + _tmp.z * ahead)) + RIVAL.groundMargin, roof = ceilingLevel - RIVAL.ceilingMargin;
    if (p.y < floor || yAhead < floor) des.y = Math.max(des.y, _tmp.y < -0.2 ? 0.9 : 0.5); // diving: pull harder
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

function checkThreats(au, dist, seen) {
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
    if (!seen) return; // the rest reacts to the target it can see
    // Head-on merge / ram avoidance
    if (dist < 35 || (dist < 90 && !T.unit && _fwd.dot(_pFwd) < -0.5)) {
        startBreak(au, _tmp.subVectors(pos, T.position).normalize(), 40, true);
        return;
    }
    // Player's nose is on the ace inside gun range → break turn
    if (tier.evades && !T.unit && ai.mode !== 'evade' && ai.evadeCd <= 0 && dist < RIVAL.gunRange && reacts) { // units don't aim like pilots
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
    w.gunCd -= dt; w.mslCd -= dt; w.bombCd -= dt; w.flareTimer = Math.max(0, w.flareTimer - dt);
    if ((w.bombs < RIVAL.bombs || w.napalm < RIVAL.napalm) && (w.bombReload -= dt) <= 0) {
        w.bombReload = RIVAL.bombReload; w.bombs = Math.min(RIVAL.bombs, w.bombs + 1); w.napalm = Math.min(RIVAL.napalm, w.napalm + 1);
    }
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
    const size = T.unit ? (T.unit.collisionRadius ?? T.unit.userData?.collisionRadius ?? 0) * 0.5 : 0; // units are big: a looser solution
    if (_fwd.angleTo(_tmp) > Math.atan2(RIVAL.aimTolerance + size, dist) + 0.02) { w.burstLeft = 0; return; } // no solution
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
    } else if (T.unit) { // an enemy base's unit: hit roll, and the bot is paid for the kill
        if (Math.random() < 0.3 + 0.5 * skillOf(au)) {
            const hits = beginHits('bullet', { shooter: au });
            hits.damage(T.unit, damage);
            const { xp } = hits.finish();
            if (xp) rewardAce(au, Math.round(xp * RIVAL.farmXp));
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

// --- Patrol, pickups, growth, collisions ------------------------------------------------------

/** Farming: the nearest enemy unit a gun can hurt (re-chosen every second), as a target, or null. */
const _still = new THREE.Quaternion();
function farmTarget(au) {
    const ai = au.ai, pos = au.group.position, live = f => f && f.alive;
    if (live(ai.farm) && (ai.farmScan = (ai.farmScan ?? 0) - 1) > 0) return ai.farm;
    ai.farmScan = 60;
    let best = null, bestD = RIVAL.farmRange ** 2;
    for (const u of groundUnits) {
        if (!u.userData.isHostile || !(canDamageGround(u, 'bullet') || (hasBombs(au) && canDamageGround(u, 'bomb')))) continue; // hangars: bombs only
        const d = groundUnitWorldPos(u).distanceToSquared(pos) * (hasBombs(au) ? 0.36 : 1); // with bombs aboard, ground targets first
        if (d < bestD) { bestD = d; best = u; }
    }
    for (const a of airUnits) {
        if (a.isRival || a.proxy || a.friendly || !a.isHostile || !(a.hp > 0)) continue;
        const d = a.group.position.distanceToSquared(pos) * 1.7; // aircraft are harder prey: a little further down the list
        if (d < bestD) { bestD = d; best = a; }
    }
    if (!best) return (ai.farm = null);
    if (ai.farm?.unit === best) return ai.farm;
    const air = !!best.group;
    return (ai.farm = {
        id: `unit:${air ? best.id : best.userData.id}`, local: false, unit: best, flares: false,
        position: air ? best.group.position : groundUnitWorldPos(best), quaternion: air ? best.group.quaternion : _still,
        get speed() { return air && best.velocity ? best.velocity.length() : 0; },
        get alive() { return air ? best.hp > 0 && airUnits.includes(best) : canDamageGround(best, 'bomb'); },
    });
}

// --- Bombs and napalm (farming aces) --------------------------------------------------------------
const aceBombs = []; // { mesh, v, weapon, owner }
const hasBombs = au => au.wpn.bombs > 0 || au.wpn.napalm > 0;
/** A bombing run: a ground unit as the target, something to drop, and enough height above it. */
const bombRun = au => !!T.unit && !T.unit.group && hasBombs(au) && au.group.position.y - T.position.y > RIVAL.bombMinHeight;

/** Release when the predicted impact (level flight, gravity only) lands on the target. */
function tryBombRelease(au) {
    const w = au.wpn, pos = au.group.position;
    if (w.bombCd > 0) return;
    _tmp.set(0, 0, 1).applyQuaternion(au.group.quaternion).multiplyScalar(au.fl.speed); // bomb starts with the plane's velocity
    const h = pos.y - T.position.y, t = (_tmp.y + Math.sqrt(Math.max(0, _tmp.y * _tmp.y + 2 * gravity * h))) / gravity;
    _tmp2.set(pos.x + _tmp.x * t - T.position.x, 0, pos.z + _tmp.z * t - T.position.z);
    if (_tmp2.length() > RIVAL.bombAim) return;
    const weapon = w.napalm > 0 && (w.bombs === 0 || Math.random() < 0.35) ? 'napalm' : 'bomb';
    if (weapon === 'napalm') w.napalm--; else w.bombs--;
    w.bombCd = RIVAL.bombInterval;
    const mesh = weapon === 'bomb' ? new THREE.Mesh(_bombBodyGeo, bombMaterial) : new THREE.Mesh(_napClusterOrbGeo, _napClusterOrbMat);
    if (weapon === 'napalm') mesh.scale.setScalar(2.2);
    mesh.position.copy(pos).addScaledVector(WORLD_UP, -1.5);
    scene.add(mesh);
    const v = _tmp.clone();
    aceBombs.push({ mesh, v, weapon, owner: au });
    runHooks('aceDropped', au, weapon, mesh.position, v);
}

/** Falling bombs and napalm: on the ground or water they burst, damaging the ground units around (the ace is paid). */
function updateAceBombs(dt) {
    for (let i = aceBombs.length - 1; i >= 0; i--) {
        const b = aceBombs[i], p = b.mesh.position;
        b.v.y -= gravity * dt;
        p.addScaledVector(b.v, dt);
        if (b.v.lengthSq() > 1e-6) b.mesh.lookAt(_tmp.copy(p).add(b.v));
        if (p.y > Math.max(heightAt(p.x, p.z), waterLevel)) continue;
        scene.remove(b.mesh); aceBombs.splice(i, 1);
        const napalm = b.weapon === 'napalm', radius = napalm ? napalmRadius : bombAoERadius;
        createExplosion(p, napalm ? 1.6 : 1.2);
        const hits = beginHits(b.weapon, { shooter: b.owner });
        for (const u of groundUnits) {
            if (!u.userData.isHostile) continue;
            const d = groundUnitWorldPos(u).distanceTo(p);
            if (d < radius + (u.userData.collisionRadius ?? 0) * 0.5) hits.damage(u, Math.round((napalm ? napalmDamage : bombDamage) * (1 - 0.5 * Math.min(1, d / radius))));
        }
        const { xp } = hits.finish();
        if (xp) rewardAce(b.owner, Math.round(xp * RIVAL.farmXp));
        runHooks('aceImpact', b.weapon, p);
    }
}

/** Patrol: the nearest pickup when hurt or dry, else random waypoints over the middle of the map. */
function patrolPoint(au) {
    const ai = au.ai, pos = au.group.position;
    if (ai.rally) return ai.rally; // straight to the rally point first
    if (au.hp < au.maxHp * 0.5 || (au.wpn.gunAmmo <= 0 && au.wpn.mslAmmo <= 0)) {
        let best = null, bestD = 1500 ** 2;
        for (const c of collectibles) { const d = c.position.distanceToSquared(pos); if (d < bestD) { bestD = d; best = c; } }
        if (best) return best.position;
    }
    if (!ai.waypoint || ai.waypoint.distanceToSquared(pos) < 200 ** 2) {
        const c = au.patrol?.center, r = au.patrol?.radius ?? MAP_BOUNDARY * RIVAL.patrolRadius;
        ai.waypoint = new THREE.Vector3((c?.x ?? 0) + (Math.random() * 2 - 1) * r, (groundLevel + ceilingLevel) / 2 + (Math.random() - 0.3) * 60, (c?.z ?? 0) + (Math.random() * 2 - 1) * r);
    }
    return ai.waypoint;
}

/** Collectibles heal (and give a missile back), markers give XP. Aces don't take them away from the players. */
function usePickups(au) {
    const pos = au.group.position, now = state._gameElapsed ?? 0, r2 = RIVAL.pickupRange ** 2, used = au.pickups ??= new Map();
    const fresh = item => now - (used.get(item) ?? -Infinity) > RIVAL.pickupCooldown && item.position.distanceToSquared(pos) < r2;
    for (const c of collectibles) {
        if (!fresh(c)) continue;
        used.set(c, now);
        au.hp = Math.min(au.maxHp, au.hp + 15);
        au.wpn.mslAmmo = Math.min(rivalSkill().mslAmmo, au.wpn.mslAmmo + 1);
        updateUnitLabel(au.label, au.hp);
    }
    for (const m of markers) if (fresh(m)) { used.set(m, now); rewardAce(au, 15); }
}

/** XP for an ace (kills, markers): each level adds HP, skill and a full load of ammo. */
export function rewardAce(au, xp) {
    if (!au || !(au.hp > 0)) return;
    au.xp = (au.xp ?? 0) + xp;
    for (let need = RIVAL.xpPerLevel * (au.level ?? 1); au.xp >= need && (au.level ?? 1) < RIVAL.maxLevel; need = RIVAL.xpPerLevel * au.level) {
        au.xp -= need;
        au.level = (au.level ?? 1) + 1;
        const add = Math.round(au.maxHp * 0.15), tier = rivalSkill();
        au.maxHp += add; au.hp = Math.min(au.maxHp, au.hp + add + Math.round(au.maxHp * 0.2));
        Object.assign(au.wpn, { gunAmmo: RIVAL.gunAmmo, gunReload: 0, mslAmmo: tier.mslAmmo, mslReload: 0, flareAmmo: tier.flareAmmo, flareReload: 0 });
        au.label.level = au.level; au.label.maxHp = au.maxHp; updateUnitLabel(au.label, au.hp);
        runHooks('aceLevelUp', au);
    }
}

/** Two aircraft met: both go down (no reward). Shared enemy units report it like a hit, so other players see it too. */
function midAir(au, other) {
    createExplosion(_tmp.lerpVectors(au.group.position, other.group.position, 0.5), 1.5);
    au.crashed = true;
    destroyAirUnit(au, { reward: false });
    if (other.isRival) other.crashed = true;
    else runHooks('unitHit', other, other.hp, 'missile'); // multiplayer co-op: the others destroy their copy
    other.hp = 0;
    destroyAirUnit(other, { reward: false });
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
    // Only threats to this player: missiles after it, and aces locking on to it
    let missileDist = Infinity, lock = 0;
    for (const m of rivalMissiles) if (!m.userData.decoyed && m.userData.targetId === 'local') missileDist = Math.min(missileDist, m.position.distanceTo(plane.position));
    const lockTime = rivalSkill().mslLockTime || 1;
    for (const r of rivals) if (r.wpn.lock > 0 && r.ai.targetId === 'local') lock = Math.max(lock, r.wpn.lock / lockTime);
    const missile = missileDist < Infinity;
    setWarning(state.isGameOver ? '' : missile ? '⚠ MISSILE — FLARES (Q) / BREAK TURN' : lock > 0 ? '⚠ ACE LOCKING ON' : '');
    // The warning tone: slow beeps while an ace locks, fast once (almost) locked or a missile is up, solid when it's close
    reportThreat('aces', missile ? (missileDist < MISSILE_CLOSE ? THREAT.missile : THREAT.locked) : lock > 0.6 ? THREAT.locked : lock > 0 ? THREAT.locking : THREAT.none);
}

// --- Visual -----------------------------------------------------------------------------------

const aceMats = new Map(); // colour → kit material (shared by every ace in that colour)
/** The ace airframe (entities/models.js aceGeo) tinted dark red, or `color`, scaled up so it is hittable. */
export function createRivalVisual(color = 0x9a1a22) {
    if (!aceMats.has(color)) aceMats.set(color, markShared(kitMaterial({ color, metalness: 0.3, roughness: 0.55 }))); // never disposed with an ace
    const g = new THREE.Group();
    g.add(new THREE.Mesh(aceGeo, aceMats.get(color)));
    g.scale.setScalar(RIVAL.scale);
    return g;
}
