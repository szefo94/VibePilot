// VibePilot multiplayer server: serves the game and runs the rooms (see MULTIPLAYER.md).
//
//   npm run mp-server                              # http://localhost:8787/?mp  (game + WebSocket on one port)
//   npm run mp-server -- --port 9000 --host 0.0.0.0 # any port, reachable from the network; --help for all options
//
// The server owns the session state; clients only fly their own plane and report it.
//   room      (mode, name); the first player's map seed becomes the room's, later players reload onto it
//   roster    ids, names, spawn slots; JOIN / LEAVE
//   planes    each STATE report is validated (speed, bounds) before it is accepted; repeated rejects → CORRECT
//   clock     one SNAP of the whole room per tick (LIMITS.tickHz) with the server time, for interpolation
//   life      DOWN marks a player dead; SPAWN puts them back at their slot after LIMITS.respawnMs
// PvP hits are routed to their target; in co-op the server tracks the host and hands it over (phases 2–3).
// GET /health returns room and player counts as JSON. Only the game's own files are served over HTTP.
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { extname, join as joinPath, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { networkInterfaces } from 'node:os';
import { CERT_DIR, certHosts, ensureSelfSignedCert } from './cert.mjs';
import { WebSocketServer } from 'ws';
import { cleanName, cleanRoom, decode, DEFAULT_MODE, DEFAULT_PORT, encode, EVENT_TEXT_MAX, FIRE_WEAPONS, LIMITS, MAX_REPORTED_HP, MODES, MSG, PROTOCOL_VERSION, PVP_DAMAGE, respawnPoint, spawnSlot, TEAM_SIZE, teamRespawn, teamSpawn, UNIT_ID, UNIT_WEAPONS, VALIDATION } from '../src/net/protocol.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
// Public files: the page, its stylesheet, three.js and the game modules. Never .git, server/, node_modules, docs.
const PUBLIC = /^\/(index\.html|style\.css|three\.min\.js|src\/[\w/.-]+\.(js|css))$/;

const isVec = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const round = (a, d) => a.map(v => +v.toFixed(d));

/** Start the server; resolves with { port, close(), stats() }. `port: 0` picks a free port (tests). */
/** `tls: { cert, key }` (PEM strings) serves https:// and wss:// instead of http:// and ws://. */
export function startMpServer({ port = DEFAULT_PORT, host = '127.0.0.1', allowedOrigins = [], serveGame = true, tls = null, log = console.log } = {}) {
    const rooms = new Map();   // `${mode}:${room}` → { key, mode, name, seed, hostId, tick, players: Map<id, client> }
    const clients = new Set(); // every connection, joined or not
    let nextId = 1;
    const started = Date.now();

    const stats = () => ({
        uptimeS: Math.round((Date.now() - started) / 1000),
        rooms: [...rooms.values()].map(r => ({ mode: r.mode, room: r.name, seed: r.seed, players: r.players.size })),
        players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0),
    });

    const handler = async (req, res) => {
        const reqUrl = new URL(req.url, 'http://x'), path = reqUrl.pathname;
        // The bare address opens multiplayer (?sp keeps the single-player game reachable)
        if ((path === '/' || path === '/index.html') && !reqUrl.searchParams.has('mp') && !reqUrl.searchParams.has('sp')) {
            const q = new URLSearchParams(reqUrl.search); q.set('mp', DEFAULT_MODE);
            res.writeHead(302, { Location: `/?${q}` }).end();
            return;
        }
        if (path === '/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }).end(JSON.stringify(stats())); return; }
        const rel = path === '/' ? '/index.html' : path;
        if (serveGame && PUBLIC.test(rel) && !rel.includes('..')) {
            const file = normalize(joinPath(ROOT, rel));
            try {
                if (file.startsWith(ROOT + sep) && (await stat(file)).isFile()) {
                    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(await readFile(file));
                    return;
                }
            } catch { /* 404 below */ }
        }
        res.writeHead(404).end('Not found');
    };
    const http = tls ? createTlsServer({ cert: tls.cert, key: tls.key }, handler) : createServer(handler);
    const wss = new WebSocketServer({
        server: http,
        maxPayload: LIMITS.maxMsgBytes,
        verifyClient: ({ origin, req }) => !allowedOrigins.length || allowedOrigins.includes(origin) || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`,
    });

    wss.on('error', () => {}); // ws re-emits listen errors (EADDRINUSE…); the http 'error' handler below reports them

    const send = (c, t, data) => { if (c.ws.readyState === c.ws.OPEN) c.ws.send(encode(t, data)); };
    const broadcast = (room, t, data, except = null) => { for (const c of room.players.values()) if (c !== except) send(c, t, data); };

    /** Place `c` at its slot (join) or a random point near it (respawn): the accepted pose, alive, fresh validation baseline. */
    function placeAtSpawn(c, respawn = false) {
        const s = c.team === null ? (respawn ? respawnPoint(c.slot) : spawnSlot(c.slot))
            : respawn ? teamRespawn(c.team) : teamSpawn(c.team, [...c.room.players.values()].filter(p => p.team === c.team).indexOf(c));
        Object.assign(c, { p: s.p, q: s.q, s: 0.3, hp: c.mh ?? 100, f: 0, alive: true, at: Date.now(), strikes: 0, respawnAt: 0 });
        return s;
    }

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
            room = { key, mode: m.mode, name, seed, hostId: null, tick: 0, players: new Map(), units: {}, score: [0, 0] }; // units: damage log for late joiners
            rooms.set(key, room);
        }
        if (room.players.size >= LIMITS.maxPlayers) return reject(c, 'room full');
        const taken = new Set([...room.players.values()].map(p => p.slot));
        c.slot = 0; while (taken.has(c.slot)) c.slot++;
        c.room = room; c.name = cleanName(m.name);
        c.team = null;
        if (MODES[room.mode].teams) { // the smaller team (Red on a tie)
            const n = t => [...room.players.values()].filter(p => p.team === t).length;
            if (n(0) >= TEAM_SIZE && n(1) >= TEAM_SIZE) return reject(c, 'both teams full');
            c.team = n(1) < n(0) ? 1 : 0;
        }
        room.players.set(c.id, c);
        if (MODES[room.mode].hostAuthority && room.hostId === null) room.hostId = c.id;
        const spawn = placeAtSpawn(c);
        send(c, MSG.WELCOME, { units: room.units, id: c.id, slot: c.slot, team: c.team, score: room.score, mode: room.mode, room: room.name, seed: room.seed, hostId: room.hostId, spawn,
            players: [...room.players.values()].filter(p => p !== c).map(p => ({ id: p.id, name: p.name, slot: p.slot, team: p.team })) });
        broadcast(room, MSG.JOIN, { id: c.id, name: c.name, slot: c.slot, team: c.team }, c);
        log(`+ ${c.name}#${c.id} → ${key} slot ${c.slot} (${room.players.size})`);
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

    /** Accept a plane report if it is physically possible since the last accepted one. */
    function acceptState(c, m) {
        if (!c.alive || !isVec(m.p, 3) || !isVec(m.q, 4)) return;
        const V = VALIDATION, now = Date.now(), [x, y, z] = m.p;
        const dt = Math.max(0.001, (now - c.at) / 1000);
        const moved = Math.hypot(x - c.p[0], y - c.p[1], z - c.p[2]);
        const inBounds = x >= V.minX - V.boundsMargin && x <= V.maxX + V.boundsMargin && z >= V.minX - V.boundsMargin && z <= V.maxX + V.boundsMargin
            && y >= V.minY - V.boundsMargin && y <= V.maxY + V.boundsMargin;
        if (!inBounds || moved > V.maxUnitsPerSec * V.slack * dt + V.jitterUnits) {
            if (++c.strikes >= V.strikes) { c.strikes = 0; c.at = now; send(c, MSG.CORRECT, { p: c.p, q: c.q }); }
            return;
        }
        Object.assign(c, { p: round(m.p, 2), q: round(m.q, 4), s: +m.s || 0, mh: Math.max(1, Math.min(MAX_REPORTED_HP, +m.mh || 100)), hp: Math.max(0, Math.min(MAX_REPORTED_HP, +m.hp || 0)), f: (m.f | 0) & 3, at: now, strikes: 0 });
    }

    function handle(c, m) {
        const room = c.room;
        if (!room) { if (m.t === MSG.HELLO) join(c, m); return; }
        const mode = MODES[room.mode];
        switch (m.t) {
            case MSG.PING: send(c, MSG.PONG, { c: m.c }); break;
            case MSG.STATE: acceptState(c, m); break;
            case MSG.DOWN: {
                if (!c.alive) break;
                let killer = mode.pvp && m.by !== c.id ? room.players.get(m.by) : null;
                if (killer && mode.teams && killer.team === c.team) killer = null; // no friendly fire, so no teamkill credit
                const byTeam = mode.teams ? (killer ? killer.team : (m.byTeam === 0 || m.byTeam === 1) && m.byTeam !== c.team ? m.byTeam : null) : null;
                c.alive = false; c.hp = 0; c.respawnAt = Date.now() + LIMITS.respawnMs;
                broadcast(room, MSG.DOWN, { id: c.id, by: killer ? killer.id : null, byTeam, bot: !killer && byTeam !== null ? String(m.bot ?? '').slice(0, 24) : null });
                if (byTeam !== null) score(room, byTeam);
                log(`x ${c.name}#${c.id} down${killer ? ` (by ${killer.name}#${killer.id})` : ''}`);
                break;
            }
            case MSG.FIRE: {
                // Shots to draw on the others' screens: known weapon, from near the shooter's accepted position
                if (!c.alive || !FIRE_WEAPONS.includes(m.w) || !isVec(m.p, 3) || Math.hypot(m.p[0] - c.p[0], m.p[1] - c.p[1], m.p[2] - c.p[2]) > 60) return;
                const shot = { from: c.id, w: m.w, p: round(m.p, 2) };
                for (const k of ['p2', 'd', 'v']) if (isVec(m[k], 3)) shot[k] = round(m[k], 3);
                if (Number.isInteger(m.tg) && room.players.has(m.tg)) shot.tg = m.tg;
                broadcast(room, MSG.FIRE, shot, c);
                break;
            }
            case MSG.HIT: {
                if (!mode.pvp) return;
                const target = room.players.get(m.target), cap = PVP_DAMAGE[m.w];
                if (!target || target === c || !target.alive || !c.alive || !cap) return;
                if (mode.teams && target.team === c.team) return; // no friendly fire
                send(target, MSG.HIT, { from: c.id, dmg: Math.min(cap, Math.max(0, +m.dmg || 0)), w: m.w });
                break;
            }
            case MSG.UNIT_HIT: {
                // Shared enemies: keep the damage totals (a late joiner replays them) and pass the hit on
                if (!mode.enemies || typeof m.n !== 'string' || !UNIT_ID.test(m.n) || !UNIT_WEAPONS.includes(m.w)) return;
                const dmg = Math.min(500, Math.max(0, +m.dmg || 0));
                if (!dmg) return;
                const log = room.units[m.n] ??= {};
                if (!log[m.w] && Object.keys(room.units).length > 2000) return; // bounded
                log[m.w] = Math.min(1e6, (log[m.w] ?? 0) + dmg);
                broadcast(room, MSG.UNIT_HIT, { from: c.id, n: m.n, dmg, w: m.w }, c);
                break;
            }
            case MSG.EVENT: {
                const text = String(m.text ?? '').replace(/\p{Cc}/gu, '').trim().slice(0, EVENT_TEXT_MAX);
                if (text) broadcast(room, MSG.EVENT, { from: c.id, text, hl: !!m.hl }, c);
                break;
            }
            // Aces (bots) belong to the host's game: it shares them, is told of hits on them, and reports theirs
            case MSG.BOT: {
                // The host's bots: shared with everyone; their hits on players go to each target only (as BOT_FIRE)
                if (!mode.enemies || room.hostId !== c.id || !Array.isArray(m.bots) || m.bots.length > 12 || (m.m !== undefined && (!Array.isArray(m.m) || m.m.length > 12))) return;
                for (const h of Array.isArray(m.hits) ? m.hits.slice(0, 20) : []) {
                    const target = room.players.get(h?.target);
                    if (target && target !== c && target.alive && (h.w === 'gun' || h.w === 'missile') && !(mode.teams && h.team === target.team)) {
                        send(target, MSG.BOT_FIRE, { dmg: Math.min(60, Math.max(0, +h.dmg || 0)), w: h.w, bot: String(h.bot ?? 'ACE').slice(0, 24), team: h.team === 0 || h.team === 1 ? h.team : null });
                    }
                }
                broadcast(room, MSG.BOT, { bots: m.bots, m: m.m, from: c.id }, c);
                break;
            }
            case MSG.BOT_DOWN:
                if (!mode.enemies || room.hostId !== c.id) return;
                broadcast(room, MSG.BOT_DOWN, { ...m, t: undefined, from: c.id }, c);
                if (mode.teams && (m.byTeam === 0 || m.byTeam === 1) && m.byTeam !== m.team && !m.gone) score(room, m.byTeam);
                break;
            case MSG.BOT_HIT: {
                const host = mode.enemies && room.players.get(room.hostId);
                if (host && host !== c && c.alive && typeof m.bot === 'string' && UNIT_WEAPONS.includes(m.w)) send(host, MSG.BOT_HIT, { from: c.id, bot: m.bot.slice(0, 16), dmg: Math.min(200, Math.max(0, +m.dmg || 0)), w: m.w });
                break;
            }
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

    /** tdm: one more kill for `team`; everyone gets the new score. */
    function score(room, team) {
        room.score[team]++;
        broadcast(room, MSG.SCORE, { score: room.score });
    }

    /** One server tick: respawns due, then one snapshot of every room. */
    function tick() {
        const now = Date.now();
        for (const room of rooms.values()) {
            room.tick++;
            for (const c of room.players.values()) if (!c.alive && now >= c.respawnAt) send(c, MSG.SPAWN, placeAtSpawn(c, true));
            const players = [...room.players.values()].map(c => ({ id: c.id, p: c.p, q: c.q, s: c.s, hp: c.hp, mh: c.mh ?? 100, f: c.alive ? c.f : 0, alive: c.alive }));
            const msg = encode(MSG.SNAP, { tick: room.tick, time: now, players });
            for (const c of room.players.values()) if (c.ws.readyState === c.ws.OPEN) c.ws.send(msg);
        }
    }

    wss.on('connection', ws => {
        const c = { id: nextId++, ws, room: null, name: 'Pilot', alive: true, heartbeat: true, connectedAt: Date.now(), budget: LIMITS.maxMsgPerSec, budgetAt: Date.now() };
        clients.add(c);
        ws.on('pong', () => { c.heartbeat = true; });
        ws.on('message', raw => {
            const now = Date.now();
            if (now - c.budgetAt >= 1000) { c.budget = LIMITS.maxMsgPerSec; c.budgetAt = now; }
            if (--c.budget < 0) return; // flood: drop silently
            const m = decode(raw);
            if (m) handle(c, m);
        });
        ws.on('close', () => { clients.delete(c); leave(c); });
        ws.on('error', () => {});
    });
    const tickTimer = setInterval(tick, 1000 / LIMITS.tickHz);
    const heartbeat = setInterval(() => {
        for (const c of clients) {
            // Missed a ping, or no HELLO within helloGraceMs (a slow device may still be building its world)
            if (!c.heartbeat || (!c.room && Date.now() - c.connectedAt > LIMITS.helloGraceMs)) { c.ws.terminate(); continue; }
            c.heartbeat = false;
            c.ws.ping();
        }
    }, LIMITS.heartbeatMs);

    return new Promise((done, fail) => {
        http.once('error', fail);
        http.listen(port, host, () => done({
            port: http.address().port,
            stats,
            close: () => new Promise(r => { clearInterval(tickTimer); clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); wss.close(); http.close(() => r()); }),
        }));
    });
}

const USAGE = `Usage: npm run mp-server -- [options]      (or: node server/server.mjs [options])

  --port <n>          port for the game and WebSocket (default ${DEFAULT_PORT}; env PORT)
  --host <addr>       127.0.0.1 = this computer only (default), 0.0.0.0 = whole network (env HOST)
  --tls               serve https:// with a self-signed certificate (made once, kept in ${CERT_DIR})
  --public <hosts>    comma-separated public IPs / names to put in that certificate, e.g. 88.156.90.62
  --tls-cert <file>   use your own certificate instead (PEM; with --tls-key; env TLS_CERT / TLS_KEY)
  --tls-key <file>
  --origins <list>    comma-separated extra page origins allowed to connect (env ALLOWED_ORIGINS)
  --help              show this help
Command-line options win over environment variables.`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let args;
    try {
        ({ values: args } = parseArgs({ options: {
            port: { type: 'string', short: 'p' }, host: { type: 'string' }, origins: { type: 'string' },
            tls: { type: 'boolean' }, public: { type: 'string' }, 'tls-cert': { type: 'string' }, 'tls-key': { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        } }));
    } catch (e) { console.error(`${e.message}\n\n${USAGE}`); process.exit(1); }
    if (args.help) { console.log(USAGE); process.exit(0); }
    const port = Number(args.port ?? process.env.PORT ?? DEFAULT_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error(`Invalid port "${args.port ?? process.env.PORT}" — use a number from 1 to 65535.`); process.exit(1); }
    const host = args.host ?? process.env.HOST ?? '127.0.0.1';
    const allowedOrigins = (args.origins ?? process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const publicHosts = (args.public ?? '').split(',').map(s => s.trim()).filter(Boolean);

    // TLS: own certificate files, or a reusable self-signed one
    let tls = null, tlsNote = '';
    const certFile = args['tls-cert'] ?? process.env.TLS_CERT, keyFile = args['tls-key'] ?? process.env.TLS_KEY;
    try {
        if (certFile || keyFile) {
            if (!certFile || !keyFile) throw new Error('--tls-cert and --tls-key go together');
            tls = { cert: await readFile(certFile, 'utf8'), key: await readFile(keyFile, 'utf8') };
            tlsNote = `certificate ${certFile}`;
        } else if (args.tls || publicHosts.length) {
            const c = await ensureSelfSignedCert(certHosts(publicHosts));
            tls = c;
            tlsNote = `self-signed certificate (${c.generated ? 'new' : 'reused'}): browsers warn once — Advanced → Proceed`;
        }
    } catch (e) { console.error(`TLS: ${e.message}`); process.exit(1); }

    let srv;
    try { srv = await startMpServer({ port, host, allowedOrigins, tls }); } catch (e) {
        console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use — stop the other program or choose another port: --port ${port + 1}`
            : e.code === 'EACCES' ? `No permission to use port ${port} — use a port above 1024, e.g. --port 8787` : e.message);
        process.exit(1);
    }
    const scheme = tls ? 'https' : 'http';
    const everywhere = host === '0.0.0.0' || host === '::';
    const lan = everywhere ? Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address) : [];
    const shown = everywhere ? 'localhost' : host;
    console.log([
        `VibePilot multiplayer server — ${scheme}, port ${srv.port}, ${everywhere ? 'reachable from your network' : `listening on ${host} only`}`,
        `  game:     ${scheme}://${shown}:${srv.port}/`,
        ...lan.map(ip => `  network:  ${scheme}://${ip}:${srv.port}/`),
        ...publicHosts.map(h => `  internet: ${scheme}://${h}/   (if your router forwards public port ${tls ? 443 : 80} to ${srv.port}; otherwise add :<public port>)`),
        `  health:   ${scheme}://${shown}:${srv.port}/health`,
        ...(tlsNote ? [`  tls:      ${tlsNote}`] : []),
        `  origins:  ${allowedOrigins.length ? `this host + ${allowedOrigins.join(', ')}` : 'any (use --origins to restrict)'}`,
        'Stop with Ctrl+C.',
    ].join('\n'));
    const stop = () => srv.close().then(() => process.exit(0));
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
