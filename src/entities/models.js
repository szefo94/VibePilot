/**
 * Low-poly unit models, baked with core/meshkit.js (one geometry per moving piece, vertex colours, flat shading).
 * Built the way you would in Blender: silhouettes from extruded side/top profiles, detail from small primitives,
 * a limited colour palette per unit, everything joined per piece. Sizes match the old box models, so collision
 * radii, pivots and gameplay are unchanged. Every geometry here is built once and shared (markShared).
 *
 * Coordinates are in each unit's local frame before its scale: +Z is forward (where barrels point), +Y is up.
 */
import { bake, part, profile } from '../core/meshkit.js';
import { markShared } from '../core/utils.js';

const box = (w, h, d, c, t) => part(new THREE.BoxGeometry(w, h, d), c, t);
const cyl = (rt, rb, h, seg, c, t) => part(new THREE.CylinderGeometry(rt, rb, h, seg), c, t);
/** Side-view profile [[z, y]…] extruded across X by `width`. */
const side = (pts, width, c, t = {}) => part(profile(pts, width), c, { ...t, ry: (t.ry || 0) - Math.PI / 2 });
/** Top-view profile [[x, z]…] extruded up by `height` (centred on y). */
const top = (pts, height, c, t = {}) => part(profile(pts.map(([x, z]) => [x, -z]), height), c, { ...t, rx: -Math.PI / 2 });
const shared = parts => markShared(bake(parts));

// --- Palettes ---
const OLIVE = 0x5b6a3a, OLIVE_D = 0x46522c, OLIVE_L = 0x6f7e48, TRACK = 0x2b2b27, WHEEL = 0x3a3a34, GUNMETAL = 0x3c3f3d;
const NAVY = 0x5d6671, NAVY_D = 0x40464e, DECK = 0x3b4046, SUPER = 0x8a929a, BOOT = 0x6b2a25, WHITE = 0xe6e3da, YELLOW = 0xd8b43a, GLASS = 0x2b5d6e;
const CONCRETE = 0x8a8778, ASPHALT = 0x39393b, HANGAR = 0x7c8474, HANGAR_D = 0x596055;

// --- Tank (scale 3): hull, turret on its pivot (y 1.38), barrel on the barrel pivot -------------------------
const TANK_BODY = [[-2.9, -0.2], [2.35, -0.2], [3.0, 0.22], [2.25, 0.76], [-2.75, 0.76], [-3.0, 0.32]]; // glacis front, sloped rear
const TRACK_SIDE = [[-2.95, -0.36], [2.95, -0.36], [3.3, 0.04], [2.95, 0.4], [-2.95, 0.4], [-3.3, 0.04]];
export const tankHullGeo = shared([
    side(TANK_BODY, 3.5, OLIVE),
    ...[-1, 1].flatMap(s => [
        side(TRACK_SIDE, 0.72, TRACK, { x: s * 2.2 }),
        ...[-2.2, -1.1, 0, 1.1, 2.2].map(z => cyl(0.34, 0.34, 0.78, 8, WHEEL, { x: s * 2.22, y: -0.08, z, rz: Math.PI / 2 })),
        box(0.95, 0.1, 5.9, OLIVE_D, { x: s * 2.2, y: 0.46 }),                           // fender
        box(0.3, 0.25, 1.1, OLIVE_L, { x: s * 2.3, y: 0.62, z: -0.8 }),                  // stowage box
    ]),
    box(2.1, 0.08, 1.3, TRACK, { y: 0.8, z: -2.0 }),                                     // engine grille
    cyl(0.12, 0.12, 0.5, 6, GUNMETAL, { x: -1.1, y: 0.5, z: -3.05, rx: Math.PI / 2 }),   // exhausts
    cyl(0.12, 0.12, 0.5, 6, GUNMETAL, { x: 1.1, y: 0.5, z: -3.05, rx: Math.PI / 2 }),
    box(0.22, 0.18, 0.22, 0xe0d8a0, { x: -1.3, y: 0.62, z: 2.55 }),                      // headlights
    box(0.22, 0.18, 0.22, 0xe0d8a0, { x: 1.3, y: 0.62, z: 2.55 }),
]);
const TURRET_TOP = [[-1.2, -1.35], [1.2, -1.35], [1.55, -0.25], [1.05, 1.35], [-1.05, 1.35], [-1.55, -0.25]];
export const tankTurretGeo = shared([
    top(TURRET_TOP, 0.72, OLIVE_L, { y: -0.27 }),
    box(0.85, 0.62, 0.45, OLIVE, { y: -0.28, z: 1.45 }),                                 // mantlet
    cyl(0.36, 0.4, 0.3, 8, OLIVE_D, { x: -0.55, y: 0.24, z: -0.35 }),                    // commander cupola
    cyl(0.3, 0.3, 0.08, 8, OLIVE, { x: -0.55, y: 0.42, z: -0.35 }),
    box(2.1, 0.34, 0.55, OLIVE_D, { y: -0.18, z: -1.6 }),                                // stowage basket
    cyl(0.02, 0.02, 1.7, 4, TRACK, { x: 0.95, y: 0.9, z: -1.05 }),                       // antenna
    box(0.28, 0.2, 0.4, GUNMETAL, { x: 0.8, y: 0.2, z: 0.6 }),                           // sight
]);
export const tankBarrelGeo = shared([
    cyl(0.13, 0.18, 3.7, 8, GUNMETAL, { y: -0.27, z: 3.3, rx: Math.PI / 2 }),
    cyl(0.23, 0.23, 0.55, 8, GUNMETAL, { y: -0.27, z: 3.2, rx: Math.PI / 2 }),          // bore evacuator
    box(0.44, 0.3, 0.45, TRACK, { y: -0.27, z: 5.2 }),                                   // muzzle brake
]);

// --- AA emplacement (scale 3): pad + sandbag ring, a twin-barrel mount on the pivot (y 1.25) --------------------
export const aaBaseGeo = shared([
    cyl(2.2, 2.3, 0.3, 10, CONCRETE, { y: -0.6 }),
    // Sandbags laid along the ring (bag axis = tangent): lie down with rx first, then turn about the vertical
    ...Array.from({ length: 11 }, (_, i) => { const a = (i / 12) * Math.PI * 2 + 0.3; return cyl(0.32, 0.36, 0.95, 6, 0xa89668, { x: Math.cos(a) * 1.85, y: -0.2, z: Math.sin(a) * 1.85, rx: Math.PI / 2, ry: -a, order: 'ZYX' }); }),
    ...Array.from({ length: 9 }, (_, i) => { const a = (i / 12) * Math.PI * 2 + 0.55; return cyl(0.3, 0.34, 0.9, 6, 0x9a8a60, { x: Math.cos(a) * 1.8, y: 0.3, z: Math.sin(a) * 1.8, rx: Math.PI / 2, ry: -a, order: 'ZYX' }); }),
    cyl(0.35, 0.45, 1.1, 8, GUNMETAL, { y: 0.4 }),                                       // pedestal
]);
export const aaMountGeo = shared([
    cyl(0.85, 0.95, 0.45, 10, OLIVE, {}),
    box(1.7, 0.95, 0.12, OLIVE_D, { y: 0.4, z: 0.75, rx: -0.25 }),                      // gun shield
    box(0.3, 0.55, 0.9, GUNMETAL, { x: -0.7, y: 0.35 }),                                 // seat / sight
]);
export const aaBarrelGeo = shared([-0.28, 0.28].flatMap(x => [
    cyl(0.1, 0.12, 3.2, 6, GUNMETAL, { x, y: 0.35, z: 1.75, rx: Math.PI / 2 }),
    cyl(0.15, 0.15, 0.35, 6, TRACK, { x, y: 0.35, z: 3.35, rx: Math.PI / 2 }),          // flash hiders
    box(0.3, 0.3, 0.8, OLIVE, { x, y: 0.35, z: 0.2 }),                                   // receivers
]));

// --- Truck (scale 2.5): cab, canvas-covered cargo bed, six wheels --------------------------------------------
const TRUCK = 0x5f6440, CANVAS = 0x6f6c4c;
export const truckGeo = shared([
    box(1.7, 0.22, 6.4, TRACK, { y: 0.02 }),                                             // chassis
    side([[1.9, 0.25], [3.35, 0.25], [3.35, 0.72], [2.6, 0.95], [1.9, 0.95]], 1.6, TRUCK), // sloped hood
    box(1.8, 1.35, 1.6, TRUCK, { y: 0.95, z: 1.2 }),                                     // cab
    box(1.82, 0.5, 1.2, GLASS, { y: 1.3, z: 1.5 }),                                      // windscreen band
    box(1.9, 0.22, 0.25, GUNMETAL, { y: 0.35, z: 3.45 }),                                // bumper
    box(0.3, 0.2, 0.08, 0xe0d8a0, { x: -0.6, y: 0.6, z: 3.37 }), box(0.3, 0.2, 0.08, 0xe0d8a0, { x: 0.6, y: 0.6, z: 3.37 }),
    box(1.8, 0.14, 3.6, TRUCK, { y: 0.3, z: -1.35 }),                                    // bed
    box(0.08, 0.5, 3.6, TRUCK, { x: -0.88, y: 0.6, z: -1.35 }), box(0.08, 0.5, 3.6, TRUCK, { x: 0.88, y: 0.6, z: -1.35 }),
    part(new THREE.CylinderGeometry(0.9, 0.9, 3.5, 8, 1, false, 0, Math.PI), CANVAS, { y: 0.8, z: -1.35, rx: Math.PI / 2, rz: Math.PI / 2, order: 'ZYX' }), // canvas cover: axis along the bed, arch up
    box(1.8, 0.9, 0.06, CANVAS, { y: 1.25, z: -3.12 }),                                  // cover's back flap
    box(0.5, 0.35, 0.6, GUNMETAL, { x: 0.95, y: 0.2, z: 0.1 }),                          // fuel tank
    ...[[2.5, 1], [-1.3, 1], [-2.5, 1]].flatMap(([z]) => [-1, 1].map(s => cyl(0.45, 0.45, 0.28, 8, TRACK, { x: s * 1.0, y: 0, z, rz: Math.PI / 2 }))),
]);

// --- Hangars (unscaled) -----------------------------------------------------------------------------------------
export const archHangarGeo = (() => {
    const r = 12, len = 44;
    const shell = new THREE.CylinderGeometry(r, r, len, 18, 1, true, -Math.PI / 2, Math.PI); // half-cylinder, open ends
    return shared([
        part(shell, HANGAR, { rx: -Math.PI / 2 }),
        ...[-18, -9, 0, 9, 18].map(z => part(new THREE.CylinderGeometry(r + 0.25, r + 0.25, 0.7, 18, 1, true, -Math.PI / 2, Math.PI), HANGAR_D, { z, rx: -Math.PI / 2 })), // ribs
        part(new THREE.CircleGeometry(r, 18, 0, Math.PI), HANGAR_D, { z: -len / 2, ry: Math.PI }),            // back wall, facing out
        part(new THREE.CircleGeometry(r, 18, 0, Math.PI), HANGAR_D, { z: len / 2 }),                          // front wall, facing out
        box(2 * r * 0.72, r * 0.62, 0.4, 0x4d524a, { y: r * 0.31, z: len / 2 + 0.25 }),                        // big door
        box(0.25, r * 0.62, 0.45, 0x2f322e, { y: r * 0.31, z: len / 2 + 0.3 }),                               // door split
        box(2 * r * 0.72 + 1, 0.5, 0.6, YELLOW, { y: r * 0.64, z: len / 2 + 0.3 }),                           // door header stripe
        box(2 * r + 4, 0.2, 14, CONCRETE, { y: 0.1, z: len / 2 + 7 }),                                        // apron
    ]);
})();
export const boxHangarGeo = (() => {
    return shared([
        box(28, 1, 44, CONCRETE, { y: 0.5 }),
        box(24, 10, 40, HANGAR, { y: 6 }),
        part(profile([[-13, 0], [13, 0], [13, 1.2], [0, 4.4], [-13, 1.2]], 42), HANGAR_D, { y: 11 }),   // gable roof
        ...[-8, -4, 0, 4, 8].map(x => box(0.35, 10, 0.3, HANGAR_D, { x, y: 6, z: 20.1 })),            // front pilasters
        box(18, 8, 0.4, 0x4d524a, { y: 5, z: 20.3 }), box(0.3, 8, 0.5, 0x2f322e, { y: 5, z: 20.4 }),  // sliding doors
        box(19, 0.5, 0.6, YELLOW, { y: 9.3, z: 20.4 }),
        ...[-12, 12].map(x => box(0.3, 1.3, 30, 0x2c3a40, { x: x * 1.005, y: 8, z: -2 })),             // clerestory windows
        cyl(0.8, 0.8, 1.2, 8, GUNMETAL, { y: 15.4, z: -8 }), cyl(0.8, 0.8, 1.2, 8, GUNMETAL, { y: 15.4, z: 8 }), // roof vents
        box(30, 0.2, 12, CONCRETE, { y: 0.1, z: 28 }),                                                   // apron
    ]);
})();

// --- Airport (unscaled): runway with markings, terminal, control tower — separate meshes for fair collision ----
export const runwayGeo = shared([
    box(40, 0.5, 200, ASPHALT, {}),
    box(0.8, 0.06, 200, WHITE, { x: -18.5, y: 0.34 }), box(0.8, 0.06, 200, WHITE, { x: 18.5, y: 0.34 }),     // edge lines
    ...Array.from({ length: 8 }, (_, i) => box(0.9, 0.06, 7, WHITE, { y: 0.34, z: -70 + i * 20 })),         // centreline dashes
    ...[-1, 1].flatMap(s => Array.from({ length: 8 }, (_, i) => box(1.6, 0.06, 11, WHITE, { x: -13.3 + i * 3.8, y: 0.34, z: s * 92 }))), // thresholds
    ...[-1, 1].flatMap(s => [-1, 1].map(x => box(4, 0.06, 12, WHITE, { x: x * 7, y: 0.34, z: s * 70 }))), // touchdown zones
    box(12, 0.45, 60, ASPHALT, { x: 26, y: -0.02, z: -12 }),                                               // taxiway / apron
    box(0.5, 0.06, 60, YELLOW, { x: 26, y: 0.24, z: -12 }),
]);
export const terminalGeo = shared([
    box(12, 7, 16, 0xb9b3a2, { x: 25, y: 3.5, z: 2 }),
    box(12.1, 1.6, 16.1, GLASS, { x: 25, y: 4.6, z: 2 }),                                                   // window band
    box(13, 0.6, 17, 0x6e6a60, { x: 25, y: 7.3, z: 2 }),
    cyl(2.6, 2.6, 7, 12, 0xcfc9b6, { x: 36, y: 3.5, z: -8 }), cyl(2.6, 2.6, 7, 12, 0xcfc9b6, { x: 36, y: 3.5, z: -2 }), // fuel tanks
    box(3, 3, 3, 0x6e6a60, { x: 25, y: 9.1, z: 7 }),                                                        // rooftop plant
]);
export const controlTowerGeo = shared([
    cyl(2.6, 3.4, 29, 10, 0xcfc9b6, { x: 25, y: 14.5, z: -25 }),
    cyl(4.8, 3.6, 1.2, 10, 0x6e6a60, { x: 25, y: 29.4, z: -25 }),                                           // cab floor
    cyl(4.6, 4.6, 3.8, 10, GLASS, { x: 25, y: 31.9, z: -25 }),                                              // glazing
    cyl(5.2, 5.0, 0.8, 10, 0x6e6a60, { x: 25, y: 34.2, z: -25 }),                                           // roof
    cyl(0.1, 0.1, 5, 4, TRACK, { x: 25, y: 37, z: -25 }),                                                   // mast
    box(3.4, 0.25, 0.9, GUNMETAL, { x: 25, y: 36, z: -25 }),                                                // radar bar
]);

// --- Destroyer (scale 5): pointed hull, superstructure, funnel, mast; gun turret on the pivot (0, 1.5, 5) --------
const HULL_TOP = [[-1.5, -10], [1.5, -10], [1.55, 4], [0.9, 8.5], [0, 10.4], [-0.9, 8.5], [-1.55, 4]];
export const destroyerHullGeo = shared([
    top(HULL_TOP, 1.9, NAVY, { y: -0.05 }),
    top(HULL_TOP.map(([x, z]) => [x * 1.02, z]), 0.3, BOOT, { y: -0.95 }),                               // boot-topping
    top(HULL_TOP.map(([x, z]) => [x * 0.96, z * 0.99]), 0.1, DECK, { y: 0.95 }),                         // deck
    box(2.2, 1.4, 4, SUPER, { y: 1.65, z: 1.4 }),                                                          // bridge block
    box(2.25, 0.4, 1, GLASS, { y: 2.1, z: 3.2 }),
    box(1.8, 1.1, 3.4, SUPER, { y: 2.9, z: 0.8 }),
    side([[-1, 0], [0.4, 0], [0.9, 1.9], [-0.4, 1.9]], 1.2, NAVY_D, { y: 1, z: -2.3 }),                  // raked funnel
    box(1.25, 0.25, 1.1, TRACK, { y: 3.0, z: -2.3 }),
    cyl(0.1, 0.12, 4, 5, NAVY_D, { y: 5.2, z: 0.8 }),                                                      // mast
    box(1.6, 0.12, 0.12, NAVY_D, { y: 6.2, z: 0.8 }), box(0.8, 0.45, 0.2, SUPER, { y: 6.9, z: 0.8 }),     // yard, radar
    box(2.6, 0.12, 3.5, DECK, { y: 1.05, z: -7.5 }),                                                       // helipad
    box(0.15, 0.02, 1.8, WHITE, { y: 1.16, z: -7.5 }), box(1.4, 0.02, 0.15, WHITE, { y: 1.16, z: -7.5 }),
    box(1.4, 0.7, 1.1, SUPER, { y: 1.3, z: -4.6 }),                                                         // missile launcher
]);
export const destroyerTurretGeo = shared([
    side([[-0.75, -0.45], [0.55, -0.45], [0.85, 0.05], [0.35, 0.45], [-0.75, 0.45]], 1.3, SUPER, {}),
]);
export const destroyerBarrelGeo = shared([cyl(0.1, 0.13, 3.2, 6, GUNMETAL, { z: 2.3, rx: Math.PI / 2 })]);

// --- Carrier (scale 8): tapered hull, flight deck with markings, island, parked jets -----------------------------
const CARRIER_HULL = [[-4, -17.5], [4, -17.5], [4.2, 10], [2.4, 16], [0, 17.8], [-2.4, 16], [-4.2, 10]];
export const carrierGeo = shared([
    top(CARRIER_HULL, 3, NAVY, {}),
    top(CARRIER_HULL.map(([x, z]) => [x * 1.02, z]), 0.4, BOOT, { y: -1.35 }),
    box(12, 0.5, 32, DECK, { y: 1.75, z: -0.5 }),                                                          // flight deck
    box(7, 0.5, 18, DECK, { x: -3.5, y: 1.75, z: -6, ry: -0.16 }),                                        // angled landing deck
    box(0.25, 0.04, 30, WHITE, { y: 2.09, z: -0.5 }),                                                      // centreline
    box(0.18, 0.04, 17, WHITE, { x: -3.2, y: 2.1, z: -6, ry: -0.16 }), box(0.18, 0.04, 17, YELLOW, { x: -5.4, y: 2.1, z: -6.3, ry: -0.16 }),
    ...[-12, -6].map(z => box(3, 0.04, 3, 0x53585d, { x: 4.4, y: 2.1, z })),                             // elevators
    box(2, 3, 6, SUPER, { x: 5, y: 3.5, z: -2 }),                                                          // island
    box(2.05, 0.6, 3, GLASS, { x: 5, y: 4.6, z: -1.2 }),
    box(1.2, 1.4, 1.2, NAVY_D, { x: 5, y: 5.7, z: -3.5 }),                                                 // funnel
    cyl(0.08, 0.1, 3.2, 5, NAVY_D, { x: 5, y: 6.6, z: -1.5 }), box(1.4, 0.3, 0.15, SUPER, { x: 5, y: 7.4, z: -1.5 }), // mast, radar
    // Parked jets on the deck (tiny)
    ...[[2.5, 8], [-1, 11], [2.5, 12.5], [-1, 6.5]].flatMap(([x, z]) => [
        box(0.35, 0.3, 2.4, 0x7a838c, { x, y: 2.2, z }),
        top([[0, 1.1], [-1.1, -0.6], [1.1, -0.6]], 0.08, 0x6c747c, { x, y: 2.15, z: z - 0.2 }),
        box(0.08, 0.6, 0.5, 0x6c747c, { x, y: 2.55, z: z - 1.0 }),
    ]),
]);

// --- Air units (scaled ×3 by airUnits.js) -------------------------------------------------------------------------
// Fighter: +Z forward (airUnits.js turns them with lookAt)
const JET = 0x55606e, JET_D = 0x3e4752, JET_L = 0x6f7b89;
/** A fin: side profile [[z, y]…], then canted `cant` rad outward about the fuselage axis (Z). */
const fin = (pts, thick, c, x, y, cant) => part(profile(pts, thick).rotateY(-Math.PI / 2).rotateZ(cant), c, { x, y });
/** One wing from its root and tip chords (x = span, z = leading/trailing edge); mirror with s = -1. */
const wing = (s, root, tip, span, thick, c, y) => top(
    s > 0 ? [[root.x, root.lead], [span, tip.lead], [span, tip.trail], [root.x, root.trail]]
          : [[-root.x, root.trail], [-span, tip.trail], [-span, tip.lead], [-root.x, root.lead]], thick, c, { y });
export const fighterGeo = shared([
    side([[-7.5, -0.9], [4, -0.9], [8.4, -0.1], [4.6, 0.9], [-5.5, 1.1], [-8, 0.5]], 2.4, JET, {}),       // fuselage
    side([[1.6, 0.8], [5, 0.9], [3.6, 1.8], [2.4, 1.9]], 1.3, GLASS, {}),                                  // canopy
    ...[-1, 1].map(s => wing(s, { x: 1.1, lead: 2.8, trail: -4.2 }, { lead: -3.4, trail: -5.4 }, 10.3, 0.32, JET_L, -0.15)), // swept wings
    ...[-1, 1].map(s => wing(s, { x: 0.9, lead: -5.2, trail: -8.4 }, { lead: -7.4, trail: -8.7 }, 4.8, 0.22, JET_D, 0.15)),  // tailplanes
    ...[-1, 1].map(s => fin([[-8.2, 0], [-5.2, 0], [-6.9, 3.5], [-8.5, 3.5]], 0.24, JET_D, s * 0.95, 0.6, s * -0.3)),       // twin fins, canted out
    ...[-1, 1].map(s => box(0.8, 1.1, 3.2, JET_D, { x: s * 1.45, y: -0.35, z: 1.4 })),                   // intakes
    cyl(0.8, 0.95, 1.2, 8, TRACK, { z: -8.2, rx: Math.PI / 2 }),                                          // nozzle
    box(0.35, 0.35, 1.6, GUNMETAL, { x: 0.9, y: 0.1, z: 5.2 }),                                           // gun fairing
]);
// Helicopter: the model faces +X inside airUnits.js's rotated inner group; here +Z is forward (the inner group turns it)
const HELI = 0x4a5240, HELI_D = 0x353b2e;
export const heliBodyGeo = shared([
    side([[-3.5, -1.3], [3, -1.3], [5, -0.3], [4, 1.3], [-2.5, 1.7], [-4, 0.6]], 3.2, HELI, {}),         // cabin
    side([[2.8, -0.1], [4.9, -0.2], [4, 1.25], [2.6, 1.4]], 3.3, GLASS, {}),                              // nose glazing
    side([[-12, 0.2], [-3.5, -0.4], [-3.5, 1.2], [-12, 0.9]], 1.0, HELI_D, {}),                           // tail boom
    side([[-12.6, 0.5], [-11, 0.5], [-11.8, 3.2], [-12.9, 3.2]], 0.3, HELI_D, {}),                         // tail fin
    box(4.5, 0.25, 1.1, HELI_D, { y: 0.8, z: -10.8 }),                                                     // stabiliser
    ...[-1, 1].flatMap(s => [box(0.2, 0.2, 6, TRACK, { x: s * 1.6, y: -2.2, z: 0.3 }), box(0.15, 0.9, 0.15, TRACK, { x: s * 1.5, y: -1.7, z: 1.5 }), box(0.15, 0.9, 0.15, TRACK, { x: s * 1.5, y: -1.7, z: -1.2 })]), // skids
    ...[-1, 1].map(s => box(0.5, 0.5, 2.4, GUNMETAL, { x: s * 2.2, y: -0.6, z: 0.8 })),                  // rocket pods
    cyl(0.7, 0.9, 0.9, 8, HELI_D, { y: 2.1 }),                                                             // rotor mast housing
]);
export const heliRotorGeo = shared([box(18, 0.12, 0.9, TRACK, {}), box(0.9, 0.12, 18, TRACK, {}), cyl(0.5, 0.5, 0.3, 8, GUNMETAL, {})]);
export const heliTailRotorGeo = shared([box(4.2, 0.5, 0.12, TRACK, {}), box(0.5, 4.2, 0.12, TRACK, {})]); // in its pivot's XY plane (spins about Z)
// Tanker: +Z forward
export const tankerGeo = shared([
    part(new THREE.CylinderGeometry(3, 3, 30, 12), 0xc9ccd0, { rx: Math.PI / 2 }),
    part(new THREE.SphereGeometry(3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xc9ccd0, { z: 15, rx: Math.PI / 2 }), // nose
    part(new THREE.ConeGeometry(3, 7, 12), 0xc9ccd0, { z: -18.5, rx: -Math.PI / 2 }),                   // tail cone
    box(6.5, 1, 1.4, GLASS, { y: 1.6, z: 15.5 }),
    top([[-2, 5], [-25, -5], [-25, -8], [-2, -3], [2, -3], [25, -8], [25, -5], [2, 5]], 0.9, 0xb7bbc0, { y: -1 }), // swept wings
    top([[-1, -15], [-10, -19], [-10, -21], [10, -21], [10, -19], [1, -15]], 0.6, 0xb7bbc0, { y: 1.5 }),
    side([[-21.5, 0], [-15, 0], [-19, 9], [-21.5, 9]], 0.6, 0xb7bbc0, { y: 1.5 }),                        // fin
    ...[-14, -7, 7, 14].map(x => cyl(1.2, 1.3, 5, 10, 0x8d9197, { x, y: -2.4, z: 2 - Math.abs(x) * 0.25, rx: Math.PI / 2 })), // engines
    box(0.5, 0.5, 9, 0x8d9197, { y: -2.2, z: -22, rx: 0.35 }),                                            // refuelling boom
]);
// AC-130: faces +X inside its rotated inner group, like the helicopter; +Z forward here
export const ac130Geo = shared([
    side([[-12, -3.2], [11, -3.2], [15.5, -1], [14, 2.8], [-4, 3.6], [-15, 2.5], [-16, 0.5]], 8, 0x3d3d2e, {}),  // fuselage
    side([[11.2, 1], [14.3, 0.4], [13.6, 2.6], [11, 2.9]], 8.1, GLASS, {}),                                     // cockpit
    box(55, 1.4, 6, 0x35352a, { y: 3.8, z: 2 }),                                                                 // high wing
    ...[-19, -10, 10, 19].flatMap(x => [cyl(1.4, 1.5, 7, 10, 0x2e2e24, { x, y: 2.6, z: 3.5, rx: Math.PI / 2 }), box(0.35, 7.5, 0.5, TRACK, { x, y: 2.6, z: 7.2 })]), // engines + props
    side([[-16, 2], [-9, 3.4], [-12, 14], [-16, 14]], 0.8, 0x35352a, {}),                                        // fin
    box(22, 0.8, 5, 0x35352a, { y: 4, z: -13.5 }),                                                                // tailplane
    ...[0, 3.5, 7].map(z => cyl(0.25, 0.3, 2.8, 6, GUNMETAL, { x: -4.4, y: -0.8, z, rz: Math.PI / 2 })),         // side guns (port)
]);
// Balloon: envelope with gores, basket, rigging
export const balloonGeo = shared([
    ...Array.from({ length: 8 }, (_, i) => part(new THREE.SphereGeometry(7, 3, 8, (i / 8) * Math.PI * 2, Math.PI / 4), i % 2 ? 0xdde8f0 : 0xb2413a, { y: 9 })),
    part(new THREE.ConeGeometry(3.4, 4, 8, 1, true), 0xb2413a, { y: 2.6, rx: Math.PI }),                         // skirt
    box(3, 1.8, 3, 0x8a7050, { y: -1.2 }),                                                                        // basket
    ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => cyl(0.06, 0.06, 5, 4, 0x5a4a35, { x: sx * 1.3, y: 1.6, z: sz * 1.3, rx: sz * 0.16, rz: -sx * 0.16 })),
]);

// --- Player plane (unscaled, +Z forward): four baked pieces, one collision box each (player/plane.js) -------------
// A light swept-wing jet in the player's white-and-blue. Span ±6 (wing trails), wing-tip rails at ±5.9 (missiles).
const PL_WHITE = 0xc9d0d8, PL_GREY = 0x98a2ad, PL_BLUE = 0x1f4fa0, PL_DARK = 0x2a3038;
export const playerFuselageGeo = shared([
    side([[-2.4, -0.25], [1.8, -0.42], [3.35, -0.05], [2.2, 0.35], [-1.2, 0.45], [-2.5, 0.2]], 0.95, PL_WHITE, {}),
    side([[0.35, 0.3], [1.95, 0.3], [1.35, 0.8], [0.6, 0.82]], 0.72, GLASS, {}),                         // canopy
    part(new THREE.ConeGeometry(0.2, 0.5, 6), PL_DARK, { z: 3.45, rx: Math.PI / 2 }),                       // nose tip
    ...[-1, 1].map(s => box(0.36, 0.46, 1.5, PL_GREY, { x: s * 0.6, y: -0.12, z: 0.35 })),                // intakes
    box(0.98, 0.12, 3.2, PL_BLUE, { y: 0.06, z: 0.25 }),                                                    // cheat line
    cyl(0.3, 0.34, 0.4, 8, PL_DARK, { z: -2.5, rx: Math.PI / 2 }),                                         // nozzle
    cyl(0.28, 0.28, 2.0, 8, PL_DARK, { y: -0.72, z: 0.2, rx: Math.PI / 2 }),                               // bomb pod
    ...[-1, 1].map(s => cyl(0.17, 0.2, 1.4, 6, PL_DARK, { x: s * 0.36, y: -0.62, z: -1.4, rx: Math.PI / 2 })), // napalm pods
]);
const playerWings = {};
/** The player's wing on side s (-1 left, 1 right); built once per side. */
export const playerWingGeo = s => playerWings[s] ??= shared([
    wing(s, { x: 0.45, lead: 1.15, trail: -1.35 }, { lead: 0.2, trail: -0.55 }, 5.9, 0.16, PL_WHITE, -0.12),
    cyl(0.09, 0.09, 1.1, 6, PL_DARK, { x: s * 5.9, y: -0.12, z: 0.55, rx: Math.PI / 2 }),                // missile rail
    box(0.14, 0.2, 0.8, PL_BLUE, { x: s * 5.95, y: -0.12, z: -0.15 }),                                      // tip cap
]);
export const playerTailGeo = shared([
    fin([[-2.5, 0.2], [-1.25, 0.3], [-2.0, 1.75], [-2.65, 1.75]], 0.14, PL_BLUE, 0, 0, 0),
    ...[-1, 1].map(s => wing(s, { x: 0.3, lead: -1.35, trail: -2.4 }, { lead: -1.95, trail: -2.45 }, 1.9, 0.1, PL_GREY, 0.05)),
]);
