/**
 * Entity contract: one way to ask any unit for its kind, HP, liveness, hostility and world position.
 *
 * The game spawns three unit shapes (kept as-is for their model and AI code):
 * @typedef {THREE.Object3D & { userData: { type: string, hp: number, maxHp: number, isHostile: boolean, collisionRadius: number, baseId?: string, protector?: THREE.Object3D|null } }} GroundUnit
 *   ground and sea units — stats live in userData; airport turrets are parented to their airport
 * @typedef {{ id: string, type: string, group: THREE.Group, hp: number, maxHp: number, isHostile: boolean, collisionRadius: number, baseId: string|null }} AirUnit
 * @typedef {{ id: string, parts: THREE.Mesh[], label: object }} LegacyFighter
 *   the old four-part fighters — HP lives on the parts
 * @typedef {GroundUnit|AirUnit|LegacyFighter} Entity
 *
 * Code that only needs these facts should use the helpers below instead of reaching into each shape.
 */
import { airUnits, enemies, groundUnits } from './registry.js';
import { groundUnitWorldPos } from '../combat/damage.js';

/** @param {Entity} e @returns {'ground'|'air'|'fighter'} */
export const entityKind = e => (e.parts ? 'fighter' : e.group ? 'air' : 'ground');

/** Current HP. A legacy fighter's is the sum of its parts, so overkill on one part doesn't count against the others. @param {Entity} e */
export function entityHp(e) {
    const kind = entityKind(e);
    if (kind === 'ground') return e.userData.hp;
    if (kind === 'air') return e.hp;
    return e.parts.reduce((hp, p) => hp + Math.max(0, p.userData.hp), 0);
}

/** @param {Entity} e */
export const isAlive = e => entityHp(e) > 0;

/** Legacy fighters always attack the player. @param {Entity} e */
export function isHostile(e) {
    const kind = entityKind(e);
    return kind === 'ground' ? !!e.userData.isHostile : kind === 'air' ? !!e.isHostile : true;
}

/** World-space position — a live vector, copy before modifying. @param {Entity} e @returns {THREE.Vector3} */
export function entityPosition(e) {
    const kind = entityKind(e);
    if (kind === 'ground') return groundUnitWorldPos(e);
    if (kind === 'air') return e.group.position;
    return (e.parts.find(p => p.userData.hp > 0) || e.parts[0]).position;
}

/** Everything missiles and the lock-on reticle may track: hostile ground units, all air units, legacy fighters. */
export function* missileTargets() {
    for (const u of groundUnits) if (isHostile(u)) yield u;
    yield* airUnits;
    yield* enemies;
}

/** Nearest living entity to `from`, or null. @param {THREE.Vector3} from @param {Iterable<Entity>} candidates */
export function nearestAlive(from, candidates) {
    let best = null, bestSq = Infinity;
    for (const e of candidates) {
        if (!isAlive(e)) continue;
        const d = entityPosition(e).distanceToSquared(from);
        if (d < bestSq) { bestSq = d; best = e; }
    }
    return best;
}
