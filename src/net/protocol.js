/**
 * Multiplayer wire protocol, shared by the browser client (src/net/net.js) and the relay server (server/server.mjs).
 * Plain ES module with no browser or THREE dependencies, so Node can import it as-is.
 *
 * Messages are JSON objects `{ t: <type>, ...fields }`. The server adds `from` (sender id) when relaying.
 *
 * Modes (see MULTIPLAYER.md):
 *   skies  shared sky — same map, everyone sees everyone's plane; enemies stay local to each player
 *   pvp    skies + players can shoot each other (shooter-authoritative hits, victim applies damage)
 *   coop   one shared war — the room host's browser owns enemy state and streams it to the others
 */
export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 8787;

export const MODES = Object.freeze({
    skies: { label: 'Shared skies', pvp: false, hostAuthority: false },
    pvp:   { label: 'PvP',          pvp: true,  hostAuthority: false },
    coop:  { label: 'Co-op',        pvp: false, hostAuthority: true },
});

export const LIMITS = Object.freeze({
    maxPlayers: 8,        // per room
    maxRooms: 32,         // per server
    stateHz: 15,          // client → server plane updates per second
    maxMsgBytes: 8192,    // hard cap per message (co-op world snapshots are the largest)
    maxMsgPerSec: 60,     // per client, all types; excess is dropped
    nameMax: 16, roomMax: 24,
    heartbeatMs: 10000,   // server pings; a client that misses one is dropped
});

/** Message types. Direction: C→S client to server, S→C server to client, relay = forwarded to other players. */
export const MSG = Object.freeze({
    HELLO: 'hello',       // C→S  { v, mode, room, name, seed }
    WELCOME: 'welcome',   // S→C  { id, mode, room, seed, hostId, players: [{ id, name }] }
    REJECT: 'reject',     // S→C  { reason } then close
    JOIN: 'join',         // S→C  { id, name }
    LEAVE: 'leave',       // S→C  { id }
    HOST: 'host',         // S→C  { hostId } — co-op authority moved (host left)
    STATE: 'state',       // relay { p:[x,y,z], q:[x,y,z,w], s:speed, hp }                all modes
    FIRE: 'fire',         // relay { w:'gun'|'missile'|'bomb'|..., p:[x,y,z], d:[x,y,z] }  cosmetic tracers / sounds
    HIT: 'hit',           // pvp:  C→S { target, dmg, w } → delivered to `target` only
    DOWN: 'down',         // relay { by } — sender was shot down (pvp) or crashed
    WORLD: 'world',       // coop: host → others { tick, units: [...] } — authoritative enemy snapshot/delta
    ACTION: 'action',     // coop: client → host { kind, ... } — e.g. damage dealt to a unit id
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
