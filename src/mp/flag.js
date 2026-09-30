/**
 * Team deathmatch: a big flag in the middle of the map, the contested ground between Red (south) and Blue (north).
 * Every player builds it the same way. The bots fly to it first after every spawn and then patrol around it
 * (bots.js), so that is where the fighting starts. The pole is solid (a 'stalagmite' cone in combat/collision.js)
 * and the flag has a minimap marker.
 */
import { scene } from '../core/scene.js';
import { obstacles } from '../entities/registry.js';
import { onHook } from '../game/hooks.js';
import { heightAt } from '../world/terrain.js';
import { waterLevel } from '../config.js';
import { TEAMS } from '../net/protocol.js';

export const FLAG = Object.freeze({ x: 0, z: 0, pole: 110, clothW: 44, clothH: 26, patrolRadius: 700 });
const flagTop = new THREE.Vector3(FLAG.x, 0, FLAG.z); // y set when built
let cloth = null, time = 0;

/** Where bots fly first: over the flag, clear of the pole. */
export const flagWaypoint = () => flagTop.clone().setY(flagTop.y + 45);
/** The patrol area around the flag. */
export const flagPatrol = () => ({ center: flagTop, radius: FLAG.patrolRadius });

function clothTexture() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 152;
    const g = c.getContext('2d');
    g.fillStyle = TEAMS[0].css; g.beginPath(); g.moveTo(0, 0); g.lineTo(256, 0); g.lineTo(0, 152); g.fill();      // Red corner
    g.fillStyle = TEAMS[1].css; g.beginPath(); g.moveTo(256, 0); g.lineTo(256, 152); g.lineTo(0, 152); g.fill();  // Blue corner
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.moveTo(256, 0); g.lineTo(0, 152); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 76, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#222'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('VS', 128, 78);
    return new THREE.CanvasTexture(c);
}

function build() {
    const ground = Math.max(heightAt(FLAG.x, FLAG.z), waterLevel);
    const g = new THREE.Group();
    g.position.set(FLAG.x, ground, FLAG.z);
    const metal = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.7, roughness: 0.35, flatShading: true });
    const stone = new THREE.MeshStandardMaterial({ color: 0x8a8778, roughness: 0.9, flatShading: true });
    // Plinth (a floating platform over water), pole, gold finial
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 5, 8), stone); plinth.position.y = 1.5;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.5, FLAG.pole, 10), metal); pole.position.y = FLAG.pole / 2 + 4;
    const finial = new THREE.Mesh(new THREE.OctahedronGeometry(2.2), new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0x664400, metalness: 0.8, roughness: 0.3 }));
    finial.position.y = FLAG.pole + 6;
    // Cloth: hangs from the top of the pole, waved in update()
    const geo = new THREE.PlaneGeometry(FLAG.clothW, FLAG.clothH, 16, 6);
    geo.translate(FLAG.clothW / 2, 0, 0);
    geo.userData.base = geo.attributes.position.array.slice();
    cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: clothTexture(), side: THREE.DoubleSide, roughness: 0.8 }));
    cloth.position.set(1.2, FLAG.pole + 4 - FLAG.clothH / 2 - 1, 0);
    g.add(plinth, pole, finial, cloth);
    scene.add(g);
    flagTop.set(FLAG.x, ground + FLAG.pole + 6, FLAG.z);
    // Solid pole: the cone test the sea stacks use
    pole.userData = { type: 'stalagmite', coneApex: flagTop.clone(), coneBase: new THREE.Vector3(FLAG.x, ground, FLAG.z), coneBaseRadius: 2.5 };
    pole.updateMatrixWorld(true);
    pole.userData.boundingBox = new THREE.Box3().setFromObject(pole);
    obstacles.push(pole);
}

/** Wave the cloth: a travelling wave that grows towards the free edge. */
function update(rawDelta) {
    if (!cloth) return;
    time += rawDelta;
    const pos = cloth.geometry.attributes.position, base = cloth.geometry.userData.base;
    for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], k = x / FLAG.clothW;
        pos.array[i * 3 + 2] = Math.sin(x * 0.22 - time * 3.2) * 3.2 * k + Math.sin(base[i * 3 + 1] * 0.3 + time * 1.7) * 0.6 * k;
    }
    pos.needsUpdate = true;
    cloth.geometry.computeVertexNormals();
}

/** Build the flag once the world exists; wave it every frame; show it on the minimap. */
export function startFlag() {
    onHook('worldReady', build);
    onHook('frame', update);
    onHook('radarBlips', blips => blips.push({ wx: FLAG.x, wz: FLAG.z, color: '#ffffff', shape: 'square', label: '⚑ Flag' }));
}
