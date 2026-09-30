/**
 * Multiplayer client: connection, room membership, peer table and message hooks (see MULTIPLAYER.md).
 * Off unless the page is opened with ?mp — the single-player game never touches the network.
 *
 *   ?mp=tdm                connect to the server that served this page in that mode (tdm · pvp · coop · skies);
 *                          a bare ?mp means pvp. The multiplayer server sends its bare address here.
 *   ?mp=wss://host/        …or to another server (&mode= picks the mode then)
 *   &room=name             default "lobby"
 *   &name=Pilot            shown to other players; without it src/mp/ uses the remembered or a random callsign
 *
 * Joining a room whose map seed differs from ours reloads the page onto the room's seed, so everyone flies the
 * same world. Peers are updated from the server's room snapshots (SNAP); src/mp/ renders them.
 */
import { cleanName, cleanRoom, decode, DEFAULT_MODE, encode, LIMITS, MODES, MSG, PROTOCOL_VERSION } from './protocol.js';

const params = new URLSearchParams(location.search);
const sameHost = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/`;
const mpParam = params.get('mp');
const url = mpParam === null ? '' : /^wss?:\/\//.test(mpParam) ? mpParam : sameHost;
const modeParam = Object.hasOwn(MODES, params.get('mode')) ? params.get('mode') : Object.hasOwn(MODES, mpParam) ? mpParam : DEFAULT_MODE;

export const net = {
    enabled: !!url,
    url,
    mode: modeParam,
    room: cleanRoom(params.get('room')) || 'lobby',
    name: cleanName(params.get('name')),
    status: url ? 'connecting' : 'off', // off · connecting · online · error
    error: '',
    id: null,
    hostId: null,
    rtt: 0,           // ms
    peers: new Map(), // id → { id, name, slot, samples: [{ t, p, q, hp, alive }] (server time, oldest first) }
    clockOffset: Infinity, // min(local receive time − server time): local ms = server ms + clockOffset
};
export const isHost = () => net.status === 'online' && net.hostId === net.id;
/** Server time now, estimated from snapshot arrival (lowest observed delay). */
export const serverNow = () => performance.now() - net.clockOffset;

const handlers = new Map();
/** Subscribe to a message type (MSG.*) or a lifecycle event: 'online', 'offline', 'peer-join', 'peer-leave', 'status'. */
export function onNet(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); }
const emit = (type, m) => handlers.get(type)?.forEach(fn => fn(m));

let ws = null, retry = 0, retryTimer = 0, pingTimer = 0, rejected = false;
const MAX_SAMPLES = 30; // 1.5 s of snapshots per peer

export function netSend(t, data) {
    if (ws?.readyState === WebSocket.OPEN && net.status === 'online') ws.send(encode(t, data));
}

function setStatus(status, error = '') { net.status = status; net.error = error; emit('status', net); }

function connect() {
    setStatus('connecting', retry ? `reconnecting (${retry})…` : '');
    try { ws = new WebSocket(url); } catch { fail(`bad server URL: ${url}`); return; }
    ws.onopen = () => ws.send(encode(MSG.HELLO, { v: PROTOCOL_VERSION, mode: net.mode, room: net.room, name: net.name, seed: window.__vpSeed }));
    ws.onmessage = e => { const m = decode(e.data); if (m) receive(m); };
    ws.onclose = () => {
        const was = net.status;
        ws = null; net.id = null; net.peers.clear();
        if (was === 'online') emit('offline');
        if (rejected) return;
        retry++;
        setStatus('connecting', `reconnecting (${retry})…`);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(retry, 5)));
    };
}
function fail(reason) { rejected = true; setStatus('error', reason); }

const addPeer = p => net.peers.set(p.id, { id: p.id, name: p.name, slot: p.slot, team: p.team ?? null, samples: [] });

function receive(m) {
    switch (m.t) {
        case MSG.WELCOME:
            if (m.seed !== window.__vpSeed) { // join the room's map
                const u = new URL(location.href);
                u.searchParams.set('seed', m.seed);
                if (document.getElementById('start-menu')?.hidden) u.searchParams.set('autostart', ''); // already flying: don't show the menu again
                rejected = true; // no reconnect from this page while it unloads
                location.replace(u.href);
                return;
            }
            Object.assign(net, { id: m.id, hostId: m.hostId, team: m.team ?? null, score: m.score ?? [0, 0], stats: m.stats ?? {} });
            retry = 0;
            m.players.forEach(addPeer);
            setStatus('online');
            emit('online', m);
            break;
        case MSG.REJECT: fail(m.reason); break;
        case MSG.JOIN: addPeer(m); emit('peer-join', m); break;
        case MSG.LEAVE: { const p = net.peers.get(m.id); net.peers.delete(m.id); emit('peer-leave', p || m); break; }
        case MSG.HOST: net.hostId = m.hostId; break;
        case MSG.SCORE: if (Array.isArray(m.score)) net.score = m.score; if (m.stats && typeof m.stats === 'object') net.stats = m.stats; break;
        case MSG.PONG: net.rtt = Math.round(performance.now() - m.c); emit('status', net); break;
        case MSG.SNAP: {
            net.clockOffset = Math.min(net.clockOffset + 0.05, performance.now() - m.time); // +0.05 ms/tick: follow slow clock drift
            for (const s of m.players) {
                const peer = net.peers.get(s.id);
                if (!peer) continue; // ourselves, or a player we have not heard JOIN for yet
                const last = peer.samples[peer.samples.length - 1];
                if (last && last.t >= m.time) continue;
                peer.samples.push({ t: m.time, p: s.p, q: s.q, s: s.s, hp: s.hp, mh: s.mh, f: s.f, alive: s.alive });
                if (peer.samples.length > MAX_SAMPLES) peer.samples.shift();
            }
            break;
        }
    }
    emit(m.t, m);
}

let stateTimer = 0;
/** Per rendered frame (src/mp/index.js): report the local plane while flying, keep the ping going. */
export function updateNet(rawDelta, report) {
    if (net.status !== 'online') return;
    stateTimer -= rawDelta; pingTimer -= rawDelta;
    if (stateTimer <= 0) { stateTimer = 1 / LIMITS.stateHz; const s = report(); if (s) netSend(MSG.STATE, s); }
    if (pingTimer <= 0) { pingTimer = 2; netSend(MSG.PING, { c: performance.now() }); }
}

export function startNet() { if (net.enabled) connect(); }
