/**
 * "Change callsign" dialog (start and pause menus). Players join straight away with a remembered or random
 * callsign (callsigns.js); this lets them pick their own. Resolves with the new name, or null when cancelled.
 */
import { cleanName, MODES } from '../net/protocol.js';
import { randomCallsign } from './callsigns.js';

export function askName({ room, mode, current }) {
    return new Promise(done => {
        const covered = [...document.querySelectorAll('#start-menu, #paused')].filter(el => !el.inert);
        for (const el of covered) { el.inert = true; el.style.visibility = 'hidden'; } // no focus, and nothing showing through

        const dialog = document.createElement('form');
        dialog.id = 'mp-lobby'; dialog.className = 'menu-screen';
        dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'mp-lobby-title');
        dialog.innerHTML = `
            <h2 id="mp-lobby-title">Callsign</h2>
            <p class="menu-sub"></p>
            <label for="mp-name">Your callsign</label>
            <div class="mp-name-row"><input id="mp-name" name="name" maxlength="16" autocomplete="nickname" spellcheck="false" required><button type="button" class="mp-dice" aria-label="Random callsign">🎲</button></div>
            <div class="menu-buttons menu-row"><button type="submit">Save</button><button type="button" class="mp-cancel">Cancel</button></div>
            <div class="menu-hint">Letters, digits, space, _ . - · up to 16 characters · Esc cancels</div>`;
        dialog.querySelector('.menu-sub').textContent = `${MODES[mode].label} · room ${room}`;
        const input = dialog.querySelector('input'), save = dialog.querySelector('[type="submit"]');
        input.value = current || '';
        const valid = () => input.value.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().length > 0;
        const refresh = () => { save.disabled = !valid(); };
        const close = name => {
            dialog.remove();
            for (const el of covered) { el.inert = false; el.style.visibility = ''; }
            covered[0]?.querySelector('button')?.focus();
            done(name);
        };
        input.addEventListener('input', refresh);
        dialog.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(null); }); // typing must not reach game shortcuts
        dialog.querySelector('.mp-dice').addEventListener('click', () => { input.value = randomCallsign(); refresh(); input.focus(); });
        dialog.querySelector('.mp-cancel').addEventListener('click', () => close(null));
        dialog.addEventListener('submit', e => { e.preventDefault(); if (valid()) close(cleanName(input.value)); });
        document.body.appendChild(dialog);
        refresh();
        input.focus(); input.select();
    });
}
