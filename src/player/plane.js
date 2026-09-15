/** Player aircraft mesh, collision boxes, aiming laser and target arrows. */
import { groundLevel } from '../config.js';
import { scene } from '../core/scene.js';

// --- Player Plane ---
export const plane = new THREE.Group();
const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
const tailMaterial = new THREE.MeshStandardMaterial({ color: 0x001f5a });
const fuselageGeo = new THREE.CylinderGeometry(0.45, 0.6, 4, 12); fuselageGeo.rotateX(Math.PI / 2);
const body = new THREE.Mesh(fuselageGeo, bodyMaterial);
const noseGeo = new THREE.ConeGeometry(0.45, 1.2, 12); noseGeo.rotateX(Math.PI / 2);
const nose = new THREE.Mesh(noseGeo, bodyMaterial); nose.position.set(0, 0, 2.6);
const leftWing = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 1.5), bodyMaterial); leftWing.position.x = -3;
const rightWing = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 1.5), bodyMaterial); rightWing.position.x = 3;
const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 1), tailMaterial); tailFin.position.set(0, 0.75, -1.8);
const hStab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.15, 0.8), bodyMaterial); hStab.position.set(0, 0, -1.8);
export const corePlaneComponents = [body, nose, leftWing, rightWing, tailFin, hStab];
plane.add(...corePlaneComponents);
// --- Body upgrades ---
const attachMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.7 });
// Wing barrel launchers — one tube at each wing tip
const barrelGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6); barrelGeo.rotateX(Math.PI / 2);
const leftBarrel  = new THREE.Mesh(barrelGeo, attachMat); leftBarrel.position.set(-5.9, -0.12, 0.55);
const rightBarrel = new THREE.Mesh(barrelGeo, attachMat); rightBarrel.position.set(5.9, -0.12, 0.55);
// Bomb pod — slightly larger horizontal cylinder under centre body
const bombPodGeo = new THREE.CylinderGeometry(0.28, 0.28, 2.0, 8); bombPodGeo.rotateX(Math.PI / 2);
const bombPod = new THREE.Mesh(bombPodGeo, attachMat); bombPod.position.set(0, -0.78, 0.2);
// Napalm containers — two small cylinders under rear body
const napPodGeo = new THREE.CylinderGeometry(0.17, 0.2, 1.4, 6); napPodGeo.rotateX(Math.PI / 2);
const napPodL = new THREE.Mesh(napPodGeo, attachMat); napPodL.position.set(-0.36, -0.68, -1.4);
const napPodR = new THREE.Mesh(napPodGeo, attachMat); napPodR.position.set( 0.36, -0.68, -1.4);
plane.add(leftBarrel, rightBarrel, bombPod, napPodL, napPodR);
export const _planeMaterials = [bodyMaterial, tailMaterial, attachMat]; // for player blink-on-damage (idea 3)
plane.position.set(0, groundLevel + 20, 0);
scene.add(plane);
export const planePartBoxes = corePlaneComponents.map(() => new THREE.Box3());
const planeMarkerCollisionRadius = 2.0;
export const planeSphereRadius = 2.5;
// Local-space geometry bounding boxes — built once, updated via applyMatrix4 each frame (§2.1)
corePlaneComponents.forEach(m => m.updateMatrix());
export const planePartLocalBoxes = corePlaneComponents.map(m => {
    m.geometry.computeBoundingBox();
    return m.geometry.boundingBox.clone();
});

// --- Aiming & Targeting ---
const laserMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
const laserGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 2), new THREE.Vector3(0, 0, 1500)]);
export const aimingLaser = new THREE.Line(laserGeometry, laserMaterial); aimingLaser.visible = true; plane.add(aimingLaser);
const arrowGeometry = new THREE.ConeGeometry(0.3, 1.2, 8);
arrowGeometry.translate(0, -0.6, 0); arrowGeometry.rotateX(Math.PI / 2);
export const markerArrow = new THREE.Mesh(arrowGeometry, new THREE.MeshBasicMaterial({ color: 0xffff00 }));
export const groundTargetArrow = new THREE.Mesh(arrowGeometry, new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
export const enemyArrow = new THREE.Mesh(arrowGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff }));
markerArrow.position.set(-1.5, 1.5, 0); groundTargetArrow.position.set(1.5, 1.5, 0); enemyArrow.position.set(0, 2.0, 0);
markerArrow.visible = false; groundTargetArrow.visible = false; enemyArrow.visible = false;
plane.add(markerArrow, groundTargetArrow, enemyArrow);
// V13: muzzle PointLight — starts off, flashes briefly on each player shot
export const _playerMuzzleLight = new THREE.PointLight(0xffa500, 0, 18);
_playerMuzzleLight.position.set(0, 0, 4); plane.add(_playerMuzzleLight);
