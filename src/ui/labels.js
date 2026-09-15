/** Floating canvas-texture labels above units. */
import { scene } from '../core/scene.js';

export function createUnitLabel(name, level, initialHp, maxHp) {
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    canvas.width = 256; canvas.height = 96;
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, sizeAttenuation: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(20, 12, 1); sprite.renderOrder = 1;
    const data = { sprite, context: ctx, canvas, texture, maxHp, name, level };
    updateUnitLabel(data, initialHp);
    return data;
}
export function updateUnitLabel(data, currentHp) {
    const { context: ctx, canvas, texture, sprite, maxHp, name, level } = data;
    const hp = Math.max(0, currentHp);
    if (hp <= 0 && sprite) { sprite.visible = false; return; }
    if (sprite) sprite.visible = true; else return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, w, h);
    ctx.font = 'Bold 20px Arial'; ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.fillText(`Lvl ${level} ${name}`, w / 2, 22);
    const barY = 40, barH = 24, barMaxW = w - 20, hpRatio = hp / maxHp, greenW = barMaxW * hpRatio;
    ctx.fillStyle = '#00ff00'; ctx.fillRect(10, barY, greenW, barH);
    if (greenW < barMaxW) { ctx.fillStyle = '#ff0000'; ctx.fillRect(10 + greenW, barY, barMaxW - greenW, barH); }
    ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.strokeRect(10, barY, barMaxW, barH);
    ctx.font = 'Bold 18px Arial'; ctx.fillText(`${hp}/${maxHp}`, w / 2, barY + 17);
    texture.needsUpdate = true;
}

// Consistent label cleanup — used by every unit-destruction path (§3.5)
export function destroyLabel(label) {
    if (!label) return;
    label.sprite?.parent?.remove(label.sprite);
    scene.remove(label.sprite);
    label.texture.dispose();
    label.sprite.material.dispose();
}
