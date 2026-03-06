# VibePilot — Changelog

## [Unreleased]

> **Prompts (this session):** "look at ideas.txt try to implement 1-10" / "hitting ground enemies should also have hit markers / collecting yellow spheres should also have collect animation / hitting collectible with plane wing should also collect them, as of entire player plane should be able to collect them" / "add tubes to collectors panel, tubes shouldnt overlap" / "every damage dealt should appear hit marker" / "some of yellow boxes are hard to collect" / "add tubes to minimap" / "player speed should be set to half of the capacity after splash screen" / "tube radius should be at least wingspan"

### Features
- **Collectible burst animation** (idea 1): Picking up a green collectible or yellow marker now spawns 8 expanding burst particles that fly outward and fade over 35 frames.
- **Marker ring blink-out** (idea 2): When a yellow marker is collected the torus hoop does not instantly vanish — it blinks with increasing frequency over 3 seconds before disappearing.
- **Player blink on damage** (idea 3): Player plane emissive flashes red (`0xff1100`) for 45 frames after taking a bullet hit.
- **CoD-style hit marker** (idea 4): A crosshair overlay (`#hit-marker`) flashes for 9 frames on every damage event — bullets, bombs, missiles, napalm ticks.
- **Enemy blink before destroy** (idea 5): Ground units, air units, and enemy fighters are removed from their live arrays immediately on death (collision inactive) but remain in scene for 50 frames, blinking before `scene.remove` / geometry dispose.
- **Plane falls to pieces on death** (idea 6): On game-over the player mesh is hidden and 6 box debris pieces spawn with random velocities and angular velocities, falling under gravity.
- **Tube challenge system** (ideas 7–9): Mathematical hollow tunnels (helix, sine S-curve, corkscrew) placed across the map. Fly inside and collect all 11 cyan orbs for +200 XP. Completing a tube fires a ribbon banner and adds an entry to the `⚡ TUB` conquered panel row. Each tube is one-time only — it and all remaining orbs disappear on completion.
- **Memory debug panel** (idea 10): Press `M` to toggle a panel showing JS heap usage and live entity counts, updated every 120 frames.
- **Tubes on minimap**: Active tubes shown as cyan rings (`○`) in the radar snapshot; disappear on completion.
- **Splash-screen speed ramp**: Speed is set to `maxSpeed × 0.5` the moment the splash fades out so the plane appears already in motion.

### Bug Fixes
- **Full-wingspan pickup box**: Collectible pickup now uses a `THREE.Box3` union of all six plane part boxes (`_planePickupBox`), giving the full 12-unit wingspan as the collection zone instead of a small nose-only sphere.
- **Marker pickup range**: Yellow markers now use a separate `_planeMarkerBox` expanded by `markerRadius = 5`, matching the visual sphere size. Previously only `collectibleRadius = 1.5` was applied, making markers hard to collect.
- **Tube minimap position**: Tubes store their spawn `cx, cz` and use those for the radar blip; previously used `mesh.position` which is always `(0,0,0)` since geometry is built in world space.
- **Tube minimum radius**: Raised from 6 to 12 units (full player wingspan) so the plane can always fly through without clipping.
- **Hit marker on any damage**: `_hitMarkerTimer` is now set inside every individual damage block (not just on kill), covering bomb, missile, and napalm paths.

---

> **Prompt:** "do 2.2 2.3 2.4 2.5 3.1 3.2 3.3 3.4" (roadmap items)

### Refactor
- **`notifyBase(baseId)`** (§2.2): Unified call signature — all paths now pass the base ID string directly. Removed synthetic `{ userData: { baseId } }` wrapper objects from bomb, missile, napalm, and air-unit paths.
- **`killGroundUnit(gu)`** (§2.3): Single function handles the full ground-unit destruction sequence (explosion, label removal, geometry disposal, array splice, XP award, base notification) for all four damage paths (bullet, bomb, missile, napalm). Eliminated ~60 lines of inline duplication. Napalm path also fixed — previously mutated `groundUnits` during `for...of` iteration; now collects kills first, then destroys.
- **`airport.userData.dependents[]`** (§2.5): Populated at spawn time with child turret references. Turret cleanup in `killGroundUnit` iterates `dependents` instead of `u.children.filter(c => c.userData?.type === 'turret')` — no more type-string filtering in destruction paths. Sort key for deferred-kill arrays updated to `dependents.length` check.
- **`updateAmmoBar()`** (§2.4): Shared helper renders a weapon ammo bar (width, background colour, status text, status colour). `updateAmmoHUD()` reduced from ~45 lines to ~15; each weapon passes its pre-computed colours.

### Performance
- **HUD nearest-enemy cache** (§3.1): Nested `enemies.forEach(en => en.parts.forEach(...))` in `updateHUD()` throttled to every 6 frames (~10 fps). Reduces ~40 `distanceToSquared` calls per frame to ~7 on average with no perceptible lag in the target arrow.
- **Weapon-fire vector pool** (§3.2): Pre-allocated `_wv1`, `_bombOffset`, `_bombDroop`, `_missileLTip`, `_missileRTip` scratch vectors. Eliminates `new THREE.Vector3()` per bomb/napalm drop and per missile wing-tip calculation; reuses existing `_up3` in flare deploy.
- **Explosion material pool** (§3.3): 12-slot `MeshBasicMaterial` pool replaces `explosionMaterial.clone()` per explosion. Materials are reset to `opacity 0.8` and returned to the pool instead of being disposed.
- **Static minimap rings cache** (§3.4): Three concentric range rings rendered once to an offscreen `OffscreenCanvas` at startup. `updateMinimap()` composites via a single `drawImage()` call instead of redrawing three arc paths every 66 ms.

---

> **Prompt:** "add splash screen on respawn with some fancy aeronautic font. make it spell letters like V / Vi / Vib / … / Vibe Pilot then vibe pilot disappears and in same matter but smaller font below appears (like in old style computer terminal font) Objective: Crush enemies"

### Features
- **Splash screen**: Full-screen intro sequence on game load.
  - `Vibe Pilot` types out letter-by-letter in **Orbitron** (bold aeronautic font, glowing green, 110 ms/char) with a blinking block cursor.
  - After a 900 ms pause the title fades out; `Objective: Crush enemies` then types in **Share Tech Mono** (dimmer green terminal style, 55 ms/char).
  - After 1.8 s the cursor stops and the entire splash fades over 1 s before being removed from the DOM.
  - Keyboard input is blocked while the splash element is present, preventing accidental weapon fire.

---

> **Prompt:** "if missle hits player it should trigger explosion / update angular rates, make it progress bar, full when on full rotation acceleration empty when rotation is 0 / add speed/ velocity indicator min to max with progress bar" + "angular rates are positive and negative, do progress bar before letters and after so it is like <----->P<-----> etc and update rates on specific value" + "collision box info slightly overlaps coords box, fix it so it is above coords box"

### Features
- **Explosion on enemy missile hit**: Enemy bullets now spawn a `createExplosion()` at impact point on contact with the player (visual fires even when flares deflect the shot).
- **Bidirectional angular rate bars**: The `#map-constraints` HUD panel now shows pitch / roll / yaw rates as dual progress bars flanking the axis label (`[neg] P [pos]`). Orange bar fills left for negative rate, green bar fills right for positive rate. Numeric value (`+0.000`) shown to the right.
- **Speed progress bar**: Speed indicator added below angular rates — a single blue bar spanning min→max speed range.

### Bug Fixes
- **Right-panel overlap fixed**: `#debug-info` (collision box legend) and `#map-constraints` (coords / rates) wrapped in a `#right-panel` flex column anchored `bottom: 10px; right: 10px`. Both panels now stack cleanly regardless of content height, eliminating the overlap caused by the hardcoded `bottom: 305px` offset.

---

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
