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
