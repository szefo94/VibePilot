/** Per-frame HUD updates: stats, target distances, ammo bars, memory debug panel. */
import { TARGET_FPS, bulletDamage, maxPitchRate, maxRollRate, maxSpeed, maxYawRate, minSpeed } from '../config.js';
import { state } from '../state.js';
import { bombBarEl, bombStatusEl, bulletDamageValueElement, enemyDistanceElement, flareBarEl, flareStatusEl, groundDistanceElement, gunBarEl, gunStatusEl, markerDistanceElement, missileBarEl, missileStatusEl, napalmBarEl, napalmStatusEl, posXElement, posYElement, posZElement, ratePitchNeg, ratePitchPos, ratePitchVal, rateRollNeg, rateRollPos, rateRollVal, rateYawNeg, rateYawPos, rateYawVal, rotBnkElement, rotHdgElement, rotPchElement, speedBarEl } from './dom.js';
import { enemyArrow, groundTargetArrow, markerArrow, plane } from '../player/plane.js';
import { _rotFwd } from '../player/wingTrails.js';
import { enemies, groundUnits, markers } from '../entities/registry.js';

// HUD nearest-enemy cache — recomputed every 6 frames (~10 fps at 60 fps) (§3.1)
let _hudEnemyFrame = 0, _hudNearestEnemy = null, _hudNearestEnemyDist = Infinity;
export function updateDamageUI() { bulletDamageValueElement.textContent = Math.round(bulletDamage * state.playerDamageMultiplier); }

export function updateHUD() {
    let m = null, g = null, md = Infinity, gd = Infinity;
    markers.forEach(mk => { const d = plane.position.distanceToSquared(mk.position); if (d < md) { md = d; m = mk; } });
    groundUnits.forEach(u => { if (u.userData.isHostile && u.userData.hp > 0) { const d = plane.position.distanceToSquared(u.position); if (d < gd) { gd = d; g = u; } } });
    // Nearest enemy — recomputed every 6 frames (§3.1: 40 distance checks/frame → ~7 on average)
    if (++_hudEnemyFrame >= 6) {
        _hudEnemyFrame = 0;
        let ed = Infinity, e = null;
        enemies.forEach(en => en.parts.forEach(p => { const d = plane.position.distanceToSquared(p.position); if (d < ed) { ed = d; e = p; } }));
        _hudNearestEnemy = e; _hudNearestEnemyDist = ed;
    }
    const e = _hudNearestEnemy, ed = _hudNearestEnemyDist;
    if (m) { markerArrow.visible = true; markerArrow.lookAt(m.position); markerDistanceElement.textContent = `${Math.round(Math.sqrt(md))}m`; } else { markerArrow.visible = false; markerDistanceElement.textContent = 'N/A'; }
    if (g) { groundTargetArrow.visible = true; groundTargetArrow.lookAt(g.position); groundDistanceElement.textContent = `${Math.round(Math.sqrt(gd))}m`; } else { groundTargetArrow.visible = false; groundDistanceElement.textContent = 'N/A'; }
    if (e) { enemyArrow.visible = true; enemyArrow.lookAt(e.position); enemyArrow.material.color.copy(e.material.color); enemyDistanceElement.textContent = `${Math.round(Math.sqrt(ed))}m`; } else { enemyArrow.visible = false; enemyDistanceElement.textContent = 'N/A'; }
    posXElement.textContent = Math.round(plane.position.x); posYElement.textContent = Math.round(plane.position.y); posZElement.textContent = Math.round(plane.position.z);
    _rotFwd.set(0, 0, 1).applyQuaternion(plane.quaternion);
    const hdg = Math.round(((Math.atan2(_rotFwd.x, _rotFwd.z) * 180 / Math.PI) + 360) % 360);
    const pch = Math.round(Math.atan2(_rotFwd.y, Math.sqrt(_rotFwd.x * _rotFwd.x + _rotFwd.z * _rotFwd.z)) * 180 / Math.PI);
    const bnk = Math.round(plane.rotation.z * 180 / Math.PI);
    rotHdgElement.textContent = hdg + '°'; rotPchElement.textContent = (pch >= 0 ? '+' : '') + pch + '°'; rotBnkElement.textContent = (bnk >= 0 ? '+' : '') + bnk + '°';
    const rPct = (v, max) => Math.round(Math.abs(v) / max * 100) + '%';
    const rFmt = v => (v >= 0 ? '+' : '') + v.toFixed(3);
    ratePitchPos.style.width = state.pitchRate > 0 ? rPct(state.pitchRate, maxPitchRate) : '0%';
    ratePitchNeg.style.width = state.pitchRate < 0 ? rPct(state.pitchRate, maxPitchRate) : '0%';
    ratePitchVal.textContent = rFmt(state.pitchRate);
    rateRollPos.style.width  = state.rollRate  > 0 ? rPct(state.rollRate,  maxRollRate)  : '0%';
    rateRollNeg.style.width  = state.rollRate  < 0 ? rPct(state.rollRate,  maxRollRate)  : '0%';
    rateRollVal.textContent  = rFmt(state.rollRate);
    rateYawPos.style.width   = state.yawRate   > 0 ? rPct(state.yawRate,   maxYawRate)   : '0%';
    rateYawNeg.style.width   = state.yawRate   < 0 ? rPct(state.yawRate,   maxYawRate)   : '0%';
    rateYawVal.textContent   = rFmt(state.yawRate);
    speedBarEl.style.width   = Math.round((state.speed - minSpeed) / (maxSpeed - minSpeed) * 100) + '%';
    updateAmmoHUD();
}

// (§2.4) Shared ammo-bar renderer — pre-computed barColor and statusColor passed in per weapon
function updateAmmoBar(barEl, statusEl, ammo, maxAmmo, reloadTimer, barColor, statusColor) {
    barEl.style.width = (ammo / maxAmmo * 100) + '%';
    barEl.style.background = ammo === 0 ? 'transparent' : barColor;
    statusEl.textContent = ammo <= 0 ? (reloadTimer / TARGET_FPS).toFixed(1) + 's' : ammo + '/' + maxAmmo;
    statusEl.style.color = ammo <= 0 ? 'var(--hud-red)' : statusColor;
}
function updateAmmoHUD() {
    // Gun: three-threshold colour
    const gunColor = state._emptyClipFlash > 0 ? 'var(--hud-red)' : state.gunAmmo < state.gunMaxAmmo * 0.25 ? 'var(--hud-red)' : state.gunAmmo < state.gunMaxAmmo * 0.5 ? 'var(--hud-amber)' : 'var(--hud-primary)';
    updateAmmoBar(gunBarEl, gunStatusEl, state.gunAmmo, state.gunMaxAmmo, state.gunReloadTimer, gunColor, state._emptyClipFlash > 0 ? 'var(--hud-red)' : 'var(--hud-primary)');

    updateAmmoBar(bombBarEl, bombStatusEl, state.bombAmmo, state.bombMaxAmmo, state.bombReloadTimer,
        state.bombAmmo === 1 ? 'var(--hud-red)' : 'var(--hud-orange)', 'var(--hud-orange)');

    updateAmmoBar(missileBarEl, missileStatusEl, state.missileAmmo, state.missileMaxAmmo, state.missileReloadTimer,
        state.missileAmmo === 1 ? 'var(--hud-red)' : 'var(--hud-orange)', 'var(--hud-orange)');

    // Flare: has active-deployed state in addition to normal ammo state
    if (state.flareTimer > 0) {
        flareBarEl.style.width = '100%';
        flareBarEl.style.background = 'var(--hud-primary)';
        flareStatusEl.textContent = state.flareTimer.toFixed(0) + 'f';
        flareStatusEl.style.color = 'var(--hud-primary)';
    } else {
        updateAmmoBar(flareBarEl, flareStatusEl, state.flareAmmo, state.flareMaxAmmo, state.flareReloadTimer,
            state.flareAmmo === 1 ? 'var(--hud-amber)' : 'var(--hud-primary)', 'var(--hud-amber)');
    }

    updateAmmoBar(napalmBarEl, napalmStatusEl, state.napalmAmmo, state.napalmMaxAmmo, state.napalmReloadTimer,
        state.napalmAmmo === 1 ? 'var(--hud-red)' : '#cc4400', '#ff8844');
}
