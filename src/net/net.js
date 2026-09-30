/**
 * Multiplayer client: connection, room membership, peer table and message hooks (see MULTIPLAYER.md).
 * Off unless the page is opened with ?mp — the single-player game never touches the network.
 *
 *   ?mp=wss://host/        relay server (?mp alone uses MP_SERVER_URL from config.js)
 *   &mode=skies|pvp|coop   default skies
 *   &room=name             default "lobby"
 *   &name=Pilot            shown to other players
 *
 * Joining a room whose map seed differs from ours reloads the page onto the room's seed, so everyone flies the
 * same world. Gameplay systems subscribe with onNet(type, fn) and send with netSend(); this module streams the
 * local plane (STATE) itself at LIMITS.stateHz.
 */
import { MP_SERVER_URL } from '../config.js';
import { LIMITS, MODES, MSG, PROTOCOL_VERSION, cleanName, cleanRoom, decode, encode } from './protocol.js';
import { state } from '../state.js';
import { plane } from '../player/plane.js';

const params = new URLSearchParams(location.search);
const url = params.has('mp') ? (params.get('mp') || MP_SERVER_URL) : '';
const statusEl = document.getElementById('net-status');

export const net = {
    enabled: !!url,
    mode: Object.hasOwn(MODES, params.get('mode')) ? params.get('mode') : 'skies',
    room: cleanRoom(params.get('room')) || 'lobby',
    name: cleanName(params.get('name')),
    status: url ? 'connecting' : 'off', // off · connecting · online · error
    error: '',
    id: null,
    hostId: null,
    rtt: 0,          // ms
    peers: new Map(), // id → { id, name, state: last STATE message | null, at: performance.now() of it }
};
export const isHost = () => net.status === 'online' && net.hostId === net.id;
export const modeInfo = () => MODES[net.mode];

const handlers = new Map();
/** Subscribe to a message type (MSG.*) or a lifecycle event: 'online', 'offline', 'peer-join', 'peer-leave'. */
export function onNet(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); }
const emit = (type, m) => handlers.get(type)?.forEach(fn => fn(m));

let ws = null, retry = 0, retryTimer = 0, stateTimer = 0, pingTimer = 0, rejected = false;

export function netSend(t, data) {
    if (ws?.readyState === WebSocket.OPEN && net.status === 'online') ws.send(encode(t, data));
}

function connect() {
    net.status = 'connecting'; renderStatus();
    try { ws = new WebSocket(url); } catch (e) { fail(`bad server URL: ${url}`); return; }
    ws.onopen = () => ws.send(encode(MSG.HELLO, { v: PROTOCOL_VERSION, mode: net.mode, room: net.room, name: net.name, seed: window.__vpSeed }));
    ws.onmessage = e => { const m = decode(e.data); if (m) receive(m); };
    ws.onclose = () => {
        const was = net.status;
        ws = null; net.id = null; net.peers.clear();
        if (was === 'online') emit('offline');
        if (rejected) return;
        net.status = 'connecting'; net.error = `reconnecting (${++retry})…`; renderStatus();
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(retry, 5)));
    };
}
function fail(reason) { rejected = true; net.status = 'error'; net.error = reason; renderStatus(); }

function receive(m) {
    switch (m.t) {
        case MSG.WELCOME:
            if (m.seed !== window.__vpSeed) { // join the room's map
                const u = new URL(location.href);
                u.searchParams.set('seed', m.seed); u.searchParams.set('autostart', '');
                location.replace(u.href);
                return;
            }
            Object.assign(net, { status: 'online', error: '', id: m.id, hostId: m.hostId });
            retry = 0;
            for (const p of m.players) net.peers.set(p.id, { id: p.id, name: p.name, state: null, at: 0 });
            emit('online', m);
            break;
        case MSG.REJECT: fail(m.reason); break;
        case MSG.JOIN: net.peers.set(m.id, { id: m.id, name: m.name, state: null, at: 0 }); emit('peer-join', m); break;
        case MSG.LEAVE: net.peers.delete(m.id); emit('peer-leave', m); break;
        case MSG.HOST: net.hostId = m.hostId; break;
        case MSG.PONG: net.rtt = Math.round(performance.now() - m.c); break;
        case MSG.STATE: { const p = net.peers.get(m.from); if (p) { p.state = m; p.at = performance.now(); } break; }
    }
    emit(m.t, m);
    renderStatus();
}

const _q = new THREE.Quaternion();
/** Once per rendered frame from main.js: stream the local plane, keep the ping going, refresh the status chip. */
export function updateNet(rawDelta) {
    if (net.status !== 'online') return;
    stateTimer -= rawDelta; pingTimer -= rawDelta;
    if (stateTimer <= 0) {
        stateTimer = 1 / LIMITS.stateHz;
        const p = plane.position; _q.copy(plane.quaternion);
        netSend(MSG.STATE, { p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], q: [+_q.x.toFixed(4), +_q.y.toFixed(4), +_q.z.toFixed(4), +_q.w.toFixed(4)], s: +state.speed.toFixed(3), hp: Math.max(0, state.planeHP) });
    }
    if (pingTimer <= 0) { pingTimer = 2; netSend(MSG.PING, { c: performance.now() }); renderStatus(); }
}

function renderStatus() {
    if (!statusEl) return;
    statusEl.hidden = !net.enabled;
    statusEl.dataset.status = net.status;
    const mode = MODES[net.mode].label;
    statusEl.textContent = net.status === 'online'
        ? `● ${mode} · ${net.room} · ${net.peers.size + 1} pilot${net.peers.size ? 's' : ''} · ${net.rtt} ms${isHost() ? ' · host' : ''}`
        : net.status === 'error' ? `✕ MP: ${net.error}` : `○ ${mode} · connecting${net.error ? ` — ${net.error}` : '…'}`;
}

if (net.enabled) connect(); else renderStatus();
