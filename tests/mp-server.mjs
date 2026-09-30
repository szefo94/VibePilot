// Multiplayer relay tests (server/server.mjs + src/net/protocol.js). No browser needed.
//   npm run test:mp
import { WebSocket } from 'ws';
import { startMpServer } from '../server/server.mjs';
import { LIMITS, MSG, PROTOCOL_VERSION, encode } from '../src/net/protocol.js';

const srv = await startMpServer({ port: 0, log: () => {} });
const URL_ = `ws://127.0.0.1:${srv.port}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' ' + JSON.stringify(info) : ''}`); if (!ok) failures++; };

/** Connect and say hello; resolves with { ws, inbox, welcome|reject }. */
function client(hello) {
    return new Promise(done => {
        const ws = new WebSocket(URL_), inbox = [];
        ws.on('message', raw => {
            const m = JSON.parse(raw); inbox.push(m);
            if (m.t === MSG.WELCOME || m.t === MSG.REJECT) done({ ws, inbox, first: m });
        });
        ws.on('open', () => ws.send(encode(MSG.HELLO, { v: PROTOCOL_VERSION, mode: 'skies', room: 'test', name: 'A', seed: 111, ...hello })));
    });
}
const got = (c, t) => c.inbox.filter(m => m.t === t);
const state = { p: [1, 2, 3], q: [0, 0, 0, 1], s: 0.5, hp: 100 };

// Rooms and seeds: the first player's seed is the room's
const a = await client({ name: 'Alpha', seed: 111 });
const b = await client({ name: 'Bravo', seed: 222 });
check('welcome', a.first.t === MSG.WELCOME && a.first.seed === 111 && a.first.players.length === 0);
check('roomSeed', b.first.seed === 111 && b.first.players[0]?.name === 'Alpha', b.first);
await wait(50);
check('joinBroadcast', got(a, MSG.JOIN)[0]?.name === 'Bravo');

// Relay: STATE reaches others with `from`, never echoes; malformed is dropped
a.ws.send(encode(MSG.STATE, state));
a.ws.send(encode(MSG.STATE, { p: [1, 2], q: [0, 0, 0, 1] }));
await wait(80);
check('stateRelay', got(b, MSG.STATE).length === 1 && got(b, MSG.STATE)[0].from === a.first.id && got(a, MSG.STATE).length === 0);

// PvP hits are skies-only no-ops, routed to the target in pvp
a.ws.send(encode(MSG.HIT, { target: b.first.id, dmg: 10 }));
const p1 = await client({ mode: 'pvp', room: 'duel', name: 'P1' });
const p2 = await client({ mode: 'pvp', room: 'duel', name: 'P2' });
const p3 = await client({ mode: 'pvp', room: 'duel', name: 'P3' });
p1.ws.send(encode(MSG.HIT, { target: p2.first.id, dmg: 999, w: 'gun' }));
await wait(80);
check('skiesNoHits', got(b, MSG.HIT).length === 0);
check('pvpHitRouted', got(p2, MSG.HIT)[0]?.dmg === 100 && got(p2, MSG.HIT)[0]?.from === p1.first.id && got(p3, MSG.HIT).length === 0, got(p2, MSG.HIT));

// Co-op: first joiner is host; WORLD only from host; ACTION goes to host; host hand-over on leave
const h = await client({ mode: 'coop', room: 'war', name: 'Host' });
const g = await client({ mode: 'coop', room: 'war', name: 'Guest' });
const g2 = await client({ mode: 'coop', room: 'war', name: 'Guest2' });
check('coopHost', h.first.hostId === h.first.id && g.first.hostId === h.first.id);
g.ws.send(encode(MSG.WORLD, { tick: 1, units: [] }));       // not host: ignored
h.ws.send(encode(MSG.WORLD, { tick: 2, units: [{ id: 'u1', hp: 5 }] }));
g.ws.send(encode(MSG.ACTION, { kind: 'damage', unit: 'u1', dmg: 3 }));
await wait(80);
check('worldFromHostOnly', got(g2, MSG.WORLD).length === 1 && got(g2, MSG.WORLD)[0].tick === 2);
check('actionToHost', got(h, MSG.ACTION)[0]?.unit === 'u1' && got(g2, MSG.ACTION).length === 0);
h.ws.close();
await wait(100);
check('hostHandover', got(g, MSG.HOST)[0]?.hostId === g.first.id && got(g2, MSG.LEAVE).length === 1);

// Limits and validation
const wrongVersion = await client({ v: 0, room: 'x' });
const badRoom = await client({ room: '../etc' });
check('rejects', wrongVersion.first.t === MSG.REJECT && badRoom.first.t === MSG.REJECT);
const crowd = [];
for (let i = 0; i < LIMITS.maxPlayers; i++) crowd.push(await client({ room: 'full', name: `C${i}` }));
const extra = await client({ room: 'full' });
check('roomCap', extra.first.t === MSG.REJECT && extra.first.reason === 'room full');
const pong = new Promise(r => a.ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === MSG.PONG) r(m); }));
a.ws.send(encode(MSG.PING, { c: 42 }));
check('ping', (await pong).c === 42);
for (let i = 0; i < LIMITS.maxMsgPerSec * 2; i++) a.ws.send(encode(MSG.STATE, state));
await wait(150);
const floodSeen = got(b, MSG.STATE).length - 1;
check('floodCapped', floodSeen <= LIMITS.maxMsgPerSec, { floodSeen });
check('health', srv.stats().players === 2 + 3 + 2 + LIMITS.maxPlayers, srv.stats());

for (const c of [a, b, p1, p2, p3, g, g2, ...crowd]) c.ws.close();
await wait(100);
check('roomsCleanedUp', srv.stats().rooms.length === 0, srv.stats().rooms);
await srv.close();
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
