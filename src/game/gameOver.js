/** Game-over sequence. */
import { state } from '../state.js';
import { _steerCursorEl, gameOverElement } from '../ui/dom.js';
import { plane } from '../player/plane.js';
import { enemies, groundUnits } from '../entities/registry.js';
import { spawnPlaneDebris } from '../effects/effects.js';
import { _deathGraphEl, _drawDeathGraph, _statHp, _statLvl, _statScore, _statXp } from '../ui/debrief.js';
import { _gameOverPos } from '../player/camera.js';

export function triggerGameOver() {
    if (state.isGameOver) return; state.isGameOver = true; state.speed = 0;
    _gameOverPos.copy(plane.position);
    state._goOrbitYaw = 0; state._goOrbitPitch = 0.3;
    _steerCursorEl.style.display = 'none';
    if (state.score > state._highScore) { state._highScore = state.score; localStorage.setItem('vibepilot_hs', state.score); } // G5
    const _isNewBest = state.score >= state._highScore;
    gameOverElement.innerHTML = `GAME OVER!<br><span style="font-size:24px">Score: ${state.score}${_isNewBest ? '  ★ NEW BEST' : ''}</span><br><span style="font-size:16px">Best: ${state._highScore}</span><br><span style="font-size:18px">Refresh to restart</span>`;
    gameOverElement.style.display = 'block';
    enemies.forEach(e => { if (e.label) e.label.sprite.visible = false; });
    groundUnits.forEach(u => { if (u.userData.label) u.userData.label.sprite.visible = false; });
    spawnPlaneDebris(); // idea 6
    // Final stat sample + show debrief graph
    _statHp.push(0); _statScore.push(state.score); _statXp.push(state.xp); _statLvl.push(state.level);
    setTimeout(() => { _drawDeathGraph(); _deathGraphEl.style.display = 'block'; }, 4000);
}
