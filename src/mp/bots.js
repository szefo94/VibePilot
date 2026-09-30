/**
 * Bots in multiplayer (modes with enemies): aces flown by the room's host (entities/rival.js), seen by everyone else.
 *
 *   tdm       team bots: the host keeps each team at TEAM_SIZE pilots — players first, bots fill the rest — and
 *             respawns a bot a few seconds after it goes down. Each spawn flies to the flag first (flag.js), taking
 *             no target on the way (bar an enemy right on top of it); from there it patrols around the flag, hunts
 *             the pilots of the other team it sees (players or bots) and, with none close, attacks the enemy bases'
 *             units to level up (rival.js farms; the shared units stay in sync through coop.js). Teammates are
 *             never targets. Bot-vs-bot fights are resolved on the host.
 *   pvp/coop  Ace Hunt as in single player (RULES.ace on the host), but its aces hunt every player.
 *
 *   host    shares every bot ten times a second (BOT) with their missiles and bomb / napalm drops; hits on remote players ride along
 *           (BOT.hits, the server hands each to its target as BOT_FIRE). Hits other players land on a bot arrive as
 *           BOT_HIT (the server drops them from a bot's teammates) and are applied here without reward; when a bot
 *           goes down BOT_DOWN names who shot it down (a player or a bot) — the server scores it in tdm.
 *   guests  draw each bot (airframe in its team's colour, name tag with HP, tracers, missiles, minimap blip). Enemy
 *           bots are proxy air units, so every weapon, the lock-on and missile homing treat them like targets; hits
 *           go to the host. BOT_FIRE damages this player (flares stop missiles); BOT_DOWN pays the shooter its XP.
 *
 * Bots grow: every kill (player or bot) gives the killer XP on the host (rival.js rewardAce: levels add HP, skill
 * and ammo), and they heal on collectibles. A player who flies into a bot takes it down too (BOT_HIT ram).
 *
 * If the host leaves, the next host starts its own bots (the old ones vanish with it).
 */
import { scene, camera } from '../core/scene.js';
import { createExplosion } from '../effects/effects.js';
import { airUnits } from '../entities/registry.js';
import { createRivalVisual, localRivalTarget, rewardAce, rivalList, rivalMissilesInFlight, setRivalTargets, spawnAce } from '../entities/rival.js';
import { destroyAirUnit } from '../entities/airUnits.js';
import { beginHits } from '../combat/hits.js';
import { damagePlayer } from '../combat/collision.js';
import { awardKill } from '../game/progression.js';
import { onHook } from '../game/hooks.js';
import { setRules } from '../game/rules.js';
import { FLARE_DURATION } from '../config.js';
import { state } from '../state.js';
import { showNotification } from '../ui/notifications.js';
import { MODES, MSG, PVP_KILL_XP, TEAM_SIZE, TEAMS, teamRespawn } from '../net/protocol.js';
import { isHost, net, netSend, onNet } from '../net/net.js';
import { buildLabel, drawLabel, remoteViews, sampleAt } from './remotePlanes.js';
import { flagPatrol, flagWaypoint } from './flag.js';
import { onRemoteFire } from './remoteFx.js';

const SEND_MS = 100, INTERP_DELAY = 150, STALE_MS = 3000, LABEL_RANGE = 600, FIRING_MS = 250;
const BOT_RESPAWN_MS = 8000, BOT_XP = 100, MAX_BOTS = 12;
const BOT_NAMES = [['Viper', 'Hawk', 'Cobra', 'Falcon', 'Raptor'], ['Ghost', 'Talon', 'Wolf', 'Lynx', 'Orca']];
const r2 = v => +v.toFixed(2), r4 = v => +v.toFixed(4);
const feed = (text, hl = false) => showNotification(text, hl, { local: true });
const flaresOn = at => performance.now() - (at ?? -1e9) < FLARE_DURATION / 60 * 1000;

let enemies = false, teams = false, hosting = false, sendTimer = 0, nextBotId = 1, reconcileTimer = 0;

// --- Host -----------------------------------------------------------------------------------------------------
const flareAt = new Map();   // peer id → when their flares went out (performance.now())
const hitsOwed = new Map();  // `${peer}|${weapon}|${bot}|${team}` → damage to send with the next BOT
const drops = [];            // bombs / napalm released since the last BOT: [weapon, x, y, z, vx, vy, vz]
const hostViews = new Map(); // ace → { group, firing, speed, shown } for tracers at remote pilots (local ones are real bullets)
const teamBots = new Map();  // tdm: bot id → { id, team, name, au, respawnAt, target }

const displayName = r => (teamBots.has(r.netBot) ? r.callsign : `ACE ${r.callsign}`);
const botTeam = r => (teamBots.get(r.netBot)?.team ?? null);
const nameOf = id => (id === net.id ? net.name : net.peers.get(id)?.name ?? 'someone');
const aceNamed = name => rivalList().find(r => r.hp > 0 && !r.gone && displayName(r) === name) ?? null;
const teamOf = id => (id === net.id ? net.team : net.peers.get(id)?.team ?? null);

/** Who an ace may hunt: tdm — the other team's pilots and bots; otherwise every player. */
function targetsFor(ace) {
    const team = botTeam(ace), list = [];
    if (team === null || net.team !== team) list.push(localRivalTarget);
    for (const v of remoteViews()) {
        if (!v.shown || (team !== null && teamOf(v.id) === team)) continue;
        list.push({ id: v.id, local: false, position: v.group.position, quaternion: v.group.quaternion, speed: v.speed ?? 0, alive: true, flares: flaresOn(flareAt.get(v.id)) });
    }
    if (team !== null) for (const e of teamBots.values()) if (e.au && e.team !== team) list.push(e.target);
    return list;
}
/** Every other player's plane, whatever the team: bots keep clear of them (rival.js avoidTraffic). */
const traffic = () => [...remoteViews()].filter(v => v.shown).map(v => v.group.position);
/** An ace hit something that isn't this player: another bot (applied here) or a remote player (sent with BOT). */
function onAceHit(targetId, damage, weapon, ace) {
    if (typeof targetId === 'string' && targetId.startsWith('bot:')) {
        const victim = teamBots.get(targetId.slice(4))?.au;
        if (!victim || !(victim.hp > 0)) return;
        victim.lastHitBy = { bot: displayName(ace), team: botTeam(ace) };
        const hits = beginHits(weapon === 'gun' ? 'bullet' : weapon, { remote: true });
        hits.damage(victim, damage); hits.finish();
        return;
    }
    const key = `${targetId}|${weapon}|${ace ? displayName(ace) : 'ACE'}|${ace ? botTeam(ace) ?? '' : ''}`;
    hitsOwed.set(key, (hitsOwed.get(key) ?? 0) + damage);
}
function setHosting(on) {
    hosting = on;
    setRules({ ace: on && !teams }); // Ace Hunt in pvp/coop; tdm has team bots instead
    setRivalTargets(on ? targetsFor : null, on ? onAceHit : null, on ? traffic : null);
    clearGuestBots();
    if (!on) for (const e of teamBots.values()) despawn(e);
    if (!on) teamBots.clear();
    if (on && !teams && net.peers.size) feed('☠ You host the aces now — they hunt every pilot in the room');
    reconcileTimer = 0;
}
const botId = r => (r.netBot ??= `b${nextBotId++}`);

// tdm: fill each team up to TEAM_SIZE with bots, respawn the fallen
function reconcileTeams(now) {
    for (const team of [0, 1]) {
        const players = (net.team === team ? 1 : 0) + [...net.peers.values()].filter(p => p.team === team).length;
        const mine = [...teamBots.values()].filter(e => e.team === team);
        for (let k = mine.length; k < TEAM_SIZE - players; k++) {
            const used = new Set(mine.map(e => e.name)), name = BOT_NAMES[team].find(n => !used.has(n)) ?? `Bot ${k + 1}`;
            const e = { id: `t${nextBotId++}`, team, name, au: null, respawnAt: now };
            e.target = { id: `bot:${e.id}`, local: false, get position() { return e.au.group.position; }, get quaternion() { return e.au.group.quaternion; },
                get speed() { return e.au.fl.speed; }, get alive() { return !!e.au && e.au.hp > 0; }, get flares() { return (e.au?.wpn.flareTimer ?? 0) > 0; } };
            teamBots.set(e.id, e); mine.push(e);
        }
        while (mine.length > Math.max(0, TEAM_SIZE - players)) { // a player took the place: the bot leaves
            const e = mine.pop();
            despawn(e); teamBots.delete(e.id);
            netSend(MSG.BOT_DOWN, { bot: e.id, name: e.name, team, gone: true });
        }
    }
    for (const e of teamBots.values()) {
        if (e.au || now < e.respawnAt || state.awaitingStart) continue;
        const s = teamRespawn(e.team), heading = 2 * Math.atan2(s.q[1], s.q[3]);
        e.au = spawnAce({ callsign: e.name, position: new THREE.Vector3(...s.p), heading, color: TEAMS[e.team].bot,
            friendly: e.team === net.team, blipColor: TEAMS[e.team].css, xp: BOT_XP, waypoint: flagWaypoint(), rally: true, patrol: flagPatrol(), farms: true }); // to the flag before any target, then hunts and farms from there
        e.au.netBot = e.id;
    }
}
function despawn(e) {
    const au = e.au;
    if (!au) return;
    e.au = null;
    au.quiet = true; au.gone = true;
    const i = airUnits.indexOf(au); if (i >= 0) airUnits.splice(i, 1); // rival.js reaps it (scene, label) next frame
    scene.remove(au.group); if (au.label) scene.remove(au.label.sprite);
}

function shareBots() {
    const now = performance.now(), list = [];
    for (const r of rivalList()) {
        if (!(r.hp > 0) || r.gone) continue;
        list.push({ id: botId(r), name: displayName(r), lvl: r.level ?? Math.max(1, Math.round(r.xpValue / 400)), team: botTeam(r), s: r4(r.fl.speed),
            p: r.group.position.toArray().map(r2), q: r.group.quaternion.toArray().map(r4), hp: Math.round(r.hp), mh: r.maxHp,
            f: now - (r.firingAt ?? -1e9) < FIRING_MS ? 1 : 0, tg: r.ai.targetId === 'local' ? net.id : r.ai.targetId });
    }
    const m = rivalMissilesInFlight().filter(x => !x.userData.decoyed).slice(0, MAX_BOTS)
        .map(x => [(x.userData.netId ??= nextBotId++), ...x.position.toArray().map(r2), x.userData.targetId === 'local' ? net.id : x.userData.targetId]);
    const hits = [...hitsOwed].slice(0, 20).map(([key, dmg]) => {
        const [target, w, bot, team] = key.split('|');
        return { target: Number(target), dmg: Math.round(dmg), w, bot, team: team === '' ? null : Number(team) };
    });
    hitsOwed.clear();
    netSend(MSG.BOT, { bots: list, m, hits, fx: drops.splice(0, 8) });
}
function updateHostViews() {
    const now = performance.now(), live = new Set(rivalList());
    for (const r of live) {
        let v = hostViews.get(r);
        if (!v) hostViews.set(r, v = { group: r.group, shown: true });
        v.speed = r.fl.speed;
        v.firing = r.hp > 0 && r.ai.targetId !== 'local' && now - (r.firingAt ?? -1e9) < FIRING_MS;
    }
    for (const r of hostViews.keys()) if (!live.has(r)) hostViews.delete(r);
}
/** Host: which enemy bot most likely shot this player down (the one hunting it). */
function hostKiller() {
    const r = rivalList().find(a => a.hp > 0 && a.ai.targetId === 'local' && botTeam(a) !== net.team);
    return r ? { bot: displayName(r), byTeam: botTeam(r) } : null;
}

// --- Guests ---------------------------------------------------------------------------------------------------
const bots = new Map();     // bot id → { id, name, lvl, team, group, label, unit, samples, hp, mh, firing, speed, shown, seenAt }
const missiles = new Map(); // missile id → { mesh, p, v, at, target }
const outgoing = new Map(); // `${bot}|${weapon}` → damage to send to the host
const mslGeo = new THREE.CylinderGeometry(0.3, 0.3, 3, 6).rotateX(Math.PI / 2);
const mslMat = new THREE.MeshBasicMaterial({ color: 0xff2233 });
const warnEl = document.getElementById('rival-warning');
let lastBotHit = null, warned = '';

function botFor(m) {
    let b = bots.get(m.id);
    if (!b) {
        const team = m.team === 0 || m.team === 1 ? m.team : null;
        b = { id: m.id, name: String(m.name ?? 'Ace').slice(0, 24), lvl: m.lvl | 0, team, samples: [], hp: 1, mh: 1, shown: false, firing: false, speed: 0, unit: null,
            group: createRivalVisual(team === null ? undefined : TEAMS[team].bot) };
        b.label = buildLabel(b.name, team === null ? 'ace' : `t${team}`); b.label.sprite.scale.multiplyScalar(1.6);
        b.group.visible = b.label.sprite.visible = false;
        scene.add(b.group, b.label.sprite);
        if (team === null || team !== net.team) {
            // A proxy air unit (like other players in PvP): hits.js hands its hits to us, ai.js leaves it alone
            b.unit = {
                id: `bot-${m.id}`, type: 'fighter', group: b.group, hp: 0, maxHp: 1, xpValue: 0,
                collisionRadius: 10, wingHalfSpan: 14, wingR: 5, wingType: 'q', isHostile: true, baseId: null, label: null,
                userData: { baseId: null }, shootCooldown: 0,
                proxy: {
                    damage: (amount, weapon) => { const k = `${m.id}|${weapon}`; outgoing.set(k, (outgoing.get(k) ?? 0) + amount); },
                    ram: () => netSend(MSG.BOT_HIT, { bot: m.id, dmg: 0, w: 'missile', ram: true }), // we flew into it: it goes down too
                },
            };
            airUnits.push(b.unit);
        }
        bots.set(m.id, b);
        if (team === null) feed(`☠ ${b.name.toUpperCase()} (LV ${b.lvl}) is hunting the room`, true);
    }
    return b;
}
function removeBot(id, explode = false) {
    const b = bots.get(id);
    if (!b) return;
    if (explode && b.shown) createExplosion(b.group.position, 2);
    scene.remove(b.group, b.label.sprite);
    b.label.texture.dispose(); b.label.sprite.material.dispose();
    const i = airUnits.indexOf(b.unit); if (i >= 0) airUnits.splice(i, 1);
    bots.delete(id);
}
function clearGuestBots() {
    for (const id of [...bots.keys()]) removeBot(id);
    for (const x of missiles.values()) scene.remove(x.mesh);
    missiles.clear(); outgoing.clear();
    setWarning('');
}
function setWarning(text) {
    if (!warnEl || text === warned) return;
    warned = text; warnEl.textContent = text; warnEl.hidden = !text;
}
function onBots(m) {
    if (hosting || !Array.isArray(m.bots)) return;
    const now = performance.now();
    for (const e of m.bots.slice(0, MAX_BOTS)) {
        if (typeof e?.id !== 'string' || !Array.isArray(e.p) || !Array.isArray(e.q)) continue;
        const b = botFor(e);
        b.samples.push({ t: now, p: e.p, q: e.q, alive: true });
        if (b.samples.length > 10) b.samples.shift();
        Object.assign(b, { hp: +e.hp || 0, mh: +e.mh || 1, lvl: e.lvl | 0, speed: +e.s || 0, firing: !!e.f, target: e.tg ?? null, seenAt: now });
    }
    // Bombs and napalm the bots dropped: drawn falling and bursting like another player's (remoteFx.js)
    for (const [w, x, y, z, vx, vy, vz] of Array.isArray(m.fx) ? m.fx.slice(0, 8) : []) {
        if ((w === 'bomb' || w === 'napalm') && [x, y, z, vx, vy, vz].every(Number.isFinite)) onRemoteFire({ w, p: [x, y, z], v: [vx, vy, vz] });
    }
    const seen = new Set();
    for (const [id, x, y, z, target] of Array.isArray(m.m) ? m.m.slice(0, MAX_BOTS) : []) {
        seen.add(id);
        let s = missiles.get(id);
        if (!s) { s = { mesh: new THREE.Mesh(mslGeo, mslMat), p: new THREE.Vector3(x, y, z), v: new THREE.Vector3(), at: now }; scene.add(s.mesh); s.mesh.position.copy(s.p); missiles.set(id, s); }
        else { s.v.set(x, y, z).sub(s.p).divideScalar(Math.max(1, now - s.at)); s.p.set(x, y, z); s.at = now; }
        s.target = target;
    }
    for (const [id, s] of missiles) if (!seen.has(id)) { scene.remove(s.mesh); missiles.delete(id); }
}
function updateGuestBots() {
    const now = performance.now();
    for (const [id, b] of bots) {
        if (now - b.seenAt > STALE_MS) { removeBot(id); continue; }
        sampleAt(b.samples, now - INTERP_DELAY, b.group);
        b.shown = b.hp > 0;
        b.group.visible = b.shown;
        if (b.unit) { b.unit.hp = b.shown ? b.hp : 0; b.unit.maxHp = b.mh; }
        const d = camera.position.distanceTo(b.group.position);
        b.label.sprite.visible = b.shown && d < LABEL_RANGE;
        if (b.label.sprite.visible) { b.label.sprite.position.copy(b.group.position).y += 10; drawLabel(b.label, b.hp, b.mh); }
    }
    let threat = false;
    for (const s of missiles.values()) { // between updates: carry on along the last velocity
        s.mesh.position.copy(s.p).addScaledVector(s.v, Math.min(now - s.at, 200));
        if (s.v.lengthSq() > 0) s.mesh.lookAt(s.mesh.position.clone().add(s.v));
        if (s.target === net.id) threat = true;
    }
    setWarning(threat && !state._playerDown ? '⚠ MISSILE — FLARES (Q) / BREAK TURN' : '');
    for (const [key, dmg] of outgoing) {
        const [bot, w] = key.split('|');
        netSend(MSG.BOT_HIT, { bot, dmg: r2(dmg), w });
    }
    outgoing.clear();
}

// --- Both -----------------------------------------------------------------------------------------------------
export function startBots(mode) {
    enemies = !!MODES[mode].enemies; teams = !!MODES[mode].teams;
    if (!enemies) return;
    onNet(MSG.FIRE, m => { if (m.w === 'flare') flareAt.set(m.from, performance.now()); });
    onNet(MSG.BOT, onBots);
    onHook('aceDropped', (ace, w, p, v) => { if (hosting && net.peers.size) drops.push([w, ...p.toArray().map(r2), ...v.toArray().map(r4)]); });
    onNet(MSG.BOT_HIT, m => {
        if (!hosting) return;
        const ace = rivalList().find(r => r.netBot === m.bot && r.hp > 0 && !r.gone);
        if (ace && m.ram) { ace.crashed = true; ace.hp = 0; destroyAirUnit(ace, { reward: false }); return; } // a player flew into it
        if (!ace || !(m.dmg > 0) || (teams && botTeam(ace) === teamOf(m.from))) return; // no friendly fire
        ace.lastHitBy = { player: m.from, team: teamOf(m.from) };
        const hits = beginHits(m.w, { remote: true });
        hits.damage(ace, m.dmg);
        hits.finish();
    });
    onHook('unitHit', (unit, amount, weapon, shooter) => { if (hosting && unit.isRival && !shooter) unit.lastHitBy = { player: net.id, team: net.team }; });
    onNet(MSG.BOT_FIRE, m => {
        if (hosting || state._playerDown || state.isGameOver) return;
        if (state.flareTimer > 0 && m.w === 'missile') return; // flares decoy it, like any enemy missile
        lastBotHit = { bot: m.bot, byTeam: m.team ?? null, at: performance.now() };
        const src = [...bots.values()].find(b => b.name === m.bot)?.group.position;
        damagePlayer(m.dmg, src ?? camera.position);
    });
    onHook('rivalDown', r => {
        if (!hosting || r.gone) return;
        const e = teamBots.get(r.netBot), name = displayName(r), hit = r.crashed || !(r.hp <= 0) ? null : (r.lastHitBy ?? { player: net.id, team: net.team });
        const by = hit?.player ?? null, byBot = hit?.bot ?? null, byTeam = hit?.team ?? null;
        netSend(MSG.BOT_DOWN, { bot: r.netBot ?? '', name, team: e ? e.team : null, by, byBot, byTeam, xp: r.xpValue });
        if (e) { e.au = null; e.respawnAt = performance.now() + BOT_RESPAWN_MS; }
        if (byBot) rewardAce(aceNamed(byBot), BOT_XP * (r.level ?? 1)); // the killer bot grows
        if (e || (by !== null && by !== net.id)) feed(downText(name, by, byBot), by === net.id);
    });
    // A bot shot a player down (DOWN comes to everyone, the host included): the bot gets the XP
    onNet(MSG.DOWN, m => { if (hosting && m.by === null && m.bot) rewardAce(aceNamed(m.bot), PVP_KILL_XP); });
    onNet(MSG.BOT_DOWN, m => {
        if (hosting) return;
        removeBot(m.bot, !m.gone);
        if (m.gone) return;
        if (m.by === net.id) { awardKill(+m.xp || 0); feed(`★ You shot down ${m.name}  +${m.xp} XP`, true); }
        else feed(downText(m.name, m.by, m.byBot), false);
    });
    onHook('radarBlips', blips => {
        for (const b of bots.values()) if (b.shown) blips.push({ wx: b.group.position.x, wz: b.group.position.z, color: b.team === null ? '#ff33cc' : TEAMS[b.team].css, shape: 'ace', label: b.name });
    });
    onNet('offline', () => { if (hosting) setHosting(false); clearGuestBots(); });
}
const downText = (name, by, byBot) => (by !== null && by !== undefined ? `${nameOf(by)} shot down ${name}` : byBot ? `${byBot} shot down ${name}` : `✈ ${name} crashed`);

/** Per rendered frame. */
export function updateBots(rawDelta) {
    if (!enemies) return;
    if (isHost() !== hosting) setHosting(isHost());
    if (hosting) {
        if (teams && (reconcileTimer -= rawDelta) <= 0) { reconcileTimer = 1; reconcileTeams(performance.now()); }
        updateHostViews();
        if ((sendTimer -= rawDelta * 1000) <= 0) { sendTimer = SEND_MS; if (net.peers.size) shareBots(); else hitsOwed.clear(); }
    } else if (net.status === 'online') updateGuestBots();
}

/** Bots whose gunfire remoteFx.js draws: the host's (at remote pilots) or the ones the host shares. */
export const botViews = () => (hosting ? hostViews.values() : bots.values());

/** Roster rows: every bot in the room { name, lvl, hp, team, target, down }. */
export function botRoster() {
    if (!hosting) return [...bots.values()].filter(b => b.shown).map(b => ({ name: b.name, lvl: b.lvl, hp: b.hp, team: b.team, target: b.target }));
    if (teams) return [...teamBots.values()].map(e => ({ name: e.name, lvl: e.au?.level ?? 1, hp: e.au ? Math.round(e.au.hp) : 0, team: e.team, down: !e.au }));
    return rivalList().filter(r => r.hp > 0).map(r => ({ name: displayName(r), lvl: r.level ?? Math.max(1, Math.round(r.xpValue / 400)), hp: Math.round(r.hp), team: null, target: r.ai.targetId === 'local' ? net.id : r.ai.targetId }));
}

/** Who shot this player down, if a bot did in the last 10 s: { bot, byTeam } for DOWN, or null. */
export function botKiller() {
    if (hosting) return hostKiller();
    return lastBotHit && performance.now() - lastBotHit.at < 10000 ? { bot: lastBotHit.bot, byTeam: lastBotHit.byTeam } : null;
}

/** For tests and debugging. */
export const botStats = () => ({ hosting, teams, bots: [...bots.values()].map(b => ({ id: b.id, name: b.name, team: b.team, hp: b.hp, shown: b.shown, proxy: !!b.unit })),
    aces: rivalList().filter(r => !r.gone).length, teamBots: [...teamBots.values()].map(e => ({ name: e.name, team: e.team, up: !!e.au })), missiles: missiles.size });
