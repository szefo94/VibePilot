/** localStorage access that never throws: denied or unavailable storage falls back to memory for the session. */
const _memory = {};

export function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return key in _memory ? _memory[key] : null; }
}

/** Returns false when the value could only be kept in memory. */
export function storageSet(key, value) {
    _memory[key] = String(value);
    try { localStorage.setItem(key, String(value)); return true; } catch (e) { return false; }
}

/** Stored non-negative integer; missing, malformed or negative values yield `fallback`. */
export function storageGetInt(key, fallback = 0) {
    const raw = storageGet(key);
    const n = raw !== null && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
    return Number.isSafeInteger(n) ? n : fallback;
}
