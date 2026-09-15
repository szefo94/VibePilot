/** Missile lock-on reticle overlay canvas. */
import { state } from '../state.js';
import { camera } from '../core/scene.js';
import { _sv1, _sv2 } from '../core/scratch.js';
import { plane } from '../player/plane.js';
import { airUnits, enemies, groundUnits } from '../entities/registry.js';
import { groundUnitWorldPos } from '../combat/damage.js';

// G20: lock-on reticle overlay canvas
const _reticleCanvas = document.createElement('canvas');
_reticleCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';
document.body.appendChild(_reticleCanvas);
const _reticleCtx = _reticleCanvas.getContext('2d');
const _resizeReticle = () => { _reticleCanvas.width = window.innerWidth; _reticleCanvas.height = window.innerHeight; };
_resizeReticle(); window.addEventListener('resize', _resizeReticle);
const _reticleVec = new THREE.Vector3();
let _reticleTarget = null, _reticleFrame = 0;

// --- Main Animation Loop (§1.2, §2.5, §3.6) ---
// G20: lock-on reticle — project nearest hostile to screen, draw corner brackets
export function _drawReticle() {
    const W = _reticleCanvas.width, H = _reticleCanvas.height;
    _reticleCtx.clearRect(0, 0, W, H);
    if (state.isGameOver || state.missileAmmo <= 0) return;

    // Refresh target every 3 frames
    if (++_reticleFrame >= 3) {
        _reticleFrame = 0;
        let nearestSq = Infinity; _reticleTarget = null;
        const tryT = (pos, alive) => { const d = pos().distanceToSquared(plane.position); if (d < nearestSq) { nearestSq = d; _reticleTarget = { pos, alive }; } };
        groundUnits.forEach(u => { if (u.userData.hp > 0 && u.userData.isHostile) tryT(() => groundUnitWorldPos(u), () => u.userData.hp > 0); });
        airUnits.forEach(au => { if (au.hp > 0) tryT(() => au.group.position, () => au.hp > 0); });
        enemies.forEach(en => { if (en.parts.some(p => p.userData.hp > 0)) tryT(() => en.parts[0].position, () => en.parts.some(p => p.userData.hp > 0)); });
    }
    if (!_reticleTarget || !_reticleTarget.alive()) { _reticleTarget = null; return; }

    _reticleVec.copy(_reticleTarget.pos()).project(camera);
    if (_reticleVec.z > 1) return; // behind camera
    const sx = (_reticleVec.x * 0.5 + 0.5) * W, sy = (-_reticleVec.y * 0.5 + 0.5) * H;
    if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) return; // off screen

    // Determine if target is roughly in front (dot product of forward vs target dir)
    plane.getWorldDirection(_sv1);
    _sv2.copy(_reticleTarget.pos()).sub(plane.position).normalize();
    const inFront = _sv1.dot(_sv2) > 0.7; // within ~45 deg cone
    const color = inFront ? '#44ff88' : '#ff8800';

    const ctx = _reticleCtx, R = 28, arm = 11;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;

    // Four corner brackets
    [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([cx_, cy_]) => {
        const bx = sx + cx_ * R, by = sy + cy_ * R;
        ctx.beginPath(); ctx.moveTo(bx - cx_ * arm, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by - cy_ * arm); ctx.stroke();
    });

    // Center dot
    ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();

    // "LOCK" label when on target
    if (inFront) {
        ctx.fillStyle = color; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
        ctx.fillText('LOCK', sx, sy + R + 14);
    }
    ctx.restore();
}
