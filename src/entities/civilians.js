/**
 * Civilian life on the islands, beside the military: villages of houses (with the odd ruin), lone ruins in the
 * countryside and lighthouses on the coasts. Scenery — not targets — but solid: flying into a building is a crash.
 *
 * placeCivilians() picks the sites and claims flat ground (terrain pads) before the terrain is finalised;
 * buildCivilians() then stands the buildings on the finished ground, one baked mesh per islet.
 * Everything is drawn from the seeded Math.random, so multiplayer players see the same villages.
 */
import { scene } from '../core/scene.js';
import { markShared, randomRange } from '../core/utils.js';
import { bake, kitMaterial, part, profile } from '../core/meshkit.js';
import { TERRAIN, addTerrainPad, heightAt } from '../world/terrain.js';
import { _pointInPolygon, distanceToCoast, islets } from '../world/world.js';
import { placementReport } from '../world/populate.js';
import { plane } from '../player/plane.js';
import { triggerGameOver } from '../game/gameOver.js';

const WALLS = [0xe6dfcd, 0xd8c59c, 0xd2a596, 0xa9bccb, 0xc8c0ab], ROOFS = [0xa4533b, 0x8b3d2c, 0x4f565f];
const DOOR = 0x5a3d28, WINDOW = 0x2f3b44, STONE = 0x7a7266, STONE_D = 0x5b554c, CHAR = 0x3a3632;
const box = (w, h, d, c, t) => part(new THREE.BoxGeometry(w, h, d), c, t);

// --- Buildings (local frame: base at y 0, front at +Z) ------------------------------------------------------------
const SHAPES = { cottage: [6, 3.6, 7], long: [6, 3.4, 11], tall: [6.5, 6.2, 7] }; // width, wall height, depth
const houseCache = new Map();
function houseGeo(shape, wall, roof) {
    const key = `${shape}|${wall}|${roof}`;
    if (houseCache.has(key)) return houseCache.get(key);
    const [w, h, d] = SHAPES[shape], ridge = w * 0.45;
    const parts = [
        box(w, h, d, wall, { y: h / 2 }),
        part(profile([[-w / 2 - 0.45, 0], [w / 2 + 0.45, 0], [0, ridge]], d + 0.7), roof, { y: h }), // gable roof
        box(0.8, 1.8, 0.8, STONE_D, { x: w * 0.22, y: h + ridge * 0.75, z: -d * 0.25 }),              // chimney
        box(1.1, 2.1, 0.12, DOOR, { y: 1.05, z: d / 2 + 0.05 }),
        ...[-1, 1].map(s => box(1, 1, 0.1, WINDOW, { x: s * w * 0.28, y: h * (shape === 'tall' ? 0.3 : 0.55), z: d / 2 + 0.05 })),
        ...[-1, 1].flatMap(s => [-0.25, 0.25].map(f => box(0.1, 1, 1, WINDOW, { x: s * (w / 2 + 0.05), y: h * 0.55, z: f * d }))),
    ];
    if (shape === 'tall') parts.push(...[-1, 0, 1].map(s => box(1, 1, 0.1, WINDOW, { x: s * w * 0.3, y: h * 0.72, z: d / 2 + 0.05 })), box(w + 0.1, 0.25, d + 0.1, STONE, { y: h * 0.5 }));
    const geo = markShared(bake(parts));
    houseCache.set(key, geo);
    return geo;
}
/** A ruin: broken walls with jagged tops, fallen rubble, charred stone. */
function ruinParts(w, d) {
    const parts = [], wall = (len, x, z, ry) => {
        for (let s = 0; s < 4; s++) { // wall in four stubs of random height
            const h = randomRange(0.6, 3.8), seg = len / 4;
            parts.push(box(seg, h, 0.6, Math.random() < 0.3 ? CHAR : STONE, { x: x + Math.cos(ry) * (s - 1.5) * seg, y: h / 2, z: z - Math.sin(ry) * (s - 1.5) * seg, ry }));
        }
    };
    wall(w, 0, d / 2, 0); wall(w, 0, -d / 2, 0); wall(d, w / 2, 0, Math.PI / 2);
    for (let i = 0; i < 6; i++) parts.push(box(randomRange(0.5, 1.4), randomRange(0.3, 0.8), randomRange(0.5, 1.4), STONE_D, { x: randomRange(-w / 2, w / 2), y: 0.3, z: randomRange(-d / 2, d / 2), ry: Math.random() * 3, rx: Math.random() * 0.4 }));
    return parts;
}
const lighthouseGeo = markShared(bake([
    ...[0, 1, 2, 3, 4].map(i => part(new THREE.CylinderGeometry(2.4 - (i + 1) * 0.28, 2.4 - i * 0.28, 4.4, 10), i % 2 ? 0xb3261e : 0xe8e4da, { y: 2.2 + i * 4.4 })),
    part(new THREE.CylinderGeometry(1.9, 1.9, 0.4, 10), 0x3a3f44, { y: 22.2 }),                 // gallery
    part(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 8), 0xf2df8a, { y: 23.5 }),                  // lantern
    part(new THREE.ConeGeometry(1.4, 1.6, 8), 0x3a3f44, { y: 25.4 }),
    box(4, 2.6, 3.2, 0xe8e4da, { x: 3.4, y: 1.3 }), part(profile([[-2.2, 0], [2.2, 0], [0, 1.4]], 3.6), 0x8b3d2c, { x: 3.4, y: 2.6, ry: Math.PI / 2 }), // keeper's cottage
]));

// --- Placement ------------------------------------------------------------------------------------------------------
const sites = [];     // { islet, kind: 'village' | 'ruin' | 'lighthouse', x, z, heading, houses: [{ x, z, ry, shape|ruin, w, d }] }
const colliders = []; // { x, z, r, top }
const clearOfBases = (x, z, d) => placementReport.bases.every(b => Math.hypot(b.x - x, b.z - z) > d) && Math.hypot(x, z) > 220;
function pointOn(isl) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * isl.radius * 0.85, x = isl.x + Math.cos(a) * r, z = isl.z + Math.sin(a) * r;
    return _pointInPolygon(x, z, isl.polygon) ? { x, z } : null;
}

/** Choose village, ruin and lighthouse sites and claim flat ground. Call before finalizeTerrain(). */
export function placeCivilians() {
    for (const isl of islets) {
        const villages = 1 + (isl.radius > 330 ? 1 : 0);
        for (let v = 0; v < villages; v++) {
            for (let tries = 0; tries < 40; tries++) {
                const p = pointOn(isl);
                if (!p || distanceToCoast(p.x, p.z, isl) < 45 || !clearOfBases(p.x, p.z, 240) || heightAt(p.x, p.z) > TERRAIN.surface + 28) continue;
                if (sites.some(s => Math.hypot(s.x - p.x, s.z - p.z) < 140)) continue;
                const heading = Math.random() * Math.PI * 2, houses = [];
                const count = 4 + Math.floor(Math.random() * 6);
                for (let h = 0; h < count * 3 && houses.length < count; h++) {
                    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 28, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
                    if (houses.some(o => Math.hypot(o.x - x, o.z - z) < 12)) continue;
                    const ruin = Math.random() < 0.2, shape = ['cottage', 'cottage', 'long', 'tall'][Math.floor(Math.random() * 4)];
                    houses.push({ x, z, ry: heading + Math.round(Math.random() * 3) * (Math.PI / 2) + randomRange(-0.15, 0.15), ruin, shape, wall: WALLS[Math.floor(Math.random() * WALLS.length)], roof: ROOFS[Math.floor(Math.random() * ROOFS.length)] });
                }
                addTerrainPad(p.x, p.z, 42, 36);
                sites.push({ islet: isl, kind: 'village', x: p.x, z: p.z, houses });
                break;
            }
        }
        // A lone ruin in the countryside
        for (let tries = 0; tries < 20; tries++) {
            const p = pointOn(isl);
            if (!p || distanceToCoast(p.x, p.z, isl) < 30 || !clearOfBases(p.x, p.z, 160) || sites.some(s => Math.hypot(s.x - p.x, s.z - p.z) < 80)) continue;
            addTerrainPad(p.x, p.z, 9, 12);
            sites.push({ islet: isl, kind: 'ruin', x: p.x, z: p.z, houses: [{ x: p.x, z: p.z, ry: Math.random() * 3, ruin: true }] });
            break;
        }
        // A lighthouse on the coast, a little inland from a coastline point
        if (Math.random() < 0.65) {
            const c = isl.polygon[Math.floor(Math.random() * isl.polygon.length)];
            const dx = isl.x - c.x, dz = isl.z - c.z, l = Math.hypot(dx, dz) || 1, x = c.x + (dx / l) * 16, z = c.z + (dz / l) * 16;
            if (_pointInPolygon(x, z, isl.polygon) && clearOfBases(x, z, 160) && !sites.some(s => Math.hypot(s.x - x, s.z - z) < 60)) {
                addTerrainPad(x, z, 9, 10);
                sites.push({ islet: isl, kind: 'lighthouse', x, z, heading: Math.atan2(dx, dz) });
            }
        }
    }
}

const material = markShared(kitMaterial({ roughness: 0.85 }));
/** Stand the buildings on the finished terrain: one baked mesh per islet. Call after finalizeTerrain(). */
export function buildCivilians() {
    const byIslet = new Map();
    const add = (isl, parts) => { if (!byIslet.has(isl)) byIslet.set(isl, []); byIslet.get(isl).push(...parts); };
    for (const s of sites) {
        if (s.kind === 'lighthouse') {
            const y = heightAt(s.x, s.z);
            add(s.islet, [part(lighthouseGeo.clone(), null, { x: s.x, y, z: s.z, ry: s.heading })]);
            colliders.push({ x: s.x, z: s.z, r: 3, top: y + 26 });
            continue;
        }
        for (const h of s.houses) {
            const y = heightAt(h.x, h.z) - 0.15; // sunk a touch so no wall floats on a slope
            if (h.ruin) {
                const w = randomRange(6, 9), d = randomRange(6, 9);
                add(s.islet, ruinParts(w, d).map(p => { // place each ruin piece in world space
                    const c = Math.cos(h.ry), sn = Math.sin(h.ry), t = p.t, lx = t.x || 0, lz = t.z || 0;
                    return part(p.geo, p.color, { ...t, x: h.x + lx * c + lz * sn, y: y + (t.y || 0), z: h.z - lx * sn + lz * c, ry: (t.ry || 0) + h.ry });
                }));
                colliders.push({ x: h.x, z: h.z, r: Math.max(w, d) * 0.5, top: y + 3.8 });
            } else {
                const [w, wh, d] = SHAPES[h.shape];
                add(s.islet, [part(houseGeo(h.shape, h.wall, h.roof).clone(), null, { x: h.x, y, z: h.z, ry: h.ry })]);
                colliders.push({ x: h.x, z: h.z, r: Math.max(w, d) * 0.5, top: y + wh + w * 0.45 });
            }
        }
    }
    for (const parts of byIslet.values()) scene.add(new THREE.Mesh(bake(parts), material));
}

/** Per simulated frame while flying: buildings are solid. */
export function updateCivilianCollisions() {
    const p = plane.position;
    if (p.y > TERRAIN.surface + 45) return; // above every roof and lighthouse
    for (const c of colliders) {
        if (p.y < c.top && (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < (c.r + 1.5) ** 2) { triggerGameOver(); return; }
    }
}

/** For tests. */
/** Village, ruin and lighthouse sites (entities/bosses.js: a robot boss awakens in a village). */
export const civilianSites = () => sites;
export const civilianStats = () => ({ villages: sites.filter(s => s.kind === 'village').length, houses: sites.reduce((n, s) => n + (s.houses?.length || 0), 0), lighthouses: sites.filter(s => s.kind === 'lighthouse').length, colliders: colliders.length, firstVillage: sites.find(s => s.kind === 'village'), firstLighthouse: sites.find(s => s.kind === 'lighthouse') });
