# VibePilot — Refactor & Improvement Proposals

> Based on analysis of `main.js`, `style.css`, and `Index.html`.
> Proposals are grouped by theme and ordered roughly by impact vs. effort.
>
> **Completed:** §1.2, §1.3, §2.1–§2.7, §3.1–§3.6, §4.1–§4.5 — removed from this file.

---

## 1. Architecture & Code Organisation

### 1.1 Split `main.js` into modules

The entire game lives in one large file. Suggested split:

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

---

## 2. Performance

### 2.1 Skip `updateMatrixWorld` for stationary ground units

`updateAI` calls `u.updateMatrixWorld(true)` on **every** ground unit every frame — but ground units never move after placement. Compute `worldBox` values once in the spawner (after `scene.add`), store them, and remove the per-frame `updateMatrixWorld` call entirely. This eliminates a full matrix propagation pass over all ground meshes each frame.

### 2.2 `groundUnits.includes()` is O(n) in the bomb path

The bomb AoE path calls `groundUnits.includes(gu)` to check if a unit is still alive after airport child-cleanup. Replace `groundUnits` lookups with a module-level `const _groundSet = new Set()` maintained in sync with the array (add on push, delete on splice). `_groundSet.has(gu)` is O(1).

### 2.3 `groundUnits.slice()` allocates every bomb explosion

The bomb AoE loop creates a snapshot array (`groundUnits.slice()`) on every detonation. Use a module-level scratch array cleared and filled in place:

```js
const _bombCandidates = [];
// in bomb handler:
_bombCandidates.length = 0;
for (const gu of groundUnits) _bombCandidates.push(gu);
```

---

## 3. Code Quality

### 3.1 Extract `destroyGroundUnit(u)` helper

The bullet-hit path and bomb-AoE path both inline the same destruction sequence:

```
createExplosion → destroyLabel → disposeGroup → scene.remove
→ groundUnits.splice → score/xp → notifyBase → airport child cleanup
```

Extract to one function. Removes ~25 lines of duplication and ensures both paths stay in sync when logic changes.

### 3.2 Standardise `notifyBase` call signature

`notifyBase` is called with a raw groundUnit object in some places and with a synthetic `{ userData: { baseId, hp } }` wrapper in others. Pick one convention (passing `baseId` directly is cleanest) and update all call sites.

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

### 5.3 Player invincibility frames

The player can receive multiple hits per frame (enemy bullets + collision simultaneously). Add a short invincibility window (~30 frames) after taking damage to prevent instant death chains.

### 5.4 Win / end condition

There is no current win state — the game runs forever. Options:

- **Conquest mode**: win when all base markers are eliminated
- **Survival mode**: survive N minutes against escalating waves
- **Score attack**: 10-minute timer, final score leaderboard

### 5.5 Persistent progress (localStorage)

Save conquered group names, total kills, and high score to `localStorage`. Show a "previous session" summary on next load.

### 5.6 Player health regeneration

Currently HP only decreases. Add slow passive regen (e.g. 0.01 HP/frame up to 50 % max) so prolonged cautious play is rewarded without making the player unkillable.

### 5.8 Carrier launches aircraft

Carrier Groups are currently static targets. They could periodically spawn 1–2 fighter jets that patrol around the carrier at low altitude, giving the carrier group much higher strategic value. Triggered after a `carrierLaunchCooldown` and capped at `maxCarrierAircraft`.

### 5.9 Turret capture after airbase falls

When an airbase is destroyed, its exposed turrets could enter a `neutral` state for ~10 seconds (stop shooting, tint yellow) before powering down permanently. Adds a brief window where the player can fly away before the threat is neutralised.

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

### 6.6 Damage-state tinting

Units give no visual feedback when taking hits. Lerp each unit's material colour toward red proportional to HP loss:

```js
unitMat.color.lerpColors(originalColor, new THREE.Color(0xff2200), 1 - hp / maxHp);
```

Low-HP targets become visually distinct, helping the player prioritise.

### 6.7 Muzzle flash

Add a brief bright `PointLight` (radius ~8, lifetime ~4 frames) at the turret barrel tip and air-unit gun position on each hostile shot. Cheap and dramatically improves the sense of combat.

### 6.8 Speed lines

At high speed (> ~75% of `maxSpeed`), render a radial `THREE.Points` burst attached to the camera's near plane. Points fade in/out with throttle level. Conveys velocity and makes high-speed dives feel dramatic.

---

## 7. Technical Infrastructure

### 7.1 Add a build step

Currently the game is served as raw JS from CDN. Switching to a minimal build pipeline (e.g. Vite or esbuild) enables:

- Module splitting (see §1.1)
- Dead-code elimination
- Local Three.js import instead of CDN (offline support, version pinning)
- Source maps for debugging minified builds

### 7.2 Linting and formatting

Add ESLint + Prettier configs. Enforces consistent style and catches common bugs (unused variables, implicit globals).

### 7.3 Basic automated tests

Game logic functions (`randomRange`, `pillarHitsBox`, `coneHitsSphere`, collision math) are pure functions with no DOM dependency. Extract them and add unit tests with Vitest or Jest. Prevents regressions when tuning collision radii or spawn logic.

---

## Priority Summary

| # | Proposal | Impact | Effort |
|---|---|---|---|
| 3.1 | `destroyGroundUnit` helper | High | Low |
| 2.1 | Skip ground unit matrixWorld | High | Low |
| 5.1 | Enemy pursuit AI | High | High |
| 5.4 | Win/end condition | High | Medium |
| 5.8 | Carrier launches aircraft | High | Medium |
| 6.6 | Damage-state tinting | Medium | Low |
| 6.7 | Muzzle flash | Medium | Low |
| 5.3 | Player invincibility frames | Medium | Low |
| 2.2 | `_groundSet` for O(1) lookup | Medium | Low |
| 6.1 | Explosion particles | Medium | Medium |
| 6.8 | Speed lines | Low | Medium |
| 1.1 | Module split | Medium | High |
| 7.1 | Build step (Vite) | Medium | High |
