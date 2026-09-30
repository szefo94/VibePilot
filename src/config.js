/** Tuning constants: world bounds, flight model, weapons, enemies. Timers are in frames at 60 fps unless noted. */
// --- Named Constants (§3.1) ---
export const TARGET_FPS           = 60;      // delta-time normalisation factor (§3.6)
export const MAP_BOUNDARY         = 2000;
export const groundLevel          = -50;
export const ceilingLevel         = 150;
export const waterLevel           = groundLevel + 0.5;
// Notifications
export const NOTIF_SLOT_HEIGHT    = 52;      // px per notification slot
export const NOTIF_MAX_SLOTS      = 5;
export const NOTIF_DURATION_MS    = 8500;
// Minimap
export const MINIMAP_VIEW_RANGE   = 750;     // world units visible on minimap
export const MINIMAP_REFRESH_S    = 1 / 15; // minimap refresh rate in seconds (§2.5)
// Bullets
export const ENEMY_BULLET_POOL_SIZE = 60;   // pre-allocated enemy bullet meshes (§2.4)
// Spawn
export const GRACE_PERIOD = 5.0;            // seconds of invincibility after game start
// Player HP: grows with every level (game/progression.js)
export const PLAYER_BASE_HP = 100, HP_PER_LEVEL = 5;
// Intro
export const SPLASH_ENABLED = false;      // typewriter intro (src/ui/splash.js); the simulation waits until it is dismissed

// --- Flight Config (easy-edit tuning knobs) ---
export const maxSpeed = .8, minSpeed = .02;
export const acceleration = .003, deceleration = .002, naturalDeceleration = .0005;
export const maxPitchRate = .025, maxRollRate = .035, maxYawRate = .030;
export const rotAccel = .00085;
export const rotDamping = .85;
// --- Mouse-aim steering ---
export const MOUSE_STEERING      = true;  // set false to disable War Thunder-style mouse aim
export const STEER_MAX_TURN_RATE = 0.022; // rad per dt-unit — max angular speed toward cursor
export const STEER_SMOOTHING     = 0.14;  // exponential approach factor per dt (higher = snappier)
export const STEER_CURSOR_RADIUS = 0.72;  // NDC radius of the effective steering circle
export const STEER_MAX_ANGLE     = Math.PI * 0.35; // max steering angle at full cursor radius (~63°)
export const STEER_AUTO_BANK_K   = 9.0;   // horizontal turn rate → desired bank ratio
export const STEER_BANK_SMOOTH   = 0.10;  // bank convergence rate per dt
export const STEER_DEADZONE      = 0.06;  // NDC radius within which cursor is treated as centered
export const STEER_LEVEL_RATE    = 0.018; // pitch leveling rate per dt when cursor is centered
export const STEER_RETURN_DECAY  = 0.028; // per-dt decay rate — cursor drifts back to center when mouse idle
export const bulletDamage = 1, bombDamage = 40, bombAoERadius = 50, bulletSpeed = 1.8, bulletLife = 150, shootCooldownTime = 4;
// --- Ammo system (§5.7) ---
export const GUN_MAX_AMMO = 60, GUN_RELOAD_TIME = 180;   // reload ~3 s at 60 fps (dt units)
export const BOMB_MAX_AMMO = 4,  BOMB_RELOAD_TIME = 300;  // reload ~5 s at 60 fps
export const MISSILE_MAX_AMMO = 3,  MISSILE_RELOAD_TIME = 600; // reload ~10 s
export const FLARE_MAX_AMMO = 2,    FLARE_RELOAD_TIME = 900, FLARE_DURATION = 180; // effect 3 s, reload 15 s
export const NAPALM_MAX_AMMO = 2,   NAPALM_RELOAD_TIME = 480, NAPALM_TICK_INTERVAL = 30, NAPALM_DURATION = 300;
export const missileDamage = 80, missileAoERadius = 25, missileLife = 300, missileHomingStr = 0.09;
export const MISSILE_INITIAL_SPEED = bulletSpeed * 0.5;   // 0.9 — slow on launch
export const MISSILE_FINAL_SPEED   = bulletSpeed * 2;     // 3.6 — twice gun speed at cruise
export const MISSILE_ACCEL         = 0.05;               // speed added per dt after drop phase
export const MISSILE_DROP_PHASE    = 22;                 // dt frames of downward fall before homing
export const napalmDamage = 15, napalmRadius = 55;
export const bombCooldownTime = 45;
export const gravity = .008;
export const explosionDuration = 400, explosionMaxSize = 50;

// --- Enemy setup ---
export const enemyColors = [16711680, 255, 16711935, 65535, 16747520, 15790320, 8388736];
export const enemyPartHP = 1, numEnemies = 10, enemySpeed = .05, enemyScale = 2;
export const defaultEnemyHpOffsetY = 5 * enemyScale;
export const numAirbases = 5, numForwardBases = 8, numCarrierGroups = 2, numDestroyerSquadrons = 3;
export const enemyBulletSpeed = 1.2, enemyBulletLife = 200, enemyBulletDamage = 15;
export const hostileUnitShootingRange = 600, hostileUnitShootingCooldownTime = 240;
// Enemy aim: 0 = no prediction / full random spread, 1 = perfect predictive aim
export const ENEMY_AIM_ACCURACY = 0.95; // default 70% = 30% cone inaccuracy //single constant to tune. 1.0 = perfect lead shot, 0.0 = fully random scatter
export const HOSTILE_SHOOT_RANGE_SQ = hostileUnitShootingRange * hostileUnitShootingRange; // §2.7
export const numHoverWings = 3, numStrikeWings = 2;

// --- Unit stats ---
// level: fixed, or [min, max) rolled per unit; perLevel: hp and xp are multiplied by the level
export const GROUND_UNIT_TYPES = Object.freeze({
    tank:      { name: 'Tank',      level: [1, 4], perLevel: true,  hp: 20,  xp: 35,  collisionRadius: 3.5 * 3, hpOffsetY: 1.5 * 3 + 5, hostile: true,  color: 4957216 },
    turret:    { name: 'Turret',    level: [2, 5], perLevel: true,  hp: 15,  xp: 30,  collisionRadius: 2.5 * 3, hpOffsetY: 1.5 * 3 + 5, hostile: true,  color: 3355443 },
    truck:     { name: 'Truck',     level: 1,      perLevel: false, hp: 5,   xp: 10,  collisionRadius: 3 * 2.5, hpOffsetY: 2 * 2.5 + 4, hostile: false, color: 8388608 },
    airport:   { name: 'Airbase',   level: 5,      perLevel: false, hp: 150, xp: 200, collisionRadius: 100,     hpOffsetY: 25,          hostile: false, color: 6710886 },
    destroyer: { name: 'Destroyer', level: [3, 6], perLevel: true,  hp: 40,  xp: 75,  collisionRadius: 10 * 5,  hpOffsetY: 4 * 5,       hostile: true,  color: 5592422 },
    carrier:   { name: 'Carrier',   level: 10,     perLevel: false, hp: 200, xp: 300, collisionRadius: 18 * 8,  hpOffsetY: 6 * 8,       hostile: false, color: 4473925 },
});
// Air units are modelled at 1 unit and scaled 3×; collisionRadius is the body sphere in world units.
// wing: extra sub-sphere colliders at ±halfSpan along the wing axis ('q' = group right vector, 'z' = outer Z)
export const AIR_UNIT_TYPES = Object.freeze({
    helicopter: { name: 'Helicopter', hp: 60,  xp: 80,  collisionRadius: 15, hostile: true,  wing: { halfSpan: 25, radius: 10, axis: 'z' } },
    balloon:    { name: 'Balloon',    hp: 15,  xp: 40,  collisionRadius: 21, hostile: false },
    fighter:    { name: 'Fighter',    hp: 40,  xp: 100, collisionRadius: 14, hostile: true,  level: [1, 3], wing: { halfSpan: 28, radius: 10, axis: 'q' } },
    tanker:     { name: 'Tanker',     hp: 200, xp: 200, collisionRadius: 15, hostile: false, wing: { halfSpan: 65, radius: 13, axis: 'q' } },
    ac130:      { name: 'AC-130',     hp: 150, xp: 250, collisionRadius: 20, hostile: true,  wing: { halfSpan: 70, radius: 14, axis: 'z' } },
});

// --- Difficulty presets (Settings → Difficulty) ---
// enemyDamage × enemy bullet damage · enemyFireInterval × time between enemy shots · interceptorDelay × time to interceptor waves
export const DIFFICULTY_PRESETS = Object.freeze({
    easy:   { enemyDamage: 0.5, enemyFireInterval: 1.5, interceptorDelay: 1.5 },
    normal: { enemyDamage: 1,   enemyFireInterval: 1,   interceptorDelay: 1 },
    hard:   { enemyDamage: 1.5, enemyFireInterval: 0.7, interceptorDelay: 0.7 },
});
export const MISSION_COMPLETE_BONUS = 1000; // score for eliminating every base
// Time of day (Settings, T key): presets live in world/sky.js
export const TIME_OF_DAY = Object.freeze({ day: 'Day', night: 'Night' });

// --- Ace rival (entities/rival.js) ---
// Distances in world units, times in frames at 60 fps, angles in radians. Per-tier values live in RIVAL_SKILL.
export const RIVAL = Object.freeze({
    firstDelay: 90 * 60,      // Ace Hunt: first ace launches 90 s into the run
    respawnDelay: 25 * 60,    // Ace Hunt: next ace after a kill
    spawnDist: 0.85,          // × MAP_BOUNDARY, on the far side of the map
    scale: 3,                 // the player's airframe, scaled so it is hittable
    collisionRadius: 10, wingHalfSpan: 14, wingRadius: 5,
    baseHp: 100, hpPerAce: 0.25, xpPerAce: 400,
    // Sensors: a target must be seen (in visual range and in the forward cone, or very close) before the ace attacks
    radarFloor: 25,           // player below groundLevel + this is masked from the radar ping
    sightCone: 1.1,           // rad either side of the nose the ace can spot a target in
    nearAwareness: 150,       // closer than this a target is noticed whatever the angle (engine noise, glimpse)
    trackFactor: 1.3,         // × visualRange: a spotted target is kept until it gets this far
    pingError: 300,           // Ace Hunt's radar ping is only this accurate: the ace flies to the area, then searches
    searchTime: 600,          // frames spent at the last known position before giving up and patrolling
    patrolRadius: 0.6,        // × MAP_BOUNDARY: patrol waypoints (team bots, or an ace with nothing on radar)
    rallyRadius: 250,         // a rallying ace (spawnAce rally) is there within this distance of its first waypoint
    rotAccelScale: 0.6,       // × the player's rotational acceleration: aces wind up their turns more slowly
    // Collisions and growth
    collisionScale: 0.8,      // × (sum of collision radii): aircraft this close collide and both explode
    separation: 70,           // aces steer away from other aircraft closer than this (except the one they attack)
    xpPerLevel: 250,          // × the ace's level: XP to its next level (kills, markers)
    maxLevel: 10,
    pickupRange: 18,          // flying through a collectible heals (+ a missile); a marker gives XP
    pickupCooldown: 1200,     // frames before the same ace can use the same pickup again
    // Farming (team bots, spawnAce farms): with no enemy pilot close, attack the enemy bases' units for XP
    farmRange: 1800,          // how far a bot looks for enemy units
    farmPilotRange: 0.6,      // × visualRange: an enemy pilot closer than this comes first
    farmXp: 1,                // × the unit's XP value, paid to the bot that destroys it
    strafeBreak: 170,         // a strafing run on a ground unit pulls out this close (diving further ends in the ground)
    // Bombs and napalm (farming aces, every difficulty): a level run over a ground unit, released on the computed drop point
    bombs: 2, napalm: 1,      // per load; one more of each comes back every bombReload frames
    bombReload: 1500, bombInterval: 90,
    bombMinHeight: 35,        // above the target: lower than this, it strafes instead
    bombAim: 20,              // release when the predicted impact is this close to the target
    // Flight
    fineAimAngle: 0.35, yawAuthority: 0.6,
    cornerAngle: 0.9, cornerSpeed: 0.55, parkRange: 120,
    groundMargin: 45, ceilingMargin: 20, boundaryFrac: 0.85,
    safetyLookahead: 2,       // seconds of flight checked for terrain and ceiling (its gentle pitch rate needs room)
    pursuitLead: 30,
    // Evasion
    evadeCooldown: 240, threatCone: 0.12, breakTime: [60, 120], flareDetectRange: 250,
    // Gun (player-grade muzzle velocity)
    gunRange: 350, bulletSpeed: 1.8, gunAmmo: 60, gunReload: 180,
    burst: 5, gunInterval: 5, burstPause: 50, aimTolerance: 6, aimSpread: 0.04, gunDamage: 5,
    // Missiles (paired) and flares
    mslCooldown: 480, mslReload: 1200, mslRangeMin: 120, mslRangeMax: 700, mslLockCone: 0.35,
    mslLaunchSpeed: 0.9, mslMaxSpeed: 2.6, mslAccel: 0.04, mslTurnRate: 0.035, mslLife: 360,
    mslFuse: 8, mslDamage: 35, mslFlareRange: 150,
    flareDuration: 150, flareReload: 900,
});
// Ace AI tiers (Settings → Ace AI). Each tier unlocks more of the kit and sharpens the pilot:
//   skill        chance to react on each decision tick + gun accuracy (grows per ace, capped at skillMax)
//   reactInterval frames between decisions · rateScale × the player's pitch/roll/yaw limits · speedScale × maxSpeed
//   visualRange / scanInterval  continuous tracking range / map-wide radar ping period
//   mslAmmo 0 = no missiles · mslLockTime frames on target before launch · flareAmmo 0 = no flares
//   evades       break-turns when the player's nose is on it · gunDamage / hp × base values
// Chosen by Settings → Difficulty (easy → easy, normal → medium, hard → hard; core/settings.js rivalSkill()).
export const RIVAL_SKILL = Object.freeze({
    easy:   { label: 'Easy',   skill: 0.3,  skillPerAce: 0.05, skillMax: 0.5,  reactInterval: 40, rateScale: 0.5,  speedScale: 0.85, visualRange: 450, scanInterval: 600, mslAmmo: 0, mslLockTime: 0,   flareAmmo: 0, evades: false, gunDamage: 0.7, hp: 0.8 },
    medium: { label: 'Normal', skill: 0.5,  skillPerAce: 0.07, skillMax: 0.75, reactInterval: 22, rateScale: 0.62, speedScale: 0.95, visualRange: 600, scanInterval: 360, mslAmmo: 1, mslLockTime: 150, flareAmmo: 1, evades: true,  gunDamage: 1,   hp: 1 },
    hard:   { label: 'Hard',   skill: 0.75, skillPerAce: 0.05, skillMax: 0.95, reactInterval: 10, rateScale: 0.75, speedScale: 1,    visualRange: 800, scanInterval: 180, mslAmmo: 2, mslLockTime: 90,  flareAmmo: 2, evades: true,  gunDamage: 1.3, hp: 1.25 },
});
