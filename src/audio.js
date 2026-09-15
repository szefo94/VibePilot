/** Procedural game sound effects using the browser Web Audio API. */
// Green heart collectible — warm ascending C-E-G arpeggio (life gain feel)
export function _playCollectGreen() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        [523, 659, 784].forEach((freq, i) => {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t + i * 0.07);
            gain.gain.setValueAtTime(0, t + i * 0.07);
            gain.gain.linearRampToValueAtTime(0.18, t + i * 0.07 + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.22);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(t + i * 0.07); osc.stop(t + i * 0.07 + 0.25);
            if (i === 2) osc.onended = () => ctx.close();
        });
    } catch(e) {}
}

// Cyan tube orb — sharper higher ping (1100→550 Hz), shorter
export function _playCollectCyan() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1100, t);
        osc.frequency.exponentialRampToValueAtTime(550, t + 0.1);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.14); osc.onended = () => ctx.close();
    } catch(e) {}
}

// Yellow marker — warmer triangle wave, lower pitch (523→262 Hz), longer decay
export function _playCollectYellow() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.exponentialRampToValueAtTime(262, t + 0.22);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.28); osc.onended = () => ctx.close();
    } catch(e) {}
}

// Enemy shot — short sawtooth "pew" (400→80 Hz, 90 ms)
export function _playEnemyShot() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.09);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.10, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.1); osc.onended = () => ctx.close();
    } catch(e) {}
}

// Machinegun shot — short noise tick with low-pass to soften (quieter than hit-marker)
export function _playGunShot() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const dur = 0.045;
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 3000;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.14, 0);
        gain.gain.exponentialRampToValueAtTime(0.001, dur);
        src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
        src.start(); src.onended = () => ctx.close();
    } catch(e) {}
}

export function _playKeyClick() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 8);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.18, 0);
        gain.gain.exponentialRampToValueAtTime(0.001, 0.04);
        src.connect(gain); gain.connect(ctx.destination);
        src.start(); src.onended = () => ctx.close();
    } catch(e) {}
}

export function _playBombDrop() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        // Falling whistle — descending sine
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.exponentialRampToValueAtTime(180, t + 0.35);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.22, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.38); osc.onended = () => ctx.close();
    } catch(e) {}
}

export function _playMissileLaunch() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        const dur = 1.6;
        // Layer 1 — rocket hiss: band-passed noise, sustained then fading
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2200, t); bp.frequency.linearRampToValueAtTime(800, t + dur);
        bp.Q.value = 0.6;
        const hiss = ctx.createGain();
        hiss.gain.setValueAtTime(0.0, t);
        hiss.gain.linearRampToValueAtTime(0.55, t + 0.06); // sharp ignition spike
        hiss.gain.linearRampToValueAtTime(0.3, t + 0.3);   // settle into sizzle
        hiss.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(bp); bp.connect(hiss); hiss.connect(ctx.destination);
        src.start(t);
        // Layer 2 — low ignition thud: short sine bump on launch
        const osc = ctx.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(140, t); osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
        const tg = ctx.createGain();
        tg.gain.setValueAtTime(0.35, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.connect(tg); tg.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.25);
        src.onended = () => ctx.close();
    } catch(e) {}
}

export function _playEmptyClip() { // A11
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        // Dry metallic tick — short noise transient, no tone
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.025), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.22, t);
        src.connect(hp); hp.connect(g); g.connect(ctx.destination);
        src.start(t); src.onended = () => ctx.close();
    } catch(e) {}
}
export function _playNapalmDrop() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        // Heavy thud + low rumble
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90, t);
        osc.frequency.exponentialRampToValueAtTime(30, t + 0.28);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.32); osc.onended = () => ctx.close();
    } catch(e) {}
}

export function _playPlayerHit() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        // Low thud — sine sweep downward
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(130, t);
        osc.frequency.exponentialRampToValueAtTime(35, t + 0.18);
        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(0.5, t);
        oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.connect(oscGain); oscGain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.22);
        // Short noise transient layered on top
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 4);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.35, t);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(noiseGain); noiseGain.connect(ctx.destination);
        src.start(t); src.onended = () => ctx.close();
    } catch(e) {}
}
