/**
 * Light budget for searchlights.
 *
 * Every visible light is compiled into every lit material's shader, so ~45 searchlight PointLights made each
 * lit fragment evaluate ~45 lights (measured: 26.8 fps with them, 254 fps without). Searchlights are now
 * *virtual* lights — colour, intensity, range and world position, plus a cheap unlit glow bulb — and only the
 * LIGHT_BUDGET nearest the player borrow one of a fixed pool of real PointLights. The pool is always in the
 * scene, so the shader light count never changes: no recompile freeze when a searchlight is destroyed.
 */
import { scene } from '../core/scene.js';
import { markShared } from '../core/utils.js';
import { plane } from '../player/plane.js';

export const LIGHT_BUDGET = 4;
const FADE_BAND = 60; // world units: a pooled light fades out as the next-nearest searchlight closes in

const pool = [];
for (let i = 0; i < LIGHT_BUDGET; i++) {
    const light = new THREE.PointLight(0xffffaa, 0, 120);
    scene.add(light);
    pool.push(light);
}
const glowGeo = markShared(new THREE.SphereGeometry(0.9, 8, 6));
const virtualLights = [];
const candidates = [];
let realLightsEnabled = true;

/** Register a searchlight; returns the virtual light whose color/intensity game code may change. */
export function createVirtualLight(color, intensity, distance, x, y, z) {
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color }));
    glow.position.set(x, y, z);
    scene.add(glow);
    const light = { isVirtualLight: true, color: new THREE.Color(color), intensity, distance, position: new THREE.Vector3(x, y, z), glow, distSq: 0 };
    virtualLights.push(light);
    return light;
}

/** Destroyed searchlight: stop lighting and free its glow bulb. */
export function removeVirtualLight(light) {
    light.intensity = 0;
    const i = virtualLights.indexOf(light);
    if (i > -1) virtualLights.splice(i, 1);
    scene.remove(light.glow);
    light.glow.material.dispose();
}

/** ?disable=searchlights: hide the pool (glow bulbs stay) to measure the cost of real lights. */
export function disableRealLights() {
    realLightsEnabled = false;
    pool.forEach(light => { light.visible = false; });
}

/** Assign the pooled PointLights to the nearest lit searchlights; call once per frame. */
export function updateLightBudget() {
    candidates.length = 0;
    for (const v of virtualLights) {
        const lit = v.intensity > 0;
        v.glow.visible = lit;
        if (!lit) continue;
        v.glow.material.color.copy(v.color); // follows the alarm colour
        v.distSq = v.position.distanceToSquared(plane.position);
        candidates.push(v);
    }
    if (!realLightsEnabled) return;
    candidates.sort((a, b) => a.distSq - b.distSq);
    const next = candidates[LIGHT_BUDGET], nextDist = next ? Math.sqrt(next.distSq) : Infinity;
    for (let i = 0; i < pool.length; i++) {
        const real = pool[i], v = candidates[i];
        if (!v) { real.intensity = 0; continue; }
        real.position.copy(v.position);
        real.color.copy(v.color);
        real.distance = v.distance;
        real.intensity = v.intensity * Math.min(1, (nextDist - Math.sqrt(v.distSq)) / FADE_BAND);
    }
}

export function lightBudgetStats() {
    return { budget: LIGHT_BUDGET, searchlights: virtualLights.length, lit: virtualLights.filter(v => v.intensity > 0).length, pooledOn: pool.filter(l => l.visible && l.intensity > 0).length };
}
