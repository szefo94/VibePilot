# VibePilot — Refactor & Improvement Proposals

> Based on analysis of `main.js` (~1 142 lines), `style.css`, and `Index.html`.
> Proposals are grouped by theme and ordered roughly by impact vs. effort.

---

## 1. Architecture & Code Organisation

### 1.1 Split `main.js` into modules

The entire game lives in one 1 100+ line file. Suggested split:

| Module | Responsibility |
|---|---|
| `constants.js` | All magic numbers and tuning values |
| `visuals/ground.js` | `createGroundUnit`, `createHangar` |
| `visuals/air.js` | `createHelicopterVisual`, `createFighterVisual`, … |
| `spawners.js` | `spawnAirbase`, `spawnHoverWing`, `spawnSingleEnemy`, … |
| `collision.js` | All collision helpers and per-frame checks |
| `hud.js` | Minimap, kill notifications, conquered panel |
| `main.js` | Scene setup, animation loop, glue |

Either use native ES modules (`<script type="module">`) or a simple bundler like esbuild.

### 1.2 Replace the monolithic `animate()` with sub-systems

The animate loop is 260 lines handling movement, AI, collision, camera, and rendering in one block. Break it into:

```js
function animate() {
    updatePhysics(delta);    // velocity integration, orbit, gravity
    updateAI(delta);         // enemy shooting, turret aim
    resolveCollisions();     // player vs world, bullets vs units
    updateHUD();             // HUD text, minimap
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}
```

### 1.3 Centralise all game-state in one object

Currently ~35 global `let`/`const` variables are scattered at the top of the file. Group them:

```js
const state = {
    player:   { hp, score, level, xp, xpToNext, damageMultiplier },
    world:    { enemies, groundUnits, airUnits, bullets, bombs, … },
    ui:       { notifSlots, isPaused, isGameOver },
};
```

This also makes save/load trivial to add later.

---

## 2. Performance

### 2.1 Stop rebuilding bounding boxes every frame

**Current:** `planePartBoxes` rebuilt from scratch with `setFromObject` on all 6 plane meshes each frame (line ~795). Ground-unit `partBoxes` also rebuilt on first collision then recreated on subsequent checks.

**Fix:** Build boxes once on creation. On each frame only call `box.applyMatrix4(mesh.matrixWorld)` on a pre-built box in local space — no geometry query needed.

### 2.2 Cache the static torus inverse matrix

**Current (line ~909):**
```js
const lp = plane.position.clone().applyMatrix4(o.matrixWorld.clone().invert());
```
Toruses do not move. Cache `o.matrixWorldInverse` once after spawn and reuse it each frame. Saves a matrix clone + inversion every frame per torus.

### 2.3 Spatial partitioning for bullet collision

Bullet-vs-all-units is an O(n × m) loop running every frame. Even a simple uniform grid (cell size = max collision radius × 2) reduces checks by ~80 % when there are many units spread across the map.

### 2.4 Pool enemy bullets

Every hostile shot allocates two new `THREE.Mesh` objects (body + nose) with new geometries. With many turrets and air units firing, this stresses GC. Pre-allocate a ring buffer of ~50 bullet meshes and recycle them.

### 2.5 Throttle the minimap redraw

The minimap canvas is fully redrawn every frame (~200 draw calls). Unit positions at this scale change only a few pixels per frame. Redraw at 15 fps (every 4 frames) — imperceptible to the player and 4× cheaper.

### 2.6 Reduce per-frame vector allocations

Several hot paths create `new THREE.Vector3()` inline:

```js
// current — allocates every frame
const camOffset = new THREE.Vector3(0, 8, -22).applyQuaternion(plane.quaternion);

// fix — reuse a module-level scratch vector
_camOffset.set(0, 8, -22).applyQuaternion(plane.quaternion);
```

Audit the loop for similar patterns; a handful of scratch vectors at module level eliminate hundreds of allocations per second.

### 2.7 Distance-squared comparisons

Several loops call `Math.sqrt` purely to compare against a threshold:

```js
// current
if (Math.sqrt(dx*dx + dz*dz) < startSafeZone)

// fix
if (dx*dx + dz*dz < startSafeZone * startSafeZone)
```

Affects spawn loops, collision loops, and minimap clipping.

---

## 3. Code Quality & Maintainability

### 3.1 Extract all magic numbers into named constants

Scattered throughout the file are unexplained numbers. Each should become a named constant at the top:

```js
// Game balance
const BULLET_LIFE_FRAMES        = 150;
const ENEMY_BULLET_LIFE_FRAMES  = 200;
const BOMB_EXPLODE_FRAMES       = 400;
const TURRET_SHOOT_COOLDOWN     = 120;   // frames ≈ 2 s at 60 fps
const HOSTILE_SHOOT_RANGE       = 600;
const PLAYER_BOMB_COOLDOWN      = 45;
const DAMAGE_PER_LEVEL_UP       = 0.25;

// Notification UI
const NOTIF_SLOT_HEIGHT_PX      = 52;
const NOTIF_DURATION_MS         = 8500;
const MINIMAP_VIEW_RANGE        = 750;
```

### 3.2 Deduplicate enemy bullet spawning

The bullet-creation block appears identically in `fireHostileBullet()` (line ~766) and inline in the air-unit shooting section (line ~841). Extract to one function:

```js
function spawnEnemyBullet(fromPosition, targetPosition) { … }
```

### 3.3 Deduplicate base spawning patterns

`spawnAirbase`, `spawnForwardBase`, and `spawnDestroyerSquadron` all repeat:
- startIdx bookmarking
- unit-to-base assignment
- `bm.units = groundUnits.slice(startIdx)` finalisation

Extract a `finaliseBase(bm, startIdx, bonusXp)` helper that does this tail work once.

### 3.4 Deduplicate collectible / hoop chain spawners

`spawnCollectibleChains` and `spawnHoopChains` share five identical spatial-pattern definitions (line ~613–674). Extract patterns to a shared array:

```js
const CHAIN_PATTERNS = [
    { type: 'line',   count: 12, … },
    { type: 'circle', count: 10, … },
    …
];
```

Pass a factory function to distinguish collectible vs. hoop.

### 3.5 Consistent label handling

Labels are created with `createUnitLabel()` but updated and nulled in several different ways across ground units, air units, and enemies. Centralise into:

```js
function updateLabel(label, hp)  { … }   // already exists
function destroyLabel(label)     { label.sprite.parent?.remove(label.sprite); label.texture.dispose(); }
```

Call `destroyLabel` consistently on every unit removal path.

### 3.6 Use delta time for movement and cooldowns

All movement and cooldown logic runs in raw frame counts (`cooldown -= 1`). If the browser drops frames, gameplay speeds up or slows down. Pass `delta` (ms since last frame) from `animate` and multiply velocities/cooldowns:

```js
const delta = clock.getDelta();          // THREE.Clock
velocity.multiplyScalar(delta * TARGET_FPS);
cooldown -= delta * TARGET_FPS;
```

---

## 4. Bug Fixes

### 4.1 Airport child-turret cleanup order

When the airport building is destroyed, its child turrets are removed from `groundUnits` **after** the airport itself has been spliced out, which shifts array indices mid-loop. Fix: collect child-turret indices first, remove them in reverse order, then remove the airport.

### 4.2 Label texture leak on marker pickup

When a collectible marker is removed (line ~887), `m.userData.texture.dispose()` is never called. Over many pickups this accumulates GPU texture memory. Add disposal to every pickup/removal path.

### 4.3 Cap `playerDamageMultiplier`

The multiplier increments by 0.25 on every level-up with no ceiling. After level 20 a single bullet one-shots any unit. Add a cap:

```js
playerDamageMultiplier = Math.min(playerDamageMultiplier + 0.25, MAX_DAMAGE_MULTIPLIER);
```

### 4.4 Debug helpers assume `.parent` exists

`debugHelpers.forEach(h => h.parent.remove(h))` will throw if a helper somehow loses its parent before cleanup. Use optional chaining: `h.parent?.remove(h)`.

### 4.5 Explosion material modification after disposal

The explosion uses both `setInterval` and `setTimeout`. If the interval fires after `dispose()` is called, it modifies a disposed material. Replace with a single `requestAnimationFrame`-driven counter tracked inside the animate loop, same as every other timed effect.

---

## 5. Game Design Improvements

### 5.1 Enemy AI — pursuit behaviour

Enemies currently wander at constant random velocity, never reacting to the player. Even simple pursuit improves feel:

- Within range X: steer velocity towards player (proportional control)
- Outside range X: continue patrol
- Differentiate by type: fighters pursue, choppers orbit a waypoint, AC-130 maintains altitude

### 5.2 Difficulty / wave progression

Currently enemies respawn immediately at fixed difficulty (level 1–3). Proposal:

- Track elapsed game time or total kills
- Every N kills / minutes, increment global `difficultyTier`
- Scale enemy HP, speed, and shooting rate with tier
- Spawn harder unit mixes in later waves (more AC-130s, fewer balloons)

### 5.3 Player damage cap

The player can receive multiple hits per frame (enemy bullets + collision simultaneously). Add a short invincibility window (e.g. 30 frames) after taking damage to prevent instant death chains.

### 5.4 Win / end condition

There is no current win state — the game runs forever. Options:

- **Conquest mode**: win when all base markers are eliminated
- **Survival mode**: survive N minutes against escalating waves
- **Score attack**: 10-minute timer, final score leaderboard

### 5.5 Persistent progress (localStorage)

Map to `ideas.txt` — save conquered group names, total kills, and high score to `localStorage`. Show a "previous session" summary on next load. Aligns with the collectible-tracking idea in the ideas file.

### 5.6 Player health regeneration

Currently HP only decreases. Add slow passive regen (e.g. 0.01 HP/frame up to 50 % max) so prolonged cautious play is rewarded without making the player unkillable.

### 5.7 Weapon variety

The player has bullets and bombs. Possible additions aligned with current unit types:

| Weapon | Effect |
|---|---|
| Missile (E key, limited) | Homing, higher single-target damage |
| Flares (R key) | Temporary hostile-bullet deflection |
| Napalm bomb | Ground AoE over time instead of instant |

---

## 6. Visual & UX Polish

### 6.1 Explosion particles

Explosions are currently a single scaling/fading sphere. Replace with a simple particle burst: spawn 12–20 small spheres with random radial velocities, gravity pull, and fade. Three.js `Points` with a custom `BufferGeometry` is lightweight and visually dramatic.

### 6.2 Engine/rotor animation

Helicopter rotor discs and fighter engine cones are static. Increment `rotation.z` of rotor meshes each frame proportional to `orbitSpeed` or `velocity.length()` — a one-liner per unit.

### 6.3 Bullet tracers

Player bullets are invisible (only collision logic). Add a short trail using `THREE.Line` or `THREE.Points` behind each bullet, length proportional to speed. Makes shooting feel tactile.

### 6.4 Minimap unit scale legend

The minimap mixes dots (ground), triangles (air), and squares (bases) but has no legend. Add a small fixed corner legend (drawn once, not per frame) showing the icon shapes and their meanings.

### 6.5 Audio

No audio currently. Candidate sounds (Web Audio API, no library needed):

| Event | Sound |
|---|---|
| Player shoot | Short high-frequency click |
| Hit taken | Low thud |
| Unit destroyed | Explosion rumble |
| Level up | Rising arpeggio |
| Base conquered | Fanfare chord |

---

## 7. Technical Infrastructure

### 7.1 Add a build step

Currently the game is served as raw JS from CDN. Switching to a minimal build pipeline (e.g. Vite or esbuild) enables:

- Module splitting (see §1.1)
- Dead-code elimination
- Local Three.js import instead of CDN (offline support, version pinning)
- Source maps for debugging minified builds

### 7.2 Linting and formatting

Add ESLint + Prettier configs. Enforces consistent style and catches common bugs (unused variables, implicit globals). Existing issues to configure rules around:

- `no-magic-numbers` — enforces §3.1
- `no-unused-vars` — caught the `r` variable bug already fixed

### 7.3 Basic automated tests

Game logic functions (`randomRange`, `pillarHitsBox`, `coneHitsSphere`, collision math) are pure functions with no DOM dependency. Extract them and add unit tests with Vitest or Jest. Prevents regressions when tuning collision radii or spawn logic.

### 7.4 Frame-rate independent `THREE.Clock`

Replace raw `requestAnimationFrame` with a `THREE.Clock`-driven loop. Cap delta at 100 ms to prevent spiral-of-death on tab-switch resume. Required for §3.6.

```js
const clock = new THREE.Clock();
function animate() {
    const delta = Math.min(clock.getDelta(), 0.1);
    requestAnimationFrame(animate);
    update(delta);
    renderer.render(scene, camera);
}
```

---

## Priority Summary

| # | Proposal | Impact | Effort |
|---|---|---|---|
| 4.1 | Airport turret cleanup bug | High | Low |
| 4.2 | Texture leak on marker pickup | High | Low |
| 2.1 | Stop rebuilding bounding boxes per frame | High | Medium |
| 3.1 | Named constants for all magic numbers | High | Medium |
| 4.3 | Cap damage multiplier | Medium | Low |
| 2.2 | Cache torus inverse matrix | Medium | Low |
| 2.5 | Throttle minimap to 15 fps | Medium | Low |
| 3.2 | Deduplicate enemy bullet spawning | Medium | Low |
| 3.6 | Delta-time movement | Medium | High |
| 5.1 | Enemy pursuit AI | High | High |
| 5.4 | Win/end condition | High | Medium |
| 1.1 | Module split | Medium | High |
| 7.1 | Build step (Vite) | Medium | High |
