# VibePilot — Refactor & Improvement Proposals

> Based on analysis of `main.js`, `style.css`, and `Index.html`.
> Proposals are grouped by theme and ordered roughly by impact vs. effort.
>
> **Completed:** §1.2, §1.3, §2.1–§2.7, §3.1–§3.6, §4.2, §4.4 — removed from this file.

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

## 4. Bug Fixes

### 4.1 Airport child-turret cleanup order

When the airport building is destroyed, its child turrets are removed from `groundUnits` **after** the airport itself has been spliced out, which shifts array indices mid-loop. Fix: collect child-turret indices first, remove them in reverse order, then remove the airport.

### 4.3 Cap `playerDamageMultiplier`

The multiplier increments by 0.25 on every level-up with no ceiling. After level 20 a single bullet one-shots any unit. Add a cap:

```js
playerDamageMultiplier = Math.min(playerDamageMultiplier + 0.25, MAX_DAMAGE_MULTIPLIER);
```

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

Save conquered group names, total kills, and high score to `localStorage`. Show a "previous session" summary on next load.

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

Add ESLint + Prettier configs. Enforces consistent style and catches common bugs (unused variables, implicit globals).

### 7.3 Basic automated tests

Game logic functions (`randomRange`, `pillarHitsBox`, `coneHitsSphere`, collision math) are pure functions with no DOM dependency. Extract them and add unit tests with Vitest or Jest. Prevents regressions when tuning collision radii or spawn logic.

---

## Priority Summary

| # | Proposal | Impact | Effort |
|---|---|---|---|
| 4.1 | Airport turret cleanup bug | High | Low |
| 4.3 | Cap damage multiplier | Medium | Low |
| 4.5 | Explosion disposal race | Low | Low |
| 5.1 | Enemy pursuit AI | High | High |
| 5.4 | Win/end condition | High | Medium |
| 1.1 | Module split | Medium | High |
| 7.1 | Build step (Vite) | Medium | High |
