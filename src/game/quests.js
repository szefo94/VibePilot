/**
 * Freaky mode is a plot: arcs of quests (game/questData.js) that build up to a boss finale.
 *
 *   flow      Freaky mode on → after a short wait the first quest is briefed (a radio message), its goal is shown in
 *             the tracker, a beacon of light stands over the objective and its targets are marked on the minimap.
 *             Completing it pays XP and briefs the next; the arc's last step is its boss. Beating the boss completes
 *             the arc (a bonus) and the next arc begins; after all of them a harder act starts over.
 *   targets   a destroy quest aims at units of that kind that already exist (the nearest ones); only when too few
 *             are left does it spawn new ones. A base quest takes the nearest enemy base, or builds a new one.
 *   variants  a step with several variants takes the first whose targets exist right now.
 *   escapes   a boss that escapes comes back after a while ("It's back!").
 *
 * Events go out through the 'questEvent' hook (ui/questHud.js; multiplayer shares them). One quest at a time.
 */
import { MAP_BOUNDARY, ceilingLevel, groundLevel, waterLevel } from '../config.js';
import { state } from '../state.js';
import { scene } from '../core/scene.js';
import { settings, onSettingChange } from '../core/settings.js';
import { plane } from '../player/plane.js';
import { airUnits, baseMarkers, groundUnits } from '../entities/registry.js';
import { createAirUnit } from '../entities/airUnits.js';
import { createGroundUnit } from '../entities/groundUnits.js';
import { spawnForwardBase } from '../entities/bases.js';
import { bossStatus, findSpot, spawnBoss } from '../entities/bosses.js';
import { groundUnitWorldPos } from '../combat/damage.js';
import { heightAt } from '../world/terrain.js';
import { getNearestIslet } from '../world/world.js';
import { createExplosion } from '../effects/effects.js';
import { _playCollectYellow } from '../audio.js';
import { addXP } from './progression.js';
import { scoreElement } from '../ui/dom.js';
import { onHook, runHooks } from './hooks.js';
import { RULES } from './rules.js';
import { ARCS, SPEAKERS } from './questData.js';

export const QUEST = Object.freeze({ firstDelay: 8 * 60, nextDelay: 6 * 60, bossReturn: 45 * 60, questXp: 220, arcXp: 600, pickupRadius: 16, actHp: 0.35 });
const AIR = new Set(['helicopter', 'fighter', 'ac130', 'tanker']);

let quest = null;        // the current quest: { arc, arcIndex, step, title, text, speaker, goal, act }
let order = [], arcPos = 0, stepIdx = 0, act = 1, wait = QUEST.firstDelay, place = null, returnIn = 0;
const items = [];        // collect quests: { mesh, pos, taken }
let beacon = null;

const alive = u => (u.group ? u.hp > 0 && airUnits.includes(u) : u.userData.hp > 0 && !!u.parent);
const posOf = u => (u.group ? u.group.position : groundUnitWorldPos(u));
const kindOf = u => (u.group ? u.type : u.userData.type);
const near = (list, p) => list.sort((a, b) => posOf(a).distanceToSquared(p) - posOf(b).distanceToSquared(p));
const shuffled = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(([, v]) => v);

// --- Places --------------------------------------------------------------------------------------------------------
/** A gentle patch of low land 600–1300 from `from` (for spawned ground units), or null. */
function landSpot(from) {
    for (let i = 0; i < 160; i++) {
        const a = Math.random() * Math.PI * 2, d = 500 + Math.random() * 800, x = from.x + Math.cos(a) * d, z = from.z + Math.sin(a) * d;
        if (Math.abs(x) > MAP_BOUNDARY * 0.8 || Math.abs(z) > MAP_BOUNDARY * 0.8) continue;
        const h = heightAt(x, z);
        if (h < waterLevel + 3 || h > waterLevel + 45) continue;
        if ([[25, 0], [-25, 0], [0, 25], [0, -25]].every(([dx, dz]) => Math.abs(heightAt(x + dx, z + dz) - h) < 6)) return new THREE.Vector3(x, h, z);
    }
    return null;
}
/** A point for a scout / collect goal. */
function pointFor(where) {
    if (where === 'place' && place) return place.clone();
    if (where === 'high') { const p = landSpot(plane.position) ?? plane.position.clone(); return p.setY(ceilingLevel - 18); }
    const s = findSpot(where === 'place' ? 'sea' : where);
    return s ? new THREE.Vector3(s.x, s.ground, s.z) : null;
}

// --- Spawning missing targets ----------------------------------------------------------------------------------------
function spawnUnits(unit, n) {
    const out = [];
    if (AIR.has(unit)) {
        const c = (place ?? plane.position).clone();
        const a = Math.random() * Math.PI * 2;
        c.x += Math.cos(a) * 500; c.z += Math.sin(a) * 500;
        for (let i = 0; i < n; i++) {
            const x = THREE.MathUtils.clamp(c.x + (Math.random() - 0.5) * 240, -MAP_BOUNDARY * 0.8, MAP_BOUNDARY * 0.8), z = THREE.MathUtils.clamp(c.z + (Math.random() - 0.5) * 240, -MAP_BOUNDARY * 0.8, MAP_BOUNDARY * 0.8);
            const y = Math.max(heightAt(x, z), waterLevel) + 90 + Math.random() * 40;
            const au = createAirUnit(unit, x, y, z);
            if (unit === 'fighter' || unit === 'tanker') { const h = Math.random() * Math.PI * 2, s = unit === 'fighter' ? 0.12 : 0.04; au.velocity = new THREE.Vector3(Math.sin(h) * s, 0, Math.cos(h) * s); }
            else { au.orbitCenter = new THREE.Vector3(x, y, z); au.orbitAngle = Math.random() * Math.PI * 2; au.orbitRadius = unit === 'ac130' ? 220 : 90; au.orbitSpeed = (unit === 'ac130' ? 0.002 : 0.005) * (Math.random() < 0.5 ? -1 : 1); au.orbitAltitude = y; }
            airUnits.push(au); out.push(au);
        }
        return out;
    }
    const sea = unit === 'destroyer';
    const at = sea ? (s => s && new THREE.Vector3(s.x, waterLevel, s.z))(findSpot('sea')) : landSpot(place ?? plane.position);
    if (!at) return out;
    for (let i = 0; i < n; i++) {
        const u = createGroundUnit(unit), x = at.x + (i - (n - 1) / 2) * (sea ? 90 : 30), z = at.z + (Math.random() - 0.5) * 30;
        u.position.set(x, sea ? u.position.y : u.position.y + (heightAt(x, z) - (groundLevel + 2)), z); // units are modelled standing on groundLevel + 2
        u.rotation.y = Math.random() * Math.PI * 2;
        groundUnits.push(u); scene.add(u); out.push(u);
    }
    return out;
}

// --- Goals -----------------------------------------------------------------------------------------------------------
const existing = unit => (AIR.has(unit) ? airUnits.filter(a => a.type === unit && alive(a) && !a.proxy && !a.isRival && !a.isBoss) : groundUnits.filter(u => u.userData.type === unit && alive(u) && u.userData.isHostile !== false));
function viable(v) {
    const g = v.goal;
    if (g.type === 'destroy') return existing(g.unit).length > 0;
    if (g.type === 'base') return baseMarkers.some(b => !b.eliminated && b.isHostile && b.alive > 0);
    return true;
}
function resolve(v) {
    const g = { ...v.goal, done: 0 };
    if (g.type === 'destroy') {
        g.targets = near(existing(g.unit), place ?? plane.position).slice(0, g.count);
        if (g.targets.length < g.count) g.targets.push(...spawnUnits(g.unit, g.count - g.targets.length)); // too few left: new ones
        g.count = g.targets.length;
        g.targets.forEach(t => { if (t.group) t.questTarget = true; else t.userData.questTarget = true; });
    } else if (g.type === 'base') {
        let bm = baseMarkers.filter(b => !b.eliminated && b.isHostile && b.alive > 0).sort((a, b) => a.position.distanceToSquared(plane.position) - b.position.distanceToSquared(plane.position))[0];
        if (!bm) { const at = landSpot(plane.position), islet = at && getNearestIslet(at.x, at.z); if (islet) { spawnForwardBase(at.x, at.z, islet); bm = baseMarkers[baseMarkers.length - 1]; } } // all gone: a new one
        g.base = bm ?? null;
    } else if (g.type === 'scout') {
        g.point = pointFor(g.where) ?? plane.position.clone().add(new THREE.Vector3(600, 0, 0));
        if (!place && g.where !== 'high') place = g.point.clone();
    } else if (g.type === 'collect') {
        const c = pointFor(g.where) ?? plane.position.clone();
        if (!place && g.where !== 'high') place = c.clone();
        for (let i = 0; i < g.count; i++) {
            const a = (i / g.count) * Math.PI * 2 + Math.random() * 0.6, d = 80 + Math.random() * 140;
            const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
            const y = g.where === 'high' ? ceilingLevel - 10 - Math.random() * 25 : Math.max(heightAt(x, z), waterLevel) + 22 + Math.random() * 30;
            items.push(makeItem(new THREE.Vector3(x, y, z), g.item));
        }
    } else if (g.type === 'boss') {
        const kind = ARCS[order[arcPos]].boss;
        const au = spawnBoss(kind, { near: place, hpMul: 1 + QUEST.actHp * (act - 1) });
        g.boss = au; g.kind = kind;
        if (!au) returnIn = 10 * 60; // nowhere to appear yet (or another boss is up): try again shortly
    }
    return g;
}
function progress(g) {
    if (g.type === 'destroy') return { done: g.targets.filter(t => !alive(t)).length, need: g.count };
    if (g.type === 'base') return { done: g.base ? (g.base.eliminated || g.base.alive <= 0 ? 1 : 0) : 1, need: 1 };
    if (g.type === 'scout') { const d = Math.hypot(plane.position.x - g.point.x, plane.position.z - g.point.z); const ok = d < g.radius && (g.where !== 'high' || plane.position.y > ceilingLevel - 45); return { done: ok ? 1 : 0, need: 1 }; }
    if (g.type === 'collect') return { done: items.filter(i => i.taken).length, need: g.count };
    return { done: g.defeated ? 1 : 0, need: 1 };
}
/** Where the beacon stands: the nearest remaining target, item, base or point. */
function focus(g) {
    if (g.type === 'destroy') { const left = g.targets.filter(alive); return left.length ? posOf(near(left, plane.position)[0]) : null; }
    if (g.type === 'base') return g.base?.position ?? null;
    if (g.type === 'scout') return g.point;
    if (g.type === 'collect') { const left = items.filter(i => !i.taken); return left.length ? left.sort((a, b) => a.pos.distanceToSquared(plane.position) - b.pos.distanceToSquared(plane.position))[0].pos : null; }
    return g.boss && airUnits.includes(g.boss) ? g.boss.group.position : null;
}
/** What the tracker says. */
export function goalText(g, p) {
    if (g.type === 'destroy') return `Destroy ${g.unit === 'ac130' ? 'AC-130' : g.unit}${g.count > 1 ? 's' : ''} ${p.done}/${p.need}`;
    if (g.type === 'base') return `Eliminate ${g.base?.name ?? 'the base'}${g.base ? ` ${g.base.total - g.base.alive}/${g.base.total}` : ''}`;
    if (g.type === 'scout') return g.where === 'high' ? 'Climb to the ceiling over the beacon' : 'Fly to the beacon';
    if (g.type === 'collect') return `Collect ${g.item}s ${p.done}/${p.need}`;
    return `Defeat ${bossStatus()?.name ?? 'the boss'}${returnIn > 0 ? ' — it will return' : ''}`;
}

// --- Story items and the beacon -------------------------------------------------------------------------------------
const ITEM_COLOR = { 'sonar buoy': 0x59c8ff, 'ink sample': 0x9a4dff, 'biohazard canister': 0x9cff3a, 'moon shard': 0xe8e4ff };
function makeItem(pos, kind) {
    const color = ITEM_COLOR[kind] ?? 0xffd23a, g = new THREE.Group();
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(3, 1), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, flatShading: true, roughness: 0.3 }));
    const halo = new THREE.Mesh(new THREE.TorusGeometry(5, 0.35, 8, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }));
    g.add(gem, halo); g.position.copy(pos); scene.add(g);
    return { mesh: g, gem, halo, pos: pos.clone(), taken: false, t: Math.random() * 6 };
}
function clearItems() { for (const i of items) scene.remove(i.mesh); items.length = 0; }
function setBeacon(p) {
    if (!beacon) {
        beacon = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
        const core = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.35, depthWrite: false });
        beacon.add(new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 320, 16, 1, true), mat), new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 320, 10), core));
        beacon.children.forEach(m => { m.position.y = 160; m.userData.noHit = true; });
        scene.add(beacon);
    }
    beacon.visible = !!p;
    if (p) beacon.position.set(p.x, Math.max(heightAt(p.x, p.z), waterLevel), p.z);
}

// --- The flow --------------------------------------------------------------------------------------------------------
function begin() {
    if (!order.length) order = ['water', 'heat', ...shuffled(ARCS.slice(2).map(a => a.id))].map(id => ARCS.findIndex(a => a.id === id));
    const arc = ARCS[order[arcPos]], variants = arc.steps[stepIdx];
    const v = variants.find(viable) ?? variants[0];
    quest = { arc: arc.name, arcIndex: arcPos, arcCount: ARCS.length, step: stepIdx, steps: arc.steps.length, title: v.title, text: v.text, speaker: SPEAKERS[v.speaker], act, goal: null };
    quest.goal = resolve(v);
    runHooks('questEvent', 'start', quest);
}
function complete() {
    const g = quest.goal, last = stepIdx === ARCS[order[arcPos]].steps.length - 1;
    const xp = QUEST.questXp * act;
    state.score += xp; scoreElement.textContent = state.score; addXP(xp);
    runHooks('questEvent', 'complete', { ...quest, xp });
    for (const t of g.targets ?? []) { if (t.group) t.questTarget = false; else t.userData.questTarget = false; }
    clearItems();
    if (last) {
        const bonus = QUEST.arcXp * act;
        state.score += bonus; scoreElement.textContent = state.score; addXP(bonus);
        runHooks('questEvent', 'arcComplete', { ...quest, xp: bonus });
        stepIdx = 0; place = null;
        if (++arcPos >= order.length) { arcPos = 0; act++; order = []; }
    } else stepIdx++;
    quest = null; wait = QUEST.nextDelay;
}

/** Every simulation step (ai.js). */
export function updateQuests(dt) {
    const on = settings.freakyMode && RULES.bosses && !state.isGameOver && !state.awaitingStart;
    for (const i of items) { // spin, bob, pick up
        if (i.taken) continue;
        i.t += dt / 60;
        i.gem.rotation.y = i.t * 2; i.halo.rotation.set(Math.PI / 2 + Math.sin(i.t) * 0.3, i.t, 0);
        i.mesh.position.y = i.pos.y + Math.sin(i.t * 2) * 2;
        if (on && plane.position.distanceTo(i.mesh.position) < QUEST.pickupRadius) {
            i.taken = true; scene.remove(i.mesh); createExplosion(i.mesh.position, 0.6); _playCollectYellow();
            runHooks('questEvent', 'progress', quest);
        }
    }
    if (!on) { setBeacon(null); return; }
    if (!quest) { if ((wait -= dt) <= 0) begin(); setBeacon(null); return; }
    const g = quest.goal;
    if (g.type === 'boss' && returnIn > 0 && (returnIn -= dt) <= 0) {
        g.boss = spawnBoss(g.kind, { near: place, hpMul: 1 + QUEST.actHp * (act - 1) });
        if (g.boss) runHooks('questEvent', 'bossReturn', quest); else returnIn = 10 * 60;
    }
    const p = progress(g);
    quest.done = p.done; quest.need = p.need;
    setBeacon(focus(g));
    if (p.done >= p.need) complete();
}

onHook('bossEvent', (event, au) => {
    const g = quest?.goal;
    if (!g || g.type !== 'boss' || au !== g.boss) return;
    if (event === 'defeat') g.defeated = true;
    if (event === 'escape') returnIn = QUEST.bossReturn; // it will be back
});
onSettingChange((key, on) => {
    if (key !== 'freakyMode') return;
    if (on && !quest) wait = Math.min(wait, QUEST.firstDelay);
    if (!on) { clearItems(); setBeacon(null); if (quest) { quest = null; wait = QUEST.firstDelay; } }
});

/** The quest in progress (for the HUD, the minimap and tests), or null. */
export function questStatus() {
    if (!quest) return null;
    const p = progress(quest.goal);
    return { ...quest, done: p.done, need: p.need, objective: goalText(quest.goal, p), focus: focus(quest.goal), waitingFor: wait };
}
/** Quest targets for the minimap. */
export function questBlips(blips) {
    const g = quest?.goal;
    if (!g) return;
    for (const t of g.targets ?? []) if (alive(t)) { const p = posOf(t); blips.push({ wx: p.x, wz: p.z, color: '#ffd23a', shape: 'ring' }); }
    for (const i of items) if (!i.taken) blips.push({ wx: i.pos.x, wz: i.pos.z, color: '#ffd23a', shape: 'dot' });
    const f = focus(g);
    if (f) blips.push({ wx: f.x, wz: f.z, color: '#ffd23a', shape: 'square', label: `◆ ${quest.title}` });
}
/** For tests: skip ahead (finish the current goal). */
export function _debugComplete() { if (quest) { if (quest.goal.type === 'boss') quest.goal.defeated = true; else complete(); } }
export const questItems = () => items;
export const kindOfTarget = kindOf;
