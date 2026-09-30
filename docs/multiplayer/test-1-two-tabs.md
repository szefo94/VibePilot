# Test 1: shared skies, two tabs on one computer

**Goal:** fly two planes in one room on your own PC and confirm they see each other.
**Time:** about 10 minutes.
**Needs:** the `multiplayer` branch, Node.js 18 or newer, and Chrome or Edge.

Part of the [multiplayer plan](../../MULTIPLAYER.md) (test stage 1).

## 1. Prepare (once)

In a terminal in the project folder:

```sh
git switch multiplayer
npm ci
```

`npm ci` installs `ws` (the WebSocket library) and the dev tools into `node_modules/`, which git ignores.

Optional sanity check: `npm run test:mp` should end with `all passed`.

## 2. Start the server

```sh
npm run mp-server
```

You should see:

```text
VibePilot multiplayer server
  game:    http://127.0.0.1:8787/?mp&room=test&name=Alpha
  health:  http://127.0.0.1:8787/health
  origins: any (set ALLOWED_ORIGINS to restrict)
```

Leave this terminal open. It logs every join (`+`), leave (`-`) and crash (`x`). Stop it with **Ctrl+C**.

> The multiplayer server serves the game itself. Don't use `npm run serve` or GitHub Pages for this test.

## 3. Open two players

Open two browser windows side by side. Separate windows work better than tabs, because a hidden tab is throttled by the browser and the other player's plane would stutter.

| Window | Address |
|---|---|
| Player 1 | `http://localhost:8787/?mp&room=test&name=Alpha` |
| Player 2 | `http://localhost:8787/?mp&room=test&name=Bravo` |

What happens:

1. Alpha loads the game and creates the room `test`. Alpha's map becomes the room's map.
2. Bravo loads, connects, and **reloads once** onto Alpha's map. The seed in the address bar changes; this is expected.
3. Both show the start menu. Press **Start** (or Enter) in each window.

The server terminal shows:

```text
+ Alpha#1 → skies:test slot 0 (1)
+ Bravo#2 → skies:test slot 1 (2)
- Bravo#2 ← skies:test (1)        ← Bravo reloading onto the room's map
+ Bravo#3 → skies:test slot 1 (2)
```

## 4. Checklist

Fly one window at a time; click into a window to control it.

| # | Check | Expected |
|---|---|---|
| 1 | Roster panel (right, under Targets) | `● SHARED SKIES · ROOM TEST · N MS`, then `Alpha (you)` and `Bravo` with coloured dots |
| 2 | Same map | Islands, hoops and tubes are identical in both windows |
| 3 | No enemies | No bases, tanks or fighters; no objective panel |
| 4 | Spawn | Both start side by side over the start point, facing the same way |
| 5 | See each other | Fly Alpha in front of Bravo: Bravo sees a red plane with an `Alpha` tag. Alpha sees Bravo in blue. |
| 6 | Smooth movement | The other plane moves smoothly, with no jumps or stutter while its window is visible |
| 7 | Minimap | The other player is a coloured triangle with their name |
| 8 | Crash and respawn | Fly Alpha into the water. Alpha gets an explosion and an orbit camera, and after about 3 s is back at its spawn with 100 HP. Bravo sees the explosion and the plane disappear, then reappear. No game over. |
| 9 | Leave | Close Bravo's window: Bravo disappears from Alpha's roster and sky within a few seconds |
| 10 | Rejoin | Open Bravo's address again: it joins onto the same map |
| 11 | Server restart | Ctrl+C the server, then `npm run mp-server` again. Both windows show `connecting… reconnecting (n)`, then rejoin by themselves (usually within 10 s) and are placed back at their spawn slots. |
| 12 | Single-player untouched | `http://localhost:8787/` (no `?mp`) is the normal game with enemies and no roster |

Extra checks (optional):

- `http://localhost:8787/health` shows the room and player count.
- A third window with `name=Charlie` works the same way (up to 8 players).
- A different room (`room=other`) is a separate world.
- Game modes and their addresses: [game-modes.md](game-modes.md).
- Team deathmatch (the default, `mp=tdm`): the first window joins Red, the second Blue. The roster shows the score (`RED 0 : BLUE 0`), then each team: players plus bots (`Viper · bot · 100 HP`), five a side. When the second window joins, one Blue bot leaves. Bots are dark red or dark blue planes. They fly to the big flag in the middle of the map (the ⚑ on the minimap) and patrol around it until they see a pilot of the other team, player or bot, then attack it. Teammates, whether players or bots, can't be hit or locked. Every kill of the other team adds 1 to that team's score, including bot-on-bot kills. A shot-down bot comes back after about 8 s near its team's start: Red in the south, Blue in the north.
- Aces (modes `pvp` and `coop`): the room's host (the first player in) runs Ace Hunt. About 90 s into the host's flight (or when the host presses H), an ace launches and hunts the **nearest** player. Every window shows it in the roster as `☠ ACE <name> · LV n · HP → <target>`, and as a dark-red plane with a pink name tag and a minimap blip. Anyone can shoot it down, and the XP goes to whoever lands the killing hit. Its gunfire and missiles hit whichever player it is chasing, and flares still work. If the host leaves, the next host starts its own Ace Hunt.

## 5. If something is wrong

| Symptom | Cause / fix |
|---|---|
| The page doesn't load | The server isn't running, or you opened port 8000. Use port **8787**. |
| Roster shows `✕ MULTIPLAYER: protocol …` | One window is using old cached files. Hard-refresh it (Ctrl+F5). |
| Roster stays `○ connecting…` | The server was stopped or restarted. Check its terminal. |
| The other plane stutters or freezes | Its window is hidden or minimised. Keep both windows visible. |
| Bravo keeps reloading | Only one reload is expected. If it repeats, send me the server log. |
| `EADDRINUSE` when starting the server | Something already uses port 8787. Close the other server, or pick another port with `npm run mp-server -- --port 8788` and use it in the addresses. |
| Your plane jumps back | The server rejected impossible movement (`CORRECT`). This should not happen in normal flight; report it with what you were doing. |

## 6. Report back

Note for each checklist item: ✅, ❌ (what happened), or remarks such as "feels laggy" or "hard to spot the other plane". Those answers tune phase 1 (interpolation delay, report rate, name tag size, spawn layout) before test stage 2 (two devices on your home network).
