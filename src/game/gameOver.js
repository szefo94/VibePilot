/** End of a run: shot down (game over) or every base eliminated (mission complete). */
import { MISSION_COMPLETE_BONUS } from '../config.js';
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
import { onGameOver } from './session.js';
import { missionProgress } from './mission.js';

export function triggerGameOver({ victory = false } = {}) {
    if (state.isGameOver) return;
    if (DEBUG_PARAMS.invulnerable && !victory) return; // ?invulnerable: profiling flights never end
    state.isGameOver = true; state.speed = 0;
    _gameOverPos.copy(plane.position);
    state._goOrbitYaw = 0; state._goOrbitPitch = 0.3;
    if (victory) { state.score += MISSION_COMPLETE_BONUS; scoreElement.textContent = state.score; }
    if (state.score > state._highScore) { state._highScore = state.score; storageSet('vibepilot_hs', state.score); } // G5 — never throws
    const _isNewBest = state.score >= state._highScore;
    const { conquered, total } = missionProgress();
    gameOverElement.classList.toggle('victory', victory);
    gameOverElement.innerHTML = `${victory ? 'MISSION COMPLETE' : 'GAME OVER!'}<br><span style="font-size:24px">Score: ${state.score}${_isNewBest ? '  ★ NEW BEST' : ''}</span>` +
        `<br><span style="font-size:16px">Best: ${state._highScore} · Bases ${conquered}/${total}${victory ? ` · +${MISSION_COMPLETE_BONUS} mission bonus` : ''}</span>` +
        '<div class="menu-buttons menu-row"><button type="button" data-action="restart">Restart</button><button type="button" data-action="replay">Replay this map</button></div>' +
        '<div class="menu-hint">Enter restart · G debrief · arrows orbit the camera</div>';
    gameOverElement.style.display = 'block';
    onGameOver(); // cursor, focus, menu mode
    enemies.forEach(e => { if (e.label) e.label.sprite.visible = false; });
    groundUnits.forEach(u => { if (u.userData.label) u.userData.label.sprite.visible = false; });
    if (!victory) spawnPlaneDebris(); // idea 6
    // Final stat sample + debrief graph
    Object.assign(debriefInfo, { outcome: victory ? 'Mission complete' : 'Shot down', conquered, total, difficulty: settings.difficulty });
    _statHp.push(victory ? Math.max(0, state.planeHP) : 0); _statScore.push(state.score); _statXp.push(state.xp); _statLvl.push(state.level);
    setTimeout(() => { _drawDeathGraph(); _deathGraphEl.style.display = 'block'; }, 4000);
}
