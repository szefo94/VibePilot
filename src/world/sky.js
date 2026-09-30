/**
 * Sky, horizon and time of day (Settings → Time of day, T key, ☀/☾ on phones).
 *
 * A camera-following dome with a procedural shader: horizon-to-zenith gradient, the sun (day) or moon (night) with
 * its glow, drifting fBm clouds, stars at night, and two hazy layers of distant mountain ridges along the horizon.
 * The fog colour is the horizon colour, so the sea and the islands fade into the sky without a visible edge.
 * Each preset also sets the lights and the water; only colours and intensities change, never the number of
 * lights, so switching never recompiles shaders.
 */
import { TIME_OF_DAY } from '../config.js';
import { ambientLight, camera, hemiLight, scene, sunLight } from '../core/scene.js';
import { onSettingChange, settings } from '../core/settings.js';
import { waterMaterial } from './world.js';
import { colorModeEnabled } from '../effects/colorMode.js';

const PRESETS = {
    day: {
        zenith: 0x2f6fc9, horizon: 0xbad3e6, haze: 0x9fb8cc, mountain: 0x7b8fa3, cloud: 0xffffff, clouds: 0.6, stars: 0,
        sunDir: [0.42, 0.5, 0.52], disc: 0xfff6dc, glow: 0xffe9b8, discSize: 0.9993,
        fogDensity: 0.00085, ambient: 0.2, hemi: [0xd4e6ff, 0x55633a, 0.58], sun: [0xfff1dc, 0.95], water: 0x1d5c7e,
    },
    night: {
        zenith: 0x01030a, horizon: 0x15253d, haze: 0x0c1626, mountain: 0x0a1320, cloud: 0x243044, clouds: 0.35, stars: 1,
        sunDir: [-0.45, 0.42, -0.6], disc: 0xdfe6ff, glow: 0x5d6f9a, discSize: 0.9995,
        fogDensity: 0.0013, ambient: 0.1, hemi: [0x2c4270, 0x0b0f08, 0.38], sun: [0x9fb4ff, 0.45], water: 0x051726,
    },
};

const uniforms = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() },
    uMountain: { value: new THREE.Color() }, uCloud: { value: new THREE.Color() }, uClouds: { value: 0 }, uStars: { value: 0 },
    uSunDir: { value: new THREE.Vector3() }, uDisc: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uDiscSize: { value: 0.999 },
    uTime: { value: 0 },
};
const dome = new THREE.Mesh(new THREE.SphereGeometry(3500, 40, 20), new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
        uniform vec3 uZenith, uHorizon, uHaze, uMountain, uCloud, uDisc, uGlow, uSunDir;
        uniform float uClouds, uStars, uDiscSize, uTime;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
        void main() {
            vec3 d = normalize(vDir);
            float el = d.y;
            vec2 ring = vec2(d.x, d.z) / max(length(d.xz), 1e-4);       // azimuth on a circle: seamless all round
            vec3 col = el > 0.0 ? mix(uHorizon, uZenith, pow(clamp(el, 0.0, 1.0), 0.5)) : mix(uHorizon, uHaze, clamp(-el * 8.0, 0.0, 1.0));
            // Distant ranges: a far, hazy layer and a nearer, darker one
            float far = 0.018 + 0.05 * fbm(ring * 2.2 + 7.0), near = 0.006 + 0.035 * fbm(ring * 4.5 + 31.0);
            if (el > -0.03 && el < far) col = mix(col, mix(uMountain, uHorizon, 0.45), 0.8);
            if (el > -0.03 && el < near) col = mix(col, uMountain, 0.9);
            // Sun or moon: disc and glow
            float sd = dot(d, normalize(uSunDir));
            col += uGlow * (pow(max(sd, 0.0), 12.0) * 0.25 + pow(max(sd, 0.0), 180.0) * 0.6);
            col = mix(col, uDisc, smoothstep(uDiscSize, uDiscSize + 0.0004, sd));
            // Stars (night), fading towards the horizon
            if (uStars > 0.0 && el > 0.0) {
                vec2 sp = vec2(atan(d.z, d.x) * 160.0, asin(el) * 160.0);
                float st = step(0.994, hash(floor(sp))) * smoothstep(0.02, 0.3, el) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(floor(sp)) * 40.0));
                col += vec3(st) * uStars;
            }
            // Clouds on a plane overhead, drifting
            if (el > 0.01) {
                vec2 cp = d.xz / (el + 0.12) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
                float c = smoothstep(0.52, 0.86, fbm(cp));
                col = mix(col, uCloud * (0.85 + 0.15 * el), c * uClouds * smoothstep(0.01, 0.2, el));
            }
            gl_FragColor = vec4(col, 1.0);
        }`,
}));
dome.renderOrder = -1;
dome.frustumCulled = false;
scene.add(dome);

let current = null;
/** Apply a preset: sky uniforms, fog, background, lights, water. */
export function applyTimeOfDay(key) {
    const P = PRESETS[key] || PRESETS.day;
    current = key;
    uniforms.uZenith.value.set(P.zenith); uniforms.uHorizon.value.set(P.horizon); uniforms.uHaze.value.set(P.haze);
    uniforms.uMountain.value.set(P.mountain); uniforms.uCloud.value.set(P.cloud); uniforms.uClouds.value = P.clouds; uniforms.uStars.value = P.stars;
    uniforms.uSunDir.value.set(...P.sunDir).normalize(); uniforms.uDisc.value.set(P.disc); uniforms.uGlow.value.set(P.glow); uniforms.uDiscSize.value = P.discSize;
    scene.fog.color.set(P.horizon); scene.fog.density = P.fogDensity;
    if (!colorModeEnabled()) scene.background = new THREE.Color(P.horizon); // colour mode keeps its own black background
    ambientLight.intensity = P.ambient;
    hemiLight.color.set(P.hemi[0]); hemiLight.groundColor.set(P.hemi[1]); hemiLight.intensity = P.hemi[2];
    sunLight.color.set(P.sun[0]); sunLight.intensity = P.sun[1]; sunLight.position.set(...P.sunDir).multiplyScalar(120);
    waterMaterial.color.set(P.water);
}
export const timeOfDay = () => current;

/** Per rendered frame: the dome follows the camera, clouds drift, stars twinkle; hidden in colour-lines mode. */
export function updateSky(rawDelta) {
    dome.position.copy(camera.position);
    uniforms.uTime.value += rawDelta;
    dome.visible = !colorModeEnabled();
}

onSettingChange((key, value) => { if (key === 'timeOfDay') applyTimeOfDay(value); });
applyTimeOfDay(Object.hasOwn(TIME_OF_DAY, settings.timeOfDay) ? settings.timeOfDay : 'day');
