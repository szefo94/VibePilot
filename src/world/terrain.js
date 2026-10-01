/**
 * Island terrain: each islet's coastline polygon (world.js) becomes a heightfield with beaches, rolling hills and
 * ridged mountains, following the usual recipe for natural-looking islands:
 *
 *   distance to the coast   → an island mask: 0 at the shoreline, rising inland, below 0 offshore (underwater shelf)
 *   fBm (layered noise)     → rolling hills and lowland variation
 *   ridged fBm (1 − |n|)²   → sharp mountain ridges, only well inland
 *   pow(e, k) redistribution→ wide flat lowlands, steep peaks
 *   pads                    → flattened plateaus where bases and ground units stand (addTerrainPad)
 *
 * Everything is drawn from the seeded Math.random, so every player on a map gets the same terrain.
 * Build order: createIslets() → initTerrain(islet) per islet (heights) → units and bases are placed → pads →
 * finalizeTerrain() (applies pads, builds the meshes). heightAt() works from initTerrain on.
 */
import { groundLevel, waterLevel } from '../config.js';
import { scene } from '../core/scene.js';
import { markShared } from '../core/utils.js';

export const TERRAIN = Object.freeze({
    cell: 12,            // grid spacing (world units)
    surface: groundLevel + 1, // height of a flat plateau / the old flat islet surface
    beachWidth: 26,      // units of sand slope from the shoreline
    beachHeight: 2.2,
    hillAmp: 22,         // rolling hills
    mountainAmp: 78,     // ridge peaks: the highest summits reach ~surface + 80 (the plane flies up to surface + 198)
    shelfDepth: 7,       // underwater slope offshore
    margin: 36,          // grid margin beyond the coastline (the underwater shelf)
});

// --- Seeded gradient noise (2-D Perlin) ------------------------------------------------------------------
let perm = null;
function seedNoise() {
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function grad(h, x, y) { const g = h & 7, u = g < 4 ? x : y, v = g < 4 ? y : x; return ((g & 1) ? -u : u) + ((g & 2) ? -2 * v : 2 * v); }
function noise(x, y) { // ≈ −1…1
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf), a = perm[xi] + yi, b = perm[xi + 1] + yi;
    return 0.5 * lerp(lerp(grad(perm[a], xf, yf), grad(perm[b], xf - 1, yf), u), lerp(grad(perm[a + 1], xf, yf - 1), grad(perm[b + 1], xf - 1, yf - 1), u), v);
}
function fbm(x, y, octaves) { let s = 0, a = 0.5, f = 1, n = 0; for (let o = 0; o < octaves; o++) { s += a * noise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; } return s / n; } // −1…1
function ridged(x, y, octaves) { // 0…1, sharp crests
    let s = 0, a = 0.5, f = 1, n = 0, w = 1;
    for (let o = 0; o < octaves; o++) { let r = 1 - Math.abs(noise(x * f, y * f)); r *= r * w; w = Math.min(1, r * 2); s += a * r; n += a; a *= 0.5; f *= 2.1; }
    return s / n;
}
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// --- Coast distance field ----------------------------------------------------------------------------------
// Inside/outside by scanline (each grid row crosses the polygon a few times), then the distance to the coastline
// by a two-pass chamfer transform: linear in the number of grid points instead of points × polygon edges.
function coastField(poly, x0, z0, nx, nz, cell) {
    const inside = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) {
        const z = z0 + j * cell, xs = [];
        for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
            const a = poly[i], b = poly[k];
            if ((a.z > z) !== (b.z > z)) xs.push(a.x + (z - a.z) * (b.x - a.x) / (b.z - a.z));
        }
        xs.sort((p, q) => p - q);
        for (let n = 0; n + 1 < xs.length; n += 2) {
            const i0 = Math.max(0, Math.ceil((xs[n] - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((xs[n + 1] - x0) / cell));
            for (let i = i0; i <= i1; i++) inside[j * nx + i] = 1;
        }
    }
    const d = new Float32Array(nx * nz).fill(1e9), D = cell, DD = cell * Math.SQRT2;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { // coastline cells: a neighbour on the other side
        const k = j * nx + i, v = inside[k];
        if ((i > 0 && inside[k - 1] !== v) || (i < nx - 1 && inside[k + 1] !== v) || (j > 0 && inside[k - nx] !== v) || (j < nz - 1 && inside[k + nx] !== v)) d[k] = cell * 0.5;
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i; let v = d[k];
        if (i > 0) v = Math.min(v, d[k - 1] + D);
        if (j > 0) { v = Math.min(v, d[k - nx] + D); if (i > 0) v = Math.min(v, d[k - nx - 1] + DD); if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + DD); }
        d[k] = v;
    }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
        const k = j * nx + i; let v = d[k];
        if (i < nx - 1) v = Math.min(v, d[k + 1] + D);
        if (j < nz - 1) { v = Math.min(v, d[k + nx] + D); if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + DD); if (i > 0) v = Math.min(v, d[k + nx - 1] + DD); }
        d[k] = v;
    }
    return { inside, d };
}

// --- Heightfields ---------------------------------------------------------------------------------------------
const fields = [];   // { islet, x0, z0, nx, nz, h: Float32Array (height above TERRAIN.surface), pad: Float32Array (0…1) }
const pads = [];     // { x, z, r, blend }
let finalized = false;

/** Heights for one islet (call right after its polygon exists, in creation order — it draws from Math.random). */
export function initTerrain(islet) {
    if (!perm) seedNoise();
    const T = TERRAIN, poly = islet.polygon;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const x0 = minX - T.margin, z0 = minZ - T.margin;
    const nx = Math.ceil((maxX - minX + 2 * T.margin) / T.cell) + 1, nz = Math.ceil((maxZ - minZ + 2 * T.margin) / T.cell) + 1;
    // Per-islet character: how mountainous, where the range runs, and the elevation curve
    const rugged = 0.45 + Math.random() * 0.7, ox = Math.random() * 1000, oz = Math.random() * 1000, curve = 1.25 + Math.random() * 0.6;
    const inland = Math.min(260, islet.radius * 0.65);
    const h = new Float32Array(nx * nz), field = coastField(poly, x0, z0, nx, nz, T.cell);
    for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
            const k = j * nx + i, x = x0 + i * T.cell, z = z0 + j * T.cell, d = field.d[k];
            if (!field.inside[k]) { h[k] = -Math.min(T.shelfDepth, d * 0.25) - 1.6; continue; } // clearly below the water (no z-fighting at the shore)
            const m = smooth(0, inland, d);                                   // island mask, 0 at the coast
            const beach = T.beachHeight * smooth(0, T.beachWidth, d);
            const hills = (0.5 + 0.5 * fbm(x * 0.0065 + ox, z * 0.0065 + oz, 4)) * m;
            const ridge = Math.min(1, ridged(x * 0.0048 + oz, z * 0.0048 + ox, 5) * 1.35);
            const range = smooth(0.3, 0.9, m) * (0.6 + 0.4 * fbm(x * 0.002 + ox, z * 0.002 - oz, 2)); // mountains only well inland
            h[k] = beach + T.hillAmp * Math.pow(hills, 1.15) + T.mountainAmp * Math.pow(ridge, curve) * range * rugged;
        }
    }
    fields.push({ islet, x0, z0, nx, nz, h, coast: field.d, pad: new Float32Array(nx * nz) });
}

/** Flatten the ground to a plateau at TERRAIN.surface within r, blending back to the terrain over `blend`. */
export function addTerrainPad(x, z, r, blend = 60) {
    pads.push({ x, z, r, blend });
    if (finalized) console.warn('addTerrainPad after finalizeTerrain has no effect');
}

function sample(f, x, z) {
    const gx = (x - f.x0) / TERRAIN.cell, gz = (z - f.z0) / TERRAIN.cell;
    if (gx < 0 || gz < 0 || gx > f.nx - 1 || gz > f.nz - 1) return null;
    const i = Math.min(f.nx - 2, Math.floor(gx)), j = Math.min(f.nz - 2, Math.floor(gz)), tx = gx - i, tz = gz - j, n = f.nx;
    return lerp(lerp(f.h[j * n + i], f.h[j * n + i + 1], tx), lerp(f.h[(j + 1) * n + i], f.h[(j + 1) * n + i + 1], tx), tz);
}

/** Ground height (world y) at (x, z): terrain on islets, the sea floor elsewhere. What the plane crashes into. */
export function heightAt(x, z) {
    let best = -Infinity;
    for (const f of fields) {
        const v = sample(f, x, z);
        if (v !== null && v > best) best = v;
    }
    return best === -Infinity ? groundLevel : Math.max(groundLevel, TERRAIN.surface + best);
}

/** Ground heights (world y, as heightAt) on a grid of nx × nz samples from (x0, z0) every `step` — the minimap's relief. */
export function heightGrid(x0, z0, step, nx, nz) {
    const out = new Float32Array(nx * nz).fill(-Infinity);
    for (const f of fields) { // only the samples over each islet's field
        const i0 = Math.max(0, Math.ceil((f.x0 - x0) / step)), i1 = Math.min(nx - 1, Math.floor((f.x0 + (f.nx - 1) * TERRAIN.cell - x0) / step));
        const j0 = Math.max(0, Math.ceil((f.z0 - z0) / step)), j1 = Math.min(nz - 1, Math.floor((f.z0 + (f.nz - 1) * TERRAIN.cell - z0) / step));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const v = sample(f, x0 + i * step, z0 + j * step), k = j * nx + i;
            if (v !== null && v > out[k]) out[k] = v;
        }
    }
    for (let k = 0; k < out.length; k++) out[k] = out[k] === -Infinity ? groundLevel : Math.max(groundLevel, TERRAIN.surface + out[k]);
    return out;
}

/** Highest ground within `r` of (x, z) (sampled on the grid) — for placing things above the terrain. */
export function maxHeightNear(x, z, r) {
    let best = groundLevel;
    for (let dz = -r; dz <= r; dz += TERRAIN.cell) for (let dx = -r; dx <= r; dx += TERRAIN.cell) {
        if (dx * dx + dz * dz <= r * r) best = Math.max(best, heightAt(x + dx, z + dz));
    }
    return best;
}

// --- Colours (low-poly palette) ---
const C = {
    sand: new THREE.Color(0xb3a57a), wetSand: new THREE.Color(0x8c7f5a), grass: new THREE.Color(0x5f7d3b), grass2: new THREE.Color(0x486a2e),
    scrub: new THREE.Color(0x6f7445), rock: new THREE.Color(0x6e665c), rock2: new THREE.Color(0x857d72), peak: new THREE.Color(0xa7a197),
    pad: new THREE.Color(0x6b6448), seabed: new THREE.Color(0x3d5a5c),
};
const terrainMaterial = markShared(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }));

/** Apply the pads and build one mesh per islet (islet.mesh). Call once, after every base and unit is placed. */
export function finalizeTerrain() {
    if (finalized) return;
    finalized = true;
    const T = TERRAIN, col = new THREE.Color();
    for (const f of fields) {
        const { nx, nz, h, pad, coast } = f;
        // Pads: blend heights down to the plateau
        for (const p of pads) {
            const reach = p.r + p.blend;
            const i0 = Math.max(0, Math.floor((p.x - reach - f.x0) / T.cell)), i1 = Math.min(nx - 1, Math.ceil((p.x + reach - f.x0) / T.cell));
            const j0 = Math.max(0, Math.floor((p.z - reach - f.z0) / T.cell)), j1 = Math.min(nz - 1, Math.ceil((p.z + reach - f.z0) / T.cell));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                const k = j * nx + i, d = Math.hypot(f.x0 + i * T.cell - p.x, f.z0 + j * T.cell - p.z);
                const w = 1 - smooth(p.r, reach, d);
                if (w <= 0) continue;
                if (h[k] > 0) h[k] = lerp(h[k], Math.min(h[k], 0.6), w); // plateau just above the beach; never raises the sea floor
                pad[k] = Math.max(pad[k], d < p.r ? 1 : w * 0.6);
            }
        }
        // Mesh: a grid (preallocated arrays), skipping cells that are entirely under the sea
        const positions = new Float32Array((nx - 1) * (nz - 1) * 18), colors = new Float32Array((nx - 1) * (nz - 1) * 18);
        let n = 0;
        const shade = (k, slope) => {
            const e = h[k];
            if (e < 0) return col.copy(C.seabed).lerp(C.wetSand, Math.max(0, 1 + e / 3));
            if (pad[k] >= 0.5) col.copy(C.pad).lerp(C.grass2, 0.25 + 0.2 * noise(k * 0.05, 3.1)); // trampled plateau: earth and worn grass
            else if (coast[k] < T.beachWidth * 0.8) col.copy(C.sand).lerp(C.wetSand, Math.max(0, 1 - coast[k] / 8));
            else if (slope > 0.9 || e > 42) col.copy(C.rock).lerp(C.rock2, noise(k * 0.37, e * 0.1) * 0.5 + 0.5);
            else col.copy(C.grass).lerp(C.grass2, 0.5 + 0.5 * noise(k * 0.013, e * 0.05)).lerp(C.scrub, Math.min(1, Math.max(0, (e - 18) / 24)));
            if (e > 56) col.lerp(C.peak, Math.min(1, (e - 56) / 12));
            else if (pad[k] > 0) col.lerp(C.pad, pad[k] * 0.6);
            return col;
        };
        const put = (i, j) => { const k = j * nx + i; positions[n] = f.x0 + i * T.cell; positions[n + 1] = T.surface + h[k]; positions[n + 2] = f.z0 + j * T.cell; colors[n] = col.r; colors[n + 1] = col.g; colors[n + 2] = col.b; n += 3; };
        for (let j = 0; j < nz - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                const k0 = j * nx + i, k1 = k0 + 1, k2 = k0 + nx, k3 = k2 + 1;
                const h0 = h[k0], h1 = h[k1], h2 = h[k2], h3 = h[k3];
                if (h0 < -1 && h1 < -1 && h2 < -1 && h3 < -1) continue; // deep under water: invisible anyway
                const slope = (Math.max(h0, h1, h2, h3) - Math.min(h0, h1, h2, h3)) / T.cell;
                // Alternate the diagonal for a less regular, more hand-modelled facet pattern
                if ((i + j) & 1) {
                    shade(k0, slope); put(i, j); put(i, j + 1); put(i + 1, j);
                    shade(k3, slope); put(i + 1, j); put(i, j + 1); put(i + 1, j + 1);
                } else {
                    shade(k0, slope); put(i, j); put(i, j + 1); put(i + 1, j + 1);
                    shade(k1, slope); put(i, j); put(i + 1, j + 1); put(i + 1, j);
                }
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, n), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, n), 3));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, terrainMaterial);
        scene.add(mesh);
        f.islet.mesh = mesh;
    }
}

/** Sea level for convenience (the water plane). */
export const seaLevel = waterLevel;
