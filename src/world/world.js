/** Static environment (ground, water, ceiling) and procedural islets with polygon queries. */
import { MAP_BOUNDARY, ceilingLevel, groundLevel, waterLevel } from '../config.js';
import { scene } from '../core/scene.js';
import { markShared, randomRange } from '../core/utils.js';

// --- Environment ---
export const caveWallMaterial = markShared(new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.9 }));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_BOUNDARY * 2, MAP_BOUNDARY * 2), caveWallMaterial);
ground.rotation.x = -Math.PI / 2; ground.position.y = groundLevel; scene.add(ground);
const water = new THREE.Mesh(new THREE.PlaneGeometry(MAP_BOUNDARY * 2, MAP_BOUNDARY * 2), new THREE.MeshStandardMaterial({ color: 0x001e3d, roughness: 0.2, metalness: 0.1 }));
water.rotation.x = -Math.PI / 2; water.position.y = waterLevel; scene.add(water);
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(MAP_BOUNDARY * 2, MAP_BOUNDARY * 2), caveWallMaterial);
ceiling.rotation.x = Math.PI / 2; ceiling.position.y = ceilingLevel; scene.add(ceiling);
// --- Islets ---
// ISLET_MODE: 'A' = midpoint displacement (organic), 'B' = Koch snowflake (geometric)
const ISLET_MODE          = 'A';
const ISLET_ITERATIONS    = 4;    // A: 4 → 128 pts | B: 3 → 192 pts
const ISLET_ROUGHNESS     = 0.35; // A only — radial displacement scale (0.2 = subtle, 0.5 = jagged)

export const islets = [];
const isletMaterial = markShared(new THREE.MeshStandardMaterial({ color: 0x556B2F }));
const _hillMat = markShared(new THREE.MeshStandardMaterial({ color: 0x4a5530, roughness: 0.95 }));
// Pre-baked hill shapes: wide-base cone, broad dome (squashed), narrow peak
const _hillGeos = [
    (() => { const g = new THREE.ConeGeometry(60, 45, 7); return g; })(),
    (() => { const g = new THREE.ConeGeometry(85, 28, 8); return g; })(),
    (() => { const g = new THREE.ConeGeometry(35, 60, 6); return g; })(),
    (() => { const g = new THREE.ConeGeometry(50, 35, 9); return g; })(),
];

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

export function createIslets(count) {
    for (let i = 0; i < count; i++) {
        const radius = randomRange(200, 500);
        const x = randomRange(-MAP_BOUNDARY * 0.8, MAP_BOUNDARY * 0.8);
        const z = randomRange(-MAP_BOUNDARY * 0.8, MAP_BOUNDARY * 0.8);
        const polygon = _generateIsletPolygon(x, z, radius);

        // Build ShapeGeometry from polygon. The Shape lives in local XY and is rotated -90° about X, which maps
        // local (sx, sy) to world (x + sx, z - sy): shape Y must be the *negated* Z offset, otherwise the mesh is
        // mirrored relative to the polygon used for placement, fences and the minimap.
        // ShapeGeometry normalises the winding, so faces still point up.
        const shape = new THREE.Shape();
        shape.moveTo(polygon[0].x - x, -(polygon[0].z - z));
        for (let k = 1; k < polygon.length; k++) shape.lineTo(polygon[k].x - x, -(polygon[k].z - z));
        shape.closePath();
        const geo = new THREE.ShapeGeometry(shape);
        const mesh = new THREE.Mesh(geo, isletMaterial);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, groundLevel + 1, z);
        scene.add(mesh);
        // Displacement can push the coastline past the nominal radius; quick rejection tests use the true bound
        const boundR = Math.max(...polygon.map(p => Math.hypot(p.x - x, p.z - z)));
        islets.push({ x, z, radius, boundR, polygon, mesh });

        // Scatter hills on this islet
        const numHills = 3 + Math.floor(Math.random() * 5); // 3–7 per islet
        for (let h = 0; h < numHills; h++) {
            const a = Math.random() * Math.PI * 2;
            const d = radius * 0.55 + Math.random() * radius * 0.35; // start at 55 % to stay outside fence perimeter
            const geo = _hillGeos[Math.floor(Math.random() * _hillGeos.length)];
            const hill = new THREE.Mesh(geo, _hillMat);
            hill.position.set(x + Math.cos(a) * d, groundLevel + 1, z + Math.sin(a) * d);
            hill.rotation.y = Math.random() * Math.PI * 2;
            scene.add(hill);
        }
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
