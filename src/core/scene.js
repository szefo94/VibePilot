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
const caveColor = 0x454545;
scene.background = new THREE.Color(caveColor);
scene.fog = new THREE.FogExp2(caveColor, 0.002);
export const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 4000);
camera.position.set(0, 0, 25);
camera.lookAt(0, 0, 0);
export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xaaaaaa, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(30, 80, 50);
scene.add(directionalLight);

window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); }, false);
