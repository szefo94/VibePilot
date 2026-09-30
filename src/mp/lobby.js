/**
 * Callsign prompt: shown when the page is opened without &name=. The choice is remembered for next time and
 * written into the address (history.replaceState), so the seed-sync reload and later visits keep it.
 */
import { cleanName, MODES } from '../net/protocol.js';
import { storageGet, storageSet } from '../core/storage.js';

const KEY = 'vibepilot_mp_name';

/** Resolves with the chosen, cleaned name. */
export function askName({ room, mode }) {
    return new Promise(done => {
        const startMenu = document.getElementById('start-menu');
        if (startMenu) { startMenu.inert = true; startMenu.style.visibility = 'hidden'; } // no focus, and nothing showing through, behind the dialog

        const dialog = document.createElement('form');
        dialog.id = 'mp-lobby'; dialog.className = 'menu-screen';
        dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'mp-lobby-title');
        dialog.innerHTML = `
            <h2 id="mp-lobby-title">Multiplayer</h2>
            <p class="menu-sub"></p>
            <label for="mp-name">Your callsign</label>
            <input id="mp-name" name="name" maxlength="16" autocomplete="nickname" spellcheck="false" required>
            <div class="menu-buttons"><button type="submit">Join</button></div>
            <div class="menu-hint">Letters, digits, space, _ . - · up to 16 characters</div>`;
        dialog.querySelector('.menu-sub').textContent = `${MODES[mode].label} · room ${room}`;
        const input = dialog.querySelector('input'), button = dialog.querySelector('button');
        input.value = storageGet(KEY) || '';
        const valid = () => cleanName(input.value) !== 'Pilot' || /^\s*pilot\s*$/i.test(input.value);
        const refresh = () => { button.disabled = !input.value.trim() || !valid(); };
        input.addEventListener('input', refresh);
        input.addEventListener('keydown', e => e.stopPropagation()); // typing must not reach game shortcuts (V, B, M…)
        dialog.addEventListener('submit', e => {
            e.preventDefault();
            if (button.disabled) return;
            const name = cleanName(input.value);
            storageSet(KEY, name);
            dialog.remove();
            if (startMenu) { startMenu.inert = false; startMenu.style.visibility = ''; startMenu.querySelector('button')?.focus(); }
            done(name);
        });
        document.body.appendChild(dialog);
        refresh();
        input.focus(); input.select();
    });
}
