/** WebGL availability check, Three.js scene, camera, renderer and global lights. */
// --- Core Three.js Setup ---
// WebGL check — on Linux/Debian with missing GPU drivers, WebGL may be unavailable.
// Try Chrome flags: --enable-unsafe-swiftshader  OR use Firefox as a fallback.
(function() {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) {
        document.body.innerHTML = '<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a0a0a;color:#00ff88;font-family:monospace;text-align:center;padding:2em">'
            + '<div style="font-size:2em;margin-bottom:0.5em">WebGL not available</div>'
            + '<div style="color:#aaa;max-width:480px;line-height:1.7">'
            + 'Your browser or GPU driver does not support WebGL.<br><br>'
            + '<b>Try:</b><br>'
            + '• Firefox (usually works out of the box on Linux)<br>'
            + '• Chrome with <code>--enable-unsafe-swiftshader</code> flag<br>'
            + '• Enable hardware acceleration in browser settings<br>'
            + '• Install/update GPU drivers (mesa: <code>sudo apt install mesa-utils</code>)'
            + '</div></div>';
        throw new Error('WebGL not available');
    }
})();
export const scene = new THREE.Scene();
// Background and fog colours come from world/sky.js (time of day)
scene.background = new THREE.Color(0xbad3e6);
scene.fog = new THREE.FogExp2(0xbad3e6, 0.00085);
export const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.5, 4000); // near 0.5: depth precision far out (no z-fighting)
camera.position.set(0, 0, 25);
camera.lookAt(0, 0, 0);
export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
// --- Lighting ---
// --- Lighting (colours and intensities set by world/sky.js; never add or remove lights at runtime) ---
export const ambientLight = new THREE.AmbientLight(0xffffff, 0.28);
export const hemiLight = new THREE.HemisphereLight(0xd4e6ff, 0x55633a, 0.7);
export const sunLight = new THREE.DirectionalLight(0xfff1dc, 1.15);
sunLight.position.set(50, 60, 62);
scene.add(ambientLight, hemiLight, sunLight);

window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); }, false);
