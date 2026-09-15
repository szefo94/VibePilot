/** Cached references to static HUD elements in index.html. */
// --- UI Elements & Minimap ---
export const scoreElement = document.getElementById('score'), hpElement = document.getElementById('hp'), gameOverElement = document.getElementById('game-over'), pausedElement = document.getElementById('paused'), enemyDistanceElement = document.getElementById('enemy-distance'), groundDistanceElement = document.getElementById('ground-distance'), markerDistanceElement = document.getElementById('marker-distance'), posXElement = document.getElementById('pos-x'), posYElement = document.getElementById('pos-y'), posZElement = document.getElementById('pos-z'), rotHdgElement = document.getElementById('rot-hdg'), rotPchElement = document.getElementById('rot-pch'), rotBnkElement = document.getElementById('rot-bnk'), levelElement = document.getElementById('level'), xpElement = document.getElementById('xp'), xpToNextLevelElement = document.getElementById('xp-to-next-level'), bulletDamageValueElement = document.getElementById('bullet-damage-value'), ratePitchPos = document.getElementById('rate-pitch-pos'), ratePitchNeg = document.getElementById('rate-pitch-neg'), ratePitchVal = document.getElementById('rate-pitch-val'),
    rateRollPos  = document.getElementById('rate-roll-pos'),  rateRollNeg  = document.getElementById('rate-roll-neg'),  rateRollVal  = document.getElementById('rate-roll-val'),
    rateYawPos   = document.getElementById('rate-yaw-pos'),   rateYawNeg   = document.getElementById('rate-yaw-neg'),   rateYawVal   = document.getElementById('rate-yaw-val'),
    speedBarEl   = document.getElementById('speed-bar');
export const hitMarkerEl    = document.getElementById('hit-marker');
export const _steerCursorEl = document.getElementById('steer-cursor');
export const memDebugEl  = document.getElementById('memory-debug');
export const gunBarEl = document.getElementById('gun-bar'), gunStatusEl = document.getElementById('gun-status');
export const bombBarEl = document.getElementById('bomb-bar'), bombStatusEl = document.getElementById('bomb-status');
export const missileBarEl = document.getElementById('missile-bar'), missileStatusEl = document.getElementById('missile-status');
export const flareBarEl = document.getElementById('flare-bar'), flareStatusEl = document.getElementById('flare-status');
export const napalmBarEl = document.getElementById('napalm-bar'), napalmStatusEl = document.getElementById('napalm-status');
