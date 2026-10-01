/**
 * Map chooser on the start menu: a north-up preview of the current map (the minimap's baked relief, ui/terrainMap.js),
 * its name and seed, islands, bases and the highest summit, and ways to fly a different one — the previous or next
 * seed, a random new map, or a typed seed. Every map comes from its seed (debug/seed-random.js), so choosing one
 * reloads the page onto it and comes back to this menu. "Main menu" (pause, game over, debrief) returns here.
 */
import { onHook } from '../game/hooks.js';
import { islets } from '../world/world.js';
import { baseMarkers } from '../entities/registry.js';
import { drawMapPreview, highestSummit } from './terrainMap.js';

const ADJ = ['Amber', 'Azure', 'Broken', 'Cinder', 'Coral', 'Crimson', 'Drifting', 'Emerald', 'Frozen', 'Golden', 'Hollow', 'Iron', 'Jade', 'Misty', 'Silent', 'Storm'];
const NOUN = ['Archipelago', 'Atoll', 'Bay', 'Cays', 'Coast', 'Isles', 'Keys', 'Reach', 'Reef', 'Shallows', 'Shoals', 'Sound', 'Straits', 'Tides', 'Waters', 'Spires'];
/** A memorable name for a seed (the same seed always gets the same name). */
export function mapName(seed) {
    let h = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; // neighbouring seeds get unrelated names
    return `${ADJ[h & 15]} ${NOUN[(h >>> 4) & 15]}`;
}

const seed = () => window.__vpSeed >>> 0;
/** Reload onto map `s` at the start menu. */
export function goToMap(s) {
    const url = new URL(location.href);
    url.searchParams.set('seed', String((s >>> 0) || 1));
    url.searchParams.delete('autostart');
    location.assign(url.href);
}

const box = document.createElement('div');
box.className = 'map-pick';
box.innerHTML = `
    <canvas class="map-preview" width="132" height="132" role="img" aria-label="Map preview"></canvas>
    <div class="map-info">
        <div class="map-kicker">Map</div>
        <div class="map-name"></div>
        <div class="map-meta"></div>
        <div class="map-row">
            <button type="button" data-map="prev" aria-label="Previous map">◀</button>
            <button type="button" data-map="new">🎲 New map</button>
            <button type="button" data-map="next" aria-label="Next map">▶</button>
        </div>
        <form class="map-row map-seed"><input type="number" min="1" max="4294967295" placeholder="Seed" aria-label="Map seed"><button type="submit">Go</button></form>
    </div>`;
const menu = document.getElementById('start-menu');
menu.querySelector('.menu-buttons')?.after(box);
box.querySelector('.map-name').textContent = mapName(seed());

box.addEventListener('click', e => {
    const which = e.target.closest('[data-map]')?.dataset.map;
    if (which === 'prev') goToMap(seed() - 1);
    else if (which === 'next') goToMap(seed() + 1);
    else if (which === 'new') goToMap(crypto.getRandomValues(new Uint32Array(1))[0]);
});
box.querySelector('.map-seed').addEventListener('submit', e => {
    e.preventDefault();
    const v = Number(box.querySelector('.map-seed input').value);
    if (Number.isInteger(v) && v > 0) goToMap(v);
});

onHook('worldReady', () => {
    drawMapPreview(box.querySelector('.map-preview'));
    const peak = highestSummit();
    box.querySelector('.map-meta').textContent = `#${seed()} · ${islets.length} islands · ${baseMarkers.length} bases${peak ? ` · summit ${peak} m` : ''}`;
});

/** Multiplayer: the room decides the map — no chooser. */
export function hideMapPicker() { box.hidden = true; }
