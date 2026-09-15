# VibePilot — project review and upgrade plan

Reviewed on **2026-09-15**, against commit **`edc4f4b`**.

## Implementation progress

Line references in the review below point at the original single-file `main.js` (commit `edc4f4b`). The code now lives in ES modules under `src/`; module names are given in this table.

**Verification:** `npm run check`, `npm run lint` and `npm run test:browser` — 14 headless probes in `tests/browser-probes.mjs`, one for each fix a focused check can cover — plus a gameplay smoke test that flies, fires every weapon and toggles every overlay, with 0 page errors. Not covered: physical controllers, listening tests, and long-session or real-GPU performance.

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Spawn protection expires ~60× too fast | ✅ Fixed | Grace timer now ticks in seconds (`dt / TARGET_FPS`) inside the simulation block of `src/main.js`; `effects.js` only renders the blink. Probe: 4.63 s → 4.42 s after 1.5 s wall time in slow headless rendering (previously 0 after five frames). |
| 2 | Paused keyboard actions consume ammunition | ✅ Fixed | `src/input.js`: one keydown handler; weapons/spawns require not paused/game over/splash; `e.repeat` ignored for single-press actions and toggles; held input cleared on pause, window blur and tab hide. Keyboard, mouse and gamepad share `tryDropBomb/tryFireMissile/tryDeployFlares/tryDropNapalm` in `combat/weapons.js`. Probe: paused R/E/Q/X + right-click leave ammo unchanged; unpaused R still fires. |
| 3 | Airport turrets use local coordinates as world coordinates | ✅ Fixed | `src/combat/damage.js` `groundUnitWorldPos()` caches each ground unit's world position (refreshed every frame in `updateAI`); used by the spatial grid, bullet/missile/bomb/napalm checks, hostile firing range, HUD, reticle and missile targeting. Probe: cached turret position matches `getWorldPosition` while its local `.position` differs. |
| 4 | Missiles collide with large units and deal no damage | ✅ Fixed | Missiles record the struck entity; it always takes the hit, and splash is measured to each unit's collision surface (`distance − collisionRadius < missileAoERadius`). Probe: missile struck 51 units from a destroyer's centre → 100 HP → 20 HP. |
| 5 | Missile explosions skip enemies when the array changes | ✅ Fixed | Missile splash collects ground/air/fighter deaths and applies them after all scans; AI out-of-bounds despawns are also deferred. Probe: two 40 HP fighters one unit apart both die from one blast. |
| 6 | Enemies leaving the map award kills | ✅ Fixed | `destroyLogicalEnemy(id, { reward: false })` for out-of-bounds recycling — no score, XP or streak. Probe: two fighters pushed out of bounds → score/XP unchanged, both replaced. |
| 8 | Damage eligibility duplicated and inconsistent | 🟡 Partial | One rule, `canDamageGround(unit, weapon)`, for bullets/bombs/missiles/napalm: dead units, units with a living protector, and bomb-only hangars (README: "Bomb damage only"). An airport's death now *exposes* its turrets as the README describes: they are moved into the scene keeping their world transform, and are no longer silently deleted with it. Probe covers protection before and exposure after. HP/death/reward handling is still per weapon. |
| 7 | Collision sampling and weapon cadence depend on frame timing | ✅ Fixed | Player bullets use swept segment-vs-sphere tests (`prevPosition` → `position`) against fighters, air units and ground units. The gun cooldown keeps its remainder (≤ 3 shots per frame, no banking). Chase-camera smoothing and game-over orbit speed are time-based. Probes: 60/61/61/61 shots over the same simulated time at 144/60/20/10 fps (previously 20/25/30 at 20/50/60 fps); a bullet that crossed a fighter part between samples hits it. **Bounded sub-steps** (`src/game/simulation.js`): each frame's elapsed time is split into steps of at most one 60 fps frame for flight, AI, collisions, projectiles and effects; the HUD updates once per frame. Probe `fixedStep`: the same 2 s flight ends at exactly the same position at 60, 20 and 10 fps, whereas the old single-step integration drifted 7.1 units at 10 fps. Bombs and missiles keep point tests: at most 3.6 units per step against collision radii of 9.5 units or more. A strict fixed step with render interpolation was not used: without interpolation state for every moving object it would add judder or input latency. |
| 9 | Smaller progression and control defects | ✅ Fixed | Gamepad throttle uses real analog strength (keys stay full strength). Legacy fighter HP is split across parts so the label total (4/8/12) is the real total, and overkill on one part no longer drains the rest. Challenge tubes keep orbs collected on aborted attempts, so full collection stays possible. |
| 10 | Collision debug mode leaks GPU resources | ✅ Fixed | `effects/debug.js` builds helpers once per object, keeps them attached, and disposes them when the overlay is switched off or the object leaves the world. Box3Helpers are tagged explicitly, because r128 has no `isBox3Helper`. Probe: 1,243 helpers are created once, none are recreated over 1.2 s, and all 1,243 geometries are disposed on toggle-off. |
| 11 | Cleanup disposes shared resources but misses owned ones | ✅ Fixed | `markShared()`/`disposeOwned()` in `core/utils.js` use a WeakSet (clones stay owned). Every module-level geometry and material is marked shared, and `disposeGroup()` skips shared resources. Newly released on removal: missile exhaust clones, hoop axis lines, fence posts (cloned materials, rail/wire/flag geometry). Tube pickups no longer dispose the shared heart geometry. Airport turrets are detached through their real parent. Probe: destroying a tank fires no dispose event on the 7 geometries shared with other tanks. |
| 12 | Destroyed searchlights remain active | ✅ Fixed | Fence damage recognises the PointLights (`isLight`): the light is silenced and unregistered. Alarm fade uses an explicit `alarmed` state and each light's own idle colour. Removed flags leave the animation list. Probe: destroyed tower light unregistered with intensity 0; an alarmed light returns to `#ffffaa`. |
| 13 | Island meshes are mirrored | ✅ Fixed | Shape Y is the negated world-Z offset (`world.js`). Probe: all 10 islets have every polygon vertex on a rendered vertex (max error 0) with faces pointing up. |
| 14 | Procedural placement needs validity checks | 🟡 Partial | `world/populate.js`: bounded rejection sampling (200 tries, then warn and skip), base spawn points validated against the actual islet polygon. Islets store their true bounding radius (`boundR`) for quick rejection tests. Tubes regenerate their path (6 tries) instead of forcing the radius above the safe bound. If no safe path fits, that tube is skipped with a console warning; this happened once in a live smoke run, which spawned 5 of 6 tubes. **Not done:** seeded RNG, full unit-footprint validation and spawn separation. |
| 15 | Smaller visual inconsistencies | 🟡 Partial | Rail and sandbag materials are one clone per fence group, so damage tint no longer spreads to other bases. Napalm patches sit just above the islet or water surface they land on. **Not done:** colour-lines mode still only affects objects present when it is enabled. |
| 16 | Rendering and startup need measured budgets | 🟡 Partial — light budget done | **Tooling** (README → Performance Tooling): in-game profiler (`P` / `?perf`) with per-system CPU, GPU timer queries, draw calls, lights in shaders; `?seed`, `?invulnerable`, `?disable=`; `npm run bench` compares git refs and feature variants, with an optional CPU profile. **Baseline** (Apple M4, ANGLE Metal, uncapped, `hover`, seed 1): 26.8 fps, CPU 36.7 ms/frame (36.1 ms of it three.js render submission, dominated by `uniformMatrix4fv`), GPU 70.7 ms, 931 draw calls, 98k triangles, 50 lights in shaders, world init 27 + 4 ms. The original `edc4f4b` measures 23.0 fps, so the refactor is not a regression. **Attribution:** `?disable=searchlights` → 254 fps (GPU 3.7 ms, CPU 3.5 ms); `?disable=fences` (removes tower lights) → 249 fps; `?disable=labels` → no change. The ~47 PointLights were the bottleneck. **Light budget (done):** searchlights are virtual lights with unlit glow bulbs, and a fixed pool of 4 real PointLights follows the nearest ones (`src/effects/lightBudget.js`). Lights in shaders are now 7 and constant, so destroying a searchlight never recompiles shaders (probe `lightBudget`). Same seed and view: **49.6 → 438.6 fps**, GPU 37.7 → 1.6 ms, CPU render 19.0 → 1.5 ms. The overlay now shows game state, the share of frames that ran gameplay, idle systems and light-budget use. **Still open:** instancing repeated scenery (~720 draw calls), cheaper scenery materials, tracer pooling. |
| 17 | Optional high-score storage can interrupt the game | ✅ Fixed | `src/core/storage.js` wraps get/set in try/catch with an in-memory fallback and non-negative integer parsing. Probe: with `localStorage` throwing `SecurityError`, the game starts and game over shows the score and best. |
| 18 | Audio needs a shared lifecycle and player controls | ✅ Fixed | `src/audio.js`: one AudioContext created on the first key/pointer/touch gesture (no autoplay warnings), a master gain, and `V` to mute (persisted). Noise buffers are generated once per shape, voices capped at 24, errors logged instead of swallowed, and no context is closed early, so the full 220 ms player-hit thud plays. Not listened to by ear in this session. |
| 19 | HUD and session flow usability pass | 🟡 Partial | Minimap sized `min(400px, 42vmin)` (38vmin on narrow screens). Debrief width `min(640px, 94vw)`. Below 900 px wide, reference panels are hidden, the stats bar wraps and the ammo HUD moves to the corner — no panel overlaps at 390×844, 768×1024 or 1440×900. Mouse controls, Esc, V, G and Enter are listed. Memory diagnostics are off by default (M). Enter restarts after game over. **Not done:** explicit start/pause/settings menus, in-place restart without a reload, sensitivity/inversion settings, touch controls. |
| 20 | Extract modules | ✅ Done | `main.js` split mechanically into 43 native ES modules (`src/config.js`, `state.js`, `core/`, `world/`, `player/`, `entities/`, `combat/`, `effects/`, `game/`, `ui/`, `audio.js`, `input.js`, `ai.js`, `main.js`). Cross-module mutable `let`s moved onto the `state` object; the split was checked for load-order (TDZ) safety and smoke-tested in headless Brave with every weapon/toggle. Later fixes added their own modules: damage rules (`combat/damage.js`), storage (`core/storage.js`), resource ownership (`core/utils.js`). **Still open:** one HP/alive/position contract for every entity kind, and data tables for weapon and unit stats. |
| 21 | Remove dead paths and duplicated documentation | ✅ Fixed | Removed `planeMarkerCollisionRadius`, `napalmBombMaterial`, `napalmPatchGeo`, `bombGeometry` and `greyObstacleMaterial`. The splash is now a real session state behind `SPLASH_ENABLED` in `config.js`: it builds its own DOM and holds the simulation until dismissed (probe), and the commented HTML block is gone. README fixed: splash status, islet defaults and islet/placement semantics, function names (`fireMissile`, `deployFlareEffect`, `dropNapalm`), controls. |
| 22 | Reproducible development and deployment | ✅ Done (engine upgrade deferred) | `Index.html` → `index.html`, verified on a case-sensitive host: GitHub Pages from `master` with `.nojekyll`, live link at the top of the README. `package.json` + `package-lock.json` scripts: `serve` (Node static server with correct module MIME types), `check` (module syntax + relative-import resolution), `lint` (ESLint 10 flat config; clean), `test:browser` (headless probes). Three.js stays vendored r128 and is documented as such. The staged Three.js migration is left for a separate change, as the review recommends. Prettier not added: reformatting the dense one-line code would bury the functional history. |

## Summary

The game is a working, feature-rich prototype. It starts successfully, and already contains useful optimizations: reusable scratch vectors, projectile pools, cached player bounding boxes, a spatial grid, throttled minimap drawing, and centralized parts of entity destruction.

The main concern is **inconsistent rules and ownership across systems**. Time units, coordinate spaces, damage rules, and resource cleanup vary between code paths. These produce real gameplay bugs and memory growth. Most of the unnecessary complexity comes from features being added directly to shared global state, with duplicated input and damage logic.

I would first fix the confirmed defects, establish a few regression checks, and then extract modules gradually. The existing procedural visuals and gameplay systems provide a useful foundation.

## Project map

| File | Current responsibility |
|---|---|
| `Index.html` — 140 lines | HUD markup, disabled splash markup, fonts, script loading |
| `main.js` — 3,721 lines / 221,584 bytes | Scene setup, world generation, models, input, flight, AI, weapons, collisions, progression, UI, audio, lifecycle |
| `style.css` — 591 lines | HUD, overlays, animation, splash styling |
| `three.min.js` — 603,445 bytes | Vendored Three.js, revision 128 |
| `README.md` — 810 lines | Player guide and detailed configuration/function reference |
| `ROADMAP.md`, `CHANGES.md` | Feature ideas and implementation history |

There is no package manifest, build script, automated test suite, lint configuration, or CI configuration in the checked-out project. The current application can be served as static files. World creation is deferred through two animation callbacks; subsequent simulation, rendering, and UI updates run from `animate()`.

## Verification and confidence

- `node --check main.js` passed.
- Served the project locally and loaded `/Index.html` in headless Brave/Chromium at a 1440 × 900 viewport. The ordinary startup sample produced no uncaught JavaScript exceptions.
- Used isolated browser-state probes and small Node checks against the actual source and bundled Three.js to verify specific failure cases below.
- Checked layout at a 390-pixel-wide viewport. HUD elements overflow or overlap.
- One randomized startup sample contained 153 ground units, 19 air units, 10 legacy fighters, and 59 searchlights. One captured frame reported **1,071 draw calls**, approximately **100,240 triangles**, 326 geometries, and 78 textures. These are observations from one scene, **not a representative frame-rate benchmark**.
- Gameplay source files were left unchanged. Temporary browser profiles and diagnostic scripts were kept outside the repository.

**Labels:** *Verified* means a focused executable check reproduced the behavior. *Source-confirmed* means the implementation directly demonstrates the issue, without a complete gameplay reproduction. *Risk / profile* identifies a scenario or performance cost needing further measurement. P1 means fix first; P2 means address during stabilization; P3 means planned polish.

## 1. Gameplay correctness

### 1. Spawn protection expires about 60 times too quickly

**P1 · Verified** — `main.js:56, 499, 2197–2202, 3203–3207`

`GRACE_PERIOD` is declared as five seconds, but `_graceTimer` is decremented with `dt`, which is seconds multiplied by 60. Five calls to `updateEffects(1)` changed the timer from `5` to `0`: approximately **0.083 seconds**, rather than five seconds.

**Upgrade:** Immediately correct the conversion, then express simulation timers consistently in seconds. Keep gameplay protection in simulation state rather than the visual-effects updater. Verify protection at 4.9 seconds and its expiry after five seconds.

### 2. Paused keyboard actions still consume ammunition

**P1 · Verified** — `main.js:658–704, 713–745`

The keyboard handler lacks the pause guard present in the mouse and controller paths. While paused, pressing `R` changed missile ammunition from `3` to `2` and spawned two missiles. Bombs, flares, napalm, and debug interceptor spawning have the same missing guard.

Single-action keys also lack an `e.repeat` check: holding Escape repeatedly toggles pause, while held toggle/weapon keys repeat according to operating-system keyboard settings. There is no focus-loss handler to clear held keys or the mouse button; stuck input is a further risk.

**Upgrade:** Route keyboard, mouse, and controller input through one action dispatcher with shared state checks. Distinguish held flight/fire input from single presses. Clear inputs on blur, visibility loss, and pause.

### 3. Airport turrets use local coordinates as world coordinates

**P1 · Verified** — `main.js:639, 983–984, 1980, 2492, 2503, 3168`

Airport turrets are children of their airport, with local offsets such as `(30, 0, 60)`. The spatial grid, missile targeting, firing range, and HUD often read their `.position` as an absolute world location. A turret beside a distant airport can therefore be treated as a target near the map origin.

For example, an airport at `(1000, -48, 1000)` places that turret at `(1030, -48, 1060)`, but the existing range calculation reports approximately 1,415 units when the player is at the turret's actual position.

**Upgrade:** Cache a world position for each gameplay entity after transforms are updated, and use it consistently throughout targeting, collision, damage, and navigation. Convert aiming directions into the correct parent coordinate system.

### 4. Missiles can collide with large units and deal no damage

**P1 · Verified** — `main.js:976, 987, 995, 2978–2998`

Missiles detonate on entering a target's collision sphere, but damage only applies within 25 units of its center. Destroyers have radius 50, airports 100, and carriers 144. A missile approaching the outside of these shapes can detonate before reaching damage range.

A focused check placed a missile 51 units from a 100-HP destroyer: the missile disappeared, and the destroyer retained all 100 HP.

**Upgrade:** Record the directly struck entity and apply direct-hit damage separately from splash damage. Calculate splash distance against the target's collision shape. Ensure the direct victim receives the intended total damage once.

### 5. Missile explosions skip enemies when the array changes during iteration

**P1 · Verified** — `main.js:2264–2268, 3011–3017`

Missile splash loops over `enemies`, while `destroyLogicalEnemy()` immediately removes an entry and appends its replacement. The next original enemy shifts behind the iterator and escapes the blast.

A focused check used two 40-HP enemies one unit apart inside an 80-damage blast. The first died; the second remained at 40 HP.

**Upgrade:** Collect damage results and deaths first, then remove entities and spawn replacements after the loop. Make destruction safe to call once or repeatedly without duplicate rewards. Apply the same deferred-removal approach to AI despawning.

### 6. Enemies leaving the map award unearned kills

**P2 · Verified** — `main.js:2259–2269, 2423`

The out-of-bounds path calls the same reward-bearing function as combat destruction. Moving a fighter beyond the boundary and running its AI update awarded **25 score and 25 XP** without a player hit. It also contributes to kill streaks.

**Upgrade:** Give entity removal an explicit reason, such as combat death or out-of-bounds recycling. Award score, XP, and streak credit according to damage attribution.

### 7. Collision sampling and weapon cadence depend on frame timing

**P1/P2 · Source-confirmed risk; cadence verified** — `main.js:2401–2402, 2784–2803, 2868, 2881, 3148, 3207, 3226–3230`

Bullet collisions are tested before projectiles move, using a single sampled position. At the permitted `dt = 6`, a player bullet moves 10.8 units in one update; a legacy fighter part's combined bullet/collider diameter is only 4.6 units. A projectile can cross the target between samples. This is an algorithmic vulnerability; visual tunneling was not measured.

Gun cooldowns discard elapsed remainder when reset. Running the exact firing logic for two seconds produced 20 shots at 20 FPS, 25 at 50 FPS, and 30 at 60 FPS. Camera following also uses a fixed per-frame interpolation factor.

**Upgrade:** Use bounded fixed simulation steps, retain timer remainder, and test each projectile's traveled segment against colliders. Apply time-based exponential smoothing to the camera. Check equivalent flight and firing scenarios at 30, 60, and 144 FPS plus occasional long frames.

### 8. Damage eligibility is duplicated and inconsistent

**P2 · Source-confirmed** — `main.js:1553–1573, 2849–2851, 2893, 2994–2998, 3071–3075`

Bullets and bombs check whether a turret has a living protector; missiles and napalm omit that rule. Hangars have a `bombOnly` flag, but only the bullet path enforces it. Destroying an airport also kills its dependent turrets immediately, although the README describes exposing them afterward.

**Upgrade:** Define intended weapon/armor/protection rules in one place, then use a common damage function for every weapon. Separate eligibility, HP changes, death, rewards, and visual effects. Resolve the airport/turret behavior explicitly and update its documentation.

### 9. Smaller progression and control defects

| Priority / confidence | Evidence | Upgrade |
|---|---|---|
| P2 · Verified arithmetic | `main.js:2333–2334`: `Math.max(1, axis)` turns every positive controller throttle value below one into full acceleration. | Use full strength for a pressed keyboard key and actual analog strength for the controller. |
| P2 · Source-confirmed | `main.js:1689–1701`: level-two/three legacy fighters display 8/12 HP, but the four parts each receive only 1 HP. | Derive the displayed and actual HP from the same authoritative values. |
| P2 · Source-confirmed | `main.js:2659–2661, 2699, 2733–2738`: aborting a challenge tube leaves collected orbs removed, but the next attempt resets the collection count. Full collection becomes impossible after a partial aborted attempt. | Restore the attempt's orbs on abort, or consistently preserve collection progress. |

## 2. Rendering, world generation, and resource lifetime

### 10. Collision debug mode leaks GPU resources every frame

**P1 · Verified** — `main.js:3106–3127`

`updateDebugBoxes()` removes old helpers and creates new geometries/materials every frame without disposing the old resources. In one browser check, tracked geometries increased from **317 → 906 → 1,495 → 2,084** over three updates. Turning debug mode off left the count at **2,084**.

**Upgrade:** Create helpers once per entity, update their transforms or bounds, and toggle visibility. Dispose their owned resources when the entity or debug overlay is removed. Debugging should be safe to leave enabled during a long session.

### 11. Cleanup disposes shared resources but misses owned ones

**P1 · Verified core defect; other paths source-confirmed** — `main.js:526, 898–904, 911–924, 1430–1433, 1854, 2157, 2165, 2660, 2725, 3022`

`disposeGroup()` disposes every descendant geometry even when it is shared by surviving tanks/trucks. Instrumenting one tank's cleanup emitted a dispose event for geometry still used by **48 live tanks**. Tube pickups similarly dispose the shared heart geometry.

Other paths do too little: missile exhaust materials are cloned but never disposed on removal; hoop cleanup omits its owned child axis geometry; fence removal skips individually owned resources. Destroyed airport turrets are passed to `scene.remove()` even though their actual parent is the airport, so they can remain attached to a surviving parent.

**Upgrade:** Establish explicit ownership for shared assets and instance resources. Detach through the actual parent, clear registries, and dispose instance-owned resources once. Release shared assets during world teardown. Removing a mesh and disposing its resources are separate operations; Three.js can recreate prematurely disposed resources, causing repeated uploads rather than necessarily permanent missing visuals. See the [Three.js disposal guide](https://threejs.org/manual/en/how-to-dispose-of-objects.html).

### 12. Destroyed searchlights remain active in gameplay

**P1 · Verified** — `main.js:1281, 1421–1434, 3254–3277`

Fence lights are `PointLight` objects, but cleanup checks `isSpotLight`. Destroying a light removes it from the scene while leaving it in `_searchlights`. A browser check confirmed `attached: false` alongside `registered: true`, so the invisible detector can still raise alarms.

The alarm fade also checks `color.r < 1`, but the alarm color `0xff4400` already has a red channel of one. It therefore never fades through that branch.

**Upgrade:** Give the visual light and gameplay detector a consistent lifecycle. Correct alarm state transitions and shared ownership when multiple bases share a fence group. Keep active visual lights within a deliberate budget.

### 13. Island meshes are reflected relative to placement and minimap data

**P1 · Verified** — `main.js:180–186`

Polygon Z coordinates are written as Shape Y coordinates, then rotated by `-π/2` around X. This negates their local Z. Irregular coastlines are therefore reflected relative to the polygon used for spawning, fences, and the minimap.

One actual vertex intended at world Z **1343.80** rendered at **1394.54**, reflected around an island center at **1369.17**.

**Upgrade:** Use one explicit conversion between polygon coordinates and world XZ coordinates, preserving upward-facing triangles. Verify an asymmetric island fixture against rendered vertices, placement queries, and minimap geometry.

### 14. Procedural placement needs validity checks

**P2 · Source-confirmed risk** — `main.js:1035, 1632–1641, 1805–1809, 1842`

Base placement samples a circle rather than checking the irregular island polygon. The island lookup's nominal-radius shortcut can reject displaced polygon areas. Random placement loops have no attempt limit or fallback. Tube radius calculation can find a safe maximum below 12, then have it increased back to 12, undermining its self-intersection check.

**Upgrade:** Inject a seeded random generator, validate actual polygons and complete unit footprints, enforce spawn separation, and bound rejection loops. Retain seeds that reveal invalid maps as regression fixtures. Regenerate an invalid tube path instead of overriding a safety bound.

### 15. Smaller visual inconsistencies

| Priority / confidence | Evidence | Upgrade |
|---|---|---|
| P2 · Source-confirmed | Fence rails and sandbags share materials across groups (`main.js:1179–1180`), but base damage mutates those materials (`1453–1455`). Unrelated bases inherit the tint. | Share materials within a damage group or use per-instance colors. |
| P2 · Source-confirmed | Napalm patch tops are at `groundLevel + 0.35` (`545, 3038`), below opaque water at `+0.5` and islands at `+1`. | Place patches just above the actual impacted surface. |
| P2 · Source-confirmed risk | Color mode stores strong mesh references (`1376–1404`) and only processes objects present when enabled. Subsequent spawns use normal materials; removed meshes remain referenced until toggled off. | Apply visual mode through entity creation/removal hooks and clean its registry on destruction. |

### 16. Rendering and startup need measured budgets

**P2 · Profile** — `main.js:1172–1373, 1948–1949, 2326, 2969, 3058`

The observed 1,071 draw calls and 59 searchlights justify profiling. Fences contain many individually drawn posts, rails, and sandbags. Effects frequently allocate meshes, cloned materials, and geometry; each gun shot also creates a tracer geometry. The entire world still initializes synchronously inside one deferred callback.

**Upgrade, in order:**

1. Record initialization time, frame-time percentiles, draw calls, active lights, and resource counts under repeatable seeds and combat scenarios.
2. Use a small reusable set of nearby lights; represent distant lights with inexpensive visual effects.
3. Batch repeated scenery with instancing where destruction can be represented by instance state. Use reusable particle/tracer buffers where allocation profiles justify them.
4. Update ordinary HUD values when they change, or at a bounded display rate. Maintain a cheaper static/dynamic spatial index if grid rebuilding appears in profiles.
5. Divide startup into visible loading stages if its measured blocking time is significant.

Recheck on ordinary integrated graphics before selecting quality defaults. Fog alone does not establish that distant scene work is inexpensive.

## 3. Robustness and player experience

### 17. Optional high-score storage can interrupt the game

**P2 · Verified startup failure** — `main.js:424, 2276–2278`

`localStorage.getItem()` is unguarded during initialization, and `setItem()` runs before the death overlay and debris logic. Injecting a storage-access error caused startup to throw `SecurityError`. A malformed stored value can also produce `NaN`.

**Upgrade:** Use a small storage wrapper with error handling, nonnegative integer validation, and an in-memory fallback. A failed high-score save should allow the rest of the death flow to complete.

### 18. Audio needs a shared lifecycle and player controls

**P2 · Source-confirmed; performance needs profiling** — `main.js:3414–3624`

Each sound creates a new `AudioContext`, and noise buffers are rebuilt repeatedly. Errors are swallowed, and there is no shared volume or mute control. The player-hit sound closes its context when a 50 ms noise layer ends, cutting short its intended 220 ms tone. Browser probes without a real user gesture also produced autoplay warnings; actual playback was not assessed.

**Upgrade:** Create/resume one context from a deliberate start interaction, reuse noise buffers, route sounds through master/effect gain controls, and limit simultaneous voices. Let each voice finish independently. This follows [MDN's Web Audio guidance on contexts, user interaction, and sound controls](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).

### 19. The HUD and session flow need a usability pass

**P2 · Layout verified; remaining items are upgrades** — `Index.html:26–38, 114–117, 134`; `style.css:86, 125–130, 230–235`; `main.js:435–438, 2278, 3627–3721`

The minimap is fixed at 400 × 400 pixels, measuring 404 pixels including its border in a 390-pixel-wide viewport. It overlaps other panels. The debrief has a 640-pixel minimum width plus padding. Instructions and debug information occupy substantial screen space, and memory diagnostics start enabled.

Mouse steering, left-click shooting, and right-click missiles are implemented but absent from the displayed control list. Restart is presented as a page refresh. The disabled splash remains spread across HTML, CSS, and JavaScript; reenabling its input guard does not pause simulation while waiting for the player.

**Upgrade:**

- Provide explicit loading, ready, playing, paused, and game-over states with Start, Resume, Restart, and Settings buttons.
- Make the HUD responsive, collapse detailed instructions, and put diagnostics behind an opt-in toggle.
- Add keyboard/controller/mouse help, sensitivity and inversion settings, volume/mute, and a visible cursor in menus.
- Use keyboard-focusable controls, dialog focus handling, reduced-motion options, and concise text summaries for debrief charts. Mobile play additionally needs a deliberate touch-control design.

## 4. Code organization and unnecessary complexity

### 20. Extract modules around ownership and behavior

**P2 · Maintainability** — `main.js`, especially global state at `389–504`, factories at `925–1703`, collision/projectile logic at `2572–3104`, and `animate()` at `3203`

Systems communicate through many mutable globals and inconsistent entity shapes: ground units store HP in `userData`, air units duplicate it in `hp` and `userData.hp`, and legacy fighters use separate part arrays. Shared scratch vectors and deeply nested mutation make call ordering significant. Much code is compressed into long lines containing several unrelated statements.

Start with a modest structure whose dependencies are explicit:

```text
src/
  main.js                 # initialization and frame scheduling
  config.js               # named tuning values with explicit units
  game.js                 # session state and start/pause/reset/dispose
  input.js                # devices -> actions
  world.js                # seeded placement and terrain queries
  entities.js             # entity state, factories, removal
  physics.js              # movement and collision queries
  combat.js               # weapons, damage, rewards, cooldowns
  rendering.js            # scene objects, effects, resource ownership
  ui.js                   # HUD, menus, debrief
  audio.js                # shared audio context and voices
```

**Upgrade:** Extract one responsibility at a time while preserving working behavior. Define one authoritative HP/alive/position contract and explicit dependencies for each system. Use data tables for repeated weapon configuration and unit stats. Add JSDoc types or incremental TypeScript where entity-state mistakes justify it.

### 21. Remove proven dead paths and reduce duplicated documentation

**P2 · Source-confirmed / maintainability**

- Declaration-only names include `planeMarkerCollisionRadius` (`main.js:234`), `napalmBombMaterial` (`540`), `napalmPatchGeo` (`541`), `bombGeometry` (`548`), and `greyObstacleMaterial` (`607`). Some allocate objects despite having no consumer.
- The inactive splash retains approximately 95 lines of JavaScript plus HTML/CSS. Make it an actual session state controlled from one setting, or remove the unused implementation.
- UI styling is split between CSS, HTML attributes, and large strings in JavaScript (`main.js:422, 435–438, 495`). Move shared presentation rules to stylesheets/components.
- The README describes an active splash (`README.md:74`), obsolete island defaults (`171–172`), and nonexistent function names such as `fireHomingMissiles`, `deployFlares`, and `dropNapalmBomb` (`793–795`).

**Upgrade:** Add linting and formatting, confirm unused-code candidates, and keep documentation focused on startup, actual controls, architecture, tuning, and verification. Generate exhaustive configuration/API references only if they are useful. Preserve the changelog as history; old historical entries are expected to differ from current behavior.

### 22. Establish reproducible development and deployment

**P2 · Maintainability / portability** — project root, `Index.html:137–139`, `three.min.js:6`

The engine is a checked-in minified revision-128 file with no dependency manifest or lockfile. The uppercase `Index.html` is also a portability risk for hosts expecting lowercase `index.html`; the local case-insensitive filesystem does not test that failure.

**Upgrade:** Add documented serve/check/build commands, a dependency manifest with a pinned engine version, and a lockfile if package management is introduced. Normalize the entry filename and verify deployment on a case-sensitive host. Native ES modules are sufficient for the proposed split; choose a bundler when its development and deployment benefits are needed.

Upgrade Three.js separately from gameplay changes, using incremental version steps and visual checks. The official [Three.js migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide) recommends staged updates for old projects. Recheck lighting, materials, geometry APIs, and WebGL support during migration. The old revision alone is not evidence of a security vulnerability.

## 5. Gameplay upgrades after stabilization

These are design proposals, rather than defects established by the review:

1. **A clear mission loop:** select a nearby objective, show progress toward it, and provide an explicit conquest/survival completion state. Existing base tracking can support this.
2. **Readable threats:** directional hit indicators, clearer hostile/non-hostile targeting, and useful altitude/boundary cues. The missile reticle and actual target selection should share one eligibility rule.
3. **Flight and weapon feedback:** speed-linked engine/wind audio, distinct impact effects, and readable direct-hit confirmation. Build on the existing flight model and weapon set.
4. **Tunable difficulty:** retain existing interceptor events, then introduce explicit difficulty presets and measured progression instead of scattering balance changes across handlers.
5. **Fast replay:** deterministic restart, optional high-score/settings persistence, and a useful debrief with final stats and the selected objective's result.

## 6. Recommended implementation order

| Stage | Work | Completion check |
|---|---|---|
| 1. Correctness | Fix grace timing, paused actions, coordinate spaces, missile direct damage, array mutation, and despawn rewards. | Focused regression scenarios reproduce the intended behavior. |
| 2. Resource lifetime | Repair debug helpers, shared/owned resource cleanup, nested removal, and searchlight lifecycle. | Repeated debug toggles, combat, and eventual restart stop producing continuing resource growth after expected pool warm-up. |
| 3. Reliable simulation | Standardize time units, introduce fixed stepping/swept collisions, centralize damage rules, and add seeded world validation. | Equivalent scenarios behave consistently across frame rates and retained world seeds. |
| 4. Maintainability | Extract modules gradually, clarify entity contracts, add formatting/linting and documented commands, update the README. | The game retains its behavior and each subsystem has clear ownership. |
| 5. Player flow and performance | Add session controls/audio settings, simplify responsive HUD, profile and budget lights/draw calls/startup. | Menus and restart work by keyboard/mouse/controller; target hardware meets an agreed frame-time budget. |
| 6. Content and engine evolution | Improve objectives, feedback, and difficulty; migrate Three.js in a separate controlled change. | Playtests show clearer goals, fairer combat, and retained visual behavior. |

### Focused regression coverage worth adding

- Pause rejects gameplay actions from every supported device; repeated toggle keys and focus loss are handled consistently.
- Five-second protection, gun cadence, and camera behavior follow the intended elapsed time.
- Parented turrets have correct world positions in targeting, collision, and range checks.
- A missile directly damages a large target; one blast affects every original victim exactly once; despawning grants no kill reward.
- High-speed projectile segments hit thin targets rather than passing through between samples.
- Shared geometry survives individual entity removal; debug helpers and owned resources are released correctly.
- Asymmetric island geometry matches collision/placement coordinates; seeded maps obey placement constraints.
- Aborting and retrying a tube preserves a completable challenge.
- Denied or malformed storage does not prevent startup or game-over handling.
- Start/pause/restart and the HUD work at supported viewport sizes, with sustained combat checked for resource growth.

**Scope limits:** This was a source review, a short browser smoke test, and focused probes—not a full playthrough, physical-controller test, audio listening test, cross-browser certification, or long-session performance benchmark. Findings identify those differences explicitly so implementation can begin with the strongest evidence.
