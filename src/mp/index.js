/**
 * Multiplayer entry point (multiplayer branch). Imported once by main.js; does nothing without ?mp.
 *
 * With ?mp the player first picks a callsign (lobby.js; skipped when &name= is in the address). Then the session
 * belongs to the server: the game rules switch to shared skies (no enemies, ace, interceptors or mission; respawn
 * instead of game over), the server's WELCOME / SPAWN / CORRECT place the player, and other players are drawn
 * from its snapshots. Everything plugs in through game/hooks.js.
 *
 * PvP (default mode): every weapon hits other players. The shooter reports each hit (HIT, damage from PVP_DAMAGE);
 * the victim applies it with damagePlayer() — its flares still stop gun and missile hits, spawn protection still
 * applies — and at 0 HP reports DOWN with the attacker, which credits the kill. The server respawns the victim
 * at a random point near its start.
 */
import { setRules } from '../game/rules.js';
import { onHook } from '../game/hooks.js';
import { respawnPlayer } from '../game/respawn.js';
import { state } from '../state.js';
import { plane } from '../player/plane.js';
import { MODES, MSG, PVP_DAMAGE, PVP_KILL_XP } from '../net/protocol.js';
import { net, netSend, onNet, startNet, updateNet } from '../net/net.js';
import { clearRemotePlanes, cssColor, enablePvpTargets, peerPosition, remoteRadarBlips, updateRemotePlanes } from './remotePlanes.js';
import { damagePlayer } from '../combat/collision.js';
import { awardKill } from '../game/progression.js';
import { showNotification } from '../ui/notifications.js';
import { askName } from './lobby.js';

if (net.enabled) {
    setRules({ enemies: false, interceptors: false, ace: false, mission: false, respawn: true });

    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = new URL('./mp.css', import.meta.url).href;
    document.head.appendChild(css);
    const chip = document.createElement('div');
    chip.id = 'net-status'; chip.setAttribute('aria-live', 'polite');
    document.body.appendChild(chip);

    const _p = new THREE.Vector3(), _q = new THREE.Quaternion();
    const place = ({ p, q }) => respawnPlayer(_p.fromArray(p), _q.fromArray(q));
    let mySlot = 0;
    onNet('online', m => { mySlot = m.slot; place(m.spawn); });
    onNet(MSG.SPAWN, place);
    onNet(MSG.CORRECT, ({ p, q }) => { plane.position.fromArray(p); plane.quaternion.fromArray(q); }); // server rejected our reports
    onNet('offline', clearRemotePlanes);
    // --- PvP ---
    const pvp = MODES[net.mode].pvp, kills = new Map(); // player id → kills this session
    let lastHit = null; // { by, at } — who to credit if we go down soon after
    const nameOf = id => id === net.id ? net.name : net.peers.get(id)?.name ?? 'someone';
    if (pvp) {
        enablePvpTargets((peerId, amount, weapon) => { if (PVP_DAMAGE[weapon]) netSend(MSG.HIT, { target: peerId, dmg: PVP_DAMAGE[weapon], w: weapon }); });
        onNet(MSG.HIT, m => {
            if (state._playerDown) return;
            if (state.flareTimer > 0 && (m.w === 'bullet' || m.w === 'missile')) return; // flares: like enemy fire
            lastHit = { by: m.from, at: performance.now() };
            damagePlayer(m.dmg, peerPosition(m.from) ?? plane.position); // at 0 HP → game over → respawn rules → playerDown
        });
    }
    onHook('playerDown', () => {
        const by = lastHit && performance.now() - lastHit.at < 10000 ? lastHit.by : null;
        lastHit = null;
        netSend(MSG.DOWN, { by });
    });
    onNet(MSG.DOWN, ({ id, by }) => {
        if (by !== null) kills.set(by, (kills.get(by) ?? 0) + 1);
        if (by === net.id) { awardKill(PVP_KILL_XP); showNotification(`★ You shot down ${nameOf(id)}  +${PVP_KILL_XP}`, true); }
        else if (id === net.id) showNotification(by === null ? 'You crashed — respawning' : `Shot down by ${nameOf(by)} — respawning`);
        else showNotification(by === null ? `${nameOf(id)} crashed` : `${nameOf(by)} shot down ${nameOf(id)}`);
    });
    onNet('peer-leave', p => kills.delete(p.id));
    onHook('radarBlips', remoteRadarBlips);

    const report = () => state._playerDown ? null : {
        p: plane.position.toArray().map(v => +v.toFixed(2)),
        q: plane.quaternion.toArray().map(v => +v.toFixed(4)),
        s: +state.speed.toFixed(3), hp: Math.max(0, state.planeHP),
    };
    let chipTimer = 0;
    onHook('frame', rawDelta => {
        updateNet(rawDelta, report);
        updateRemotePlanes();
        if ((chipTimer -= rawDelta) <= 0) { chipTimer = 0.25; renderChip(); }
    });

    /** Status line plus the roster: you first, then everyone else in their colour. */
    function renderChip() {
        chip.dataset.status = net.status;
        const head = document.createElement('div');
        const mode = MODES[net.mode].label;
        head.textContent = net.status === 'online' ? `● ${mode} · room ${net.room} · ${net.rtt} ms`
            : net.status === 'error' ? `✕ Multiplayer: ${net.error}` : `○ ${mode} · connecting${net.error ? ` — ${net.error}` : '…'}`;
        const rows = [head];
        if (net.status === 'online') {
            const row = (name, slot, note) => {
                const el = document.createElement('div'); el.className = 'net-pilot';
                const dot = document.createElement('span'); dot.className = 'net-dot'; dot.style.background = cssColor(slot);
                el.append(dot, `${name}${note}`);
                return el;
            };
            const score = id => (kills.get(id) ? ` · ${kills.get(id)}★` : '');
            rows.push(row(net.name, mySlot, `${state._playerDown ? ' (you · down)' : ` (you) · ${Math.max(0, state.planeHP)} HP`}${score(net.id)}`));
            for (const peer of net.peers.values()) {
                const last = peer.samples[peer.samples.length - 1];
                rows.push(row(peer.name, peer.slot, `${last && !last.alive ? ' (down)' : last ? ` · ${last.hp} HP` : ''}${score(peer.id)}`));
            }
        }
        chip.replaceChildren(...rows);
    }
    renderChip();
    if (new URLSearchParams(location.search).get('name')) startNet();
    else askName(net).then(name => { // no &name= in the address: ask first, then keep it in the address
        net.name = name;
        const u = new URL(location.href); u.searchParams.set('name', name);
        history.replaceState(null, '', u);
        startNet();
    });
}
