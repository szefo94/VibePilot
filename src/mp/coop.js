/**
 * Shared enemies (co-op, also inside PvP). Every player builds the same enemy bases from the room's map seed, so
 * the units line up by creation order: 'g<i>' ground units and 'a<i>' air units get the same net id everywhere.
 *
 *   damage   a hit you land is sent as UNIT_HIT; the others apply it with beginHits(…, { remote: true }) — no
 *            rewards, no notifications (the shooter's notification arrives as an EVENT instead). HP and deaths
 *            therefore match everywhere; the kill reward goes to the player who landed the killing hit.
 *   joining  the server keeps each unit's damage totals and sends them in WELCOME; a late joiner (or someone who
 *            reconnects) applies whatever it hasn't applied yet
 *   movement ground units never move. Air units follow the same rules everywhere, but frame timing drifts them
 *            apart slowly, so the room's host sends their positions twice a second (WORLD) and the others snap to them.
 *   fire     each player's copy of an enemy shoots at that player, so everyone gets shot at by the same units.
 */
import { airUnits, groundUnits } from '../entities/registry.js';
import { beginHits } from '../combat/hits.js';
import { onHook } from '../game/hooks.js';
import { MSG } from '../net/protocol.js';
import { isHost, net, netSend, onNet } from '../net/net.js';

const units = new Map();   // net id → unit
const applied = new Map(); // `${id}|${weapon}` → damage already applied here (ours and others')
const pending = [];        // damage that arrived before the world existed
let ready = false, worldTimer = 0;

const idOf = u => u.userData?.netId ?? u.netId;
const r = (v, d) => +v.toFixed(d);

function apply(id, weapon, dmg) {
    if (!ready) { pending.push([id, weapon, dmg]); return; }
    const key = `${id}|${weapon}`;
    applied.set(key, (applied.get(key) ?? 0) + dmg);
    const unit = units.get(id);
    if (!unit) return;
    const hits = beginHits(weapon, { remote: true });
    hits.damage(unit, dmg);
    hits.finish();
}

export function startCoop() {
    onHook('worldReady', () => {
        groundUnits.forEach((u, i) => { u.userData.netId = `g${i}`; units.set(`g${i}`, u); });
        airUnits.filter(a => !a.proxy).forEach((a, i) => { a.netId = `a${i}`; units.set(`a${i}`, a); });
        ready = true;
        for (const p of pending.splice(0)) apply(...p);
    });
    // Our hits → everyone else
    onHook('unitHit', (unit, amount, weapon) => {
        const id = idOf(unit);
        if (!id) return;
        const key = `${id}|${weapon}`;
        applied.set(key, (applied.get(key) ?? 0) + amount);
        netSend(MSG.UNIT_HIT, { n: id, dmg: r(amount, 2), w: weapon });
    });
    onNet(MSG.UNIT_HIT, m => apply(m.n, m.w, m.dmg));
    // Joining: catch up on everything the room has done (only the part not applied here yet)
    onNet('online', m => {
        for (const [id, byWeapon] of Object.entries(m.units ?? {})) {
            for (const [weapon, total] of Object.entries(byWeapon)) {
                const missing = total - (applied.get(`${id}|${weapon}`) ?? 0);
                if (missing > 0.01) apply(id, weapon, missing);
            }
        }
    });
    // Moving air units: the host's positions win
    onNet(MSG.WORLD, m => {
        if (!ready || !Array.isArray(m.u)) return;
        for (const e of m.u) {
            const a = units.get(e[0]);
            if (!a || !(a.hp > 0)) continue;
            if (e.length === 2 && a.orbitCenter) a.orbitAngle = e[1];
            else if (e.length === 7 && a.velocity) { a.group.position.set(e[1], e[2], e[3]); a.velocity.set(e[4], e[5], e[6]); }
        }
    });
}

/** Per rendered frame: the host shares its air-unit positions twice a second. */
export function updateCoop(rawDelta) {
    if (!ready || !isHost() || net.peers.size === 0 || (worldTimer -= rawDelta) > 0) return;
    worldTimer = 0.5;
    const u = [];
    for (const [id, a] of units) {
        if (id[0] !== 'a' || !(a.hp > 0)) continue;
        if (a.velocity) u.push([id, ...a.group.position.toArray().map(v => r(v, 1)), ...a.velocity.toArray().map(v => r(v, 4))]);
        else if (a.orbitCenter) u.push([id, r(a.orbitAngle, 4)]);
    }
    if (u.length) netSend(MSG.WORLD, { u });
}

/** For tests and debugging: what this client has synced. */
export const coopStats = () => ({ ready, units: units.size, pending: pending.length, applied: Object.fromEntries(applied) });
