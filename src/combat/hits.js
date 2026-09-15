/**
 * One damage pipeline for every weapon: eligibility → HP → label → death → reward → hit feedback.
 *
 *   const hits = beginHits('missile');
 *   hits.damage(target, amount);          // returns true when the target took damage
 *   hits.finish();                        // deaths, rewards, hit marker + sound (once per shot/explosion)
 *
 * Targets: ground units (Object3D with userData.hp), air units ({ group, hp }), legacy fighters ({ parts }).
 * A bullet damages the fighter part it struck (`{ part }`); splash damages every part.
 * Deaths are applied in finish(), after the caller's scans, because removal mutates the arrays being
 * scanned; a target killed twice in one blast dies — and rewards — once.
 */
import { state } from '../state.js';
import { _playKeyClick } from '../audio.js';
import { updateUnitLabel } from '../ui/labels.js';
import { canDamageGround } from './damage.js';
import { killGroundUnit } from '../entities/groundUnits.js';
import { destroyAirUnit, destroyLogicalEnemy } from '../entities/airUnits.js';

export const targetKind = t => (t.parts ? 'fighter' : t.group ? 'air' : 'ground');
const fighterHp = f => f.parts.reduce((hp, p) => hp + Math.max(0, p.userData.hp), 0);

export function beginHits(weapon) {
    const dead = new Set();
    let anyHit = false;
    return {
        damage(target, amount, { part = null } = {}) {
            if (dead.has(target)) return false;
            const kind = targetKind(target);
            if (kind === 'ground') {
                if (!canDamageGround(target, weapon)) return false;
                target.userData.hp -= amount;
                updateUnitLabel(target.userData.label, target.userData.hp);
                if (target.userData.hp <= 0) dead.add(target);
            } else if (kind === 'air') {
                if (!(target.hp > 0)) return false;
                target.hp -= amount;
                target.userData.hp = target.hp;
                updateUnitLabel(target.label, target.hp);
                if (target.hp <= 0) dead.add(target);
            } else {
                if (fighterHp(target) <= 0) return false;
                if (part) part.userData.hp -= amount;
                else target.parts.forEach(p => { p.userData.hp -= amount; });
                const hp = fighterHp(target); // overkill on one part doesn't drain the others
                updateUnitLabel(target.label, hp);
                if (hp <= 0) dead.add(target);
            }
            anyHit = true;
            return true;
        },
        finish() {
            for (const target of dead) {
                const kind = targetKind(target);
                if (kind === 'ground') killGroundUnit(target);
                else if (kind === 'air') destroyAirUnit(target);
                else destroyLogicalEnemy(target.id);
            }
            if (anyHit) { state._hitMarkerTimer = 9; _playKeyClick(); } // idea 4: hit confirm
            return { hit: anyHit, kills: dead.size };
        },
    };
}
