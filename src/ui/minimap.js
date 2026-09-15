/** Radar minimap with sweep snapshot. */
import { MINIMAP_VIEW_RANGE } from '../config.js';
import { state } from '../state.js';
import { _sv1, _wp } from '../core/scratch.js';
import { islets } from '../world/world.js';
import { plane } from '../player/plane.js';
import { airUnits, baseMarkers, collectibles, enemies, groundUnits, markers } from '../entities/registry.js';
import { tubes } from '../entities/tubes.js';

let _radarBlips = [];                 // frozen positions updated once per sweep
const _radarPlayerPos = new THREE.Vector3(); // frozen player world position at snapshot
let _radarPlayerAngle = 0;           // frozen player heading at snapshot
const minimap = document.getElementById('minimap'), minimapCtx = minimap.getContext('2d'), MINIMAP_SIZE = 400;
minimap.width = MINIMAP_SIZE; minimap.height = MINIMAP_SIZE;
const MINIMAP_HALF_R_SQ = (MINIMAP_SIZE / 2) * (MINIMAP_SIZE / 2); // §2.7 squared threshold for hypot checks
// --- Static minimap rings — rendered once onto offscreen canvas, composited each frame (§3.4) ---
const _ringsCanvas = document.createElement('canvas');
_ringsCanvas.width = MINIMAP_SIZE; _ringsCanvas.height = MINIMAP_SIZE;
{ const rc = _ringsCanvas.getContext('2d'), cx = MINIMAP_SIZE / 2, maxR = MINIMAP_SIZE / 2;
  rc.lineWidth = 1;
  [0.33, 0.66, 1.0].forEach(f => { rc.strokeStyle = `rgba(0,210,90,${f === 1.0 ? 0.25 : 0.12})`; rc.beginPath(); rc.arc(cx, cx, maxR * f, 0, Math.PI * 2); rc.stroke(); }); }

// --- Minimap ---
export function updateRadarSnapshot() {
    _radarPlayerPos.copy(plane.position);
    plane.getWorldDirection(_sv1);
    _radarPlayerAngle = Math.atan2(_sv1.x, _sv1.z);
    _radarBlips = [];
    markers.forEach(m => _radarBlips.push({ wx: m.position.x, wz: m.position.z, color: 'yellow', shape: 'dot' }));
    collectibles.forEach(c => _radarBlips.push({ wx: c.position.x, wz: c.position.z, color: '#00ff44', shape: 'dot' }));
    enemies.forEach(e => { if (e.parts.length > 0) _radarBlips.push({ wx: e.parts[0].position.x, wz: e.parts[0].position.z, color: 'red', shape: 'dot' }); });
    groundUnits.forEach(u => { if (u.userData.hp > 0) { u.getWorldPosition(_wp); _radarBlips.push({ wx: _wp.x, wz: _wp.z, color: u.userData.isHostile ? 'orange' : 'white', shape: 'dot' }); } });
    airUnits.forEach(au => { if (au.hp > 0) _radarBlips.push({ wx: au.group.position.x, wz: au.group.position.z, color: au.isHostile ? '#ff4444' : '#aaddff', shape: 'triangle' }); });
    baseMarkers.forEach(bm => { if (!bm.eliminated) _radarBlips.push({ wx: bm.position.x, wz: bm.position.z, color: bm.isHostile ? '#ff8844' : '#88ccff', shape: 'square', label: `${bm.name} ${bm.alive}/${bm.total}` }); });
    tubes.forEach(t => { if (!t.completed) _radarBlips.push({ wx: t.cx, wz: t.cz, color: '#00ccff', shape: 'ring' }); });
}
export function updateMinimap() {
    minimapCtx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    // Composite pre-drawn static rings (§3.4)
    minimapCtx.drawImage(_ringsCanvas, 0, 0);
    const playerPos = _radarPlayerPos, scale = (MINIMAP_SIZE / 2) / MINIMAP_VIEW_RANGE;
    const playerAngle = _radarPlayerAngle;
    const cx = MINIMAP_SIZE / 2, cy = MINIMAP_SIZE / 2, maxR = MINIMAP_SIZE / 2;
    // Sweep trail — 8 graduated slices fading behind the sweep line
    const TRAIL_ARC = Math.PI * 0.55, STEPS = 10;
    for (let i = 0; i < STEPS; i++) {
        const t = i / STEPS;
        const a0 = state._radarSweepAngle - TRAIL_ARC * (1 - t);
        const a1 = state._radarSweepAngle - TRAIL_ARC * (1 - t - 1 / STEPS);
        minimapCtx.beginPath();
        minimapCtx.moveTo(cx, cy);
        minimapCtx.arc(cx, cy, maxR, a0, a1);
        minimapCtx.closePath();
        minimapCtx.fillStyle = `rgba(0,255,90,${0.09 * t * t})`;
        minimapCtx.fill();
    }
    // Sweep line
    minimapCtx.beginPath();
    minimapCtx.moveTo(cx, cy);
    minimapCtx.lineTo(cx + Math.cos(state._radarSweepAngle) * maxR, cy + Math.sin(state._radarSweepAngle) * maxR);
    minimapCtx.strokeStyle = 'rgba(0,255,90,0.65)';
    minimapCtx.lineWidth = 1.5;
    minimapCtx.stroke();
    minimapCtx.lineWidth = 1;
    // ------------------------------------------------------------------
    minimapCtx.save();
    minimapCtx.translate(MINIMAP_SIZE / 2, MINIMAP_SIZE / 2);
    minimapCtx.rotate(playerAngle);
    const getMinimapPoint = wp => ({ x: -(wp.x - playerPos.x) * scale, y: -(wp.z - playerPos.z) * scale });
    const compassRadius = MINIMAP_SIZE / 2 - 12;
    minimapCtx.fillStyle = 'rgba(255,255,255,0.8)'; minimapCtx.font = 'bold 12px Arial'; minimapCtx.textAlign = 'center'; minimapCtx.textBaseline = 'middle';
    minimapCtx.fillText('N', 0, -compassRadius); minimapCtx.fillText('S', 0, compassRadius); minimapCtx.fillText('E', compassRadius, 0); minimapCtx.fillText('W', -compassRadius, 0);
    minimapCtx.fillStyle = 'rgba(85,107,47,0.7)';
    islets.forEach(islet => {
        const ic = getMinimapPoint(islet), ir = islet.radius * scale;
        const _rd = MINIMAP_SIZE / 2 + ir;
        if (ic.x * ic.x + ic.y * ic.y >= _rd * _rd) return;
        minimapCtx.beginPath();
        islet.polygon.forEach((pt, k) => {
            const mp = getMinimapPoint(pt);
            k === 0 ? minimapCtx.moveTo(mp.x, mp.y) : minimapCtx.lineTo(mp.x, mp.y);
        });
        minimapCtx.closePath(); minimapCtx.fill();
    });
    // Draw blips from last radar snapshot (positions frozen until next sweep)
    const namedLabels = [];
    _radarBlips.forEach(b => {
        const mp = { x: -(b.wx - playerPos.x) * scale, y: -(b.wz - playerPos.z) * scale };
        if (mp.x*mp.x + mp.y*mp.y >= MINIMAP_HALF_R_SQ) return;
        if (b.shape === 'triangle') {
            minimapCtx.fillStyle = b.color;
            minimapCtx.beginPath(); minimapCtx.moveTo(mp.x, mp.y - 5); minimapCtx.lineTo(mp.x - 4, mp.y + 3); minimapCtx.lineTo(mp.x + 4, mp.y + 3); minimapCtx.closePath(); minimapCtx.fill();
        } else if (b.shape === 'square') {
            minimapCtx.fillStyle = b.color; minimapCtx.fillRect(mp.x - 3, mp.y - 3, 6, 6);
            if (b.label) {
                const sx = MINIMAP_SIZE / 2 + mp.x * Math.cos(playerAngle) - mp.y * Math.sin(playerAngle);
                const sy = MINIMAP_SIZE / 2 + mp.x * Math.sin(playerAngle) + mp.y * Math.cos(playerAngle);
                namedLabels.push({ sx, sy, name: b.label, color: b.color });
            }
        } else if (b.shape === 'ring') {
            minimapCtx.strokeStyle = b.color; minimapCtx.lineWidth = 1.5;
            minimapCtx.beginPath(); minimapCtx.arc(mp.x, mp.y, 6, 0, Math.PI * 2); minimapCtx.stroke();
            minimapCtx.lineWidth = 1;
        } else {
            minimapCtx.fillStyle = b.color; minimapCtx.fillRect(mp.x - 1.5, mp.y - 1.5, 3, 3);
        }
    });
    minimapCtx.restore();
    minimapCtx.font = 'bold 10px Arial'; minimapCtx.textAlign = 'left'; minimapCtx.lineWidth = 2;
    namedLabels.forEach(({ sx, sy, name, color }) => {
        minimapCtx.strokeStyle = 'rgba(0,0,0,0.85)'; minimapCtx.strokeText(name, sx + 5, sy + 3);
        minimapCtx.fillStyle = color; minimapCtx.fillText(name, sx + 5, sy + 3);
    });
    minimapCtx.fillStyle = 'white';
    minimapCtx.beginPath(); minimapCtx.moveTo(MINIMAP_SIZE / 2, MINIMAP_SIZE / 2 - 6); minimapCtx.lineTo(MINIMAP_SIZE / 2 - 4, MINIMAP_SIZE / 2 + 6); minimapCtx.lineTo(MINIMAP_SIZE / 2 + 4, MINIMAP_SIZE / 2 + 6); minimapCtx.closePath(); minimapCtx.fill();
}
