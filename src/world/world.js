/** The sea and procedural islets (coastline polygons, placement queries); terrain in terrain.js, sky in sky.js. */
import { MAP_BOUNDARY, waterLevel } from '../config.js';
import { scene } from '../core/scene.js';
import { markShared, randomRange } from '../core/utils.js';
import { initTerrain } from './terrain.js';

// --- Environment ---
const SEA_SIZE = 12000; // past the camera's far plane: the fog hides the edge
// No sea-floor plane: the water is opaque, and a floor half a unit below it z-fought with it (a fast flicker)
export const waterMaterial = markShared(new THREE.MeshStandardMaterial({ color: 0x1d5c7e, roughness: 0.25, metalness: 0.15 })); // colour: world/sky.js
const water = new THREE.Mesh(new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE), waterMaterial);
water.rotation.x = -Math.PI / 2; water.position.y = waterLevel; scene.add(water);
// --- Islets ---
// ISLET_MODE: 'A' = midpoint displacement (organic), 'B' = Koch snowflake (geometric)
const ISLET_MODE          = 'A';
const ISLET_ITERATIONS    = 4;    // A: 4 → 128 pts | B: 3 → 192 pts
const ISLET_ROUGHNESS     = 0.35; // A only — radial displacement scale (0.2 = subtle, 0.5 = jagged)

export const islets = [];

// Generate fractal polygon in world space, centred at (cx, cz) with given radius.
// Returns array of { x, z } world-space points forming a closed polygon.
function _generateIsletPolygon(cx, cz, radius) {
    if (ISLET_MODE === 'B') {
        // --- Koch snowflake ---
        let pts = [];
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 - Math.PI / 6;
            pts.push({ x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius });
        }
        for (let iter = 0; iter < ISLET_ITERATIONS; iter++) {
            const next = [];
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length];
                const p1 = { x: a.x + (b.x - a.x) / 3,       z: a.z + (b.z - a.z) / 3 };
                const p2 = { x: a.x + (b.x - a.x) * 2 / 3,   z: a.z + (b.z - a.z) * 2 / 3 };
                const dx = p2.x - p1.x, dz = p2.z - p1.z;
                const peak = { x: p1.x + dx * 0.5 - dz * 0.866, z: p1.z + dz * 0.5 + dx * 0.866 };
                next.push(a, p1, peak, p2);
            }
            pts = next;
        }
        return pts;
    } else {
        // --- Midpoint displacement (default A) ---
        let pts = [];
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            pts.push({ x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius });
        }
        let disp = radius * ISLET_ROUGHNESS;
        for (let iter = 0; iter < ISLET_ITERATIONS; iter++) {
            const next = [];
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length];
                next.push(a);
                const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
                const nx = mx - cx, nz = mz - cz;
                const len = Math.sqrt(nx * nx + nz * nz) || 1;
                const d = (Math.random() * 2 - 1) * disp;
                next.push({ x: mx + (nx / len) * d, z: mz + (nz / len) * d });
            }
            pts = next;
            disp *= 0.5;
        }
        return pts;
    }
}

// Ray-polygon intersection: returns distance along ray (ox,oz)+(dx,dz)*t where it exits the polygon.
// Used by buildBaseFences F1 to hug fence to islet coastline.
export function _rayPolyIntersect(ox, oz, dx, dz, poly) {
    let minT = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const ex = b.x - a.x, ez = b.z - a.z;
        const denom = dx * ez - dz * ex;
        if (Math.abs(denom) < 1e-10) continue;
        const tx = a.x - ox, tz = a.z - oz;
        const t = (tx * ez - tz * ex) / denom;
        const s = (tx * dz - tz * dx) / denom;
        if (t > 0.5 && s >= 0 && s <= 1 && t < minT) minT = t;
    }
    return minT;
}

export function _pointInPolygon(px, pz, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
        if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
}

function _nearestOnPolygon(px, pz, poly) {
    let bx = poly[0].x, bz = poly[0].z, bd = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const dx = b.x - a.x, dz = b.z - a.z, lenSq = dx * dx + dz * dz;
        const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq)) : 0;
        const cx = a.x + t * dx, cz = a.z + t * dz, d = (px - cx) ** 2 + (pz - cz) ** 2;
        if (d < bd) { bd = d; bx = cx; bz = cz; }
    }
    return { x: bx, z: bz };
}

/**
 * Islets: a fractal coastline polygon each (placement, fences, the minimap and coast distances use it) and a
 * terrain heightfield inside it (world/terrain.js). The terrain meshes are built by finalizeTerrain() once
 * every base has claimed its flat ground.
 */
export function createIslets(count) {
    for (let i = 0; i < count; i++) {
        const radius = randomRange(200, 500);
        const x = randomRange(-MAP_BOUNDARY * 0.8, MAP_BOUNDARY * 0.8);
        const z = randomRange(-MAP_BOUNDARY * 0.8, MAP_BOUNDARY * 0.8);
        const polygon = _generateIsletPolygon(x, z, radius);
        // Displacement can push the coastline past the nominal radius; quick rejection tests use the true bound
        const boundR = Math.max(...polygon.map(p => Math.hypot(p.x - x, p.z - z)));
        const islet = { x, z, radius, boundR, polygon, mesh: null };
        islets.push(islet);
        initTerrain(islet);
    }
}

// --- Spawn helpers ---
export function clampToIslet(px, pz, islet) {
    if (_pointInPolygon(px, pz, islet.polygon)) return { x: px, z: pz };
    return _nearestOnPolygon(px, pz, islet.polygon);
}
export function isOnAnyIslet(px, pz) {
    return islets.some(i => (px - i.x) ** 2 + (pz - i.z) ** 2 < i.boundR * i.boundR && _pointInPolygon(px, pz, i.polygon));
}
/** Distance from (x, z) to an islet's coastline (same value inside or outside the islet). */
export function distanceToCoast(x, z, islet) {
    const p = _nearestOnPolygon(x, z, islet.polygon);
    return Math.hypot(p.x - x, p.z - z);
}
/** Distance from (x, z) to the nearest coastline of any islet. */
export function distanceToAnyCoast(x, z) {
    let best = Infinity;
    for (const isl of islets) {
        if (Math.hypot(x - isl.x, z - isl.z) - isl.boundR > best) continue; // this islet's coast can't be closer
        best = Math.min(best, distanceToCoast(x, z, isl));
    }
    return best;
}
export function getNearestIslet(x, z) {
    let best = null, bestDist = Infinity;
    for (const isl of islets) { const d = (x - isl.x) ** 2 + (z - isl.z) ** 2; if (d < bestDist) { bestDist = d; best = isl; } }
    return best;
}
