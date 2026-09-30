/**
 * Aces in multiplayer (modes with enemies). The room's host runs Ace Hunt as in single player (entities/rival.js),
 * but its aces hunt every player — the nearest living one — and the other players see them as bots:
 *
 *   host    RULES.ace on; setRivalTargets() adds the other players. An ace's shots at a remote player are hit rolls
 *           on the host, sent as BOT_FIRE (gun damage gathered per target, sent with each BOT). Ten times a second
 *           it shares every ace (BOT) and their missiles in flight. Hits other players land on an ace come in as
 *           BOT_HIT and are applied here (no reward); when an ace goes down BOT_DOWN names who shot it down.
 *   guests  draw each ace (its airframe, name tag with HP, tracers, missiles, minimap blip) as a proxy air unit, so
 *           every weapon, the lock-on and missile homing treat it like a target; hits are sent to the host. BOT_FIRE
 *           damages this player (flares stop it, as with any enemy fire); BOT_DOWN pays the shooter the ace's XP.
 *
 * If the host leaves, the next host starts its own Ace Hunt (the old aces vanish with it).
 */
import { scene, camera } from '../core/scene.js';
import { createExplosion } from '../effects/effects.js';
import { airUnits } from '../entities/registry.js';
import { createRivalVisual, localRivalTarget, rivalList, rivalMissilesInFlight, setRivalTargets } from '../entities/rival.js';
import { beginHits } from '../combat/hits.js';
import { damagePlayer } from '../combat/collision.js';
import { awardKill } from '../game/progression.js';
import { onHook } from '../game/hooks.js';
import { setRules } from '../game/rules.js';
import { FLARE_DURATION } from '../config.js';
import { state } from '../state.js';
import { showNotification } from '../ui/notifications.js';
import { MSG } from '../net/protocol.js';
import { isHost, net, netSend, onNet } from '../net/net.js';
import { buildLabel, drawLabel, remoteViews, sampleAt } from './remotePlanes.js';

const SEND_MS = 100, INTERP_DELAY = 150, STALE_MS = 3000, LABEL_RANGE = 600, FIRING_MS = 250;
const r2 = v => +v.toFixed(2), r4 = v => +v.toFixed(4);
const feed = (text, hl = false) => showNotification(text, hl, { local: true });

let enemies = false, hosting = false, sendTimer = 0, nextBotId = 1;

// --- Host -----------------------------------------------------------------------------------------------------
const flareAt = new Map();  // peer id → when their flares went out (performance.now())
const gunOwed = new Map();  // `${peer}|${bot name}` → gun damage to send with the next BOT
const hostViews = new Map(); // ace → { group, firing, speed, shown } for tracers at remote players (local ones are real bullets)

const remoteTargets = () => {
    const list = [localRivalTarget];
    for (const v of remoteViews()) {
        if (!v.shown) continue;
        list.push({ id: v.id, local: false, position: v.group.position, quaternion: v.group.quaternion, speed: v.speed ?? 0, alive: true,
            flares: performance.now() - (flareAt.get(v.id) ?? -1e9) < FLARE_DURATION / 60 * 1000 });
    }
    return list;
};
function onAceHit(targetId, damage, weapon) {
    const ace = rivalList().find(r => r.ai.targetId === targetId) ?? null, name = ace ? `ACE ${ace.callsign}` : 'ACE';
    if (weapon === 'missile') { netSend(MSG.BOT_FIRE, { target: targetId, dmg: damage, w: 'missile', bot: name }); return; }
    const key = `${targetId}|${name}`;
    gunOwed.set(key, (gunOwed.get(key) ?? 0) + damage);
}
function setHosting(on) {
    hosting = on;
    setRules({ ace: on });
    setRivalTargets(on ? remoteTargets : null, on ? onAceHit : null);
    clearGuestBots();
    if (on && net.peers.size) feed('☠ You host the aces now — they hunt every pilot in the room');
}
const botId = r => (r.netBot ??= `b${nextBotId++}`);
function shareAces() {
    const now = performance.now(), bots = [];
    for (const r of rivalList()) {
        if (!(r.hp > 0)) continue;
        bots.push({ id: botId(r), name: r.callsign, lvl: Math.max(1, Math.round(r.xpValue / 400)), s: r4(r.fl.speed),
            p: r.group.position.toArray().map(r2), q: r.group.quaternion.toArray().map(r4), hp: Math.round(r.hp), mh: r.maxHp,
            f: now - (r.firingAt ?? -1e9) < FIRING_MS ? 1 : 0, tg: r.ai.targetId === 'local' ? net.id : r.ai.targetId });
    }
    const m = rivalMissilesInFlight().filter(x => !x.userData.decoyed).slice(0, 8)
        .map(x => [(x.userData.netId ??= nextBotId++), ...x.position.toArray().map(r2), x.userData.targetId === 'local' ? net.id : x.userData.targetId]);
    netSend(MSG.BOT, { bots, m });
    for (const [key, dmg] of gunOwed) {
        const [target, bot] = key.split('|');
        netSend(MSG.BOT_FIRE, { target: Number(target), dmg: Math.round(dmg), w: 'gun', bot });
    }
    gunOwed.clear();
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

// --- Guests ---------------------------------------------------------------------------------------------------
const bots = new Map();     // bot id → { id, name, lvl, group, label, unit, samples, hp, mh, firing, speed, shown, seenAt }
const missiles = new Map(); // missile id → { mesh, p, v, at, target }
const outgoing = new Map(); // `${bot}|${weapon}` → damage to send to the host
const mslGeo = new THREE.CylinderGeometry(0.3, 0.3, 3, 6).rotateX(Math.PI / 2);
const mslMat = new THREE.MeshBasicMaterial({ color: 0xff2233 });
const warnEl = document.getElementById('rival-warning');
let lastAceHit = null, warned = '';

function botFor(m) {
    let b = bots.get(m.id);
    if (!b) {
        b = { id: m.id, name: String(m.name ?? 'Ace').slice(0, 16), lvl: m.lvl | 0, group: createRivalVisual(), samples: [], hp: 1, mh: 1, shown: false, firing: false, speed: 0 };
        b.label = buildLabel(`ACE ${b.name}`, 'ace'); b.label.sprite.scale.multiplyScalar(1.6);
        b.group.visible = b.label.sprite.visible = false;
        scene.add(b.group, b.label.sprite);
        // A proxy air unit (like other players in PvP): hits.js hands its hits to us, ai.js leaves it alone
        b.unit = {
            id: `bot-${m.id}`, type: 'fighter', group: b.group, hp: 0, maxHp: 1, xpValue: 0,
            collisionRadius: 10, wingHalfSpan: 14, wingR: 5, wingType: 'q', isHostile: true, baseId: null, label: null,
            userData: { baseId: null }, shootCooldown: 0,
            proxy: { damage: (amount, weapon) => { const k = `${m.id}|${weapon}`; outgoing.set(k, (outgoing.get(k) ?? 0) + amount); } },
        };
        airUnits.push(b.unit);
        bots.set(m.id, b);
        feed(`☠ ACE ${b.name.toUpperCase()} (LV ${b.lvl}) is hunting the room`, true);
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
    for (const e of m.bots.slice(0, 8)) {
        if (typeof e?.id !== 'string' || !Array.isArray(e.p) || !Array.isArray(e.q)) continue;
        const b = botFor(e);
        b.samples.push({ t: now, p: e.p, q: e.q, alive: true });
        if (b.samples.length > 10) b.samples.shift();
        Object.assign(b, { hp: +e.hp || 0, mh: +e.mh || 1, lvl: e.lvl | 0, speed: +e.s || 0, firing: !!e.f, target: Number.isInteger(e.tg) ? e.tg : null, seenAt: now });
    }
    const seen = new Set();
    for (const [id, x, y, z, target] of Array.isArray(m.m) ? m.m.slice(0, 8) : []) {
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
        b.unit.hp = b.shown ? b.hp : 0; b.unit.maxHp = b.mh;
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
    setWarning(threat && !state._playerDown ? '⚠ ACE MISSILE — FLARES (Q) / BREAK TURN' : '');
    for (const [key, dmg] of outgoing) {
        const [bot, w] = key.split('|');
        netSend(MSG.BOT_HIT, { bot, dmg: r2(dmg), w });
    }
    outgoing.clear();
}

// --- Both -----------------------------------------------------------------------------------------------------
export function startBots(withEnemies) {
    enemies = withEnemies;
    if (!enemies) return;
    onNet(MSG.FIRE, m => { if (m.w === 'flare') flareAt.set(m.from, performance.now()); });
    onNet(MSG.BOT, onBots);
    onNet(MSG.BOT_HIT, m => {
        if (!hosting) return;
        const ace = rivalList().find(r => r.netBot === m.bot && r.hp > 0);
        if (!ace || !(m.dmg > 0)) return;
        ace.lastHitBy = m.from;
        const hits = beginHits(m.w, { remote: true });
        hits.damage(ace, m.dmg);
        hits.finish();
    });
    onHook('unitHit', unit => { if (hosting && unit.isRival) unit.lastHitBy = net.id; });
    onNet(MSG.BOT_FIRE, m => {
        if (hosting || state._playerDown || state.isGameOver) return;
        if (state.flareTimer > 0 && m.w === 'missile') return; // flares decoy it, like any enemy missile
        lastAceHit = { name: m.bot, at: performance.now() };
        const src = [...bots.values()].find(b => `ACE ${b.name}` === m.bot)?.group.position;
        damagePlayer(m.dmg, src ?? camera.position);
    });
    onHook('rivalDown', r => {
        if (!hosting) return;
        const by = r.crashed || !(r.hp <= 0) ? null : (r.lastHitBy ?? net.id);
        netSend(MSG.BOT_DOWN, { bot: r.netBot ?? '', name: r.callsign, by, xp: r.xpValue });
        if (by !== null && by !== net.id) feed(`${net.peers.get(by)?.name ?? 'Someone'} shot down ACE ${r.callsign}`, true);
    });
    onNet(MSG.BOT_DOWN, m => {
        if (hosting) return;
        removeBot(m.bot, true);
        const name = `ACE ${String(m.name ?? '').toUpperCase()}`;
        if (m.by === net.id) { awardKill(+m.xp || 0); feed(`★ You shot down ${name}  +${m.xp} XP`, true); }
        else if (m.by === null) feed(`✈ ${name} crashed`);
        else feed(`${m.by === net.hostId || !net.peers.get(m.by) ? 'The host' : net.peers.get(m.by).name} shot down ${name}`, true);
    });
    onHook('radarBlips', blips => {
        for (const b of bots.values()) if (b.shown) blips.push({ wx: b.group.position.x, wz: b.group.position.z, color: '#ff33cc', shape: 'ace', label: `ACE ${b.name}` });
    });
    onNet('offline', () => { if (hosting) setHosting(false); clearGuestBots(); });
}

/** Per rendered frame. */
export function updateBots(rawDelta) {
    if (!enemies) return;
    if (isHost() !== hosting) setHosting(isHost());
    if (hosting) {
        updateHostViews();
        if ((sendTimer -= rawDelta * 1000) <= 0) { sendTimer = SEND_MS; if (net.peers.size) shareAces(); else gunOwed.clear(); }
    } else if (net.status === 'online') updateGuestBots();
}

/** Aces whose gunfire remoteFx.js draws: the host's (at remote players) or the ones the host shares. */
export const botViews = () => (hosting ? hostViews.values() : bots.values());

/** Roster rows: every ace in the room. */
export const botRoster = () => hosting
    ? rivalList().filter(r => r.hp > 0).map(r => ({ name: r.callsign, lvl: Math.max(1, Math.round(r.xpValue / 400)), hp: Math.round(r.hp), target: r.ai.targetId === 'local' ? net.id : r.ai.targetId }))
    : [...bots.values()].filter(b => b.shown).map(b => ({ name: b.name, lvl: b.lvl, hp: b.hp, target: b.target }));

/** The ace that last hit this player, if it was within the last 10 s (for "shot down by"). */
export const recentAceHit = () => (lastAceHit && performance.now() - lastAceHit.at < 10000 ? lastAceHit.name : null);

/** For tests and debugging. */
export const botStats = () => ({ hosting, bots: [...bots.values()].map(b => ({ id: b.id, name: b.name, hp: b.hp, shown: b.shown })), aces: rivalList().length, missiles: missiles.size });
