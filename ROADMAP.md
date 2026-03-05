# VibePilot — Refactor & Improvement Proposals

> Based on analysis of `main.js`, `style.css`, and `index.html`.
> Proposals are grouped by theme and ordered roughly by impact vs. effort.
>
> **Completed and removed:** §1.2, §1.3 (refactor), former §2–§3 (all performance, all code quality), former §4 (balance/bugs), §5.7 (weapons & ammo), §2.2–§2.5, §3.1–§3.4.

---

## 1. Architecture & Code Organisation

### 1.1 Split `main.js` into modules

The entire game lives in one ~1950-line file. Suggested split:

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

### 1.3 Full file inventory for the module split

Based on the current ~1950-line `main.js`, a complete refactor would produce **18 files** across 4 directories:

```
src/
├── constants.js          (~80 lines)  All named constants, TARGET_FPS, MAP_BOUNDARY,
│                                      ammo caps, damage values, minimap sizes, etc.
├── state.js              (~60 lines)  All mutable game-state variables (score, level,
│                                      groundUnits[], enemies[], airUnits[], pools, etc.)
├── utils.js              (~40 lines)  Pure helpers: randomRange(), clamp(), lerp(),
│                                      disposeGroup(), destroyLabel()
├── grid.js               (~40 lines)  Spatial hash grid (_GRID_CELL), addToGrid(),
│                                      removeFromGrid(), queryGrid()
│
├── visuals/
│   ├── ground.js         (~120 lines) createGroundUnit(), createHangar() — all
│   │                                  Three.js geometry for ground units
│   ├── air.js            (~150 lines) createHelicopterVisual(), createBalloonVisual(),
│   │                                  createFighterVisual(), createTankerVisual(),
│   │                                  createAC130Visual()
│   ├── player.js         (~80 lines)  createPlayerPlane(), wing-trail setup,
│   │                                  napalm/bomb/launcher attachment meshes
│   └── fx.js             (~80 lines)  createExplosion(), updateExplosions(),
│                                      _expMatPool, napalm fire particles,
│                                      flare angel-wing effect, missile trail
│
├── spawners/
│   ├── ground.js         (~200 lines) spawnAirbase(), spawnForwardBase(),
│   │                                  spawnDestroyerSquadron(), spawnCarrierGroup(),
│   │                                  finaliseBase(), createAllUnits()
│   ├── air.js            (~120 lines) createAirUnit(), spawnHoverWing(),
│   │                                  spawnStrikeWing(), spawnSingleEnemy()
│   └── obstacles.js      (~80 lines)  spawnChain(), CHAIN_PATTERNS, spawnPillars(),
│                                      spawnStalactites(), spawnTorusRings()
│
├── weapons.js            (~160 lines) fireBullet(), dropBomb(), fireMissile(),
│                                      dropNapalm(), deployFlareEffect(),
│                                      spawnEnemyBullet() — all weapon fire functions
│
├── collision.js          (~120 lines) pillarHitsBox(), coneHitsSphere(),
│                                      resolveCollisions() — full per-frame
│                                      collision resolution pass
│
├── ai.js                 (~100 lines) updateAI() — enemy movement, shooting,
│                                      orbit logic, air unit straight-flight
│
├── physics.js            (~80 lines)  updatePhysics() — player flight model,
│                                      speed/pitch/roll/yaw, position integration
│
├── hud/
│   ├── minimap.js        (~120 lines) updateMinimap(), _ringsCanvas pre-bake,
│   │                                  radar sweep, snapshot blips, player triangle
│   ├── notifications.js  (~80 lines)  showNotification(), showLevelUp(),
│   │                                  conquered panel rows (base/constellation/corridor)
│   └── ammo.js           (~60 lines)  updateAmmoHUD(), updateAmmoBar() helper,
│                                      angular rate bars, speed bar
│
└── main.js               (~120 lines) Scene setup, camera, fog, lights, renderer,
                                       animate() loop — imports all above modules
```

**Total: 18 files, ~1750 lines** (slightly less than the monolith — duplication surfaces during the split).

**Requires a local server** to use native ES module imports (`<script type="module">`). Options:
- `npx serve .` (zero config, one command)
- VS Code Live Server extension
- Bundler (esbuild/Vite) — produces a single output file that runs from `file://`

### 1.2 Unit and weapon type constants

Unit types (`'airport'`, `'tank'`, `'turret'`) and weapon types (`'bullet'`, `'missile'`) are bare strings scattered across hundreds of comparisons. One typo silently breaks a feature.

```js
// Before
if (u.userData.type === 'airport') { ... }

// After
const UNIT = { AIRPORT: 'airport', TANK: 'tank', TURRET: 'turret', ... };
if (u.userData.type === UNIT.AIRPORT) { ... }
```

Centralise into a `const UNIT_TYPE` and `const WEAPON_TYPE` object at the top of `main.js`.

---

## 2. Code Quality

### 2.1 Extract `destroyGroundUnit(u)` helper

The bullet-hit path and bomb-AoE path both inline the same destruction sequence:

```
createExplosion → destroyLabel → disposeGroup → scene.remove
→ groundUnits.splice → score/xp → notifyBase → airport child cleanup
```

Extract to one function. Removes ~25 lines of duplication and ensures both paths stay in sync when logic changes.

---

## 3. Game Design Improvements

### 3.1 Enemy AI — pursuit behaviour

Enemies currently wander at constant random velocity, never reacting to the player. Even simple pursuit improves feel:

- Within range X: steer velocity towards player (proportional control)
- Outside range X: continue patrol
- Differentiate by type: fighters pursue, choppers orbit a waypoint, AC-130 maintains altitude
- Units low on HP flee back toward their base marker rather than continuing attack

### 3.2 Difficulty / wave progression

Currently enemies respawn immediately at fixed difficulty. Proposal:

- Track elapsed game time or total kills
- Every N kills / minutes, increment global `difficultyTier`
- Scale enemy HP, speed, and shooting rate with tier
- Spawn harder unit mixes in later waves (more AC-130s, fewer balloons)
- Every 5 player levels, spawn an additional patrol wing

### 3.3 Player invincibility frames

The player can receive multiple hits per frame (enemy bullets + collision simultaneously). Add a short invincibility window (~30 frames) after taking damage to prevent instant death chains.

### 3.4 Win / end condition

There is no current win state — the game runs forever. Options:

- **Conquest mode**: win when all base markers are eliminated
- **Survival mode**: survive N minutes against escalating waves
- **Score attack**: 10-minute timer, final score leaderboard

### 3.5 Persistent progress (localStorage)

Save conquered group names, total kills, and high score to `localStorage`. Show a "previous session" summary on next load.

### 3.6 Player health regeneration

Currently HP only decreases. Add slow passive regen (e.g. 0.01 HP/frame up to 50 % max) so prolonged cautious play is rewarded without making the player unkillable.

### 3.7 Carrier launches aircraft

Carrier Groups are currently static targets. They could periodically spawn 1–2 fighter jets that patrol around the carrier at low altitude, giving the carrier group much higher strategic value. Triggered after a `carrierLaunchCooldown` and capped at `maxCarrierAircraft`.

### 3.8 Turret capture after airbase falls

When an airbase is destroyed, its exposed turrets could enter a `neutral` state for ~10 seconds (stop shooting, tint yellow) before powering down permanently. Adds a brief window where the player can fly away before the threat is neutralised.

### 3.9 Level-up banner

When the player levels up, only internal stats change — there is no visual or audio feedback. The moment goes entirely unnoticed mid-combat.

Add a `showLevelUpBanner(level)` function: a brief full-width banner fades in ("LEVEL UP — LVL 7") with a colour flash, persisting for ~2 seconds. Pair with a short invulnerability window (ties into §3.3). The emotional payoff dramatically improves the sense of progression.

### 3.10 Ammo drop system

Defeated units have a small chance (~10 %) of dropping a floating ammo sphere at their death position, styled like a collectible. Player must fly through it to collect. Drops favour scarce weapon ammo (missiles, napalm).

This adds a risk-reward loop: expose yourself during combat to grab supplies, or hold back and fight conservatively. Teaches ammo management and breaks the monotony of pure XP farming.

### 3.11 Base conquest buffs

After eliminating a base, award the player a short timed buff — e.g. +50 % damage for 15 s or rapid HP regen for 20 s. Display a "CONQUERED — Damage Boost" banner.

This rewards aggressive play and creates a snowball momentum window after a hard fight, making victory feel earned rather than just incremental.

### 3.12 Base-type unique mechanics

Currently all base types (airbase, forward base, carrier group) play identically — shoot units until base dies. Differentiate:

| Base type | Unique mechanic |
|---|---|
| **Airbase** | Periodically re-spawns one fighter jet while alive (attrition, not one-time spawn) |
| **Carrier Group** | Moves slowly in a patrol loop; hard to approach head-on |
| **Forward Base** | Has a radar tower that triggers alarm state: units shoot 30 % faster when player is within range |
| **Hover Wing** | Actively pursues the player instead of orbiting waypoint |

### 3.13 Progressive radar upgrades via levelling

As the player levels up, radar capabilities unlock:

| Level | Unlock |
|---|---|
| 5 | Radar shows air unit velocity vectors (short line ahead of blip) |
| 10 | Radar range increases from 750 to 1000 units |
| 15 | Hostile projectiles visible as faint dots on radar |
| 20 | Full tactical mode — all units, projectiles, and bases labelled |

Each unlock feels like gaining a genuine capability, giving long-term goals beyond raw stat scaling.

### 3.14 Dynamic weather / visibility

Periodically increase `scene.fog.density` to simulate overcast or storm (60–120 s window). Player must rely on radar instead of visual. Resets smoothly after the window ends.

Low implementation cost (one fog parameter + smooth lerp), high immersion payoff, and naturally shifts moment-to-moment gameplay strategy.

---

## 4. Visual & UX Polish

### 4.1 Explosion particles

Explosions are currently a single scaling/fading sphere. Replace with a simple particle burst: spawn 12–20 small spheres with random radial velocities, gravity pull, and fade. Three.js `Points` with a custom `BufferGeometry` is lightweight and visually dramatic.

### 4.2 Engine/rotor animation

Helicopter rotor discs and fighter engine cones are static. Increment `rotation.z` of rotor meshes each frame proportional to `orbitSpeed` or `velocity.length()` — a one-liner per unit.

### 4.3 Bullet tracers

Player bullets are invisible (only collision logic). Add a short trail using `THREE.Line` or `THREE.Points` behind each bullet, length proportional to speed. Makes shooting feel tactile.

### 4.4 Minimap unit scale legend

The minimap mixes dots (ground), triangles (air), and squares (bases) but has no legend. Add a small fixed corner legend (drawn once, not per frame) showing the icon shapes and their meanings.

### 4.5 Audio

No audio currently. Candidate sounds (Web Audio API, no library needed):

| Event | Sound |
|---|---|
| Player shoot | Short high-frequency click |
| Hit taken | Low thud |
| Unit destroyed | Explosion rumble |
| Level up | Rising arpeggio |
| Base conquered | Fanfare chord |
| Ammo empty | Dry click (no-fire feedback) |

### 4.6 Damage-state tinting

Units give no visual feedback when taking hits. Lerp each unit's material colour toward red proportional to HP loss:

```js
unitMat.color.lerpColors(originalColor, new THREE.Color(0xff2200), 1 - hp / maxHp);
```

Low-HP targets become visually distinct, helping the player prioritise.

### 4.7 Muzzle flash

Add a brief bright `PointLight` (radius ~8, lifetime ~4 frames) at the turret barrel tip and air-unit gun position on each hostile shot. Cheap and dramatically improves the sense of combat.

### 4.8 Speed lines

At high speed (> ~75% of `maxSpeed`), render a radial `THREE.Points` burst attached to the camera's near plane. Points fade in/out with throttle level. Conveys velocity and makes high-speed dives feel dramatic.

### 4.9 Directional damage indicator

When the player is hit, only a brief red screen flash occurs. There is no spatial signal for where the shot came from.

On hit, briefly render a red arc or arrow on the screen edge pointing toward the bullet's origin. Fades over ~0.8 s. Adds genuine tactical value — player can immediately turn to face the threat. Implementation: store `lastHitDirection` (world vector) on collision and project onto 2D HUD space to position a CSS element.

### 4.10 Explosion scale by weapon type

Every explosion uses the same sphere size regardless of source. A stray cannon shell and a missile detonation look identical.

Scale the explosion start radius by `b.userData.damage`: bullets get the current default, bombs get 1.5×, missiles get 2×. One-line change in `createExplosion(pos, scale = 1)`.

### 4.11 Gun empty-clip feedback

When gun ammo runs out, spacebar silently stops firing. No "click" indication and the red bar may not be in the player's peripheral vision.

Flash the ammo bar or the crosshair red for 3–4 frames on the first empty-fire attempt. Optionally play an audio click (ties into §4.5). Makes the reload mechanic readable at a glance.

---

## 5. Technical Infrastructure

### 5.1 Add a build step

Currently the game is served as raw JS from CDN. Switching to a minimal build pipeline (e.g. Vite or esbuild) enables:

- Module splitting (see §1.1)
- Dead-code elimination
- Local Three.js import instead of CDN (offline support, version pinning)
- Source maps for debugging minified builds

### 5.2 Linting and formatting

Add ESLint + Prettier configs. Enforces consistent style and catches common bugs (unused variables, implicit globals).

### 5.3 Basic automated tests

Game logic functions (`randomRange`, `pillarHitsBox`, `coneHitsSphere`, collision math) are pure functions with no DOM dependency. Extract them and add unit tests with Vitest or Jest. Prevents regressions when tuning collision radii or spawn logic.

---

## Priority Summary

| # | Proposal | Impact | Effort |
|---|---|---|---|
| 3.9 | Level-up banner | High | Low |
| 2.1 | `destroyGroundUnit` helper | High | Low |
| 3.10 | Ammo drop system | High | Medium |
| 3.11 | Base conquest buffs | High | Medium |
| 4.9 | Directional damage indicator | High | Medium |
| 3.1 | Enemy pursuit AI | High | High |
| 3.4 | Win/end condition | High | Medium |
| 3.7 | Carrier launches aircraft | High | Medium |
| 3.12 | Base-type unique mechanics | High | High |
| 4.6 | Damage-state tinting | Medium | Low |
| 4.7 | Muzzle flash | Medium | Low |
| 4.11 | Gun empty-clip feedback | Medium | Low |
| 3.3 | Player invincibility frames | Medium | Low |
| 4.1 | Explosion particles | Medium | Medium |
| 3.13 | Progressive radar upgrades | Medium | Medium |
| 3.14 | Dynamic weather / fog | Medium | Medium |
| 4.10 | Explosion scale by weapon | Low | Low |
| 4.8 | Speed lines | Low | Medium |
| 1.1 | Module split | Medium | High |
| 5.1 | Build step (Vite) | Medium | High |
