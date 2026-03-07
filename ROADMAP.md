# VibePilot — Roadmap

> Feature ideas and improvement proposals, ordered roughly by impact vs. effort.
> Items marked ✅ are complete.

---

## Gameplay

| # | Idea | Impact | Effort | Status |
|---|---|---|---|---|
| G1 | **Enemy pursuit AI** — fighters steer toward player within range, flee at low HP | High | High | — |
| G2 | **Difficulty / wave progression** — scale HP, speed, and unit mix with kills / time | High | Medium | — |
| G3 | **Player invincibility frames** — ~30 frame window after hit prevents chained deaths | Medium | Low | — |
| G4 | **Win / end condition** — conquest mode (clear all bases) or survival timer | High | Medium | — |
| G5 | **Persistent high score** — save score, kills, and conquered list to `localStorage` | Medium | Low | — |
| G6 | **Player health regen** — slow passive regen up to 50 % max HP | Medium | Low | — |
| G7 | **Carrier launches aircraft** — periodically spawns 1–2 fighters while alive | High | Medium | — |
| G8 | **Ammo drop system** — ~10 % chance enemies drop a floating ammo sphere on death | High | Medium | — |
| G9 | **Base conquest buff** — short-duration +damage or regen after clearing a base | High | Medium | — |
| G10 | **Base-type unique mechanics** — airbase re-spawns jets; carrier patrols; forward base has radar alarm state | High | High | — |
| G11 | **Progressive radar upgrades** — unlock velocity vectors (lvl 5), wider range (lvl 10), hostile projectiles (lvl 15), full labels (lvl 20) | Medium | Medium | — |
| G12 | **Moving patrol routes** — ground vehicles and destroyers follow waypoint paths | Medium | High | — |
| G13 | **Reinforcement waves** — destroying a base triggers a delayed response wing | High | Medium | — |
| G14 | **Wingman AI** — a friendly escort plane follows the player and assists in combat | High | High | — |
| G15 | **Afterburner boost** — temporary speed burst (2× max), limited uses per reload | Medium | Low | — |
| G16 | **Stealth mechanic** — low altitude + flares active = reduced hostile detection range | Medium | Medium | — |
| G17 | **Terrain collision damage** — flying into the ground or ceiling damages the player | Medium | Low | — |
| G18 | **Level-up banner** — full-width banner flashes "LEVEL UP — LVL 7" with colour wash | High | Low | — |
| G19 | **Turret capture window** — after airbase falls, turrets go neutral ~10 s before powering down | Low | Low | — |
| G20 | **Score multiplier chain** — consecutive kills within 5 s build a multiplier (×1 → ×4) | High | Low | — |

---

## Audio

| # | Idea | Impact | Effort | Status |
|---|---|---|---|---|
| A1 | **Splash keyboard clicks** — synthesized key-click per character during intro type-out | Medium | Low | ✅ |
| A2 | **Enemy hit sound** — key-click on every bullet/AoE damage hit marker | Medium | Low | ✅ |
| A3 | **Player hit sound** — low sine-sweep thud on incoming damage | Medium | Low | ✅ |
| A4 | **Weapon fire sounds** — descending whistle (bomb), rising noise whoosh (missile), sawtooth thud (napalm) | Medium | Low | ✅ |
| A5 | **Weapon impact sounds** — key-click once per detonation when AoE hits at least one unit | Medium | Low | ✅ |
| A6 | **Engine hum** — low sine drone, pitch proportional to current speed | High | Low | — |
| A7 | **Wind noise** — band-passed noise rises with speed above 70 % throttle | Medium | Low | — |
| A8 | **Explosion rumble** — low-frequency noise burst when bomb/missile detonates | High | Low | — |
| A9 | **Level-up chime** — short rising arpeggio on level gain | Medium | Low | — |
| A10 | **Base conquered fanfare** — brief chord burst on full base elimination | Medium | Low | — |
| A11 | **Empty-clip click** — dry tick when spacebar is pressed with 0 gun ammo | Medium | Low | — |
| A12 | **Flare deploy swoosh** — ascending noise arc on flare deployment | Low | Low | — |
| A13 | **Missile proximity warning** — rising pulsed tone when an enemy missile is tracking the player | High | Medium | — |

---

## Visual & UX

| # | Idea | Impact | Effort | Status |
|---|---|---|---|---|
| V1 | **Explosion particles** — replace single scaling sphere with 12–20 radial particle burst | Medium | Medium | — |
| V2 | **Explosion scale by weapon** — `createExplosion(pos, scale)`: bullets 1×, bombs 1.5×, missiles 2× | Low | Low | — |
| V3 | **Damage-state tinting** — lerp unit material toward red proportional to HP loss | Medium | Low | — |
| V4 | **Muzzle flash** — brief `PointLight` at barrel tip on each hostile shot | Medium | Low | — |
| V5 | **Bullet tracers** — short `THREE.Line` trail behind each player bullet | Medium | Low | — |
| V6 | **Directional damage indicator** — red arc on screen edge pointing toward last hit source | High | Medium | — |
| V7 | **Speed lines** — radial `THREE.Points` burst at camera near-plane, fades with throttle | Low | Medium | — |
| V8 | **Screen shake** — brief `camera.position` jitter on nearby explosion or player hit | Medium | Low | — |
| V9 | **Engine/rotor animation** — increment rotor `rotation.z` per frame on helicopters and AC-130s | Low | Low | — |
| V10 | **Smoke trails from damage** — units below 30 % HP emit a rising dark particle stream | Medium | Medium | — |
| V11 | **Water splash** — ring of white particles when a bomb or missile hits `waterLevel` | Low | Low | — |
| V12 | **Dynamic fog / weather** — periodically increase `scene.fog.density` to simulate overcast; player must rely on radar | Medium | Medium | — |
| V13 | **Gun empty-clip flash** — flash ammo bar / crosshair red for 3–4 frames on empty-fire | Medium | Low | — |
| V14 | **Kill-streak display** — show current streak counter in HUD after 3+ kills in 5 s | Medium | Low | — |
| V15 | **Minimap unit trail** — moving blips leave a fading ghost for the last 2–3 radar cycles | Low | Medium | — |

---

## Architecture & Technical

| # | Idea | Impact | Effort | Status |
|---|---|---|---|---|
| T1 | **Module split** — break ~2 300-line `main.js` into `constants`, `state`, `visuals/`, `spawners/`, `collision`, `ai`, `physics`, `hud/` (18 files) | Medium | High | — |
| T2 | **Unit-type constants** — `UNIT.AIRPORT` etc. instead of bare strings | Low | Low | — |
| T3 | **Build step (Vite/esbuild)** — enables modules, tree-shaking, offline Three.js | Medium | High | — |
| T4 | **ESLint + Prettier** — consistent style, catches implicit globals | Low | Low | — |
| T5 | **Unit tests for pure functions** — `randomRange`, collision math, spawn helpers | Low | Medium | — |
| T6 | **localStorage settings** — save keybindings, volume level, and toggle states across sessions | Medium | Low | — |
