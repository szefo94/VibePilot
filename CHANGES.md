# VibePilot — Changelog

## [Unreleased]

> **Prompt:** "maybe this will improve performance, do radar like circles on minimap, animate scan every 3 seconds and synchronize with minimap update" + "with every sweep completed radar should update location of elements, only one update should be made to radar during that time" + "player location should also be frozen until full sweep"

### Features
- **Radar minimap**: Minimap now operates like a real radar — concentric range rings (33 / 66 / 100 % radius) and a rotating sweep line (one full revolution per 3 s) overlaid on the map.
- **Snapshot-based blips**: All entities (enemies, air units, ground units, base markers, collectibles, markers) are captured into a frozen `_radarBlips[]` array on each sweep completion. Blip positions do not move between sweeps — they update atomically once every 3 seconds, exactly when the sweep line returns to north.
- **Player frozen too**: The player's world position and heading are also snapshotted at sweep time. The minimap projection reference (`playerPos`, `playerAngle`) is frozen for the full sweep cycle so the player triangle and all relative blip positions update together.

---

> **Prompt:** "do performance paragraph from roadmap file"

### Performance
- **§2.1 – Baked ground-unit worldBoxes**: Removed per-frame `updateMatrixWorld(true)` + `applyMatrix4` for all ground units. Matrices are now computed exactly once on first visit (units are stationary), eliminating a full matrix propagation pass over every ground mesh every frame.
- **§2.2 – O(1) alive check**: Replaced `groundUnits.includes(gu)` (O(n) linear scan) with a `gu.userData._alive` boolean flag. Flag is cleared to `false` before every splice, so the double-destroy guard in bomb/missile AoE paths is now constant-time.
- **§2.3 – Removed `slice()` in bomb AoE**: `groundUnits.slice()` was creating a full array copy on every bomb detonation. The outer damage-collection loop only reads from `groundUnits` (splicing happens in the inner destroy loop), so the snapshot was unnecessary; replaced with a direct iteration.

---

> **Prompt:** "increase gun ammo capacity with every level (do not automatically reload, just increase capa, after reload it should gain full new capacity. increase bomb capacity every 5 levels, homing missiles flares and napalm every 10 lvls"

### Features
- **Ammo capacity scaling with level**: On each level-up, ammo caps increase — no auto-reload, current ammo is unchanged; the new cap applies on next reload.
  - GUN: +5 per level (60 → 65 → 70 → …)
  - BOMB: +1 every 5 levels
  - MISSILE / FLARE / NAPALM: +1 every 10 levels
- **Conquered panel auto-hide**: Panel and individual rows are hidden until the first entry is added; panel collapses to `fit-content` width (max 38 vw) rather than a fixed 38 vw box.

---

> **Prompt:** "collecting green collectibles should also prompt progress, completing should be stated at row 2 below conquered bases. green collectibles should derive naming after star constellations. at row 3 there should be completed marker clusters. pick adequate naming scheme"

### Features
- **Constellation system**: Each collectible chain is named after one of 20 star constellations (Orion, Cassiopeia, Perseus … Vela). Per-pickup notification shows "★ Name N/total"; completion awards +50 XP and adds an entry to conquered panel row 2.
- **Corridor system**: Each hoop chain is named "Corridor Alpha/Beta/…/Theta". Per-ring notification shows "◆ Name N/total"; completing all rings awards +75 XP and adds an entry to conquered panel row 3.
- **3-row conquered panel**: Panel restructured into three scrolling ticker rows — `BASE` (row 1), `★ CNS` constellations (row 2), `◆ RNG` corridors (row 3). Each row has its own colour (cyan / gold / orange).

---

> **Prompt:** "homing missiles should have trails, also they should move slower on deployment (like half the speed of machine gun), and then speed up to twice the speed of machine gun as it goes. the path it takes on shoot should go like this: fall down couple of metres, then start going into the direction of the target. add body upgrades to player plane, homing missiles should be send in pairs from ends of each wing. Wing barrel should be placed at the end of the wing. napalm container should be 2 smaller cylinders under rear end of the main body cylinder. bomb container should be a little bigger cylinder near middle of main body cylinder"

### Features
- **Missile overhaul – two-phase flight**: Launch speed = 0.5× bullet speed; drop-phase (22 frames) pulls nose down (-0.18 y, gravity 0.045/dt). After drop phase speed ramps (+0.05/dt) to 2× bullet speed while homing re-engages.
- **Missile paired launch**: Fires 2 missiles simultaneously from world-space wing-tip positions (±5.9, −0.12, 0.55 local), computed via `applyMatrix4`.
- **Missile trail particles**: Orange spheres (0.18 r) spawn behind each missile every 2.5 frames, life 20 frames, opacity fades with `life/maxLife × 0.75`.
- **Plane body upgrades**:
  - Wing barrel launchers — dark-grey cylinders at each wing tip (±5.9, −0.12, 0.55).
  - Bomb pod — horizontal cylinder under centre fuselage (0, −0.78, 0.2).
  - Napalm containers — two small angled cylinders under rear body (±0.36, −0.68, −1.4).

---

> **Prompt:** "animate flares in style of ac130 angel wings"

### Features
- **Flare angel-wing effect**: Deploying flares spawns 20 bright gold particles (10 per side) in symmetric arc formation spreading left and right from the plane — visually resembling AC-130 angel-wing flare drops.

---

> **Prompt:** "flares should spread much slower, it should match the timer of active flare. napalm should do animation of small spheres on the target in entirety of its range"

### Changed
- **Flare spread tuned**: Particle velocity reduced to 0.05–0.10 units/frame; particle lifetime set to `FLARE_DURATION` (180 frames) so particles persist for the full protection window. Gravity reduced to 0.001/frame.
- **Napalm fire particles**: Each active napalm patch spawns 4 rising fire-sphere particles every 7 frames, uniformly distributed across the full patch radius using `r = √(random) × radius`. Particles animate with a sin-bell scale/opacity curve (peak mid-life).

---

> **Prompt:** "can you implement 5.7 and also add ammo to it?"

### Features
- **§5.7 – Weapon variety**: Three new weapons with independent ammo pools and reload timers.
  - **R — Homing Missile** (3 ammo, 10 s reload): Homes onto nearest hostile. 80 × multiplier damage + AoE splash (radius 25). Double explosion on impact.
  - **Q — Flares** (2 ammo, 15 s reload): Deflects all enemy bullets for 3 s. HUD bar glows green while active.
  - **X — Napalm Bomb** (2 ammo, 8 s reload): Creates a ground burn patch (radius 55) dealing 8 × multiplier damage every 0.5 s for 5 s; patch fades as it expires.
- **Ammo HUD extended**: Five rows — GUN / BOMB / MSLE / FLRE / NALM with colour-shift and reload countdown.

---

> **Prompt:** "i really like 5.7, in addition you can add ammo to spacebar machinegun and bomb. add ui at bottom center with progress bar of ammo, after ammo ends show reload timer on the right of progress bar of the ammo. also, maybe put prompt given in changes file so it tracks what instruction was given"

### Features
- **§5.7 – Ammo system**: Machinegun (spacebar) has 60 rounds, bombs have 4. When depleted, each auto-reloads independently (gun ~3 s, bomb ~5 s).
- **Ammo HUD**: Bottom-centre panel with two progress bars (GUN / BOMB). Bar colour shifts amber → red as ammo runs low, goes empty when depleted. Status label shows `XX/MAX` count while loaded and a live countdown (`X.Xs`) during reload.

---

> **Prompt:** "refactor 4.1: rebuild airbase logic, turrets can't be destroyed unless you destroy airbase first. same for control tower. apply 4.1 suggestion. about 4.3, after 20 level damage gain should increment less. apply 4.5"

### Changed
- Wing trails now start hidden on game spawn; press **N** to toggle them on/off

### Bug Fixes
- **§4.1 – Airbase turret protection**: Airbase turrets (and control tower) are now immune to all damage while the airbase building is still standing. Destroy the airbase first to expose them.
- **§4.1 – Airport child-turret cleanup order**: Turrets are now removed from `groundUnits` in reverse index order *before* the airport is removed, preventing index-shift corruption in both the bullet and bomb destruction paths.
- **§4.5 – Explosion disposal race**: `createExplosion` no longer uses `setInterval`/`setTimeout`. Explosions are tracked in `activeExplosions[]` and updated frame-rate-independently inside `updateExplosions(dt)` (called at the end of `updateProjectiles`), eliminating the race between the interval callback and `material.dispose()`.

### Balance
- **§4.3 – Damage multiplier diminishing returns**: Levels 1–20 grant +0.25 damage multiplier each. From level 21 onward the gain decreases by 0.01 per level (level 21 = +0.24, level 22 = +0.23 … level 45 = +0, capped at 0 from there).

---

## [0.2.0] — 2026-03-04

### Performance
- §2.7: Replaced all `distanceTo`/`Math.hypot` comparisons in hot paths with squared variants — eliminates `Math.sqrt` calls in every collision and shooting-range check per frame
- `createGroundUnit`: allocates 1 `MeshStandardMaterial` per call instead of 6 (5 were discarded immediately)
- `fireBullet`: uses `_sv1` scratch vector instead of `new THREE.Vector3()` per shot
- `updateAI` lookAt: uses `_sv3.addVectors()` instead of `.clone()` per air unit per frame
- `updateMinimap`: uses `_sv1` scratch instead of `new THREE.Vector3()` per redraw
- `destroyAirUnit`: index parameter is now optional — callers with a known index pass it (O(1)); others omit it
- Added `HOSTILE_SHOOT_RANGE_SQ` and `MINIMAP_HALF_R_SQ` pre-computed squared constants

### Refactor (from previous session)
- §1.2: Monolithic `animate()` split into `updatePhysics`, `updateAI`, `resolveCollisions`, `updateHUD`, `updateProjectiles`, `updateDebugBoxes`, `updateCamera`
- §1.3: Game state grouped into labelled sections (Player, World, UI, Debug)
- §2.1: Player and ground-unit bounding boxes rebuilt with `applyMatrix4` instead of per-vertex `setFromObject`
- §2.2: Torus `matrixWorldInverse` cached once at spawn, reused each frame
- §2.3: Spatial grid (`_GRID_CELL = 120`) cuts bullet-vs-unit checks from O(n×m) to O(1) average
- §2.4: Pre-allocated pool of 60 enemy bullet meshes (`_enemyBulletPool`) — eliminates per-shot GC pressure
- §2.5: Minimap redraws throttled to 15 fps via `THREE.Clock` timer
- §2.6: Module-level scratch vectors `_sv1`–`_sv3`, `_camOffset`, `_lookAt`, `_wp` eliminate hundreds of per-frame allocations
- §3.1: Named constants for all tuning values (`TARGET_FPS`, `NOTIF_SLOT_HEIGHT`, `MINIMAP_VIEW_RANGE`, etc.)
- §3.2: `spawnEnemyBullet(fromPos, targetPos)` deduplicates bullet-creation code
- §3.3: `finaliseBase(bm, startIdx, arr, bonusXp)` shared tail logic for all spawners
- §3.4: `CHAIN_PATTERNS` + `spawnChain()` deduplicates collectible/hoop chain spawners
- §3.5: `destroyLabel(label)` used consistently on every unit removal path
- §3.6: `THREE.Clock` delta-time loop; all movement and cooldowns multiply by `dt`
- §4.2: Torus geometry disposed on marker pickup (GPU texture leak fix)
- `disposeGroup(obj)` helper traverses and disposes all mesh geometry/materials on unit destruction
- Shared `_playerBulletGeo` + `_playerBulletMat` + `_playerBulletPool` for player bullets

### Features
- Airborne squadrons: **Hover Wing** (helicopters + balloons) and **Strike Wing** (fighters + tankers + AC-130) tracked via `baseMarkers`, visible on minimap as triangles
- **N key**: toggle wing trails visibility

---

## [0.1.0] — Initial release

- Three.js browser flight combat game
- Player jet with pitch/roll/yaw controls, speed control, bullets and bombs
- Ground units: tanks, turrets, trucks, airports, destroyers, carriers, hangars
- Air enemies: logical multi-part fighter planes
- Obstacles: pillars, stalactites/stalagmites, torus rings
- Collectibles and hoop chains
- Named base markers (Airbases, Forward Bases, Carrier Groups, Destroyer Squadrons)
- Minimap with compass, conquest panel, kill notifications
- XP / level-up system with damage multiplier
- Debug collision box overlay (B key)
- Wing trails (N key)
