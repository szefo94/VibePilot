/**
 * Mythical boss models (entities/bosses.js), in the same style and contract as bossModels.js:
 * { group, height, emitter, head, glow, animate(t, b) } — plus `heads` / `emitters` for the hydra (every head aims,
 * shots come from each in turn).
 *
 *   dragon   VYRMATHRAX   a winged fire-wyrm: horned head on a long neck, bat wings with finger bones, spiked tail
 *   serpent  LEVIATHAN    a sea serpent: a frilled head rearing on its neck, coils arching out of the waves
 *   phoenix  PYRRHAX      a firebird: blazing wings of long feathers, a crest of flame and streaming tail plumes
 *   hydra    THE HYDRA    a squat marsh beast with three heads on swaying necks
 */
import { chain, detail, glowMat, mat, mesh, pivot } from './bossModels.js';

/** A flat membrane (wing, frill): a triangle fan from pts[0] through the rest, seen from both sides. */
function membrane(pts, material, parent) {
    const pos = [];
    for (let i = 1; i < pts.length - 1; i++) pos.push(...pts[0], ...pts[i], ...pts[i + 1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    parent.add(m);
    return m;
}
/** A bone (cylinder) from a to b, inside `parent`. */
function bone(a, b, r0, r1, material, parent, hit = false) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
    const m = (hit ? mesh : detail)(new THREE.CylinderGeometry(r1, r0, d.length(), 8), material, 0, 0, 0, parent);
    m.position.copy(A).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
}
/** The end of a chain (where the next part attaches). */
function chainEnd(joints, dir, len) { const p = new THREE.Group(); p.position.copy(dir).multiplyScalar(len); joints[joints.length - 1].add(p); return p; }

// --- Dragon: VYRMATHRAX, the Ember Wyrm ------------------------------------------------------------------------------
export function buildDragon() {
    const g = new THREE.Group(), scale = mat(0x8a1c14, { roughness: 0.6 }), dark = mat(0x2a0d0a), belly = mat(0xc9a35a), horn = mat(0xe8dcc0, { roughness: 0.5 });
    const wingMat = mat(0x5a1410, { side: THREE.DoubleSide, roughness: 0.85 }), fire = glowMat(0xff7a1a, 0.4), eye = glowMat(0xffe14a, 1.4);
    const body = mesh(new THREE.SphereGeometry(11, 22, 16), scale, 0, 0, 0, g); body.scale.set(1, 0.9, 2.1);
    mesh(new THREE.SphereGeometry(7.5, 18, 12), fire, 0, -3.5, 11, g).scale.set(1, 0.8, 1.3); // the furnace in its chest
    for (let i = 0; i < 7; i++) detail(new THREE.BoxGeometry(9 - i * 0.7, 0.8, 3.2), belly, 0, -9 + Math.abs(i - 3) * 0.5, 12 - i * 4, g);
    for (let i = 0; i < 10; i++) detail(new THREE.ConeGeometry(1.3, 4.6 - Math.abs(i - 4) * 0.3, 8), horn, 0, 9.4 - Math.abs(i - 4) * 0.35, 18 - i * 4.4, g).rotation.x = -0.45;
    // Neck and head
    const ndir = new THREE.Vector3(0, 0.55, 0.83).normalize();
    const neck = chain(pivot(0, 4, 18, g), 4, 6.5, 5.6, 3.6, scale, ndir);
    neck.forEach((j, i) => detail(new THREE.ConeGeometry(0.9, 3, 8), horn, 0, 3.6 - i * 0.3, 3, j).rotation.x = -0.6);
    const head = chainEnd(neck, ndir, 6.5);
    mesh(new THREE.BoxGeometry(7, 6, 10), scale, 0, 0, 3, head);
    mesh(new THREE.BoxGeometry(5, 3.6, 8), scale, 0, -0.6, 10.5, head);
    const jaw = pivot(0, -2.6, 5, head);
    mesh(new THREE.BoxGeometry(4.6, 1.4, 10), dark, 0, 0, 4.5, jaw);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) detail(new THREE.ConeGeometry(0.28, 1.4, 6), horn, s * 2, -0.9, 8.5 + i * 1.1 - 4, head).rotation.x = Math.PI;
    for (const s of [-1, 1]) {
        mesh(new THREE.SphereGeometry(0.9, 12, 10), eye, s * 2.9, 1.4, 6.5, head);
        const h = detail(new THREE.ConeGeometry(1.1, 9, 10), horn, s * 2.6, 3.8, -2.5, head); h.rotation.x = -1.1; h.rotation.z = -s * 0.3;
        detail(new THREE.SphereGeometry(0.45, 8, 6), fire, s * 1.2, 0.6, 14.4, head); // smouldering nostrils
    }
    const emitter = pivot(0, -1.4, 15, head);
    // Wings: an arm bone, finger bones and the membrane between them
    const wings = [-1, 1].map(s => {
        const sh = pivot(s * 7, 7, 6, g);
        const tip = [s * 38, 4, -2], fingers = [[s * 43, 0, -13], [s * 33, -1, -27], [s * 20, -1, -25], [s * 8, -1, -18]];
        bone([0, 0, 0], tip, 2, 0.9, dark, sh, true);
        for (const f of fingers) bone(tip, f, 0.6, 0.25, dark, sh);
        membrane([[0, 0, 0], tip, ...fingers, [0, 0, -12]], wingMat, sh);
        detail(new THREE.ConeGeometry(0.6, 3, 8), horn, tip[0], tip[1] + 1.2, tip[2], sh); // wing claw
        sh.userData.side = s;
        return sh;
    });
    // Tail with a spade, and tucked legs
    const tdir = new THREE.Vector3(0, -0.12, -1).normalize();
    const tail = chain(pivot(0, -1, -21, g), 7, 5.5, 4.6, 0.9, scale, tdir);
    const spade = chainEnd(tail, tdir, 5.5);
    membrane([[0, 0, 0], [-3.5, 0, -2], [0, 0, -6], [3.5, 0, -2]], wingMat, spade);
    for (const [x, z] of [[-6, 10], [6, 10], [-7, -10], [7, -10]]) {
        const leg = pivot(x, -7, z, g);
        mesh(new THREE.CylinderGeometry(1.8, 2.4, 9, 10), scale, 0, -4, 0, leg).rotation.x = 0.6;
        for (let c = -1; c <= 1; c++) detail(new THREE.ConeGeometry(0.4, 2, 6), horn, c * 0.9, -8.5, 3, leg).rotation.x = 1.9;
        leg.rotation.x = -0.5;
    }
    g.scale.setScalar(1.3);
    return {
        group: g, height: 70, emitter, head, glow: [fire],
        animate(t, b) {
            const flap = Math.sin(t * (b.enraged ? 4.4 : 3.1));
            wings.forEach(w => { w.rotation.z = -w.userData.side * flap * 0.55; w.rotation.y = w.userData.side * 0.12 * Math.cos(t * 3.1); });
            body.position.y = -flap * 1.2;
            tail.forEach((j, i) => { j.rotation.y = Math.sin(t * 1.6 - i * 0.6) * 0.16; j.rotation.x = Math.sin(t * 1.1 - i * 0.5) * 0.06; });
            neck.forEach((j, i) => { j.rotation.y = Math.sin(t * 0.9 - i * 0.5) * 0.05; });
            jaw.rotation.x = 0.1 + (b.attack ? 0.55 : 0.05 * (1 + Math.sin(t * 2)));
            fire.emissiveIntensity = 0.4 + b.charge * 3 + (b.enraged ? 0.6 * (1 + Math.sin(t * 9)) : 0);
        },
    };
}

// --- Sea serpent: LEVIATHAN, Serpent of the Abyss --------------------------------------------------------------------
export function buildSerpent() {
    const g = new THREE.Group(), scales = mat(0x1d6b6a, { roughness: 0.45 }), belly = mat(0xb9c79a), finMat = mat(0x2fa39a, { side: THREE.DoubleSide, roughness: 0.5 });
    const lume = glowMat(0x7af7ff, 0.5), eye = glowMat(0xfff27a, 1.3), fang = mat(0xf1ead0);
    // The neck rears out of the water at the group's origin
    const ndir = new THREE.Vector3(0, 1, 0.3).normalize();
    const neck = chain(g, 5, 8, 7, 4.4, scales, ndir);
    neck.forEach((j, i) => {
        membrane([[0, 0, -3.6 + i * 0.25], [0, 6, -6.5 + i * 0.3], [0, 8, -4 + i * 0.3]], finMat, j); // dorsal frill
        detail(new THREE.SphereGeometry(0.7, 8, 6), lume, 4.6 - i * 0.4, 4, 2.4, j); detail(new THREE.SphereGeometry(0.7, 8, 6), lume, -4.6 + i * 0.4, 4, 2.4, j);
        detail(new THREE.BoxGeometry(5 - i * 0.4, 6, 0.8), belly, 0, 4, 5.2 - i * 0.4, j);
    });
    const head = chainEnd(neck, ndir, 8);
    const skull = mesh(new THREE.SphereGeometry(5.5, 20, 14), scales, 0, 1, 3, head); skull.scale.set(1, 0.8, 1.6);
    mesh(new THREE.ConeGeometry(3.2, 9, 14), scales, 0, 0, 11, head).rotation.x = Math.PI / 2;
    const jaw = pivot(0, -2, 5, head);
    mesh(new THREE.ConeGeometry(2.6, 9, 12), belly, 0, -0.6, 4.5, jaw).rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) detail(new THREE.ConeGeometry(0.3, 1.6, 6), fang, s * (2 - i * 0.3), -1, 8 + i * 1.3, head).rotation.x = Math.PI;
    for (const s of [-1, 1]) {
        mesh(new THREE.SphereGeometry(1.1, 12, 10), eye, s * 3.6, 2.6, 7, head);
        membrane([[s * 4, 1, 0], [s * 11, 6, -4], [s * 12, 0, -7], [s * 10, -4, -5], [s * 4, -2, -1]], finMat, head); // side frills
        const h = detail(new THREE.ConeGeometry(0.9, 7, 10), fang, s * 2.4, 5, -1, head); h.rotation.x = -1.2;
    }
    const emitter = pivot(0, -0.6, 15, head);
    // Coils arching out of the waves behind it, and a tail fin
    const coils = [];
    for (let i = 0; i < 4; i++) {
        const c = mesh(new THREE.TorusGeometry(10 - i * 1.4, 4.4 - i * 0.6, 14, 28, Math.PI), scales, 0, 0, -16 - i * 19, g);
        c.rotation.y = Math.PI / 2;
        for (let k = 0; k < 5; k++) { const a = (k / 4) * Math.PI; detail(new THREE.ConeGeometry(0.8, 3, 6), finMat, 0, Math.sin(a) * (14.4 - i * 2), -16 - i * 19 + Math.cos(a) * (10 - i * 1.4), g); }
        coils.push(c);
    }
    const tailFin = pivot(0, 0, -96, g);
    membrane([[0, 0, 0], [0, 10, -6], [0, 2, -12], [0, -2, -8]], finMat, tailFin);
    g.scale.setScalar(1.3);
    return {
        group: g, height: 60, emitter, head, glow: [lume],
        animate(t, b) {
            coils.forEach((c, i) => { c.position.y = Math.sin(t * 1.3 - i * 0.9) * 2.4 - 1; });
            tailFin.rotation.y = Math.sin(t * 2) * 0.4;
            neck.forEach((j, i) => { j.rotation.z = Math.sin(t * 0.8 - i * 0.6) * 0.05; });
            jaw.rotation.x = 0.08 + (b.attack ? 0.5 : 0.04 * (1 + Math.sin(t * 2.5)));
            lume.emissiveIntensity = 0.5 + b.charge * 2.5 + 0.3 * Math.sin(t * 3) + (b.enraged ? 0.6 : 0);
        },
    };
}

// --- Phoenix: PYRRHAX, the Undying Phoenix ---------------------------------------------------------------------------
export function buildPhoenix() {
    const g = new THREE.Group(), gold = glowMat(0xf09a10, 0.35), flame = glowMat(0xff3c00, 1.0), crest = glowMat(0xffd040, 0.9), beakMat = mat(0x5a1a08), eye = glowMat(0xffffff, 2);
    const body = mesh(new THREE.SphereGeometry(6.5, 20, 14), gold, 0, 0, 0, g); body.scale.set(0.85, 0.85, 1.9);
    mesh(new THREE.SphereGeometry(4.6, 16, 12), flame, 0, -2, 6, g).scale.set(1, 0.9, 1.2); // blazing breast
    const ndir = new THREE.Vector3(0, 0.6, 0.8).normalize();
    const neck = chain(pivot(0, 3, 11, g), 2, 4, 3.6, 2.8, gold, ndir);
    const head = chainEnd(neck, ndir, 4);
    mesh(new THREE.SphereGeometry(3.4, 16, 12), gold, 0, 0, 1, head);
    mesh(new THREE.ConeGeometry(1.3, 5, 10), beakMat, 0, -0.5, 5.5, head).rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.6, 10, 8), eye, s * 1.8, 0.9, 3.4, head);
    for (let i = 0; i < 6; i++) { const c = detail(new THREE.ConeGeometry(0.6, 6 - Math.abs(i - 2.5), 8), crest, 0, 3 + i * 0.25, -i * 1.1, head); c.rotation.x = -0.9 - i * 0.12; }
    const emitter = pivot(0, -0.5, 8, head);
    // Wings of long feathers fanning out, flame at the tips
    const wings = [-1, 1].map(s => {
        const sh = pivot(s * 5.5, 3, 4, g);
        bone([0, 0, 0], [s * 17, 1, -1], 1.6, 0.9, gold, sh, true);
        for (let k = 0; k < 9; k++) { // rooted along the bone: inner feathers sweep back, the outer ones fan outward
            const len = 10 + k * 1.3, root = new THREE.Vector3(s * (1.5 + k * 1.9), 0.6, -0.6 - k * 0.05);
            const dir = new THREE.Vector3(s * (0.12 + k * 0.12), -0.04, -1).normalize();
            const f = mesh(new THREE.ConeGeometry(1.5, len, 8), k > 5 ? flame : gold, 0, 0, 0, sh);
            f.position.copy(root).addScaledVector(dir, len / 2);
            f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); // the cone's tip points outward
            f.scale.set(1, 1, 0.3);
        }
        sh.userData.side = s;
        return sh;
    });
    // Tail plumes streaming behind
    const plumes = [];
    for (let i = 0; i < 5; i++) {
        const p = pivot((i - 2) * 1.6, -1, -12, g);
        const len = 20 + (2 - Math.abs(i - 2)) * 6;
        const cone = mesh(new THREE.ConeGeometry(1.4, len, 8), i % 2 ? flame : gold, 0, 0, -len / 2, p); cone.rotation.x = -Math.PI / 2;
        detail(new THREE.SphereGeometry(1.4, 10, 8), crest, 0, 0, -len, p);
        p.rotation.y = (i - 2) * 0.16;
        plumes.push(p);
    }
    g.scale.setScalar(1.5);
    return {
        group: g, height: 50, emitter, head, glow: [flame, crest],
        animate(t, b) {
            const flap = Math.sin(t * (b.enraged ? 4.8 : 3.4));
            wings.forEach(w => { w.rotation.z = -w.userData.side * flap * 0.6; });
            body.position.y = -flap * 0.8;
            plumes.forEach((p, i) => { p.rotation.x = Math.sin(t * 2.6 + i) * 0.12; p.rotation.y = (i - 2) * 0.16 + Math.sin(t * 1.9 + i * 1.3) * 0.1; });
            flame.emissiveIntensity = 1.1 + 0.4 * Math.sin(t * 13) + b.charge * 2 + (b.enraged ? 0.8 : 0);
            crest.emissiveIntensity = 1 + 0.5 * Math.sin(t * 9 + 1) + b.charge * 1.5;
        },
    };
}

// --- Hydra: three heads on swaying necks -----------------------------------------------------------------------------
export function buildHydra() {
    const g = new THREE.Group(), skin = mat(0x2f5a2a, { roughness: 0.7 }), belly = mat(0x9aa36a), dark = mat(0x1a2a18), venom = glowMat(0x9cff3a, 0.5), eye = glowMat(0xffe14a, 1.3), fang = mat(0xece4c8);
    const body = mesh(new THREE.SphereGeometry(16, 22, 16), skin, 0, 0, 0, g); body.scale.set(1.2, 0.85, 1.4);
    mesh(new THREE.SphereGeometry(12, 18, 12), belly, 0, -5, 6, g).scale.set(1.1, 0.7, 1.2);
    for (let i = 0; i < 9; i++) detail(new THREE.ConeGeometry(1.4, 5, 8), dark, 0, 13.5 - Math.abs(i - 4) * 0.4, 14 - i * 4, g).rotation.x = -0.4;
    const legs = [[-14, 10], [14, 10], [-14, -10], [14, -10]].map(([x, z]) => {
        const hip = pivot(x, -6, z, g);
        mesh(new THREE.CylinderGeometry(4, 5, 16, 12), skin, 0, -8, 0, hip);
        for (let c = -1; c <= 1; c++) detail(new THREE.ConeGeometry(0.6, 3, 6), fang, c * 1.6, -16, 3, hip).rotation.x = 1.8;
        return hip;
    });
    const tdir = new THREE.Vector3(0, -0.2, -1).normalize();
    const tail = chain(pivot(0, -2, -20, g), 6, 6, 5, 1, skin, tdir);
    const heads = [], emitters = [], necks = [], jaws = [];
    for (const k of [-1, 0, 1]) {
        const ndir = new THREE.Vector3(k * 0.4, 0.75, 0.55).normalize();
        const neck = chain(pivot(k * 8, 8, 16, g), 4, 7, 4.2, 2.8, skin, ndir);
        neck.forEach(j => detail(new THREE.ConeGeometry(0.7, 2.6, 6), dark, 0, 3.5, -2.6, j).rotation.x = -0.7);
        const head = chainEnd(neck, ndir, 7);
        mesh(new THREE.BoxGeometry(5, 4.4, 8), skin, 0, 0, 2.5, head);
        mesh(new THREE.BoxGeometry(4, 2.6, 6), skin, 0, -0.5, 8.5, head);
        const jaw = pivot(0, -2.2, 4, head);
        mesh(new THREE.BoxGeometry(3.6, 1.2, 8.5), belly, 0, 0, 4, jaw);
        for (let i = 0; i < 4; i++) for (const s of [-1, 1]) detail(new THREE.ConeGeometry(0.25, 1.3, 6), fang, s * 1.5, -0.9, 7 + i * 1.3 - 2, head).rotation.x = Math.PI;
        for (const s of [-1, 1]) {
            mesh(new THREE.SphereGeometry(0.7, 10, 8), eye, s * 2.2, 1.4, 5, head);
            membrane([[s * 2.4, 1, -1], [s * 7, 5, -4], [s * 6.5, -1, -5]], mat(0x4d7a2a, { side: THREE.DoubleSide }), head); // frill
        }
        detail(new THREE.SphereGeometry(0.8, 8, 6), venom, 0, -1.8, 11, head); // venom dripping
        heads.push(head); emitters.push(pivot(0, -1, 12, head)); necks.push(neck); jaws.push(jaw);
    }
    g.scale.setScalar(1.25);
    return {
        group: g, height: 80, emitter: emitters[1], head: heads[1], heads, emitters, glow: [venom],
        animate(t, b) {
            necks.forEach((neck, k) => neck.forEach((j, i) => { j.rotation.z = Math.sin(t * 1.2 + k * 2.1 + i * 0.5) * 0.09; j.rotation.x = Math.sin(t * 0.9 + k + i * 0.4) * 0.05; }));
            jaws.forEach((jaw, k) => { jaw.rotation.x = 0.1 + (b.attack ? 0.5 : 0.1 * (1 + Math.sin(t * 2.2 + k * 1.7))); });
            legs.forEach((l, i) => { l.rotation.x = b.walking ? Math.sin(t * 2 + i * Math.PI / 2) * 0.25 : 0; });
            tail.forEach((j, i) => { j.rotation.y = Math.sin(t * 1.4 - i * 0.6) * 0.15; });
            venom.emissiveIntensity = 0.5 + b.charge * 2.5 + (b.enraged ? 0.6 * (1 + Math.sin(t * 7)) : 0);
        },
    };
}
