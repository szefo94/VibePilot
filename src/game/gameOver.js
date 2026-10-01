/**
 * End of a run: shot down (game over) or every base eliminated (mission complete).
 * Shot down in single-player, the pilot can also carry on (respawnHere): same map, score, level and XP, a new plane.
 */
import { MAP_BOUNDARY, MISSION_COMPLETE_BONUS, ceilingLevel, groundLevel } from '../config.js';
import { state } from '../state.js';
import { storageSet } from '../core/storage.js';
import { settings } from '../core/settings.js';
import { DEBUG_PARAMS } from '../debug/params.js';
import { gameOverElement, scoreElement } from '../ui/dom.js';
import { plane } from '../player/plane.js';
import { enemies, groundUnits } from '../entities/registry.js';
import { spawnPlaneDebris } from '../effects/effects.js';
import { _deathGraphEl, _drawDeathGraph, _statHp, _statLvl, _statScore, _statXp, debriefInfo } from '../ui/debrief.js';
import { _gameOverPos } from '../player/camera.js';
import { onGameOver, mainMenuLabel } from './session.js';
import { missionProgress } from './mission.js';
import { acesShotDown } from '../entities/rival.js';
import { RULES } from './rules.js';
import { playerDown, respawnPlayer } from './respawn.js';
import { onRespawnHere } from './session.js';
import { heightAt } from '../world/terrain.js';
import { showNotification } from '../ui/notifications.js';

let debriefTimer = 0, lastVictory = false;

export function triggerGameOver({ victory = false } = {}) {
    if (state.isGameOver) return;
    if (DEBUG_PARAMS.invulnerable && !victory) return; // ?invulnerable: profiling flights never end
    if (RULES.respawn && !victory) { playerDown(); return; } // a respawning mode: wreck now, respawn later
    state.isGameOver = true; state.speed = 0; lastVictory = victory;
    _gameOverPos.copy(plane.position);
    state._goOrbitYaw = 0; state._goOrbitPitch = 0.3;
    if (victory) { state.score += MISSION_COMPLETE_BONUS; scoreElement.textContent = state.score; }
    if (state.score > state._highScore) { state._highScore = state.score; storageSet('vibepilot_hs', state.score); } // G5 — never throws
    const _isNewBest = state.score >= state._highScore;
    const { conquered, total } = missionProgress(), aces = acesShotDown();
    gameOverElement.classList.toggle('victory', victory);
    gameOverElement.innerHTML = `${victory ? 'MISSION COMPLETE' : 'GAME OVER!'}<br><span style="font-size:24px">Score: ${state.score}${_isNewBest ? '  ★ NEW BEST' : ''}</span>` +
        `<br><span style="font-size:16px">Best: ${state._highScore} · Bases ${conquered}/${total}${aces ? ` · Aces ${aces}` : ''}${state.respawns ? ` · Respawns ${state.respawns}` : ''}${victory ? ` · +${MISSION_COMPLETE_BONUS} mission bonus` : ''}</span>` +
        `<div class="menu-buttons menu-row">${victory ? '' : '<button type="button" data-action="respawn">Respawn</button>'}<button type="button" data-action="restart">Restart</button><button type="button" data-action="replay">Replay this map</button><button type="button" data-action="menu">${mainMenuLabel}</button></div>` +
        `<div class="menu-hint">${victory ? '' : 'R respawn here (keep score and level) · '}Enter restart · G debrief · arrows orbit the camera</div>`;
    gameOverElement.style.display = 'block';
    onGameOver(); // cursor, focus, menu mode
    enemies.forEach(e => { if (e.label) e.label.sprite.visible = false; });
    groundUnits.forEach(u => { if (u.userData.label) u.userData.label.sprite.visible = false; });
    if (!victory) spawnPlaneDebris(); // idea 6
    // Final stat sample + debrief graph
    Object.assign(debriefInfo, { outcome: victory ? 'Mission complete' : 'Shot down', conquered, total, difficulty: settings.difficulty, respawns: state.respawns });
    _statHp.push(victory ? Math.max(0, state.planeHP) : 0); _statScore.push(state.score); _statXp.push(state.xp); _statLvl.push(state.level);
    debriefTimer = setTimeout(() => { _drawDeathGraph(); _deathGraphEl.style.display = 'block'; }, 4000);
}

/**
 * Single-player: carry on after being shot down, in the same session — same map, score, level and XP. A new plane
 * appears at a safe height near the crash, heading for the middle of the map, with full HP and ammo and spawn
 * protection (the multiplayer respawn, game/respawn.js). Not after a mission is complete.
 */
export function respawnHere() {
    if (!state.isGameOver || lastVictory || RULES.respawn) return false;
    clearTimeout(debriefTimer);
    _deathGraphEl.style.display = 'none';
    gameOverElement.style.display = 'none';
    state.isGameOver = false;
    state.respawns++;
    for (const k of ['gun', 'bomb', 'missile', 'flare', 'napalm']) { state[`${k}Ammo`] = state[`${k}MaxAmmo`]; state[`${k}ReloadTimer`] = 0; }
    enemies.forEach(e => { if (e.label) e.label.sprite.visible = true; });
    groundUnits.forEach(u => { if (u.userData.label && u.userData.hp > 0) u.userData.label.sprite.visible = true; });
    const lim = MAP_BOUNDARY * 0.8;
    const x = THREE.MathUtils.clamp(_gameOverPos.x, -lim, lim), z = THREE.MathUtils.clamp(_gameOverPos.z, -lim, lim);
    const y = Math.min(ceilingLevel - 20, Math.max(heightAt(x, z) + 70, groundLevel + 95)); // above the hills and whatever got us
    const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-x, -z)); // towards the middle
    respawnPlayer(new THREE.Vector3(x, y, z), heading);
    onRespawnHere();
    showNotification(`Back in the air — respawn ${state.respawns} (score and level kept)`, false, { local: true });
    return true;
}
