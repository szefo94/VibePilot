# VibePilot — Roadmap

> Feature ideas and improvement proposals.
> Done items have been removed. See git history for completed work.

---

## High impact — bigger effort but transforms the game

| # | Idea | Why it matters |
|---|---|---|
| G1  | **Enemy pursuit AI** | Fighters become actual threats instead of passive targets |
| G4  | **Win / end condition** | Gives the game a defined goal; conquest mode or survival timer |
| G7  | **Carrier launches aircraft** | Dynamic threat; bases feel alive |
| G8  | **Ammo drop system** | Encourages aggressive play; solves ammo starvation |
| G13 | **Reinforcement waves** | Destroying a base triggers a delayed response wing; world reacts to player |
| G2  | **Difficulty / wave progression** | Scales HP, speed, and mix with kills/time; replay value |
| V6  | **Directional damage indicator** | Red arc toward last hit source; critical UX for combat awareness |
| V1  | **Explosion particles** | Radial burst replaces single sphere; biggest visual upgrade for effort |
| A13 | **Missile proximity warning** | Rising pulsed tone when missile tracks player; situational awareness |

---

## Gameplay

| # | Idea | Impact | Effort |
|---|---|---|---|
| G1 | **Enemy pursuit AI** — fighters steer toward player within range, flee at low HP | High | High |
| G2 | **Difficulty / wave progression** — scale HP, speed, and unit mix with kills / time | High | Medium |
| G3 | **Player invincibility frames** — ~30 frame window after hit prevents chained deaths | Medium | Low |
| G4 | **Win / end condition** — conquest mode (clear all bases) or survival timer | High | Medium |
| G7 | **Carrier launches aircraft** — periodically spawns 1–2 fighters while alive | High | Medium |
| G8 | **Ammo drop system** — ~10 % chance enemies drop a floating ammo sphere on death | High | Medium |
| G9 | **Base conquest buff** — short-duration +damage or regen after clearing a base | High | Medium |
| G10 | **Base-type unique mechanics** — airbase re-spawns jets; carrier patrols; forward base has radar alarm state | High | High |
| G11 | **Progressive radar upgrades** — unlock velocity vectors (lvl 5), wider range (lvl 10), hostile projectiles (lvl 15), full labels (lvl 20) | Medium | Medium |
| G12 | **Moving patrol routes** — ground vehicles and destroyers follow waypoint paths | Medium | High |
| G13 | **Reinforcement waves** — destroying a base triggers a delayed response wing | High | Medium |
| G14 | **Wingman AI** — a friendly escort plane follows the player and assists in combat | High | High |
| G15 | **Afterburner boost** — temporary speed burst (2× max), limited uses per reload | Medium | Low |
| G16 | **Stealth mechanic** — low altitude + flares active = reduced hostile detection range | Medium | Medium |
| G17 | **Terrain collision damage** — flying into the ground or ceiling damages the player | Medium | Low |
| G19 | **Turret capture window** — after airbase falls, turrets go neutral ~10 s before powering down | Low | Low |

---

## Audio

| # | Idea | Impact | Effort |
|---|---|---|---|
| A6 | **Engine hum** — low sine drone, pitch proportional to current speed | High | Low |
| A7 | **Wind noise** — band-passed noise rises with speed above 70 % throttle | Medium | Low |
| A8 | **Explosion rumble** — low-frequency noise burst when bomb/missile detonates | High | Low |
| A9 | **Level-up chime** — short rising arpeggio on level gain | Medium | Low |
| A10 | **Base conquered fanfare** — brief chord burst on full base elimination | Medium | Low |
| A12 | **Flare deploy swoosh** — ascending noise arc on flare deployment | Low | Low |
| A13 | **Missile proximity warning** — rising pulsed tone when an enemy missile is tracking the player | High | Medium |

---

## Visual & UX

| # | Idea | Impact | Effort |
|---|---|---|---|
| V1 | **Explosion particles** — replace single scaling sphere with 12–20 radial particle burst | Medium | Medium |
| V2 | **Explosion scale by weapon** — `createExplosion(pos, scale)`: bullets 1×, bombs 1.5×, missiles 2× | Low | Low |
| V3 | **Damage-state tinting** — lerp unit material toward red proportional to HP loss | Medium | Low |
| V6 | **Directional damage indicator** — red arc on screen edge pointing toward last hit source | High | Medium |
| V7 | **Speed lines** — radial `THREE.Points` burst at camera near-plane, fades with throttle | Low | Medium |
| V8 | **Screen shake** — brief `camera.position` jitter on nearby explosion or player hit | Medium | Low |
| V10 | **Smoke trails from damage** — units below 30 % HP emit a rising dark particle stream | Medium | Medium |
| V11 | **Water splash** — ring of white particles when a bomb or missile hits `waterLevel` | Low | Low |
| V12 | **Dynamic fog / weather** — periodically increase `scene.fog.density` to simulate overcast; player must rely on radar | Medium | Medium |
| V14 | **Kill-streak display** — show current streak counter in HUD after 3+ kills in 5 s | Medium | Low |
| V15 | **Minimap unit trail** — moving blips leave a fading ghost for the last 2–3 radar cycles | Low | Medium |

---

## Fences

| # | Idea | Impact | Effort |
|---|---|---|---|
| F7 | **Fence colour by faction** — hostile bases use rust-red rails and darker posts; friendly bases use olive-green to aid quick identification from the air | Medium | Low |

---

## Architecture & Technical

| # | Idea | Impact | Effort |
|---|---|---|---|
| T1 | **Module split** — break `main.js` into `constants`, `state`, `visuals/`, `spawners/`, `collision`, `ai`, `physics`, `hud/` | Medium | High |
| T2 | **Unit-type constants** — `UNIT.AIRPORT` etc. instead of bare strings | Low | Low |
| T3 | **Build step (Vite/esbuild)** — enables modules, tree-shaking, offline Three.js | Medium | High |
| T4 | **ESLint + Prettier** — consistent style, catches implicit globals | Low | Low |
| T5 | **Unit tests for pure functions** — `randomRange`, collision math, spawn helpers | Low | Medium |
| T6 | **localStorage settings** — save keybindings, volume level, and toggle states across sessions | Medium | Low |

---

## Quick wins — low effort, noticeable payoff

| # | Idea | Why now |
|---|---|---|
| G3  | **Invincibility frames** | 30-frame timer guard on `takeDamage`; prevents frustrating chain deaths |
| A6  | **Engine hum** | Web Audio sine node tied to `speed`; already have audio infra |
| A8  | **Explosion rumble** | Reuse bomb-drop synthesis pattern; ~10 lines |
| A9  | **Level-up chime** | Rising arpeggio via Web Audio; pairs with G18 banner |
| V2  | **Explosion scale by weapon** | Pass `scale` to `createExplosion`; bullets 1×, bombs 1.5×, missiles 2× |
| V8  | **Screen shake** | `camera.position` jitter on hit/nearby explosion; ~15 lines |
| F7  | **Fence colour by faction** | Material colour swap at spawn time; ~1 line per base type |
| T6  | **localStorage settings** | Save toggle states (trails, debug panel) across sessions |
