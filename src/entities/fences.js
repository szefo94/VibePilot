/** Base perimeter fences, searchlights, flags and fence damage. */
import { groundLevel } from '../config.js';
import { scene } from '../core/scene.js';
import { _pointInPolygon, _rayPolyIntersect, islets } from '../world/world.js';
import { _fenceRegistry, _flagMeshes, baseMarkers } from './registry.js';
import { disposeGroup, markShared } from '../core/utils.js';
import { createVirtualLight, removeVirtualLight } from '../effects/lightBudget.js';

// F6: searchlight sweepers
export const _searchlights = [];

// --- Base Fences ---
export function buildBaseFences() {
    const POST_H = 8, SEG_LEN = 20, MARGIN = 15, POLY_INSET = 0.84;
    const SIN60 = Math.sin(Math.PI / 3);   // √3/2
    const MIN_INRADIUS = 40;               // must visually contain a hangar
    const MAX_INRADIUS = 90;               // cap — perimeter tanks outside the fence is realistic

    // Prototypes (cloned, never attached) and resources shared by every fence
    const postMatProto  = new THREE.MeshStandardMaterial({ color: 0x6a6a5a, roughness: 0.9, metalness: 0.1 });
    const railMatProto  = new THREE.MeshStandardMaterial({ color: 0x8a8a7a, roughness: 0.75, metalness: 0.15 });
    const sandbagMatProto = new THREE.MeshStandardMaterial({ color: 0xa09060, roughness: 0.95 });
    const flagMat       = new THREE.MeshBasicMaterial({ color: 0xcc2200, side: THREE.DoubleSide });
    const barbMat       = markShared(new THREE.LineBasicMaterial({ color: 0x888877 }));
    const postGeo       = markShared(new THREE.CylinderGeometry(0.28, 0.28, POST_H, 6));
    const towerBodyGeo  = markShared(new THREE.BoxGeometry(2.5, 10, 2.5));
    const towerPlatGeo  = markShared(new THREE.CylinderGeometry(3.5, 3.5, 0.6, 8));
    const towerPoleGeo  = markShared(new THREE.CylinderGeometry(0.12, 0.12, 7, 6));
    const sandbagGeo    = markShared(new THREE.BoxGeometry(3, 1.2, 1.5));

    // --- Step 1: group land bases by islet so nearby bases share one hex ---
    const isletGroups = new Map(); // islet → { bases:[], islet }
    const soloGroups  = [];
    baseMarkers.forEach(bm => {
        if (bm.position.y < groundLevel + 1 || bm.position.y > groundLevel + 5) return;
        const isl = islets.find(i =>
            (bm.position.x - i.x) ** 2 + (bm.position.z - i.z) ** 2 < (i.boundR || i.radius) ** 2 &&
            _pointInPolygon(bm.position.x, bm.position.z, i.polygon)
        );
        if (!isl) { soloGroups.push({ bases: [bm], islet: null }); return; }
        if (!isletGroups.has(isl)) isletGroups.set(isl, { bases: [], islet: isl });
        isletGroups.get(isl).bases.push(bm);
    });

    for (const { bases, islet } of [...isletGroups.values(), ...soloGroups]) {
        // Group centroid
        const cx = bases.reduce((s, b) => s + b.position.x, 0) / bases.length;
        const cz = bases.reduce((s, b) => s + b.position.z, 0) / bases.length;

        // All units from every base in this group, excluding far perimeter units
        const allUnits = bases.flatMap(b => b.units).filter(u => {
            const dx = u.position.x - cx, dz = u.position.z - cz;
            return dx * dx + dz * dz < (MAX_INRADIUS / SIN60) ** 2;
        });

        // --- Minimum-bounding hexagon (12-orientation search over 60° symmetry) ---
        let bestRot = 0, bestInR = Infinity;
        for (let step = 0; step < 12; step++) {
            const θ = (step / 12) * Math.PI / 3;
            const α = θ + Math.PI / 6; // edge-normal base angle
            let maxInR = MIN_INRADIUS;
            allUnits.forEach(u => {
                const dx = u.position.x - cx, dz = u.position.z - cz;
                for (let k = 0; k < 3; k++) {
                    const a = α + k * Math.PI / 3;
                    maxInR = Math.max(maxInR, Math.abs(dx * Math.cos(a) + dz * Math.sin(a)));
                }
            });
            maxInR = Math.min(maxInR, MAX_INRADIUS);
            if (maxInR < bestInR) { bestInR = maxInR; bestRot = θ; }
        }
        const bestCircumR = (bestInR + MARGIN) / SIN60;

        // 6 corner vertices, each clamped to islet polygon
        const hexV = [];
        for (let i = 0; i < 6; i++) {
            const a = bestRot + (i / 6) * Math.PI * 2;
            let r = bestCircumR;
            if (islet) {
                const t = _rayPolyIntersect(cx, cz, Math.cos(a), Math.sin(a), islet.polygon);
                if (t > 0 && t < Infinity) r = Math.min(bestCircumR, t * POLY_INSET);
            }
            hexV.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
        }

        // F2: gate — edge whose midpoint faces map centre
        const toCenterA = Math.atan2(-cz, -cx);
        let gateEdge = 0, bestDiff = Infinity;
        for (let ei = 0; ei < 6; ei++) {
            const midA = Math.atan2(
                (hexV[ei].z + hexV[(ei + 1) % 6].z) / 2 - cz,
                (hexV[ei].x + hexV[(ei + 1) % 6].x) / 2 - cx
            );
            let diff = Math.abs(midA - toCenterA);
            if (diff > Math.PI) diff = Math.PI * 2 - diff;
            if (diff < bestDiff) { bestDiff = diff; gateEdge = ei; }
        }

        // Shared registry entry — all bases in this group point to the same reg
        const reg = { posts: [], bases };
        for (const bm of bases) _fenceRegistry[bm.id] = reg;
        const cloneMat = () => postMatProto.clone();
        // Rails and sandbags share one material per fence group: damage tint stays within the group
        const railMat = markShared(railMatProto.clone()), sandbagMat = markShared(sandbagMatProto.clone());

        // F3/F9: watchtower at a hex corner
        const makeTower = (px, pz) => {
            const g = new THREE.Group();
            const body = new THREE.Mesh(towerBodyGeo, cloneMat()); body.position.y = 5;
            const plat = new THREE.Mesh(towerPlatGeo, cloneMat()); plat.position.y = 10.3;
            const pole = new THREE.Mesh(towerPoleGeo, cloneMat()); pole.position.y = 14;
            g.add(body, plat, pole);
            g.position.set(px, groundLevel, pz);
            scene.add(g);
            reg.posts.push({ mesh: g, worldPos: new THREE.Vector3(px, groundLevel + 5, pz) });
            const fp = new THREE.Group();
            fp.position.set(px, groundLevel + 17.5, pz);
            const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 1.8), flagMat.clone());
            flag.position.set(1.75, -0.9, 0);
            fp.add(flag); scene.add(fp);
            reg.posts.push({ mesh: fp, worldPos: new THREE.Vector3(px, groundLevel + 17.5, pz) });
            _flagMeshes.push({ mesh: fp });
            // Searchlight on tower platform
            const slY = groundLevel + 12;
            const slSpot = createVirtualLight(0xffffaa, 1.2, 120, px, slY, pz); // lit via the light budget
            const _slInitA = Math.random() * Math.PI * 2;
            _searchlights.push({ spot: slSpot, worldPos: new THREE.Vector3(px, slY, pz),
                angle: _slInitA,
                speed: (0.004 + Math.random() * 0.004) * (Math.random() > 0.5 ? 1 : -1),
                range: 90, halfAngle: Math.PI / 7, baseIds: bases.map(b => b.id) });
            reg.posts.push({ mesh: slSpot, worldPos: new THREE.Vector3(px, slY, pz) });
        };

        // --- Build 5 non-gate edges ---
        for (let step = 1; step <= 5; step++) {
            const ei      = (gateEdge + step) % 6;
            const va      = hexV[ei];
            const vb      = hexV[(gateEdge + step + 1) % 6];
            const edgeLen = Math.sqrt((vb.x - va.x) ** 2 + (vb.z - va.z) ** 2);
            const n       = Math.max(1, Math.round(edgeLen / SEG_LEN));
            const edgeDir = Math.atan2(vb.z - va.z, vb.x - va.x);

            // Corner post (va): watchtower, except the first corner after the gate (gate pillar there)
            if (step > 1) makeTower(va.x, va.z);

            // Intermediate posts along this edge
            for (let k = 1; k < n; k++) {
                const t = k / n;
                const px = va.x + t * (vb.x - va.x), pz = va.z + t * (vb.z - va.z);
                const m = new THREE.Mesh(postGeo, cloneMat());
                m.position.set(px, groundLevel + POST_H / 2, pz);
                scene.add(m);
                reg.posts.push({ mesh: m, worldPos: new THREE.Vector3(px, groundLevel + POST_H / 2, pz) });
                // F8: sandbags every 3rd intermediate post
                if (k % 3 === 0) {
                    const inDx = cx - px, inDz = cz - pz;
                    const inLen = Math.sqrt(inDx * inDx + inDz * inDz) || 1;
                    const sx = px + (inDx / inLen) * 2.8, sz = pz + (inDz / inLen) * 2.8;
                    for (let stack = 0; stack < 2; stack++) {
                        const sb = new THREE.Mesh(sandbagGeo, sandbagMat);
                        sb.position.set(sx, groundLevel + 0.6 + stack * 1.2, sz);
                        sb.rotation.y = edgeDir + (Math.random() - 0.5) * 0.3;
                        scene.add(sb);
                        reg.posts.push({ mesh: sb, worldPos: sb.position.clone() });
                    }
                }
            }

            // Straight rail segments per edge (LineCurve3 → sharp hex corners, no CatmullRom smoothing)
            const midX = (va.x + vb.x) / 2, midZ = (va.z + vb.z) / 2;
            for (const railY of [groundLevel + 2.8, groundLevel + 6.2]) {
                const curve = new THREE.LineCurve3(
                    new THREE.Vector3(va.x, railY, va.z),
                    new THREE.Vector3(vb.x, railY, vb.z)
                );
                const railMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 1, 0.18, 4, false), railMat);
                scene.add(railMesh);
                reg.posts.push({ mesh: railMesh, worldPos: new THREE.Vector3(midX, railY, midZ) });
            }

            // F4: barbed wire segment above this edge
            {
                const bwPts = [];
                for (let k = 0; k <= n; k++) {
                    const t = k / n;
                    const px = va.x + t * (vb.x - va.x), pz = va.z + t * (vb.z - va.z);
                    const side = (k % 2 === 0) ? 0.6 : -0.6;
                    const perp = edgeDir + Math.PI / 2;
                    bwPts.push(new THREE.Vector3(px + Math.cos(perp) * side, groundLevel + POST_H + 0.35, pz + Math.sin(perp) * side));
                }
                const bwLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bwPts), barbMat);
                scene.add(bwLine);
                reg.posts.push({ mesh: bwLine, worldPos: new THREE.Vector3(midX, groundLevel + POST_H + 0.35, midZ) });
            }
        }

        // F2: gate — watchtowers at gate corners + crossbar; all linked so destroying one removes all
        {
            const gv0 = hexV[gateEdge], gv1 = hexV[(gateEdge + 1) % 6];
            const gateStart = reg.posts.length;
            makeTower(gv0.x, gv0.z);
            makeTower(gv1.x, gv1.z);
            const barLen = Math.sqrt((gv1.x - gv0.x) ** 2 + (gv1.z - gv0.z) ** 2);
            const crossbar = new THREE.Mesh(new THREE.BoxGeometry(barLen, 0.45, 0.45), cloneMat());
            crossbar.position.set((gv0.x + gv1.x) / 2, groundLevel + POST_H * 1.45, (gv0.z + gv1.z) / 2);
            crossbar.rotation.y = -Math.atan2(gv1.z - gv0.z, gv1.x - gv0.x);
            scene.add(crossbar);
            reg.posts.push({ mesh: crossbar, worldPos: new THREE.Vector3((gv0.x + gv1.x) / 2, groundLevel, (gv0.z + gv1.z) / 2) });
            // Link: destroying any gate part removes all of them
            const gatePosts = reg.posts.slice(gateStart);
            for (const gp of gatePosts) gp.gateGroup = gatePosts;
        }
    }
}

// F5: damage / destroy fence posts within radius of an explosion
export function _damageFenceNear(pos, radius) {
    const rSq = radius * radius;
    for (const reg of Object.values(_fenceRegistry)) {
        const toRemove = new Set();
        for (const p of reg.posts) {
            if (pos.distanceToSquared(p.worldPos) < rSq) {
                toRemove.add(p.mesh);
                if (p.gateGroup) p.gateGroup.forEach(gp => toRemove.add(gp.mesh));
            }
        }
        if (!toRemove.size) continue;
        for (let pi = reg.posts.length - 1; pi >= 0; pi--) {
            if (toRemove.has(reg.posts[pi].mesh)) {
                const _dm = reg.posts[pi].mesh;
                if (_dm.isVirtualLight) {
                    // Virtual searchlight: the real light pool is fixed, so removal never recompiles shaders
                    removeVirtualLight(_dm);
                    const _slIdx = _searchlights.findIndex(sl => sl.spot === _dm);
                    if (_slIdx > -1) _searchlights.splice(_slIdx, 1);
                } else {
                    scene.remove(_dm);
                    // Frees only what this post owns (cloned materials, rail/wire/flag geometry);
                    // shared fence geometries and group materials are marked shared and skipped
                    disposeGroup(_dm);
                    const _fi = _flagMeshes.findIndex(f => f.mesh === _dm);
                    if (_fi > -1) _flagMeshes.splice(_fi, 1);
                }
                reg.posts.splice(pi, 1);
            }
        }
    }
}

// F10: tint + tilt posts proportional to base damage
export function _updateFenceDamageState(bmId) {
    const reg = _fenceRegistry[bmId];
    if (!reg) return;
    // Combined alive/total across all bases sharing this fence
    let alive = 0, total = 0;
    for (const bm of reg.bases) { alive += bm.alive; total += bm.total; }
    const dmg = total > 0 ? 1 - alive / total : 0; // 0=intact, 1=dead
    // Color: grey 0x6a6a5a → burnt orange 0x8B4513
    const r = (0x6a + (0x8B - 0x6a) * dmg) / 255;
    const g = (0x6a + (0x45 - 0x6a) * dmg) / 255;
    const b = (0x5a + (0x13 - 0x5a) * dmg) / 255;
    reg.posts.forEach(p => {
        if (p.mesh.isVirtualLight) return; // searchlight record, not a mesh
        p.mesh.traverse(child => {
            if (child.isMesh && child.material) child.material.color.setRGB(r, g, b);
        });
        if (!p.tiltApplied && dmg > 0.15 && Math.random() < dmg * 0.2) {
            p.mesh.rotation.z += (Math.random() - 0.5) * 0.45 * dmg;
            p.mesh.rotation.x += (Math.random() - 0.5) * 0.25 * dmg;
            p.tiltApplied = true;
        }
    });
}
