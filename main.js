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
const START_SAFE_ZONE      = 300;    // exclusion radius around player spawn

// --- Environment ---
const caveWallMaterial = new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.9 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_BOUNDARY * 2, MAP_BOUNDARY * 2), caveWallMaterial);
ground.rotation.x = -Math.PI / 2; ground.position.y = groundLevel; scene.add(ground);
const water = new THREE.Mesh(new THREE.PlaneGeometry(MAP_BOUNDARY * 2, MAP_BOUNDARY * 2), new THREE.MeshStandardMaterial({ color: 0x001e3d, roughness: 0.2, metalness: 0.1 }));
water.rotation.x = -Math.PI / 2; water.position.y = waterLevel; scene.add(water);
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(MAP_BOUNDARY * 2, MAP_BOUNDARY * 2), caveWallMaterial);
ceiling.rotation.x = Math.PI / 2; ceiling.position.y = ceilingLevel; scene.add(ceiling);
// --- Islets ---
const islets = [];
const isletMaterial = new THREE.MeshStandardMaterial({ color: 0x556B2F });
function createIslets(count) {
    for (let i = 0; i < count; i++) {
        const radius = randomRange(200, 500);
        const x = randomRange(-MAP_BOUNDARY * 0.8, MAP_BOUNDARY * 0.8);
        const z = randomRange(-MAP_BOUNDARY * 0.8, MAP_BOUNDARY * 0.8);
        islets.push({ x, z, radius });
        const isletMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 2, 32), isletMaterial);
        isletMesh.position.set(x, groundLevel + 1, z);
        scene.add(isletMesh);
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
const _camOffset = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _wp = new THREE.Vector3(); // scratch for getWorldPosition

// --- THREE.Clock for delta-time (§3.6) ---
const clock = new THREE.Clock();
let _minimapTimer = 0; // seconds since last minimap redraw (§2.5)

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
// --- UI Elements & Minimap ---
const scoreElement = document.getElementById('score'), hpElement = document.getElementById('hp'), gameOverElement = document.getElementById('game-over'), pausedElement = document.getElementById('paused'), enemyDistanceElement = document.getElementById('enemy-distance'), groundDistanceElement = document.getElementById('ground-distance'), markerDistanceElement = document.getElementById('marker-distance'), posXElement = document.getElementById('pos-x'), posYElement = document.getElementById('pos-y'), posZElement = document.getElementById('pos-z'), rotHdgElement = document.getElementById('rot-hdg'), rotPchElement = document.getElementById('rot-pch'), rotBnkElement = document.getElementById('rot-bnk'), levelElement = document.getElementById('level'), xpElement = document.getElementById('xp'), xpToNextLevelElement = document.getElementById('xp-to-next-level'), bulletDamageValueElement = document.getElementById('bullet-damage-value'), ratePitchElement = document.getElementById('rate-pitch'), rateRollElement = document.getElementById('rate-roll'), rateYawElement = document.getElementById('rate-yaw');
const gunBarEl = document.getElementById('gun-bar'), gunStatusEl = document.getElementById('gun-status');
const bombBarEl = document.getElementById('bomb-bar'), bombStatusEl = document.getElementById('bomb-status');
const minimap = document.getElementById('minimap'), minimapCtx = minimap.getContext('2d'), MINIMAP_SIZE = 400;
minimap.width = MINIMAP_SIZE; minimap.height = MINIMAP_SIZE;
const MINIMAP_HALF_R_SQ = (MINIMAP_SIZE / 2) * (MINIMAP_SIZE / 2); // §2.7 squared threshold for hypot checks

// ================================================================
// --- Flight Config (easy-edit tuning knobs) ---
// ================================================================
const maxSpeed = .8, minSpeed = .02;
const acceleration = .003, deceleration = .002, naturalDeceleration = .0005;
const maxPitchRate = .025, maxRollRate = .035, maxYawRate = .03;
const rotAccel = .00085;
const rotDamping = .85;
const bulletDamage = 1, bombDamage = 40, bombAoERadius = 50, bulletSpeed = 1.8, bulletLife = 150, shootCooldownTime = 4;

// ================================================================
// --- Game State (§1.3 — grouped by concern) ---
// ================================================================
// Player
let score = 0, planeHP = 100, level = 1, xp = 0, xpToNextLevel = 100, playerDamageMultiplier = 1;
// Control flow
let isGameOver = false, isPaused = false;
// Flight rates
let pitchRate = 0, rollRate = 0, yawRate = 0, speed = .1;
// Cooldowns
let shootCooldown = 0, bombCooldown = 0;
let gunAmmo = GUN_MAX_AMMO, gunReloadTimer = 0;
let bombAmmo = BOMB_MAX_AMMO, bombReloadTimer = 0;
// Entities
const bullets = [], bombs = [], enemyBullets = [], activeExplosions = []; // §4.5
const enemies = [], groundUnits = [], airUnits = [];
const obstacles = [], markers = [], collectibles = [];
const baseMarkers = [], basesById = {};
// Debug
const debugHelpers = [];
let debugCollision = false;
// Unused variable removed: isLaserVisible

// --- Bomb & explosion resources ---
const bombMaterial = new THREE.MeshStandardMaterial({ color: "#222", roughness: .7 });
const bombRadius = 1.5, bombGeometry = new THREE.SphereGeometry(bombRadius, 10, 10);
const bombCooldownTime = 45;
const gravity = .008;
const explosionGeometry = new THREE.SphereGeometry(1, 16, 16);
const explosionMaterial = new THREE.MeshBasicMaterial({ color: 0xffa500, transparent: true, opacity: .8 });
const explosionDuration = 400, explosionMaxSize = 50;
// --- Marker / collectible resources ---
const markerRadius = 5, markerGeometry = new THREE.SphereGeometry(markerRadius, 16, 16);
const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xFFD700, emissive: 0xccad00 });
const collectibleRadius = 1.5, numCollectibleChains = 20;
const collectibleGeo = new THREE.SphereGeometry(collectibleRadius, 8, 8);
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
let aibaseIdx = 0, forwardBaseIdx = 0, fleetIdx = 0, squadronIdx = 0, hoverWingIdx = 0, strikeWingIdx = 0;
let notifSlot = 0;

// --- Enemy setup ---
const enemyColors = [16711680, 255, 16711935, 65535, 16747520, 15790320, 8388736];
const enemyPartHP = 1, numEnemies = 10, enemySpeed = .05, enemyScale = 2;
const defaultEnemyHpOffsetY = 5 * enemyScale;
const numAirbases = 5, numForwardBases = 8, numCarrierGroups = 2, numDestroyerSquadrons = 3;
const enemyBulletSpeed = .8, enemyBulletLife = 200, enemyBulletDamage = 5;
const hostileUnitShootingRange = 600, hostileUnitShootingCooldownTime = 120;
const HOSTILE_SHOOT_RANGE_SQ = hostileUnitShootingRange * hostileUnitShootingRange; // §2.7
const numHoverWings = 3, numStrikeWings = 2;
// --- Ammo system (§5.7) ---
const GUN_MAX_AMMO = 60, GUN_RELOAD_TIME = 180;   // reload ~3 s at 60 fps (dt units)
const BOMB_MAX_AMMO = 4,  BOMB_RELOAD_TIME = 300;  // reload ~5 s at 60 fps
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
        new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, 2.5, 8), new THREE.MeshBasicMaterial({ color: 0xff4400 })),
        new THREE.Mesh(new THREE.ConeGeometry(.35, 1, 8),             new THREE.MeshBasicMaterial({ color: 0xff8800 }))
    );
    b.children[1].position.y = 1.75;
    b.userData = { type: 'enemy_bullet', collisionRadius: 1.5, damage: 0 };
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
document.addEventListener('keydown', e => {
    if (isGameOver) return;
    const k = e.key.toLowerCase();
    if (k === 'f') aimingLaser.visible = !aimingLaser.visible;
    else if (k === 'e') { if (bombCooldown <= 0 && bombAmmo > 0) { dropBomb(); bombCooldown = bombCooldownTime; if (--bombAmmo <= 0) bombReloadTimer = BOMB_RELOAD_TIME; } }
    else if (keys.hasOwnProperty(k)) keys[k] = true;
    else if (keys.hasOwnProperty(e.key)) keys[e.key] = true;
});
document.addEventListener('keyup', e => {
    if (isGameOver) return;
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
    else if (keys.hasOwnProperty(e.key)) keys[e.key] = false;
});
document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'b') debugCollision = !debugCollision;
    if (e.key.toLowerCase() === 'n') { wingTrailL.pts.visible = !wingTrailL.pts.visible; wingTrailR.pts.visible = !wingTrailR.pts.visible; }
    if (e.key === 'Escape' && !isGameOver) {
        isPaused = !isPaused;
        pausedElement.style.display = isPaused ? 'block' : 'none';
        if (isPaused) { Object.keys(keys).forEach(k => keys[k] = false); pitchRate = rollRate = yawRate = 0; }
    }
});

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
        levelElement.textContent = level; updateDamageUI();
    }
    xpElement.textContent = xp; xpToNextLevelElement.textContent = xpToNextLevel;
}
function updateDamageUI() { bulletDamageValueElement.textContent = (bulletDamage * playerDamageMultiplier).toFixed(2); }

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
function addToConqueredPanel(bmName) {
    const panel = document.getElementById('conquered-panel');
    if (!panel) return;
    let scroll = document.getElementById('conquered-scroll');
    if (!scroll) { scroll = document.createElement('div'); scroll.id = 'conquered-scroll'; panel.appendChild(scroll); }
    const entry = document.createElement('span'); entry.className = 'conquered-entry'; entry.textContent = `✓ ${bmName}`; scroll.appendChild(entry);
    requestAnimationFrame(() => {
        const overflow = scroll.scrollWidth - panel.clientWidth;
        if (overflow > 0) {
            const duration = Math.max(4, scroll.scrollWidth / 50);
            scroll.style.animation = 'none';
            scroll.style.setProperty('--ticker-dist', `-${overflow}px`);
            requestAnimationFrame(() => { scroll.style.animation = `conquered-ticker ${duration}s ease-in-out infinite alternate`; });
        } else { scroll.style.animation = 'none'; }
    });
}
function notifyBase(u) {
    if (!u.userData.baseId) return;
    const bm = basesById[u.userData.baseId];
    if (!bm || bm.eliminated) return;
    bm.alive = bm.units.filter(x => x.userData.hp > 0).length;
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
        if (!child.isMesh) return;
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
            u.add(new THREE.Mesh(new THREE.BoxGeometry(3, 2, 20), unitMat), new THREE.Mesh(new THREE.BoxGeometry(2.5, 2, 4), unitMat), new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 1.5), unitMat), new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, 3, 8), unitMat));
            u.children[1].position.set(0, 2, -2); u.children[2].position.set(0, 1.5, 5); u.children[3].position.set(0, 1.5, 6.5); u.children[3].rotation.x = Math.PI / 2; u.scale.set(5, 5, 5); break;
        case 'carrier':
            n = "Carrier"; l = 10; hp = 200; collR = 18 * 8; hpY = 6 * 8; xp = 300; u.position.y = waterLevel;
            u.add(new THREE.Mesh(new THREE.BoxGeometry(8, 3, 35), unitMat), new THREE.Mesh(new THREE.BoxGeometry(12, .5, 32), unitMat), new THREE.Mesh(new THREE.BoxGeometry(2, 3, 6), unitMat));
            u.children[1].position.y = 1.75; u.children[2].position.set(5, 3.5, -2); u.scale.set(8, 8, 8); break;
    }
    const label = createUnitLabel(n, l, hp, hp); scene.add(label.sprite);
    u.userData = { type, hp, maxHp: hp, collisionRadius: collR, label, hpOffsetY: hpY, isHostile: hostile, shootCooldown: hostile ? Math.random() * hostileUnitShootingCooldownTime : 0, xpValue: xp, id: THREE.MathUtils.generateUUID(), partBoxes: null, turretPivot: turretPivotRef };
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
    const dx = px - islet.x, dz = pz - islet.z, dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= islet.radius * 0.9) return { x: px, z: pz };
    const s = islet.radius * 0.9 / dist;
    return { x: islet.x + dx * s, z: islet.z + dz * s };
}
function isOnAnyIslet(px, pz) { return islets.some(i => (px - i.x) ** 2 + (pz - i.z) ** 2 < i.radius * i.radius); }
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
// --- Airborne Unit Visuals ---
// ================================================================
function createHelicopterVisual() {
    const outer = new THREE.Group(), g = new THREE.Group();
    g.rotation.y = -Math.PI / 2;
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a5240, roughness: 0.7 });
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2, 10, 8), mat); fuselage.rotation.x = Math.PI / 2;
    const rotorA = new THREE.Mesh(new THREE.BoxGeometry(18, 0.3, 1.2), mat); rotorA.position.y = 2.2;
    const rotorB = new THREE.Mesh(new THREE.BoxGeometry(18, 0.3, 1.2), mat); rotorB.position.y = 2.2; rotorB.rotation.y = Math.PI / 2;
    const tailBoom = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 8), mat); tailBoom.position.set(0, -0.3, -7);
    const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 0.8), mat); tailRotor.position.set(0, 0, -11); tailRotor.rotation.z = Math.PI / 2;
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
        case 'helicopter': visual = createHelicopterVisual(); hp = 60;  collR = 12; xp = 80;  hostile = true;  name = 'Helicopter'; break;
        case 'balloon':    visual = createBalloonVisual();    hp = 15;  collR = 10; xp = 40;  hostile = false; name = 'Balloon';    break;
        case 'fighter':    visual = createFighterVisual();    hp = 40;  collR = 10; xp = 100; hostile = true;  name = 'Fighter';    level = ~~randomRange(1, 3); hp *= level; xp *= level; break;
        case 'tanker':     visual = createTankerVisual();     hp = 200; collR = 25; xp = 200; hostile = false; name = 'Tanker';     break;
        case 'ac130':      visual = createAC130Visual();      hp = 150; collR = 22; xp = 250; hostile = true;  name = 'AC-130';     break;
    }
    visual.position.set(x, y, z); visual.scale.set(3, 3, 3); scene.add(visual);
    const label = createUnitLabel(name, level, hp, hp); scene.add(label.sprite);
    const au = { id: THREE.MathUtils.generateUUID(), type, group: visual, hp, maxHp: hp, collisionRadius: collR, xpValue: xp, isHostile: hostile, baseId: null, label, shootCooldown: 0, userData: { hp, baseId: null } };
    return au;
}
function destroyAirUnit(au, idx = airUnits.indexOf(au)) {
    createExplosion(au.group.position);
    disposeGroup(au.group);
    scene.remove(au.group);
    destroyLabel(au.label);
    airUnits.splice(idx, 1);
    if (!isGameOver) { score += au.xpValue; scoreElement.textContent = score; addXP(au.xpValue); }
    notifyBase({ userData: au.userData });
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
    const sz2 = START_SAFE_ZONE * START_SAFE_ZONE;
    const sz2_150 = (START_SAFE_ZONE + 150) * (START_SAFE_ZONE + 150);
    const sz2_100 = (START_SAFE_ZONE + 100) * (START_SAFE_ZONE + 100);
    for (let i = 0; i < numCarrierGroups; i++) { let p; do { p = getSpawnPointInWater(); } while (p.x * p.x + p.z * p.z < sz2_150); spawnCarrierStrikeGroup(p.x, p.z); }
    for (let i = 0; i < numDestroyerSquadrons; i++) { let p; do { p = getSpawnPointInWater(); } while (p.x * p.x + p.z * p.z < sz2); spawnDestroyerSquadron(p.x, p.z); }
    for (let i = 0; i < numAirbases; i++) { let p; do { p = getSpawnPointOnIslet(); } while (p.x * p.x + p.z * p.z < sz2_100); spawnAirbase(p.x, p.z, p.islet); }
    for (let i = 0; i < numForwardBases; i++) { let p; do { p = getSpawnPointOnIslet(); } while (p.x * p.x + p.z * p.z < sz2); spawnForwardBase(p.x, p.z, p.islet); }
    spawnCollectibleChains(numCollectibleChains);
    spawnHoopChains(numHoopChains);
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
    do { sX = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9); sZ = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9); } while (sX * sX + sZ * sZ < START_SAFE_ZONE * START_SAFE_ZONE);
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
function addCollectibleAt(x, y, z) {
    const m = new THREE.Mesh(collectibleGeo, collectibleMat);
    m.position.set(x, y, z); m.userData = { type: 'collectible', collisionRadius: collectibleRadius };
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
        spawnChain(randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), randomRange(groundLevel + 40, ceilingLevel - 40), randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), COLLECTIBLE_CFG, addCollectibleAt);
    }
}
function spawnHoopChains(count) {
    const addHoop = (x, y, z) => {
        const r = randomRange(15, 30);
        const m = new THREE.Mesh(new THREE.TorusGeometry(r, r * .2, 8, 24), torusMaterial);
        m.position.set(x, y, z); m.rotation.set(randomRange(0, Math.PI), randomRange(0, Math.PI), 0);
        const mk = new THREE.Mesh(markerGeometry, markerMaterial); mk.position.copy(m.position);
        mk.userData = { type: 'marker', collisionRadius: markerRadius, hoopMesh: m };
        m.updateMatrixWorld(true);
        m.userData = { type: 'torus', markerMesh: mk, boundingBox: new THREE.Box3().setFromObject(m), matrixWorldInverse: new THREE.Matrix4().copy(m.matrixWorld).invert() }; // (§2.2)
        markers.push(mk); obstacles.push(m); scene.add(m, mk);
    };
    for (let i = 0; i < count; i++) {
        spawnChain(randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), randomRange(groundLevel + 50, ceilingLevel - 50), randomRange(-MAP_BOUNDARY * .8, MAP_BOUNDARY * .8), HOOP_CFG, addHoop);
    }
}
function spawnSingleHoopWithMarker() {
    const x = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9), z = randomRange(-MAP_BOUNDARY * .9, MAP_BOUNDARY * .9);
    const r = randomRange(15, 30);
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, r * .2, 8, 24), torusMaterial);
    m.position.set(x, randomRange(groundLevel + r + 15, ceilingLevel - r - 15), z);
    m.rotation.set(randomRange(0, Math.PI), randomRange(0, Math.PI), 0);
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
}
function dropBomb() {
    const b = new THREE.Mesh(bombGeometry, bombMaterial);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);
    b.position.copy(plane.position).add(new THREE.Vector3(0, -1.5, 0));
    b.velocity = f.clone().multiplyScalar(speed).add(new THREE.Vector3(0, -.05, 0));
    b.userData = { type: 'bomb', collisionRadius: bombRadius, damage: bombDamage * playerDamageMultiplier, aoERadius: bombAoERadius };
    bombs.push(b); scene.add(b);
}
// Deduplicated enemy bullet spawning (§3.2) — used by ground turrets and air units
const _up3 = new THREE.Vector3(0, 1, 0);
function spawnEnemyBullet(fromPos, targetPos) {
    const b = _enemyBulletPool.pop() || _createEnemyBulletMesh();
    _sv1.subVectors(targetPos, fromPos).normalize();
    b.quaternion.setFromUnitVectors(_up3, _sv1);
    b.position.copy(fromPos);
    b.velocity = _sv1.clone().multiplyScalar(enemyBulletSpeed);
    b.life = enemyBulletLife;
    b.userData.damage = enemyBulletDamage;
    enemyBullets.push(b); scene.add(b);
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
    const e = new THREE.Mesh(explosionGeometry, explosionMaterial.clone());
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
            scene.remove(ex.mesh); ex.mesh.material.dispose(); activeExplosions.splice(i, 1);
        }
    }
}
function destroyLogicalEnemy(id) {
    const i = enemies.findIndex(e => e.id === id);
    if (i > -1) {
        const e = enemies[i];
        const mat = e.parts.length > 0 ? e.parts[0].material : null;
        e.parts.forEach(p => { p.geometry.dispose(); scene.remove(p); });
        if (mat) mat.dispose();
        destroyLabel(e.label);
        enemies.splice(i, 1);
        if (!isGameOver) { score += 25; scoreElement.textContent = score; addXP(25); }
        spawnSingleEnemy();
    }
}
function triggerGameOver() {
    if (isGameOver) return; isGameOver = true; speed = 0;
    gameOverElement.innerHTML = `GAME OVER!<br><span style="font-size:24px">Final Score: ${score}</span><br><span style="font-size:18px">Refresh to restart</span>`;
    gameOverElement.style.display = 'block';
    enemies.forEach(e => { if (e.label) e.label.sprite.visible = false; });
    groundUnits.forEach(u => { if (u.userData.label) u.userData.label.sprite.visible = false; });
}

// ================================================================
// --- Initialization ---
// ================================================================
hpElement.textContent = planeHP; updateDamageUI(); createAllUnits();

// ================================================================
// --- Sub-System Functions (§1.2) ---
// ================================================================
function updatePhysics(dt) {
    // Speed control
    if (keys.w) speed = Math.min(maxSpeed, speed + acceleration * dt);
    else if (keys.s) speed = Math.max(minSpeed, speed - deceleration * dt);
    else speed = Math.max(minSpeed, speed - naturalDeceleration * dt);
    // Rotation rates
    if (keys.ArrowUp)    pitchRate = Math.max(-maxPitchRate, pitchRate - rotAccel * dt);
    else if (keys.ArrowDown)  pitchRate = Math.min(maxPitchRate,  pitchRate + rotAccel * dt);
    else pitchRate *= Math.pow(rotDamping, dt);
    if (keys.ArrowLeft)  rollRate = Math.max(-maxRollRate, rollRate - rotAccel * dt);
    else if (keys.ArrowRight) rollRate = Math.min(maxRollRate,  rollRate + rotAccel * dt);
    else rollRate *= Math.pow(rotDamping, dt);
    if (keys.a)          yawRate = Math.min(maxYawRate,  yawRate + rotAccel * dt);
    else if (keys.d)     yawRate = Math.max(-maxYawRate, yawRate - rotAccel * dt);
    else yawRate *= Math.pow(rotDamping, dt);
    plane.rotateX(pitchRate * dt); plane.rotateZ(rollRate * dt); plane.rotateY(yawRate * dt);
    _sv1.set(0, 0, 1).applyQuaternion(plane.quaternion);
    plane.position.addScaledVector(_sv1, speed * dt);
    if (keys[' '] && shootCooldown <= 0 && gunAmmo > 0) { fireBullet(); shootCooldown = shootCooldownTime; if (--gunAmmo <= 0) gunReloadTimer = GUN_RELOAD_TIME; }
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
        if (au.isHostile) {
            au.shootCooldown = Math.max(0, au.shootCooldown - dt);
            if (au.shootCooldown <= 0 && au.group.position.distanceToSquared(plane.position) < HOSTILE_SHOOT_RANGE_SQ) {
                _sv3.copy(au.group.position).add(_sv2.set(0, 2, 0));
                spawnEnemyBullet(_sv3, plane.position);
                au.shootCooldown = hostileUnitShootingCooldownTime;
            }
        }
    }
    // Ground units (§2.1 — lazy-build local boxes, then applyMatrix4 each frame)
    groundUnits.forEach(u => {
        u.updateMatrixWorld(true);
        if (!u.userData.partBoxes) {
            u.userData.partBoxes = [];
            u.traverse(child => {
                if (!child.isMesh) return;
                child.geometry.computeBoundingBox();
                u.userData.partBoxes.push({ mesh: child, localBox: child.geometry.boundingBox.clone(), worldBox: new THREE.Box3() });
            });
        }
        u.userData.partBoxes.forEach(pb => pb.worldBox.copy(pb.localBox).applyMatrix4(pb.mesh.matrixWorld));
        if (u.userData.label) { u.getWorldPosition(_targetWorldPosition); u.userData.label.sprite.position.copy(_targetWorldPosition).add(_sv3.set(0, u.userData.hpOffsetY, 0)); }
        if (u.userData.turretPivot && u.userData.hp > 0) {
            u.userData.turretPivot.getWorldPosition(_wp);
            u.userData.turretPivot.lookAt(_sv3.set(plane.position.x, _wp.y, plane.position.z));
        }
        if (u.userData.isHostile && u.userData.hp > 0) {
            u.userData.shootCooldown = Math.max(0, u.userData.shootCooldown - dt);
            if (u.userData.shootCooldown <= 0 && u.position.distanceToSquared(plane.position) < HOSTILE_SHOOT_RANGE_SQ) {
                fireHostileBullet(u); u.userData.shootCooldown = hostileUnitShootingCooldownTime;
            }
        }
    });
}

function updateHUD() {
    let m = null, g = null, e = null, md = Infinity, gd = Infinity, ed = Infinity;
    markers.forEach(mk => { const d = plane.position.distanceToSquared(mk.position); if (d < md) { md = d; m = mk; } });
    groundUnits.forEach(u => { if (u.userData.isHostile && u.userData.hp > 0) { const d = plane.position.distanceToSquared(u.position); if (d < gd) { gd = d; g = u; } } });
    enemies.forEach(en => en.parts.forEach(p => { const d = plane.position.distanceToSquared(p.position); if (d < ed) { ed = d; e = p; } }));
    if (m) { markerArrow.visible = true; markerArrow.lookAt(m.position); markerDistanceElement.textContent = `${Math.round(Math.sqrt(md))}m`; } else { markerArrow.visible = false; markerDistanceElement.textContent = 'N/A'; }
    if (g) { groundTargetArrow.visible = true; groundTargetArrow.lookAt(g.position); groundDistanceElement.textContent = `${Math.round(Math.sqrt(gd))}m`; } else { groundTargetArrow.visible = false; groundDistanceElement.textContent = 'N/A'; }
    if (e) { enemyArrow.visible = true; enemyArrow.lookAt(e.position); enemyArrow.material.color.copy(e.material.color); enemyDistanceElement.textContent = `${Math.round(Math.sqrt(ed))}m`; } else { enemyArrow.visible = false; enemyDistanceElement.textContent = 'N/A'; }
    posXElement.textContent = Math.round(plane.position.x); posYElement.textContent = Math.round(plane.position.y); posZElement.textContent = Math.round(plane.position.z);
    _rotFwd.set(0, 0, 1).applyQuaternion(plane.quaternion);
    const hdg = Math.round(((Math.atan2(_rotFwd.x, _rotFwd.z) * 180 / Math.PI) + 360) % 360);
    const pch = Math.round(Math.atan2(_rotFwd.y, Math.sqrt(_rotFwd.x * _rotFwd.x + _rotFwd.z * _rotFwd.z)) * 180 / Math.PI);
    const bnk = Math.round(plane.rotation.z * 180 / Math.PI);
    rotHdgElement.textContent = hdg + '°'; rotPchElement.textContent = (pch >= 0 ? '+' : '') + pch + '°'; rotBnkElement.textContent = (bnk >= 0 ? '+' : '') + bnk + '°';
    const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(3);
    ratePitchElement.textContent = fmt(pitchRate); rateRollElement.textContent = fmt(rollRate); rateYawElement.textContent = fmt(yawRate);
    updateAmmoHUD();
}

function updateAmmoHUD() {
    const gunPct = gunAmmo / GUN_MAX_AMMO * 100;
    gunBarEl.style.width = gunPct + '%';
    gunBarEl.style.background = gunAmmo === 0 ? 'transparent'
        : gunAmmo < GUN_MAX_AMMO * 0.25 ? 'var(--hud-red)'
        : gunAmmo < GUN_MAX_AMMO * 0.5  ? 'var(--hud-amber)'
        : 'var(--hud-primary)';
    gunStatusEl.textContent  = gunAmmo  <= 0 ? (gunReloadTimer  / TARGET_FPS).toFixed(1) + 's' : gunAmmo  + '/' + GUN_MAX_AMMO;
    gunStatusEl.style.color  = gunAmmo  <= 0 ? 'var(--hud-red)' : 'var(--hud-primary)';

    const bombPct = bombAmmo / BOMB_MAX_AMMO * 100;
    bombBarEl.style.width = bombPct + '%';
    bombBarEl.style.background = bombAmmo === 0 ? 'transparent'
        : bombAmmo === 1 ? 'var(--hud-red)'
        : 'var(--hud-orange)';
    bombStatusEl.textContent = bombAmmo <= 0 ? (bombReloadTimer / TARGET_FPS).toFixed(1) + 's' : bombAmmo + '/' + BOMB_MAX_AMMO;
    bombStatusEl.style.color = bombAmmo <= 0 ? 'var(--hud-red)' : 'var(--hud-orange)';
}

function resolveCollisions() {
    // Player vs Markers — sphere check (§4.2: dispose torus geometry on pickup)
    for (let i = markers.length - 1; i >= 0; i--) {
        const m = markers[i];
        if (plane.position.distanceToSquared(m.position) < (planeMarkerCollisionRadius + m.userData.collisionRadius) ** 2) {
            scene.remove(m);
            markers.splice(i, 1);
            if (m.userData.hoopMesh) {
                m.userData.hoopMesh.geometry.dispose(); // (§4.2)
                scene.remove(m.userData.hoopMesh);
                obstacles.splice(obstacles.indexOf(m.userData.hoopMesh), 1);
            }
            score += 10; scoreElement.textContent = score; addXP(15); spawnSingleHoopWithMarker();
        }
    }
    // Player vs Collectibles
    for (let i = collectibles.length - 1; i >= 0; i--) {
        if (plane.position.distanceToSquared(collectibles[i].position) < (planeMarkerCollisionRadius + collectibleRadius) ** 2) {
            scene.remove(collectibles[i]); collectibles.splice(i, 1);
            score += 5; scoreElement.textContent = score; addXP(8);
        }
    }
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
    // Player vs Enemy Bullets
    if (!isGameOver) {
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
            const b = enemyBullets[i];
            if (plane.position.distanceToSquared(b.position) < (planeSphereRadius + b.userData.collisionRadius) ** 2) {
                scene.remove(b); _enemyBulletPool.push(b); enemyBullets.splice(i, 1);
                planeHP -= b.userData.damage; hpElement.textContent = Math.max(0, planeHP);
                document.body.style.backgroundColor = '#500'; setTimeout(() => document.body.style.backgroundColor = '#111', 100);
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
                scene.remove(b); _playerBulletPool.push(b); bullets.splice(i, 1); hit = true;
                const part = e.parts.find(p => { const _cr = b.userData.collisionRadius + (p.userData.collisionRadius || 1); return p.userData.hp > 0 && b.position.distanceToSquared(p.position) < _cr * _cr; });
                if (part) part.userData.hp -= b.userData.damage;
                let totalHp = 0; e.parts.forEach(p => totalHp += p.userData.hp);
                updateUnitLabel(e.label, totalHp);
                if (totalHp <= 0) destroyLogicalEnemy(e.id);
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
                if (b.position.distanceToSquared(au.group.position) < (b.userData.collisionRadius + au.collisionRadius) ** 2) {
                    scene.remove(b); _playerBulletPool.push(b); bullets.splice(i, 1); hit = true;
                    au.hp -= b.userData.damage; au.userData.hp = au.hp;
                    updateUnitLabel(au.label, au.hp);
                    if (au.hp <= 0) destroyAirUnit(au);
                }
            } else {
                // Ground unit
                const u = obj;
                if (u.userData.bombOnly || u.userData.hp <= 0) continue;
                if (u.userData.protector && u.userData.protector.userData.hp > 0) continue; // §4.1: immune while protector lives
                if (b.position.distanceToSquared(u.position) < (b.userData.collisionRadius + u.userData.collisionRadius) ** 2) {
                    scene.remove(b); _playerBulletPool.push(b); bullets.splice(i, 1); hit = true;
                    u.userData.hp -= b.userData.damage; updateUnitLabel(u.userData.label, u.userData.hp);
                    if (u.userData.hp <= 0) {
                        // §4.1: remove child turrets first (reverse index order), then the airport
                        if (u.userData.type === 'airport') {
                            const turretIdxs = [];
                            u.children.filter(c => c.userData?.type === 'turret').forEach(t => {
                                t.userData.hp = 0; destroyLabel(t.userData.label);
                                const ti = groundUnits.indexOf(t); if (ti > -1) turretIdxs.push(ti);
                            });
                            turretIdxs.sort((a, b) => b - a).forEach(ti => groundUnits.splice(ti, 1));
                        }
                        createExplosion(u.position);
                        destroyLabel(u.userData.label);
                        disposeGroup(u); scene.remove(u); // disposes/removes turrets too (they're children of u)
                        const uidx = groundUnits.indexOf(u); if (uidx > -1) groundUnits.splice(uidx, 1);
                        if (!isGameOver) { score += u.userData.xpValue; scoreElement.textContent = score; addXP(u.userData.xpValue); }
                        notifyBase(u);
                    }
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
        if (b.life <= 0 || Math.abs(b.position.x) > MAP_BOUNDARY || Math.abs(b.position.z) > MAP_BOUNDARY) {
            scene.remove(b); _playerBulletPool.push(b); bullets.splice(i, 1);
        }
    }
    if (shootCooldown > 0) shootCooldown -= dt;
    // Bombs
    for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.velocity.y -= gravity * dt; b.position.addScaledVector(b.velocity, dt);
        if (b.position.y <= groundLevel + b.userData.collisionRadius) {
            createExplosion(b.position);
            const bombAffectedBases = new Set();
            // §4.1: snapshot prevents index corruption; collect then destroy to handle airport+turret order
            const _bombDestroy = [];
            for (const gu of groundUnits.slice()) {
                if (gu.userData.protector && gu.userData.protector.userData.hp > 0) continue; // §4.1 protected
                if (gu.userData.hp > 0 && gu.position.distanceToSquared(b.position) < b.userData.aoERadius * b.userData.aoERadius) {
                    gu.userData.hp -= b.userData.damage; updateUnitLabel(gu.userData.label, gu.userData.hp);
                    if (gu.userData.hp <= 0) _bombDestroy.push(gu);
                }
            }
            // §4.1: airports first — child turrets removed before the turrets themselves are iterated
            _bombDestroy.sort((a) => a.userData.type === 'airport' ? -1 : 1);
            for (const gu of _bombDestroy) {
                if (!groundUnits.includes(gu)) continue; // already removed by airport child-cleanup
                if (gu.userData.type === 'airport') {
                    const turretIdxs = [];
                    gu.children.filter(c => c.userData?.type === 'turret').forEach(t => {
                        t.userData.hp = 0; destroyLabel(t.userData.label);
                        const ti = groundUnits.indexOf(t); if (ti > -1) turretIdxs.push(ti);
                    });
                    turretIdxs.sort((a, b) => b - a).forEach(ti => groundUnits.splice(ti, 1));
                }
                createExplosion(gu.position); destroyLabel(gu.userData.label);
                disposeGroup(gu); scene.remove(gu);
                const ui = groundUnits.indexOf(gu); if (ui > -1) groundUnits.splice(ui, 1);
                if (!isGameOver) { score += gu.userData.xpValue; scoreElement.textContent = score; addXP(gu.userData.xpValue); }
                if (gu.userData.baseId) bombAffectedBases.add(gu.userData.baseId);
            }
            bombAffectedBases.forEach(id => notifyBase({ userData: { baseId: id, hp: 0 } }));
            for (let ai = airUnits.length - 1; ai >= 0; ai--) {
                const au = airUnits[ai];
                if (au.hp > 0 && au.group.position.distanceToSquared(b.position) < b.userData.aoERadius * b.userData.aoERadius) {
                    au.hp -= b.userData.damage; au.userData.hp = au.hp;
                    updateUnitLabel(au.label, au.hp);
                    if (au.hp <= 0) { if (au.baseId) bombAffectedBases.add(au.baseId); destroyAirUnit(au, ai); }
                }
            }
            for (let ei = enemies.length - 1; ei >= 0; ei--) {
                const ae = enemies[ei];
                if (ae.parts.some(p => p.position.distanceToSquared(b.position) < b.userData.aoERadius * b.userData.aoERadius)) {
                    ae.parts.forEach(p => { p.userData.hp -= b.userData.damage; });
                    let th = 0; ae.parts.forEach(p => th += Math.max(0, p.userData.hp));
                    updateUnitLabel(ae.label, th); if (th <= 0) destroyLogicalEnemy(ae.id);
                }
            }
            scene.remove(b); bombs.splice(i, 1);
        } else if (b.position.y < groundLevel - 30) { scene.remove(b); bombs.splice(i, 1); }
    }
    if (bombCooldown > 0) bombCooldown -= dt;
    if (gunAmmo   <= 0) { gunReloadTimer  -= dt; if (gunReloadTimer  <= 0) { gunAmmo  = GUN_MAX_AMMO;  gunReloadTimer  = 0; } }
    if (bombAmmo  <= 0) { bombReloadTimer -= dt; if (bombReloadTimer <= 0) { bombAmmo = BOMB_MAX_AMMO; bombReloadTimer = 0; } }
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
    _camOffset.set(0, 8, -22).applyQuaternion(plane.quaternion);
    const camTarget = _sv1.copy(plane.position).add(_camOffset);
    _lookAt.set(0, 1, 20).applyQuaternion(plane.quaternion).add(plane.position);
    if (!isGameOver && !isPaused) camera.position.lerp(camTarget, .06);
    camera.lookAt(_lookAt);
}

// ================================================================
// --- Main Animation Loop (§1.2, §2.5, §3.6) ---
// ================================================================
function animate() {
    requestAnimationFrame(animate);
    const rawDelta = clock.getDelta();
    const dt = Math.min(rawDelta * TARGET_FPS, 6); // cap at 6 frames — prevents spiral-of-death on tab switch

    if (!isGameOver && !isPaused) {
        updatePhysics(dt);
        updateAI(dt);
        resolveCollisions();
        updateHUD();
    } else if (isGameOver) {
        markerArrow.visible = false; groundTargetArrow.visible = false; enemyArrow.visible = false;
        markerDistanceElement.textContent = 'N/A'; groundDistanceElement.textContent = 'N/A'; enemyDistanceElement.textContent = 'N/A';
        posXElement.textContent = '-'; posYElement.textContent = '-'; posZElement.textContent = '-';
        rotHdgElement.textContent = '-'; rotPchElement.textContent = '-'; rotBnkElement.textContent = '-';
    }
    updateProjectiles(dt);
    updateDebugBoxes();
    updateCamera();
    // Throttled minimap redraw — 15 fps regardless of game frame rate (§2.5)
    _minimapTimer += rawDelta;
    if (_minimapTimer >= MINIMAP_REFRESH_S) { updateMinimap(); _minimapTimer = 0; }
    renderer.render(scene, camera);
}

// ================================================================
// --- Minimap ---
// ================================================================
function updateMinimap() {
    minimapCtx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    const playerPos = plane.position, scale = (MINIMAP_SIZE / 2) / MINIMAP_VIEW_RANGE;
    plane.getWorldDirection(_sv1);
    const playerAngle = Math.atan2(_sv1.x, _sv1.z);
    minimapCtx.save();
    minimapCtx.translate(MINIMAP_SIZE / 2, MINIMAP_SIZE / 2);
    minimapCtx.rotate(playerAngle);
    const getMinimapPoint = wp => ({ x: -(wp.x - playerPos.x) * scale, y: -(wp.z - playerPos.z) * scale });
    const compassRadius = MINIMAP_SIZE / 2 - 12;
    minimapCtx.fillStyle = 'rgba(255,255,255,0.8)'; minimapCtx.font = 'bold 12px Arial'; minimapCtx.textAlign = 'center'; minimapCtx.textBaseline = 'middle';
    minimapCtx.fillText('N', 0, -compassRadius); minimapCtx.fillText('S', 0, compassRadius); minimapCtx.fillText('E', compassRadius, 0); minimapCtx.fillText('W', -compassRadius, 0);
    minimapCtx.fillStyle = 'rgba(85,107,47,0.7)';
    islets.forEach(islet => {
        const ip = getMinimapPoint(islet), ir = islet.radius * scale;
        const _rd = MINIMAP_SIZE / 2 + ir; if (ip.x*ip.x + ip.y*ip.y < _rd*_rd) { minimapCtx.beginPath(); minimapCtx.arc(ip.x, ip.y, ir, 0, Math.PI * 2); minimapCtx.fill(); }
    });
    const drawDot = (wp, color) => {
        const mp = getMinimapPoint(wp);
        if (mp.x*mp.x + mp.y*mp.y < MINIMAP_HALF_R_SQ) { minimapCtx.fillStyle = color; minimapCtx.fillRect(mp.x - 1.5, mp.y - 1.5, 3, 3); }
    };
    markers.forEach(m => drawDot(m.position, 'yellow'));
    collectibles.forEach(c => drawDot(c.position, '#00ff44'));
    enemies.forEach(e => { if (e.parts.length > 0) drawDot(e.parts[0].position, 'red'); });
    groundUnits.forEach(u => { if (u.userData.hp > 0) { u.getWorldPosition(_wp); drawDot(_wp, u.userData.isHostile ? 'orange' : 'white'); } });
    airUnits.forEach(au => {
        if (au.hp <= 0) return;
        const mp = getMinimapPoint(au.group.position);
        if (mp.x*mp.x + mp.y*mp.y < MINIMAP_HALF_R_SQ) {
            minimapCtx.fillStyle = au.isHostile ? '#ff4444' : '#aaddff';
            minimapCtx.beginPath(); minimapCtx.moveTo(mp.x, mp.y - 5); minimapCtx.lineTo(mp.x - 4, mp.y + 3); minimapCtx.lineTo(mp.x + 4, mp.y + 3); minimapCtx.closePath(); minimapCtx.fill();
        }
    });
    const namedLabels = [];
    baseMarkers.forEach(bm => {
        if (bm.eliminated) return;
        const mp = getMinimapPoint(bm.position);
        if (mp.x*mp.x + mp.y*mp.y < MINIMAP_HALF_R_SQ) {
            const color = bm.isHostile ? '#ff8844' : '#88ccff';
            minimapCtx.fillStyle = color; minimapCtx.fillRect(mp.x - 3, mp.y - 3, 6, 6);
            const sx = MINIMAP_SIZE / 2 + mp.x * Math.cos(playerAngle) - mp.y * Math.sin(playerAngle);
            const sy = MINIMAP_SIZE / 2 + mp.x * Math.sin(playerAngle) + mp.y * Math.cos(playerAngle);
            namedLabels.push({ sx, sy, name: `${bm.name} ${bm.alive}/${bm.total}`, color });
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
window.onload = () => { animate(); };
