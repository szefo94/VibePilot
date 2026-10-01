/**
 * Freaky mode boss models (entities/bosses.js): built from primitives in the game's flat-shaded style, with moving
 * parts. Each builder returns { group, height, emitter, glow, animate(t, b) }:
 *   group    origin at the body's centre (the boss's hit sphere); +Z faces the player
 *   emitter  Object3D its beam and shots come from
 *   head     the part that turns to aim (entities/bosses.js faceAim points it along the aim); the kraken has none
 *   glow     materials whose emissive intensity follows the charge of an attack (b.charge 0…1)
 *   animate  called every step: t = seconds alive, b = the boss state (charge, enraged, attack, walking)
 */
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.1, flatShading: true, ...o });
const glowMat = (color, intensity = 1) => mat(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
function mesh(geo, material, x = 0, y = 0, z = 0, parent = null) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    parent?.add(m);
    return m;
}
/** A small detail (teeth, rivets, suckers): drawn, but not part of the hit shape (combat/hitShapes.js). */
function detail(geo, material, x, y, z, parent) { const m = mesh(geo, material, x, y, z, parent); m.userData.noHit = true; return m; }
const pivot = (x, y, z, parent) => { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; };
/** A chain of tapering cylinder segments; returns the joints (each the parent of the next) for waving. */
function chain(parent, n, len, r0, r1, material, dir = new THREE.Vector3(0, 1, 0)) {
    const joints = [];
    let p = parent;
    for (let i = 0; i < n; i++) {
        const j = new THREE.Group();
        if (i) j.position.copy(dir).multiplyScalar(len);
        p.add(j);
        const r = r0 + (r1 - r0) * (i / n), rn = r0 + (r1 - r0) * ((i + 1) / n);
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(rn, r, len, 14), material);
        seg.position.copy(dir).multiplyScalar(len / 2);
        seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        j.add(seg);
        joints.push(j); p = j;
    }
    return joints;
}

// --- Kaiju: a towering reptile with glowing dorsal plates and an atomic breath ---------------------------------------
export function buildKaiju() {
    const g = new THREE.Group(), skin = mat(0x3b4a39, { roughness: 0.9 }), belly = mat(0x7d7a55), dark = mat(0x23291f);
    const plate = glowMat(0x9fd8ff, 0.25), eye = glowMat(0xffd23a, 1.2);
    const body = mesh(new THREE.SphereGeometry(18, 20, 16), skin, 0, 0, 0, g); body.scale.set(1, 1.55, 1.1); body.rotation.x = 0.18;
    mesh(new THREE.SphereGeometry(14, 16, 12), belly, 0, -2, 8, g).scale.set(0.95, 1.5, 0.6);
    const legs = [-1, 1].map(s => {
        const hip = pivot(s * 11, -22, -2, g);
        mesh(new THREE.CylinderGeometry(7, 9, 30, 16), skin, 0, -14, 0, hip);
        mesh(new THREE.BoxGeometry(12, 5, 18), dark, 0, -30, 4, hip);
        return hip;
    });
    const arms = [-1, 1].map(s => {
        const sh = pivot(s * 16, 12, 8, g);
        const a = mesh(new THREE.CylinderGeometry(2.6, 3.4, 16, 14), skin, 0, -6, 4, sh); a.rotation.x = -0.9;
        for (let i = -1; i <= 1; i++) mesh(new THREE.ConeGeometry(0.9, 4, 10), belly, i * 1.6, -11, 11, sh).rotation.x = -1.6;
        return sh;
    });
    const neck = pivot(0, 26, 6, g);
    mesh(new THREE.CylinderGeometry(7, 10, 12, 16), skin, 0, 2, 0, neck).rotation.x = 0.4;
    const head = pivot(0, 9, 5, neck);
    mesh(new THREE.BoxGeometry(13, 10, 20), skin, 0, 0, 4, head);
    const jaw = pivot(0, -4, -2, head);
    mesh(new THREE.BoxGeometry(11, 3.5, 18), belly, 0, -1.5, 6, jaw);
    for (const s of [-1, 1]) { mesh(new THREE.SphereGeometry(1.4, 12, 10), eye, s * 5, 2.5, 9, head); mesh(new THREE.ConeGeometry(1.6, 4, 10), dark, s * 4, 6, -2, head).rotation.x = -0.6; }
    const emitter = pivot(0, -1, 15, head);
    const tooth = mat(0xf2ead2), toothGeo = new THREE.ConeGeometry(0.55, 2.2, 8);
    for (let i = 0; i < 7; i++) { detail(toothGeo, tooth, -4.5 + i * 1.5, -4.6, 13.6, head).rotation.x = Math.PI; detail(toothGeo, tooth, -4 + i * 1.4, 0.6, 14.4, jaw); }
    for (const [i, l] of legs.entries()) for (let c = -1; c <= 1; c++) detail(new THREE.ConeGeometry(0.9, 4, 8), tooth, c * 3.2, -31, 13, l).rotation.x = Math.PI / 2 + (i ? 0.1 : -0.1);
    for (let i = 0; i < 6; i++) detail(new THREE.BoxGeometry(11 - i * 0.6, 2.2, 1.6), belly, 0, 12 - i * 5, 13.5 - Math.abs(i - 2) * 0.6, g);
    const scaleGeo = new THREE.ConeGeometry(1.1, 2, 6);
    for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2, y = -14 + (i % 5) * 8; detail(scaleGeo, dark, Math.cos(a) * 17.5, y, Math.sin(a) * 18 - 1, g).lookAt(Math.cos(a) * 40, y, Math.sin(a) * 40); }
    // Tail: six segments trailing back and down
    const tailBase = pivot(0, -18, -14, g); tailBase.rotation.x = -2.1;
    const tail = chain(tailBase, 6, 10, 9, 2, skin);
    // Dorsal plates down the back and tail
    for (let i = 0; i < 6; i++) { const p = mesh(new THREE.ConeGeometry(3.4 - i * 0.35, 9 - i * 0.6, 4), plate, 0, 24 - i * 8, -14 + i * 0.8, g); p.rotation.x = -0.35; p.scale.z = 0.35; }
    tail.forEach((j, i) => { const p = mesh(new THREE.ConeGeometry(2.4 - i * 0.3, 6 - i * 0.6, 4), plate, 0, 5, 5, j); p.scale.z = 0.35; p.rotation.x = 1.6; });
    g.scale.setScalar(1.25);
    return {
        group: g, height: 110, emitter, head, glow: [plate],
        animate(t, b) {
            tail.forEach((j, i) => { j.rotation.z = Math.sin(t * 1.4 - i * 0.7) * 0.18; });
            neck.rotation.x = -0.15 + Math.sin(t * 0.9) * 0.06 - b.charge * 0.25;
            jaw.rotation.x = 0.1 + (b.attack ? 0.45 : 0.05 * (1 + Math.sin(t * 2)));
            arms.forEach((a, i) => { a.rotation.x = Math.sin(t * 1.6 + i * Math.PI) * 0.25; });
            legs.forEach((l, i) => { l.rotation.x = b.walking ? Math.sin(t * 2.2 + i * Math.PI) * 0.3 : 0; });
            plate.emissiveIntensity = 0.25 + b.charge * 2.5 + (b.enraged ? 0.3 * (1 + Math.sin(t * 8)) : 0);
        },
    };
}

// --- Kraken: a giant mantle with eight writhing tentacles ------------------------------------------------------------
export function buildKraken() {
    const g = new THREE.Group(), hide = mat(0x7a2648, { roughness: 0.55 }), arm = mat(0x9a3a5e, { roughness: 0.5 }), eyeW = glowMat(0xffe27a, 0.9), pupil = mat(0x101010);
    const mantle = mesh(new THREE.SphereGeometry(20, 24, 20), hide, 0, 26, -4, g); mantle.scale.set(1, 1.75, 1.05); mantle.rotation.x = -0.25;
    mesh(new THREE.SphereGeometry(16, 20, 16), hide, 0, 0, 2, g).scale.set(1.1, 0.75, 1.1);
    for (const s of [-1, 1]) { mesh(new THREE.SphereGeometry(4.5, 20, 16), eyeW, s * 10, 4, 12, g); mesh(new THREE.SphereGeometry(2, 16, 12), pupil, s * 10.5, 4.3, 16, g).scale.set(0.6, 1.4, 0.6); }
    const emitter = pivot(0, 0, 17, g);
    const arms = [], sucker = mat(0xe8a0b8), suckerGeo = new THREE.CylinderGeometry(0.9, 1.1, 0.5, 12);
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, base = pivot(Math.sin(a) * 12, -6, Math.cos(a) * 12, g);
        base.rotation.set(Math.cos(a) * 1.2, 0, -Math.sin(a) * 1.2);
        const joints = chain(base, 7, 7.5, 3.6, 0.8, arm);
        joints.forEach((j, k) => { for (const y of [2.2, 5.2]) { const sc = 1 - k * 0.11; const su = detail(suckerGeo, sucker, 0, y, -(3.2 - k * 0.38), j); su.rotation.x = Math.PI / 2; su.scale.setScalar(sc); } });
        arms.push(joints);
    }
    detail(new THREE.ConeGeometry(2.4, 5, 10), mat(0x2a1a14), 0, -8, 6, g).rotation.x = Math.PI * 0.85; // beak
    for (const sgn of [-1, 1]) { const fin = detail(new THREE.BoxGeometry(1.2, 14, 9), hide, sgn * 18, 52, -6, g); fin.rotation.z = sgn * 0.5; }
    g.scale.setScalar(1.3);
    return {
        group: g, height: 90, emitter, glow: [eyeW],
        animate(t, b) {
            arms.forEach((joints, k) => joints.forEach((j, i) => { j.rotation.x = Math.sin(t * 1.7 + k + i * 0.6) * (0.22 + b.charge * 0.2); j.rotation.z = Math.cos(t * 1.3 + k * 0.7 + i * 0.5) * 0.18; }));
            mantle.rotation.x = -0.25 + Math.sin(t * 0.8) * 0.08;
            eyeW.emissiveIntensity = 0.9 + b.charge * 2 + (b.enraged ? 0.6 : 0);
        },
    };
}

// --- Magma golem: basalt boulders held together by molten rock --------------------------------------------------------
export function buildGolem() {
    const g = new THREE.Group(), rock = mat(0x2d2725, { roughness: 1 }), rock2 = mat(0x3d3330, { roughness: 1 }), lava = glowMat(0xff5a10, 1.4);
    const rockAt = (r, m, x, y, z, parent = g, detail = 1) => { const b = mesh(new THREE.DodecahedronGeometry(r, detail), m, x, y, z, parent); b.rotation.set(x * 0.13, y * 0.07, z * 0.11); return b; };
    rockAt(19, rock, 0, 6, 0); rockAt(12, rock2, 0, -14, 2);
    const core = mesh(new THREE.IcosahedronGeometry(6, 1), lava, 0, 8, 15, g);
    for (let i = 0; i < 6; i++) { const c = mesh(new THREE.BoxGeometry(1.2, 9 + i, 1.2), lava, -12 + i * 5, 4 + (i % 2) * 6, 15.5, g); c.rotation.z = (i % 2 ? 0.6 : -0.5); }
    const head = pivot(0, 28, 4, g);
    rockAt(8, rock2, 0, 0, 0, head);
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(3, 1.4, 1), lava, s * 3.2, 1, 7.5, head);
    const mouth = mesh(new THREE.BoxGeometry(6, 1.2, 1), lava, 0, -3, 7.5, head);
    const arms = [-1, 1].map(s => {
        const sh = pivot(s * 21, 14, 0, g);
        rockAt(7, rock2, 0, 0, 0, sh); rockAt(6, rock, s * 2, -12, 3, sh); rockAt(8.5, rock2, s * 3, -25, 6, sh);
        mesh(new THREE.IcosahedronGeometry(3, 1), lava, s * 3, -25, 13, sh);
        return sh;
    });
    const legs = [-1, 1].map(s => { const hip = pivot(s * 9, -24, 0, g); rockAt(8, rock, 0, -6, 0, hip); rockAt(9, rock2, 0, -19, 3, hip); return hip; });
    const emitter = pivot(0, -3, 9, head);
    const spike = new THREE.ConeGeometry(2.2, 9, 7);
    for (const [x, y, z, rx, rz] of [[-16, 22, -6, -0.6, 0.6], [16, 22, -6, -0.6, -0.6], [-8, 26, -12, -0.9, 0.3], [8, 26, -12, -0.9, -0.3], [0, 20, -18, -1.2, 0]]) { const sp = detail(spike, rock, x, y, z, g); sp.rotation.set(rx, 0, rz); }
    for (let i = 0; i < 8; i++) { const v = detail(new THREE.BoxGeometry(0.9, 6 + (i % 3) * 3, 0.9), lava, Math.sin(i * 1.7) * 14, -2 + (i % 4) * 7, -15 + Math.cos(i) * 3, g); v.rotation.set(i * 0.4, 0, (i % 2 ? 0.7 : -0.6)); }
    g.scale.setScalar(1.3);
    return {
        group: g, height: 100, emitter, head, glow: [lava],
        animate(t, b) {
            lava.emissiveIntensity = 1.1 + 0.4 * Math.sin(t * 3) + b.charge * 2 + (b.enraged ? 0.8 : 0);
            core.rotation.y = t * 0.7; core.scale.setScalar(1 + 0.08 * Math.sin(t * 4));
            arms.forEach((a, i) => { a.rotation.x = Math.sin(t * 1.1 + i * Math.PI) * 0.3 - b.charge * 1.4; });
            legs.forEach((l, i) => { l.rotation.x = b.walking ? Math.sin(t * 1.8 + i * Math.PI) * 0.25 : 0; });
            head.rotation.y = Math.sin(t * 0.6) * 0.2; mouth.scale.y = 1 + b.charge * 2;
        },
    };
}

// --- TITAN-9: a rampaging mech with shoulder missile pods and an eye laser ----------------------------------------------
export function buildRobot() {
    const g = new THREE.Group(), steel = mat(0x7d8590, { metalness: 0.5, roughness: 0.45 }), darkS = mat(0x3a3f47, { metalness: 0.5, roughness: 0.5 });
    const hazard = mat(0xd8b43a), visor = glowMat(0xff2a2a, 1.4), vent = glowMat(0xffa040, 0.6);
    mesh(new THREE.BoxGeometry(30, 24, 18), steel, 0, 12, 0, g);
    for (let i = 0; i < 4; i++) mesh(new THREE.BoxGeometry(4, 2, 0.6), i % 2 ? darkS : hazard, -6 + i * 4, 3, 9.2, g);
    mesh(new THREE.BoxGeometry(10, 6, 0.6), vent, 0, 14, 9.2, g);
    mesh(new THREE.BoxGeometry(20, 8, 14), darkS, 0, -4, 0, g);
    const head = pivot(0, 28, 1, g);
    mesh(new THREE.BoxGeometry(12, 9, 11), steel, 0, 0, 0, head);
    mesh(new THREE.BoxGeometry(10, 2.4, 0.8), visor, 0, 0.5, 5.6, head);
    mesh(new THREE.CylinderGeometry(0.3, 0.3, 8, 8), darkS, 4, 8, -2, head);
    const pods = [-1, 1].map(s => {
        const pod = pivot(s * 18, 26, -2, g);
        mesh(new THREE.BoxGeometry(9, 8, 12), hazard, 0, 0, 0, pod);
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) mesh(new THREE.CylinderGeometry(1.2, 1.2, 1, 16), darkS, -2 + c * 4, -2 + r * 4, 6.2, pod).rotation.x = Math.PI / 2;
        return pod;
    });
    const arms = [-1, 1].map(s => {
        const sh = pivot(s * 19, 16, 0, g);
        mesh(new THREE.BoxGeometry(7, 16, 7), darkS, 0, -8, 0, sh);
        const fore = pivot(0, -16, 0, sh);
        mesh(new THREE.BoxGeometry(8, 14, 8), steel, 0, -7, 2, fore);
        mesh(new THREE.CylinderGeometry(1.6, 1.6, 10, 16), darkS, 0, -10, 9, fore).rotation.x = Math.PI / 2;
        return { sh, fore };
    });
    const legs = [-1, 1].map(s => {
        const hip = pivot(s * 8, -8, 0, g);
        mesh(new THREE.BoxGeometry(8, 20, 9), darkS, 0, -10, 0, hip);
        const knee = pivot(0, -20, 0, hip);
        mesh(new THREE.BoxGeometry(9, 20, 10), steel, 0, -10, 1, knee);
        mesh(new THREE.BoxGeometry(11, 4, 16), darkS, 0, -21, 3, knee);
        return { hip, knee };
    });
    const emitter = pivot(0, 0.5, 6.5, head);
    const rivet = new THREE.SphereGeometry(0.45, 10, 8);
    for (let i = 0; i < 8; i++) for (const y of [22.5, 1.5]) detail(rivet, darkS, -13 + i * 3.7, y, 9.3, g);
    const lamp = glowMat(0x40c8ff, 1.5);
    for (let i = 0; i < 3; i++) detail(new THREE.BoxGeometry(2, 1.2, 0.5), lamp, -9 + i * 9, 20, 9.4, g);
    for (const { hip, knee } of legs) { detail(new THREE.CylinderGeometry(0.9, 0.9, 16, 12), steel, 0, -8, -5.5, hip); detail(new THREE.CylinderGeometry(0.6, 0.6, 12, 12), hazard, 0, -6, -6, knee); }
    for (const { fore } of arms) for (const c of [-1, 1]) detail(new THREE.ConeGeometry(0.8, 4, 8), darkS, c * 2.6, -15, 2, fore).rotation.x = Math.PI;
    g.scale.setScalar(1.35);
    return {
        group: g, height: 110, emitter, head, pods, glow: [visor],
        animate(t, b) {
            const w = b.walking ? 1 : 0.15;
            legs.forEach(({ hip, knee }, i) => { const ph = t * 2.4 + i * Math.PI; hip.rotation.x = Math.sin(ph) * 0.35 * w; knee.rotation.x = Math.max(0, -Math.sin(ph)) * 0.5 * w; });
            arms.forEach(({ sh, fore }, i) => { sh.rotation.x = -Math.sin(t * 2.4 + i * Math.PI) * 0.3 * w - b.charge * 0.6; fore.rotation.x = -0.4; });
            head.rotation.y = Math.sin(t * 0.7) * 0.3;
            visor.emissiveIntensity = 1.4 + b.charge * 3 + (b.enraged ? Math.abs(Math.sin(t * 10)) : 0);
            pods.forEach(p => { p.rotation.x = b.attack === 'missiles' ? -0.5 : 0; });
        },
    };
}

// --- Specimen 47: an escaped alien with glowing sacs, claws and a stinger ------------------------------------------------
export function buildAlien() {
    const g = new THREE.Group(), shell = mat(0x1d2230, { metalness: 0.45, roughness: 0.28 }), flesh = mat(0x3a2f45, { roughness: 0.5 }), acid = glowMat(0x66ff55, 1.2);
    const body = mesh(new THREE.SphereGeometry(12, 20, 16), shell, 0, 0, 0, g); body.scale.set(1, 0.9, 1.8);
    const abdomen = mesh(new THREE.SphereGeometry(10, 20, 16), flesh, 0, 2, -20, g); abdomen.scale.set(1, 0.9, 1.4);
    const sacs = [];
    for (let i = 0; i < 5; i++) sacs.push(mesh(new THREE.SphereGeometry(2.4, 16, 12), acid, (i % 2 ? 4 : -4), 9, -14 - i * 3, g));
    const head = pivot(0, 6, 18, g);
    const skull = mesh(new THREE.ConeGeometry(6, 22, 16), shell, 0, 4, -6, head); skull.rotation.x = -1.9;
    const jaw = pivot(0, -2, 4, head);
    mesh(new THREE.BoxGeometry(6, 2.5, 9), flesh, 0, -1, 3, jaw);
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(1.2, 12, 10), acid, s * 3, 1.5, 6, head);
    const emitter = pivot(0, -1, 9, head);
    const limbs = [];
    for (let i = 0; i < 6; i++) {
        const side = i % 2 ? 1 : -1, z = 8 - Math.floor(i / 2) * 9;
        const hip = pivot(side * 9, -2, z, g);
        const upper = mesh(new THREE.CylinderGeometry(1.4, 2, 18, 12), shell, side * 6, 4, 0, hip); upper.rotation.z = -side * 1.1;
        const lower = mesh(new THREE.CylinderGeometry(0.6, 1.4, 22, 12), shell, side * 15, -9, 0, hip); lower.rotation.z = side * 0.35;
        limbs.push(hip);
    }
    const rib = new THREE.TorusGeometry(9, 0.9, 8, 24, Math.PI);
    for (let i = 0; i < 6; i++) { const r = detail(rib, shell, 0, 3, 10 - i * 5.5, g); r.scale.set(1 - Math.abs(i - 2.5) * 0.07, 1, 1); }
    const fang = mat(0xdfe8d0);
    for (let i = 0; i < 6; i++) detail(new THREE.ConeGeometry(0.35, 1.8, 8), fang, -2 + i * 0.8, -2.4, 8.6, head).rotation.x = Math.PI;
    for (const l of limbs) detail(new THREE.ConeGeometry(0.6, 4, 8), fang, (l.position.x > 0 ? 1 : -1) * 18, -21, 0, l).rotation.z = Math.PI;
    const tailBase = pivot(0, 4, -32, g); tailBase.rotation.x = -1.2;
    const tail = chain(tailBase, 6, 6, 3, 0.8, shell);
    mesh(new THREE.ConeGeometry(1.4, 6, 12), acid, 0, 6, 0, tail[tail.length - 1]);
    g.scale.setScalar(1.4);
    return {
        group: g, height: 70, emitter, head, glow: [acid],
        animate(t, b) {
            sacs.forEach((s, i) => s.scale.setScalar(1 + 0.25 * Math.sin(t * 4 + i) + b.charge * 0.5));
            tail.forEach((j, i) => { j.rotation.x = Math.sin(t * 2 - i * 0.6) * 0.25; j.rotation.z = Math.cos(t * 1.4 - i * 0.5) * 0.2; });
            limbs.forEach((l, i) => { l.rotation.x = Math.sin(t * (b.walking ? 5 : 1.5) + i) * 0.25; });
            jaw.rotation.x = b.attack ? 0.6 : 0.1 + 0.1 * Math.sin(t * 3);
            head.rotation.y = Math.sin(t * 1.1) * 0.25;
            acid.emissiveIntensity = 1.2 + b.charge * 2.5 + (b.enraged ? 0.8 : 0);
        },
    };
}

// --- Stahlmond Zombot: an iron robo-zombie from the dark side of the Moon, flying on rocket thrusters ------------------
export function buildZombot() {
    const g = new THREE.Group(), iron = mat(0x5b4a42, { metalness: 0.55, roughness: 0.6 }), steel = mat(0x3a3d43, { metalness: 0.6, roughness: 0.45 });
    const rot = mat(0x6f8f4a, { roughness: 0.9 }), eye = glowMat(0xff2020, 2), flame = glowMat(0xff9a2a, 2.2), moon = mat(0xb9b6ad, { roughness: 1 });
    mesh(new THREE.BoxGeometry(22, 26, 14), iron, 0, 0, 0, g);
    for (const [x, y] of [[-6, 6], [5, -5], [-4, -9]]) mesh(new THREE.BoxGeometry(6, 5, 1), rot, x, y, 7.2, g);
    for (let i = 0; i < 5; i++) mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.4, 12), steel, -8 + i * 4, 10, 7.4, g).rotation.x = Math.PI / 2; // rivets
    mesh(new THREE.BoxGeometry(24, 4, 15), moon, 0, -14, 0, g); // moon-dust belt
    const head = pivot(0, 19, 1, g);
    mesh(new THREE.SphereGeometry(7, 20, 16), rot, 0, 0, 0, head);
    mesh(new THREE.BoxGeometry(10, 4, 4), steel, 0, -4, 5, head); // iron jaw plate
    mesh(new THREE.SphereGeometry(2.6, 20, 16), eye, 3, 1.5, 6, head);
    const helmet = mesh(new THREE.SphereGeometry(7.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), steel, 0, 1, 0, head);
    mesh(new THREE.ConeGeometry(1.4, 7, 12), steel, 0, 10, 0, helmet); // spike
    const emitter = pivot(3, 1.5, 8, head);
    const cannonArm = pivot(-14, 8, 0, g);
    mesh(new THREE.BoxGeometry(7, 16, 7), steel, 0, -6, 0, cannonArm);
    const barrel = mesh(new THREE.CylinderGeometry(2.6, 3.2, 16, 16), iron, 0, -14, 7, cannonArm); barrel.rotation.x = Math.PI / 2;
    const clawArm = pivot(14, 8, 0, g);
    mesh(new THREE.CylinderGeometry(2.4, 3, 18, 14), rot, 0, -8, 2, clawArm);
    for (let i = -1; i <= 1; i++) mesh(new THREE.ConeGeometry(0.9, 6, 10), steel, i * 2, -19, 4, clawArm).rotation.x = Math.PI;
    const flames = [];
    for (const s of [-1, 1]) {
        mesh(new THREE.CylinderGeometry(3, 3.6, 14, 16), steel, s * 6, 2, -10, g);
        const f = mesh(new THREE.ConeGeometry(2.8, 12, 16), flame, s * 6, -11, -10, g); f.rotation.x = Math.PI;
        flames.push(f);
    }
    for (const sgn of [-1, 1]) for (let i = 0; i < 3; i++) detail(new THREE.CylinderGeometry(0.7, 0.9, 6, 12), steel, sgn * (9 + i * 1.8), 12 - i * 1.5, -8, g).rotation.x = -0.4;
    const brass = mat(0xb08a3a, { metalness: 0.7, roughness: 0.35 });
    for (let i = 0; i < 9; i++) { const sh = detail(new THREE.CylinderGeometry(0.55, 0.55, 2.4, 10), brass, -8 + i * 2, 5 - i * 1.4, 7.6, g); sh.rotation.z = 0.6; }
    detail(new THREE.CylinderGeometry(2, 2, 0.6, 20), glowMat(0x66ff66, 0.8), 6, 4, 7.4, g).rotation.x = Math.PI / 2; // a rotting gauge
    g.scale.setScalar(1.45);
    return {
        group: g, height: 75, emitter, head, glow: [eye], flies: true,
        animate(t, b) {
            flames.forEach((f, i) => { f.scale.set(1, 0.8 + 0.4 * Math.abs(Math.sin(t * 23 + i * 2)), 1); });
            cannonArm.rotation.x = -0.4 - b.charge * 0.9 + Math.sin(t * 1.3) * 0.1;
            clawArm.rotation.x = Math.sin(t * 2.1) * 0.4; clawArm.rotation.z = 0.2 + Math.sin(t * 3.3) * 0.15;
            head.rotation.z = Math.sin(t * 2.7) * 0.12; head.rotation.y = Math.sin(t * 0.9) * 0.3;
            eye.emissiveIntensity = 2 + b.charge * 3 + (b.enraged ? 1.5 * Math.abs(Math.sin(t * 12)) : 0);
        },
    };
}
