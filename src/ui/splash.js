/** Typewriter splash screen (currently disabled). */
import { MOUSE_STEERING, maxSpeed } from '../config.js';
import { state } from '../state.js';
import { _playKeyClick } from '../audio.js';
import { _steerCursorEl } from './dom.js';

function runSplash() {
    const splash   = document.getElementById('splash-screen');
    const titleEl  = document.getElementById('splash-title');
    const subEl    = document.getElementById('splash-subtitle');
    const cursor   = document.getElementById('splash-cursor');
    const TITLE    = 'Vibe Pilot';
    const SUBTITLE = 'Objective: Crush enemies';
    const TITLE_SPEED    = 110; // ms per character
    const SUBTITLE_SPEED = 55;

    // Move cursor to end of title text
    function setCursor(el) { el.appendChild(cursor); }

    // Helper: set element text while keeping cursor as last child
    function setText(el, text) {
        // Remove existing text nodes, keep cursor
        [...el.childNodes].forEach(n => { if (n !== cursor) n.remove(); });
        el.insertBefore(document.createTextNode(text), cursor);
    }

    // Show "press any key" prompt — user gesture needed to unlock AudioContext
    const prompt = document.createElement('div');
    prompt.id = 'splash-prompt';
    prompt.textContent = '— press any key —';
    splash.appendChild(prompt);

    function startTypeOut() {
        prompt.remove();
        let cancelled = false;

        function dismiss() {
            if (cancelled) return;
            cancelled = true;
            document.removeEventListener('keydown', onEscapeKey);
            // Use textContent directly — setText() uses insertBefore(cursor) which throws
            // a DOMException if cursor is not a child of that element at dismiss time.
            titleEl.textContent = TITLE;
            subEl.textContent   = SUBTITLE;
            titleEl.style.opacity = '1';
            cursor.style.animation = 'none';
            cursor.style.opacity   = '0';
            splash.style.opacity   = '0';
            state.speed = maxSpeed * 0.5;
            setTimeout(() => { splash.remove(); if (MOUSE_STEERING) _steerCursorEl.style.display = 'block'; }, 500);
        }
        function onEscapeKey(e) { if (e.key === 'Escape') dismiss(); }
        document.addEventListener('keydown', onEscapeKey);

        // Phase 1: type TITLE
        let i = 0;
        setCursor(titleEl);
        const titleTimer = setInterval(() => {
            if (cancelled) { clearInterval(titleTimer); return; }
            i++;
            setText(titleEl, TITLE.slice(0, i));
            _playKeyClick();
            if (i >= TITLE.length) {
                clearInterval(titleTimer);
                // Pause, then fade title out
                setTimeout(() => {
                    if (cancelled) return;
                    titleEl.style.opacity = '0';
                    cursor.style.opacity  = '0';
                    // Phase 2: type SUBTITLE after fade
                    setTimeout(() => {
                        if (cancelled) return;
                        cursor.style.opacity = '1';
                        setCursor(subEl);
                        let j = 0;
                        const subTimer = setInterval(() => {
                            if (cancelled) { clearInterval(subTimer); return; }
                            j++;
                            setText(subEl, SUBTITLE.slice(0, j));
                            _playKeyClick();
                            if (j >= SUBTITLE.length) {
                                clearInterval(subTimer);
                                // Pause, then fade entire splash out
                                setTimeout(() => { dismiss(); }, 1800);
                            }
                        }, SUBTITLE_SPEED);
                    }, 650);
                }, 900);
            }
        }, TITLE_SPEED);
    }

    function onFirstInput(e) {
        if (['Shift','Control','Alt','Meta'].includes(e.key)) return;
        document.removeEventListener('keydown', onFirstInput);
        document.removeEventListener('pointerdown', onFirstInput);
        startTypeOut();
    }
    document.addEventListener('keydown', onFirstInput);
    document.addEventListener('pointerdown', onFirstInput);
}
