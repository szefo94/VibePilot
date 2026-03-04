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
| `Space` | Shoot (machinegun) |
| `E` | Drop bomb |
| `R` | Fire homing missiles (pair) |
| `Q` | Deploy flares |
| `X` | Drop napalm bomb |
| `F` | Toggle aiming laser |
| `B` | Toggle collision box debug view |
| `N` | Toggle wing trails |
| `Esc` | Pause / Resume |

---

## HUD

### Panels

- **Player Stats** — HP · Score · Level · XP / XP to next level · bullet damage multiplier
- **Controls** — key bindings · current bullet damage value
- **Target Info** — distance to nearest airborne enemy · nearest hostile ground unit · nearest marker
- **Debug Info** — collision box legend (toggled with `B`) · wing trail toggle reminder (`N`)
- **Coords / Nav** — current player X / Y / Z world position · heading / pitch / bank angles
  - **Angular rate bars** — dual progress bars flanking axis label (`[neg▓] P [▓pos]`): orange fills left for negative rate, green fills right for positive; numeric value shown to the right
  - **Speed bar** — blue bar spanning min → max speed range
- **Ammo HUD** — five rows (GUN / BOMB / MSLE / FLRE / NALM), each with a fill bar, `XX/MAX` count, and live reload countdown
- **Conquered Panel** — three scrolling ticker rows: `BASE` (cyan) · `★ CNS` constellations (gold) · `◆ RNG` corridors (orange); panel and rows are hidden until first entry

### Transient Elements

- Kill notifications (right edge, slide-out)
- Congratulations banner (centre screen, on base / squadron / constellation / corridor completion)
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
| Left / right wing | `BoxGeometry(6, 0.2, 1.5)` |
| Tail fin | `BoxGeometry(0.2, 1.5, 1)` |
| Horizontal stabiliser | `BoxGeometry(2.5, 0.15, 0.8)` |
| Wing barrel launchers | Dark-grey cylinders at each wingtip (±5.9, −0.12, 0.55) |
| Bomb pod | Horizontal cylinder under centre fuselage (0, −0.78, 0.2) |
| Napalm containers | Two small angled cylinders under rear body (±0.36, −0.68, −1.4) |

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
- Trails start hidden on spawn.

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

### Machinegun (`Space`)

| Property | Value |
|---|---|
| Base damage | 1 × `playerDamageMultiplier` |
| Speed | 1.8 |
| Life | 150 frames |
| Cooldown | 4 frames |
| Geometry | `SphereGeometry(0.3)` |
| Colour | `0xffa500` |
| Starting ammo | 60 — increases **+5 per level** |
| Reload time | ~3 s |

### Bombs (`E`)

| Property | Value |
|---|---|
| Damage | 40 × `playerDamageMultiplier` |
| AoE radius | 50 |
| Cooldown | 45 frames |
| Gravity | 0.008 /frame |
| Geometry | `SphereGeometry(1.5)` |
| Starting ammo | 4 — increases **+1 every 5 levels** |
| Reload time | ~5 s |

### Homing Missiles (`R`)

| Property | Value |
|---|---|
| Damage | 80 × `playerDamageMultiplier` + AoE splash (radius 25) |
| Launch speed | 0.5× bullet speed |
| Top speed | 2× bullet speed (ramps up after drop phase) |
| Drop phase | 22 frames — nose dips before homing engages |
| Launch | Paired — two missiles from wingtip launchers |
| Trail | Orange particles every 2.5 frames, 20-frame life |
| Starting ammo | 3 — increases **+1 every 10 levels** |
| Reload time | 10 s |

### Flares (`Q`)

| Property | Value |
|---|---|
| Effect | Deflects all enemy bullets for 3 s |
| Visual | 20 gold particles in symmetric angel-wing arcs |
| Particle life | `FLARE_DURATION` (180 frames) |
| Spread speed | 0.05 – 0.10 units/frame |
| Starting ammo | 2 — increases **+1 every 10 levels** |
| Reload time | 15 s |

### Napalm Bomb (`X`)

| Property | Value |
|---|---|
| Damage | 8 × `playerDamageMultiplier` per 0.5 s, for 5 s |
| AoE radius | 55 |
| Visual | Rising fire-sphere particles across patch radius for full duration |
| Starting ammo | 2 — increases **+1 every 10 levels** |
| Reload time | 8 s |

### Explosions

| Property | Value |
|---|---|
| `explosionDuration` | 400 ms |
| `explosionMaxSize` | 50 |
| Geometry | `SphereGeometry(1)` |
| Colour | `0xffa500` |
| Triggers | Bomb impact · missile impact · unit destruction · enemy bullet hitting player |

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

### Enemy Bullets

| Property | Value |
|---|---|
| Damage | 15 |
| Speed | 1.2 |
| Life | 200 frames |
| Collision radius | 2.8 |
| Geometry | `CylinderGeometry(0.75, 0.75, 5.5)` body + `ConeGeometry(0.75, 2)` tip |
| Impact | Triggers explosion at hit point |

---

## Ground Units & Bases

### Unit Types

| Type | HP | Scale | Hostile | Shoots | Notes |
|---|---|---|---|---|---|
| `tank` | 20 – 60 | 3 | yes | yes | Turret pivots to aim |
| `turret` | 30 – 75 | 3 | yes | yes | Fixed base, rotating head |
| `truck` | 5 | 2.5 | no | no | — |
| `airport` | 150 | 1 | yes | no | Contains child turrets; must be destroyed first to expose turrets |
| `destroyer` | 120 – 300 | 5 | yes | yes | At water level |
| `carrier` | 200 | 8 | no | no | At water level |
| `hangar (arch)` | 200 | 1 | no | no | Bomb damage only |
| `hangar (box)` | 200 | 1 | no | no | Bomb damage only |

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
| Constellation completed | +50 XP |
| Corridor completed | +75 XP |

### XP & Levelling

| Constant / Rule | Value |
|---|---|
| Starting `xpToNextLevel` | 100 |
| Threshold growth per level | × 1.5 |
| `playerDamageMultiplier` gain (levels 1–20) | +0.25 per level |
| `playerDamageMultiplier` gain (levels 21+) | decreases by −0.01/level (level 21 = +0.24 … caps at 0) |

### Ammo Capacity Scaling (on level-up)

| Weapon | Increase |
|---|---|
| GUN | +5 per level |
| BOMB | +1 every 5 levels |
| MISSILE / FLARE / NAPALM | +1 every 10 levels |

> New capacity applies on next reload — current ammo is not auto-reloaded.

---

## Obstacles & Collectibles

### Obstacles

| Type | Geometry | Count |
|---|---|---|
| Pillar | `CylinderGeometry` | part of `numObstacles = 80` |
| Stalactite / stalagmite | `ConeGeometry` | part of `numObstacles` |
| Torus ring | `TorusGeometry` | `numHoopChains = 8` |

### Collectibles — Constellation System

- Count: `numCollectibleChains = 20` chains, each named after a star constellation (Orion, Cassiopeia, Perseus … Vela)
- `collectibleRadius = 1.5`, colour: `0x00ff44`
- Per-pickup notification: `★ Name N/total`; completing a chain awards +50 XP and adds an entry to conquered panel row 2

### Markers — Corridor System

- Each hoop chain is named `Corridor Alpha / Beta / … / Theta`
- Per-ring notification: `◆ Name N/total`; completing all rings awards +75 XP and adds an entry to conquered panel row 3

---

## Minimap

| Property | Value |
|---|---|
| Canvas size | 400 × 400 px |
| `MINIMAP_VIEW_RANGE` | 750 units |
| Shape | Circle (clipped) |
| Orientation | Rotates to player heading |
| Sweep period | 3 s |

### Radar Sweep

The minimap operates as a real radar:

- Three concentric range rings at 33 / 66 / 100 % of the view radius.
- A rotating sweep line completes one full revolution every 3 s; a pie-slice gradient trail fades behind it.
- On each sweep completion all entity positions are captured into a frozen `_radarBlips[]` snapshot. Blips do not move between sweeps — they update atomically once every 3 seconds.
- The player's own position and heading are also frozen at sweep time, so the player triangle and all relative blip positions always reflect the same snapshot moment.

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
| `MAP_BOUNDARY` | 2 000 | Half-extent of the playable square in world units. |
| `groundLevel` | -50 | Y position of the ground and water planes. |
| `ceilingLevel` | 150 | Y position of the ceiling plane. |
| `waterLevel` | `groundLevel + 0.5` | Y position of the water surface mesh. |

### Flight

| Constant | Default | Description |
|---|---|---|
| `maxSpeed` | 0.8 | Maximum forward speed (units/frame). |
| `minSpeed` | 0.02 | Minimum forward speed; plane never fully stops. |
| `acceleration` | 0.003 | Speed gained per frame when `W` is held. |
| `deceleration` | 0.002 | Speed lost per frame when `S` is held. |
| `naturalDeceleration` | 0.0005 | Passive speed bleed each frame with no throttle input. |
| `maxPitchRate` | 0.025 | Maximum pitch angular velocity (rad/frame). |
| `maxRollRate` | 0.035 | Maximum roll angular velocity (rad/frame). |
| `maxYawRate` | 0.030 | Maximum yaw angular velocity (rad/frame). |
| `rotAccel` | 0.00085 | Angular acceleration per frame while a rotation key is held. |
| `rotDamping` | 0.85 | Multiplier applied to rotation rate each frame with no key held. |

### Weapons

| Constant | Default | Description |
|---|---|---|
| `bulletDamage` | 1 | Base bullet damage before `playerDamageMultiplier`. |
| `bulletSpeed` | 1.8 | Bullet travel speed (units/frame). |
| `bulletLife` | 150 | Frames before a bullet is removed. |
| `shootCooldownTime` | 4 | Minimum frames between two player shots. |
| `bombDamage` | 40 | Direct hit damage per bomb before multiplier. |
| `bombAoERadius` | 50 | Radius of bomb AoE damage zone. |
| `bombCooldownTime` | 45 | Minimum frames between two bomb drops. |
| `gravity` | 0.008 | Downward velocity added to a bomb per frame. |
| `missileDamage` | 80 | Missile direct hit damage before multiplier. |
| `missileAoERadius` | 25 | Radius of missile AoE splash. |
| `FLARE_DURATION` | 180 frames | How long flares deflect enemy bullets (~3 s). |
| `napalmDamage` | 8 | Napalm damage per tick before multiplier. |
| `napalmRadius` | 55 | Radius of napalm patch. |

### Enemies

| Constant | Default | Description |
|---|---|---|
| `numEnemies` | 10 | Total airborne enemy fighters alive at any time. |
| `enemySpeed` | 0.05 | Constant movement speed of enemy fighters (units/frame). |
| `enemyScale` | 2 | Uniform scale applied to all enemy fighter meshes. |
| `enemyPartHP` | 1 | HP per mesh part; total HP = `enemyPartHP × 4 × level`. |
| `enemyBulletDamage` | 15 | Damage dealt to the player per hostile bullet hit. |
| `enemyBulletSpeed` | 1.2 | Travel speed of all hostile bullets (units/frame). |
| `enemyBulletLife` | 200 | Frames before a hostile bullet is removed. |
| `hostileUnitShootingRange` | 600 | Distance within which a hostile unit will open fire. |
| `hostileUnitShootingCooldownTime` | 120 | Frames between successive shots from a single unit. |

### Spawn Counts

| Constant | Default | Description |
|---|---|---|
| `numAirbases` | 5 | Number of airbase complexes generated at world init. |
| `numForwardBases` | 8 | Number of forward operating bases generated at world init. |
| `numCarrierGroups` | 2 | Number of carrier strike groups generated at world init. |
| `numDestroyerSquadrons` | 3 | Number of destroyer-only naval squadrons generated at world init. |
| `numHoverWings` | 3 | Number of Hover Wing airborne squadrons. |
| `numStrikeWings` | 2 | Number of Strike Wing airborne squadrons. |
| `numObstacles` | 80 | Total obstacle objects distributed across the map. |
| `numCollectibleChains` | 20 | Number of collectible constellation chains. |
| `numHoopChains` | 8 | Number of torus hoop corridor chains. |

---

## Functions Reference

### Utility

| Function | Signature | Description |
|---|---|---|
| `randomRange` | `(min, max) → number` | Uniformly distributed random float in `[min, max)`. |
| `addXP` | `(amount) → void` | Adds XP, triggers level-up loop if threshold crossed, scales ammo caps, updates HUD. |
| `updateDamageUI` | `() → void` | Refreshes the bullet damage readout in the Controls panel. |

### Wing Trails

| Function | Signature | Description |
|---|---|---|
| `createWingTrail` | `() → TrailData` | Allocates a ring buffer for positions and colours, builds a `THREE.Points` object, returns `TrailData`. |
| `updateWingTrail` | `(trail, tipLocal) → void` | Converts tip to world space, shifts ring buffer, recomputes fade colours, marks attributes dirty. |

### UI / Notifications

| Function | Signature | Description |
|---|---|---|
| `showNotification` | `(text, isEliminated?) → void` | Spawns a kill notification that slides off-screen after ~8.5 s. |
| `showCongratsBanner` | `(bmName) → void` | Centred congratulations overlay; auto-fades after 2.5 s. |
| `addToConqueredRow` | `(rowEl, name) → void` | Appends an entry to a conquered ticker row; shows the row and panel on first entry. |
| `notifyBase` | `(unit) → void` | Decrements base alive count; on full elimination awards bonus XP and fires congrats/ticker UI. |

### Labels

| Function | Signature | Description |
|---|---|---|
| `createUnitLabel` | `(name, level, initialHp, maxHp) → LabelData` | Canvas-texture sprite with name, level badge, and HP bar. |
| `updateUnitLabel` | `(labelData, currentHp) → void` | Redraws HP bar on existing label canvas. |

### Ground Visuals

| Function | Signature | Description |
|---|---|---|
| `createGroundUnit` | `(type) → THREE.Group` | Builds mesh group for a named ground unit type with full `userData`. |
| `createHangar` | `(variant?) → THREE.Group` | Returns a hangar mesh in `'arch'` or `'box'` form. |

### Air Visuals

| Function | Signature | Description |
|---|---|---|
| `createHelicopterVisual` | `() → THREE.Group` | Fuselage, twin rotors, tail boom, tail rotor. |
| `createBalloonVisual` | `() → THREE.Group` | Sphere envelope, gondola, and connecting cable. |
| `createFighterVisual` | `() → THREE.Group` | Fuselage, swept wings, vertical tail, cockpit half-sphere. |
| `createTankerVisual` | `() → THREE.Group` | Wide fuselage, broad wingspan, four under-wing engines, T-tail. |
| `createAC130Visual` | `() → THREE.Group` | Boxy fuselage, wide wings, four engines, rear tail assembly. |

### Air Unit Lifecycle

| Function | Signature | Description |
|---|---|---|
| `createAirUnit` | `(type, x, y, z) → AirUnit` | Calls visual builder, sets position, creates label, initialises stats, adds to scene. |
| `destroyAirUnit` | `(au, idx) → void` | Explosion, remove group and label, splice from `airUnits`, award XP, call `notifyBase`. |

### Spawners

| Function | Signature | Description |
|---|---|---|
| `createIslets` | `(count) → void` | Generates flat cylinder platforms at random positions. |
| `createObstacles` | `() → void` | Populates world with pillars, stalactites, and hoop chains. |
| `createAllUnits` | `() → void` | Master init: calls every spawner in order. |
| `spawnSingleEnemy` | `() → void` | Spawns one enemy fighter; called again immediately on kill. |
| `spawnCarrierStrikeGroup` | `(cx, cz) → void` | Carrier + escorts at water level. |
| `spawnDestroyerSquadron` | `(cx, cz) → void` | 2–3 destroyers in loose formation at water level. |
| `spawnAirbase` | `(cx, cz, islet) → void` | Airport, tanks, turrets, and hangars on an islet. |
| `spawnForwardBase` | `(cx, cz, islet) → void` | Tanks, trucks, and hangars on an islet. |
| `spawnHoverWing` | `(cx, cz) → void` | 2–3 helicopters (orbiting) + 1–2 balloons (stationary). |
| `spawnStrikeWing` | `(cx, cz) → void` | 2–3 fighters + optional tanker + optional AC-130 (orbiting). |
| `spawnCollectibleChains` | `(count) → void` | Constellation-named chains of green collectibles. |
| `spawnHoopChains` | `(count) → void` | Corridor-named torus hoop chains with score markers. |
| `addCollectibleAt` | `(x, y, z) → void` | Single collectible at given world position. |

### Islet Helpers

| Function | Signature | Description |
|---|---|---|
| `clampToIslet` | `(px, pz, islet) → {x, z}` | Nearest point on islet disc to `(px, pz)`. |
| `isOnAnyIslet` | `(px, pz) → boolean` | Whether XZ position lies within any islet radius. |
| `getNearestIslet` | `(x, z) → Islet` | Islet whose centre is closest to `(x, z)`. |

### Collision Math

| Function | Signature | Description |
|---|---|---|
| `pillarHitsBox` | `(px, pz, pr, box) → boolean` | Vertical cylinder vs AABB in XZ plane. |
| `coneHitsSphere` | `(apex, base, baseR, center, sphereR) → boolean` | Finite cone vs sphere using parametric projection. |

### Actions

| Function | Signature | Description |
|---|---|---|
| `fireBullet` | `() → void` | Spawns a bullet at the plane's nose with damage multiplied by `playerDamageMultiplier`. |
| `dropBomb` | `() → void` | Spawns a bomb with forward velocity; AoE + explosion on ground impact. |
| `fireHomingMissiles` | `() → void` | Fires two missiles from wingtip launchers with two-phase flight (drop then home). |
| `deployFlares` | `() → void` | Spawns angel-wing particle burst; deflects enemy bullets for `FLARE_DURATION`. |
| `dropNapalmBomb` | `() → void` | Spawns napalm bomb; creates burn patch on ground impact with fire particles. |
| `fireHostileBullet` | `(unit) → void` | Enemy bullet from unit position directed toward player. |
| `createExplosion` | `(position) → void` | Spawns a growing/fading explosion sphere tracked by `updateExplosions(dt)`. |

### Game Lifecycle

| Function | Signature | Description |
|---|---|---|
| `destroyLogicalEnemy` | `(id) → void` | Removes enemy mesh, awards XP, respawns immediately. |
| `triggerGameOver` | `() → void` | Sets `isGameOver`, stops plane, shows Game Over overlay. |
| `updateRadarSnapshot` | `() → void` | Captures all entity positions + player pos/heading into `_radarBlips[]` and `_radarPlayerPos`. Called once per 3 s sweep cycle. |
| `animate` | `() → void` | Main `requestAnimationFrame` loop — physics, AI, collisions, HUD, camera, minimap. |
| `updateMinimap` | `() → void` | Draws radar rings, sweep trail, sweep line, then all frozen blips from `_radarBlips[]`. |
