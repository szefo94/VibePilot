/**
 * Random dogfighter callsigns ("Ghost Hornet", "Crimson Baron"…) for players who haven't picked one.
 * Every combination fits the 16-character name limit.
 */
import { storageGet, storageSet } from '../core/storage.js';

const FIRST = ['Red', 'Ghost', 'Iron', 'Silver', 'Rogue', 'Crimson', 'Shadow', 'Thunder', 'Steel', 'Storm', 'Night', 'Wild', 'Lone', 'Blaze', 'Sky', 'Black', 'Frost', 'Golden', 'Mad', 'Swift'];
const SECOND = ['Baron', 'Viper', 'Falcon', 'Hawk', 'Eagle', 'Maverick', 'Ace', 'Raptor', 'Hornet', 'Wolf', 'Phantom', 'Talon', 'Spitfire', 'Mustang', 'Tomcat', 'Corsair', 'Jester', 'Warhawk', 'Cobra', 'Kestrel'];
const KEY = 'vibepilot_mp_name';

// crypto, not Math.random: the game seeds Math.random with the map, so every player on a map would get the same name
const pick = list => list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length];
export const randomCallsign = () => `${pick(FIRST)} ${pick(SECOND)}`;

export const savedCallsign = () => storageGet(KEY);
export const saveCallsign = name => storageSet(KEY, name);

/** The remembered callsign, or a new random one (remembered from now on). */
export function defaultCallsign() {
    let name = savedCallsign();
    if (!name) { name = randomCallsign(); saveCallsign(name); }
    return name;
}
