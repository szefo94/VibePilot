// Multiplayer server tests (server/server.mjs + src/net/protocol.js). No browser needed.
//   npm run test:mp
import { WebSocket } from 'ws';
import { startMpServer } from '../server/server.mjs';
import { LIMITS, MSG, PROTOCOL_VERSION, PVP_DAMAGE, RESPAWN, encode, spawnSlot } from '../src/net/protocol.js';

const srv = await startMpServer({ port: 0, log: () => {} });
const WS = `ws://127.0.0.1:${srv.port}`, HTTP = `http://127.0.0.1:${srv.port}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== '' ? ' ' + JSON.stringify(info) : ''}`); if (!ok) failures++; };

/** Connect and say hello; resolves with { ws, inbox, first } once WELCOME or REJECT arrives. */
function client(hello) {
    return new Promise(done => {
        const ws = new WebSocket(WS), inbox = [];
        ws.on('message', raw => {
            const m = JSON.parse(raw); inbox.push(m);
            if (m.t === MSG.WELCOME || m.t === MSG.REJECT) done({ ws, inbox, first: m });
        });
        ws.on('open', () => ws.send(encode(MSG.HELLO, { v: PROTOCOL_VERSION, mode: 'skies', room: 'test', name: 'A', seed: 111, ...hello })));
    });
}
const got = (c, t) => c.inbox.filter(m => m.t === t);
const lastSnap = c => got(c, MSG.SNAP).at(-1);
const inSnap = (c, id) => lastSnap(c)?.players.find(p => p.id === id);

// Static game files: only the public ones
const status = async path => (await fetch(HTTP + path)).status;
check('servesGame', await status('/') === 200 && await status('/src/main.js') === 200 && await status('/three.min.js') === 200);
const bare = await fetch(`${HTTP}/?room=x`, { redirect: 'manual' });
check('bareAddressOpensMultiplayer', bare.status === 302 && bare.headers.get('location') === '/?room=x&mp=', bare.headers.get('location'));
check('singlePlayerOptOut', (await fetch(`${HTTP}/?sp`, { redirect: 'manual' })).status === 200);
check('hidesPrivate', await status('/package.json') === 404 && await status('/server/server.mjs') === 404 && await status('/.git/config') === 404 && await status('/src/../package.json') === 404);

// Rooms, seeds, spawn slots
const a = await client({ name: 'Alpha', seed: 111 });
const b = await client({ name: 'Bravo', seed: 222 });
check('welcome', a.first.t === MSG.WELCOME && a.first.seed === 111 && a.first.slot === 0 && a.first.players.length === 0);
check('roomSeed', b.first.seed === 111 && b.first.players[0]?.name === 'Alpha', b.first.seed);
check('spawnSlots', b.first.slot === 1 && JSON.stringify(b.first.spawn) === JSON.stringify(spawnSlot(1)), b.first.spawn);
await wait(120);
check('joinBroadcast', got(a, MSG.JOIN)[0]?.name === 'Bravo' && got(a, MSG.JOIN)[0]?.slot === 1);

// Server-owned state: reports are validated, then everyone gets one snapshot per tick
check('snapshots', got(a, MSG.SNAP).length >= 1 && lastSnap(a).players.length === 2 && typeof lastSnap(a).time === 'number');
const [sx, sy, sz] = spawnSlot(0).p;
a.ws.send(encode(MSG.STATE, { p: [sx, sy, sz + 5], q: [0, 0, 0, 1], s: 0.5, hp: 90 }));
await wait(120);
check('stateAccepted', inSnap(b, a.first.id)?.p[2] === sz + 5 && inSnap(b, a.first.id)?.hp === 90, inSnap(b, a.first.id));
check('noDirectRelay', got(b, MSG.STATE).length === 0);
for (let i = 0; i < 3; i++) a.ws.send(encode(MSG.STATE, { p: [sx + 900, sy, sz], q: [0, 0, 0, 1], s: 0.5, hp: 90 })); // teleport
await wait(120);
check('teleportRejected', inSnap(b, a.first.id)?.p[0] === sx, inSnap(b, a.first.id)?.p);
check('correctSent', got(a, MSG.CORRECT)[0]?.p[2] === sz + 5, got(a, MSG.CORRECT));
a.ws.send(encode(MSG.STATE, { p: [sx, sy, 99999], q: [0, 0, 0, 1] }));
await wait(80);
check('outOfBoundsRejected', inSnap(b, a.first.id)?.p[2] === sz + 5);

// Shots for the others' screens: the gun flag rides in snapshots; FIRE is checked and relayed
a.ws.send(encode(MSG.STATE, { p: [sx, sy, sz + 8], q: [0, 0, 0, 1], s: 0.5, hp: 90, f: 1 }));
await wait(120);
check('gunFlagInSnap', inSnap(b, a.first.id)?.f === 1);
a.ws.send(encode(MSG.FIRE, { w: 'missile', p: [sx - 5, sy, sz + 8], p2: [sx + 5, sy, sz + 8], d: [0, 0, 1], tg: b.first.id }));
a.ws.send(encode(MSG.FIRE, { w: 'nuke', p: [sx, sy, sz + 8] }));          // unknown weapon
a.ws.send(encode(MSG.FIRE, { w: 'flare', p: [sx + 500, sy, sz] }));       // far from the shooter
a.ws.send(encode(MSG.FIRE, { w: 'flare', p: [sx, sy, sz + 8], tg: 999 })); // unknown target is dropped, shot kept
await wait(80);
const fires = got(b, MSG.FIRE);
check('fireRelayed', fires.length === 2 && fires[0].w === 'missile' && fires[0].from === a.first.id && fires[0].tg === b.first.id && fires[0].p2 && fires[1].w === 'flare' && !('tg' in fires[1]) && got(a, MSG.FIRE).length === 0, fires);

// Life: DOWN → dead in snapshots → SPAWN at the slot after respawnMs, alive again
b.ws.send(encode(MSG.DOWN, {}));
await wait(120);
check('downInSnap', inSnap(a, b.first.id)?.alive === false);
b.ws.send(encode(MSG.STATE, { p: [0, 0, 0], q: [0, 0, 0, 1] }));
await wait(LIMITS.respawnMs);
const sp = got(b, MSG.SPAWN)[0], slot1 = spawnSlot(1).p, dist = sp && Math.hypot(sp.p[0] - slot1[0], sp.p[2] - slot1[2]);
check('respawnNearSlot', got(b, MSG.SPAWN).length === 1 && dist >= RESPAWN.min - 0.1 && dist <= RESPAWN.max + 0.1 && sp.p[1] >= RESPAWN.minY && sp.p[1] <= RESPAWN.maxY && inSnap(a, b.first.id)?.alive === true, { dist, y: sp?.p[1] });
check('downBroadcast', got(a, MSG.DOWN)[0]?.id === b.first.id && got(a, MSG.DOWN)[0]?.by === null);

// PvP hits are skies no-ops, routed to the target in pvp
a.ws.send(encode(MSG.HIT, { target: b.first.id, dmg: 10 }));
const p1 = await client({ mode: 'pvp', room: 'duel', name: 'P1' });
const p2 = await client({ mode: 'pvp', room: 'duel', name: 'P2' });
const p3 = await client({ mode: 'pvp', room: 'duel', name: 'P3' });
p1.ws.send(encode(MSG.HIT, { target: p2.first.id, dmg: 999, w: 'bullet' }));
p1.ws.send(encode(MSG.HIT, { target: p2.first.id, dmg: 30, w: 'laser' })); // unknown weapon: dropped
await wait(80);
check('skiesNoHits', got(b, MSG.HIT).length === 0);
check('pvpHitRouted', got(p2, MSG.HIT).length === 1 && got(p2, MSG.HIT)[0].dmg === PVP_DAMAGE.bullet && got(p2, MSG.HIT)[0].from === p1.first.id && got(p3, MSG.HIT).length === 0, got(p2, MSG.HIT));
p2.ws.send(encode(MSG.DOWN, { by: p1.first.id }));
await wait(80);
check('killCredit', got(p1, MSG.DOWN)[0]?.id === p2.first.id && got(p1, MSG.DOWN)[0]?.by === p1.first.id && got(p3, MSG.DOWN)[0]?.by === p1.first.id);
p1.ws.send(encode(MSG.HIT, { target: p2.first.id, dmg: 4, w: 'bullet' }));
await wait(80);
check('noHitsOnTheDead', got(p2, MSG.HIT).length === 1);

// Co-op host tracking and handover
const h = await client({ mode: 'coop', room: 'war', name: 'Host' });
const g = await client({ mode: 'coop', room: 'war', name: 'Guest' });
const g2 = await client({ mode: 'coop', room: 'war', name: 'Guest2' });
check('coopHost', h.first.hostId === h.first.id && g.first.hostId === h.first.id);
g.ws.send(encode(MSG.WORLD, { tick: 1, units: [] }));
h.ws.send(encode(MSG.WORLD, { tick: 2, units: [] }));
g.ws.send(encode(MSG.ACTION, { kind: 'damage', unit: 'u1' }));
await wait(80);
check('worldFromHostOnly', got(g2, MSG.WORLD).length === 1 && got(g2, MSG.WORLD)[0].tick === 2);
check('actionToHost', got(h, MSG.ACTION)[0]?.unit === 'u1' && got(g2, MSG.ACTION).length === 0);
h.ws.close();
await wait(100);
check('hostHandover', got(g, MSG.HOST)[0]?.hostId === g.first.id);

// Limits and validation
const wrongVersion = await client({ v: 1, room: 'x' });
const badRoom = await client({ room: '../etc' });
check('rejects', wrongVersion.first.t === MSG.REJECT && badRoom.first.t === MSG.REJECT);
const crowd = [];
for (let i = 0; i < LIMITS.maxPlayers; i++) crowd.push(await client({ room: 'full', name: `C${i}` }));
const extra = await client({ room: 'full' });
check('roomCap', extra.first.t === MSG.REJECT && extra.first.reason === 'room full' && new Set(crowd.map(c => c.first.slot)).size === LIMITS.maxPlayers);
const pong = new Promise(r => a.ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === MSG.PONG) r(m); }));
a.ws.send(encode(MSG.PING, { c: 42 }));
check('ping', (await pong).c === 42);
check('health', srv.stats().players === 2 + 3 + 2 + LIMITS.maxPlayers, srv.stats().players);

for (const c of [a, b, p1, p2, p3, g, g2, ...crowd]) c.ws.close();
await wait(150);
check('roomsCleanedUp', srv.stats().rooms.length === 0, srv.stats().rooms);
await srv.close();

// TLS: https:// page and wss:// connection with a self-signed certificate
const { default: selfsigned } = await import('selfsigned');
const pems = await selfsigned.generate([{ name: 'commonName', value: 'test' }], { keySize: 2048, algorithm: 'sha256' });
const tlsSrv = await startMpServer({ port: 0, log: () => {}, tls: { cert: pems.cert, key: pems.private } });
const tlsWelcome = await new Promise((done, fail) => {
    const ws = new WebSocket(`wss://127.0.0.1:${tlsSrv.port}`, { rejectUnauthorized: false });
    ws.on('open', () => ws.send(encode(MSG.HELLO, { v: PROTOCOL_VERSION, mode: 'skies', room: 'tls', name: 'T', seed: 7 })));
    ws.on('message', raw => { ws.close(); done(JSON.parse(raw)); });
    ws.on('error', fail);
});
check('tlsWss', tlsWelcome.t === MSG.WELCOME && tlsWelcome.seed === 7);
await tlsSrv.close();
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
