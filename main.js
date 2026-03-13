// --- Core Three.js Setup ---
const scene = new THREE.Scene();
const caveColor = 0x454545;
scene.background = new THREE.Color(caveColor);
scene.fog = new THREE.FogExp2(caveColor, 0.002);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 4000);
camera.position.set(0, 0, 25);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xaaaaaa, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(30, 80, 50);
scene.add(directionalLight);

// ================================================================
// --- Named Constants (§3.1) ---
// ================================================================
const TARGET_FPS           = 60;      // delta-time normalisation factor (§3.6)
const MAP_BOUNDARY         = 2000;
const groundLevel          = -50;
const ceilingLevel         = 150;
const waterLevel           = groundLevel + 0.5;
// Notifications
const NOTIF_SLOT_HEIGHT    = 52;      // px per notification slot
const NOTIF_MAX_SLOTS      = 5;
const NOTIF_DURATION_MS    = 8500;
// Minimap
const MINIMAP_VIEW_RANGE   = 750;     // world units visible on minimap
const MINIMAP_REFRESH_S    = 1 / 15; // minimap refresh rate in seconds (§2.5)
// Bullets
const ENEMY_BULLET_POOL_SIZE = 60;   // pre-allocated enemy bullet meshes (§2.4)
// Spawn
const GRACE_PERIOD = 5.0;            // seconds of invincibility after game start

// --- Environment ---
const caveWallMaterial = new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.9 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_BOUNDARY * 2, MAP_BOUNDARY * 2), caveWallMaterial);
ground.rotation.x = -Math.PI / 2; ground.position.y = groundLevel; scene.add(ground);
const water = new THREE.Mesh(new THREE.PlaneGeometry(MAP_BOUNDARY * 2, MAP_BOUNDARY * 2), new THREE.MeshStandardMaterial({ color: 0x001e3d, roughness: 0.2, metalness: 0.1 }));
water.rotation.x = -Math.PI / 2; water.position.y = waterLevel; scene.add(water);
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(MAP_BOUNDARY * 2, MAP_BOUNDARY * 2), caveWallMaterial);
ceiling.rotation.x = Math.PI / 2; ceiling.position.y = ceilingLevel; scene.add(ceiling);
// --- Islets ---
// ISLET_MODE: 'A' = midpoint displacement (organic), 'B' = Koch snowflake (geometric)
const ISLET_MODE          = 'A';
const ISLET_ITERATIONS    = 4;    // A: 4 → 128 pts | B: 3 → 192 pts
const ISLET_ROUGHNESS     = 0.35; // A only — radial displacement scale (0.2 = subtle, 0.5 = jagged)

const islets = [];
const isletMaterial = new THREE.MeshStandardMaterial({ color: 0x556B2F });

// Generate fractal polygon in world space, centred at (cx, cz) with given radius.
// Returns array of { x, z } world-space points forming a closed polygon.
function _generateIsletPolygon(cx, cz, radius) {
    if (ISLET_MODE === 'B') {
        // --- Koch snowflake ---
        let pts = [];
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 - Math.PI / 6;
            pts.push({ x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius });
        }
        for (let iter = 0; iter < ISLET_ITERATIONS; iter++) {
            const next = [];
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length];
                const p1 = { x: a.x + (b.x - a.x) / 3,       z: a.z + (b.z - a.z) / 3 };
                const p2 = { x: a.x + (b.x - a.x) * 2 / 3,   z: a.z + (b.z - a.z) * 2 / 3 };
                const dx = p2.x - p1.x, dz = p2.z - p1.z;
                const peak = { x: p1.x + dx * 0.5 - dz * 0.866, z: p1.z + dz * 0.5 + dx * 0.866 };
                next.push(a, p1, peak, p2);
            }
            pts = next;
        }
        return pts;
    } else {
        // --- Midpoint displacement (default A) ---
        let pts = [];
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            pts.push({ x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius });
        }
        let disp = radius * ISLET_ROUGHNESS;
        for (let iter = 0; iter < ISLET_ITERATIONS; iter++) {
            const next = [];
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length];
                next.push(a);
                const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
                const nx = mx - cx, nz = mz - cz;
                const len = Math.sqrt(nx * nx + nz * nz) || 1;
                const d = (Math.random() * 2 - 1) * disp;
                next.push({ x: mx + (nx / len) * d, z: mz + (nz / len) * d });
            }
            pts = next;
            disp *= 0.5;
        }
        return pts;
    }
}

// Ray-polygon intersection: returns distance along ray (ox,oz)+(dx,dz)*t where it exits the polygon.
// Used by buildBaseFences F1 to hug fence to islet coastline.
function _rayPolyIntersect(ox, oz, dx, dz, poly) {
    let minT = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const ex = b.x - a.x, ez = b.z - a.z;
        const denom = dx * ez - dz * ex;
        if (Math.abs(denom) < 1e-10) continue;
        const tx = a.x - ox, tz = a.z - oz;
        const t = (tx * ez - tz * ex) / denom;
        const s = (tx * dz - tz * dx) / denom;
        if (t > 0.5 && s >= 0 && s <= 1 && t < minT) minT = t;
    }
    return minT;
}

function _pointInPolygon(px, pz, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
        if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
}

function _nearestOnPolygon(px, pz, poly) {
    let bx = poly[0].x, bz = poly[0].z, bd = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const dx = b.x - a.x, dz = b.z - a.z, lenSq = dx * dx + dz * dz;
        const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq)) : 0;
        const cx = a.x + t * dx, cz = a.z + t * dz, d = (px - cx) ** 2 + (pz - cz) ** 2;
        if (d < bd) { bd = d; bx = cx; bz = cz; }
    }
    return { x: bx, z: bz };
}

function createIslets(count) {
    for (let i = 0; i < count; i++) {
        const radius = randomRange(200, 500);
        const x = randomRange(-MAP_BOUNDARY * 0.8, MAP_BOUNDARY * 0.8);
        const z = randomRange(-MAP_BOUNDARY * 0.8, MAP_BOUNDARY * 0.8);
        const polygon = _generateIsletPolygon(x, z, radius);
        islets.push({ x, z, radius, polygon });

        // Build ShapeGeometry from polygon (Shape is in XY plane → rotate to XZ)
        const shape = new THREE.Shape();
        shape.moveTo(polygon[0].x - x, polygon[0].z - z);
        for (let k = 1; k < polygon.length; k++) shape.lineTo(polygon[k].x - x, polygon[k].z - z);
        shape.closePath();
        const geo = new THREE.ShapeGeometry(shape);
        const mesh = new THREE.Mesh(geo, isletMaterial);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, groundLevel + 1, z);
        scene.add(mesh);
    }
}
// --- Player Plane ---
const plane = new THREE.Group();
const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
const tailMaterial = new THREE.MeshStandardMaterial({ color: 0x001f5a });
const fuselageGeo = new THREE.CylinderGeometry(0.45, 0.6, 4, 12); fuselageGeo.rotateX(Math.PI / 2);
const body = new THREE.Mesh(fuselageGeo, bodyMaterial);
const noseGeo = new THREE.ConeGeometry(0.45, 1.2, 12); noseGeo.rotateX(Math.PI / 2);
const nose = new THREE.Mesh(noseGeo, bodyMaterial); nose.position.set(0, 0, 2.6);
const leftWing = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 1.5), bodyMaterial); leftWing.position.x = -3;
const rightWing = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 1.5), bodyMaterial); rightWing.position.x = 3;
const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 1), tailMaterial); tailFin.position.set(0, 0.75, -1.8);
const hStab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.15, 0.8), bodyMaterial); hStab.position.set(0, 0, -1.8);
const corePlaneComponents = [body, nose, leftWing, rightWing, tailFin, hStab];
plane.add(...corePlaneComponents);
// --- Body upgrades ---
const attachMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.7 });
// Wing barrel launchers — one tube at each wing tip
const barrelGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6); barrelGeo.rotateX(Math.PI / 2);
const leftBarrel  = new THREE.Mesh(barrelGeo, attachMat); leftBarrel.position.set(-5.9, -0.12, 0.55);
const rightBarrel = new THREE.Mesh(barrelGeo, attachMat); rightBarrel.position.set(5.9, -0.12, 0.55);
// Bomb pod — slightly larger horizontal cylinder under centre body
const bombPodGeo = new THREE.CylinderGeometry(0.28, 0.28, 2.0, 8); bombPodGeo.rotateX(Math.PI / 2);
const bombPod = new THREE.Mesh(bombPodGeo, attachMat); bombPod.position.set(0, -0.78, 0.2);
// Napalm containers — two small cylinders under rear body
const napPodGeo = new THREE.CylinderGeometry(0.17, 0.2, 1.4, 6); napPodGeo.rotateX(Math.PI / 2);
const napPodL = new THREE.Mesh(napPodGeo, attachMat); napPodL.position.set(-0.36, -0.68, -1.4);
const napPodR = new THREE.Mesh(napPodGeo, attachMat); napPodR.position.set( 0.36, -0.68, -1.4);
plane.add(leftBarrel, rightBarrel, bombPod, napPodL, napPodR);
const _planeMaterials = [bodyMaterial, tailMaterial, attachMat]; // for player blink-on-damage (idea 3)
plane.position.set(0, groundLevel + 20, 0);
scene.add(plane);
const planePartBoxes = corePlaneComponents.map(() => new THREE.Box3());
const planeMarkerCollisionRadius = 2.0;
const planeSphereRadius = 2.5;
// Local-space geometry bounding boxes — built once, updated via applyMatrix4 each frame (§2.1)
corePlaneComponents.forEach(m => m.updateMatrix());
const planePartLocalBoxes = corePlaneComponents.map(m => {
    m.geometry.computeBoundingBox();
    return m.geometry.boundingBox.clone();
});

// --- Wing Trails ---
const TRAIL_LENGTH = 70;
const _trailTip = new THREE.Vector3();
const _wingTipL = new THREE.Vector3(-6, 0, 0);
const _wingTipR = new THREE.Vector3(6, 0, 0);
const _rotFwd = new THREE.Vector3();
function createWingTrail() {
    const positions = new Float32Array(TRAIL_LENGTH * 3);
    const colors = new Float32Array(TRAIL_LENGTH * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({ size: 0.55, vertexColors: true, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    return { pts, positions, colors, count: 0 };
}
function updateWingTrail(trail, tipLocal) {
    _trailTip.copy(tipLocal);
    plane.localToWorld(_trailTip);
    const pos = trail.positions, col = trail.colors;
    pos.copyWithin(3, 0, (TRAIL_LENGTH - 1) * 3);
    pos[0] = _trailTip.x; pos[1] = _trailTip.y; pos[2] = _trailTip.z;
    trail.count = Math.min(trail.count + 1, TRAIL_LENGTH);
    for (let i = 0; i < trail.count; i++) {
        const t = Math.pow(1 - i / TRAIL_LENGTH, 1.8);
        col[i*3] = 0.72 * t + 0.067; col[i*3+1] = 0.90 * t + 0.067; col[i*3+2] = 1.0 * t + 0.067;
    }
    trail.pts.geometry.attributes.position.needsUpdate = true;
    trail.pts.geometry.attributes.color.needsUpdate = true;
    trail.pts.geometry.setDrawRange(0, trail.count);
}
const wingTrailL = createWingTrail(); wingTrailL.pts.frustumCulled = false; wingTrailL.pts.visible = false;
const wingTrailR = createWingTrail(); wingTrailR.pts.frustumCulled = false; wingTrailR.pts.visible = false;

// --- Scratch vectors — reused each frame to avoid allocations (§2.6) ---
const _sv1 = new THREE.Vector3();
const _sv2 = new THREE.Vector3();
const _sv3 = new THREE.Vector3();
const _sq1 = new THREE.Quaternion(); // scratch quaternion for steering
const _sq2 = new THREE.Quaternion(); // scratch quaternion for steering
const _camOffset = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _wp = new THREE.Vector3(); // scratch for getWorldPosition
// --- Weapon-fire scratch vectors — reused per-shot to avoid per-shot allocations (§3.2) ---
const _wv1 = new THREE.Vector3();
const _bombOffset  = new THREE.Vector3(0, -1.5,   0);   // bomb/napalm drop offset (const — never mutated)
const _bombDroop   = new THREE.Vector3(0, -0.05,  0);   // bomb/napalm droop (const — never mutated)
const _missileLTip = new THREE.Vector3(-5.9, -0.12, 0.55); // left wing-tip local coords
const _missileRTip = new THREE.Vector3( 5.9, -0.12, 0.55); // right wing-tip local coords

// --- THREE.Clock for delta-time (§3.6) ---
const clock = new THREE.Clock();
let _minimapTimer = 0; // seconds since last minimap redraw (§2.5)
let _radarSweepAngle = -Math.PI / 2; // radar sweep — starts at top (north)
let _radarCycleTimer = 3.0;          // trigger snapshot immediately on first frame
let _radarBlips = [];                 // frozen positions updated once per sweep
const _radarPlayerPos = new THREE.Vector3(); // frozen player world position at snapshot
let _radarPlayerAngle = 0;           // frozen player heading at snapshot

// --- Aiming & Targeting ---
const laserMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
const laserGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 2), new THREE.Vector3(0, 0, 1500)]);
const aimingLaser = new THREE.Line(laserGeometry, laserMaterial); aimingLaser.visible = true; plane.add(aimingLaser);
const arrowGeometry = new THREE.ConeGeometry(0.3, 1.2, 8);
arrowGeometry.translate(0, -0.6, 0); arrowGeometry.rotateX(Math.PI / 2);
const markerArrow = new THREE.Mesh(arrowGeometry, new THREE.MeshBasicMaterial({ color: 0xffff00 }));
const groundTargetArrow = new THREE.Mesh(arrowGeometry, new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
const enemyArrow = new THREE.Mesh(arrowGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff }));
markerArrow.position.set(-1.5, 1.5, 0); groundTargetArrow.position.set(1.5, 1.5, 0); enemyArrow.position.set(0, 2.0, 0);
markerArrow.visible = false; groundTargetArrow.visible = false; enemyArrow.visible = false;
plane.add(markerArrow, groundTargetArrow, enemyArrow);
// V13: muzzle PointLight — starts off, flashes briefly on each player shot
const _playerMuzzleLight = new THREE.PointLight(0xffa500, 0, 18);
_playerMuzzleLight.position.set(0, 0, 4); plane.add(_playerMuzzleLight);
// --- UI Elements & Minimap ---
const scoreElement = document.getElementById('score'), hpElement = document.getElementById('hp'), gameOverElement = document.getElementById('game-over'), pausedElement = document.getElementById('paused'), enemyDistanceElement = document.getElementById('enemy-distance'), groundDistanceElement = document.getElementById('ground-distance'), markerDistanceElement = document.getElementById('marker-distance'), posXElement = document.getElementById('pos-x'), posYElement = document.getElementById('pos-y'), posZElement = document.getElementById('pos-z'), rotHdgElement = document.getElementById('rot-hdg'), rotPchElement = document.getElementById('rot-pch'), rotBnkElement = document.getElementById('rot-bnk'), levelElement = document.getElementById('level'), xpElement = document.getElementById('xp'), xpToNextLevelElement = document.getElementById('xp-to-next-level'), bulletDamageValueElement = document.getElementById('bullet-damage-value'), ratePitchPos = document.getElementById('rate-pitch-pos'), ratePitchNeg = document.getElementById('rate-pitch-neg'), ratePitchVal = document.getElementById('rate-pitch-val'),
    rateRollPos  = document.getElementById('rate-roll-pos'),  rateRollNeg  = document.getElementById('rate-roll-neg'),  rateRollVal  = document.getElementById('rate-roll-val'),
    rateYawPos   = document.getElementById('rate-yaw-pos'),   rateYawNeg   = document.getElementById('rate-yaw-neg'),   rateYawVal   = document.getElementById('rate-yaw-val'),
    speedBarEl   = document.getElementById('speed-bar');
const hitMarkerEl    = document.getElementById('hit-marker');
const _steerCursorEl = document.getElementById('steer-cursor');
const memDebugEl  = document.getElementById('memory-debug');
const gunBarEl = document.getElementById('gun-bar'), gunStatusEl = document.getElementById('gun-status');
const bombBarEl = document.getElementById('bomb-bar'), bombStatusEl = document.getElementById('bomb-status');
const missileBarEl = document.getElementById('missile-bar'), missileStatusEl = document.getElementById('missile-status');
const flareBarEl = document.getElementById('flare-bar'), flareStatusEl = document.getElementById('flare-status');
const napalmBarEl = document.getElementById('napalm-bar'), napalmStatusEl = document.getElementById('napalm-status');
const minimap = document.getElementById('minimap'), minimapCtx = minimap.getContext('2d'), MINIMAP_SIZE = 400;
minimap.width = MINIMAP_SIZE; minimap.height = MINIMAP_SIZE;
const MINIMAP_HALF_R_SQ = (MINIMAP_SIZE / 2) * (MINIMAP_SIZE / 2); // §2.7 squared threshold for hypot checks
// --- Static minimap rings — rendered once onto offscreen canvas, composited each frame (§3.4) ---
const _ringsCanvas = document.createElement('canvas');
_ringsCanvas.width = MINIMAP_SIZE; _ringsCanvas.height = MINIMAP_SIZE;
{ const rc = _ringsCanvas.getContext('2d'), cx = MINIMAP_SIZE / 2, maxR = MINIMAP_SIZE / 2;
  rc.lineWidth = 1;
  [0.33, 0.66, 1.0].forEach(f => { rc.strokeStyle = `rgba(0,210,90,${f === 1.0 ? 0.25 : 0.12})`; rc.beginPath(); rc.arc(cx, cx, maxR * f, 0, Math.PI * 2); rc.stroke(); }); }

// ================================================================
// --- Flight Config (easy-edit tuning knobs) ---
// ================================================================
const maxSpeed = .8, minSpeed = .02;
const acceleration = .003, deceleration = .002, naturalDeceleration = .0005;
const maxPitchRate = .025, maxRollRate = .035, maxYawRate = .030;
const rotAccel = .00085;
const rotDamping = .85;
// --- Mouse-aim steering ---
const MOUSE_STEERING      = true;  // set false to disable War Thunder-style mouse aim
const STEER_MAX_TURN_RATE = 0.022; // rad per dt-unit — max angular speed toward cursor
const STEER_SMOOTHING     = 0.14;  // exponential approach factor per dt (higher = snappier)
const STEER_CURSOR_RADIUS = 0.72;  // NDC radius of the effective steering circle
const STEER_MAX_ANGLE     = Math.PI * 0.35; // max steering angle at full cursor radius (~63°)
const STEER_AUTO_BANK_K   = 9.0;   // horizontal turn rate → desired bank ratio
const STEER_BANK_SMOOTH   = 0.10;  // bank convergence rate per dt
const STEER_DEADZONE      = 0.06;  // NDC radius within which cursor is treated as centered
const STEER_LEVEL_RATE    = 0.018; // pitch leveling rate per dt when cursor is centered
const STEER_RETURN_DECAY  = 0.028; // per-dt decay rate — cursor drifts back to center when mouse idle
const bulletDamage = 1, bombDamage = 40, bombAoERadius = 50, bulletSpeed = 1.8, bulletLife = 150, shootCooldownTime = 4;
// --- Ammo system (§5.7) ---
const GUN_MAX_AMMO = 60, GUN_RELOAD_TIME = 180;   // reload ~3 s at 60 fps (dt units)
const BOMB_MAX_AMMO = 4,  BOMB_RELOAD_TIME = 300;  // reload ~5 s at 60 fps
const MISSILE_MAX_AMMO = 3,  MISSILE_RELOAD_TIME = 600; // reload ~10 s
const FLARE_MAX_AMMO = 2,    FLARE_RELOAD_TIME = 900, FLARE_DURATION = 180; // effect 3 s, reload 15 s
const NAPALM_MAX_AMMO = 2,   NAPALM_RELOAD_TIME = 480, NAPALM_TICK_INTERVAL = 30, NAPALM_DURATION = 300;
const missileDamage = 80, missileAoERadius = 25, missileLife = 300, missileHomingStr = 0.09;
const MISSILE_INITIAL_SPEED = bulletSpeed * 0.5;   // 0.9 — slow on launch
const MISSILE_FINAL_SPEED   = bulletSpeed * 2;     // 3.6 — twice gun speed at cruise
const MISSILE_ACCEL         = 0.05;               // speed added per dt after drop phase
const MISSILE_DROP_PHASE    = 22;                 // dt frames of downward fall before homing
const napalmDamage = 8, napalmRadius = 55;

// ================================================================
// --- Game State (§1.3 — grouped by concern) ---
// ================================================================
// Player
let score = 0, planeHP = 100, level = 1, xp = 0, xpToNextLevel = 100, playerDamageMultiplier = 1;
// Control flow
let isGameOver = false, isPaused = false;
// Game-over free-look orbit
const _gameOverPos = new THREE.Vector3();
let _goOrbitYaw = 0, _goOrbitPitch = 0.3;
const _goOrbitDist = 35;
// Flight rates
let pitchRate = 0, rollRate = 0, yawRate = 0, speed = .1;
// Cooldowns
let shootCooldown = 0, bombCooldown = 0;
let gunMaxAmmo = GUN_MAX_AMMO, gunAmmo = GUN_MAX_AMMO, gunReloadTimer = 0;
let bombMaxAmmo = BOMB_MAX_AMMO, bombAmmo = BOMB_MAX_AMMO, bombReloadTimer = 0;
let missileMaxAmmo = MISSILE_MAX_AMMO, missileAmmo = MISSILE_MAX_AMMO, missileReloadTimer = 0;
let flareMaxAmmo = FLARE_MAX_AMMO, flareAmmo = FLARE_MAX_AMMO, flareReloadTimer = 0, flareTimer = 0;
let napalmMaxAmmo = NAPALM_MAX_AMMO, napalmAmmo = NAPALM_MAX_AMMO, napalmReloadTimer = 0;
// Entities
const bullets = [], bombs = [], missiles = [], missileTrailParticles = [], napalmBombs = [], napalmPatches = [], napalmFireParticles = [], flareParticles = [], enemyBullets = [], activeExplosions = []; // §4.5
const enemies = [], groundUnits = [], airUnits = [];
const obstacles = [], markers = [], collectibles = [];
const baseMarkers = [], basesById = {};
const _fenceRegistry = {}; // baseId → { posts:[{mesh,worldPos,tiltApplied}], bmRef }
const _flagMeshes = [];    // { mesh, pivot: Vector3 }
// Color-lines mode (webgl_lines_colors aesthetic — wireframe on black)
let _colorMode = false;
let _colorModeBg = null;
const _colorModeOrigMats = new Map();
// G20: kill-streak score multiplier
const _killTimes = [];
let _scoreMulti = 1, _multiDisplayTimer = 0;
const _multiEl = (() => { const el = document.createElement('div'); el.style.cssText = 'display:none;position:fixed;top:52%;left:50%;transform:translate(-50%,-50%);color:#ffdd00;font:bold 22px monospace;text-align:center;text-shadow:0 0 8px #ff8800,0 0 16px #ff8800;pointer-events:none;z-index:200;letter-spacing:3px;'; document.body.appendChild(el); return el; })();
// G5: persistent high score
let _highScore = parseInt(localStorage.getItem('vibepilot_hs') || '0');
// V13: empty-clip flash timer (frames)
let _emptyClipFlash = 0;
// F6: searchlight sweepers
const _searchlights = [];
// Death debrief stat tracking (sampled every ~1 s)
const _statHp = [100], _statScore = [0], _statXp = [0], _statLvl = [1];
let _statTimer = 60;
let _heartbeatPhase = 0; // drives emissive glow pulse on all heart collectibles
const _deathGraphEl = (() => {
    const div = document.createElement('div');
    div.style.cssText = 'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(5,5,15,0.96);border:1px solid #334;border-radius:10px;padding:22px 26px;z-index:600;color:#ccd;font-family:monospace;min-width:640px;';
    div.innerHTML = '<div style="text-align:center;font-size:17px;letter-spacing:3px;color:#ffdd88;margin-bottom:12px">— MISSION DEBRIEF —</div>' +
        '<canvas id="_deathCanvas" width="590" height="360"></canvas>' +
        '<div style="text-align:center;font-size:11px;color:#556;margin-top:8px">[G] toggle debrief</div>';
    document.body.appendChild(div); return div;
})();
function _drawDeathGraph() {
    const cv = document.getElementById('_deathCanvas'); if (!cv) return;
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.fillStyle = '#090912'; ctx.fillRect(0, 0, W, H);
    const pad = 38, stripH = 72, gap = 10;
    const rows = [
        { data: _statHp,    label: 'HP',    color: '#ff4455', max: 100 },
        { data: _statScore, label: 'Score', color: '#4488ff', max: null },
        { data: _statXp,    label: 'XP',    color: '#44ee88', max: null },
        { data: _statLvl,   label: 'Level', color: '#ffcc44', max: null },
    ];
    rows.forEach((row, ri) => {
        const y0 = pad + ri * (stripH + gap);
        const maxVal = row.max || Math.max(...row.data, 1);
        ctx.fillStyle = '#0d0d1a'; ctx.fillRect(pad, y0, W - pad * 2, stripH);
        ctx.strokeStyle = '#1a1a30'; ctx.lineWidth = 1;
        for (let g = 0; g <= 4; g++) { ctx.beginPath(); ctx.moveTo(pad, y0 + g * stripH / 4); ctx.lineTo(W - pad, y0 + g * stripH / 4); ctx.stroke(); }
        if (row.data.length >= 2) {
            ctx.strokeStyle = row.color; ctx.lineWidth = 2; ctx.beginPath();
            row.data.forEach((v, i) => {
                const x = pad + (i / (row.data.length - 1)) * (W - pad * 2);
                const y = y0 + stripH - (Math.min(v, maxVal) / maxVal) * stripH;
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }); ctx.stroke();
        }
        ctx.fillStyle = row.color; ctx.font = '11px monospace';
        ctx.fillText(`${row.label}  (peak: ${Math.max(...row.data)})`, pad + 2, y0 - 4);
    });
    const secs = _statHp.length - 1;
    ctx.fillStyle = '#334'; ctx.font = '10px monospace';
    ctx.fillText(`0 s`, pad, H - 6); ctx.fillText(`${secs} s`, W - pad - 20, H - 6);
}
// V5: bullet tracer shared material
const _tracerMat = new THREE.LineBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.55 });
// V4: hostile muzzle flash small spheres
const _muzzleFlashes = [];
const _muzzleFlashGeo = new THREE.SphereGeometry(0.5, 5, 4);
const _muzzleFlashMat = new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true });
// Debug
const debugHelpers = [];
let debugCollision = false;
// HUD nearest-enemy cache — recomputed every 6 frames (~10 fps at 60 fps) (§3.1)
let _hudEnemyFrame = 0, _hudNearestEnemy = null, _hudNearestEnemyDist = Infinity;
// --- Visual effects (ideas 1-6) ---
const collectibleBursts = []; // green burst particles on collectible pickup (idea 1)
const _dyingMarkers   = []; // torus rings blink-out after marker pickup (idea 2)
const _dyingGround    = []; // ground units blink before final dispose (idea 5)
const _dyingAirUnits  = []; // air units blink before final dispose (idea 5)
const _dyingEnemies   = []; // enemy fighter parts blink before dispose (idea 5)
const _planeDebris    = []; // debris pieces after player destruction (idea 6)
// --- Tube challenges (ideas 7-9) ---
const tubes = [];
const TUBE_XP = 200;
// Persistent HUD for challenge tube runs
const _tubeStatusEl = (() => { const el = document.createElement('div'); el.id = 'tube-status'; el.style.cssText = 'display:none;position:fixed;top:42%;left:50%;transform:translate(-50%,-50%);color:#00ccff;font:bold 20px monospace;text-align:center;text-shadow:0 0 10px #00ccff,0 0 20px #00ccff;pointer-events:none;z-index:200;letter-spacing:2px;'; document.body.appendChild(el); return el; })();
// --- Hit-marker / blink timers ---
let _hitMarkerTimer = 0;    // frames remaining for hit-confirm crosshair (idea 4)
let _playerBlinkTimer = 0;  // frames remaining for plane red-blink on damage (idea 3)
let _graceTimer = GRACE_PERIOD; // seconds of spawn invincibility remaining
let _mouseNDC = { x: 0, y: 0 }; // mouse position in normalized device coords for steering
// --- Memory debug refresh ---
let _memDebugTimer = 0;
// Unused variable removed: isLaserVisible

// --- Bomb & explosion resources ---
const bombMaterial = new THREE.MeshStandardMaterial({ color: "#222", roughness: .7 });
// --- Missile resources (Y-aligned so setFromUnitVectors(_up3, vel) points nose along velocity) ---
const _missileBodyGeo  = new THREE.CylinderGeometry(0.28, 0.35, 5.5, 7); // Y-axis = missile length
const _missileNoseGeo  = (() => { const g = new THREE.ConeGeometry(0.28, 2.2, 7); g.translate(0, 3.85, 0); return g; })(); // tip at +Y
const _missileFinGeo   = (() => { const g = new THREE.BoxGeometry(0.1, 1.6, 1.1); g.translate(0, -2.6, 0); return g; })(); // delta fin at rear
const _missileBodyMat  = new THREE.MeshStandardMaterial({ color: 0xd4d0c8, roughness: 0.5, metalness: 0.6 });
const _missileNoseMat  = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4 });
const _missileFinMat   = new THREE.MeshStandardMaterial({ color: 0x888880, roughness: 0.6 });
const _missileGlowGeo  = new THREE.SphereGeometry(0.38, 5, 4);
const _missileGlowMat  = new THREE.MeshBasicMaterial({ color: 0xff8822, transparent: true, opacity: 0.9 });
function _createMissileMesh() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(_missileBodyGeo, _missileBodyMat));
    g.add(new THREE.Mesh(_missileNoseGeo, _missileNoseMat));
    for (let _fi = 0; _fi < 4; _fi++) {
        const fin = new THREE.Mesh(_missileFinGeo, _missileFinMat);
        fin.rotation.y = _fi * Math.PI / 2; // spread 4 fins radially
        fin.position.set(Math.sin(_fi * Math.PI / 2) * 0.35, 0, Math.cos(_fi * Math.PI / 2) * 0.35);
        g.add(fin);
    }
    const glow = new THREE.Mesh(_missileGlowGeo, _missileGlowMat.clone());
    glow.position.set(0, -2.8, 0); // engine exhaust at rear (-Y)
    g.add(glow);
    return g;
}
const _missileTrailGeo = new THREE.SphereGeometry(0.18, 4, 3);
const _missileTrailMat = new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true });
// --- Napalm fire particle resources ---
const _napalmFireGeo = new THREE.SphereGeometry(1.5, 6, 4);
const _napalmFireMat = new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true });
// --- Flare particle resources ---
const _flarePGeo = new THREE.SphereGeometry(0.5, 6, 4);
const _flarePMatBase = new THREE.MeshBasicMaterial({ color: 0xffdd55, transparent: true });
// --- Napalm resources ---
const napalmBombMaterial = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: .6, emissive: 0x441100 });
const napalmPatchGeo = new THREE.CylinderGeometry(napalmRadius, napalmRadius, 0.5, 20);
const napalmPatchMat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.65 });
// --- Napalm cluster resources (50-orb scatter redesign) ---
const _napClusterR = 15;
const _napClusterPatchGeo = new THREE.CylinderGeometry(_napClusterR, _napClusterR, 0.3, 10);
const _napClusterOrbGeo = new THREE.SphereGeometry(0.55, 5, 4);
const _napClusterOrbMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.9 });
const bombRadius = 1.5, bombGeometry = new THREE.SphereGeometry(bombRadius, 10, 10);
// Pre-baked bomb visual geometries (shared, avoids per-drop GC stall)
const _bombBodyGeo = (() => { const g = new THREE.CylinderGeometry(0.7, 0.9, 3.2, 8); g.rotateX(Math.PI / 2); return g; })();
const _bombNoseGeo = (() => { const g = new THREE.ConeGeometry(0.7, 1.8, 8); g.rotateX(-Math.PI / 2); g.translate(0, 0, 2.5); return g; })();
const _bombFinGeo  = new THREE.BoxGeometry(0.12, 1.4, 0.7);
const bombCooldownTime = 45;
const gravity = .008;
const explosionGeometry = new THREE.SphereGeometry(1, 16, 16);
const explosionDuration = 400, explosionMaxSize = 50;
// --- Explosion material pool (§3.3) — eliminates material.clone() per explosion ---
const _expMatPool = [];
for (let _i = 0; _i < 12; _i++) _expMatPool.push(new THREE.MeshBasicMaterial({ color: 0xffa500, transparent: true, opacity: 0.8 }));
// --- Marker / collectible resources ---
const markerRadius = 5, markerGeometry = new THREE.SphereGeometry(markerRadius, 16, 16);
const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xFFD700, emissive: 0xccad00 });
const collectibleRadius = 1.5, numCollectibleChains = 20;
const _hhs = collectibleRadius / 47.5; // scale heart to fit within collectibleRadius
const _hox = -25 * _hhs, _hoy = -47.5 * _hhs; // center heart at origin
const _heartShape = new THREE.Shape();
_heartShape.moveTo(_hox+25*_hhs,_hoy+25*_hhs);
_heartShape.bezierCurveTo(_hox+25*_hhs,_hoy+25*_hhs, _hox+20*_hhs,_hoy,          _hox,        _hoy);
_heartShape.bezierCurveTo(_hox-30*_hhs,_hoy,          _hox-30*_hhs,_hoy+35*_hhs,  _hox-30*_hhs,_hoy+35*_hhs);
_heartShape.bezierCurveTo(_hox-30*_hhs,_hoy+55*_hhs,  _hox-10*_hhs,_hoy+77*_hhs,  _hox+25*_hhs,_hoy+95*_hhs);
_heartShape.bezierCurveTo(_hox+60*_hhs,_hoy+77*_hhs,  _hox+80*_hhs,_hoy+55*_hhs,  _hox+80*_hhs,_hoy+35*_hhs);
_heartShape.bezierCurveTo(_hox+80*_hhs,_hoy+35*_hhs,  _hox+80*_hhs,_hoy,           _hox+50*_hhs,_hoy);
_heartShape.bezierCurveTo(_hox+35*_hhs,_hoy,           _hox+25*_hhs,_hoy+25*_hhs,  _hox+25*_hhs,_hoy+25*_hhs);
const collectibleGeo = new THREE.ExtrudeGeometry(_heartShape, { depth: collectibleRadius * 0.45, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 2 });
const collectibleMat = new THREE.MeshStandardMaterial({ color: 0x00ff44, emissive: 0x006622 });
// --- Shared player-bullet resources (avoids per-shot alloc) ---
const _playerBulletGeo = new THREE.SphereGeometry(.3, 8, 8);
const _playerBulletMat = new THREE.MeshBasicMaterial({ color: 0xffa500 });
const _playerBulletPool = [];

// --- Base / Fleet Names ---
const aibaseLetters    = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet'];
const forwardBaseNames = ['Achilles','Ajax','Hector','Leonidas','Brasidas','Lysander','Themistocles','Epaminondas'];
const fleetNames       = ['Poseidon','Neptune','Triton','Leviathan','Aegir','Kraken','Tethys','Nereid'];
const squadronNames    = ['Ares','Mars','Artemis','Orion','Thor','Odin','Sirius','Polaris'];
const hoverWingNames   = ['Icarus','Pegasus','Hermes','Valkyrie','Zephyr','Aura'];
const strikeWingNames  = ['Apollo','Talon','Falcon','Hawk','Raptor','Griffin'];
const CONSTELLATION_NAMES = ['Orion','Cassiopeia','Perseus','Andromeda','Lyra','Aquila','Cygnus','Scorpius','Leo','Gemini','Taurus','Aries','Pisces','Sagittarius','Draco','Hercules','Pegasus','Ophiuchus','Centaurus','Vela'];
const CORRIDOR_NAMES = ['Corridor Alpha','Corridor Beta','Corridor Gamma','Corridor Delta','Corridor Epsilon','Corridor Zeta','Corridor Eta','Corridor Theta'];
let aibaseIdx = 0, forwardBaseIdx = 0, fleetIdx = 0, squadronIdx = 0, hoverWingIdx = 0, strikeWingIdx = 0;
// Constellation / corridor tracking maps (id → { name, total, remaining, completed })
const constellations = {}, corridors = {};
let notifSlot = 0;

// --- Enemy setup ---
const enemyColors = [16711680, 255, 16711935, 65535, 16747520, 15790320, 8388736];
const enemyPartHP = 1, numEnemies = 10, enemySpeed = .05, enemyScale = 2;
const defaultEnemyHpOffsetY = 5 * enemyScale;
const numAirbases = 5, numForwardBases = 8, numCarrierGroups = 2, numDestroyerSquadrons = 3;
const enemyBulletSpeed = 1.2, enemyBulletLife = 200, enemyBulletDamage = 15;
const hostileUnitShootingRange = 600, hostileUnitShootingCooldownTime = 240;
// Enemy aim: 0 = no prediction / full random spread, 1 = perfect predictive aim
const ENEMY_AIM_ACCURACY = 0.95; // default 70% = 30% cone inaccuracy //single constant to tune. 1.0 = perfect lead shot, 0.0 = fully random scatter
const HOSTILE_SHOOT_RANGE_SQ = hostileUnitShootingRange * hostileUnitShootingRange; // §2.7
const numHoverWings = 3, numStrikeWings = 2;
// --- Obstacle resources ---
const greyObstacleMaterial = new THREE.MeshStandardMaterial({ color: 8947848, roughness: .8 });
const torusMaterial = new THREE.MeshStandardMaterial({ color: 16711680, roughness: .6 });
const numObstacles = 80, targetHoopCount = 0, numHoopChains = 8;

// ================================================================
// --- Enemy Bullet Pool (§2.4) ---
// ================================================================
function _createEnemyBulletMesh() {
    const b = new THREE.Group();
    b.add(
        new THREE.Mesh(new THREE.CylinderGeometry(.75, .75, 5.5, 8), new THREE.MeshBasicMaterial({ color: 0xff2200 })),
        new THREE.Mesh(new THREE.ConeGeometry(.75, 2, 8),             new THREE.MeshBasicMaterial({ color: 0xff6600 }))
    );
    b.children[1].position.y = 3.75;
    b.userData = { type: 'enemy_bullet', collisionRadius: 2.8, damage: 0 };
    return b;
}
const _enemyBulletPool = [];
for (let i = 0; i < ENEMY_BULLET_POOL_SIZE; i++) _enemyBulletPool.push(_createEnemyBulletMesh());

// ================================================================
// --- Spatial Grid for bullet collision (§2.3) ---
// ================================================================
const _GRID_CELL = 120;
const _grid = new Map();
function _gridBuild() {
    _grid.clear();
    const add = (obj, pos) => {
        const k = `${Math.floor(pos.x / _GRID_CELL)},${Math.floor(pos.z / _GRID_CELL)}`;
        if (!_grid.has(k)) _grid.set(k, []);
        _grid.get(k).push(obj);
    };
    groundUnits.forEach(u => { if (u.userData.hp > 0) add(u, u.position); });
    airUnits.forEach(au => { if (au.hp > 0) add(au, au.group.position); });
}
function _gridQuery(x, z, r) {
    const cr = Math.ceil(r / _GRID_CELL), cx = Math.floor(x / _GRID_CELL), cz = Math.floor(z / _GRID_CELL);
    const out = [];
    for (let dx = -cr; dx <= cr; dx++) {
        for (let dz = -cr; dz <= cr; dz++) {
            const cell = _grid.get(`${cx + dx},${cz + dz}`);
            if (cell) out.push(...cell);
        }
    }
    return out;
}

// --- Input Handling ---
const keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, w: false, s: false, a: false, d: false, ' ': false };
let _mouseLMB = false; // left mouse button held — machinegun
window.addEventListener('contextmenu', e => e.preventDefault()); // suppress right-click menu
window.addEventListener('mousedown', e => {
    if (isGameOver || isPaused) return;
    if (document.getElementById('splash-screen')) return;
    if (e.button === 0) _mouseLMB = true;
    if (e.button === 2 && missileAmmo > 0) { fireMissile(); if (--missileAmmo <= 0) missileReloadTimer = MISSILE_RELOAD_TIME; }
});
window.addEventListener('mouseup', e => { if (e.button === 0) _mouseLMB = false; });
window.addEventListener('mousemove', e => {
    _mouseNDC.x = (e.clientX / window.innerWidth)  * 2 - 1;
    _mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
});
document.addEventListener('keydown', e => {
    if (isGameOver) {
        // Allow orbit controls during game-over free-look
        if (keys.hasOwnProperty(e.key)) keys[e.key] = true;
        const _k = e.key.toLowerCase();
        if (keys.hasOwnProperty(_k)) keys[_k] = true;
        return;
    }
    if (document.getElementById('splash-screen')) return;
    const k = e.key.toLowerCase();
    if (k === 'f') aimingLaser.visible = !aimingLaser.visible;
    else if (k === 'e') { if (bombCooldown <= 0 && bombAmmo > 0) { dropBomb(); bombCooldown = bombCooldownTime; if (--bombAmmo <= 0) bombReloadTimer = BOMB_RELOAD_TIME; } }
    else if (k === 'r') { if (missileAmmo > 0) { fireMissile(); if (--missileAmmo <= 0) missileReloadTimer = MISSILE_RELOAD_TIME; } }
    else if (k === 'q') { if (flareAmmo > 0) { flareTimer = FLARE_DURATION; deployFlareEffect(); if (--flareAmmo <= 0) flareReloadTimer = FLARE_RELOAD_TIME; } }
    else if (k === 'x') { if (napalmAmmo > 0) { dropNapalm(); if (--napalmAmmo <= 0) napalmReloadTimer = NAPALM_RELOAD_TIME; } }
    else if (keys.hasOwnProperty(k)) keys[k] = true;
    else if (keys.hasOwnProperty(e.key)) keys[e.key] = true;
});
document.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
    else if (keys.hasOwnProperty(e.key)) keys[e.key] = false;
});
document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'b') debugCollision = !debugCollision;
    if (e.key.toLowerCase() === 'm') { memDebugEl.classList.toggle('active'); _memDebugTimer = 0; }
    if (e.key.toLowerCase() === 'n') { wingTrailL.pts.visible = !wingTrailL.pts.visible; wingTrailR.pts.visible = !wingTrailR.pts.visible; }
    if (e.key.toLowerCase() === 'c') _toggleColorMode();
    if (e.key.toLowerCase() === 'g' && isGameOver) { _deathGraphEl.style.display = _deathGraphEl.style.display === 'none' ? 'block' : 'none'; }
    if (e.key === 'Escape' && !isGameOver && !document.getElementById('splash-screen')) {
        isPaused = !isPaused;
        pausedElement.style.display = isPaused ? 'block' : 'none';
        if (isPaused) { Object.keys(keys).forEach(k => keys[k] = false); pitchRate = rollRate = yawRate = 0; _mouseLMB = false; }
    }
});

// --- Gamepad (Xbox controller) support ---
const GP_DEADZONE = 0.15;
// Continuous analog state read each frame
// Left stick: X = yaw, Y = throttle  |  Right stick: X = roll, Y = pitch  |  RT = shoot
const _gpAxes = { pitch: 0, roll: 0, yaw: 0, throttleUp: 0, throttleDown: 0, shoot: false };
// Previous button states for one-shot edge detection
const _gpPrev = [];
function pollGamepad() {
    const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
    if (!gp) { _gpAxes.pitch = _gpAxes.roll = _gpAxes.yaw = _gpAxes.throttleUp = _gpAxes.throttleDown = 0; _gpAxes.shoot = false; return; }
    const dz = v => Math.abs(v) > GP_DEADZONE ? v : 0;
    // Left stick X = yaw; left stick Y = throttle (up = accelerate, down = brake)
    _gpAxes.yaw         = -dz(gp.axes[0]); // lx right = yaw right (negate to match keys.d)
    const ly             =  dz(gp.axes[1]);
    _gpAxes.throttleUp   = ly < 0 ? -ly : 0; // stick up  → accelerate
    _gpAxes.throttleDown = ly > 0 ?  ly : 0; // stick down → decelerate
    // Right stick X = roll, Y = pitch
    _gpAxes.roll  =  dz(gp.axes[2]); // rx right = roll right
    _gpAxes.pitch =  dz(gp.axes[3]); // ry down  = pitch down
    // RT (button 7) → shoot (continuous while held)
    _gpAxes.shoot = (gp.buttons[7]?.value ?? 0) > 0.1;
    // One-shot actions — fire only on button press (not while held)
    const p = b => !!gp.buttons[b]?.pressed;
    if (!document.getElementById('splash-screen')) {
        // Start → pause/unpause during play, reload on game over
        if (p(9) && !_gpPrev[9]) {
            if (isGameOver) { location.reload(); }
            else { isPaused = !isPaused; pausedElement.style.display = isPaused ? 'block' : 'none'; if (isPaused) { Object.keys(keys).forEach(k => keys[k] = false); pitchRate = rollRate = yawRate = 0; _mouseLMB = false; } }
        }
        if (!isGameOver && !isPaused) {
            if (p(1) && !_gpPrev[1]) { if (bombCooldown <= 0 && bombAmmo > 0) { dropBomb(); bombCooldown = bombCooldownTime; if (--bombAmmo <= 0) bombReloadTimer = BOMB_RELOAD_TIME; } }    // B → bomb
            if (p(2) && !_gpPrev[2]) { if (missileAmmo > 0) { fireMissile(); if (--missileAmmo <= 0) missileReloadTimer = MISSILE_RELOAD_TIME; } }                                             // X → missile
            if (p(3) && !_gpPrev[3]) { if (flareAmmo > 0) { flareTimer = FLARE_DURATION; deployFlareEffect(); if (--flareAmmo <= 0) flareReloadTimer = FLARE_RELOAD_TIME; } }                  // Y → flares
            if (p(4) && !_gpPrev[4]) { if (napalmAmmo > 0) { dropNapalm(); if (--napalmAmmo <= 0) napalmReloadTimer = NAPALM_RELOAD_TIME; } }                                                  // LB → napalm
            if (p(5) && !_gpPrev[5]) { aimingLaser.visible = !aimingLaser.visible; }                                                                                                           // RB → laser
            if (p(0) && !_gpPrev[0]) { if (bombCooldown <= 0 && bombAmmo > 0) { dropBomb(); bombCooldown = bombCooldownTime; if (--bombAmmo <= 0) bombReloadTimer = BOMB_RELOAD_TIME; } }    // A → bomb (alt)
        }
    }
    // Save button states for next frame edge detection
    for (let i = 0; i < gp.buttons.length; i++) _gpPrev[i] = !!gp.buttons[i]?.pressed;
}

// ================================================================
// --- Helper Functions ---
// ================================================================
function randomRange(min, max) { return Math.random() * (max - min) + min; }
// rng helper for CHAIN_PATTERNS: [min,max] → randomRange; number → pass-through (§3.4)
const rng = v => Array.isArray(v) ? randomRange(v[0], v[1]) : v;

function addXP(a) {
    if (isGameOver) return;
    xp += a;
    while (xp >= xpToNextLevel) {
        level++; xp -= xpToNextLevel; xpToNextLevel = Math.floor(xpToNextLevel * 1.5);
        playerDamageMultiplier += Math.max(0, .25 - .01 * Math.max(0, level - 20)); // §4.3: gain shrinks by 0.01 per level above 20
        gunMaxAmmo += 5;
        if (level % 5  === 0) bombMaxAmmo++;
        if (level % 10 === 0) { missileMaxAmmo++; flareMaxAmmo++; napalmMaxAmmo++; }
        levelElement.textContent = level; updateDamageUI();
        showLevelUpBanner(level); // G18
    }
    xpElement.textContent = xp; xpToNextLevelElement.textContent = xpToNextLevel;
}
function updateDamageUI() { bulletDamageValueElement.textContent = (bulletDamage * playerDamageMultiplier).toFixed(2); }

// G18: level-up banner
function showLevelUpBanner(lvl) {
    if (isGameOver) return;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:38%;left:50%;transform:translate(-50%,-50%) scale(0.6);background:linear-gradient(90deg,#ff6600,#ffdd00,#ff6600);color:#000;font:bold 26px "Orbitron",monospace;padding:12px 36px;border-radius:5px;letter-spacing:3px;pointer-events:none;z-index:300;opacity:0;transition:opacity 0.25s,transform 0.25s;white-space:nowrap;box-shadow:0 0 30px #ff8800;';
    el.textContent = `▲  LEVEL UP  —  LVL ${lvl}  ▲`;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translate(-50%,-50%) scale(1)'; }));
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translate(-50%,-50%) scale(0.8)'; setTimeout(() => el.remove(), 350); }, 1700);
}
// G6: heal on collection group/pipe completion
function _healPlayer(amount) {
    if (isGameOver) return;
    const prev = planeHP;
    planeHP = Math.min(100, planeHP + amount);
    if (planeHP > prev) { hpElement.textContent = Math.max(0, planeHP); showNotification(`+${planeHP - prev} HP`); }
}
// G20: record a kill, return current streak multiplier
function _addKill() {
    const now = Date.now();
    _killTimes.push(now);
    while (_killTimes.length > 0 && now - _killTimes[0] > 5000) _killTimes.shift();
    const streak = _killTimes.length;
    _scoreMulti = streak >= 4 ? 4 : streak >= 3 ? 3 : streak >= 2 ? 2 : 1;
    if (_scoreMulti > 1) {
        _multiDisplayTimer = 150;
        _multiEl.style.display = 'block';
        _multiEl.textContent = `×${_scoreMulti}  STREAK`;
    }
    return _scoreMulti;
}

function showNotification(text, isEliminated = false) {
    if (isGameOver) return;
    const el = document.createElement('div');
    el.className = 'kill-notif' + (isEliminated ? ' eliminated' : '');
    el.textContent = text;
    el.style.bottom = (70 + (notifSlot % NOTIF_MAX_SLOTS) * NOTIF_SLOT_HEIGHT) + 'px';
    notifSlot++;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('slide')));
    setTimeout(() => el.remove(), NOTIF_DURATION_MS);
}
function showCongratsBanner(bmName) {
    if (isGameOver) return;
    const el = document.createElement('div');
    el.className = 'congrats-banner';
    el.textContent = `★  ${bmName}  Conquered  ★`;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
    setTimeout(() => { el.classList.remove('visible'); el.classList.add('fade-out'); setTimeout(() => el.remove(), 750); }, 3200);
}
function addToConqueredRow(text, scrollId) {
    const scroll = document.getElementById(scrollId);
    const wrap = scroll && scroll.parentElement; // cpanel-scroll-wrap
    if (!scroll || !wrap) return;
    const entry = document.createElement('span'); entry.className = 'conquered-entry'; entry.textContent = text; scroll.appendChild(entry);
    wrap.closest('.cpanel-row').classList.add('has-content');
    requestAnimationFrame(() => {
        const overflow = scroll.scrollWidth - wrap.clientWidth;
        if (overflow > 0) {
            const duration = Math.max(4, scroll.scrollWidth / 50);
            scroll.style.animation = 'none';
            scroll.style.setProperty('--ticker-dist', `-${overflow}px`);
            requestAnimationFrame(() => { scroll.style.animation = `conquered-ticker ${duration}s ease-in-out infinite alternate`; });
        } else { scroll.style.animation = 'none'; }
    });
}
function addToConqueredPanel(bmName) { addToConqueredRow(`✓ ${bmName}`, 'row1-scroll'); }
function notifyBase(baseId) { // (§2.2) unified signature — pass baseId string directly
    if (!baseId) return;
    const bm = basesById[baseId];
    if (!bm || bm.eliminated) return;
    bm.alive = bm.units.filter(x => x.userData.hp > 0).length;
    _updateFenceDamageState(bm.id); // F10
    if (bm.alive === 0) {
        showNotification(`◆ ${bm.name} ELIMINATED  +${bm.bonusXp} XP`, true);
        showCongratsBanner(bm.name);
        if (!isGameOver) { addXP(bm.bonusXp); score += Math.floor(bm.bonusXp / 2); scoreElement.textContent = score; }
        bm.eliminated = true; addToConqueredPanel(bm.name);
    } else {
        showNotification(`▶ ${bm.name}  ${bm.alive}/${bm.total}`);
    }
}

function createUnitLabel(name, level, initialHp, maxHp) {
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    canvas.width = 256; canvas.height = 96;
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, sizeAttenuation: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(20, 12, 1); sprite.renderOrder = 1;
    const data = { sprite, context: ctx, canvas, texture, maxHp, name, level };
    updateUnitLabel(data, initialHp);
    return data;
}
function updateUnitLabel(data, currentHp) {
    const { context: ctx, canvas, texture, sprite, maxHp, name, level } = data;
    const hp = Math.max(0, currentHp);
    if (hp <= 0 && sprite) { sprite.visible = false; return; }
    if (sprite) sprite.visible = true; else return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, w, h);
    ctx.font = 'Bold 20px Arial'; ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.fillText(`Lvl ${level} ${name}`, w / 2, 22);
    const barY = 40, barH = 24, barMaxW = w - 20, hpRatio = hp / maxHp, greenW = barMaxW * hpRatio;
    ctx.fillStyle = '#00ff00'; ctx.fillRect(10, barY, greenW, barH);
    if (greenW < barMaxW) { ctx.fillStyle = '#ff0000'; ctx.fillRect(10 + greenW, barY, barMaxW - greenW, barH); }
    ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.strokeRect(10, barY, barMaxW, barH);
    ctx.font = 'Bold 18px Arial'; ctx.fillText(`${hp}/${maxHp}`, w / 2, barY + 17);
    texture.needsUpdate = true;
}

// Consistent label cleanup — used by every unit-destruction path (§3.5)
function destroyLabel(label) {
    if (!label) return;
    label.sprite?.parent?.remove(label.sprite);
    scene.remove(label.sprite);
    label.texture.dispose();
    label.sprite.material.dispose();
}

// Recursively dispose geometries + materials of a Group/Mesh (memory leak fix)
function disposeGroup(obj) {
    obj.traverse(child => {
        if (!child.isMesh && !child.isLine) return;
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material?.dispose();
    });
}

// ================================================================
// --- Unit Creation & Spawning ---
// ================================================================
function createGroundUnit(type) {
    const u = new THREE.Group();
    let hp, collR, hpY, xp, n, turretPivotRef = null, hostile = false, l = 1;
    const UNIT_MAT_COLORS = { tank: 4957216, truck: 8388608, airport: 6710886, destroyer: 5592422, carrier: 4473925, turret: 3355443 };
    const unitMat = new THREE.MeshStandardMaterial({ color: UNIT_MAT_COLORS[type] }); // one material per call, not 6
    switch (type) {
        case 'tank':
            n = "Tank"; l = ~~randomRange(1, 4); hp = 20 * l; collR = 3.5 * 3; hpY = 1.5 * 3 + 5; xp = 35 * l; hostile = true;
            u.position.y = groundLevel + 2 + 1.5 * 3 / 2;
            u.add(new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, 6), unitMat));
            { const tp = new THREE.Group(); tp.position.y = 1.25; const tb = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, 4, 12), unitMat); tb.position.set(0, 0, 2); tb.rotation.x = Math.PI / 2; tp.add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), unitMat), tb); u.add(tp); turretPivotRef = tp; }
            u.scale.set(3, 3, 3); break;
        case 'turret':
            n = "Turret"; l = ~~randomRange(2, 5); hp = 15 * l; collR = 2.5 * 3; hpY = 1.5 * 3 + 5; xp = 30 * l; hostile = true;
            u.position.y = groundLevel + 2 + 1.5 * 3 / 2;
            u.add(new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, 4), unitMat));
            { const tp = new THREE.Group(); tp.position.y = 1.25; const tb = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, 4, 12), unitMat); tb.position.set(0, 0, 2); tb.rotation.x = Math.PI / 2; tp.add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), unitMat), tb); u.add(tp); turretPivotRef = tp; }
            u.scale.set(3, 3, 3); break;
        case 'truck':
            n = "Truck"; l = 1; hp = 5; collR = 3 * 2.5; hpY = 2 * 2.5 + 4; xp = 10;
            u.position.y = groundLevel + 2 + 2 * 2.5 / 2;
            u.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), unitMat), new THREE.Mesh(new THREE.BoxGeometry(2, 1.8, 5), unitMat));
            u.children[0].position.z = 1.5; u.children[1].position.z = -1; u.scale.set(2.5, 2.5, 2.5); break;
        case 'airport':
            n = "Airbase"; l = 5; hp = 150; collR = 100; hpY = 25; xp = 200; u.position.y = groundLevel + 2;
            const runway = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 200), unitMat);
            const mainBuilding = new THREE.Mesh(new THREE.BoxGeometry(10, 20, 10), unitMat); mainBuilding.position.set(25, 10, 0);
            const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 30, 8), unitMat); towerBase.position.set(25, 15, -25);
            const towerCab = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 10), new THREE.MeshStandardMaterial({ color: 0x87CEEB, transparent: true, opacity: 0.5 }));
            towerCab.position.set(25, 34, -25);
            u.add(runway, mainBuilding, towerBase, towerCab);
            const t1 = createGroundUnit('turret'); t1.position.set(30, 0, 60); t1.userData.protector = u; u.add(t1); groundUnits.push(t1);
            const t2 = createGroundUnit('turret'); t2.position.set(-30, 0, -60); t2.userData.protector = u; u.add(t2); groundUnits.push(t2);
            break;
        case 'destroyer':
            n = "Destroyer"; l = ~~randomRange(3, 6); hp = 40 * l; collR = 10 * 5; hpY = 4 * 5; xp = 75 * l; hostile = true; u.position.y = waterLevel;
            u.add(new THREE.Mesh(new THREE.BoxGeometry(3, 2, 20), unitMat), new THREE.Mesh(new THREE.BoxGeometry(2.5, 2, 4), unitMat));
            u.children[1].position.set(0, 2, -2);
            { const tp = new THREE.Group(); tp.position.set(0, 1.5, 5);
              const tb = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, 4, 8), unitMat); tb.position.set(0, 0, 2); tb.rotation.x = Math.PI / 2;
              tp.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 1.5), unitMat), tb); u.add(tp); turretPivotRef = tp; }
            u.scale.set(5, 5, 5); break;
        case 'carrier':
            n = "Carrier"; l = 10; hp = 200; collR = 18 * 8; hpY = 6 * 8; xp = 300; u.position.y = waterLevel;
            u.add(new THREE.Mesh(new THREE.BoxGeometry(8, 3, 35), unitMat), new THREE.Mesh(new THREE.BoxGeometry(12, .5, 32), unitMat), new THREE.Mesh(new THREE.BoxGeometry(2, 3, 6), unitMat));
            u.children[1].position.y = 1.75; u.children[2].position.set(5, 3.5, -2); u.scale.set(8, 8, 8); break;
    }
    const label = createUnitLabel(n, l, hp, hp); scene.add(label.sprite);
    u.userData = { type, hp, maxHp: hp, collisionRadius: collR, label, hpOffsetY: hpY, isHostile: hostile, shootCooldown: hostile ? Math.random() * hostileUnitShootingCooldownTime : 0, xpValue: xp, id: THREE.MathUtils.generateUUID(), partBoxes: null, turretPivot: turretPivotRef, dependents: [] };
    // Populate dependents for units with protected children (§2.5)
    for (const child of u.children) { if (child.userData?.type === 'turret') u.userData.dependents.push(child); }
    return u;
}
function createHangar(variant = 'box') {
    const u = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7 });
    if (variant === 'arch') {
        const r = 12, len = 44;
        const archGeo = new THREE.CylinderGeometry(r, r, len, 16, 1, true, -Math.PI / 2, Math.PI);
        archGeo.rotateX(-Math.PI / 2);
        u.add(new THREE.Mesh(archGeo, mat));
        const backWall = new THREE.Mesh(new THREE.BoxGeometry(r * 2, r, 0.8), mat); backWall.position.set(0, r / 2, -len / 2);
        const frontWall = new THREE.Mesh(new THREE.BoxGeometry(r * 2, r, 0.8), mat); frontWall.position.set(0, r / 2, len / 2);
        u.add(backWall, frontWall);
    } else {
        const base = new THREE.Mesh(new THREE.BoxGeometry(28, 1, 44), mat); base.position.y = 0.5;
        const walls = new THREE.Mesh(new THREE.BoxGeometry(24, 10, 40), mat); walls.position.y = 6;
        const roof = new THREE.Mesh(new THREE.BoxGeometry(26, 3, 42), mat); roof.position.y = 12.5;
        u.add(base, walls, roof);
    }
    u.position.y = groundLevel + 2;
    const hp = 200, n = 'Hangar', l = 3, xpVal = 150;
    const label = createUnitLabel(n, l, hp, hp); scene.add(label.sprite);
    u.userData = { type: 'hangar', hp, maxHp: hp, collisionRadius: 30, label, hpOffsetY: 20, isHostile: false, bombOnly: true, shootCooldown: 0, xpValue: xpVal, id: THREE.MathUtils.generateUUID(), partBoxes: null };
    return u;
}

// --- Spawn helpers ---
function clampToIslet(px, pz, islet) {
    if (_pointInPolygon(px, pz, islet.polygon)) return { x: px, z: pz };
    return _nearestOnPolygon(px, pz, islet.polygon);
}
function isOnAnyIslet(px, pz) {
    return islets.some(i => (px - i.x) ** 2 + (pz - i.z) ** 2 < i.radius * i.radius && _pointInPolygon(px, pz, i.polygon));
}
function getNearestIslet(x, z) {
    let best = null, bestDist = Infinity;
    for (const isl of islets) { const d = (x - isl.x) ** 2 + (z - isl.z) ** 2; if (d < bestDist) { bestDist = d; best = isl; } }
    return best;
}

// Shared base finalisation — avoids repetition in every spawner (§3.3)
function finaliseBase(bm, startIdx, arr, bonusXp) {
    bm.units = arr.slice(startIdx);
    bm.units.forEach(u => {
        if (u.userData) u.userData.baseId = bm.id;
        if ('baseId' in u) { u.baseId = bm.id; if (u.userData) u.userData.baseId = bm.id; }
    });
    bm.total = bm.alive = bm.units.length;
    bm.bonusXp = bonusXp;
}

// ================================================================
// --- Fleet & Base Spawners ---
// ================================================================
function spawnCarrierStrikeGroup(cx, cz) {
    const startIdx = groundUnits.length;
    const bm = { id: THREE.MathUtils.generateUUID(), position: new THREE.Vector3(cx, waterLevel, cz), name: `Fleet ${fleetNames[fleetIdx++ % fleetNames.length]}`, isHostile: true, units: [], alive: 0, total: 0, bonusXp: 0, eliminated: false };
    baseMarkers.push(bm); basesById[bm.id] = bm;
    const carrier = createGroundUnit('carrier'); carrier.position.set(cx, carrier.position.y, cz); carrier.rotation.y = Math.random() * Math.PI * 2;
    groundUnits.push(carrier); scene.add(carrier);
    carrier.userData.label.name = bm.name; updateUnitLabel(carrier.userData.label, carrier.userData.hp);
    const escorts = ~~randomRange(3, 5);
    for (let i = 0; i < escorts; i++) {
        let a = (i / escorts) * Math.PI * 2, ex, ez, tries = 0;
        do { const dist = randomRange(200, 320); ex = cx + Math.cos(a) * dist; ez = cz + Math.sin(a) * dist; a += 0.3; } while (isOnAnyIslet(ex, ez) && ++tries < 12);
        const ship = createGroundUnit('destroyer'); ship.position.set(ex, ship.position.y, ez); ship.rotation.y = a + Math.PI / 2;
        groundUnits.push(ship); scene.add(ship);
    }
    const nearIsl = getNearestIslet(cx, cz);
    if (nearIsl) {
        const heading = Math.random() * Math.PI * 2, cos = Math.cos(heading), sin = Math.sin(heading);
        const numH = ~~randomRange(2, 4);
        for (let i = 0; i < numH; i++) {
            const off = (i - (numH - 1) / 2) * 55;
            const tp = clampToIslet(nearIsl.x + cos * off, nearIsl.z + sin * off, nearIsl);
            const h = createHangar('arch'); h.position.x = tp.x; h.position.z = tp.z; h.rotation.y = heading;
            groundUnits.push(h); scene.add(h);
        }
    }
    finaliseBase(bm, startIdx, groundUnits, 400);
}
function spawnDestroyerSquadron(cx, cz) {
    const startIdx = groundUnits.length;
    const bm = { id: THREE.MathUtils.generateUUID(), position: new THREE.Vector3(cx, waterLevel, cz), name: `Squadron ${squadronNames[squadronIdx++ % squadronNames.length]}`, isHostile: true, units: [], alive: 0, total: 0, bonusXp: 0, eliminated: false };
    baseMarkers.push(bm); basesById[bm.id] = bm;
    const count = ~~randomRange(2, 4), heading = Math.random() * Math.PI * 2, pa = heading + Math.PI / 2;
    for (let i = 0; i < count; i++) {
        let off = (i - (count - 1) / 2) * 150, sx = cx + Math.cos(pa) * off, sz = cz + Math.sin(pa) * off, tries = 0;
        while (isOnAnyIslet(sx, sz) && ++tries < 12) { off += 30; sx = cx + Math.cos(pa) * off; sz = cz + Math.sin(pa) * off; }
        const ship = createGroundUnit('destroyer'); ship.position.set(sx, ship.position.y, sz); ship.rotation.y = heading;
        groundUnits.push(ship); scene.add(ship);
    }
    finaliseBase(bm, startIdx, groundUnits, 150);
}
function spawnAirbase(cx, cz, islet) {
    const startIdx = groundUnits.length;
    const abName = `Airbase ${aibaseLetters[aibaseIdx++ % aibaseLetters.length]}`;
    const bm = { id: THREE.MathUtils.generateUUID(), position: new THREE.Vector3(cx, groundLevel + 2, cz), name: abName, isHostile: false, units: [], alive: 0, total: 0, bonusXp: 0, eliminated: false };
    baseMarkers.push(bm); basesById[bm.id] = bm;
    const airport = createGroundUnit('airport'); const heading = Math.random() > .5 ? 0 : Math.PI / 2;
    airport.position.x = cx; airport.position.z = cz; airport.rotation.y = heading;
    groundUnits.push(airport); scene.add(airport);
    airport.userData.label.name = abName; updateUnitLabel(airport.userData.label, airport.userData.hp);
    // Searchlight on control tower (local pos 25, 34, -25 rotated by heading)
    const _cth = Math.cos(heading), _sth = Math.sin(heading);
    const _slTx = cx + 25 * _cth - (-25) * _sth, _slTy = groundLevel + 38, _slTz = cz + 25 * (-_sth) + (-25) * _cth;
    const _slAb = new THREE.SpotLight(0xffffaa, 2.0, 180, Math.PI / 8, 0.25);
    _slAb.position.set(_slTx, _slTy, _slTz); scene.add(_slAb); scene.add(_slAb.target);
    _searchlights.push({ spot: _slAb, worldPos: new THREE.Vector3(_slTx, _slTy, _slTz),
        angle: Math.random() * Math.PI * 2, speed: (0.003 + Math.random() * 0.003) * (Math.random() > 0.5 ? 1 : -1),
        range: 140, halfAngle: Math.PI / 8, baseIds: [bm.id] });
    const runX = Math.sin(heading), runZ = Math.cos(heading), perpX = Math.cos(heading), perpZ = -Math.sin(heading);
    const side = Math.random() > .5 ? 1 : -1, numHangars = ~~randomRange(3, 6);
    for (let i = 0; i < numHangars; i++) {
        const along = (i - (numHangars - 1) / 2) * 55;
        const tp = clampToIslet(cx + perpX * side * 65 + runX * along, cz + perpZ * side * 65 + runZ * along, islet);
        const h = createHangar(i % 2 === 0 ? 'arch' : 'box'); h.position.x = tp.x; h.position.z = tp.z; h.rotation.y = heading;
        groundUnits.push(h); scene.add(h);
    }
    const numDef = ~~randomRange(3, 6);
    for (let i = 0; i < numDef; i++) {
        const a = (i / numDef) * Math.PI * 2, dist = randomRange(100, 180);
        const tp = clampToIslet(cx + Math.cos(a) * dist, cz + Math.sin(a) * dist, islet);
        const tank = createGroundUnit('tank'); tank.position.set(tp.x, tank.position.y, tp.z); tank.rotation.y = a + Math.PI;
        groundUnits.push(tank); scene.add(tank);
    }
    const numLog = ~~randomRange(3, 5);
    for (let i = 0; i < numLog; i++) {
        const tp = clampToIslet(cx + randomRange(-60, 60), cz + randomRange(-60, 60), islet);
        const truck = createGroundUnit('truck'); truck.position.set(tp.x, truck.position.y, tp.z); truck.rotation.y = Math.random() * Math.PI * 2;
        groundUnits.push(truck); scene.add(truck);
    }
    finaliseBase(bm, startIdx, groundUnits, 500);
}
function spawnForwardBase(cx, cz, islet) {
    const startIdx = groundUnits.length;
    const bm = { id: THREE.MathUtils.generateUUID(), position: new THREE.Vector3(cx, groundLevel + 2, cz), name: `Forward Base ${forwardBaseNames[forwardBaseIdx++ % forwardBaseNames.length]}`, isHostile: true, units: [], alive: 0, total: 0, bonusXp: 0, eliminated: false };
    baseMarkers.push(bm); basesById[bm.id] = bm;
    const heading = Math.random() * Math.PI * 2, cos = Math.cos(heading), sin = Math.sin(heading);
    const pcos = Math.cos(heading + Math.PI / 2), psin = Math.sin(heading + Math.PI / 2);
    const numTanks = ~~randomRange(3, 6);
    for (let i = 0; i < numTanks; i++) {
        const col = i % 3 - 1, row = ~~(i / 3);
        const tp = clampToIslet(cx + pcos * col * 45 + cos * row * 45, cz + psin * col * 45 + sin * row * 45, islet);
        const tank = createGroundUnit('tank'); tank.position.set(tp.x, tank.position.y, tp.z); tank.rotation.y = heading + randomRange(-0.25, 0.25);
        groundUnits.push(tank); scene.add(tank);
    }
    const numTrucks = ~~randomRange(2, 4);
    for (let i = 0; i < numTrucks; i++) {
        const tp = clampToIslet(cx - cos * randomRange(40, 90) + pcos * randomRange(-40, 40), cz - sin * randomRange(40, 90) + psin * randomRange(-40, 40), islet);
        const truck = createGroundUnit('truck'); truck.position.set(tp.x, truck.position.y, tp.z); truck.rotation.y = Math.random() * Math.PI * 2;
        groundUnits.push(truck); scene.add(truck);
    }
    const numH = ~~randomRange(1, 3);
    for (let i = 0; i < numH; i++) {
        const off = (i - (numH - 1) / 2) * 55;
        const tp = clampToIslet(cx - cos * 110 + pcos * off, cz - sin * 110 + psin * off, islet);
        const h = createHangar(i % 2 === 0 ? 'arch' : 'box'); h.position.x = tp.x; h.position.z = tp.z; h.rotation.y = heading;
        groundUnits.push(h); scene.add(h);
    }
    finaliseBase(bm, startIdx, groundUnits, 250);
}

// ================================================================
// --- Base Fences ---
// ================================================================
function buildBaseFences() {
    const POST_H = 8, SEG_LEN = 20, MARGIN = 15, POLY_INSET = 0.84;
    const SIN60 = Math.sin(Math.PI / 3);   // √3/2
    const MIN_INRADIUS = 40;               // must visually contain a hangar
    const MAX_INRADIUS = 90;               // cap — perimeter tanks outside the fence is realistic

    const postMatProto  = new THREE.MeshStandardMaterial({ color: 0x6a6a5a, roughness: 0.9, metalness: 0.1 });
    const railMat       = new THREE.MeshStandardMaterial({ color: 0x8a8a7a, roughness: 0.75, metalness: 0.15 });
    const sandbagMat    = new THREE.MeshStandardMaterial({ color: 0xa09060, roughness: 0.95 });
    const flagMat       = new THREE.MeshBasicMaterial({ color: 0xcc2200, side: THREE.DoubleSide });
    const barbMat       = new THREE.LineBasicMaterial({ color: 0x888877 });
    const postGeo       = new THREE.CylinderGeometry(0.28, 0.28, POST_H, 6);
    const towerBodyGeo  = new THREE.BoxGeometry(2.5, 10, 2.5);
    const towerPlatGeo  = new THREE.CylinderGeometry(3.5, 3.5, 0.6, 8);
    const towerPoleGeo  = new THREE.CylinderGeometry(0.12, 0.12, 7, 6);
    const sandbagGeo    = new THREE.BoxGeometry(3, 1.2, 1.5);

    // --- Step 1: group land bases by islet so nearby bases share one hex ---
    const isletGroups = new Map(); // islet → { bases:[], islet }
    const soloGroups  = [];
    baseMarkers.forEach(bm => {
        if (bm.position.y < groundLevel + 1 || bm.position.y > groundLevel + 5) return;
        const isl = islets.find(i =>
            (bm.position.x - i.x) ** 2 + (bm.position.z - i.z) ** 2 < i.radius * i.radius &&
            _pointInPolygon(bm.position.x, bm.position.z, i.polygon)
        );
        if (!isl) { soloGroups.push({ bases: [bm], islet: null }); return; }
        if (!isletGroups.has(isl)) isletGroups.set(isl, { bases: [], islet: isl });
        isletGroups.get(isl).bases.push(bm);
    });

    for (const { bases, islet } of [...isletGroups.values(), ...soloGroups]) {
        // Group centroid
        const cx = bases.reduce((s, b) => s + b.position.x, 0) / bases.length;
        const cz = bases.reduce((s, b) => s + b.position.z, 0) / bases.length;

        // All units from every base in this group, excluding far perimeter units
        const allUnits = bases.flatMap(b => b.units).filter(u => {
            const dx = u.position.x - cx, dz = u.position.z - cz;
            return dx * dx + dz * dz < (MAX_INRADIUS / SIN60) ** 2;
        });

        // --- Minimum-bounding hexagon (12-orientation search over 60° symmetry) ---
        let bestRot = 0, bestInR = Infinity;
        for (let step = 0; step < 12; step++) {
            const θ = (step / 12) * Math.PI / 3;
            const α = θ + Math.PI / 6; // edge-normal base angle
            let maxInR = MIN_INRADIUS;
            allUnits.forEach(u => {
                const dx = u.position.x - cx, dz = u.position.z - cz;
                for (let k = 0; k < 3; k++) {
                    const a = α + k * Math.PI / 3;
                    maxInR = Math.max(maxInR, Math.abs(dx * Math.cos(a) + dz * Math.sin(a)));
                }
            });
            maxInR = Math.min(maxInR, MAX_INRADIUS);
            if (maxInR < bestInR) { bestInR = maxInR; bestRot = θ; }
        }
        const bestCircumR = (bestInR + MARGIN) / SIN60;

        // 6 corner vertices, each clamped to islet polygon
        const hexV = [];
        for (let i = 0; i < 6; i++) {
            const a = bestRot + (i / 6) * Math.PI * 2;
            let r = bestCircumR;
            if (islet) {
                const t = _rayPolyIntersect(cx, cz, Math.cos(a), Math.sin(a), islet.polygon);
                if (t > 0 && t < Infinity) r = Math.min(bestCircumR, t * POLY_INSET);
            }
            hexV.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
        }

        // F2: gate — edge whose midpoint faces map centre
        const toCenterA = Math.atan2(-cz, -cx);
        let gateEdge = 0, bestDiff = Infinity;
        for (let ei = 0; ei < 6; ei++) {
            const midA = Math.atan2(
                (hexV[ei].z + hexV[(ei + 1) % 6].z) / 2 - cz,
                (hexV[ei].x + hexV[(ei + 1) % 6].x) / 2 - cx
            );
            let diff = Math.abs(midA - toCenterA);
            if (diff > Math.PI) diff = Math.PI * 2 - diff;
            if (diff < bestDiff) { bestDiff = diff; gateEdge = ei; }
        }

        // Shared registry entry — all bases in this group point to the same reg
        const reg = { posts: [], bases };
        for (const bm of bases) _fenceRegistry[bm.id] = reg;
        const cloneMat = () => postMatProto.clone();

        // F3/F9: watchtower at a hex corner
        const makeTower = (px, pz) => {
            const g = new THREE.Group();
            const body = new THREE.Mesh(towerBodyGeo, cloneMat()); body.position.y = 5;
            const plat = new THREE.Mesh(towerPlatGeo, cloneMat()); plat.position.y = 10.3;
            const pole = new THREE.Mesh(towerPoleGeo, cloneMat()); pole.position.y = 14;
            g.add(body, plat, pole);
            g.position.set(px, groundLevel, pz);
            scene.add(g);
            reg.posts.push({ mesh: g, worldPos: new THREE.Vector3(px, groundLevel + 5, pz) });
            const fp = new THREE.Group();
            fp.position.set(px, groundLevel + 17.5, pz);
            const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 1.8), flagMat.clone());
            flag.position.set(1.75, -0.9, 0);
            fp.add(flag); scene.add(fp);
            reg.posts.push({ mesh: fp, worldPos: new THREE.Vector3(px, groundLevel + 17.5, pz) });
            _flagMeshes.push({ mesh: fp });
            // Searchlight on tower platform
            const slY = groundLevel + 12;
            const slSpot = new THREE.SpotLight(0xffffaa, 1.5, 110, Math.PI / 7, 0.3);
            slSpot.position.set(px, slY, pz);
            scene.add(slSpot); scene.add(slSpot.target);
            _searchlights.push({ spot: slSpot, worldPos: new THREE.Vector3(px, slY, pz),
                angle: Math.random() * Math.PI * 2,
                speed: (0.004 + Math.random() * 0.004) * (Math.random() > 0.5 ? 1 : -1),
                range: 90, halfAngle: Math.PI / 7, baseIds: bases.map(b => b.id) });
            reg.posts.push({ mesh: slSpot, worldPos: new THREE.Vector3(px, slY, pz) });
        };

        // --- Build 5 non-gate edges ---
        for (let step = 1; step <= 5; step++) {
            const ei      = (gateEdge + step) % 6;
            const va      = hexV[ei];
            const vb      = hexV[(gateEdge + step + 1) % 6];
            const edgeLen = Math.sqrt((vb.x - va.x) ** 2 + (vb.z - va.z) ** 2);
            const n       = Math.max(1, Math.round(edgeLen / SEG_LEN));
            const edgeDir = Math.atan2(vb.z - va.z, vb.x - va.x);

            // Corner post (va): watchtower, except the first corner after the gate (gate pillar there)
            if (step > 1) makeTower(va.x, va.z);

            // Intermediate posts along this edge
            for (let k = 1; k < n; k++) {
                const t = k / n;
                const px = va.x + t * (vb.x - va.x), pz = va.z + t * (vb.z - va.z);
                const m = new THREE.Mesh(postGeo, cloneMat());
                m.position.set(px, groundLevel + POST_H / 2, pz);
                scene.add(m);
                reg.posts.push({ mesh: m, worldPos: new THREE.Vector3(px, groundLevel + POST_H / 2, pz) });
                // F8: sandbags every 3rd intermediate post
                if (k % 3 === 0) {
                    const inDx = cx - px, inDz = cz - pz;
                    const inLen = Math.sqrt(inDx * inDx + inDz * inDz) || 1;
                    const sx = px + (inDx / inLen) * 2.8, sz = pz + (inDz / inLen) * 2.8;
                    for (let stack = 0; stack < 2; stack++) {
                        const sb = new THREE.Mesh(sandbagGeo, sandbagMat);
                        sb.position.set(sx, groundLevel + 0.6 + stack * 1.2, sz);
                        sb.rotation.y = edgeDir + (Math.random() - 0.5) * 0.3;
                        scene.add(sb);
                        reg.posts.push({ mesh: sb, worldPos: sb.position.clone() });
                    }
                }
            }

            // Straight rail segments per edge (LineCurve3 → sharp hex corners, no CatmullRom smoothing)
            const midX = (va.x + vb.x) / 2, midZ = (va.z + vb.z) / 2;
            for (const railY of [groundLevel + 2.8, groundLevel + 6.2]) {
                const curve = new THREE.LineCurve3(
                    new THREE.Vector3(va.x, railY, va.z),
                    new THREE.Vector3(vb.x, railY, vb.z)
                );
                const railMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 1, 0.18, 4, false), railMat);
                scene.add(railMesh);
                reg.posts.push({ mesh: railMesh, worldPos: new THREE.Vector3(midX, railY, midZ) });
            }

            // F4: barbed wire segment above this edge
            {
                const bwPts = [];
                for (let k = 0; k <= n; k++) {
                    const t = k / n;
                    const px = va.x + t * (vb.x - va.x), pz = va.z + t * (vb.z - va.z);
                    const side = (k % 2 === 0) ? 0.6 : -0.6;
                    const perp = edgeDir + Math.PI / 2;
                    bwPts.push(new THREE.Vector3(px + Math.cos(perp) * side, groundLevel + POST_H + 0.35, pz + Math.sin(perp) * side));
                }
                const bwLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bwPts), barbMat);
                scene.add(bwLine);
                reg.posts.push({ mesh: bwLine, worldPos: new THREE.Vector3(midX, groundLevel + POST_H + 0.35, midZ) });
            }
        }

        // F2: gate — watchtowers at gate corners + crossbar; all linked so destroying one removes all
        {
            const gv0 = hexV[gateEdge], gv1 = hexV[(gateEdge + 1) % 6];
            const gateStart = reg.posts.length;
            makeTower(gv0.x, gv0.z);
            makeTower(gv1.x, gv1.z);
            const barLen = Math.sqrt((gv1.x - gv0.x) ** 2 + (gv1.z - gv0.z) ** 2);
            const crossbar = new THREE.Mesh(new THREE.BoxGeometry(barLen, 0.45, 0.45), cloneMat());
            crossbar.position.set((gv0.x + gv1.x) / 2, groundLevel + POST_H * 1.45, (gv0.z + gv1.z) / 2);
            crossbar.rotation.y = -Math.atan2(gv1.z - gv0.z, gv1.x - gv0.x);
            scene.add(crossbar);
            reg.posts.push({ mesh: crossbar, worldPos: new THREE.Vector3((gv0.x + gv1.x) / 2, groundLevel, (gv0.z + gv1.z) / 2) });
            // Link: destroying any gate part removes all of them
            const gatePosts = reg.posts.slice(gateStart);
            for (const gp of gatePosts) gp.gateGroup = gatePosts;
        }
    }
}

// webgl_lines_colors mode — swap all mesh materials to vibrant HSL wireframe on black background
function _toggleColorMode() {
    _colorMode = !_colorMode;
    const col = new THREE.Color();
    if (_colorMode) {
        _colorModeBg = scene.background;
        scene.background = new THREE.Color(0x000000);
        let idx = 0;
        scene.traverse(obj => {
            if (!obj.isMesh || _colorModeOrigMats.has(obj)) return;
            _colorModeOrigMats.set(obj, obj.material);
            // Three HSL schemes cycling by index, modulated by world Y for depth variation
            const scheme = idx % 3; // 0=cyan, 1=pink, 2=rainbow
            const yFrac  = Math.max(0, Math.min(1, (obj.getWorldPosition(new THREE.Vector3()).y - groundLevel) / 200));
            const h = scheme === 0 ? 0.55 + yFrac * 0.1
                    : scheme === 1 ? 0.88 + yFrac * 0.08
                    : (idx * 0.137 + yFrac * 0.3) % 1.0;
            col.setHSL(h, 1.0, 0.5);
            obj.material = new THREE.MeshBasicMaterial({ color: col.clone(), wireframe: true });
            idx++;
        });
    } else {
        scene.background = _colorModeBg;
        _colorModeOrigMats.forEach((mat, mesh) => {
            if (mesh.material && mesh.material !== mat) mesh.material.dispose();
            mesh.material = mat;
        });
        _colorModeOrigMats.clear();
    }
}

// F5: damage / destroy fence posts within radius of an explosion
function _damageFenceNear(pos, radius) {
    const rSq = radius * radius;
    for (const reg of Object.values(_fenceRegistry)) {
        const toRemove = new Set();
        for (const p of reg.posts) {
            if (pos.distanceToSquared(p.worldPos) < rSq) {
                toRemove.add(p.mesh);
                if (p.gateGroup) p.gateGroup.forEach(gp => toRemove.add(gp.mesh));
            }
        }
        if (!toRemove.size) continue;
        for (let pi = reg.posts.length - 1; pi >= 0; pi--) {
            if (toRemove.has(reg.posts[pi].mesh)) {
                const _dm = reg.posts[pi].mesh;
                scene.remove(_dm);
                if (_dm.isSpotLight) {
                    scene.remove(_dm.target);
                    const _slIdx = _searchlights.findIndex(sl => sl.spot === _dm);
                    if (_slIdx > -1) _searchlights.splice(_slIdx, 1);
                } else {
                    disposeGroup(_dm);
                }
                reg.posts.splice(pi, 1);
            }
        }
    }
}

// F10: tint + tilt posts proportional to base damage
function _updateFenceDamageState(bmId) {
    const reg = _fenceRegistry[bmId];
    if (!reg) return;
    // Combined alive/total across all bases sharing this fence
    let alive = 0, total = 0;
    for (const bm of reg.bases) { alive += bm.alive; total += bm.total; }
    const dmg = total > 0 ? 1 - alive / total : 0; // 0=intact, 1=dead
    // Color: grey 0x6a6a5a → burnt orange 0x8B4513
    const r = (0x6a + (0x8B - 0x6a) * dmg) / 255;
    const g = (0x6a + (0x45 - 0x6a) * dmg) / 255;
    const b = (0x5a + (0x13 - 0x5a) * dmg) / 255;
    reg.posts.forEach(p => {
        p.mesh.traverse(child => {
            if (child.isMesh && child.material) child.material.color.setRGB(r, g, b);
        });
        if (!p.tiltApplied && dmg > 0.15 && Math.random() < dmg * 0.2) {
            p.mesh.rotation.z += (Math.random() - 0.5) * 0.45 * dmg;
            p.mesh.rotation.x += (Math.random() - 0.5) * 0.25 * dmg;
            p.tiltApplied = true;
        }
    });
}

// ================================================================
// --- Airborne Unit Visuals ---
// ================================================================
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

// ================================================================
// --- Air Unit Factory & Destruction ---
// ================================================================
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
function destroyAirUnit(au, idx = airUnits.indexOf(au)) {
    createExplosion(au.group.position);
    // Don't dispose immediately — blink animation (idea 5)
    destroyLabel(au.label);
    airUnits.splice(idx, 1);
    if (!isGameOver) { const _m = _addKill(); score += au.xpValue * _m; scoreElement.textContent = score; addXP(au.xpValue); }
    notifyBase(au.userData.baseId);
    _dyingAirUnits.push({ group: au.group, timer: 50 });
}
// (§2.3) Centralised ground-unit death — used by bullet, bomb, missile, and napalm paths
function killGroundUnit(gu) {
    if (!gu.userData._alive) return; // double-kill guard
    gu.userData._alive = false;
    // Remove dependents first (e.g. airport child turrets) before removing parent (§2.5)
    if (gu.userData.dependents?.length) {
        const depIdxs = [];
        for (const dep of gu.userData.dependents) {
            dep.userData.hp = 0; dep.userData._alive = false; destroyLabel(dep.userData.label);
            const ti = groundUnits.indexOf(dep); if (ti > -1) depIdxs.push(ti);
            _dyingGround.push({ mesh: dep, timer: 50 }); // blink-out (idea 5)
        }
        depIdxs.sort((a, b) => b - a).forEach(ti => groundUnits.splice(ti, 1));
    }
    createExplosion(gu.position);
    destroyLabel(gu.userData.label);
    // Don't dispose immediately — blink animation (idea 5); dispose happens in updateEffects
    const ui = groundUnits.indexOf(gu); if (ui > -1) groundUnits.splice(ui, 1);
    if (!isGameOver) { const _m = _addKill(); score += gu.userData.xpValue * _m; scoreElement.textContent = score; addXP(gu.userData.xpValue); }
    notifyBase(gu.userData.baseId);
    _dyingGround.push({ mesh: gu, timer: 50 });
}

// ================================================================
// --- Airborne Squadron Spawners ---
// ================================================================
function spawnHoverWing(cx, cz) {
    const startIdx = airUnits.length;
    const name = `Hover Wing ${hoverWingNames[hoverWingIdx++ % hoverWingNames.length]}`;
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
function spawnStrikeWing(cx, cz) {
    const startIdx = airUnits.length;
    const name = `Strike Wing ${strikeWingNames[strikeWingIdx++ % strikeWingNames.length]}`;
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
function createAllUnits() {
    createIslets(10); createObstacles();
    for (let i = 0; i < numEnemies; i++) spawnSingleEnemy();
    const getSafeZ2 = r2 => { let p; do { p = { x: randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9), z: randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9) }; } while (p.x * p.x + p.z * p.z < r2); return p; };
    const getSpawnPointOnIslet = () => { const isl = islets[~~(Math.random() * islets.length)], a = Math.random() * Math.PI * 2, d = Math.random() * isl.radius * .9; return { x: isl.x + Math.cos(a) * d, z: isl.z + Math.sin(a) * d, islet: isl }; };
    const getSpawnPointInWater = () => { let p; do { p = getSafeZ2(0); } while (isOnAnyIslet(p.x, p.z)); return p; };
    const sz2 = 300 * 300;
    const sz2_150 = 450 * 450;
    const sz2_100 = 400 * 400;
    for (let i = 0; i < numCarrierGroups; i++) { let p; do { p = getSpawnPointInWater(); } while (p.x * p.x + p.z * p.z < sz2_150); spawnCarrierStrikeGroup(p.x, p.z); }
    for (let i = 0; i < numDestroyerSquadrons; i++) { let p; do { p = getSpawnPointInWater(); } while (p.x * p.x + p.z * p.z < sz2); spawnDestroyerSquadron(p.x, p.z); }
    for (let i = 0; i < numAirbases; i++) { let p; do { p = getSpawnPointOnIslet(); } while (p.x * p.x + p.z * p.z < sz2_100); spawnAirbase(p.x, p.z, p.islet); }
    for (let i = 0; i < numForwardBases; i++) { let p; do { p = getSpawnPointOnIslet(); } while (p.x * p.x + p.z * p.z < sz2); spawnForwardBase(p.x, p.z, p.islet); }
    spawnCollectibleChains(numCollectibleChains);
    spawnHoopChains(numHoopChains);
    // Spawn challenge tubes (cyan, one-pass with orb ratio scoring) and free tubes (orange, open entry)
    for (let _ti = 0; _ti < 3; _ti++) { spawnTube(randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), randomRange(groundLevel + 55, ceilingLevel - 55), randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), 'challenge'); }
    for (let _ti = 0; _ti < 3; _ti++) { spawnTube(randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), randomRange(groundLevel + 55, ceilingLevel - 55), randomRange(-MAP_BOUNDARY * 0.75, MAP_BOUNDARY * 0.75), 'free'); }
    for (let i = 0; i < numHoverWings; i++) { const p = { x: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), z: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8) }; if (p.x * p.x + p.z * p.z < sz2_100) { p.x += 500; p.z += 500; } spawnHoverWing(p.x, p.z); }
    for (let i = 0; i < numStrikeWings; i++) { const p = { x: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), z: randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8) }; if (p.x * p.x + p.z * p.z < sz2_100) { p.x -= 500; p.z -= 500; } spawnStrikeWing(p.x, p.z); }
}
function spawnSingleEnemy() {
    const l = { id: THREE.MathUtils.generateUUID(), parts: [], velocity: new THREE.Vector3(), label: null, hpOffsetY: defaultEnemyHpOffsetY, type: "unknown", boundingBox: new THREE.Box3(), partLocalBoxes: null };
    const c = enemyColors[~~(Math.random() * enemyColors.length)], mat = new THREE.MeshStandardMaterial({ color: c }), lvl = ~~randomRange(1, 4);
    let totalHp = 0;
    l.parts = [
        new THREE.Mesh(new THREE.CylinderGeometry(.4, .5, 3, 10).rotateX(Math.PI / 2), mat),
        new THREE.Mesh(new THREE.BoxGeometry(5, .2, 1), mat),
        new THREE.Mesh(new THREE.BoxGeometry(5, .2, 1), mat),
        new THREE.Mesh(new THREE.BoxGeometry(.2, 1.5, 1), mat),
    ];
    l.parts[1].position.x = -2.5; l.parts[2].position.x = 2.5; l.parts[3].position.set(0, .5, -1.3);
    totalHp = Math.min(enemyPartHP * 4 * lvl, 5 * lvl);
    let sX, sZ, sY = randomRange(groundLevel + 20 + l.hpOffsetY, ceilingLevel - l.hpOffsetY);
    sX = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9); sZ = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9);
    const cP = new THREE.Vector3(sX, sY, sZ);
    let cH = 0;
    l.parts.forEach(p => {
        const h = cH + enemyPartHP <= totalHp ? enemyPartHP : totalHp - cH; cH += h;
        p.position.add(cP); p.scale.set(enemyScale, enemyScale, enemyScale);
        p.userData = { type: "enemy_part", hp: h, logicalEnemyId: l.id, collisionRadius: enemyScale };
        scene.add(p);
    });
    l.velocity.set(Math.random() > .5 ? enemySpeed : -enemySpeed, 0, Math.random() > .5 ? enemySpeed : -enemySpeed);
    l.label = createUnitLabel("Fighter", lvl, totalHp, totalHp); scene.add(l.label.sprite);
    enemies.push(l);
}
function addCollectibleAt(x, y, z, constellationId) {
    const m = new THREE.Mesh(collectibleGeo, collectibleMat);
    m.rotation.z = Math.PI; // heart shape is extruded with Y-up convention; flip to appear right-side up in world
    y = Math.max(groundLevel + 8, Math.min(ceilingLevel - 8, y));
    m.position.set(x, y, z);
    m.userData = { type: 'collectible', collisionRadius: collectibleRadius, constellationId: constellationId || null, originY: y, bobPhase: Math.random() * Math.PI * 2 };
    collectibles.push(m); scene.add(m);
}

// ================================================================
// --- Chain Pattern Helpers (§3.4) ---
// ================================================================
// Shared spatial patterns for collectibles and hoops — only the factory differs
const COLLECTIBLE_CFG = { helix: { n: 12, r: [15, 22], len: 120 }, circle: { n: 10, r: [20, 30] }, fig8: { n: 14, a: [28, 40], b: [14, 20] }, zigzag: { n: 10, amp: [10, 18], spacing: 16 } };
const HOOP_CFG        = { helix: { n:  5, r: 28,      len: 280 }, circle: { n:  5, r: 100       }, fig8: { n:  6, a: 90,       b: 45       }, zigzag: { n:  5, amp: 50,        spacing: 90 } };
function spawnChain(cx, cy, cz, cfg, addFn) {
    const pat = ~~(Math.random() * 5);
    if (pat === 0) {       // helix along Z
        const n = cfg.helix.n, r = rng(cfg.helix.r), len = cfg.helix.len;
        for (let j = 0; j < n; j++) { const t = (j / (n - 1)) * Math.PI * 3; addFn(cx + r * Math.cos(t), cy + r * Math.sin(t), cz + (j / (n - 1)) * len - len / 2); }
    } else if (pat === 1) { // helix along X
        const n = cfg.helix.n, r = rng(cfg.helix.r), len = cfg.helix.len;
        for (let j = 0; j < n; j++) { const t = (j / (n - 1)) * Math.PI * 3; addFn(cx + (j / (n - 1)) * len - len / 2, cy + r * Math.sin(t), cz + r * Math.cos(t)); }
    } else if (pat === 2) { // vertical circle in YZ
        const n = cfg.circle.n, r = rng(cfg.circle.r);
        for (let j = 0; j < n; j++) { const t = (j / n) * Math.PI * 2; addFn(cx, cy + r * Math.sin(t), cz + r * Math.cos(t)); }
    } else if (pat === 3) { // figure-8 (Lissajous 1:2)
        const n = cfg.fig8.n, a = rng(cfg.fig8.a), b = rng(cfg.fig8.b);
        for (let j = 0; j < n; j++) { const t = (j / (n - 1)) * Math.PI * 2; addFn(cx + a * Math.cos(t), cy + b * Math.sin(2 * t), cz + a * Math.sin(t) * Math.cos(t)); }
    } else {               // zigzag
        const n = cfg.zigzag.n, amp = rng(cfg.zigzag.amp), spacing = cfg.zigzag.spacing;
        for (let j = 0; j < n; j++) addFn(cx + (j % 2 === 0 ? amp : -amp), cy, cz + (j - n / 2) * spacing);
    }
}
function spawnCollectibleChains(count) {
    for (let i = 0; i < count; i++) {
        const id = `c${i}`;
        const name = CONSTELLATION_NAMES[i % CONSTELLATION_NAMES.length];
        const before = collectibles.length;
        spawnChain(randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), randomRange(groundLevel + 40, ceilingLevel - 40), randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), COLLECTIBLE_CFG, (x, y, z) => addCollectibleAt(x, y, z, id));
        const total = collectibles.length - before;
        constellations[id] = { name, total, remaining: total, completed: false };
    }
}
// Dashed axis line through the hole of a torus — parented so it inherits rotation
const _hoopAxisMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 3, gapSize: 3, opacity: 0.45, transparent: true });
function _addHoopAxis(torusMesh, r) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -r * 1.3), new THREE.Vector3(0, 0, r * 1.3)]);
    const line = new THREE.Line(geo, _hoopAxisMat);
    line.computeLineDistances();
    torusMesh.add(line);
}
function spawnHoopChains(count) {
    const addHoop = (x, y, z, corridorId) => {
        const r = randomRange(15, 30);
        y = Math.max(groundLevel + r + 8, Math.min(ceilingLevel - r - 8, y));
        const m = new THREE.Mesh(new THREE.TorusGeometry(r, r * .2, 8, 24), torusMaterial);
        m.position.set(x, y, z); m.rotation.set(randomRange(0, Math.PI), randomRange(0, Math.PI), 0);
        _addHoopAxis(m, r);
        const mk = new THREE.Mesh(markerGeometry, markerMaterial); mk.position.copy(m.position);
        mk.userData = { type: 'marker', collisionRadius: markerRadius, hoopMesh: m, corridorId: corridorId || null };
        m.updateMatrixWorld(true);
        m.userData = { type: 'torus', markerMesh: mk, boundingBox: new THREE.Box3().setFromObject(m), matrixWorldInverse: new THREE.Matrix4().copy(m.matrixWorld).invert() }; // (§2.2)
        markers.push(mk); obstacles.push(m); scene.add(m, mk);
    };
    for (let i = 0; i < count; i++) {
        const id = `r${i}`;
        const name = CORRIDOR_NAMES[i % CORRIDOR_NAMES.length];
        const before = markers.length;
        spawnChain(randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), randomRange(groundLevel + 50, ceilingLevel - 50), randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), HOOP_CFG, (x, y, z) => addHoop(x, y, z, id));
        const total = markers.length - before;
        // Chain axis line — dashed polyline through every hoop centre in order
        let axisLine = null;
        if (total >= 2) {
            const pts = markers.slice(before).map(mk => mk.position.clone());
            const ageo = new THREE.BufferGeometry().setFromPoints(pts);
            axisLine = new THREE.Line(ageo, new THREE.LineDashedMaterial({ color: 0xff8800, dashSize: 10, gapSize: 7, opacity: 0.35, transparent: true }));
            axisLine.computeLineDistances();
            scene.add(axisLine);
        }
        corridors[id] = { name, total, remaining: total, completed: false, axisLine };
    }
}
// ================================================================
// --- Tube Challenges (ideas 7-9) ---
// ================================================================
// Sample the curve at N points and return half the minimum pairwise distance
// between non-adjacent samples — gives the largest tube radius that won't self-intersect.
function computeSafeTubeRadius(curve, maxRadius, samples = 40, skipWindow = 4) {
    const pts = [];
    for (let i = 0; i < samples; i++) pts.push(curve.getPoint(i / (samples - 1)));
    let minDist = Infinity;
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + skipWindow; j < pts.length; j++) {
            const d = pts[i].distanceTo(pts[j]);
            if (d < minDist) minDist = d;
        }
    }
    return Math.min(maxRadius, minDist * 0.5 - 1); // leave 1-unit gap
}
// Find nearest t ∈ [0,1] on a CatmullRomCurve3 and distance to that point
function _nearestTubeT(curve, pos) {
    const N = 24; let bestT = 0, bestD = Infinity;
    for (let i = 0; i <= N; i++) { const t = i / N, d = pos.distanceTo(curve.getPoint(t)); if (d < bestD) { bestD = d; bestT = t; } }
    const step = 1 / N;
    for (let i = 0; i <= 10; i++) { const t = Math.max(0, Math.min(1, bestT - step / 2 + (i / 10) * step)); const d = pos.distanceTo(curve.getPoint(t)); if (d < bestD) { bestD = d; bestT = t; } }
    return { t: bestT, d: bestD };
}
// Tubes are mathematical hollow tunnels; fly inside and collect all orbs for big XP
function spawnTube(cx, cy, cz, type = 'challenge') {
    const labels = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
    const name = `Tube ${labels[tubes.length % labels.length]}`;
    const patType = ~~(Math.random() * 3);
    const pts = [];
    if (patType === 0) { // Helix
        const turns = randomRange(2, 3.5), r = randomRange(55, 90), h = randomRange(40, 75);
        for (let k = 0; k <= 22; k++) {
            const t = k / 22;
            pts.push(new THREE.Vector3(cx + Math.cos(t * Math.PI * 2 * turns) * r, cy + (t - 0.5) * h, cz + Math.sin(t * Math.PI * 2 * turns) * r));
        }
    } else if (patType === 1) { // Sine S-curve
        const amp = randomRange(30, 55), len = randomRange(260, 420);
        for (let k = 0; k <= 22; k++) {
            const t = k / 22;
            pts.push(new THREE.Vector3(cx + (t - 0.5) * len, cy + Math.sin(t * Math.PI * 4) * amp * 0.5, cz + Math.sin(t * Math.PI * 2) * amp));
        }
    } else { // Corkscrew dive
        const r = randomRange(45, 75);
        for (let k = 0; k <= 22; k++) {
            const t = k / 22;
            const ang = t * Math.PI * 3;
            pts.push(new THREE.Vector3(cx + Math.cos(ang) * r * (1 - t * 0.3), cy + Math.sin(ang * 0.7) * 18, cz + Math.sin(ang) * r * (1 - t * 0.3)));
        }
    }
    // Clamp Y into valid airspace
    pts.forEach(p => { p.y = Math.max(groundLevel + 30, Math.min(ceilingLevel - 30, p.y)); });
    const curve = new THREE.CatmullRomCurve3(pts);
    // Compute largest non-self-intersecting radius from actual curve geometry
    const tubeRadius = Math.max(12, computeSafeTubeRadius(curve, 20));
    const tubeGeo = new THREE.TubeGeometry(curve, 48, tubeRadius, 8, false);
    const isChallenge = type === 'challenge';
    const tubeColor  = isChallenge ? 0x00ccff : 0xff8800; // cyan = challenge, orange = free
    const orbColor   = isChallenge ? 0x00ccff : 0xff8800;
    const tubeMesh = new THREE.Mesh(tubeGeo, new THREE.MeshBasicMaterial({ color: tubeColor, wireframe: true, transparent: true, opacity: 0.35 }));
    scene.add(tubeMesh);
    // Place collectibles at even intervals along the curve
    const numTC = 10, tubeCols = [];
    for (let k = 0; k <= numTC; k++) {
        const pos = curve.getPoint(k / numTC).clone();
        pos.y = Math.max(groundLevel + 5, Math.min(ceilingLevel - 5, pos.y));
        const tcm = new THREE.Mesh(collectibleGeo, new THREE.MeshStandardMaterial({ color: orbColor, emissive: orbColor, emissiveIntensity: 0.4 }));
        tcm.rotation.z = Math.PI; // match regular hearts — flip upside-down ExtrudeGeometry
        tcm.position.copy(pos);
        tcm.userData = { originY: pos.y, bobPhase: Math.random() * Math.PI * 2 };
        scene.add(tcm);
        tubeCols.push(tcm);
    }
    const totalOrbs = tubeCols.length;
    // challenge-specific state; free tubes carry the same fields but logic ignores them
    tubes.push({ mesh: tubeMesh, geo: tubeGeo, curve, tubeRadius, name, collectibles: tubeCols,
        completed: false, cx, cz, isChallenge,
        state: 'idle',   // 'idle' | 'entered' | 'done'
        entryT: null, inRunCollected: 0, totalOrbs,
        wasInside: false });
}
function spawnSingleHoopWithMarker() {
    const x = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9), z = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9);
    const r = randomRange(15, 30);
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, r * .2, 8, 24), torusMaterial);
    m.position.set(x, randomRange(groundLevel + r + 15, ceilingLevel - r - 15), z);
    m.rotation.set(randomRange(0, Math.PI), randomRange(0, Math.PI), 0);
    _addHoopAxis(m, r);
    const mk = new THREE.Mesh(markerGeometry, markerMaterial); mk.position.copy(m.position);
    mk.userData = { type: 'marker', collisionRadius: markerRadius, hoopMesh: m };
    m.updateMatrixWorld(true);
    m.userData = { type: 'torus', markerMesh: mk, boundingBox: new THREE.Box3().setFromObject(m), matrixWorldInverse: new THREE.Matrix4().copy(m.matrixWorld).invert() }; // (§2.2)
    markers.push(mk); obstacles.push(m); scene.add(m, mk);
}
function createObstacles() {
    const pGeo = new THREE.CylinderGeometry(1, 1, 1, 12), rGeo = new THREE.ConeGeometry(1, 1, 8);
    let c = 0;
    for (let i = 0; i < numObstacles; i++) {
        const f = (targetHoopCount - c) >= numObstacles - i;
        let m, x, z;
        const safeZoneRadius = 200;
        do { x = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9); z = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9); } while (x * x + z * z < safeZoneRadius * safeZoneRadius);
        const t = Math.random(), n = 1 - targetHoopCount / numObstacles, a = f ? 0 : n * .4, s = f ? 0 : a + n * .3;
        if (!f && t < a) {
            const R = randomRange(5, 25), H = ceilingLevel - groundLevel;
            m = new THREE.Mesh(pGeo, caveWallMaterial); m.scale.set(R, H, R); m.position.set(x, groundLevel + H / 2, z);
            m.updateMatrixWorld(true); m.userData = { type: 'pillar', pillarX: x, pillarZ: z, pillarRadius: R };
            obstacles.push(m); scene.add(m);
        } else if (!f && t < s) {
            const b = randomRange(4, 20), h = randomRange(15, ceilingLevel - (groundLevel + 50));
            m = new THREE.Mesh(rGeo, caveWallMaterial); m.scale.set(b, h, b); m.rotation.x = Math.PI; m.position.set(x, ceilingLevel - h / 2, z);
            m.updateMatrixWorld(true);
            const stApex = new THREE.Vector3(0, 0.5, 0); m.localToWorld(stApex);
            const stBase = new THREE.Vector3(0, -0.5, 0); m.localToWorld(stBase);
            m.userData = { type: 'stalactite', coneApex: stApex, coneBase: stBase, coneBaseRadius: b, boundingBox: new THREE.Box3().setFromObject(m) };
            obstacles.push(m); scene.add(m);
        } else {
            if (c < targetHoopCount || f) { spawnSingleHoopWithMarker(); c++; }
            else {
                const b = randomRange(4, 20), h = randomRange(15, ceilingLevel - (groundLevel + 50));
                m = new THREE.Mesh(rGeo, caveWallMaterial); m.scale.set(b, h, b); m.position.set(x, groundLevel + h / 2, z);
                m.updateMatrixWorld(true);
                const smApex = new THREE.Vector3(0, 0.5, 0); m.localToWorld(smApex);
                const smBase = new THREE.Vector3(0, -0.5, 0); m.localToWorld(smBase);
                m.userData = { type: 'stalagmite', coneApex: smApex, coneBase: smBase, coneBaseRadius: b, boundingBox: new THREE.Box3().setFromObject(m) };
                obstacles.push(m); scene.add(m);
            }
        }
    }
}

// --- Collision Math ---
function pillarHitsBox(px, pz, pr, box) {
    const cx = Math.max(box.min.x, Math.min(box.max.x, px)), cz = Math.max(box.min.z, Math.min(box.max.z, pz));
    return (cx - px) ** 2 + (cz - pz) ** 2 < pr * pr;
}
function coneHitsSphere(apex, base, baseR, center, sphereR) {
    const ax = base.x - apex.x, ay = base.y - apex.y, az = base.z - apex.z;
    const h = Math.sqrt(ax * ax + ay * ay + az * az);
    const dx = ax / h, dy = ay / h, dz = az / h;
    const vx = center.x - apex.x, vy = center.y - apex.y, vz = center.z - apex.z;
    const t = vx * dx + vy * dy + vz * dz;
    if (t < -sphereR || t > h + sphereR) return false;
    const tc = Math.max(0, Math.min(h, t));
    const px = vx - t * dx, py = vy - t * dy, pz = vz - t * dz;
    return Math.sqrt(px * px + py * py + pz * pz) < baseR * tc / h + sphereR;
}

// ================================================================
// --- Actions & Events ---
// ================================================================
function fireBullet() {
    const b = _playerBulletPool.pop() || new THREE.Mesh(_playerBulletGeo, _playerBulletMat);
    plane.getWorldDirection(_sv1);
    b.position.copy(plane.position).addScaledVector(_sv1, 3);
    b.velocity = _sv1.clone().multiplyScalar(bulletSpeed); // clone needed — velocity persists on bullet
    b.life = bulletLife;
    b.userData = { type: 'bullet', collisionRadius: .3, damage: bulletDamage * playerDamageMultiplier };
    bullets.push(b); scene.add(b);
    // V5: tracer line
    const _tGeo = new THREE.BufferGeometry().setFromPoints([b.position.clone(), b.position.clone()]);
    b.tracer = new THREE.Line(_tGeo, _tracerMat); scene.add(b.tracer);
    _playGunShot();
    _playerMuzzleLight.intensity = 2.5; // V13
}
function _createBombMesh(mat) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(_bombBodyGeo, mat), new THREE.Mesh(_bombNoseGeo, mat));
    for (let _f = 0; _f < 4; _f++) {
        const fin = new THREE.Mesh(_bombFinGeo, mat);
        fin.rotation.z = _f * Math.PI / 2;
        fin.position.set(Math.sin(_f * Math.PI / 2) * 0.9, Math.cos(_f * Math.PI / 2) * 0.9, -1.6);
        g.add(fin);
    }
    return g;
}
function dropBomb() {
    const b = _createBombMesh(bombMaterial);
    _wv1.set(0, 0, 1).applyQuaternion(plane.quaternion); // forward direction
    b.position.copy(plane.position).add(_bombOffset);
    b.velocity = _wv1.clone().multiplyScalar(speed).add(_bombDroop);
    b.userData = { type: 'bomb', collisionRadius: bombRadius, damage: bombDamage * playerDamageMultiplier, aoERadius: bombAoERadius };
    bombs.push(b); scene.add(b);
    _playBombDrop();
}
function fireMissile() {
    // Find nearest hostile target to home on
    let target = null, nearestSq = Infinity;
    const tryTarget = (pos, alive) => {
        const d = pos().distanceToSquared(plane.position);
        if (d < nearestSq) { nearestSq = d; target = { pos, alive }; }
    };
    groundUnits.forEach(u => { if (u.userData.hp > 0 && u.userData.isHostile) tryTarget(() => u.position, () => u.userData.hp > 0); });
    airUnits.forEach(au => { if (au.hp > 0) tryTarget(() => au.group.position, () => au.hp > 0); });
    enemies.forEach(en => { if (en.parts.some(p => p.userData.hp > 0)) tryTarget(() => en.parts[0].position, () => en.parts.some(p => p.userData.hp > 0)); });
    plane.getWorldDirection(_sv1); // forward
    // World positions of wing-tip barrels — reuse pre-allocated vectors (§3.2)
    _wv1.copy(_missileLTip).applyMatrix4(plane.matrixWorld); // lTip
    _sv3.copy(_missileRTip).applyMatrix4(plane.matrixWorld); // rTip
    const spawnOne = (origin) => {
        const m = _createMissileMesh();
        m.position.copy(origin);
        // Initial velocity: slow forward + downward drop
        m.velocity = _sv1.clone().multiplyScalar(MISSILE_INITIAL_SPEED);
        m.velocity.y -= 0.18;
        m.target = target;
        m.life = missileLife;
        m.speed = MISSILE_INITIAL_SPEED;
        m.dropPhase = MISSILE_DROP_PHASE;
        m.trailTimer = 0;
        _sv2.copy(m.velocity).normalize();
        m.quaternion.setFromUnitVectors(_up3, _sv2);
        missiles.push(m); scene.add(m);
    };
    spawnOne(_wv1); // lTip
    spawnOne(_sv3); // rTip
    _playMissileLaunch();
}
function dropNapalm() {
    _wv1.set(0, 0, 1).applyQuaternion(plane.quaternion); // forward
    const fwdX = _wv1.x, fwdZ = _wv1.z;
    for (let _ci = 0; _ci < 50; _ci++) {
        const orb = new THREE.Mesh(_napClusterOrbGeo, _napClusterOrbMat.clone());
        orb.position.copy(plane.position).add(_bombOffset);
        const spd = speed * (0.5 + Math.random() * 1.1);
        const sx = (Math.random() - 0.5) * 0.18, sz = (Math.random() - 0.5) * 0.18;
        const fwdBias = 0.75 + Math.random() * 0.5; // strong forward bias
        orb.velocity = new THREE.Vector3(fwdX * fwdBias + sx, 0.04 + Math.random() * 0.14, fwdZ * fwdBias + sz)
            .normalize().multiplyScalar(spd).add(_bombDroop.clone().multiplyScalar(0.2));
        orb.userData = { isNapalmCluster: true };
        napalmBombs.push(orb); scene.add(orb);
    }
    _playNapalmDrop();
}
function deployFlareEffect() {
    // Angel-wings pattern: two arcs of bright particles spreading left and right
    plane.getWorldDirection(_sv1); // forward
    _sv2.crossVectors(_up3, _sv1).normalize(); // right — reuse _up3 (§3.2)
    const COUNT = 10; // particles per wing
    for (let wing = -1; wing <= 1; wing += 2) { // -1 = left, +1 = right
        for (let j = 0; j < COUNT; j++) {
            const t = j / (COUNT - 1); // 0..1 across the arc
            // Arc spans from roughly forward-side to backward-side (~18° to ~162° of π)
            const arc = Math.PI * (0.1 + t * 0.8);
            // Direction = sideways component (sin) + backward component (-cos) + downward bias
            _sv3.set(
                Math.sin(arc) * wing * _sv2.x + (-Math.cos(arc)) * _sv1.x,
                -0.25 - t * 0.15,  // tips arc slightly lower, like spread wings
                Math.sin(arc) * wing * _sv2.z + (-Math.cos(arc)) * _sv1.z
            ).normalize();
            const fp = new THREE.Mesh(_flarePGeo, _flarePMatBase.clone());
            fp.position.copy(plane.position);
            fp.velocity = _sv3.clone().multiplyScalar(0.05 + Math.random() * 0.05);
            fp.life = fp.maxLife = FLARE_DURATION;
            flareParticles.push(fp); scene.add(fp);
        }
    }
}
// Deduplicated enemy bullet spawning (§3.2) — used by ground turrets and air units
const _up3 = new THREE.Vector3(0, 1, 0);
function spawnEnemyBullet(fromPos, targetPos) {
    const b = _enemyBulletPool.pop() || _createEnemyBulletMesh();
    // Save from position first — fromPos may alias a scratch vector used below
    b.position.copy(fromPos);
    // Predictive aim: lead the target by estimated bullet travel time, scaled by accuracy
    const dist = Math.sqrt(fromPos.distanceToSquared(targetPos));
    const travelTime = dist / enemyBulletSpeed;
    _sv1.set(0, 0, 1).applyQuaternion(plane.quaternion)
        .multiplyScalar(speed * travelTime * ENEMY_AIM_ACCURACY)
        .add(targetPos);
    // Random cone spread — wider when accuracy is lower
    const spread = dist * (1 - ENEMY_AIM_ACCURACY) * 0.4;
    _sv1.x += (Math.random() * 2 - 1) * spread;
    _sv1.y += (Math.random() * 2 - 1) * spread * 0.5;
    _sv1.z += (Math.random() * 2 - 1) * spread;
    // Direction from bullet origin to aim point
    _sv1.subVectors(_sv1, b.position).normalize();
    b.quaternion.setFromUnitVectors(_up3, _sv1);
    b.velocity = _sv1.clone().multiplyScalar(enemyBulletSpeed);
    b.life = enemyBulletLife;
    b.userData.damage = enemyBulletDamage;
    enemyBullets.push(b); scene.add(b);
    // V4: muzzle flash at barrel origin
    const _mf = new THREE.Mesh(_muzzleFlashGeo, _muzzleFlashMat.clone());
    _mf.position.copy(fromPos); scene.add(_mf); _muzzleFlashes.push({ mesh: _mf, life: 5 });
    // Only play shot sound when enemy is close enough to hear (~half the shooting range)
    if (dist < hostileUnitShootingRange * 0.5) _playEnemyShot();
}
function fireHostileBullet(u) {
    if (u.userData.turretPivot) {
        _sv2.set(0, 0, 4); u.userData.turretPivot.localToWorld(_sv2);
    } else {
        u.getWorldPosition(_sv2); _sv2.y += 5;
    }
    spawnEnemyBullet(_sv2, plane.position);
}
function createExplosion(p) { // §4.5: no setInterval/setTimeout — tracked by updateExplosions(dt)
    const mat = _expMatPool.pop() || new THREE.MeshBasicMaterial({ color: 0xffa500, transparent: true, opacity: 0.8 });
    mat.opacity = 0.8; // reset in case recycled
    const e = new THREE.Mesh(explosionGeometry, mat);
    e.position.copy(p); e.scale.set(.1, .1, .1); scene.add(e);
    activeExplosions.push({ mesh: e, scale: .1 });
}
function updateExplosions(dt) { // §4.5: frame-rate independent, no disposal race
    for (let i = activeExplosions.length - 1; i >= 0; i--) {
        const ex = activeExplosions[i];
        ex.scale *= Math.pow(1.15, dt);
        ex.mesh.scale.setScalar(ex.scale);
        ex.mesh.material.opacity *= Math.pow(0.96, dt);
        if (ex.scale > explosionMaxSize || ex.mesh.material.opacity < .01) {
            scene.remove(ex.mesh);
            ex.mesh.material.opacity = 0.8; // reset before returning to pool
            _expMatPool.push(ex.mesh.material); // return to pool instead of dispose
            activeExplosions.splice(i, 1);
        }
    }
}
// ================================================================
// --- Visual Effects Subsystem (ideas 1-6, 10) ---
// ================================================================
// Idea 7-9 tube ribbon banner
function showTubeRibbon(name, xp = TUBE_XP) {
    const el = document.createElement('div');
    el.className = 'tube-ribbon';
    el.innerHTML = `&#9889; ${name} &mdash; COMPLETE &#9889;<br><span style="font-size:16px">+${xp} XP &mdash; STRENGTH ENHANCED</span>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
    setTimeout(() => { el.classList.remove('visible'); el.classList.add('fade-out'); setTimeout(() => el.remove(), 800); }, 3500);
}
function updateEffects(dt) {
    // ── Heart collectible spin + bob + heartbeat glow ─────────────
    _heartbeatPhase += 0.028 * dt; // ~1 beat per 3.5 s
    // double-thump: two quick peaks close together, then rest
    const _hbRaw = Math.sin(_heartbeatPhase) * 0.5 + Math.sin(_heartbeatPhase * 2.1) * 0.5;
    const _hbGlow = Math.max(0, _hbRaw); // 0..1 positive-only pulse
    const _hbIntensity = 0.25 + _hbGlow * 1.4;
    collectibleMat.emissiveIntensity = _hbIntensity;
    for (let i = 0; i < collectibles.length; i++) {
        const _hc = collectibles[i];
        _hc.rotation.y += 0.018 * dt;
        _hc.userData.bobPhase += 0.022 * dt;
        _hc.position.y = _hc.userData.originY + Math.sin(_hc.userData.bobPhase) * 2.5;
    }
    // Tube-heart bob + glow
    for (const _tb of tubes) {
        for (const _tc of _tb.collectibles) {
            _tc.rotation.y += 0.018 * dt;
            if (_tc.userData.bobPhase !== undefined) {
                _tc.userData.bobPhase += 0.022 * dt;
                _tc.position.y = _tc.userData.originY + Math.sin(_tc.userData.bobPhase) * 2.5;
            }
            if (_tc.material && _tc.material.emissiveIntensity !== undefined) _tc.material.emissiveIntensity = _hbIntensity;
        }
    }
    // ── Idea 1: Collectible burst particles ──────────────────────
    for (let i = collectibleBursts.length - 1; i >= 0; i--) {
        const b = collectibleBursts[i];
        b.mesh.position.addScaledVector(b.velocity, dt);
        b.life -= dt;
        b.mesh.material.opacity = Math.max(0, b.life / b.maxLife);
        b.mesh.scale.setScalar(1 + (1 - b.life / b.maxLife) * 2.5);
        if (b.life <= 0) { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); collectibleBursts.splice(i, 1); }
    }
    // ── Idea 2: Dying markers (torus blink-out over 3 s) ─────────
    for (let i = _dyingMarkers.length - 1; i >= 0; i--) {
        const d = _dyingMarkers[i];
        d.timer -= dt;
        const bp = Math.max(2, Math.round(d.timer * 0.22));
        d.mesh.visible = (Math.floor(d.timer) % (bp * 2)) < bp;
        if (d.timer <= 0) { d.mesh.geometry.dispose(); scene.remove(d.mesh); _dyingMarkers.splice(i, 1); }
    }
    // ── Idea 5: Dying ground units (blink then dispose) ──────────
    for (let i = _dyingGround.length - 1; i >= 0; i--) {
        const d = _dyingGround[i];
        d.timer -= dt;
        const bp = Math.max(2, Math.round(d.timer * 0.22));
        d.mesh.visible = (Math.floor(d.timer) % (bp * 2)) < bp;
        if (d.timer <= 0) { disposeGroup(d.mesh); scene.remove(d.mesh); _dyingGround.splice(i, 1); }
    }
    // ── Idea 5: Dying air units ───────────────────────────────────
    for (let i = _dyingAirUnits.length - 1; i >= 0; i--) {
        const d = _dyingAirUnits[i];
        d.timer -= dt;
        const bp = Math.max(2, Math.round(d.timer * 0.22));
        d.group.visible = (Math.floor(d.timer) % (bp * 2)) < bp;
        if (d.timer <= 0) { disposeGroup(d.group); scene.remove(d.group); _dyingAirUnits.splice(i, 1); }
    }
    // ── Idea 5: Dying enemy fighter parts ────────────────────────
    for (let i = _dyingEnemies.length - 1; i >= 0; i--) {
        const d = _dyingEnemies[i];
        d.timer -= dt;
        const bp = Math.max(2, Math.round(d.timer * 0.22));
        const vis = (Math.floor(d.timer) % (bp * 2)) < bp;
        d.parts.forEach(p => p.visible = vis);
        if (d.timer <= 0) { d.parts.forEach(p => { p.geometry.dispose(); scene.remove(p); }); if (d.mat) d.mat.dispose(); _dyingEnemies.splice(i, 1); }
    }
    // ── Idea 6: Plane debris physics ─────────────────────────────
    for (let i = _planeDebris.length - 1; i >= 0; i--) {
        const d = _planeDebris[i];
        d.velocity.y -= gravity * dt * 0.45;
        d.mesh.position.addScaledVector(d.velocity, dt);
        d.mesh.rotation.x += d.angVel.x * dt;
        d.mesh.rotation.y += d.angVel.y * dt;
        d.mesh.rotation.z += d.angVel.z * dt;
        d.life -= dt;
        if (d.mesh.position.y < groundLevel + 1 || d.life <= 0) {
            scene.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose(); _planeDebris.splice(i, 1);
        }
    }
    // ── Spawn grace period — white blink while invincible ─────────
    if (_graceTimer > 0) {
        _graceTimer = Math.max(0, _graceTimer - dt);
        const glow = Math.floor(_graceTimer * 8) % 2 === 0; // ~8 Hz blink
        _planeMaterials.forEach(m => m.emissive.setHex(glow ? 0xffffff : 0x000000));
        if (_graceTimer <= 0) _planeMaterials.forEach(m => m.emissive.setHex(0x000000));
    }
    // ── Idea 3: Player blink-on-damage ───────────────────────────
    if (_playerBlinkTimer > 0) {
        _playerBlinkTimer = Math.max(0, _playerBlinkTimer - dt);
        const isRed = Math.floor(_playerBlinkTimer / 3) % 2 === 0;
        _planeMaterials.forEach(m => m.emissive.setHex(isRed ? 0xff1100 : 0x000000));
        if (_playerBlinkTimer <= 0) _planeMaterials.forEach(m => m.emissive.setHex(0x000000));
    }
    // ── Idea 4: Hit-confirm crosshair ────────────────────────────
    if (_hitMarkerTimer > 0) {
        _hitMarkerTimer = Math.max(0, _hitMarkerTimer - dt);
        hitMarkerEl.style.opacity = _hitMarkerTimer > 0 ? '1' : '0';
    }
    // ── G20: streak multiplier display decay ─────────────────────
    if (_multiDisplayTimer > 0) { _multiDisplayTimer = Math.max(0, _multiDisplayTimer - dt); if (_multiDisplayTimer <= 0) { _multiEl.style.display = 'none'; _scoreMulti = 1; } }
    // ── V13: muzzle light decay ───────────────────────────────────
    if (_playerMuzzleLight.intensity > 0) _playerMuzzleLight.intensity = Math.max(0, _playerMuzzleLight.intensity - 0.45 * dt);
    // ── V13: empty-clip flash ─────────────────────────────────────
    if (_emptyClipFlash > 0) _emptyClipFlash = Math.max(0, _emptyClipFlash - dt);
    // ── V4: hostile muzzle flashes ────────────────────────────────
    for (let i = _muzzleFlashes.length - 1; i >= 0; i--) {
        const mf = _muzzleFlashes[i]; mf.life -= dt;
        mf.mesh.material.opacity = Math.max(0, mf.life / 5);
        mf.mesh.scale.setScalar(1 + (1 - mf.life / 5) * 2);
        if (mf.life <= 0) { scene.remove(mf.mesh); mf.mesh.material.dispose(); _muzzleFlashes.splice(i, 1); }
    }
    // ── Idea 10: Memory / entity debug panel ─────────────────────
    _memDebugTimer = Math.max(0, _memDebugTimer - dt);
    if (_memDebugTimer <= 0 && memDebugEl.classList.contains('active')) {
        _memDebugTimer = 120;
        let html = '<strong>MEM</strong><br>';
        if (performance.memory) {
            html += `heap: ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}` +
                    `/${(performance.memory.totalJSHeapSize / 1048576).toFixed(0)} MB<br>`;
        }
        const fencePosts = Object.values(_fenceRegistry).reduce((s, r) => s + r.posts.length, 0);
        // [label, value, unit]
        const counts = [
            ['scene',      scene.children.length,                                          'obj'],
            ['fencePosts', fencePosts,                                                     'meshes'],
            ['ground',     groundUnits.length,                                             'units'],
            ['air',        airUnits.length,                                                'units'],
            ['enemies',    enemies.length,                                                 'units'],
            ['bullet',     bullets.length,                                                 'proj'],
            ['eBullet',    enemyBullets.length,                                            'proj'],
            ['missiles',   missiles.length,                                                'proj'],
            ['expl',       activeExplosions.length,                                        'fx'],
            ['napFire',    napalmFireParticles.length,                                     'fx'],
            ['collect',    collectibles.length,                                            'items'],
            ['markers',    markers.length,                                                  'items'],
            ['tubeOrbs',   tubes.reduce((s, t) => s + t.collectibles.length, 0),          'items'],
        ].filter(c => c[1] > 0).sort((a, b) => b[1] - a[1]);
        html += counts.map(([n, v, u]) => `${n}: <b>${v}</b> ${u}`).join('<br>');
        memDebugEl.innerHTML = html;
    }
}
function destroyLogicalEnemy(id) {
    const i = enemies.findIndex(e => e.id === id);
    if (i > -1) {
        const e = enemies[i];
        destroyLabel(e.label);
        enemies.splice(i, 1);
        if (!isGameOver) { const _m = _addKill(); score += 25 * _m; scoreElement.textContent = score; addXP(25); }
        // Defer geometry disposal — blink animation (idea 5)
        _dyingEnemies.push({ parts: e.parts, mat: e.parts.length > 0 ? e.parts[0].material : null, timer: 50 });
        spawnSingleEnemy();
    }
}
function triggerGameOver() {
    if (isGameOver) return; isGameOver = true; speed = 0;
    _gameOverPos.copy(plane.position);
    _goOrbitYaw = 0; _goOrbitPitch = 0.3;
    _steerCursorEl.style.display = 'none';
    if (score > _highScore) { _highScore = score; localStorage.setItem('vibepilot_hs', score); } // G5
    const _isNewBest = score >= _highScore;
    gameOverElement.innerHTML = `GAME OVER!<br><span style="font-size:24px">Score: ${score}${_isNewBest ? '  ★ NEW BEST' : ''}</span><br><span style="font-size:16px">Best: ${_highScore}</span><br><span style="font-size:18px">Refresh to restart</span>`;
    gameOverElement.style.display = 'block';
    enemies.forEach(e => { if (e.label) e.label.sprite.visible = false; });
    groundUnits.forEach(u => { if (u.userData.label) u.userData.label.sprite.visible = false; });
    spawnPlaneDebris(); // idea 6
    // Final stat sample + show debrief graph
    _statHp.push(0); _statScore.push(score); _statXp.push(xp); _statLvl.push(level);
    setTimeout(() => { _drawDeathGraph(); _deathGraphEl.style.display = 'block'; }, 4000);
}
// Idea 6: shatter plane into tumbling debris pieces
function spawnPlaneDebris() {
    plane.visible = false;
    const fwd   = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(plane.quaternion);
    const up    = new THREE.Vector3(0, 1, 0).applyQuaternion(plane.quaternion);
    const colors = [0xffffff, 0xffffff, 0x001f5a, 0xffffff, 0x333344, 0xffffff];
    for (let _i = 0; _i < 6; _i++) {
        const geo = new THREE.BoxGeometry(randomRange(1.5, 4.5), randomRange(0.15, 0.6), randomRange(1, 4.5));
        const mat = new THREE.MeshStandardMaterial({ color: colors[_i] });
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(plane.position)
            .addScaledVector(right, randomRange(-4.5, 4.5))
            .addScaledVector(fwd,   randomRange(-2, 3))
            .addScaledVector(up,    randomRange(-0.5, 2));
        m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        scene.add(m);
        _planeDebris.push({
            mesh: m,
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 0.45 + fwd.x * speed * 0.4,
                0.08 + Math.random() * 0.28,
                (Math.random() - 0.5) * 0.45 + fwd.z * speed * 0.4
            ),
            angVel: new THREE.Vector3(
                (Math.random() - 0.5) * 0.13,
                (Math.random() - 0.5) * 0.13,
                (Math.random() - 0.5) * 0.13
            ),
            life: 150 + ~~(Math.random() * 90)
        });
    }
}

// ================================================================
// --- Initialization ---
// ================================================================
hpElement.textContent = planeHP; updateDamageUI(); createAllUnits(); buildBaseFences();

// ================================================================
// --- Sub-System Functions (§1.2) ---
// ================================================================
function updatePhysics(dt) {
    // Speed control — keyboard OR gamepad left stick Y
    if (keys.w || _gpAxes.throttleUp > 0) speed = Math.min(maxSpeed, speed + acceleration * dt * Math.max(1, _gpAxes.throttleUp));
    else if (keys.s || _gpAxes.throttleDown > 0) speed = Math.max(minSpeed, speed - deceleration * dt * Math.max(1, _gpAxes.throttleDown));
    else speed = Math.max(minSpeed, speed - naturalDeceleration * dt);
    // ── Mouse-cursor quaternion steering (War Thunder style) ────────────
    if (MOUSE_STEERING) {
        // Pre-check manual roll/pitch keys so corrections can be suppressed during manoeuvres
        const _rollKeyHeld  = keys.ArrowLeft || keys.ArrowRight || Math.abs(_gpAxes.roll)  > 0.1;
        const _pitchKeyHeld = keys.ArrowUp   || keys.ArrowDown  || Math.abs(_gpAxes.pitch) > 0.1;
        // Clamp effective cursor to STEER_CURSOR_RADIUS circle in NDC
        let cx = _mouseNDC.x, cy = _mouseNDC.y;
        const cr = Math.sqrt(cx * cx + cy * cy);
        if (cr > STEER_CURSOR_RADIUS) { cx *= STEER_CURSOR_RADIUS / cr; cy *= STEER_CURSOR_RADIUS / cr; }
        // Current forward in world space; save pre-rotation horizontal components for auto-bank
        _sv1.set(0, 0, 1).applyQuaternion(plane.quaternion);
        const oldFwdX = _sv1.x, oldFwdZ = _sv1.z;
        if (cr >= STEER_DEADZONE) {
            // Build desired direction in plane-local space (cursor center = plane forward, no camera bias)
            // Negate cx so left→left, cy positive so up→up
            const yawAng   = -(cx / STEER_CURSOR_RADIUS) * STEER_MAX_ANGLE;
            const pitchAng =  (cy / STEER_CURSOR_RADIUS) * STEER_MAX_ANGLE;
            _sv2.set(Math.sin(yawAng) * Math.cos(pitchAng), Math.sin(pitchAng), Math.cos(yawAng) * Math.cos(pitchAng));
            _sv2.applyQuaternion(plane.quaternion).normalize();
            // Angle between current forward and desired direction
            const cosA = Math.max(-1, Math.min(1, _sv1.dot(_sv2)));
            const angle = Math.acos(cosA);
            if (angle > 0.0001) {
                // Exponential approach (smooth), hard-clamped to max turn rate
                const smoothAng = angle * (1 - Math.pow(1 - STEER_SMOOTHING, dt));
                const applied   = Math.min(smoothAng, STEER_MAX_TURN_RATE * dt);
                _sq1.setFromUnitVectors(_sv1, _sv2);
                _sq2.identity().slerp(_sq1, applied / angle);
                plane.quaternion.premultiply(_sq2).normalize();
            }
        } else if (!_pitchKeyHeld) {
            // Cursor at rest and no manual pitch: gently level pitch toward horizontal flight
            _sv1.set(0, 0, 1).applyQuaternion(plane.quaternion);
            if (Math.abs(_sv1.y) > 0.005) plane.rotateX(_sv1.y * STEER_LEVEL_RATE * dt);
        }
        // Auto-banking: skip entirely when manual roll is held so full 360° rolls are possible
        if (!_rollKeyHeld) {
            _sv1.set(0, 0, 1).applyQuaternion(plane.quaternion); // new forward
            const hturn  = oldFwdX * _sv1.z - oldFwdZ * _sv1.x; // sin of horizontal turn
            _sv3.set(1, 0, 0).applyQuaternion(plane.quaternion);  // local right
            const bankErr = hturn * STEER_AUTO_BANK_K - _sv3.y;   // target bankY minus current
            // Cap correction to maxRollRate so auto-level is never faster than pressing the opposite key
            const bankCorr = Math.max(-maxRollRate, Math.min(maxRollRate, bankErr * STEER_BANK_SMOOTH));
            plane.rotateZ(bankCorr * dt);
        }
    }
    // ── Keyboard / gamepad fine-control (pitch, roll, yaw added on top) ──
    const pitchIn = Math.max(-1, Math.min(1, (keys.ArrowUp ? -1 : 0) + (keys.ArrowDown ? 1 : 0) + _gpAxes.pitch));
    const rollIn  = Math.max(-1, Math.min(1, (keys.ArrowLeft ? -1 : 0) + (keys.ArrowRight ? 1 : 0) + _gpAxes.roll));
    const yawIn   = Math.max(-1, Math.min(1, (keys.a ? 1 : 0) + (keys.d ? -1 : 0) + _gpAxes.yaw));
    if (pitchIn !== 0) pitchRate = Math.max(-maxPitchRate, Math.min(maxPitchRate, pitchRate + pitchIn * rotAccel * dt));
    else pitchRate *= Math.pow(rotDamping, dt);
    if (rollIn  !== 0) rollRate  = Math.max(-maxRollRate,  Math.min(maxRollRate,  rollRate  + rollIn  * rotAccel * dt));
    else rollRate  *= Math.pow(rotDamping, dt);
    if (yawIn   !== 0) yawRate   = Math.max(-maxYawRate,   Math.min(maxYawRate,   yawRate   + yawIn   * rotAccel * dt));
    else yawRate   *= Math.pow(rotDamping, dt);
    plane.rotateX(pitchRate * dt); plane.rotateZ(rollRate * dt); plane.rotateY(yawRate * dt);
    _sv1.set(0, 0, 1).applyQuaternion(plane.quaternion);
    plane.position.addScaledVector(_sv1, speed * dt);
    if ((keys[' '] || _mouseLMB || _gpAxes.shoot) && shootCooldown <= 0 && gunAmmo > 0) { fireBullet(); shootCooldown = shootCooldownTime; if (--gunAmmo <= 0) gunReloadTimer = GUN_RELOAD_TIME; }
    else if ((keys[' '] || _mouseLMB || _gpAxes.shoot) && shootCooldown <= 0 && gunAmmo <= 0) { _emptyClipFlash = 8; shootCooldown = shootCooldownTime; _playEmptyClip(); } // V13 / A11
    plane.updateMatrixWorld(true);
    // Update player bounding boxes (§2.1 — applyMatrix4 avoids per-vertex iteration)
    corePlaneComponents.forEach((m, i) => planePartBoxes[i].copy(planePartLocalBoxes[i]).applyMatrix4(m.matrixWorld));
    updateWingTrail(wingTrailL, _wingTipL);
    updateWingTrail(wingTrailR, _wingTipR);
    // Boundary check
    if (plane.position.y < groundLevel + 1.5 || plane.position.y > ceilingLevel - 1.5 || Math.abs(plane.position.x) > MAP_BOUNDARY || Math.abs(plane.position.z) > MAP_BOUNDARY) triggerGameOver();
}

const _targetWorldPosition = new THREE.Vector3();
function updateAI(dt) {
    // Enemy fighters
    enemies.forEach(e => {
        e.parts.forEach(p => p.position.addScaledVector(e.velocity, dt));
        e.boundingBox.makeEmpty();
        e.parts.forEach(p => { p.updateMatrixWorld(true); e.boundingBox.expandByObject(p); });
        if (e.label && e.parts.length > 0) {
            e.parts[0].getWorldPosition(_targetWorldPosition);
            e.label.sprite.position.copy(_targetWorldPosition).add(_sv2.set(0, e.hpOffsetY || 5, 0));
        }
        if (e.parts.length > 0 && (Math.abs(e.parts[0].position.x) > MAP_BOUNDARY || Math.abs(e.parts[0].position.z) > MAP_BOUNDARY)) destroyLogicalEnemy(e.id);
    });
    // Air units
    for (let i = airUnits.length - 1; i >= 0; i--) {
        const au = airUnits[i];
        if (au.hp <= 0) continue;
        if (au.velocity) {
            au.group.position.addScaledVector(au.velocity, dt);
            _sv3.addVectors(au.group.position, au.velocity); au.group.lookAt(_sv3);
            if (Math.abs(au.group.position.x) > MAP_BOUNDARY * 0.85 || Math.abs(au.group.position.z) > MAP_BOUNDARY * 0.85) {
                const len = au.velocity.length();
                _sv3.set(-au.group.position.x, 0, -au.group.position.z).normalize().multiplyScalar(len);
                au.velocity.lerp(_sv3, 0.08);
            }
        } else if (au.orbitCenter) {
            au.orbitAngle += au.orbitSpeed * dt;
            au.group.position.set(
                au.orbitCenter.x + Math.cos(au.orbitAngle) * au.orbitRadius,
                au.orbitAltitude,
                au.orbitCenter.z + Math.sin(au.orbitAngle) * au.orbitRadius
            );
            au.group.rotation.y = -au.orbitAngle + Math.sign(au.orbitSpeed) * Math.PI / 2;
        }
        if (au.label) au.label.sprite.position.copy(au.group.position).add(_sv3.set(0, au.collisionRadius + 8, 0));
        // V9: rotor / spinner animation
        au.group.traverse(child => { if (child.userData.spinY) child.rotation.y += child.userData.spinY * dt; if (child.userData.spinZ) child.rotation.z += child.userData.spinZ * dt; });
        if (au.isHostile) {
            au.shootCooldown = Math.max(0, au.shootCooldown - dt);
            if (au.shootCooldown <= 0 && au.group.position.distanceToSquared(plane.position) < HOSTILE_SHOOT_RANGE_SQ) {
                _sv3.copy(au.group.position).add(_sv2.set(0, 2, 0));
                spawnEnemyBullet(_sv3, plane.position);
                au.shootCooldown = hostileUnitShootingCooldownTime;
            }
        }
    }
    // Ground units (§2.1 — bake worldBoxes once at first visit; units are stationary so no per-frame update needed)
    groundUnits.forEach(u => {
        if (!u.userData.partBoxes) {
            u.updateMatrixWorld(true); // one-time: compute matrices before baking
            u.userData.partBoxes = [];
            u.traverse(child => {
                if (!child.isMesh) return;
                child.geometry.computeBoundingBox();
                u.userData.partBoxes.push({ worldBox: new THREE.Box3().copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld) });
            });
            u.userData._alive = true;
        }
        if (u.userData.label) { u.getWorldPosition(_targetWorldPosition); u.userData.label.sprite.position.copy(_targetWorldPosition).add(_sv3.set(0, u.userData.hpOffsetY, 0)); }
        if (u.userData.turretPivot && u.userData.hp > 0) {
            u.userData.turretPivot.getWorldPosition(_wp);
            u.userData.turretPivot.lookAt(_sv3.set(plane.position.x, _wp.y, plane.position.z));
        }
        if (u.userData.isHostile && u.userData.hp > 0) {
            u.userData.shootCooldown = Math.max(0, u.userData.shootCooldown - dt);
            if (u.userData.shootCooldown <= 0 && u.position.distanceToSquared(plane.position) < HOSTILE_SHOOT_RANGE_SQ) {
                const _reg = u.userData.baseId ? _fenceRegistry[u.userData.baseId] : null;
                fireHostileBullet(u); u.userData.shootCooldown = (_reg?.alarmState ? hostileUnitShootingCooldownTime * 0.4 : hostileUnitShootingCooldownTime);
            }
        }
    });
}

function updateHUD() {
    let m = null, g = null, md = Infinity, gd = Infinity;
    markers.forEach(mk => { const d = plane.position.distanceToSquared(mk.position); if (d < md) { md = d; m = mk; } });
    groundUnits.forEach(u => { if (u.userData.isHostile && u.userData.hp > 0) { const d = plane.position.distanceToSquared(u.position); if (d < gd) { gd = d; g = u; } } });
    // Nearest enemy — recomputed every 6 frames (§3.1: 40 distance checks/frame → ~7 on average)
    if (++_hudEnemyFrame >= 6) {
        _hudEnemyFrame = 0;
        let ed = Infinity, e = null;
        enemies.forEach(en => en.parts.forEach(p => { const d = plane.position.distanceToSquared(p.position); if (d < ed) { ed = d; e = p; } }));
        _hudNearestEnemy = e; _hudNearestEnemyDist = ed;
    }
    const e = _hudNearestEnemy, ed = _hudNearestEnemyDist;
    if (m) { markerArrow.visible = true; markerArrow.lookAt(m.position); markerDistanceElement.textContent = `${Math.round(Math.sqrt(md))}m`; } else { markerArrow.visible = false; markerDistanceElement.textContent = 'N/A'; }
    if (g) { groundTargetArrow.visible = true; groundTargetArrow.lookAt(g.position); groundDistanceElement.textContent = `${Math.round(Math.sqrt(gd))}m`; } else { groundTargetArrow.visible = false; groundDistanceElement.textContent = 'N/A'; }
    if (e) { enemyArrow.visible = true; enemyArrow.lookAt(e.position); enemyArrow.material.color.copy(e.material.color); enemyDistanceElement.textContent = `${Math.round(Math.sqrt(ed))}m`; } else { enemyArrow.visible = false; enemyDistanceElement.textContent = 'N/A'; }
    posXElement.textContent = Math.round(plane.position.x); posYElement.textContent = Math.round(plane.position.y); posZElement.textContent = Math.round(plane.position.z);
    _rotFwd.set(0, 0, 1).applyQuaternion(plane.quaternion);
    const hdg = Math.round(((Math.atan2(_rotFwd.x, _rotFwd.z) * 180 / Math.PI) + 360) % 360);
    const pch = Math.round(Math.atan2(_rotFwd.y, Math.sqrt(_rotFwd.x * _rotFwd.x + _rotFwd.z * _rotFwd.z)) * 180 / Math.PI);
    const bnk = Math.round(plane.rotation.z * 180 / Math.PI);
    rotHdgElement.textContent = hdg + '°'; rotPchElement.textContent = (pch >= 0 ? '+' : '') + pch + '°'; rotBnkElement.textContent = (bnk >= 0 ? '+' : '') + bnk + '°';
    const rPct = (v, max) => Math.round(Math.abs(v) / max * 100) + '%';
    const rFmt = v => (v >= 0 ? '+' : '') + v.toFixed(3);
    ratePitchPos.style.width = pitchRate > 0 ? rPct(pitchRate, maxPitchRate) : '0%';
    ratePitchNeg.style.width = pitchRate < 0 ? rPct(pitchRate, maxPitchRate) : '0%';
    ratePitchVal.textContent = rFmt(pitchRate);
    rateRollPos.style.width  = rollRate  > 0 ? rPct(rollRate,  maxRollRate)  : '0%';
    rateRollNeg.style.width  = rollRate  < 0 ? rPct(rollRate,  maxRollRate)  : '0%';
    rateRollVal.textContent  = rFmt(rollRate);
    rateYawPos.style.width   = yawRate   > 0 ? rPct(yawRate,   maxYawRate)   : '0%';
    rateYawNeg.style.width   = yawRate   < 0 ? rPct(yawRate,   maxYawRate)   : '0%';
    rateYawVal.textContent   = rFmt(yawRate);
    speedBarEl.style.width   = Math.round((speed - minSpeed) / (maxSpeed - minSpeed) * 100) + '%';
    updateAmmoHUD();
}

// (§2.4) Shared ammo-bar renderer — pre-computed barColor and statusColor passed in per weapon
function updateAmmoBar(barEl, statusEl, ammo, maxAmmo, reloadTimer, barColor, statusColor) {
    barEl.style.width = (ammo / maxAmmo * 100) + '%';
    barEl.style.background = ammo === 0 ? 'transparent' : barColor;
    statusEl.textContent = ammo <= 0 ? (reloadTimer / TARGET_FPS).toFixed(1) + 's' : ammo + '/' + maxAmmo;
    statusEl.style.color = ammo <= 0 ? 'var(--hud-red)' : statusColor;
}
function updateAmmoHUD() {
    // Gun: three-threshold colour
    const gunColor = _emptyClipFlash > 0 ? 'var(--hud-red)' : gunAmmo < gunMaxAmmo * 0.25 ? 'var(--hud-red)' : gunAmmo < gunMaxAmmo * 0.5 ? 'var(--hud-amber)' : 'var(--hud-primary)';
    updateAmmoBar(gunBarEl, gunStatusEl, gunAmmo, gunMaxAmmo, gunReloadTimer, gunColor, _emptyClipFlash > 0 ? 'var(--hud-red)' : 'var(--hud-primary)');

    updateAmmoBar(bombBarEl, bombStatusEl, bombAmmo, bombMaxAmmo, bombReloadTimer,
        bombAmmo === 1 ? 'var(--hud-red)' : 'var(--hud-orange)', 'var(--hud-orange)');

    updateAmmoBar(missileBarEl, missileStatusEl, missileAmmo, missileMaxAmmo, missileReloadTimer,
        missileAmmo === 1 ? 'var(--hud-red)' : 'var(--hud-orange)', 'var(--hud-orange)');

    // Flare: has active-deployed state in addition to normal ammo state
    if (flareTimer > 0) {
        flareBarEl.style.width = '100%';
        flareBarEl.style.background = 'var(--hud-primary)';
        flareStatusEl.textContent = flareTimer.toFixed(0) + 'f';
        flareStatusEl.style.color = 'var(--hud-primary)';
    } else {
        updateAmmoBar(flareBarEl, flareStatusEl, flareAmmo, flareMaxAmmo, flareReloadTimer,
            flareAmmo === 1 ? 'var(--hud-amber)' : 'var(--hud-primary)', 'var(--hud-amber)');
    }

    updateAmmoBar(napalmBarEl, napalmStatusEl, napalmAmmo, napalmMaxAmmo, napalmReloadTimer,
        napalmAmmo === 1 ? 'var(--hud-red)' : '#cc4400', '#ff8844');
}

// Scratch Box3 for plane pickup AABB (covers full wingspan, recomputed each resolveCollisions call)
const _planePickupBox = new THREE.Box3();
const _planeMarkerBox = new THREE.Box3();
function resolveCollisions() {
    // Build plane AABB (union of all part boxes) expanded by collectible radius — covers full wingspan
    _planePickupBox.makeEmpty();
    planePartBoxes.forEach(pb => _planePickupBox.union(pb));
    _planeMarkerBox.copy(_planePickupBox).expandByScalar(markerRadius);
    _planePickupBox.expandByScalar(collectibleRadius);

    // Player vs Markers — full-plane AABB pickup (expanded by markerRadius for generous hitbox)
    for (let i = markers.length - 1; i >= 0; i--) {
        const m = markers[i];
        if (_planeMarkerBox.containsPoint(m.position)) {
            // Yellow burst particles on marker pickup (idea 1 equivalent)
            const _mPos = m.position.clone();
            for (let _b = 0; _b < 8; _b++) {
                const _a = (_b / 8) * Math.PI * 2;
                const _bm = new THREE.Mesh(new THREE.SphereGeometry(0.5, 4, 3), new THREE.MeshBasicMaterial({ color: 0xFFD700, transparent: true }));
                _bm.position.copy(_mPos); scene.add(_bm);
                collectibleBursts.push({ mesh: _bm, velocity: new THREE.Vector3(Math.cos(_a) * 0.18, 0.12 + Math.random() * 0.1, Math.sin(_a) * 0.18), life: 35, maxLife: 35 });
            }
            scene.remove(m); // yellow sphere disappears immediately (idea 2)
            markers.splice(i, 1);
            if (m.userData.hoopMesh) {
                // Remove from collision but leave in scene for blink-out animation (idea 2)
                obstacles.splice(obstacles.indexOf(m.userData.hoopMesh), 1);
                _dyingMarkers.push({ mesh: m.userData.hoopMesh, timer: 3 * TARGET_FPS });
            }
            score += 10; scoreElement.textContent = score; addXP(15);
            _playCollectYellow();
            const cid = m.userData.corridorId;
            if (cid && corridors[cid] && !corridors[cid].completed) {
                const cor = corridors[cid];
                cor.remaining--;
                const done = cor.remaining <= 0;
                if (done) {
                    cor.completed = true;
                    if (cor.axisLine) { scene.remove(cor.axisLine); cor.axisLine.geometry.dispose(); cor.axisLine.material.dispose(); cor.axisLine = null; }
                    showNotification(`◆ ${cor.name} — ALL RINGS  +75 XP`, true);
                    if (!isGameOver) { addXP(75); _healPlayer(30); } // G6
                    addToConqueredRow(`◆ ${cor.name}`, 'row3-scroll');
                } else {
                    showNotification(`◆ ${cor.name}  ${cor.total - cor.remaining}/${cor.total}`);
                }
            }
            spawnSingleHoopWithMarker();
        }
    }
    // Player vs Collectibles — full-plane AABB pickup (idea 3 fix)
    for (let i = collectibles.length - 1; i >= 0; i--) {
        const _col = collectibles[i];
        if (_planePickupBox.containsPoint(_col.position)) {
            const sid = _col.userData.constellationId;
            // Idea 1: burst particles at pickup position
            const _bPos = _col.position.clone();
            scene.remove(_col); collectibles.splice(i, 1);
            for (let _b = 0; _b < 8; _b++) {
                const _a = (_b / 8) * Math.PI * 2;
                const _bm = new THREE.Mesh(new THREE.SphereGeometry(0.4, 4, 3), new THREE.MeshBasicMaterial({ color: 0x00ff44, transparent: true }));
                _bm.position.copy(_bPos);
                scene.add(_bm);
                collectibleBursts.push({ mesh: _bm, velocity: new THREE.Vector3(Math.cos(_a) * 0.16, 0.1 + Math.random() * 0.1, Math.sin(_a) * 0.16), life: 30, maxLife: 30 });
            }
            score += 5; scoreElement.textContent = score; addXP(8);
            if (!isGameOver && planeHP < 100) { planeHP = Math.min(100, planeHP + 5); hpElement.textContent = Math.max(0, planeHP); }
            _playCollectGreen();
            if (sid && constellations[sid] && !constellations[sid].completed) {
                const con = constellations[sid];
                con.remaining--;
                const collected = con.total - con.remaining;
                if (con.remaining <= 0) {
                    con.completed = true;
                    showNotification(`★ ${con.name} Constellation — COMPLETE  +50 XP`, true);
                    if (!isGameOver) { addXP(50); _healPlayer(15); } // G6
                    addToConqueredRow(`★ ${con.name}`, 'row2-scroll');
                } else {
                    showNotification(`★ ${con.name}  ${collected}/${con.total}`);
                }
            }
        }
    }
    // Player vs Tube collectibles (ideas 7-9)
    for (const tube of tubes) {
        if (tube.completed) continue;
        // Challenge tubes: only collect orbs while actively running (entered state)
        if (tube.isChallenge && tube.state !== 'entered') continue;
        for (let i = tube.collectibles.length - 1; i >= 0; i--) {
            const tc = tube.collectibles[i];
            if (_planePickupBox.containsPoint(tc.position)) {
                const _bPos = tc.position.clone();
                scene.remove(tc); tc.geometry.dispose(); tc.material.dispose();
                tube.collectibles.splice(i, 1);
                const burstColor = tube.isChallenge ? 0x00ccff : 0xff8800;
                for (let _b = 0; _b < 6; _b++) {
                    const _a = (_b / 6) * Math.PI * 2;
                    const _bm = new THREE.Mesh(new THREE.SphereGeometry(0.4, 4, 3), new THREE.MeshBasicMaterial({ color: burstColor, transparent: true }));
                    _bm.position.copy(_bPos); scene.add(_bm);
                    collectibleBursts.push({ mesh: _bm, velocity: new THREE.Vector3(Math.cos(_a) * 0.2, 0.15, Math.sin(_a) * 0.2), life: 25, maxLife: 25 });
                }
                score += 5; scoreElement.textContent = score; addXP(10);
                _playCollectCyan();
                _hitMarkerTimer = 9;
                if (tube.isChallenge) {
                    tube.inRunCollected++;
                    _tubeStatusEl.textContent = `${tube.name}  ${tube.inRunCollected} / ${tube.totalOrbs}`;
                } else if (tube.collectibles.length === 0) {
                    // Free tube: complete when all orbs collected
                    tube.completed = true;
                    scene.remove(tube.mesh); tube.geo.dispose(); tube.mesh.material.dispose();
                    if (!isGameOver) { addXP(TUBE_XP); score += TUBE_XP; scoreElement.textContent = score; _healPlayer(20); } // G6
                    showNotification(`⚡ ${tube.name} COMPLETE  +${TUBE_XP} XP`, true);
                    showTubeRibbon(tube.name);
                    addToConqueredRow(`⚡ ${tube.name}`, 'row4-scroll');
                }
            }
        }
    }
    // Challenge tube entry / exit / wall-collision logic
    let _inAnyChallengeTube = false;
    for (const tube of tubes) {
        if (!tube.isChallenge || tube.completed || tube.state === 'done') continue;
        const { t, d } = _nearestTubeT(tube.curve, plane.position);
        const inside   = d < tube.tubeRadius - planeSphereRadius;
        const nearEnd  = t < 0.12 || t > 0.88;
        if (tube.state === 'idle') {
            if (inside && nearEnd) {
                // Valid entry through a cap
                tube.state    = 'entered';
                tube.entryT   = t < 0.5 ? 0 : 1;
                tube.inRunCollected = 0;
                tube.wasInside = true;
                _inAnyChallengeTube = true;
                _tubeStatusEl.style.display = 'block';
                _tubeStatusEl.textContent   = `${tube.name}  0 / ${tube.totalOrbs}`;
            } else if (inside && !nearEnd) {
                // Flew in through the wall from outside — fatal
                triggerGameOver();
            }
        } else if (tube.state === 'entered') {
            if (inside) {
                tube.wasInside = true;
                _inAnyChallengeTube = true;
            } else {
                // Transition: just left the tube volume
                if (!nearEnd) {
                    // Exited through the wall — fatal
                    triggerGameOver();
                } else {
                    const exitEnd = t < 0.5 ? 0 : 1;
                    if (exitEnd !== tube.entryT) {
                        // Correct exit — score based on orb ratio
                        const ratio = tube.totalOrbs > 0 ? tube.inRunCollected / tube.totalOrbs : 0;
                        const xp    = Math.max(20, Math.round(TUBE_XP * ratio));
                        tube.state  = 'done'; tube.completed = true;
                        scene.remove(tube.mesh); tube.geo.dispose(); tube.mesh.material.dispose();
                        tube.collectibles.forEach(tc => { scene.remove(tc); tc.geometry.dispose(); tc.material.dispose(); });
                        tube.collectibles = [];
                        _tubeStatusEl.style.display = 'none';
                        if (!isGameOver) { addXP(xp); score += xp; scoreElement.textContent = score; _healPlayer(20); } // G6
                        const pct = Math.round(ratio * 100);
                        showNotification(`⚡ ${tube.name}  ${tube.inRunCollected}/${tube.totalOrbs} orbs (${pct}%)  +${xp} XP`, true);
                        showTubeRibbon(tube.name, xp);
                        addToConqueredRow(`⚡ ${tube.name}`, 'row4-scroll');
                    } else {
                        // Turned back — exit through same end resets run
                        tube.state = 'idle';
                        tube.wasInside = false;
                        _tubeStatusEl.style.display = 'none';
                        showNotification(`✕ ${tube.name} aborted`);
                    }
                }
            }
        }
    }
    if (!_inAnyChallengeTube) _tubeStatusEl.style.display = 'none';
    // Player vs World obstacles
    for (const o of obstacles) {
        if (o.userData.type === 'torus') continue;
        if (o.userData.type === 'pillar') {
            if (planePartBoxes.some(pb => pillarHitsBox(o.userData.pillarX, o.userData.pillarZ, o.userData.pillarRadius, pb))) { triggerGameOver(); break; }
        } else if (o.userData.type === 'stalactite' || o.userData.type === 'stalagmite') {
            if (coneHitsSphere(o.userData.coneApex, o.userData.coneBase, o.userData.coneBaseRadius, plane.position, planeSphereRadius)) { triggerGameOver(); break; }
        }
    }
    // Player vs Torus tube (§2.2 — use cached inverse matrix)
    if (!isGameOver) {
        for (const o of obstacles) {
            if (o.userData.type !== 'torus') continue;
            _sv1.copy(plane.position).applyMatrix4(o.userData.matrixWorldInverse);
            const { radius: R, tube } = o.geometry.parameters;
            const rho = Math.sqrt(_sv1.x * _sv1.x + _sv1.y * _sv1.y);
            if (Math.sqrt((rho - R) ** 2 + _sv1.z ** 2) < tube + planeSphereRadius) { triggerGameOver(); break; }
        }
    }
    // Player vs Ground units (§2.1 — use worldBox from precomputed local boxes)
    if (!isGameOver) {
        for (const u of groundUnits) {
            if (u.userData.partBoxes && u.userData.partBoxes.some(upb => planePartBoxes.some(ppb => ppb.intersectsBox(upb.worldBox)))) { triggerGameOver(); break; }
        }
    }
    if (!isGameOver) {
        for (const e of enemies) {
            if (e.boundingBox && planePartBoxes.some(pb => pb.intersectsBox(e.boundingBox))) { triggerGameOver(); break; }
        }
    }
    if (!isGameOver) {
        for (const au of airUnits) {
            if (au.hp > 0 && au.group.position.distanceToSquared(plane.position) < (au.collisionRadius + planeSphereRadius) ** 2) { triggerGameOver(); break; }
        }
    }
    // Player vs Enemy Bullets (flares block damage)
    if (!isGameOver) {
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
            const b = enemyBullets[i];
            if (plane.position.distanceToSquared(b.position) < (planeSphereRadius + b.userData.collisionRadius) ** 2) {
                createExplosion(b.position);
                scene.remove(b); _enemyBulletPool.push(b); enemyBullets.splice(i, 1);
                if (flareTimer > 0 || _graceTimer > 0) continue; // deflect: flares or spawn grace period
                planeHP -= b.userData.damage; hpElement.textContent = Math.max(0, planeHP);
                document.body.style.backgroundColor = '#500'; setTimeout(() => document.body.style.backgroundColor = '#111', 100);
                _playerBlinkTimer = 45; // idea 3: plane red-emissive blink on damage
                _playPlayerHit();
                if (planeHP <= 0) { triggerGameOver(); break; }
            }
        }
    }
    // Player Bullets vs Units (§2.3 — spatial grid reduces checks)
    _gridBuild();
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]; if (!b.parent) continue;
        let hit = false;
        // vs Enemies (no grid — enemy fighters scattered with bounding boxes)
        for (const e of enemies) {
            if (e.parts.some(p => { const _cr = b.userData.collisionRadius + (p.userData.collisionRadius || 1); return p.userData.hp > 0 && b.position.distanceToSquared(p.position) < _cr * _cr; })) {
                if (b.tracer) { scene.remove(b.tracer); b.tracer.geometry.dispose(); b.tracer = null; }
                scene.remove(b); _playerBulletPool.push(b); bullets.splice(i, 1); hit = true;
                const part = e.parts.find(p => { const _cr = b.userData.collisionRadius + (p.userData.collisionRadius || 1); return p.userData.hp > 0 && b.position.distanceToSquared(p.position) < _cr * _cr; });
                if (part) part.userData.hp -= b.userData.damage;
                let totalHp = 0; e.parts.forEach(p => totalHp += p.userData.hp);
                updateUnitLabel(e.label, totalHp);
                if (totalHp <= 0) destroyLogicalEnemy(e.id);
                _hitMarkerTimer = 9; // idea 4
                _playKeyClick();
                break;
            }
        }
        if (hit) continue;
        // vs Air + Ground Units via spatial grid
        const nearby = _gridQuery(b.position.x, b.position.z, 100);
        for (const obj of nearby) {
            if (hit) break;
            // Air unit?
            if ('group' in obj) {
                const au = obj;
                if (au.hp <= 0) continue;
                // Main fuselage sphere check
                let _auHit = b.position.distanceToSquared(au.group.position) < (b.userData.collisionRadius + au.collisionRadius) ** 2;
                // Wing/rotor sub-sphere checks (corrects for scale×3 models with large wingspans)
                if (!_auHit && au.wingHalfSpan) {
                    let _wwx, _wwz;
                    if (au.wingType === 'q') { _sv1.set(1, 0, 0).applyQuaternion(au.group.quaternion); _wwx = _sv1.x; _wwz = _sv1.z; }
                    else { const _ry = au.group.rotation.y; _wwx = Math.sin(_ry); _wwz = Math.cos(_ry); }
                    const _wr2 = (b.userData.collisionRadius + au.wingR) ** 2, _hs = au.wingHalfSpan, _gp = au.group.position;
                    const _dx1 = b.position.x-(_gp.x+_wwx*_hs), _dy = b.position.y-_gp.y, _dz1 = b.position.z-(_gp.z+_wwz*_hs);
                    const _dx2 = b.position.x-(_gp.x-_wwx*_hs),                              _dz2 = b.position.z-(_gp.z-_wwz*_hs);
                    _auHit = (_dx1*_dx1+_dy*_dy+_dz1*_dz1 < _wr2) || (_dx2*_dx2+_dy*_dy+_dz2*_dz2 < _wr2);
                }
                if (_auHit) {
                    if (b.tracer) { scene.remove(b.tracer); b.tracer.geometry.dispose(); b.tracer = null; }
                    scene.remove(b); _playerBulletPool.push(b); bullets.splice(i, 1); hit = true;
                    au.hp -= b.userData.damage; au.userData.hp = au.hp;
                    updateUnitLabel(au.label, au.hp);
                    if (au.hp <= 0) destroyAirUnit(au);
                    _hitMarkerTimer = 9; // idea 4
                    _playKeyClick();
                }
            } else {
                // Ground unit
                const u = obj;
                if (u.userData.bombOnly || u.userData.hp <= 0) continue;
                if (u.userData.protector && u.userData.protector.userData.hp > 0) continue; // §4.1: immune while protector lives
                if (b.position.distanceToSquared(u.position) < (b.userData.collisionRadius + u.userData.collisionRadius) ** 2) {
                    if (b.tracer) { scene.remove(b.tracer); b.tracer.geometry.dispose(); b.tracer = null; }
                    scene.remove(b); _playerBulletPool.push(b); bullets.splice(i, 1); hit = true;
                    u.userData.hp -= b.userData.damage; updateUnitLabel(u.userData.label, u.userData.hp);
                    if (u.userData.hp <= 0) killGroundUnit(u); // (§2.3)
                    _hitMarkerTimer = 9; // idea 4
                    _playKeyClick();
                }
            }
        }
    }
}

function updateProjectiles(dt) {
    // Player bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.position.addScaledVector(b.velocity, dt); b.life -= dt;
        // V5: update tracer endpoints
        if (b.tracer) {
            const _tp = b.tracer.geometry.attributes.position;
            _tp.setXYZ(0, b.position.x - b.velocity.x * 4, b.position.y - b.velocity.y * 4, b.position.z - b.velocity.z * 4);
            _tp.setXYZ(1, b.position.x, b.position.y, b.position.z);
            _tp.needsUpdate = true;
        }
        if (b.life <= 0 || Math.abs(b.position.x) > MAP_BOUNDARY || Math.abs(b.position.z) > MAP_BOUNDARY) {
            if (b.tracer) { scene.remove(b.tracer); b.tracer.geometry.dispose(); b.tracer = null; }
            scene.remove(b); _playerBulletPool.push(b); bullets.splice(i, 1);
        }
    }
    if (shootCooldown > 0) shootCooldown -= dt;
    // Bombs
    for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.velocity.y -= gravity * dt; b.position.addScaledVector(b.velocity, dt);
        if (b.velocity.lengthSq() > 0.001) b.quaternion.setFromUnitVectors(_sv1.set(0, 0, 1), _sv2.copy(b.velocity).normalize());
        if (b.position.y <= groundLevel + b.userData.collisionRadius) {
            createExplosion(b.position);
            // §4.1: collect then destroy to handle airport+turret order (no slice needed — outer loop only reads)
            const _bombDestroy = [];
            let _bombAoeHit = false;
            for (const gu of groundUnits) {
                if (gu.userData.protector && gu.userData.protector.userData.hp > 0) continue; // §4.1 protected
                if (gu.userData.hp > 0 && gu.position.distanceToSquared(b.position) < b.userData.aoERadius * b.userData.aoERadius) {
                    gu.userData.hp -= b.userData.damage; updateUnitLabel(gu.userData.label, gu.userData.hp);
                    _hitMarkerTimer = 9; _bombAoeHit = true;
                    if (gu.userData.hp <= 0) _bombDestroy.push(gu);
                }
            }
            // Units-with-dependents (airports) first so child turrets are cleaned up before they're iterated (§2.3/§2.5)
            _bombDestroy.sort(a => a.userData.dependents?.length ? -1 : 1);
            for (const gu of _bombDestroy) killGroundUnit(gu); // killGroundUnit guards _alive internally (§2.3)
            for (let ai = airUnits.length - 1; ai >= 0; ai--) {
                const au = airUnits[ai];
                if (au.hp > 0 && au.group.position.distanceToSquared(b.position) < b.userData.aoERadius * b.userData.aoERadius) {
                    au.hp -= b.userData.damage; au.userData.hp = au.hp;
                    updateUnitLabel(au.label, au.hp);
                    _hitMarkerTimer = 9; _bombAoeHit = true;
                    if (au.hp <= 0) destroyAirUnit(au, ai); // destroyAirUnit calls notifyBase internally
                }
            }
            for (let ei = enemies.length - 1; ei >= 0; ei--) {
                const ae = enemies[ei];
                if (ae.parts.some(p => p.position.distanceToSquared(b.position) < b.userData.aoERadius * b.userData.aoERadius)) {
                    ae.parts.forEach(p => { p.userData.hp -= b.userData.damage; });
                    let th = 0; ae.parts.forEach(p => th += Math.max(0, p.userData.hp));
                    _hitMarkerTimer = 9; _bombAoeHit = true;
                    updateUnitLabel(ae.label, th); if (th <= 0) destroyLogicalEnemy(ae.id);
                }
            }
            if (_bombAoeHit) _playKeyClick();
            _damageFenceNear(b.position, b.userData.aoERadius); // F5
            scene.remove(b); bombs.splice(i, 1);
        } else if (b.position.y < groundLevel - 30) { scene.remove(b); bombs.splice(i, 1); }
    }
    if (bombCooldown > 0) bombCooldown -= dt;
    if (gunAmmo   <= 0) { gunReloadTimer  -= dt; if (gunReloadTimer  <= 0) { gunAmmo  = gunMaxAmmo;    gunReloadTimer  = 0; } }
    if (bombAmmo  <= 0) { bombReloadTimer -= dt; if (bombReloadTimer <= 0) { bombAmmo = bombMaxAmmo;   bombReloadTimer = 0; } }
    if (missileAmmo <= 0) { missileReloadTimer -= dt; if (missileReloadTimer <= 0) { missileAmmo = missileMaxAmmo; missileReloadTimer = 0; } }
    if (flareAmmo   <= 0) { flareReloadTimer   -= dt; if (flareReloadTimer   <= 0) { flareAmmo  = flareMaxAmmo;   flareReloadTimer   = 0; } }
    if (flareTimer   > 0) flareTimer -= dt;
    // Flare angel-wing particles
    for (let i = flareParticles.length - 1; i >= 0; i--) {
        const fp = flareParticles[i];
        fp.position.addScaledVector(fp.velocity, dt);
        fp.velocity.y -= 0.001 * dt; // negligible droop — stays spread
        fp.life -= dt;
        fp.material.opacity = Math.max(0, fp.life / fp.maxLife);
        if (fp.life <= 0) { scene.remove(fp); fp.material.dispose(); flareParticles.splice(i, 1); }
    }
    if (napalmAmmo  <= 0) { napalmReloadTimer  -= dt; if (napalmReloadTimer  <= 0) { napalmAmmo = napalmMaxAmmo;   napalmReloadTimer  = 0; } }
    // Missiles (§5.7)
    for (let i = missiles.length - 1; i >= 0; i--) {
        const m = missiles[i];
        if (m.dropPhase > 0) {
            // Drop phase — fall downward, no homing, slow speed
            m.dropPhase -= dt;
            m.velocity.y -= 0.045 * dt; // pull down
        } else {
            // Cruise phase — speed ramp + homing
            m.speed = Math.min(MISSILE_FINAL_SPEED, m.speed + MISSILE_ACCEL * dt);
            if (m.target && m.target.alive()) {
                _sv1.subVectors(m.target.pos(), m.position).normalize().multiplyScalar(m.speed);
                m.velocity.lerp(_sv1, missileHomingStr * dt);
            } else {
                // No target: maintain direction at increasing speed
                _sv2.copy(m.velocity).normalize().multiplyScalar(m.speed);
                m.velocity.lerp(_sv2, 0.08 * dt);
            }
        }
        m.position.addScaledVector(m.velocity, dt);
        m.life -= dt;
        _sv2.copy(m.velocity).normalize();
        if (_sv2.length() > 0.001) m.quaternion.setFromUnitVectors(_up3, _sv2);
        // Trail particles
        m.trailTimer -= dt;
        if (m.trailTimer <= 0) {
            m.trailTimer = 2.5;
            const tp = new THREE.Mesh(_missileTrailGeo, _missileTrailMat.clone());
            tp.position.copy(m.position);
            tp.life = tp.maxLife = 20;
            missileTrailParticles.push(tp); scene.add(tp);
        }
        const expired = m.life <= 0 || Math.abs(m.position.x) > MAP_BOUNDARY || Math.abs(m.position.z) > MAP_BOUNDARY;
        const groundHit = m.position.y <= groundLevel + 3;
        // Collision check vs ground, air, enemies
        let hit = false;
        for (const u of groundUnits) {
            if (!hit && u.userData.hp > 0 && m.position.distanceToSquared(u.position) < (u.userData.collisionRadius + 2) ** 2) hit = true;
        }
        if (!hit) for (const au of airUnits) {
            if (au.hp > 0 && m.position.distanceToSquared(au.group.position) < (au.collisionRadius + 2) ** 2) { hit = true; break; }
        }
        if (!hit) for (const en of enemies) {
            if (en.parts.some(p => p.userData.hp > 0 && m.position.distanceToSquared(p.position) < 12 * 12)) { hit = true; break; }
        }
        if (hit || groundHit || expired) {
            if (hit || groundHit) {
                // AoE damage
                const dmg = missileDamage * playerDamageMultiplier;
                createExplosion(m.position); createExplosion(m.position); // double flash for missiles
                const _mDestroy = [];
                let _missileAoeHit = false;
                for (const gu of groundUnits) {
                    if (gu.userData.hp > 0 && m.position.distanceToSquared(gu.position) < missileAoERadius * missileAoERadius) {
                        gu.userData.hp -= dmg; updateUnitLabel(gu.userData.label, gu.userData.hp);
                        _hitMarkerTimer = 9; _missileAoeHit = true;
                        if (gu.userData.hp <= 0) _mDestroy.push(gu);
                    }
                }
                _mDestroy.sort(a => a.userData.dependents?.length ? -1 : 1);
                for (const gu of _mDestroy) killGroundUnit(gu); // (§2.3)
                for (let ai = airUnits.length - 1; ai >= 0; ai--) {
                    const au = airUnits[ai];
                    if (au.hp > 0 && m.position.distanceToSquared(au.group.position) < missileAoERadius * missileAoERadius) {
                        au.hp -= dmg; au.userData.hp = au.hp; updateUnitLabel(au.label, au.hp);
                        _hitMarkerTimer = 9; _missileAoeHit = true;
                        if (au.hp <= 0) destroyAirUnit(au, ai);
                    }
                }
                for (const en of enemies) {
                    if (en.parts.some(p => p.userData.hp > 0 && m.position.distanceToSquared(p.position) < missileAoERadius * missileAoERadius)) {
                        en.parts.forEach(p => p.userData.hp -= dmg);
                        let th = 0; en.parts.forEach(p => th += Math.max(0, p.userData.hp));
                        _hitMarkerTimer = 9; _missileAoeHit = true;
                        updateUnitLabel(en.label, th); if (th <= 0) destroyLogicalEnemy(en.id);
                    }
                }
                if (_missileAoeHit) _playKeyClick();
                _damageFenceNear(m.position, missileAoERadius * 0.5); // F5
            }
            scene.remove(m); missiles.splice(i, 1);
        }
    }
    // Missile trail particles
    for (let i = missileTrailParticles.length - 1; i >= 0; i--) {
        const tp = missileTrailParticles[i];
        tp.life -= dt;
        tp.material.opacity = Math.max(0, (tp.life / tp.maxLife) * 0.75);
        if (tp.life <= 0) { scene.remove(tp); tp.material.dispose(); missileTrailParticles.splice(i, 1); }
    }
    // Napalm cluster orbs (§5.7) — scatter on drop, each creates a small fire patch on landing
    for (let i = napalmBombs.length - 1; i >= 0; i--) {
        const b = napalmBombs[i];
        b.velocity.y -= gravity * dt; b.position.addScaledVector(b.velocity, dt);
        if (b.position.y <= groundLevel + 0.8) {
            const pm = new THREE.Mesh(_napClusterPatchGeo, napalmPatchMat.clone());
            pm.position.set(b.position.x, groundLevel + 0.2, b.position.z);
            scene.add(pm);
            napalmPatches.push({ pos: pm.position, life: 90, maxLife: 90, tick: 0, vTick: 0, mesh: pm, patchR: _napClusterR });
            scene.remove(b); b.material.dispose(); napalmBombs.splice(i, 1);
        } else if (b.position.y < groundLevel - 30) { scene.remove(b); b.material.dispose(); napalmBombs.splice(i, 1); }
    }
    // Napalm patches — tick damage over time (§5.7)
    for (let i = napalmPatches.length - 1; i >= 0; i--) {
        const p = napalmPatches[i];
        p.life -= dt; p.tick -= dt; p.vTick -= dt;
        const _pMaxLife = p.maxLife || NAPALM_DURATION;
        const _pR = p.patchR || napalmRadius;
        p.mesh.material.opacity = 0.45 * Math.max(0, p.life / _pMaxLife);
        // Spawn fire tongues: cluster patches get 1 particle per 14 frames, full patches get 4 per 7 frames
        const _vInterval = p.patchR ? 14 : 7;
        if (p.vTick <= 0) {
            p.vTick = _vInterval;
            for (let f = 0; f < (p.patchR ? 1 : 4); f++) {
                const angle = Math.random() * Math.PI * 2;
                const r = Math.sqrt(Math.random()) * _pR;
                const nfp = new THREE.Mesh(_napalmFireGeo, _napalmFireMat.clone());
                nfp.position.set(p.pos.x + Math.cos(angle) * r, groundLevel + 0.5, p.pos.z + Math.sin(angle) * r);
                nfp.velocity = new THREE.Vector3(0, 0.07 + Math.random() * 0.09, 0);
                nfp.life = nfp.maxLife = (p.patchR ? 10 : 18) + Math.random() * 12;
                napalmFireParticles.push(nfp); scene.add(nfp);
            }
        }
        if (p.tick <= 0) {
            p.tick = NAPALM_TICK_INTERVAL;
            const dmg = napalmDamage * (p.patchR ? 0.05 : 1) * playerDamageMultiplier;
            const rSq = _pR * _pR;
            const _napDestroy = [];
            let _napAoeHit = false;
            for (const gu of groundUnits) {
                if (gu.userData.hp > 0 && gu.position.distanceToSquared(p.pos) < rSq) {
                    gu.userData.hp -= dmg; updateUnitLabel(gu.userData.label, gu.userData.hp);
                    _hitMarkerTimer = 9; _napAoeHit = true;
                    if (gu.userData.hp <= 0) _napDestroy.push(gu);
                }
            }
            _napDestroy.sort(a => a.userData.dependents?.length ? -1 : 1);
            for (const gu of _napDestroy) killGroundUnit(gu); // (§2.3)
            if (_napAoeHit) _playKeyClick();
        }
        if (p.life <= 0) { scene.remove(p.mesh); p.mesh.material.dispose(); napalmPatches.splice(i, 1); }
    }
    // Napalm fire particle animation
    for (let i = napalmFireParticles.length - 1; i >= 0; i--) {
        const nfp = napalmFireParticles[i];
        nfp.position.addScaledVector(nfp.velocity, dt);
        nfp.life -= dt;
        const t = nfp.life / nfp.maxLife;           // 1→0 as it dies
        const s = Math.sin(t * Math.PI);             // bell curve: 0 → peak → 0
        nfp.scale.setScalar(s * 1.8 + 0.2);
        nfp.material.opacity = Math.min(1, s * 1.5);
        if (nfp.life <= 0) { scene.remove(nfp); nfp.material.dispose(); napalmFireParticles.splice(i, 1); }
    }
    // Enemy bullets
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.position.addScaledVector(b.velocity, dt); b.life -= dt;
        if (b.life <= 0 || b.position.y < groundLevel || Math.abs(b.position.x) > MAP_BOUNDARY || Math.abs(b.position.z) > MAP_BOUNDARY) {
            scene.remove(b); _enemyBulletPool.push(b); enemyBullets.splice(i, 1);
        }
    }
    updateExplosions(dt); // §4.5
}

function updateDebugBoxes() {
    debugHelpers.forEach(h => { if (h.parent) h.parent.remove(h); });
    debugHelpers.length = 0;
    if (!debugCollision) return;
    const addOBB = (obj, color) => {
        if (!obj.geometry) return;
        obj.geometry.computeBoundingBox();
        const h = new THREE.Box3Helper(obj.geometry.boundingBox.clone(), color);
        obj.add(h); debugHelpers.push(h);
    };
    corePlaneComponents.forEach(m => addOBB(m, 0x00ff00));
    obstacles.forEach(o => {
        if (o.userData.type === 'torus' || o.userData.type === 'pillar' || o.userData.type === 'stalactite' || o.userData.type === 'stalagmite') {
            const h = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ color: o.userData.type === 'torus' ? 0xff4444 : 0xffff00, wireframe: true }));
            o.add(h); debugHelpers.push(h);
        } else { addOBB(o, 0xffff00); }
    });
    collectibles.forEach(c => { const h = new THREE.Mesh(new THREE.SphereGeometry(collectibleRadius, 8, 6), new THREE.MeshBasicMaterial({ color: 0x00ff44, wireframe: true })); c.add(h); debugHelpers.push(h); });
    groundUnits.forEach(u => u.traverse(child => { if (child.isMesh) addOBB(child, 0xff8800); }));
    enemies.forEach(e => e.parts.forEach(p => addOBB(p, 0xff0000)));
    airUnits.forEach(au => { if (au.hp <= 0) return; au.group.traverse(child => { if (child.isMesh) addOBB(child, 0xff44ff); }); });
}

function updateCamera() {
    if (isGameOver) {
        const ORBIT_SPEED = 0.025;
        if (keys.ArrowLeft  || keys.a) _goOrbitYaw   -= ORBIT_SPEED;
        if (keys.ArrowRight || keys.d) _goOrbitYaw   += ORBIT_SPEED;
        if (keys.ArrowUp)              _goOrbitPitch  = Math.min(_goOrbitPitch + ORBIT_SPEED, Math.PI / 2 - 0.05);
        if (keys.ArrowDown)            _goOrbitPitch  = Math.max(_goOrbitPitch - ORBIT_SPEED, -0.3);
        const r = _goOrbitDist;
        camera.position.set(
            _gameOverPos.x + r * Math.cos(_goOrbitPitch) * Math.sin(_goOrbitYaw),
            _gameOverPos.y + r * Math.sin(_goOrbitPitch),
            _gameOverPos.z + r * Math.cos(_goOrbitPitch) * Math.cos(_goOrbitYaw)
        );
        camera.lookAt(_gameOverPos);
        return;
    }
    _camOffset.set(0, 8, -22).applyQuaternion(plane.quaternion);
    const camTarget = _sv1.copy(plane.position).add(_camOffset);
    _lookAt.set(0, 1, 20).applyQuaternion(plane.quaternion).add(plane.position);
    if (!isPaused) camera.position.lerp(camTarget, .06);
    camera.lookAt(_lookAt);
}

// ================================================================
// --- Main Animation Loop (§1.2, §2.5, §3.6) ---
// ================================================================
function animate() {
    requestAnimationFrame(animate);
    pollGamepad();
    const rawDelta = clock.getDelta();
    const dt = Math.min(rawDelta * TARGET_FPS, 6); // cap at 6 frames — prevents spiral-of-death on tab switch

    // Stat sampling (~1 s interval) for death debrief
    if (!isGameOver && !isPaused) {
        _statTimer -= dt;
        if (_statTimer <= 0) { _statTimer = 60; _statHp.push(Math.max(0, planeHP)); _statScore.push(score); _statXp.push(xp); _statLvl.push(level); }
    }
    if (!isGameOver && !isPaused) {
        updatePhysics(dt);
        updateAI(dt);
        resolveCollisions();
        updateHUD();
        updateProjectiles(dt);
        updateEffects(dt); // ideas 1-6, 10
    } else if (isGameOver) {
        markerArrow.visible = false; groundTargetArrow.visible = false; enemyArrow.visible = false;
        markerDistanceElement.textContent = 'N/A'; groundDistanceElement.textContent = 'N/A'; enemyDistanceElement.textContent = 'N/A';
        posXElement.textContent = '-'; posYElement.textContent = '-'; posZElement.textContent = '-';
        rotHdgElement.textContent = '-'; rotPchElement.textContent = '-'; rotBnkElement.textContent = '-';
        updateEffects(dt); // debris physics still runs on game over
    }
    updateDebugBoxes();
    updateCamera();
    // Decay steering cursor toward center when mouse is idle
    if (MOUSE_STEERING) {
        const _decay = Math.pow(1 - STEER_RETURN_DECAY, dt);
        _mouseNDC.x *= _decay;
        _mouseNDC.y *= _decay;
    }
    // Update steering cursor position (clamped to effective steering circle)
    if (_steerCursorEl.style.display !== 'none') {
        let cx = _mouseNDC.x, cy = _mouseNDC.y;
        const cr = Math.sqrt(cx * cx + cy * cy);
        if (cr > STEER_CURSOR_RADIUS) { cx *= STEER_CURSOR_RADIUS / cr; cy *= STEER_CURSOR_RADIUS / cr; }
        _steerCursorEl.style.left = ((cx + 1) * 0.5 * window.innerWidth)  + 'px';
        _steerCursorEl.style.top  = ((-cy + 1) * 0.5 * window.innerHeight) + 'px';
    }
    // F6: searchlight sweep + alarm state detection
    if (!isPaused && !isGameOver && _searchlights.length > 0) {
        for (const sl of _searchlights) {
            sl.angle += sl.speed * rawDelta * TARGET_FPS;
            const tx = sl.worldPos.x + Math.cos(sl.angle) * sl.range * 0.75;
            const tz = sl.worldPos.z + Math.sin(sl.angle) * sl.range * 0.75;
            sl.spot.target.position.set(tx, groundLevel, tz);
            sl.spot.target.updateMatrixWorld();
            // Detect player in cone
            const dx = plane.position.x - sl.worldPos.x, dz = plane.position.z - sl.worldPos.z;
            const distXZ = Math.sqrt(dx * dx + dz * dz);
            if (distXZ < sl.range) {
                const dot = (dx / distXZ) * Math.cos(sl.angle) + (dz / distXZ) * Math.sin(sl.angle);
                if (dot > Math.cos(sl.halfAngle)) {
                    for (const bid of sl.baseIds) {
                        const reg = _fenceRegistry[bid];
                        if (reg) { reg.alarmState = true; reg.alarmTimer = 480; }
                    }
                    sl.spot.color.setHex(0xff4400); // turn red when alarmed
                }
            }
            if (sl.spot.color.r < 1) sl.spot.color.lerp(new THREE.Color(0xffffaa), 0.02); // fade back
        }
        // Decay alarm timers
        for (const reg of Object.values(_fenceRegistry)) {
            if (reg.alarmState) { reg.alarmTimer = (reg.alarmTimer || 0) - rawDelta * TARGET_FPS; if (reg.alarmTimer <= 0) { reg.alarmState = false; } }
        }
    }
    // F9: flag animation — pivot Group rotates to face wind direction; flag extends sideways from pole tip
    if (_flagMeshes.length > 0) {
        _sv1.set(0, 0, 1).applyQuaternion(plane.quaternion);
        const windAngle = Math.atan2(_sv1.x, _sv1.z);
        const wave = Math.sin(Date.now() * 0.0025) * 0.12;
        const wy = windAngle + wave;
        for (const f of _flagMeshes) {
            if (!f.mesh.parent) continue; // removed from scene
            f.mesh.rotation.y = wy;
        }
    }
    // Radar cycle — one full sweep per 3 s; snapshot taken at each revolution end (pauses when game is paused)
    if (!isPaused && !isGameOver) {
        _radarSweepAngle += rawDelta * (Math.PI * 2 / 3);
        _radarCycleTimer += rawDelta;
        if (_radarCycleTimer >= 3.0) {
            _radarCycleTimer -= 3.0;
            _radarSweepAngle = -Math.PI / 2; // snap back to north, keeping sweep in sync
            updateRadarSnapshot();
        }
    }
    // Throttled minimap redraw — 15 fps regardless of game frame rate (§2.5)
    _minimapTimer += rawDelta;
    if (_minimapTimer >= MINIMAP_REFRESH_S) { updateMinimap(); _minimapTimer = 0; }
    renderer.render(scene, camera);
}

// ================================================================
// --- Minimap ---
// ================================================================
function updateRadarSnapshot() {
    _radarPlayerPos.copy(plane.position);
    plane.getWorldDirection(_sv1);
    _radarPlayerAngle = Math.atan2(_sv1.x, _sv1.z);
    _radarBlips = [];
    markers.forEach(m => _radarBlips.push({ wx: m.position.x, wz: m.position.z, color: 'yellow', shape: 'dot' }));
    collectibles.forEach(c => _radarBlips.push({ wx: c.position.x, wz: c.position.z, color: '#00ff44', shape: 'dot' }));
    enemies.forEach(e => { if (e.parts.length > 0) _radarBlips.push({ wx: e.parts[0].position.x, wz: e.parts[0].position.z, color: 'red', shape: 'dot' }); });
    groundUnits.forEach(u => { if (u.userData.hp > 0) { u.getWorldPosition(_wp); _radarBlips.push({ wx: _wp.x, wz: _wp.z, color: u.userData.isHostile ? 'orange' : 'white', shape: 'dot' }); } });
    airUnits.forEach(au => { if (au.hp > 0) _radarBlips.push({ wx: au.group.position.x, wz: au.group.position.z, color: au.isHostile ? '#ff4444' : '#aaddff', shape: 'triangle' }); });
    baseMarkers.forEach(bm => { if (!bm.eliminated) _radarBlips.push({ wx: bm.position.x, wz: bm.position.z, color: bm.isHostile ? '#ff8844' : '#88ccff', shape: 'square', label: `${bm.name} ${bm.alive}/${bm.total}` }); });
    tubes.forEach(t => { if (!t.completed) _radarBlips.push({ wx: t.cx, wz: t.cz, color: '#00ccff', shape: 'ring' }); });
}
// ================================================================
function updateMinimap() {
    minimapCtx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    // Composite pre-drawn static rings (§3.4)
    minimapCtx.drawImage(_ringsCanvas, 0, 0);
    const playerPos = _radarPlayerPos, scale = (MINIMAP_SIZE / 2) / MINIMAP_VIEW_RANGE;
    const playerAngle = _radarPlayerAngle;
    const cx = MINIMAP_SIZE / 2, cy = MINIMAP_SIZE / 2, maxR = MINIMAP_SIZE / 2;
    // Sweep trail — 8 graduated slices fading behind the sweep line
    const TRAIL_ARC = Math.PI * 0.55, STEPS = 10;
    for (let i = 0; i < STEPS; i++) {
        const t = i / STEPS;
        const a0 = _radarSweepAngle - TRAIL_ARC * (1 - t);
        const a1 = _radarSweepAngle - TRAIL_ARC * (1 - t - 1 / STEPS);
        minimapCtx.beginPath();
        minimapCtx.moveTo(cx, cy);
        minimapCtx.arc(cx, cy, maxR, a0, a1);
        minimapCtx.closePath();
        minimapCtx.fillStyle = `rgba(0,255,90,${0.09 * t * t})`;
        minimapCtx.fill();
    }
    // Sweep line
    minimapCtx.beginPath();
    minimapCtx.moveTo(cx, cy);
    minimapCtx.lineTo(cx + Math.cos(_radarSweepAngle) * maxR, cy + Math.sin(_radarSweepAngle) * maxR);
    minimapCtx.strokeStyle = 'rgba(0,255,90,0.65)';
    minimapCtx.lineWidth = 1.5;
    minimapCtx.stroke();
    minimapCtx.lineWidth = 1;
    // ------------------------------------------------------------------
    minimapCtx.save();
    minimapCtx.translate(MINIMAP_SIZE / 2, MINIMAP_SIZE / 2);
    minimapCtx.rotate(playerAngle);
    const getMinimapPoint = wp => ({ x: -(wp.x - playerPos.x) * scale, y: -(wp.z - playerPos.z) * scale });
    const compassRadius = MINIMAP_SIZE / 2 - 12;
    minimapCtx.fillStyle = 'rgba(255,255,255,0.8)'; minimapCtx.font = 'bold 12px Arial'; minimapCtx.textAlign = 'center'; minimapCtx.textBaseline = 'middle';
    minimapCtx.fillText('N', 0, -compassRadius); minimapCtx.fillText('S', 0, compassRadius); minimapCtx.fillText('E', compassRadius, 0); minimapCtx.fillText('W', -compassRadius, 0);
    minimapCtx.fillStyle = 'rgba(85,107,47,0.7)';
    islets.forEach(islet => {
        const ic = getMinimapPoint(islet), ir = islet.radius * scale;
        const _rd = MINIMAP_SIZE / 2 + ir;
        if (ic.x * ic.x + ic.y * ic.y >= _rd * _rd) return;
        minimapCtx.beginPath();
        islet.polygon.forEach((pt, k) => {
            const mp = getMinimapPoint(pt);
            k === 0 ? minimapCtx.moveTo(mp.x, mp.y) : minimapCtx.lineTo(mp.x, mp.y);
        });
        minimapCtx.closePath(); minimapCtx.fill();
    });
    // Draw blips from last radar snapshot (positions frozen until next sweep)
    const namedLabels = [];
    _radarBlips.forEach(b => {
        const mp = { x: -(b.wx - playerPos.x) * scale, y: -(b.wz - playerPos.z) * scale };
        if (mp.x*mp.x + mp.y*mp.y >= MINIMAP_HALF_R_SQ) return;
        if (b.shape === 'triangle') {
            minimapCtx.fillStyle = b.color;
            minimapCtx.beginPath(); minimapCtx.moveTo(mp.x, mp.y - 5); minimapCtx.lineTo(mp.x - 4, mp.y + 3); minimapCtx.lineTo(mp.x + 4, mp.y + 3); minimapCtx.closePath(); minimapCtx.fill();
        } else if (b.shape === 'square') {
            minimapCtx.fillStyle = b.color; minimapCtx.fillRect(mp.x - 3, mp.y - 3, 6, 6);
            if (b.label) {
                const sx = MINIMAP_SIZE / 2 + mp.x * Math.cos(playerAngle) - mp.y * Math.sin(playerAngle);
                const sy = MINIMAP_SIZE / 2 + mp.x * Math.sin(playerAngle) + mp.y * Math.cos(playerAngle);
                namedLabels.push({ sx, sy, name: b.label, color: b.color });
            }
        } else if (b.shape === 'ring') {
            minimapCtx.strokeStyle = b.color; minimapCtx.lineWidth = 1.5;
            minimapCtx.beginPath(); minimapCtx.arc(mp.x, mp.y, 6, 0, Math.PI * 2); minimapCtx.stroke();
            minimapCtx.lineWidth = 1;
        } else {
            minimapCtx.fillStyle = b.color; minimapCtx.fillRect(mp.x - 1.5, mp.y - 1.5, 3, 3);
        }
    });
    minimapCtx.restore();
    minimapCtx.font = 'bold 10px Arial'; minimapCtx.textAlign = 'left'; minimapCtx.lineWidth = 2;
    namedLabels.forEach(({ sx, sy, name, color }) => {
        minimapCtx.strokeStyle = 'rgba(0,0,0,0.85)'; minimapCtx.strokeText(name, sx + 5, sy + 3);
        minimapCtx.fillStyle = color; minimapCtx.fillText(name, sx + 5, sy + 3);
    });
    minimapCtx.fillStyle = 'white';
    minimapCtx.beginPath(); minimapCtx.moveTo(MINIMAP_SIZE / 2, MINIMAP_SIZE / 2 - 6); minimapCtx.lineTo(MINIMAP_SIZE / 2 - 4, MINIMAP_SIZE / 2 + 6); minimapCtx.lineTo(MINIMAP_SIZE / 2 + 4, MINIMAP_SIZE / 2 + 6); minimapCtx.closePath(); minimapCtx.fill();
}

window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); }, false);
window.onload = () => {
    animate();
    runSplash();
};

// Green heart collectible — warm ascending C-E-G arpeggio (life gain feel)
function _playCollectGreen() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        [523, 659, 784].forEach((freq, i) => {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t + i * 0.07);
            gain.gain.setValueAtTime(0, t + i * 0.07);
            gain.gain.linearRampToValueAtTime(0.18, t + i * 0.07 + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.22);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(t + i * 0.07); osc.stop(t + i * 0.07 + 0.25);
            if (i === 2) osc.onended = () => ctx.close();
        });
    } catch(e) {}
}

// Cyan tube orb — sharper higher ping (1100→550 Hz), shorter
function _playCollectCyan() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1100, t);
        osc.frequency.exponentialRampToValueAtTime(550, t + 0.1);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.14); osc.onended = () => ctx.close();
    } catch(e) {}
}

// Yellow marker — warmer triangle wave, lower pitch (523→262 Hz), longer decay
function _playCollectYellow() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.exponentialRampToValueAtTime(262, t + 0.22);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.28); osc.onended = () => ctx.close();
    } catch(e) {}
}

// Enemy shot — short sawtooth "pew" (400→80 Hz, 90 ms)
function _playEnemyShot() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.09);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.10, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.1); osc.onended = () => ctx.close();
    } catch(e) {}
}

// Machinegun shot — short noise tick with low-pass to soften (quieter than hit-marker)
function _playGunShot() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const dur = 0.045;
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 3000;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.14, 0);
        gain.gain.exponentialRampToValueAtTime(0.001, dur);
        src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
        src.start(); src.onended = () => ctx.close();
    } catch(e) {}
}

function _playKeyClick() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 8);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.18, 0);
        gain.gain.exponentialRampToValueAtTime(0.001, 0.04);
        src.connect(gain); gain.connect(ctx.destination);
        src.start(); src.onended = () => ctx.close();
    } catch(e) {}
}

function _playBombDrop() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        // Falling whistle — descending sine
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.exponentialRampToValueAtTime(180, t + 0.35);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.22, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.38); osc.onended = () => ctx.close();
    } catch(e) {}
}

function _playMissileLaunch() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        const dur = 1.6;
        // Layer 1 — rocket hiss: band-passed noise, sustained then fading
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2200, t); bp.frequency.linearRampToValueAtTime(800, t + dur);
        bp.Q.value = 0.6;
        const hiss = ctx.createGain();
        hiss.gain.setValueAtTime(0.0, t);
        hiss.gain.linearRampToValueAtTime(0.55, t + 0.06); // sharp ignition spike
        hiss.gain.linearRampToValueAtTime(0.3, t + 0.3);   // settle into sizzle
        hiss.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(bp); bp.connect(hiss); hiss.connect(ctx.destination);
        src.start(t);
        // Layer 2 — low ignition thud: short sine bump on launch
        const osc = ctx.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(140, t); osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
        const tg = ctx.createGain();
        tg.gain.setValueAtTime(0.35, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.connect(tg); tg.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.25);
        src.onended = () => ctx.close();
    } catch(e) {}
}

function _playEmptyClip() { // A11
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        // Dry metallic tick — short noise transient, no tone
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.025), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.22, t);
        src.connect(hp); hp.connect(g); g.connect(ctx.destination);
        src.start(t); src.onended = () => ctx.close();
    } catch(e) {}
}
function _playNapalmDrop() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        // Heavy thud + low rumble
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90, t);
        osc.frequency.exponentialRampToValueAtTime(30, t + 0.28);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.32); osc.onended = () => ctx.close();
    } catch(e) {}
}

function _playPlayerHit() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        // Low thud — sine sweep downward
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(130, t);
        osc.frequency.exponentialRampToValueAtTime(35, t + 0.18);
        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(0.5, t);
        oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.connect(oscGain); oscGain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.22);
        // Short noise transient layered on top
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 4);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.35, t);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(noiseGain); noiseGain.connect(ctx.destination);
        src.start(t); src.onended = () => ctx.close();
    } catch(e) {}
}

function runSplash() {
    const splash   = document.getElementById('splash-screen');
    const titleEl  = document.getElementById('splash-title');
    const subEl    = document.getElementById('splash-subtitle');
    const cursor   = document.getElementById('splash-cursor');
    const TITLE    = 'Vibe Pilot';
    const SUBTITLE = 'Objective: Crush enemies';
    const TITLE_SPEED    = 110; // ms per character
    const SUBTITLE_SPEED = 55;

    // Move cursor to end of title text
    function setCursor(el) { el.appendChild(cursor); }

    // Helper: set element text while keeping cursor as last child
    function setText(el, text) {
        // Remove existing text nodes, keep cursor
        [...el.childNodes].forEach(n => { if (n !== cursor) n.remove(); });
        el.insertBefore(document.createTextNode(text), cursor);
    }

    // Show "press any key" prompt — user gesture needed to unlock AudioContext
    const prompt = document.createElement('div');
    prompt.id = 'splash-prompt';
    prompt.textContent = '— press any key —';
    splash.appendChild(prompt);

    function startTypeOut() {
        prompt.remove();
        let cancelled = false;

        function dismiss() {
            if (cancelled) return;
            cancelled = true;
            document.removeEventListener('keydown', onEscapeKey);
            // Use textContent directly — setText() uses insertBefore(cursor) which throws
            // a DOMException if cursor is not a child of that element at dismiss time.
            titleEl.textContent = TITLE;
            subEl.textContent   = SUBTITLE;
            titleEl.style.opacity = '1';
            cursor.style.animation = 'none';
            cursor.style.opacity   = '0';
            splash.style.opacity   = '0';
            speed = maxSpeed * 0.5;
            setTimeout(() => { splash.remove(); if (MOUSE_STEERING) _steerCursorEl.style.display = 'block'; }, 500);
        }
        function onEscapeKey(e) { if (e.key === 'Escape') dismiss(); }
        document.addEventListener('keydown', onEscapeKey);

        // Phase 1: type TITLE
        let i = 0;
        setCursor(titleEl);
        const titleTimer = setInterval(() => {
            if (cancelled) { clearInterval(titleTimer); return; }
            i++;
            setText(titleEl, TITLE.slice(0, i));
            _playKeyClick();
            if (i >= TITLE.length) {
                clearInterval(titleTimer);
                // Pause, then fade title out
                setTimeout(() => {
                    if (cancelled) return;
                    titleEl.style.opacity = '0';
                    cursor.style.opacity  = '0';
                    // Phase 2: type SUBTITLE after fade
                    setTimeout(() => {
                        if (cancelled) return;
                        cursor.style.opacity = '1';
                        setCursor(subEl);
                        let j = 0;
                        const subTimer = setInterval(() => {
                            if (cancelled) { clearInterval(subTimer); return; }
                            j++;
                            setText(subEl, SUBTITLE.slice(0, j));
                            _playKeyClick();
                            if (j >= SUBTITLE.length) {
                                clearInterval(subTimer);
                                // Pause, then fade entire splash out
                                setTimeout(() => { dismiss(); }, 1800);
                            }
                        }, SUBTITLE_SPEED);
                    }, 650);
                }, 900);
            }
        }, TITLE_SPEED);
    }

    function onFirstInput(e) {
        if (['Shift','Control','Alt','Meta'].includes(e.key)) return;
        document.removeEventListener('keydown', onFirstInput);
        document.removeEventListener('pointerdown', onFirstInput);
        startTypeOut();
    }
    document.addEventListener('keydown', onFirstInput);
    document.addEventListener('pointerdown', onFirstInput);
}
