/**
 * Procedural game sound effects (Web Audio API). One shared AudioContext is created on the first user
 * gesture (browser autoplay policy); every sound routes through a master gain with a persisted mute,
 * noise buffers are generated once and reused, and simultaneous voices are capped.
 */
import { onSettingChange, setSetting, settings } from './core/settings.js';

const MAX_VOICES = 24;

let ctx = null, master = null, activeVoices = 0;
const masterGain = () => (settings.muted ? 0 : settings.volume);
const noiseBuffers = new Map(); // `${duration}|${decay}` → AudioBuffer

function unlock() {
    if (!ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        ctx = new AudioCtx();
        master = ctx.createGain();
        master.gain.value = masterGain();
        master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}
for (const type of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(type, unlock, { capture: true, passive: true });

/** Toggle mute (persisted in settings). Returns the new muted state. */
export function toggleMute() {
    setSetting('muted', !settings.muted);
    return settings.muted;
}
onSettingChange(key => {
    if ((key === 'muted' || key === 'volume') && master) master.gain.setTargetAtTime(masterGain(), ctx.currentTime, 0.02);
});

// Run a sound builder with the start time; skipped before unlock, while muted, or over the voice budget.
// The builder returns the node that ends last, which releases the voice.
function play(build) {
    if (!ctx || ctx.state !== 'running' || masterGain() === 0 || activeVoices >= MAX_VOICES) return;
    try {
        const last = build(ctx.currentTime);
        activeVoices++;
        last.onended = () => { activeVoices--; };
    } catch (e) {
        console.warn('audio:', e);
    }
}
// White noise with a (1 - x)^decay envelope; decay 0 = flat
function noiseSource(duration, decay) {
    const key = `${duration}|${decay}`;
    let buf = noiseBuffers.get(key);
    if (!buf) {
        buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (decay ? Math.pow(1 - i / data.length, decay) : 1);
        noiseBuffers.set(key, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
}
// Oscillator with an exponential frequency sweep and an attack-free exponential decay, connected to `out`
function sweep(t, type, f0, f1, sweepEnd, peak, end, out = master) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + sweepEnd);
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + end);
    osc.connect(gain); gain.connect(out);
    osc.start(t); osc.stop(t + end);
    return osc;
}

// Green heart collectible — warm ascending C-E-G arpeggio (life gain feel)
export function _playCollectGreen() {
    play(t => {
        let last;
        [523, 659, 784].forEach((freq, i) => {
            const t0 = t + i * 0.07;
            const osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t0);
            gain.gain.setValueAtTime(0, t0);
            gain.gain.linearRampToValueAtTime(0.18, t0 + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
            osc.connect(gain); gain.connect(master);
            osc.start(t0); osc.stop(t0 + 0.25);
            last = osc;
        });
        return last;
    });
}

// Cyan tube orb — sharper higher ping (1100→550 Hz), shorter
export function _playCollectCyan() {
    play(t => sweep(t, 'sine', 1100, 550, 0.1, 0.18, 0.14));
}

// Yellow marker — warmer triangle wave, lower pitch (523→262 Hz), longer decay
export function _playCollectYellow() {
    play(t => sweep(t, 'triangle', 523, 262, 0.22, 0.25, 0.28));
}

// Enemy shot — short sawtooth "pew" (400→80 Hz, 90 ms)
export function _playEnemyShot() {
    play(t => sweep(t, 'sawtooth', 400, 80, 0.09, 0.10, 0.1));
}

// Machinegun shot — short noise tick with low-pass to soften (quieter than hit-marker)
export function _playGunShot() {
    play(t => {
        const dur = 0.045;
        const src = noiseSource(dur, 3);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 3000;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.14, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(filter); filter.connect(gain); gain.connect(master);
        src.start(t);
        return src;
    });
}

export function _playKeyClick() {
    play(t => {
        const src = noiseSource(0.04, 8);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        src.connect(gain); gain.connect(master);
        src.start(t);
        return src;
    });
}

// Bomb — falling whistle, descending sine
export function _playBombDrop() {
    play(t => sweep(t, 'sine', 600, 180, 0.35, 0.22, 0.38));
}

export function _playMissileLaunch() {
    play(t => {
        const dur = 1.6;
        // Layer 1 — rocket hiss: band-passed noise, sustained then fading
        const src = noiseSource(dur, 0);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2200, t); bp.frequency.linearRampToValueAtTime(800, t + dur);
        bp.Q.value = 0.6;
        const hiss = ctx.createGain();
        hiss.gain.setValueAtTime(0.0, t);
        hiss.gain.linearRampToValueAtTime(0.55, t + 0.06); // sharp ignition spike
        hiss.gain.linearRampToValueAtTime(0.3, t + 0.3);   // settle into sizzle
        hiss.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(bp); bp.connect(hiss); hiss.connect(master);
        src.start(t);
        // Layer 2 — low ignition thud: short sine bump on launch
        sweep(t, 'sine', 140, 40, 0.18, 0.35, 0.22);
        return src;
    });
}

export function _playEmptyClip() { // A11
    play(t => {
        // Dry metallic tick — short noise transient, no tone
        const src = noiseSource(0.025, 1);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.22, t);
        src.connect(hp); hp.connect(g); g.connect(master);
        src.start(t);
        return src;
    });
}

// Napalm — heavy thud + low rumble
export function _playNapalmDrop() {
    play(t => sweep(t, 'sawtooth', 90, 30, 0.28, 0.35, 0.32));
}

export function _playPlayerHit() {
    play(t => {
        // Low thud — sine sweep downward; each layer ends on its own schedule
        const thud = sweep(t, 'sine', 130, 35, 0.18, 0.5, 0.22);
        // Short noise transient layered on top
        const src = noiseSource(0.05, 4);
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.35, t);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(noiseGain); noiseGain.connect(master);
        src.start(t);
        return thud;
    });
}
