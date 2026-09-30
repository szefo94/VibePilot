/**
 * Multiplayer wire protocol, shared by the browser client (src/net/net.js) and the server (server/server.mjs).
 * Plain ES module with no browser or THREE dependencies, so Node can import it as-is.
 *
 * Messages are JSON objects `{ t: <type>, ...fields }`.
 *
 * The server owns the session state: room, map seed, roster, spawn slots, alive/respawning, the clock and the
 * accepted position of every plane. Clients fly their own plane and report it (STATE); the server validates each
 * report and broadcasts one SNAP of the whole room per tick. See MULTIPLAYER.md.
 *
 * Modes:
 *   pvp    the default: the enemy bases fight everyone (co-op), and every weapon also hits other players
 *   coop   the same shared war, without damage between players
 *   skies  just flying together: no enemies, no damage
 */
import { MAP_BOUNDARY, ceilingLevel, groundLevel, maxSpeed } from '../config.js';

export const PROTOCOL_VERSION = 6;
export const DEFAULT_PORT = 8787;

// pvp: players damage each other · enemies: shared enemy bases (kills synced, the host keeps moving units in step)
export const MODES = Object.freeze({
    pvp:   { label: 'PvP + co-op', pvp: true,  enemies: true,  hostAuthority: true },
    coop:  { label: 'Co-op',       pvp: false, enemies: true,  hostAuthority: true },
    skies: { label: 'Shared skies', pvp: false, enemies: false, hostAuthority: false },
});

export const LIMITS = Object.freeze({
    maxPlayers: 8,        // per room
    maxRooms: 32,         // per server
    stateHz: 20,          // client → server plane reports per second
    tickHz: 20,           // server → clients room snapshots per second
    maxMsgBytes: 8192,    // hard cap per message
    maxMsgPerSec: 60,     // per client, all types; excess is dropped
    nameMax: 16, roomMax: 24,
    heartbeatMs: 10000,   // server pings; a client that misses one is dropped
    helloGraceMs: 30000,  // a new connection may take this long to send HELLO
    respawnMs: 3000,      // shot down → SPAWN
});

/** Movement the server accepts (world units, seconds). Dive boost allows up to 1.8 × maxSpeed per 60 fps frame. */
export const VALIDATION = Object.freeze({
    maxUnitsPerSec: maxSpeed * 1.8 * 60,
    slack: 1.25,          // × maxUnitsPerSec, for timer jitter
    jitterUnits: 15,      // flat allowance per report
    boundsMargin: 20,     // past MAP_BOUNDARY / ground / ceiling (the client crashes there anyway)
    strikes: 3,           // consecutive rejected reports before the server sends CORRECT
    minX: -MAP_BOUNDARY, maxX: MAP_BOUNDARY, minY: groundLevel, maxY: ceilingLevel,
});

/** Spawn slot i: a line abreast over the single-player start point, everyone heading +Z (identity rotation). */
export function spawnSlot(i) {
    return { p: [(i - (LIMITS.maxPlayers - 1) / 2) * 30, groundLevel + 40, 0], q: [0, 0, 0, 1] };
}

/** Respawn area: a random point RESPAWN.min–max from slot i's start, at a safe height, with a random heading. */
/** Respawn area: minY clears the highest island peaks (world/terrain.js; the server doesn't know the terrain). */
export const RESPAWN = Object.freeze({ min: 80, max: 350, minY: groundLevel + 75, maxY: groundLevel + 115 });
export function respawnPoint(i, random = Math.random) {
    const [sx, , sz] = spawnSlot(i).p;
    const a = random() * Math.PI * 2, d = RESPAWN.min + random() * (RESPAWN.max - RESPAWN.min), h = random() * Math.PI * 2;
    const p = [sx + Math.cos(a) * d, RESPAWN.minY + random() * (RESPAWN.maxY - RESPAWN.minY), sz + Math.sin(a) * d].map(v => +v.toFixed(2));
    return { p, q: [0, +Math.sin(h / 2).toFixed(4), 0, +Math.cos(h / 2).toFixed(4)] }; // yaw-only rotation
}

/** PvP damage per hit, by weapon (hits.js names). The server caps every HIT at its weapon's value. Player HP is 100. */
export const PVP_DAMAGE = Object.freeze({ bullet: 4, missile: 45, bomb: 60, napalm: 10 });
/** Max HP a client may report (100 + 5 per level, game/progression.js); anything above is capped. */
export const MAX_REPORTED_HP = 1000;
export const PVP_KILL_XP = 150;

/** Enemy unit net ids: 'g<i>' ground units, 'a<i>' air units, in the order the seeded world creates them. */
export const UNIT_ID = /^[ag]\d{1,4}$/;
export const UNIT_WEAPONS = Object.freeze(['bullet', 'missile', 'bomb', 'napalm']);
export const EVENT_TEXT_MAX = 120;

/** STATE.f bits: what others should see this plane doing. */
export const FLAGS = Object.freeze({ gun: 1, laser: 2 });

/** Weapons shown on other players' screens via FIRE (the gun travels as STATE.f instead). */
export const FIRE_WEAPONS = Object.freeze(['missile', 'bomb', 'napalm', 'flare']);

/** Message types. C→S client to server, S→C server to client. */
export const MSG = Object.freeze({
    HELLO: 'hello',       // C→S  { v, mode, room, name, seed }
    WELCOME: 'welcome',   // S→C  { units: { n: { weapon: damage } }, id, slot, mode, room, seed, hostId, spawn: {p, q}, players: [{ id, name, slot }] }
    REJECT: 'reject',     // S→C  { reason } then close
    JOIN: 'join',         // S→C  { id, name, slot }
    LEAVE: 'leave',       // S→C  { id }
    HOST: 'host',         // S→C  { hostId } — co-op authority moved (host left)
    STATE: 'state',       // C→S  { p:[x,y,z], q:[x,y,z,w], s:speed, hp, mh: max hp, f } — own plane (f: FLAGS bits), validated
    SNAP: 'snap',         // S→C  { tick, time, players: [{ id, p, q, s, hp, mh, f, alive }] } — the room, every tick
    CORRECT: 'correct',   // S→C  { p, q } — your reports were rejected; you are back at your last accepted pose
    DOWN: 'down',         // C→S  { by } — I was shot down (by = player id) or crashed (by = null); S→C { id, by } to the room
    SPAWN: 'spawn',       // S→C  { p, q } — respawn here (random point near your slot, respawnPoint())
    FIRE: 'fire',         // relay { w: FIRE_WEAPONS, p, p2?, d?, v?, tg? } → others get { from, … } — shots to draw (src/mp/remoteFx.js)
    HIT: 'hit',           // pvp:  C→S { target, dmg, w } → S→C to `target` only { from, dmg, w }; dmg ≤ PVP_DAMAGE[w]
    UNIT_HIT: 'uhit',     // enemies: C→S { n: unit net id, dmg, w } → others { from, n, dmg, w }; the server keeps the totals
    WORLD: 'world',       // enemies: host → others { u: [[n, x, y, z, vx, vy, vz] | [n, orbitAngle]] } — moving units, 2 Hz
    EVENT: 'event',       // C→S { text, hl } → others { from, text, hl } — a gameplay notification to show with the player's name
    ACTION: 'action',     // reserved: client → host { kind, ... }
    PING: 'ping',         // C→S  { c: clientTime }
    PONG: 'pong',         // S→C  { c } — round-trip time
});

const ID_RE = /^[a-z0-9_-]+$/i;

/** Normalise a room name: lowercase, [a-z0-9_-], ≤ LIMITS.roomMax; '' when invalid. */
export function cleanRoom(room) {
    const r = String(room ?? '').trim().toLowerCase().slice(0, LIMITS.roomMax);
    return ID_RE.test(r) ? r : '';
}
/** Printable player name, ≤ LIMITS.nameMax. */
export function cleanName(name) {
    return String(name ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, LIMITS.nameMax) || 'Pilot';
}

export const encode = (t, data = {}) => JSON.stringify({ ...data, t });

/** Parse one message; null when it is not a JSON object with a known type. */
export function decode(raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return null; }
    return m && typeof m === 'object' && !Array.isArray(m) && Object.values(MSG).includes(m.t) ? m : null;
}
