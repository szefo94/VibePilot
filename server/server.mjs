// VibePilot multiplayer relay: rooms over WebSocket, no game simulation (see MULTIPLAYER.md).
//
//   npm run mp-server                 # ws://localhost:8787
//   PORT=9000 HOST=0.0.0.0 ALLOWED_ORIGINS=https://szefo94.github.io npm run mp-server
//
// A room is (mode, name). The first player's map seed becomes the room's seed; later players are told it in
// WELCOME and reload onto the same map. The server relays plane state and events, routes PvP hits to their
// target, and in co-op tracks which player is the host (the authority for enemy state) and hands it over when
// that player leaves. GET /health returns room/player counts as JSON.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { DEFAULT_PORT, LIMITS, MODES, MSG, PROTOCOL_VERSION, cleanName, cleanRoom, decode, encode } from '../src/net/protocol.js';

const isVec = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);

/** Start the relay; resolves with { port, close(), stats() }. `port: 0` picks a free port (tests). */
export function startMpServer({ port = DEFAULT_PORT, host = '127.0.0.1', allowedOrigins = [], log = console.log } = {}) {
    const rooms = new Map(); // `${mode}:${room}` → { key, mode, name, seed, hostId, players: Map<id, client> }
    const clients = new Set(); // every connection, joined or not
    let nextId = 1;
    const started = Date.now();

    const stats = () => ({
        uptimeS: Math.round((Date.now() - started) / 1000),
        rooms: [...rooms.values()].map(r => ({ mode: r.mode, room: r.name, seed: r.seed, players: r.players.size })),
        players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0),
    });

    const http = createServer((req, res) => {
        if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }).end(JSON.stringify(stats())); return; }
        res.writeHead(404).end('VibePilot multiplayer relay — connect over WebSocket');
    });
    const wss = new WebSocketServer({
        server: http,
        maxPayload: LIMITS.maxMsgBytes,
        verifyClient: ({ origin }) => !allowedOrigins.length || allowedOrigins.includes(origin),
    });

    const send = (c, t, data) => { if (c.ws.readyState === c.ws.OPEN) c.ws.send(encode(t, data)); };
    const broadcast = (room, t, data, except = null) => { for (const c of room.players.values()) if (c !== except) send(c, t, data); };

    function join(c, m) {
        if (m.v !== PROTOCOL_VERSION) return reject(c, `protocol ${m.v} ≠ server ${PROTOCOL_VERSION} — reload the page`);
        if (!Object.hasOwn(MODES, m.mode)) return reject(c, 'unknown mode');
        const name = cleanRoom(m.room);
        if (!name) return reject(c, 'invalid room name');
        const key = `${m.mode}:${name}`;
        let room = rooms.get(key);
        if (!room) {
            if (rooms.size >= LIMITS.maxRooms) return reject(c, 'server full');
            const seed = Number.isInteger(m.seed) && m.seed > 0 ? m.seed >>> 0 : 1;
            room = { key, mode: m.mode, name, seed, hostId: null, players: new Map() };
            rooms.set(key, room);
        }
        if (room.players.size >= LIMITS.maxPlayers) return reject(c, 'room full');
        c.room = room; c.name = cleanName(m.name);
        room.players.set(c.id, c);
        if (MODES[room.mode].hostAuthority && room.hostId === null) room.hostId = c.id;
        send(c, MSG.WELCOME, { id: c.id, mode: room.mode, room: room.name, seed: room.seed, hostId: room.hostId,
            players: [...room.players.values()].filter(p => p !== c).map(p => ({ id: p.id, name: p.name })) });
        broadcast(room, MSG.JOIN, { id: c.id, name: c.name }, c);
        log(`+ ${c.name}#${c.id} → ${key} (${room.players.size})`);
    }
    function reject(c, reason) { send(c, MSG.REJECT, { reason }); c.ws.close(4000, reason.slice(0, 100)); }

    function leave(c) {
        const room = c.room;
        if (!room || !room.players.delete(c.id)) return;
        broadcast(room, MSG.LEAVE, { id: c.id });
        if (room.hostId === c.id) {
            room.hostId = room.players.size ? room.players.keys().next().value : null; // oldest remaining player
            if (room.hostId !== null) broadcast(room, MSG.HOST, { hostId: room.hostId });
        }
        if (!room.players.size) rooms.delete(room.key);
        log(`- ${c.name}#${c.id} ← ${room.key} (${room.players.size})`);
    }

    function handle(c, m) {
        const room = c.room;
        if (!room) { if (m.t === MSG.HELLO) join(c, m); return; }
        const mode = MODES[room.mode];
        switch (m.t) {
            case MSG.PING: send(c, MSG.PONG, { c: m.c }); break;
            case MSG.STATE:
                if (!isVec(m.p, 3) || !isVec(m.q, 4)) return;
                broadcast(room, MSG.STATE, { from: c.id, p: m.p, q: m.q, s: +m.s || 0, hp: +m.hp || 0 }, c);
                break;
            case MSG.FIRE:
                if (!isVec(m.p, 3) || !isVec(m.d, 3)) return;
                broadcast(room, MSG.FIRE, { from: c.id, w: String(m.w).slice(0, 12), p: m.p, d: m.d }, c);
                break;
            case MSG.HIT: {
                if (!mode.pvp) return;
                const target = room.players.get(m.target);
                if (target && target !== c) send(target, MSG.HIT, { from: c.id, dmg: Math.min(100, Math.max(0, +m.dmg || 0)), w: String(m.w).slice(0, 12) });
                break;
            }
            case MSG.DOWN: broadcast(room, MSG.DOWN, { from: c.id, by: m.by ?? null }, c); break;
            case MSG.WORLD:
                if (mode.hostAuthority && room.hostId === c.id) broadcast(room, MSG.WORLD, { ...m, t: undefined, from: c.id }, c);
                break;
            case MSG.ACTION: {
                const host = mode.hostAuthority && room.players.get(room.hostId);
                if (host && host !== c) send(host, MSG.ACTION, { ...m, t: undefined, from: c.id });
                break;
            }
        }
    }

    wss.on('connection', ws => {
        const c = { id: nextId++, ws, room: null, name: 'Pilot', alive: true, budget: LIMITS.maxMsgPerSec, budgetAt: Date.now() };
        ws.on('pong', () => { c.alive = true; });
        ws.on('message', raw => {
            const now = Date.now();
            if (now - c.budgetAt >= 1000) { c.budget = LIMITS.maxMsgPerSec; c.budgetAt = now; }
            if (--c.budget < 0) return; // flood: drop silently
            const m = decode(raw);
            if (m) handle(c, m);
        });
        ws.on('close', () => { clients.delete(c); leave(c); });
        clients.add(c);
        ws.on('error', () => {});
    });
    const heartbeat = setInterval(() => {
        for (const c of clients) {
            if (!c.alive || !c.room) { c.ws.terminate(); continue; } // missed a ping, or never sent HELLO
            c.alive = false;
            c.ws.ping();
        }
    }, LIMITS.heartbeatMs);

    return new Promise((done, fail) => {
        http.once('error', fail);
        http.listen(port, host, () => done({
            port: http.address().port,
            stats,
            close: () => new Promise(r => { clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); wss.close(); http.close(() => r()); }),
        }));
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const srv = await startMpServer({ port: Number(process.env.PORT) || DEFAULT_PORT, host: process.env.HOST || '127.0.0.1', allowedOrigins });
    console.log(`VibePilot MP relay on ws://${process.env.HOST || '127.0.0.1'}:${srv.port}/  origins: ${allowedOrigins.join(', ') || 'any'}`);
    const stop = () => srv.close().then(() => process.exit(0));
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
