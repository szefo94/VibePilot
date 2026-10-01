/**
 * Freaky mode in multiplayer: the host runs the plot (game/quests.js), the bosses (entities/bosses.js) and their
 * minions (entities/minions.js) for the whole room; everyone else shows it and joins in.
 *
 *   host    quests count every pilot (scouting, pickups); bosses fight the nearest pilot and minions chase anyone.
 *           Their hits on other players go out with BOSS (the server hands each to its target as BOT_FIRE). The quest
 *           goes out as QUEST (on every change, and once a second), the boss, its shots and minions as BOSS (10 Hz).
 *           Units a quest spawns go out as UNIT_SPAWN with a shared net id, so co-op damage sync covers them.
 *   others  build the same quest units, show the quest (tracker, comms, items, beacon), draw the boss as a proxy
 *           target (their hits go to the host as BOSS_HIT), its shots and strikes (visual only), and the minions;
 *           shooting a minion or shaking them off is reported (MINION_ACT).
 *   rewards quest, arc and boss XP go to everyone in the room.
 * Freaky mode follows the host's setting. If the host leaves, the next host starts the story again.
 */
import { scene } from '../core/scene.js';
import { plane } from '../player/plane.js';
import { state } from '../state.js';
import { airUnits } from '../entities/registry.js';
import { beginHits } from '../combat/hits.js';
import { addXP } from '../game/progression.js';
import { scoreElement } from '../ui/dom.js';
import { createUnitLabel } from '../ui/labels.js';
import { createExplosion } from '../effects/effects.js';
import { onHook, runHooks } from '../game/hooks.js';
import { setRules } from '../game/rules.js';
import { applyQuestSnapshot, makeQuestUnit, questSnapshot, remoteQuestEvent, setQuestAuthority, setQuestOptions, setQuestPilots } from '../game/quests.js';
import { BOSS_TYPES, applyRemoteFx, bossSnapshot, bossStatus, captureBossFx, clearRemoteBossFx, drainBossFx, setBossPilots, setRemoteBossStatus, shareBossReward } from '../entities/bosses.js';
import { applyMinionSnapshot, clearMinionGhosts, hitMinion, minionSnapshot, setMinionTargets, shakeOff, updateMinionGhosts } from '../entities/minions.js';
import { MSG } from '../net/protocol.js';
import { isHost, net, netSend, onNet } from '../net/net.js';
import { remoteViews } from './remotePlanes.js';
import { coopReady, registerSharedUnit } from './coop.js';

const SEND_MS = 100, QUEST_MS = 1000;
let hosting = null, sendTimer = 0, questTimer = 0, lastQuest = '', nextUnit = 5000, proxy = null, proxyWasUp = false;
const hits = [], events = [], spawnQueue = [];
const flareAt = new Map();
const _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

const pay = xp => { if (!xp || state.isGameOver) return; state.score += xp; scoreElement.textContent = state.score; addXP(xp); };
/** A host pilot id → ours: the host calls its own plane 'local'. */
const hostId = id => (id === 'local' ? net.id : id);
const ourId = id => (id === net.id ? 'local' : id);

// Pilots: this plane and every shown remote plane
const localPilot = {
    id: 'local', local: true, get position() { return plane.position; }, get quaternion() { return plane.quaternion; },
    get speed() { return state.speed; }, get alive() { return !state.isGameOver && !state._playerDown; }, get flares() { return state.flareTimer > 0; },
};
function pilots() {
    const list = [localPilot];
    for (const v of remoteViews()) if (v.shown) list.push({ id: v.id, local: false, position: v.group.position, quaternion: v.group.quaternion, speed: v.speed ?? 0, maxHP: v.maxHp ?? 100, alive: true, flares: performance.now() - (flareAt.get(v.id) ?? -1e9) < 3000 });
    return list;
}

function setHosting(on) {
    hosting = on;
    setRules({ bosses: on });                 // only the host's game runs bosses and the story
    setQuestAuthority(on);
    shareBossReward(on);
    captureBossFx(on);
    clearProxy(); clearMinionGhosts();
    if (on) {
        setQuestPilots(() => pilots().map(p => p.position));
        setQuestOptions({ newBases: false });
        setBossPilots(pilots, (id, dmg) => hits.push({ target: id, dmg, w: 'boss', bot: bossStatus()?.name ?? 'BOSS' }));
        setMinionTargets(pilots, (id, dmg) => hits.push({ target: id, dmg, w: 'bite', bot: 'PARASITE' }));
        setRemoteBossStatus(null);
    } else {
        setQuestPilots(null);
        setBossPilots(pilots, null); // visual homing toward the right plane
        setMinionTargets(null, null);
        setRemoteBossStatus(() => (proxy ? { kind: proxy.kind, name: proxy.boss.def.name, title: proxy.boss.def.title, color: proxy.boss.def.color, hp: proxy.hp, maxHp: proxy.maxHp, enraged: proxy.enraged, phase: proxy.phase, position: proxy.group.position } : null));
    }
}

// --- The others: the host's boss as a proxy target -------------------------------------------------------------------
function makeProxy(s) {
    const def = BOSS_TYPES[s.kind], model = def.build();
    scene.add(model.group);
    proxy = {
        id: 'boss-remote', type: 'boss', kind: s.kind, group: model.group, hp: s.hp, maxHp: s.maxHp, collisionRadius: def.radius, xpValue: 0,
        isHostile: true, baseId: null, label: createUnitLabel(def.name, 99, s.hp, s.hp), shootCooldown: 0, userData: { baseId: null },
        boss: { def, kind: s.kind, rewardXp: s.xp, charge: 0, attack: null, enraged: false, walking: false }, model, t: 0, to: new THREE.Vector3(...s.p), ry: s.ry,
        proxy: { damage: (amount, w) => netSend(MSG.BOSS_HIT, { dmg: +amount.toFixed(2), w }) },
        beam: null,
    };
    proxy.group.position.copy(proxy.to); proxy.group.rotation.y = s.ry;
    airUnits.push(proxy);
    runHooks('bossEvent', 'spawn', proxy);
}
function clearProxy() {
    if (!proxy) return;
    const i = airUnits.indexOf(proxy); if (i >= 0) airUnits.splice(i, 1);
    scene.remove(proxy.group);
    if (proxy.beam) scene.remove(proxy.beam.warn, proxy.beam.mesh);
    proxy = null;
    clearRemoteBossFx();
}
function updateProxyState(s) {
    if (!s) { if (proxy) { createExplosion(proxy.group.position, 3); clearProxy(); } return; }
    if (proxy && proxy.kind !== s.kind) clearProxy();
    if (!proxy) makeProxy(s);
    Object.assign(proxy, { hp: s.hp, maxHp: s.maxHp, phase: s.phase, enraged: s.enraged, ry: s.ry });
    Object.assign(proxy.boss, { charge: s.charge, attack: s.attack, enraged: s.enraged, walking: s.walking, rewardXp: s.xp });
    proxy.to.set(...s.p);
    proxy.beamState = s.beam;
}
function animateProxy(dt) {
    if (!proxy) return;
    const g = proxy.group;
    proxy.t += dt / 60;
    g.position.lerp(proxy.to, Math.min(1, 0.2 * dt));
    const dy = ((proxy.ry - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    g.rotation.y += dy * Math.min(1, 0.2 * dt);
    proxy.model.animate(proxy.t, proxy.boss);
    // The beam, as the host has it
    const bs = proxy.beamState;
    if (bs && !proxy.beam) {
        const color = proxy.boss.def.shot;
        const warn = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
        scene.add(warn, mesh); proxy.beam = { warn, mesh };
    }
    if (!bs && proxy.beam) { scene.remove(proxy.beam.warn, proxy.beam.mesh); proxy.beam = null; }
    if (bs && proxy.beam) {
        _v.fromArray(bs.aim);
        for (const m of [proxy.beam.warn, proxy.beam.mesh]) { m.position.fromArray(bs.from).addScaledVector(_v, bs.len / 2); m.quaternion.setFromUnitVectors(_up, _v); m.scale.set(1, bs.len, 1); }
        proxy.beam.warn.visible = !bs.firing; proxy.beam.mesh.visible = bs.firing;
    }
}

// --- Quest units: the same everywhere --------------------------------------------------------------------------------
function buildSpawn({ id, spec }) {
    if (!coopReady()) { spawnQueue.push({ id, spec }); return; } // the world isn't built yet: later
    registerSharedUnit(id, makeQuestUnit(spec));
}

export function startPlot() {
    onNet(MSG.FIRE, m => { if (m.w === 'flare') flareAt.set(m.from, performance.now()); });
    // Host side
    onHook('questSpawn', (unit, spec) => {
        if (!hosting) return;
        const id = `${spec.air ? 'a' : 'g'}${nextUnit++}`;
        registerSharedUnit(id, unit);
        netSend(MSG.UNIT_SPAWN, { id, spec });
    });
    onHook('questEvent', (event, q) => { if (hosting) { lastQuest = ''; netSend(MSG.QUEST, { q: questSnapshot(), event, xp: q?.xp }); } });
    onHook('bossEvent', (event, au) => {
        if (!hosting || au === proxy) return;
        events.push([event]);
        if (event === 'defeat') pay(au.boss.rewardXp); // shared: the host's own share (hits.js paid nobody)
    });
    onNet(MSG.BOSS_HIT, m => {
        if (!hosting) return;
        const au = airUnits.find(a => a.isBoss && a.hp > 0);
        if (!au || !(m.dmg > 0)) return;
        const h = beginHits(m.w, { remote: true }); h.damage(au, m.dmg); h.finish();
    });
    onNet(MSG.MINION_ACT, m => { if (!hosting) return; if (m.hit != null) hitMinion(m.hit); if (m.shake) shakeOff(m.from); });
    // The others
    onNet(MSG.UNIT_SPAWN, m => { if (!hosting) buildSpawn(m); });
    onNet(MSG.QUEST, m => {
        if (hosting) return;
        applyQuestSnapshot(m.q);
        if (m.event && m.q) runHooks('questEvent', m.event, { ...remoteQuestEvent(m.q), xp: m.xp });
        if (m.event === 'complete' || m.event === 'arcComplete') pay(m.xp);
    });
    onNet(MSG.BOSS, m => {
        if (hosting) return;
        for (const [event] of m.ev ?? []) { // before the state: a defeat arrives with the boss already gone
            if (event === 'spawn') continue; // shown when the proxy appears
            if (proxy) runHooks('bossEvent', event, proxy);
            if (event === 'defeat') pay(proxy?.boss.rewardXp ?? m.s?.xp);
        }
        updateProxyState(m.s);
        applyRemoteFx(m.fx ?? [], ourId);
        applyMinionSnapshot(m.m ?? [], id => id === net.id);
    });
    onHook('minionHit', id => { if (!hosting) netSend(MSG.MINION_ACT, { hit: id }); });
    onHook('minionShake', () => { if (!hosting) netSend(MSG.MINION_ACT, { shake: true }); });
    onHook('radarBlips', blips => { if (proxy) blips.push({ wx: proxy.group.position.x, wz: proxy.group.position.z, color: proxy.boss.def.color, shape: 'ace', label: `☠ ${proxy.boss.def.name}` }); });
    // Joining: the quest units already spawned, the current quest
    onNet('online', m => {
        for (const sp of m.spawns ?? []) buildSpawn(sp);
        if (!isHost()) applyQuestSnapshot(m.quest ?? null);
    });
    onHook('worldReady', () => { for (const sp of spawnQueue.splice(0)) buildSpawn(sp); });
    onNet('offline', () => { clearProxy(); clearMinionGhosts(); hosting = null; });
}

/** Per rendered frame (src/mp/index.js). */
export function updatePlot(rawDelta) {
    if (net.status !== 'online') return;
    if (isHost() !== hosting) setHosting(isHost());
    const dt = Math.min(rawDelta * 60, 6);
    if (hosting) {
        if ((questTimer -= rawDelta * 1000) <= 0) {
            questTimer = QUEST_MS;
            const q = questSnapshot(), key = JSON.stringify(q);
            if (key !== lastQuest) { lastQuest = key; netSend(MSG.QUEST, { q }); }
        }
        if ((sendTimer -= rawDelta * 1000) <= 0) {
            sendTimer = SEND_MS;
            const s = bossSnapshot(), fx = drainBossFx(), mm = minionSnapshot();
            if (s || fx.length || mm.length || hits.length || events.length || proxyWasUp) {
                netSend(MSG.BOSS, { s, fx, m: mm, ev: events.splice(0), hits: hits.splice(0, 20).map(h => ({ ...h, target: hostId(h.target) })) });
                proxyWasUp = !!(s || mm.length);
            }
        }
    } else {
        animateProxy(dt);
        updateMinionGhosts(dt);
    }
}
