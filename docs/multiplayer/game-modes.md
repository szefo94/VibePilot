# Multiplayer game modes

The multiplayer server offers four game modes. You pick one with the address you open. Every mode runs on the same server, port and certificate; only the address changes.

GitHub Pages (https://szefo94.github.io/VibePilot/) is always single-player. Multiplayer needs the server: see [server-hosting-quick-start.md](server-hosting-quick-start.md).

## How to open each mode

Replace `SERVER` with your server's address, for example `https://88.156.90.62` or `http://localhost:8787`.

| Mode | Address | In short |
|---|---|---|
| **Team deathmatch** (default) | `SERVER/` or `SERVER/?mp=tdm` | Red against Blue, five a side; bots fill the empty places |
| **PvP** | `SERVER/?mp=pvp` | Everyone for themselves, plus the enemy bases and Ace Hunt |
| **Co-op** | `SERVER/?mp=coop` | Everyone together against the enemy bases and Ace Hunt |
| **Shared skies** | `SERVER/?mp=skies` | Just flying together: no enemies, no damage |
| Single-player on the server | `SERVER/?sp` | The normal game, no connection |

Options can be added to any multiplayer address:

| Option | Example | Effect |
|---|---|---|
| `room=` | `?mp=tdm&room=friday` | A separate game. Players only meet in the same mode **and** room; the default room is `lobby`. |
| `name=` | `?mp=pvp&name=Maverick` | Callsign for this visit. Without it you get your remembered callsign or a random one; **Callsign** in the start or pause menu changes it. |

Each mode keeps its own rooms, so `?mp=pvp&room=x` and `?mp=coop&room=x` are two different games. The first player in a room sets its map; everyone who joins later loads the same map.

## What each mode has

| | Team deathmatch | PvP | Co-op | Shared skies |
|---|---|---|---|---|
| Players hit each other | Only the other team | Yes, everyone | No | No |
| Teams | Red and Blue, 5 a side; the server puts each new player on the smaller team | — | — | — |
| Bots | Up to 9: they fill each team to 5 and leave when a player takes their place | Ace Hunt aces | Ace Hunt aces | — |
| Enemy bases (XP, objectives) | Yes, shared | Yes, shared | Yes, shared | No |
| Score | Team kills in the roster (`RED 3 : BLUE 1`); no limit yet | — | — | — |
| Kills / deaths | Every player and bot (`3K/1D`), best first in each team | Every player and ace | Every player and ace | — |
| Being shot down | Respawn near your team's start | Respawn near your start | Respawn near your start | Respawn near your start |
| Max players | 10 | 10 | 10 | 10 |

### Team deathmatch
- **Starts:** Red begins in the south of the map and Blue in the north.
- **The flag:** a big red-and-blue flag stands in the middle of the map, with a white ⚑ marker on the minimap. After every spawn a bot flies straight to the flag, ignoring targets on the way unless an enemy is right on top of it. From the flag it looks for targets and patrols around it, so the fighting starts in the middle. Its pole is solid: flying into it crashes you.
- **Teams:** you can't hit or lock onto your teammates, players or bots, and they can't hit you. Teammates are drawn in your team's colour.
- **Score:** each kill of the other team scores for the killer's team, whoever makes it: a player, a bot, or a bot shooting a bot.
- **Kills and deaths:** every pilot, player or bot, shows `kills K / deaths D` in the roster. The server keeps the records, so every player sees the same numbers. A crash or collision counts as a death with no kill. A bot keeps its record between lives; it drops off the list when a player takes its place, and a player's record is dropped when they leave.
- **Bots:**
  - They must **see** an enemy before they attack. Until then they patrol around the flag.
  - When no enemy pilot is close, they attack the enemy bases' units to level up: guns, plus bombs and napalm from level runs over ground units, on every difficulty. Those units are shared, so everyone sees them destroyed, and the bot keeps the XP, not a player.
  - They level up from kills of pilots and units: more HP, sharper, full ammo. They heal on collectibles.
  - A bot comes back about 8 s after it goes down.
  - Flying into any aircraft, a bot included, destroys both planes.
- **XP:** the enemy bases work as in single-player, so every player can earn XP on them.

### Difficulty
Each player's **Difficulty** (Settings or the start menu: Easy, Normal or Hard) sets how hard the enemy bases hit that player. The bots and aces fly with the **host's** difficulty.

### PvP and co-op: Ace Hunt
- **The ace:** the room's host (the first player in) runs Ace Hunt. An ace launches about 90 s into the host's flight, or when the host presses H.
- **Behaviour:** it hunts the players using a rough radar fix, but only attacks once it has seen you.
- **Rewards:** anyone can shoot it down, and the XP goes to whoever lands the killing hit.

### The host
- **Who hosts:** the first player in a room hosts it. The host's game flies the bots and the aces and keeps the moving enemy units in step for everyone. If the host leaves, the next player takes over and starts fresh bots.
- **Keep the host flying:** bots and aces only move while the host is flying, not while the host sits in a menu.
