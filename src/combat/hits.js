/**
 * One damage pipeline for every weapon: eligibility → HP → label → death → reward → hit feedback.
 *
 *   const hits = beginHits('missile');
 *   hits.damage(target, amount);          // returns true when the target took damage
 *   hits.finish();                        // deaths, rewards, hit marker + sound (once per shot/explosion)
 *
 * Targets: ground units (Object3D with userData.hp), air units ({ group, hp }), legacy fighters ({ parts }).
 * A proxy air unit (`proxy: { damage(amount, weapon) }`, e.g. another player in multiplayer) is owned elsewhere:
 * the hit is handed to its proxy and counts for feedback, but it takes no local HP loss and never dies here.
 * A bullet damages the fighter part it struck (`{ part }`); splash damages every part.
 * `beginHits(weapon, { remote: true })` applies damage that happened elsewhere (another player's hit, synced):
 * no hook, no rewards, no hit marker or sound, and no notifications.
 * `beginHits(weapon, { shooter })` is damage by someone else in this game (an ace): the unitHit hook runs (so
 * multiplayer syncs it), but no player reward, marker, sound or notification; finish() reports the XP of what
 * died so the shooter can be paid.
 * Deaths are applied in finish(), after the caller's scans, because removal mutates the arrays being
 * scanned; a target killed twice in one blast dies — and rewards — once.
 */
import { state } from '../state.js';
import { _playKeyClick, _playKillConfirm } from '../audio.js';
import { updateUnitLabel } from '../ui/labels.js';
import { canDamageGround } from './damage.js';
import { entityHp, entityKind, entityPosition } from '../entities/contract.js';
import { CLOSE_KILL_RANGE, markCloseKill } from '../game/progression.js';
import { plane } from '../player/plane.js';
import { killGroundUnit } from '../entities/groundUnits.js';
import { destroyAirUnit, destroyLogicalEnemy } from '../entities/airUnits.js';
import { runHooks } from '../game/hooks.js';
import { quietly } from '../ui/notifications.js';
import { onUnitDamaged } from '../effects/fire.js';

export function beginHits(weapon, { remote = false, shooter = null } = {}) {
    const dead = new Set();
    let anyHit = false;
    return {
        damage(target, amount, { part = null } = {}) {
            if (dead.has(target)) return false;
            const kind = entityKind(target);
            if (kind === 'ground') {
                if (!canDamageGround(target, weapon)) return false;
                target.userData.hp -= amount;
                updateUnitLabel(target.userData.label, target.userData.hp);
                onUnitDamaged(target, weapon, remote); // buildings burn as they're damaged; napalm sets anything alight
                if (target.userData.hp <= 0) dead.add(target);
            } else if (kind === 'air') {
                if (!(target.hp > 0) || (target.friendly && !remote)) return false; // allies: the player's weapons pass them by
                if (target.proxy) { target.proxy.damage(amount, weapon); anyHit = true; return true; }
                target.hp -= amount;
                updateUnitLabel(target.label, target.hp);
                if (target.hp <= 0 && !target.cheatDeath?.()) dead.add(target); // cheatDeath: the phoenix rises again once
            } else {
                if (entityHp(target) <= 0) return false;
                if (part) part.userData.hp -= amount;
                else target.parts.forEach(p => { p.userData.hp -= amount; });
                const hp = entityHp(target); // overkill on one part doesn't drain the others
                updateUnitLabel(target.label, hp);
                if (hp <= 0) dead.add(target);
            }
            if (!remote) runHooks('unitHit', target, amount, weapon, shooter);
            anyHit = true;
            return true;
        },
        finish() {
            const kill = () => {
                for (const target of dead) {
                    const kind = entityKind(target), reward = !remote && !shooter;
                    if (reward) markCloseKill(weapon === 'bullet' && entityPosition(target).distanceTo(plane.position) < CLOSE_KILL_RANGE); // gun kill up close: bonus
                    if (kind === 'ground') killGroundUnit(target, { reward });
                    else if (kind === 'air') destroyAirUnit(target, { reward });
                    else destroyLogicalEnemy(target.id, { reward });
                }
                markCloseKill(false);
            };
            const xp = [...dead].reduce((sum, t) => sum + (t.userData?.xpValue ?? t.xpValue ?? 0), 0);
            if (remote || shooter) { quietly(kill); return { hit: anyHit, kills: dead.size, xp }; }
            kill();
            if (dead.size) { state._killMarkerTimer = 20; state._hitMarkerTimer = Math.max(state._hitMarkerTimer, 20); _playKillConfirm(); } // kill: gold marker
            else if (anyHit) { state._hitMarkerTimer = 9; _playKeyClick(); } // idea 4: hit confirm
            return { hit: anyHit, kills: dead.size, xp };
        },
    };
}
