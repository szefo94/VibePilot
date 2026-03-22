# VibePilot — Roadmap

> Active feature ideas and design direction.
> Completed items are removed — see git log for history.

---

## Design pillars (from flying game research)

The best arcade flying games (Ace Combat, Luftrausers, Sky Force, StarFox) converge on the same truths:

- **Speed is felt, not just shown** — FOV widen, speed lines, engine pitch. Without audio+visual feedback, fast feels like slow.
- **Threat hierarchy matters** — cannon fodder → elites → named boss. The player needs to immediately read danger levels.
- **Altitude is a mechanic** — diving low for strafing runs = risk. High altitude = safe but weak. Low altitude should feel tense.
- **Clear "what next"** — the biggest problem in empty-world games. Conquest ticker, radar blips, base count down all help but a narrative hook seals it.
- **Risk/reward score loops** — Luftrausers proved that getting close to enemies should *pay*. Safe standoff farming = boring.
- **Weapon feel over weapon count** — 3 well-differentiated weapons (guns, bombs, missiles, napalm ✓) beats 10 samey ones.
- **Instant restart** — any death-to-flying time over 3 seconds kills momentum. Current flow is already good here.
- **Audio does 50 % of the work** — the single highest-ROI addition to this project.

---

## High impact

| # | Idea | Why it matters |
|---|---|---|
| G2  | **Difficulty / wave progression** | Scale HP, speed, unit mix with time/kills — currently flat forever |
| G4  | **Win / end condition** | Conquest mode (clear all bases) or survival timer; gives play a goal |
| G7  | **Carrier launches aircraft** | Dynamic threat; bases feel alive rather than static turret farms |
| G8  | **Ammo drop system** | Encourages aggressive play; solves ammo starvation loop |
| G18 | **Named boss aircraft** | A high-HP enemy with phases (Ace Combat model) — memorable encounter anchor |
| G19 | **Score multiplier for close-range kills** | Gun kills at <100 m = 2×, strafe runs over a base = 1.5× — rewards risk |
| V6  | **Directional damage indicator** | Red arc on screen edge toward last hit source — critical for awareness |
| V1  | **Explosion particles** | Radial burst replaces scaling sphere; biggest visual upgrade per hour |
| A6  | **Engine hum** | Sine drone tied to speed; single most impactful audio addition |
| A13 | **Missile proximity warning** | Rising pulsed tone when missile tracks player |

---

## Gameplay

| # | Idea | Impact | Effort |
|---|---|---|---|
| G2  | **Difficulty / wave progression** — scale HP, speed, unit mix with kills / time | High | Medium |
| G3  | **Player invincibility frames** — ~30 frame window after hit prevents chained deaths | Medium | Low |
| G4  | **Win / end condition** — conquest mode (clear all bases) or survival timer | High | Medium |
| G7  | **Carrier launches aircraft** — periodically spawns 1–2 fighters while alive | High | Medium |
| G8  | **Ammo drop system** — ~10 % chance enemies drop a floating ammo sphere on death | High | Medium |
| G9  | **Base conquest buff** — short-duration +damage or regen after clearing a base | Medium | Medium |
| G10 | **Base-type unique mechanics** — airbase re-spawns jets; carrier has escort fighters | High | High |
| G11 | **Progressive radar upgrades** — unlock velocity vectors (lvl 5), wider range (lvl 10), hostile projectiles (lvl 15), full labels (lvl 20) | Medium | Medium |
| G14 | **Wingman AI** — a friendly escort plane follows and assists in combat | High | High |
| G15 | **Afterburner boost** — temporary 2× speed burst, limited uses | Medium | Low |
| G16 | **Stealth mechanic** — low altitude + active flares = reduced detection range | Medium | Medium |
| G17 | **Terrain collision damage** — hills (once added) damage on impact rather than instant kill | Medium | Low |
| G18 | **Named boss aircraft** — unique high-HP enemy with named label, escorted by fighters, drops a special collectible on death | High | High |
| G19 | **Risk/reward score multiplier** — gun kills close range / strafe passes multiply score | High | Low |

---

## Audio

| # | Idea | Impact | Effort |
|---|---|---|---|
| A6  | **Engine hum** — low sine drone, pitch proportional to speed | High | Low |
| A7  | **Wind noise** — band-passed noise rises with speed above 70 % throttle | Medium | Low |
| A8  | **Explosion rumble** — low-frequency noise burst on bomb/missile detonation | High | Low |
| A9  | **Level-up chime** — short rising arpeggio on level gain | Medium | Low |
| A10 | **Base conquered fanfare** — brief chord burst on full base elimination | Medium | Low |
| A12 | **Flare deploy swoosh** — ascending noise arc on flare deploy | Low | Low |
| A13 | **Missile proximity warning** — rising pulsed tone when a missile is tracking the player | High | Medium |

---

## Visual & UX

| # | Idea | Impact | Effort |
|---|---|---|---|
| V1  | **Explosion particles** — replace scaling sphere with 12–20 radial burst particles | Medium | Medium |
| V2  | **Explosion scale by weapon** — bullets 1×, bombs 1.5×, missiles 2× | Low | Low |
| V3  | **Damage-state tinting** — lerp unit material toward red as HP drops | Medium | Low |
| V6  | **Directional damage indicator** — red arc on screen edge toward last hit | High | Medium |
| V7  | **Speed lines** — radial particles at camera near-plane, fade with throttle | Low | Medium |
| V8  | **Screen shake** — camera jitter on nearby explosion or player hit | Medium | Low |
| V10 | **Smoke trails from damage** — units below 30 % HP emit rising dark particles | Medium | Medium |
| V11 | **Water splash** — ring of white particles when projectile hits water level | Low | Low |
| V12 | **Dynamic fog / weather** — periodically increase fog density; forces radar reliance | Medium | Medium |
| V14 | **Kill-streak display** — streak counter in HUD after 3+ kills in 5 s | Medium | Low |
| V15 | **Minimap unit trail** — moving blips leave a fading ghost over 2–3 radar cycles | Low | Medium |

---

## Fences

| # | Idea | Impact | Effort |
|---|---|---|---|
| F7 | **Fence colour by faction** — hostile: rust-red rails; friendly: olive-green | Medium | Low |

---

## Architecture & Technical

| # | Idea | Impact | Effort |
|---|---|---|---|
| T1 | **Module split** — break `main.js` into `constants`, `state`, `visuals/`, `spawners/`, `collision`, `ai`, `physics`, `hud/` | Medium | High |
| T2 | **Unit-type constants** — `UNIT.AIRPORT` etc. instead of bare strings | Low | Low |
| T3 | **Build step (Vite/esbuild)** — enables modules, tree-shaking, offline Three.js | Medium | High |
| T4 | **ESLint + Prettier** — consistent style, catches implicit globals | Low | Low |
| T5 | **Unit tests for pure functions** — `randomRange`, collision math, spawn helpers | Low | Medium |
| T6 | **localStorage settings** — save keybindings, volume level, toggle states across sessions | Medium | Low |

---

## Quick wins — low effort, noticeable payoff

| # | Idea | Why now |
|---|---|---|
| G3  | **Invincibility frames** | 30-frame guard on `takeDamage`; stops frustrating chain deaths |
| G19 | **Close-range score multiplier** | ~5 lines in bullet hit handler; immediately rewards aggressive flying |
| A6  | **Engine hum** | Web Audio sine node tied to `speed`; audio infra already exists |
| A8  | **Explosion rumble** | Reuse bomb-drop synthesis pattern; ~10 lines |
| A9  | **Level-up chime** | Rising arpeggio; pairs with level banner |
| V2  | **Explosion scale by weapon** | Pass `scale` to `createExplosion`; 1 line at each call site |
| V8  | **Screen shake** | `camera.position` jitter on hit; ~15 lines |
| F7  | **Fence colour by faction** | Material colour swap at spawn time; ~1 line per base type |
| T6  | **localStorage settings** | Save toggle states across sessions |
