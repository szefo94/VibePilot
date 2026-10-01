// Multiplayer server tests (server/server.mjs + src/net/protocol.js). No browser needed.
//   npm run test:mp
import { WebSocket } from 'ws';
import { startMpServer } from '../server/server.mjs';
import { LIMITS, MSG, PROTOCOL_VERSION, PVP_DAMAGE, RESPAWN, encode, spawnSlot, teamSpawn } from '../src/net/protocol.js';

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
check('servesGame', await status('/') === 200 && await status('/src/main.js') === 200 && await status('/three.module.min.js') === 200);
const bare = await fetch(`${HTTP}/?room=x`, { redirect: 'manual' });
check('bareAddressOpensMultiplayer', bare.status === 302 && bare.headers.get('location') === '/?room=x&mp=tdm', bare.headers.get('location'));
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
a.ws.send(encode(MSG.STATE, { p: [sx, sy, sz + 8], q: [0, 0, 0, 1], s: 0.5, hp: 90, f: 7 }));
await wait(120);
check('laserFlagInSnap', inSnap(b, a.first.id)?.f === 3); // gun + laser; unknown bits dropped
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
// Shared enemies (pvp/coop rooms): hits relayed, totals kept for late joiners; notifications relayed with sender
p1.ws.send(encode(MSG.UNIT_HIT, { n: 'g12', dmg: 15, w: 'bullet' }));
p1.ws.send(encode(MSG.UNIT_HIT, { n: 'g12', dmg: 5, w: 'bullet' }));
p1.ws.send(encode(MSG.UNIT_HIT, { n: 'a3', dmg: 80, w: 'missile' }));
p1.ws.send(encode(MSG.UNIT_HIT, { n: '../x', dmg: 5, w: 'bullet' }));   // bad id
p1.ws.send(encode(MSG.UNIT_HIT, { n: 'g1', dmg: 5, w: 'laser' }));      // bad weapon
p1.ws.send(encode(MSG.EVENT, { text: '★ Orion Constellation — COMPLETE', hl: true }));
a.ws.send(encode(MSG.UNIT_HIT, { n: 'g1', dmg: 5, w: 'bullet' }));      // skies room: no enemies
await wait(80);
check('unitHitRelayed', got(p2, MSG.UNIT_HIT).length === 3 && got(p2, MSG.UNIT_HIT)[0].from === p1.first.id && got(p1, MSG.UNIT_HIT).length === 0 && got(b, MSG.UNIT_HIT).length === 0);
const late = await client({ mode: 'pvp', room: 'duel', name: 'Late' });
check('lateJoinerGetsDamageLog', late.first.units?.g12?.bullet === 20 && late.first.units?.a3?.missile === 80 && Object.keys(late.first.units).length === 2, late.first.units);
check('eventRelayed', got(p2, MSG.EVENT)[0]?.text === '★ Orion Constellation — COMPLETE' && got(p2, MSG.EVENT)[0]?.from === p1.first.id && got(p2, MSG.EVENT)[0]?.hl === true);
check('pvpHasHost', p1.first.hostId === p1.first.id);
late.ws.close();
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
// Aces (bots): the host shares them and reports their hits; guests' hits on them go to the host only
g.ws.send(encode(MSG.BOT, { bots: [] }));                                                    // not the host: dropped
h.ws.send(encode(MSG.BOT, { bots: [{ id: 'b1', name: 'Licho', p: [0, 100, 0], q: [0, 0, 0, 1], hp: 90 }], m: [] }));
h.ws.send(encode(MSG.BOT, { bots: new Array(13).fill({ id: 'b2' }) }));                      // too many: dropped
g.ws.send(encode(MSG.BOT_HIT, { bot: 'b1', dmg: 999, w: 'missile' }));
g.ws.send(encode(MSG.BOT_HIT, { bot: 'b1', dmg: 5, w: 'laser' }));                            // unknown weapon
h.ws.send(encode(MSG.BOT, { bots: [], hits: [{ target: g.first.id, dmg: 500, w: 'gun', bot: 'ACE Licho' }] }));
g.ws.send(encode(MSG.BOT, { bots: [], hits: [{ target: g2.first.id, dmg: 5, w: 'gun', bot: 'ACE Licho' }] }));  // not the host
h.ws.send(encode(MSG.BOT_DOWN, { bot: 'b1', name: 'Licho', by: g.first.id, xp: 400 }));
await wait(80);
check('botFromHostOnly', got(g2, MSG.BOT).length === 2 && got(g2, MSG.BOT)[0].bots[0].name === 'Licho' && !('hits' in got(g2, MSG.BOT)[1]) && got(h, MSG.BOT).length === 0);
check('botHitToHost', got(h, MSG.BOT_HIT).length === 1 && got(h, MSG.BOT_HIT)[0].dmg === 200 && got(h, MSG.BOT_HIT)[0].from === g.first.id && got(g2, MSG.BOT_HIT).length === 0);
check('botFireToTarget', got(g, MSG.BOT_FIRE).length === 1 && got(g, MSG.BOT_FIRE)[0].dmg === 60 && got(g2, MSG.BOT_FIRE).length === 0);
check('botDownBroadcast', got(g2, MSG.BOT_DOWN)[0]?.by === g.first.id && got(g, MSG.BOT_DOWN).length === 1);
// Freaky mode plot: the host's quest, boss and spawned units go to everyone (kept for late joiners); guests' boss hits and minion actions go to the host
g.ws.send(encode(MSG.QUEST, { q: { title: 'Fake' } }));                                      // not the host: dropped
h.ws.send(encode(MSG.QUEST, { q: { title: 'Black Water', step: 0 }, event: 'start', xp: 99999 }));
h.ws.send(encode(MSG.UNIT_SPAWN, { id: 'g5000', spec: { type: 'tank', x: 1, z: 2 } }));
h.ws.send(encode(MSG.UNIT_SPAWN, { id: 'bad id!', spec: { type: 'tank' } }));                 // bad id: dropped
h.ws.send(encode(MSG.BOSS, { s: { kind: 'kraken', hp: 900 }, fx: [], m: [[1, 'squid', 0, 0, 0, 1, g.first.id]], ev: ['spawn'], hits: [{ target: g.first.id, dmg: 3, w: 'bite', bot: 'PARASITE' }, { target: g.first.id, dmg: 3, w: 'laser' }] }));
g.ws.send(encode(MSG.BOSS_HIT, { dmg: 9999, w: 'missile' }));
g.ws.send(encode(MSG.MINION_ACT, { hit: 1 }));
g.ws.send(encode(MSG.MINION_ACT, { shake: true }));
await wait(80);
check('questFromHostOnly', got(g2, MSG.QUEST).length === 1 && got(g2, MSG.QUEST)[0].q.title === 'Black Water' && got(g2, MSG.QUEST)[0].xp === 5000 && got(h, MSG.QUEST).length === 0, got(g2, MSG.QUEST));
check('unitSpawnRelayed', got(g2, MSG.UNIT_SPAWN).length === 1 && got(g2, MSG.UNIT_SPAWN)[0].spec.type === 'tank');
check('bossRelayed', got(g2, MSG.BOSS)[0]?.s?.kind === 'kraken' && got(g2, MSG.BOSS)[0].m.length === 1 && !('hits' in got(g2, MSG.BOSS)[0]) && got(h, MSG.BOSS).length === 0);
check('bossHitsToTarget', got(g, MSG.BOT_FIRE).filter(f => f.w === 'bite').length === 1 && got(g, MSG.BOT_FIRE).length === 2 && got(g2, MSG.BOT_FIRE).length === 0);
check('bossHitToHost', got(h, MSG.BOSS_HIT)[0]?.dmg === 300 && got(h, MSG.BOSS_HIT)[0].from === g.first.id && got(g2, MSG.BOSS_HIT).length === 0);
check('minionActToHost', got(h, MSG.MINION_ACT).length === 2 && got(h, MSG.MINION_ACT)[0].hit === 1 && got(h, MSG.MINION_ACT)[1].shake === true && got(h, MSG.MINION_ACT)[1].from === g.first.id);
const g3 = await client({ mode: 'coop', room: 'war', name: 'Late' });
check('plotForLateJoiner', g3.first.quest?.title === 'Black Water' && g3.first.spawns?.length === 1 && g3.first.spawns[0].id === 'g5000', { q: g3.first.quest, s: g3.first.spawns });
g3.ws.close();
// Console map: the first player is asked for the relief; a bad grid is dropped, a good one kept; the map shows players and the boss
check('needMapAsked', h.first.needMap === true && g3.first.needMap === true);
g.ws.send(encode(MSG.MAP, { w: 4, h: 2, rows: ['~~..', 'X~~~'] }));                           // bad character: dropped
g.ws.send(encode(MSG.MAP, { w: 8, h: 4, rows: ['~~~~~~~~', '~~..::~~', '~~:^#:~~', '~~~~~~~~'] }));
h.ws.send(encode(MSG.BOSS, { s: { kind: 'kraken', p: [-1800, 0, 1800] }, fx: [], m: [], ev: [] })); // north-east corner
await wait(80);
const g4 = await client({ mode: 'coop', room: 'war', name: 'Later' });
const mv = srv.mapView(0, { cols: 100, rows: 40, colour: false });
const busiest = mv.lines[0].includes('coop:war');
check('mapKeptAndRendered', g4.first.needMap === false && busiest && mv.lines.length === 5 && mv.lines.some(l => l.includes('^')) && /boss kraken/.test(mv.lines[0]) && mv.lines[1].trimEnd().endsWith('@'), mv.lines);
g4.ws.close();
h.ws.close();
await wait(100);
check('hostHandover', got(g, MSG.HOST)[0]?.hostId === g.first.id);

// Team deathmatch: balanced teams, team spawns, no friendly fire, the server keeps the score
const r1 = await client({ mode: 'tdm', room: 'war', name: 'Red1' });
const b1 = await client({ mode: 'tdm', room: 'war', name: 'Blue1' });
const r2 = await client({ mode: 'tdm', room: 'war', name: 'Red2' });
check('tdmTeams', r1.first.team === 0 && b1.first.team === 1 && r2.first.team === 0 && b1.first.players.find(p => p.id === r1.first.id)?.team === 0 && got(r1, MSG.JOIN)[0]?.team === 1, [r1.first.team, b1.first.team, r2.first.team]);
check('tdmSpawns', JSON.stringify(r1.first.spawn) === JSON.stringify(teamSpawn(0, 0)) && JSON.stringify(b1.first.spawn) === JSON.stringify(teamSpawn(1, 0)) && JSON.stringify(r2.first.spawn) === JSON.stringify(teamSpawn(0, 1)) && r1.first.spawn.p[2] < 0 && b1.first.spawn.p[2] > 0);
check('tdmScoreInWelcome', JSON.stringify(r1.first.score) === '[0,0]');
r1.ws.send(encode(MSG.HIT, { target: r2.first.id, dmg: 4, w: 'bullet' }));   // teammate: dropped
r1.ws.send(encode(MSG.HIT, { target: b1.first.id, dmg: 4, w: 'bullet' }));   // enemy: delivered
await wait(80);
check('tdmNoFriendlyFire', got(r2, MSG.HIT).length === 0 && got(b1, MSG.HIT).length === 1);
b1.ws.send(encode(MSG.DOWN, { by: r1.first.id }));                           // Red scores
r2.ws.send(encode(MSG.DOWN, { by: null, byTeam: 1, bot: 'Viper' }));         // shot down by a Blue bot: Blue scores
await wait(80);
check('tdmScore', JSON.stringify(got(r1, MSG.SCORE).at(-1)?.score) === '[1,1]' && got(b1, MSG.DOWN).find(d => d.id === r2.first.id)?.bot === 'Viper', got(r1, MSG.SCORE));
r1.ws.send(encode(MSG.BOT_DOWN, { bot: 'r3', name: 'Hawk', team: 1, by: r1.first.id, byTeam: 0, xp: 100 })); // host (first in) reports a bot kill
b1.ws.send(encode(MSG.BOT_DOWN, { bot: 'r4', name: 'Hawk', team: 0, byTeam: 1 }));                          // not the host: dropped
await wait(80);
check('tdmBotKillScores', JSON.stringify(got(b1, MSG.SCORE).at(-1)?.score) === '[2,1]' && got(b1, MSG.BOT_DOWN).length === 1);
{
    const st = got(r2, MSG.SCORE).at(-1)?.stats ?? {};
    check('tdmKillsDeaths', st[`p${r1.first.id}`]?.k === 2 && st[`p${b1.first.id}`]?.d === 1 && st[`p${r2.first.id}`]?.d === 1
        && st['b:Viper']?.k === 1 && st['b:Viper']?.team === 1 && st['b:Hawk']?.d === 1 && st['b:Hawk']?.team === 1, st);
}

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
{
    const list = (await (await fetch(`${HTTP}/rooms`)).json()).rooms;
    const byKey = k => list.find(r => `${r.mode}:${r.room}` === k);
    check('roomsListDefaults', ['tdm', 'pvp', 'coop', 'skies'].every(m => byKey(`${m}:lobby`)?.isDefault), list.map(r => `${r.mode}:${r.room}`));
    check('roomsListCounts', byKey('tdm:war')?.players === 3 && byKey('tdm:war')?.bots === 7 && byKey('tdm:war')?.running && byKey('pvp:lobby')?.running === false && byKey('pvp:lobby')?.players === 0, byKey('tdm:war'));
}
check('health', srv.stats().players === 2 + 3 + 2 + 3 + LIMITS.maxPlayers, srv.stats().players);

for (const c of [a, b, p1, p2, p3, g, g2, r1, b1, r2, ...crowd]) c.ws.close();
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
