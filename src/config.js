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
