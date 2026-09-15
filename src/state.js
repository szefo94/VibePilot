/** Mutable session state shared between systems (player stats, flight rates, ammo, timers). */
import { BOMB_MAX_AMMO, FLARE_MAX_AMMO, GRACE_PERIOD, GUN_MAX_AMMO, MISSILE_MAX_AMMO, NAPALM_MAX_AMMO, TARGET_FPS } from './config.js';
import { storageGetInt } from './core/storage.js';
import { difficulty } from './core/settings.js';

export const state = {
    // Minimap / radar timers
    _minimapTimer: 0, // seconds since last minimap redraw (§2.5)
    _radarSweepAngle: -Math.PI / 2, // radar sweep — starts at top (north)
    _radarCycleTimer: 3.0, // trigger snapshot immediately on first frame
    // Player
    score: 0,
    planeHP: 100,
    level: 1,
    xp: 0,
    xpToNextLevel: 100,
    playerDamageMultiplier: 1,
    // Control flow
    isGameOver: false,
    isPaused: false,
    awaitingStart: true, // start menu showing; game/session.js clears it (or ?autostart)
    // Interceptor event
    _gameElapsed: 0, // seconds-equivalent (frame units at 60 fps)
    _interceptorTimer: (60 + Math.random() * 60) * TARGET_FPS * difficulty().interceptorDelay, // first wave: 1–2 min (× difficulty)
    _interceptorWave: 0,
    // Game-over free-look orbit
    _goOrbitYaw: 0,
    _goOrbitPitch: 0.3,
    // Flight rates
    pitchRate: 0,
    rollRate: 0,
    yawRate: 0,
    speed: .1,
    // Weapons: cooldowns, ammo, reload timers
    shootCooldown: 0,
    bombCooldown: 0,
    gunMaxAmmo: GUN_MAX_AMMO,
    gunAmmo: GUN_MAX_AMMO,
    gunReloadTimer: 0,
    bombMaxAmmo: BOMB_MAX_AMMO,
    bombAmmo: BOMB_MAX_AMMO,
    bombReloadTimer: 0,
    missileMaxAmmo: MISSILE_MAX_AMMO,
    missileAmmo: MISSILE_MAX_AMMO,
    missileReloadTimer: 0,
    flareMaxAmmo: FLARE_MAX_AMMO,
    flareAmmo: FLARE_MAX_AMMO,
    flareReloadTimer: 0,
    flareTimer: 0,
    napalmMaxAmmo: NAPALM_MAX_AMMO,
    napalmAmmo: NAPALM_MAX_AMMO,
    napalmReloadTimer: 0,
    // Kill-streak multiplier
    _scoreMulti: 1,
    _multiDisplayTimer: 0,
    // Persistent high score
    _highScore: storageGetInt('vibepilot_hs'),
    // Empty-clip flash (frames)
    _emptyClipFlash: 0,
    // Debrief sampling and collectible pulse
    _statTimer: 60,
    _heartbeatPhase: 0, // drives emissive glow pulse on all heart collectibles
    // Debug
    debugCollision: false,
    // Timers
    _hitMarkerTimer: 0, // frames remaining for hit-confirm crosshair (idea 4)
    _killMarkerTimer: 0, // frames the hit marker shows the kill confirmation
    _playerBlinkTimer: 0, // frames remaining for plane red-blink on damage (idea 3)
    _graceTimer: GRACE_PERIOD, // seconds of spawn invincibility remaining
    _mouseNDC: { x: 0, y: 0 }, // mouse position in normalized device coords for steering
    _memDebugTimer: 0,
    // Spawn name counters
    aibaseIdx: 0,
    forwardBaseIdx: 0,
    fleetIdx: 0,
    squadronIdx: 0,
    hoverWingIdx: 0,
    strikeWingIdx: 0,
};
