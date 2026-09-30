/**
 * Multiplayer entry point (multiplayer branch). Imported once by main.js; does nothing without ?mp.
 *
 * With ?mp the player joins straight away (room "lobby", mode pvp by default) under their remembered callsign — or
 * a random one (callsigns.js); "Callsign" in the start and pause menus changes it (lobby.js). The session belongs
 * to the server: respawn instead of game over, the server's WELCOME / SPAWN / CORRECT place the player, and other
 * players are drawn from its snapshots. Everything plugs in through game/hooks.js.
 *
 * Enemies (pvp, coop): the seeded enemy bases are shared — coop.js syncs damage and moving units. Aces fly on the
 * host's game and hunt every player; the others see them as bots (bots.js). Interceptor waves and the roaming
 * fighters stay off (they spawn at random, so they can't be shared yet).
 * Notifications: every gameplay notification is also shown to the others with the player's name (EVENT).
 *
 * Team deathmatch (default mode, tdm): Red against Blue, five a side; the host's bots fill the empty places (bots.js).
 * No damage between teammates; the server keeps the score (kills of the other team), shown in the roster.
 *
 * PvP: every weapon hits other players. The shooter reports each hit (HIT, damage from PVP_DAMAGE);
 * the victim applies it with damagePlayer() — its flares still stop gun and missile hits, spawn protection still
 * applies — and at 0 HP reports DOWN with the attacker, which credits the kill. The server respawns the victim
 * at a random point near its start.
 */
import { setRules } from '../game/rules.js';
import { onHook } from '../game/hooks.js';
import { respawnPlayer } from '../game/respawn.js';
import { state } from '../state.js';
import { aimingLaser, plane } from '../player/plane.js';
import { FLAGS, MODES, MSG, PVP_DAMAGE, PVP_KILL_XP, TEAMS } from '../net/protocol.js';
import { net, netSend, onNet, startNet, updateNet } from '../net/net.js';
import { clearRemotePlanes, colorKey, cssColor, enablePvpTargets, peerPosition, remoteRadarBlips, updateRemotePlanes } from './remotePlanes.js';
import { clearRemoteFx, onRemoteFire, updateRemoteFx } from './remoteFx.js';
import { damagePlayer } from '../combat/collision.js';
import { awardKill } from '../game/progression.js';
import { showNotification } from '../ui/notifications.js';
import { askName } from './lobby.js';
import { defaultCallsign, saveCallsign } from './callsigns.js';
import { startCoop, updateCoop } from './coop.js';
import { botKiller, botRoster, startBots, updateBots } from './bots.js';
import { startFlag } from './flag.js';

if (net.enabled) {
    const enemies = MODES[net.mode].enemies;
    setRules({ enemies, roamingFighters: false, interceptors: false, ace: false, mission: enemies, respawn: true });
    if (enemies) startCoop();
    startBots(net.mode); // tdm: team bots on the host; pvp/coop: Ace Hunt on the host (RULES.ace)
    if (MODES[net.mode].teams) startFlag(); // tdm: the flag in the middle, the bots' first waypoint
    if (!new URLSearchParams(location.search).get('name')) net.name = defaultCallsign();

    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = new URL('./mp.css', import.meta.url).href;
    document.head.appendChild(css);
    const chip = document.createElement('div');
    chip.id = 'net-status'; chip.setAttribute('aria-live', 'polite');
    chip.addEventListener('click', () => chip.classList.toggle('folded')); // phones: fold / unfold the roster
    document.body.appendChild(chip);

    const _p = new THREE.Vector3(), _q = new THREE.Quaternion();
    const place = ({ p, q }) => respawnPlayer(_p.fromArray(p), _q.fromArray(q));
    let myKey = 0; // colour key: slot, or team in tdm
    onNet('online', m => { myKey = colorKey(m); place(m.spawn); });
    onNet(MSG.SPAWN, place);
    onNet(MSG.CORRECT, ({ p, q }) => { plane.position.fromArray(p); plane.quaternion.fromArray(q); }); // server rejected our reports
    onNet('offline', () => { clearRemotePlanes(); clearRemoteFx(); });

    // --- Shots, both ways: ours go out (gun as STATE.f, the rest as FIRE), theirs are drawn by remoteFx.js ---
    let lastGunAt = -1e9;
    const vec = v => v.toArray().map(x => +x.toFixed(2));
    onHook('playerFired', (weapon, d) => {
        if (weapon === 'gun') { lastGunAt = performance.now(); return; }
        if (weapon === 'missile') {
            const tg = typeof d.target?.id === 'string' && d.target.id.startsWith('peer-') ? Number(d.target.id.slice(5)) : undefined;
            netSend(MSG.FIRE, { w: weapon, p: vec(d.origins[0]), p2: vec(d.origins[1]), d: vec(d.d), tg });
        } else if (weapon === 'flare') netSend(MSG.FIRE, { w: weapon, p: vec(d.p) });
        else if (weapon === 'bomb') netSend(MSG.FIRE, { w: weapon, p: vec(d.p), v: vec(d.v) });
        else if (weapon === 'napalm') netSend(MSG.FIRE, { w: weapon, p: vec(d.p), v: vec(d.d.clone().setY(0).normalize().multiplyScalar(d.speed)) });
    });
    onNet(MSG.FIRE, onRemoteFire);
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
        netSend(MSG.DOWN, { by, ...(by === null ? botKiller() ?? {} : {}) }); // a bot's kill scores for its team
    });
    onNet(MSG.DOWN, ({ id, by, bot }) => {
        if (by !== null) kills.set(by, (kills.get(by) ?? 0) + 1);
        if (by === null && bot) { // a bot got them
            showNotification(id === net.id ? `Shot down by ${bot} — respawning` : `${bot} shot down ${nameOf(id)}`, false, { local: true });
            return;
        }
        const feed = (text, hl = false) => showNotification(text, hl, { local: true }); // everyone sees DOWN already
        if (by === net.id) { awardKill(PVP_KILL_XP); feed(`★ You shot down ${nameOf(id)}  +${PVP_KILL_XP}`, true); }
        else if (id === net.id) feed(by !== null ? `Shot down by ${nameOf(by)} — respawning` : 'You went down — respawning');
        else feed(by === null ? `${nameOf(id)} went down` : `${nameOf(by)} shot down ${nameOf(id)}`);
    });
    onNet('peer-leave', p => kills.delete(p.id));

    // --- Notifications: ours go to everyone, theirs are shown with their name ---
    onHook('notification', (text, hl) => netSend(MSG.EVENT, { text, hl: !!hl }));
    onNet(MSG.EVENT, m => showNotification(`${nameOf(m.from)}: ${m.text}`, m.hl, { local: true }));
    onHook('radarBlips', remoteRadarBlips);

    const report = () => state._playerDown ? null : {
        p: plane.position.toArray().map(v => +v.toFixed(2)),
        q: plane.quaternion.toArray().map(v => +v.toFixed(4)),
        s: +state.speed.toFixed(3), hp: Math.max(0, state.planeHP), mh: state.maxHP,
        f: (performance.now() - lastGunAt < 150 ? FLAGS.gun : 0) | (aimingLaser.visible ? FLAGS.laser : 0), // others draw tracers and the laser
    };
    let chipTimer = 0;
    onHook('frame', rawDelta => {
        updateNet(rawDelta, report);
        updateRemotePlanes();
        updateRemoteFx(Math.min(rawDelta * 60, 6));
        updateCoop(rawDelta);
        updateBots(rawDelta);
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
            const row = (name, key, note) => {
                const el = document.createElement('div'); el.className = 'net-pilot';
                const dot = document.createElement('span'); dot.className = 'net-dot'; dot.style.background = cssColor(key);
                el.append(dot, `${name}${note}`);
                return el;
            };
            const score = id => (kills.get(id) ? ` · ${kills.get(id)}★` : '');
            const pilots = [{ team: net.team, el: row(net.name, myKey, `${state._playerDown ? ' (you · down)' : ` (you) · ${Math.max(0, state.planeHP)} HP`}${score(net.id)}`) }];
            for (const peer of net.peers.values()) {
                const last = peer.samples[peer.samples.length - 1];
                pilots.push({ team: peer.team, el: row(peer.name, colorKey(peer), `${last && !last.alive ? ' (down)' : last ? ` · ${last.hp} HP` : ''}${score(peer.id)}`) });
            }
            for (const b of botRoster()) { // the host's bots
                const key = b.team === null ? 'ace' : `t${b.team}`, target = b.target != null && b.team === null ? ` → ${nameOf(b.target)}` : '';
                pilots.push({ team: b.team, el: row(b.team === null ? `☠ ${b.name}` : `${b.name} · bot`, key, b.down ? ' (down)' : ` · LV ${b.lvl} · ${b.hp} HP${target}`) });
            }
            if (MODES[net.mode].teams) { // scoreboard, then each team
                const board = document.createElement('div'); board.className = 'net-score';
                board.innerHTML = TEAMS.map((t, i) => `<span style="color:${t.css}">${t.name.toUpperCase()} ${net.score?.[i] ?? 0}</span>`).join(' : ');
                rows.push(board);
                for (const team of [0, 1]) {
                    const h = document.createElement('div'); h.className = 'net-team'; h.style.color = TEAMS[team].css;
                    h.textContent = `${TEAMS[team].name} team${team === net.team ? ' (yours)' : ''}`;
                    rows.push(h, ...pilots.filter(p => p.team === team).map(p => p.el));
                }
            } else rows.push(...pilots.map(p => p.el));
        }
        chip.replaceChildren(...rows);
        if (document.body.classList.contains('touch')) { // phones: start folded, and sit under the Ace Hunt panel when it shows
            if (!chip.dataset.folded) { chip.dataset.folded = '1'; chip.classList.add('folded'); }
            const ace = document.getElementById('rival-panel'), r = ace && getComputedStyle(ace).display !== 'none' ? ace.getBoundingClientRect() : null;
            chip.style.top = `${r && r.height ? Math.round(r.bottom + 6) : 58}px`;
        }
    }
    renderChip();

    // "Callsign" button in the start and pause menus: pick a new one, then rejoin under it
    for (const box of ['#start-menu', '#paused'].map(sel => document.querySelector(`${sel} .menu-buttons`)).filter(Boolean)) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'mp-callsign'; b.textContent = `Callsign: ${net.name}`;
        b.addEventListener('click', async () => {
            const name = await askName({ room: net.room, mode: net.mode, current: net.name });
            if (!name || name === net.name) return;
            saveCallsign(name);
            const u = new URL(location.href); u.searchParams.set('name', name);
            if (!state.awaitingStart) u.searchParams.set('autostart', '');
            location.assign(u.href);
        });
        box.appendChild(b);
    }
    startNet();
}
