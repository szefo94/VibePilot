# VibePilot

> Browser-based 3D flight combat game built with Three.js r128.

---

## Table of Contents

- [Controls](#controls)
- [HUD](#hud)
- [World](#world)
- [Player](#player)
- [Flight Model](#flight-model)
- [Weapons](#weapons)
- [Enemy Units](#enemy-units)
- [Ground Units & Bases](#ground-units--bases)
- [Airborne Squadrons](#airborne-squadrons)
- [Scoring & Progression](#scoring--progression)
- [Obstacles & Collectibles](#obstacles--collectibles)
- [Minimap](#minimap)
- [Configuration Reference](#configuration-reference)
- [Functions Reference](#functions-reference)

---

## Controls

| Key | Action |
|---|---|
| `↑` / `↓` | Pitch |
| `←` / `→` | Roll |
| `A` / `D` | Yaw |
| `W` / `S` | Increase / Decrease speed |
| `Space` | Shoot |
| `E` | Drop bomb |
| `F` | Toggle aiming laser |
| `B` | Toggle collision box debug view |
| `N` | Toggle wing trails |
| `Esc` | Pause / Resume |

---

## HUD

### Panels

- **Player Stats** — HP · Score · Level · XP / XP to next level
- **Controls** — key bindings · current bullet damage value
- **Target Info** — distance to nearest airborne enemy · nearest hostile ground unit · nearest marker
- **Debug Info** — collision box legend (toggled with `B`) · wing trail toggle reminder (`N`)
- **Coords / Nav** — current player X / Y / Z world position · heading / pitch / bank angles · live pitch / roll / yaw rates
- **Conquered Panel** — scrolling ticker of eliminated base names
- **Minimap** — rotating radar (bottom-left)

### Transient Elements

- Kill notifications (right edge, slide-out)
- Congratulations banner (center screen, on base elimination)
- Paused overlay
- Game Over overlay

---

## World

### Boundaries

| Constant | Value |
|---|---|
| `MAP_BOUNDARY` | 2 000 |
| `groundLevel` | -50 |
| `waterLevel` | `groundLevel + 0.5` |
| `ceilingLevel` | 150 |

### Terrain

- Ground plane
- Water plane
- Ceiling plane
- Islets — raised cylinder platforms scattered across the map
  - Count: configurable (`numIslets`)
  - Radius range: 200 – 500 units
  - Positioned within `MAP_BOUNDARY * 0.8`

---

## Player

### Mesh Components

| Part | Geometry |
|---|---|
| Body (fuselage) | `CylinderGeometry(0.45, 0.6, 4)` |
| Nose | `ConeGeometry(0.45, 1.2)` |
| Left wing | `BoxGeometry(6, 0.2, 1.5)` |
| Right wing | `BoxGeometry(6, 0.2, 1.5)` |
| Tail fin | `BoxGeometry(0.2, 1.5, 1)` |
| Horizontal stabiliser | `BoxGeometry(2.5, 0.15, 0.8)` |

### Collision

| Type | Radius / Method |
|---|---|
| Markers & collectibles | Sphere — `planeMarkerCollisionRadius = 2.0` |
| Enemy bullets | Sphere — `planeSphereRadius = 2.5` |
| Structural (world, units) | 6× `Box3` (one per component), updated per frame |

### Wing Trails

Two particle trails rendered as `THREE.Points` with `vertexColors`, one per wingtip.

| Property | Value |
|---|---|
| `TRAIL_LENGTH` | 70 points |
| Point size | 0.55 units |
| Colour at tip | Bright blue-white |
| Colour at tail | Near-black (fades to background) |
| Fade curve | `pow(1 - i/TRAIL_LENGTH, 1.8)` |
| Toggled with | `N` key |

- `frustumCulled = false` prevents the trail from disappearing based on heading.
- Each frame the ring-buffer shifts forward one slot via `TypedArray.copyWithin`, inserting the current wing-tip world position at index 0.

### Targeting Aids

- Aiming laser — `THREE.Line` attached to plane, toggled with `F`
- Marker arrow — yellow cone indicator (wing-mounted)
- Ground target arrow — green cone indicator
- Enemy arrow — white cone indicator

---

## Flight Model

### Speed

| Constant | Value |
|---|---|
| `maxSpeed` | 0.8 |
| `minSpeed` | 0.02 |
| `acceleration` | 0.003 |
| `deceleration` | 0.002 |
| `naturalDeceleration` | 0.0005 |

### Rotation

| Constant | Value |
|---|---|
| `maxPitchRate` | 0.025 rad/frame |
| `maxRollRate` | 0.035 rad/frame |
| `maxYawRate` | 0.030 rad/frame |
| `rotAccel` | 0.00085 rad/frame² |
| `rotDamping` | 0.85 |

---

## Weapons

### Bullets

| Property | Value |
|---|---|
| `bulletDamage` | 1 (× `playerDamageMultiplier`) |
| `bulletSpeed` | 1.8 |
| `bulletLife` | 150 frames |
| `shootCooldownTime` | 4 frames |
| Geometry | `SphereGeometry(0.3)` |
| Colour | `0xffa500` |

### Bombs

| Property | Value |
|---|---|
| `bombDamage` | 40 (× `playerDamageMultiplier`) |
| `bombAoERadius` | 50 |
| `bombCooldownTime` | 45 frames |
| `gravity` | 0.008 |
| Geometry | `SphereGeometry(1.5)` |

### Explosions

| Property | Value |
|---|---|
| `explosionDuration` | 400 ms |
| `explosionMaxSize` | 50 |
| Geometry | `SphereGeometry(1)` |
| Colour | `0xffa500` |

---

## Enemy Units

> Spawned and respawned by `spawnSingleEnemy()`. Count: `numEnemies = 10`.

### Type: Fighter (Plane)

| Property | Value |
|---|---|
| Parts | fuselage · 2× wing · tail fin |
| Level range | 1 – 3 |
| HP | `enemyPartHP × 4 × level` |
| Speed | `enemySpeed = 0.05` |
| Scale | `enemyScale = 2` |
| XP reward | 25 |
| Colour | random from `enemyColors[]` |

### Behaviour

- Constant linear velocity across XZ plane
- Respawns immediately on destruction

---

## Ground Units & Bases

### Unit Types

| Type | HP | Scale | Hostile | Shoots | Notes |
|---|---|---|---|---|---|
| `tank` | 20 – 60 | 3 | yes | yes | Turret pivots to aim |
| `turret` | 30 – 75 | 3 | yes | yes | Fixed base, rotating head |
| `truck` | 5 | 2.5 | no | no | — |
| `airport` | 150 | 1 | yes | no | Contains child turrets |
| `destroyer` | 120 – 300 | 5 | yes | yes | At water level |
| `carrier` | 200 | 8 | no | no | At water level |
| `hangar (arch)` | 200 | 1 | no | no | Bomb damage only |
| `hangar (box)` | 200 | 1 | no | no | Bomb damage only |

### Hostile Unit Shooting

| Constant | Value |
|---|---|
| `hostileUnitShootingRange` | 600 |
| `hostileUnitShootingCooldownTime` | 120 frames |
| `enemyBulletDamage` | 5 |
| `enemyBulletSpeed` | 0.8 |
| `enemyBulletLife` | 200 frames |

### Base Groups

| Spawner | Units included | `bonusXp` | Count |
|---|---|---|---|
| `spawnAirbase` | airport · hangars · tanks · turrets | 500 | `numAirbases = 5` |
| `spawnForwardBase` | tanks · trucks · hangars | 250 | `numForwardBases = 8` |
| `spawnCarrierStrikeGroup` | carrier · destroyers · hangars | 150 | `numCarrierGroups = 2` |
| `spawnDestroyerSquadron` | destroyers | 150 | `numDestroyerSquadrons = 3` |

### Name Pools

| Base type | Name pool |
|---|---|
| Airbases | NATO phonetic alphabet (Alpha, Bravo, …) |
| Forward bases | Greek commanders (Achilles, Ajax, …) |
| Carrier fleets | Sea deities (Poseidon, Neptune, …) |
| Destroyer squadrons | War deities (Ares, Mars, …) |

---

## Airborne Squadrons

### Hover Wing

- Name pool: `hoverWingNames` — Icarus · Pegasus · Hermes · Valkyrie · Zephyr · Aura
- Count: `numHoverWings = 3`
- `bonusXp`: 350

| Unit | HP | Collision R | XP | Hostile | Movement |
|---|---|---|---|---|---|
| Helicopter | 60 | 12 | 80 | yes | Orbit |
| Balloon | 15 | 10 | 40 | no | Stationary |

### Strike Wing

- Name pool: `strikeWingNames` — Apollo · Talon · Falcon · Hawk · Raptor · Griffin
- Count: `numStrikeWings = 2`
- `bonusXp`: 500

| Unit | HP | Collision R | XP | Hostile | Movement |
|---|---|---|---|---|---|
| Fighter | 40 × level | 10 | 100 × level | yes | Linear |
| Tanker | 200 | 25 | 200 | no | Linear |
| AC-130 | 150 | 22 | 250 | yes | Orbit |

### Altitude Ranges (world Y)

| Unit | Min | Max |
|---|---|---|
| Helicopter | 40 | 70 |
| Balloon | 70 | 100 |
| Fighter | 50 | 110 |
| Tanker | 90 | 130 |
| AC-130 | 60 | 100 |

### Orbit Parameters

| Unit | Radius | Speed |
|---|---|---|
| Helicopter | 50 – 150 | ±0.003 – 0.006 rad/frame |
| AC-130 | 250 | ±0.001 – 0.003 rad/frame |

---

## Scoring & Progression

### Score Sources

| Source | Points |
|---|---|
| Hoop / marker | 10 |
| Collectible | 5 |
| Enemy fighter destruction | 25 |
| Air unit destruction | XP value (80 – 300) |
| Ground unit destruction | XP value (10 – 300) |
| Base elimination bonus | 150 – 500 |

### XP & Levelling

| Constant | Value |
|---|---|
| Starting `xpToNextLevel` | 100 |
| Threshold growth per level | `× 1.5` |
| `playerDamageMultiplier` gain | +0.25 per level |

---

## Obstacles & Collectibles

### Obstacles

| Type | Geometry | Count |
|---|---|---|
| Pillar | `CylinderGeometry` | part of `numObstacles = 80` |
| Stalactite / stalagmite | `ConeGeometry` | part of `numObstacles` |
| Torus ring | `TorusGeometry` | `numHoopChains = 8` |

### Collectibles

- Count: `numCollectibleChains = 20` chains
- `collectibleRadius = 1.5`
- Colour: `0x00ff44`
- Reward: 5 points on pickup

### Markers (Hoops)

- Attached to torus rings
- `markerRadius = 5`
- Colour: `0xFFD700`
- Reward: 10 points on fly-through

---

## Minimap

| Property | Value |
|---|---|
| Canvas size | 400 × 400 px |
| `MINIMAP_VIEW_RANGE` | 750 units |
| Shape | Circle (clipped) |
| Orientation | Rotates to player heading |

### Legend

| Symbol | Colour | Meaning |
|---|---|---|
| Dot | Red | Airborne enemy fighter |
| Dot | Orange | Hostile ground unit |
| Dot | White | Non-hostile ground unit |
| Dot | Yellow | Marker |
| Dot | Green | Collectible |
| Triangle ▲ | Red | Hostile air unit |
| Triangle ▲ | Light blue | Non-hostile air unit |
| Square ■ | Cyan | Active base |
| Label `name N/T` | — | Base name with alive/total count |
| Triangle ▲ | White (centre) | Player |

---

## Configuration Reference

### World

| Constant | Default | Description |
|---|---|---|
| `MAP_BOUNDARY` | 2 000 | Half-extent of the playable square in world units. Units and the player are turned back at this edge. |
| `groundLevel` | -50 | Y position of the ground and water planes. Also the baseline for altitude calculations. |
| `ceilingLevel` | 150 | Y position of the ceiling plane. Player and airborne units are bounded below this. |
| `waterLevel` | `groundLevel + 0.5` | Y position of the water surface mesh, rendered just above the ground plane. |

### Flight

| Constant | Default | Description |
|---|---|---|
| `maxSpeed` | 0.8 | Maximum forward speed (units/frame). |
| `minSpeed` | 0.02 | Minimum forward speed; plane never fully stops. |
| `acceleration` | 0.003 | Speed gained per frame when `W` is held. |
| `deceleration` | 0.002 | Speed lost per frame when `S` is held. |
| `naturalDeceleration` | 0.0005 | Passive speed bleed applied every frame with no throttle input. |
| `maxPitchRate` | 0.025 | Maximum pitch angular velocity (rad/frame). |
| `maxRollRate` | 0.035 | Maximum roll angular velocity (rad/frame). |
| `maxYawRate` | 0.030 | Maximum yaw angular velocity (rad/frame). |
| `rotAccel` | 0.00085 | Angular acceleration applied per frame while a rotation key is held. Higher = snappier turns. |
| `rotDamping` | 0.85 | Multiplier applied to rotation rate each frame when no key is held. `0` = instant stop, `1` = no decay. |

### Weapons

| Constant | Default | Description |
|---|---|---|
| `bulletDamage` | 1 | Base damage per bullet before `playerDamageMultiplier` is applied. |
| `bulletSpeed` | 1.8 | Bullet travel speed (units/frame). |
| `bulletLife` | 150 | Number of frames before a bullet is removed from the scene. |
| `shootCooldownTime` | 4 | Minimum frames between two player shots. |
| `bombDamage` | 40 | Direct hit damage per bomb before `playerDamageMultiplier`. |
| `bombAoERadius` | 50 | Radius of the area-of-effect damage zone on bomb explosion. |
| `bombCooldownTime` | 45 | Minimum frames between two bomb drops. |
| `gravity` | 0.008 | Downward velocity added to a bomb per frame after release. |

### Enemies

| Constant | Default | Description |
|---|---|---|
| `numEnemies` | 10 | Total airborne enemy fighters alive at any time. A new one spawns immediately on each kill. |
| `enemySpeed` | 0.05 | Constant movement speed of enemy fighters (units/frame). |
| `enemyScale` | 2 | Uniform scale applied to all enemy fighter meshes. Also used as the part collision radius. |
| `enemyPartHP` | 1 | HP per individual mesh part; total HP = `enemyPartHP × 4 × level`. |
| `enemyBulletDamage` | 5 | Damage dealt to the player per hostile bullet hit. |
| `enemyBulletSpeed` | 0.8 | Travel speed of all hostile bullets (units/frame). |
| `enemyBulletLife` | 200 | Number of frames before a hostile bullet is removed. |
| `hostileUnitShootingRange` | 600 | Distance (units) within which a hostile unit will open fire on the player. |
| `hostileUnitShootingCooldownTime` | 120 | Frames between successive shots from a single hostile unit (~2 s at 60 fps). |

### Spawn Counts

| Constant | Default | Description |
|---|---|---|
| `numAirbases` | 5 | Number of airbase complexes generated at world init. |
| `numForwardBases` | 8 | Number of forward operating bases generated at world init. |
| `numCarrierGroups` | 2 | Number of carrier strike groups (carrier + escorts) generated at world init. |
| `numDestroyerSquadrons` | 3 | Number of destroyer-only naval squadrons generated at world init. |
| `numHoverWings` | 3 | Number of Hover Wing airborne squadrons (helicopters + balloons). |
| `numStrikeWings` | 2 | Number of Strike Wing airborne squadrons (fighters + tankers + AC-130). |
| `numObstacles` | 80 | Total obstacle objects (pillars, cones, stalactites) distributed across the map. |
| `numCollectibleChains` | 20 | Number of collectible point chains spawned at world init. |
| `numHoopChains` | 8 | Number of torus hoop chains with attached score markers. |

---

## Functions Reference

### Utility

| Function | Signature | Description |
|---|---|---|
| `randomRange` | `(min, max) → number` | Returns a uniformly distributed random float in `[min, max)`. |
| `addXP` | `(amount) → void` | Adds XP to the player, triggers level-up loop if threshold crossed, updates all related HUD elements. |
| `updateDamageUI` | `() → void` | Refreshes the bullet damage readout in the Controls panel to reflect the current `playerDamageMultiplier`. |

### Wing Trails

| Function | Signature | Description |
|---|---|---|
| `createWingTrail` | `() → TrailData` | Allocates a `Float32Array` ring buffer for positions and colours, builds a `THREE.BufferGeometry` with both attributes, wraps it in a `THREE.Points` object added to the scene, and returns a `TrailData` object `{ pts, positions, colors, count }`. |
| `updateWingTrail` | `(trail, tipLocal) → void` | Converts `tipLocal` (a local-space wing-tip offset) to world space via `plane.localToWorld`, shifts the position ring buffer back one slot with `copyWithin`, writes the new world position at index 0, recomputes the vertex colour fade for each active point, marks both buffer attributes as dirty, and updates the draw range to `trail.count`. |

### UI / Notifications

| Function | Signature | Description |
|---|---|---|
| `showNotification` | `(text, isEliminated?) → void` | Spawns a kill notification div on the right edge that slides off-screen after ~8.5 s. `isEliminated` applies the red colour variant. |
| `showCongratsBanner` | `(bmName) → void` | Displays a centred congratulations overlay when a base group is fully eliminated; auto-fades after 2.5 s. |
| `addToConqueredPanel` | `(bmName) → void` | Appends a base name entry to the conquered ticker panel; triggers a CSS scroll animation if the content overflows. |
| `notifyBase` | `(unit) → void` | Called whenever a unit's HP reaches zero. Decrements the owning base's alive count and, on full elimination, awards bonus XP and fires the congrats/ticker UI. |

### Labels

| Function | Signature | Description |
|---|---|---|
| `createUnitLabel` | `(name, level, initialHp, maxHp) → LabelData` | Creates a canvas-texture sprite with the unit name, level badge, and an HP bar. Returns a `LabelData` object containing the sprite, canvas, and texture for later updates. |
| `updateUnitLabel` | `(labelData, currentHp) → void` | Redraws the HP bar on an existing label canvas and marks the texture as needing upload. |

### Ground Visuals

| Function | Signature | Description |
|---|---|---|
| `createGroundUnit` | `(type) → THREE.Group` | Builds and returns the 3D mesh group for one of the named ground unit types (`tank`, `turret`, `truck`, `airport`, `destroyer`, `carrier`). Sets `userData` with HP, level, collision boxes, and shooting state. |
| `createHangar` | `(variant?) → THREE.Group` | Returns a hangar mesh in either `'arch'` (Quonset) or `'box'` (rectangular) form. Hangars are bomb-only targets and belong to base groups. |

### Air Visuals

| Function | Signature | Description |
|---|---|---|
| `createHelicopterVisual` | `() → THREE.Group` | Returns a two-level group: outer group receives the per-frame orbit rotation; inner group holds the fuselage, twin rotors, tail boom, and tail rotor with a fixed `−π/2` body offset so the nose faces the direction of orbit. |
| `createBalloonVisual` | `() → THREE.Group` | Returns a group containing a large sphere envelope, hanging gondola, and connecting cable. Stationary unit — no movement applied. |
| `createFighterVisual` | `() → THREE.Group` | Returns a marine-blue fighter group with fuselage, swept wings, vertical tail, and a cockpit half-sphere. Oriented for linear forward flight. |
| `createTankerVisual` | `() → THREE.Group` | Returns a large light-grey transport group with a wide fuselage, broad wing span, four under-wing engines, and a T-tail. |
| `createAC130Visual` | `() → THREE.Group` | Returns a two-level group (same inner/outer pattern as helicopter) with a boxy dark-olive fuselage, wide wings, four engines, and a rear tail assembly. |

### Air Unit Lifecycle

| Function | Signature | Description |
|---|---|---|
| `createAirUnit` | `(type, x, y, z) → AirUnit` | Calls the correct visual builder, sets position, applies `scale(3,3,3)`, creates a label sprite, initialises all stat fields (`hp`, `collisionRadius`, `xpValue`, `isHostile`, `userData`), and adds the group to the scene. Returns the full `AirUnit` object. |
| `destroyAirUnit` | `(au, idx) → void` | Triggers an explosion at the unit's position, removes the group and label from the scene, splices the unit from `airUnits`, awards XP and score, then calls `notifyBase` to update the owning squadron. |

### Spawners

| Function | Signature | Description |
|---|---|---|
| `createIslets` | `(count) → void` | Generates `count` flat cylinder platforms at random positions within `MAP_BOUNDARY * 0.8` and records them in the `islets` array for later spawn queries. |
| `createObstacles` | `() → void` | Populates the world with pillars (cylinders), stalactites/stalagmites (cones), and hoop chains (torus rings) up to `numObstacles`. All are added to the `obstacles` array for collision testing. |
| `createAllUnits` | `() → void` | Master initialisation function. Calls every spawner in order: islets, obstacles, carrier groups, destroyer squadrons, airbases, forward bases, collectible chains, hoop chains, hover wings, strike wings. |
| `spawnSingleEnemy` | `() → void` | Spawns one enemy fighter at a random position outside the safe zone. Always called again immediately when an enemy is destroyed, keeping the live count at `numEnemies`. |
| `spawnCarrierStrikeGroup` | `(cx, cz) → void` | Places a carrier and 3–4 destroyer escorts in formation at water level, plus optional hangars on a nearby islet. Registers a named fleet `baseMarker`. |
| `spawnDestroyerSquadron` | `(cx, cz) → void` | Places 2–3 destroyers in a loose formation at water level and registers a named squadron `baseMarker`. |
| `spawnAirbase` | `(cx, cz, islet) → void` | Places an airport, defensive tanks and turrets, and hangars on the given islet. Registers a named airbase `baseMarker`. |
| `spawnForwardBase` | `(cx, cz, islet) → void` | Places a mix of tanks, trucks, and hangars on an islet. Registers a named forward base `baseMarker`. |
| `spawnHoverWing` | `(cx, cz) → void` | Spawns 2–3 helicopters (orbiting) and 1–2 balloons (stationary) centred around `(cx, cz)`. Registers a Hover Wing `baseMarker` with `bonusXp = 350`. |
| `spawnStrikeWing` | `(cx, cz) → void` | Spawns 2–3 fighters (linear), optionally a tanker, and optionally an AC-130 (orbiting) centred around `(cx, cz)`. Registers a Strike Wing `baseMarker` with `bonusXp = 500`. |
| `spawnCollectibleChains` | `(count) → void` | Generates `count` chains of green collectible spheres in various spatial patterns (line, circle, spiral, etc.). |
| `spawnHoopChains` | `(count) → void` | Generates `count` chains of torus hoop obstacles, each torus carrying a golden score marker in its centre. |
| `spawnSingleHoopWithMarker` | `() → void` | Creates one standalone torus at a random position and attaches a score marker to it. Used by `spawnHoopChains`. |
| `addCollectibleAt` | `(x, y, z) → void` | Instantiates a single collectible sphere at the given world position and registers it in the `collectibles` array. |

### Islet Helpers

| Function | Signature | Description |
|---|---|---|
| `clampToIslet` | `(px, pz, islet) → {x, z}` | Returns the nearest point on the islet's disc boundary to `(px, pz)`. Used to place units on an islet surface when the raw random position falls outside. |
| `isOnAnyIslet` | `(px, pz) → boolean` | Returns `true` if the XZ position lies within the radius of any islet. Used to distinguish land from water spawn zones. |
| `getNearestIslet` | `(x, z) → Islet` | Iterates all islets and returns the one whose centre is closest to `(x, z)`. Used to attach hangars and assets to the nearest land mass. |

### Collision Math

| Function | Signature | Description |
|---|---|---|
| `pillarHitsBox` | `(px, pz, pr, box) → boolean` | Tests whether an infinite vertical cylinder (pillar) of radius `pr` centred at `(px, pz)` overlaps an axis-aligned bounding box in the XZ plane. |
| `coneHitsSphere` | `(apex, base, baseR, center, sphereR) → boolean` | Tests whether a finite cone (apex point, base centre, base radius) intersects a sphere (centre, radius) using parametric projection along the cone axis. Used for stalactite/stalagmite collision. |

### Actions

| Function | Signature | Description |
|---|---|---|
| `fireBullet` | `() → void` | Spawns a bullet sphere at the plane's nose, inheriting the plane's world direction and multiplying damage by `playerDamageMultiplier`. Adds it to the `bullets` array. |
| `dropBomb` | `() → void` | Spawns a bomb at the plane's belly with forward velocity and a downward gravity component. Adds it to the `bombs` array. On ground impact, triggers AoE damage and an explosion effect. |
| `fireHostileBullet` | `(unit) → void` | Spawns an enemy bullet from the given unit directed towards the player's current position. Adds it to the `enemyBullets` array. |

### Game Lifecycle

| Function | Signature | Description |
|---|---|---|
| `destroyLogicalEnemy` | `(id) → void` | Removes all mesh parts and the label for the enemy with the given UUID, splices it from `enemies`, awards 25 XP and score, then immediately calls `spawnSingleEnemy` to maintain the enemy count. |
| `triggerGameOver` | `() → void` | Sets `isGameOver`, stops the plane, hides all unit labels, and shows the Game Over overlay with the final score. |
| `animate` | `() → void` | The main `requestAnimationFrame` loop. Each frame: processes flight input, moves all entities, resolves all collisions, updates HUD text, toggles debug helpers, positions the camera, and calls `updateMinimap`. |
| `updateMinimap` | `() → void` | Clears the minimap canvas, applies a heading-aligned rotation transform, then draws islets, all unit types (ground, air, enemies, collectibles, markers), base squares with labels, and the player indicator. |
