/**
 * Room picker: the first screen when the multiplayer server is opened without a room (and "Rooms" in the start and
 * pause menus). It lists the server's rooms (GET /rooms, refreshed every 2 s): the default room of every mode —
 * always there, it starts running when its first pilot joins — and any other room players have opened, each with
 * its players and bots counted separately. A pilot can also open a new room of any mode by name.
 * Joining reloads the page onto that room (?mp=<mode>&room=<name>), where net.js connects.
 */
import { cleanRoom, MODES } from '../net/protocol.js';
import { net } from '../net/net.js';
import { askName } from './lobby.js';
import { saveCallsign } from './callsigns.js';

const REFRESH_MS = 2000;
const MODE_HINT = Object.freeze({
    tdm: 'Red vs Blue, 5 a side · bots fill the teams',
    pvp: 'Everyone for themselves · bases and aces',
    coop: 'Together against the bases and aces',
    skies: 'Just flying together · no enemies',
});

/** Where a room link goes: this page's server, that mode and room, the current callsign, straight into the flight. */
function roomUrl(mode, room) {
    const u = new URL('/', location.href);
    u.searchParams.set('mp', mode);
    u.searchParams.set('room', room);
    if (net.name) u.searchParams.set('name', net.name);
    u.searchParams.set('autostart', '');
    return u.href;
}

/**
 * Show the picker. `canClose`: the player is already in a room (opened from a menu), so Esc / Back returns to it.
 * Resolves when closed without joining (joining navigates away).
 */
export function openRoomPicker({ canClose = false } = {}) {
    return new Promise(done => {
        const covered = [...document.querySelectorAll('#start-menu, #paused')].filter(el => !el.inert);
        for (const el of covered) { el.inert = true; el.style.visibility = 'hidden'; }

        const dialog = document.createElement('div');
        dialog.id = 'mp-rooms'; dialog.className = 'menu-screen';
        dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'mp-rooms-title');
        dialog.innerHTML = `
            <h2 id="mp-rooms-title">Choose a room</h2>
            <p class="menu-sub mp-pilot">Flying as <b></b> <button type="button" class="mp-rename">Change callsign</button></p>
            <div class="mp-room-list" role="list" aria-live="polite"><p class="mp-room-empty">Loading rooms…</p></div>
            <form class="mp-new-room">
                <label for="mp-new-name">New room</label>
                <input id="mp-new-name" maxlength="24" placeholder="room name" autocomplete="off" spellcheck="false" required>
                <select aria-label="Game mode">${Object.entries(MODES).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('')}</select>
                <button type="submit">Create &amp; join</button>
            </form>
            <div class="menu-buttons menu-row">${canClose ? '<button type="button" class="mp-back">Back to the flight</button>' : ''}<button type="button" class="mp-sp">Single-player</button></div>
            <div class="menu-hint">A room starts when its first pilot joins · the list refreshes every 2 s${canClose ? ' · Esc goes back' : ''}</div>`;
        const list = dialog.querySelector('.mp-room-list'), pilot = dialog.querySelector('.mp-pilot b');
        const newName = dialog.querySelector('#mp-new-name'), newMode = dialog.querySelector('select');
        newMode.value = net.mode;
        pilot.textContent = net.name || 'Pilot';

        const row = r => {
            const full = r.players >= r.max, here = canClose && r.mode === net.mode && r.room === net.room;
            const b = document.createElement('button');
            b.type = 'button'; b.className = `mp-room${r.running ? ' running' : ''}${here ? ' here' : ''}`; b.setAttribute('role', 'listitem');
            b.disabled = full || here;
            const players = `${r.players} / ${r.max} player${r.max === 1 ? '' : 's'}`, bots = `${r.bots} bot${r.bots === 1 ? '' : 's'}`;
            b.innerHTML = '<span class="mp-room-title"></span><span class="mp-room-hint"></span><span class="mp-room-counts"><span class="mp-room-players"></span><span class="mp-room-bots"></span></span><span class="mp-room-state"></span>';
            b.querySelector('.mp-room-title').textContent = `${r.label} · ${r.room}`;
            b.querySelector('.mp-room-hint').textContent = MODE_HINT[r.mode] ?? '';
            b.querySelector('.mp-room-players').textContent = `👤 ${players}`;
            b.querySelector('.mp-room-bots').textContent = `🤖 ${bots}`;
            b.querySelector('.mp-room-state').textContent = here ? 'you are here' : full ? 'full' : r.running ? 'running · join' : 'empty · starts when you join';
            b.setAttribute('aria-label', `${r.label}, room ${r.room}: ${players}, ${bots}, ${r.running ? 'running' : 'empty'}`);
            b.addEventListener('click', () => location.assign(roomUrl(r.mode, r.room)));
            return b;
        };
        let timer = 0, first = true;
        const refresh = async () => {
            try {
                const res = await fetch('/rooms', { cache: 'no-store' });
                const { rooms } = await res.json();
                const focused = document.activeElement?.closest?.('.mp-room') ? [...list.children].indexOf(document.activeElement) : -1;
                list.replaceChildren(...rooms.map(row));
                if (focused >= 0) list.children[Math.min(focused, list.children.length - 1)]?.focus(); // keep keyboard focus across refreshes
                if (first) { first = false; list.querySelector('.mp-room:not(:disabled)')?.focus(); }
            } catch {
                list.replaceChildren(Object.assign(document.createElement('p'), { className: 'mp-room-empty', textContent: 'Cannot reach the server — retrying…' }));
            }
            timer = setTimeout(refresh, REFRESH_MS);
        };

        const close = () => {
            clearTimeout(timer);
            dialog.remove();
            for (const el of covered) { el.inert = false; el.style.visibility = ''; }
            covered[0]?.querySelector('button')?.focus();
            done();
        };
        dialog.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape' && canClose) close(); }); // typing must not reach game shortcuts
        dialog.querySelector('.mp-back')?.addEventListener('click', close);
        dialog.querySelector('.mp-sp').addEventListener('click', () => location.assign(new URL('/?sp', location.href).href));
        dialog.querySelector('.mp-rename').addEventListener('click', async () => {
            const name = await askName({ room: net.room, mode: net.mode, current: net.name });
            if (name) { net.name = name; saveCallsign(name); pilot.textContent = name; }
            dialog.querySelector('.mp-rename').focus();
        });
        dialog.querySelector('.mp-new-room').addEventListener('submit', e => {
            e.preventDefault();
            const room = cleanRoom(newName.value.toLowerCase().replace(/\s+/g, '-'));
            if (room) location.assign(roomUrl(newMode.value, room));
            else newName.setCustomValidity('Letters, digits, - and _ only'), newName.reportValidity();
        });
        newName.addEventListener('input', () => newName.setCustomValidity(''));
        document.body.appendChild(dialog);
        refresh();
    });
}

