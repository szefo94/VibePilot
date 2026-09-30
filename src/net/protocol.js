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
 *   skies  shared sky — same map, everyone sees everyone's plane, no enemies (phase 1)
 *   pvp    skies + every weapon hits other players; 0 HP → respawn nearby (default)
 *   coop   one shared war against the enemies (phase 3)
 */
import { MAP_BOUNDARY, ceilingLevel, groundLevel, maxSpeed } from '../config.js';

export const PROTOCOL_VERSION = 3;
export const DEFAULT_PORT = 8787;

export const MODES = Object.freeze({
    skies: { label: 'Shared skies', pvp: false, hostAuthority: false },
    pvp:   { label: 'PvP',          pvp: true,  hostAuthority: false },
    coop:  { label: 'Co-op',        pvp: false, hostAuthority: true },
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
export const RESPAWN = Object.freeze({ min: 80, max: 350, minY: groundLevel + 35, maxY: groundLevel + 90 });
export function respawnPoint(i, random = Math.random) {
    const [sx, , sz] = spawnSlot(i).p;
    const a = random() * Math.PI * 2, d = RESPAWN.min + random() * (RESPAWN.max - RESPAWN.min), h = random() * Math.PI * 2;
    const p = [sx + Math.cos(a) * d, RESPAWN.minY + random() * (RESPAWN.maxY - RESPAWN.minY), sz + Math.sin(a) * d].map(v => +v.toFixed(2));
    return { p, q: [0, +Math.sin(h / 2).toFixed(4), 0, +Math.cos(h / 2).toFixed(4)] }; // yaw-only rotation
}

/** PvP damage per hit, by weapon (hits.js names). The server caps every HIT at its weapon's value. Player HP is 100. */
export const PVP_DAMAGE = Object.freeze({ bullet: 4, missile: 45, bomb: 60, napalm: 10 });
export const PVP_KILL_XP = 150;

/** Message types. C→S client to server, S→C server to client. */
export const MSG = Object.freeze({
    HELLO: 'hello',       // C→S  { v, mode, room, name, seed }
    WELCOME: 'welcome',   // S→C  { id, slot, mode, room, seed, hostId, spawn: {p, q}, players: [{ id, name, slot }] }
    REJECT: 'reject',     // S→C  { reason } then close
    JOIN: 'join',         // S→C  { id, name, slot }
    LEAVE: 'leave',       // S→C  { id }
    HOST: 'host',         // S→C  { hostId } — co-op authority moved (host left)
    STATE: 'state',       // C→S  { p:[x,y,z], q:[x,y,z,w], s:speed, hp } — own plane, validated by the server
    SNAP: 'snap',         // S→C  { tick, time, players: [{ id, p, q, s, hp, alive }] } — the room, every tick
    CORRECT: 'correct',   // S→C  { p, q } — your reports were rejected; you are back at your last accepted pose
    DOWN: 'down',         // C→S  { by } — I was shot down (by = player id) or crashed (by = null); S→C { id, by } to the room
    SPAWN: 'spawn',       // S→C  { p, q } — respawn here (random point near your slot, respawnPoint())
    FIRE: 'fire',         // relay { w, p:[x,y,z], d:[x,y,z] } — cosmetic tracers / sounds (phase 2)
    HIT: 'hit',           // pvp:  C→S { target, dmg, w } → S→C to `target` only { from, dmg, w }; dmg ≤ PVP_DAMAGE[w]
    WORLD: 'world',       // coop: host → others { tick, units: [...] } (phase 3)
    ACTION: 'action',     // coop: client → host { kind, ... } (phase 3)
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
