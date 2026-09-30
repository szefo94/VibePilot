/** Player aircraft mesh, collision boxes, aiming laser and target arrows. */
import { groundLevel } from '../config.js';
import { scene } from '../core/scene.js';
import { kitMaterial } from '../core/meshkit.js';
import { playerFuselageGeo, playerTailGeo, playerWingGeo } from '../entities/models.js';

// --- Player Plane ---
// Model: entities/models.js (four baked pieces). One shared kit material: effects.js blinks it on damage.
export const plane = new THREE.Group();
const planeMaterial = kitMaterial({ metalness: 0.25, roughness: 0.6 });
export const corePlaneComponents = [playerFuselageGeo, playerWingGeo(-1), playerWingGeo(1), playerTailGeo].map(g => new THREE.Mesh(g, planeMaterial));
plane.add(...corePlaneComponents);
export const _planeMaterials = [planeMaterial]; // for player blink-on-damage (idea 3)
plane.position.set(0, groundLevel + 20, 0);
scene.add(plane);
export const planePartBoxes = corePlaneComponents.map(() => new THREE.Box3());
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
