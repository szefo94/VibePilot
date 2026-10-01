/**
 * The minimap's terrain layer, baked once per map (on 'worldReady') from the real heightfield (world/terrain.js):
 *
 *   relief     hypsometric tints (beach, lowland green, upland olive, rock, summit) lit by a hillshade from the NW
 *   contours   isohypses every TERRAIN_MAP.contour m above the sea, a bolder index line every TERRAIN_MAP.index m
 *   coastline  a bright edge where land meets the sea; the sea itself a dark blue
 *   landmarks  summits (▲ and their height), villages, ruins, lighthouses (blinking) and sea stacks (hazards)
 *
 * minimap.js draws the baked image under the radar blips, moved and turned with the plane (drawTerrainLayer) and
 * then the landmark labels upright (drawLandmarkLabels).
 */
import { MAP_BOUNDARY, waterLevel } from '../config.js';
import { heightGrid } from '../world/terrain.js';
import { islets } from '../world/world.js';
import { civilianSites } from '../entities/civilians.js';
import { obstacles } from '../entities/registry.js';
import { onHook } from '../game/hooks.js';

export const TERRAIN_MAP = Object.freeze({ px: 800, contour: 10, index: 50, summitMin: 25 });

const HALF = MAP_BOUNDARY * 1.05, STEP = (HALF * 2) / TERRAIN_MAP.px;
let image = null;
const landmarks = []; // { kind: 'peak' | 'village' | 'ruin' | 'lighthouse' | 'stack', x, z, label? }

// Elevation (m above the sea) → colour stops
const TINTS = [[0, [196, 182, 128]], [3, [92, 128, 64]], [22, [112, 140, 72]], [40, [138, 124, 80]], [58, [128, 116, 104]], [76, [168, 164, 156]], [95, [228, 228, 222]]];
function tint(e, out) {
    let k = 1;
    while (k < TINTS.length - 1 && e > TINTS[k][0]) k++;
    const [e0, c0] = TINTS[k - 1], [e1, c1] = TINTS[k], t = Math.min(1, Math.max(0, (e - e0) / (e1 - e0)));
    for (let i = 0; i < 3; i++) out[i] = c0[i] + (c1[i] - c0[i]) * t;
    return out;
}

/** Bake the relief, contours and coast into an offscreen canvas and collect the landmarks. */
export function bakeTerrainMap() {
    const N = TERRAIN_MAP.px, x0 = -HALF, z0 = -HALF;
    const h = heightGrid(x0, z0, STEP, N, N);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = N;
    const ctx = canvas.getContext('2d'), img = ctx.createImageData(N, N), px = img.data, c = [0, 0, 0];
    const e = k => h[k] - waterLevel;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i, o = k * 4, el = e(k);
        const r = i < N - 1 ? k + 1 : k, d = j < N - 1 ? k + N : k, l = i > 0 ? k - 1 : k, u = j > 0 ? k - N : k;
        if (el <= 0) { // sea: dark blue, the coast picked out
            const coast = e(r) > 0 || e(d) > 0 || e(l) > 0 || e(u) > 0;
            px[o] = coast ? 150 : 14; px[o + 1] = coast ? 225 : 52; px[o + 2] = coast ? 255 : 82; px[o + 3] = coast ? 230 : 120;
            continue;
        }
        tint(el, c);
        // Hillshade: light from the north-west (world −x, −z), slopes facing it brighter
        const gx = (h[r] - h[l]) / (2 * STEP), gz = (h[d] - h[u]) / (2 * STEP);
        const shade = Math.min(1.35, Math.max(0.5, 1 + (gx + gz) * 0.9));
        // Contours: an elevation band boundary with the right or lower neighbour
        const band = Math.floor(el / TERRAIN_MAP.contour);
        const crossR = e(r) > 0 && Math.floor(e(r) / TERRAIN_MAP.contour) !== band, crossD = e(d) > 0 && Math.floor(e(d) / TERRAIN_MAP.contour) !== band;
        let line = 1;
        if (crossR || crossD) {
            const top = Math.max(el, crossR ? e(r) : el, crossD ? e(d) : el);
            line = Math.floor(top / TERRAIN_MAP.index) !== Math.floor(Math.min(el, crossR ? e(r) : el, crossD ? e(d) : el) / TERRAIN_MAP.index) ? 0.35 : 0.68;
        }
        px[o] = c[0] * shade * line; px[o + 1] = c[1] * shade * line; px[o + 2] = c[2] * shade * line; px[o + 3] = 225;
    }
    ctx.putImageData(img, 0, 0);
    image = canvas;

    // Landmarks: each islet's summit, the civilian sites, the sea stacks
    landmarks.length = 0;
    for (const isl of islets) {
        let best = -Infinity, bx = 0, bz = 0;
        const r = isl.radius ?? 300, i0 = Math.max(0, Math.floor((isl.x - r - x0) / STEP)), i1 = Math.min(N - 1, Math.ceil((isl.x + r - x0) / STEP));
        const j0 = Math.max(0, Math.floor((isl.z - r - z0) / STEP)), j1 = Math.min(N - 1, Math.ceil((isl.z + r - z0) / STEP));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (h[j * N + i] > best) { best = h[j * N + i]; bx = x0 + i * STEP; bz = z0 + j * STEP; }
        const el = best - waterLevel;
        if (el >= TERRAIN_MAP.summitMin && !landmarks.some(m => m.kind === 'peak' && Math.hypot(m.x - bx, m.z - bz) < 120)) landmarks.push({ kind: 'peak', x: bx, z: bz, label: `${Math.round(el)} m` });
    }
    for (const s of civilianSites()) landmarks.push({ kind: s.kind, x: s.x, z: s.z, label: s.kind === 'village' ? 'village' : undefined });
    for (const o of obstacles) if (o.userData.type === 'stalagmite') landmarks.push({ kind: 'stack', x: o.position.x, z: o.position.z });
}
onHook('worldReady', bakeTerrainMap);

/** Draw the whole map north-up (west on the left, like the minimap facing north) into `canvas` — the start menu's preview. */
export function drawMapPreview(canvas) {
    if (!image) return;
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgb(14,52,82)'; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(w, h); ctx.scale(-w / image.width, -h / image.height); // the baked image runs east→west, south→north
    ctx.imageSmoothingEnabled = true; ctx.drawImage(image, 0, 0);
    ctx.restore();
}
/** The highest summit's height above the sea (m), or 0. */
export const highestSummit = () => landmarks.reduce((m, l) => (l.kind === 'peak' ? Math.max(m, parseInt(l.label, 10)) : m), 0);

/** For tests: whether the layer is baked and what it marks. */
export const terrainMapStats = () => ({ baked: !!image, size: image?.width ?? 0, landmarks: landmarks.reduce((n, m) => ({ ...n, [m.kind]: (n[m.kind] ?? 0) + 1 }), {}) });

/**
 * Draw the baked relief in the minimap's rotated frame, where a world point maps to (−(x − px)·scale, −(z − pz)·scale),
 * then the landmark icons. Returns false while nothing is baked (minimap.js then fills the islet outlines).
 */
export function drawTerrainLayer(ctx, player, scale, time) {
    if (!image) return false;
    ctx.save();
    ctx.translate(-(-HALF - player.x) * scale, -(-HALF - player.z) * scale);
    ctx.scale(-scale * STEP, -scale * STEP);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0);
    ctx.restore();
    const R = ctx.canvas.width / 2;
    for (const m of landmarks) {
        const x = -(m.x - player.x) * scale, y = -(m.z - player.z) * scale;
        if (x * x + y * y > R * R) continue;
        if (m.kind === 'peak') {
            ctx.fillStyle = '#f4efe2'; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x - 4.5, y + 3); ctx.lineTo(x + 4.5, y + 3); ctx.closePath(); ctx.fill(); ctx.stroke();
        } else if (m.kind === 'village') {
            ctx.fillStyle = '#e8c890'; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x - 4, y + 3); ctx.lineTo(x - 4, y - 1); ctx.lineTo(x, y - 5); ctx.lineTo(x + 4, y - 1); ctx.lineTo(x + 4, y + 3); ctx.closePath(); ctx.fill(); ctx.stroke();
        } else if (m.kind === 'ruin') {
            ctx.strokeStyle = 'rgba(220,210,190,0.85)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3); ctx.stroke();
        } else if (m.kind === 'lighthouse') { // a blinking beacon
            const on = Math.sin(time * 4 + m.x) > 0;
            ctx.fillStyle = on ? '#fff6a0' : '#8a7a30';
            ctx.beginPath(); ctx.arc(x, y, on ? 3.2 : 2.2, 0, Math.PI * 2); ctx.fill();
            if (on) { ctx.strokeStyle = 'rgba(255,246,160,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke(); }
        } else { // sea stack: a hazard dot
            ctx.fillStyle = '#5a5550'; ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
    }
    ctx.lineWidth = 1;
    return true;
}

/** Upright labels (summit heights, villages) in screen space: `toScreen(x, y)` undoes the minimap's rotation. */
export function drawLandmarkLabels(ctx, player, scale, toScreen) {
    if (!image) return;
    const R = ctx.canvas.width / 2;
    ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center'; ctx.lineWidth = 2.5;
    for (const m of landmarks) {
        if (!m.label) continue;
        const x = -(m.x - player.x) * scale, y = -(m.z - player.z) * scale;
        if (x * x + y * y > (R - 14) * (R - 14)) continue;
        const s = toScreen(x, y);
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(m.label, s.x, s.y + 13);
        ctx.fillStyle = m.kind === 'peak' ? '#f4efe2' : '#e8c890'; ctx.fillText(m.label, s.x, s.y + 13);
    }
    ctx.lineWidth = 1;
}
