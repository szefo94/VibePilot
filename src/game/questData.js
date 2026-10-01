/**
 * Freaky mode's plot: arcs of quests, each ending in a boss finale (game/quests.js runs them).
 *
 * A step lists one or more variants; quests.js takes the first whose targets exist in the world right now, else the
 * first one (and spawns what it needs). Goals:
 *   { type: 'scout', where: 'sea' | 'peak' | 'village' | 'base' | 'high' | 'place', radius }   fly there
 *   { type: 'destroy', unit, count }        existing units of that kind first, new ones spawned if too few remain
 *   { type: 'base' }                        eliminate the nearest enemy base (a new one is built if all are gone)
 *   { type: 'collect', item, count, where } pick up story items scattered around a place
 *   { type: 'boss' }                        the arc's boss, at the arc's place (where the story led)
 * `place` remembers the first scouted point of an arc: later steps and the finale happen around it.
 */
export const SPEAKERS = Object.freeze({
    voss: { name: 'DR. ELKE VOSS', role: 'Cryptozoology Desk', color: '#9fe8ff' },
    command: { name: 'COMMAND', role: 'Theatre Operations', color: '#ffd23a' },
    archivist: { name: 'THE ARCHIVIST', role: 'Restricted Files', color: '#c9a0ff' },
    radio: { name: 'UNKNOWN BAND', role: 'intercepted', color: '#ff7a7a' },
});

export const ARCS = Object.freeze([
    {
        id: 'water', name: 'Something in the Water', boss: 'kaiju',
        steps: [
            [{ goal: { type: 'scout', where: 'sea', radius: 160 }, title: 'Sonar Ghost', speaker: 'voss',
                text: 'Pilot, our hydrophones picked up a heartbeat the size of a building. Fly over the contact and give me eyes on the water.' }],
            [{ goal: { type: 'destroy', unit: 'destroyer', count: 2 }, title: 'Stop the Depth Charges', speaker: 'command',
                text: 'Those destroyers are dropping depth charges on it. If they wake it up angry, we all pay. Sink them.' },
             { goal: { type: 'destroy', unit: 'helicopter', count: 3 }, title: 'Clear the Hunters', speaker: 'command',
                text: 'Sub-hunting helicopters are pinging the contact. Knock them out of the sky before they provoke it.' }],
            [{ goal: { type: 'collect', item: 'sonar buoy', count: 4, where: 'place' }, title: 'Listen to the Deep', speaker: 'voss',
                text: 'Collect my sonar buoys around the contact. I need to hear what it is doing down there.' }],
            [{ goal: { type: 'boss' }, title: 'It Wakes', speaker: 'voss',
                text: 'The heartbeat is accelerating — it is surfacing! Pilot, that is not a whale. Engage!' }],
        ],
    },
    {
        id: 'heat', name: 'Heat Rising', boss: 'golem',
        steps: [
            [{ goal: { type: 'scout', where: 'peak', radius: 170 }, title: 'The Mountain Breathes', speaker: 'voss',
                text: 'The highest peak is warming by a degree an hour. Mountains do not do that. Go and look.' }],
            [{ goal: { type: 'destroy', unit: 'tank', count: 3 }, title: 'The Cult Convoy', speaker: 'radio',
                text: '…the convoy brings the offerings to the fire. The Heart will rise… [static]' }],
            [{ goal: { type: 'destroy', unit: 'turret', count: 2 }, title: 'Break Their Guns', speaker: 'command',
                text: 'They have set up anti-air around the slopes. Take the guns out so we can get close.' },
             { goal: { type: 'base' }, title: 'Burn the Camp', speaker: 'command',
                text: 'Their base is feeding the ritual. Wipe it out.' }],
            [{ goal: { type: 'boss' }, title: 'The Heart of the Volcano', speaker: 'voss',
                text: 'The crater is splitting open — something is climbing out of the lava! Hit the glowing core!' }],
        ],
    },
    {
        id: 'titan', name: 'Project TITAN', boss: 'robot',
        steps: [
            [{ goal: { type: 'scout', where: 'village', radius: 150 }, title: 'Tremors', speaker: 'command',
                text: 'Villagers report the ground shaking at night. Fly over the village and see what is under it.' }],
            [{ goal: { type: 'destroy', unit: 'truck', count: 3 }, title: 'Supply Line', speaker: 'archivist',
                text: 'Project TITAN was cancelled in 1987. Somebody did not get the memo. Destroy their supply trucks.' }],
            [{ goal: { type: 'destroy', unit: 'fighter', count: 3 }, title: 'The Escort', speaker: 'command',
                text: 'Fighters are flying cover over the site. Clear them out.' },
             { goal: { type: 'destroy', unit: 'helicopter', count: 3 }, title: 'The Escort', speaker: 'command',
                text: 'Helicopters are flying cover over the site. Clear them out.' }],
            [{ goal: { type: 'boss' }, title: 'TITAN-9 Online', speaker: 'archivist',
                text: 'Too late. TITAN-9 is walking. Its armour is thick — aim for the head, and dodge the missiles.' }],
        ],
    },
    {
        id: 'specimen', name: 'Specimen 47', boss: 'alien',
        steps: [
            [{ goal: { type: 'destroy', unit: 'helicopter', count: 3 }, title: 'Unmarked Choppers', speaker: 'archivist',
                text: 'Three unmarked helicopters are moving something between bases. Bring them down — gently is optional.' }],
            [{ goal: { type: 'collect', item: 'biohazard canister', count: 3, where: 'base' }, title: 'Spilled Cargo', speaker: 'voss',
                text: 'Their cargo split open on the way down. Recover the canisters before anything hatches.' }],
            [{ goal: { type: 'base' }, title: 'Containment Breach', speaker: 'command',
                text: 'Alarms at a military base. Hostile forces are covering something up. Clear the base.' }],
            [{ goal: { type: 'boss' }, title: 'Specimen 47', speaker: 'voss',
                text: 'It is out. Six legs, acid, and it lays — watch for the small ones. Shake them off if they latch on!' }],
        ],
    },
    {
        id: 'ink', name: 'Ships Are Vanishing', boss: 'kraken',
        steps: [
            [{ goal: { type: 'scout', where: 'sea', radius: 160 }, title: 'Ghost Ship', speaker: 'radio',
                text: '…mayday, mayday, something has the hull, it is pulling us — [silence]' }],
            [{ goal: { type: 'collect', item: 'ink sample', count: 3, where: 'place' }, title: 'Black Water', speaker: 'voss',
                text: 'The sea there is black with ink. Fly low and sample it — I need to know how big.' }],
            [{ goal: { type: 'destroy', unit: 'destroyer', count: 2 }, title: 'Bait', speaker: 'command',
                text: 'Enemy destroyers are using the panic to move in. Sink them — the wrecks will draw it up.' },
             { goal: { type: 'destroy', unit: 'helicopter', count: 3 }, title: 'Bait', speaker: 'command',
                text: 'Enemy helicopters are using the panic to move in. Bring them down over the water.' }],
            [{ goal: { type: 'boss' }, title: 'Release the Kraken', speaker: 'voss',
                text: 'There! Eight arms, and they reach high. Watch the water for rings — and its young.' }],
        ],
    },
    {
        id: 'moon', name: 'Dark Side of the Moon', boss: 'zombot',
        steps: [
            [{ goal: { type: 'collect', item: 'moon shard', count: 4, where: 'high' }, title: 'Falling Stars', speaker: 'voss',
                text: 'Moon rock is raining down high above the islands — and it is warm. Catch some before it lands.' }],
            [{ goal: { type: 'destroy', unit: 'ac130', count: 1 }, title: 'The Relay', speaker: 'archivist',
                text: 'A gunship is broadcasting toward the Moon on a frequency we buried in 1946. Shoot it down.' },
             { goal: { type: 'destroy', unit: 'fighter', count: 3 }, title: 'The Relay', speaker: 'archivist',
                text: 'Fighters are relaying a signal toward the Moon on a frequency we buried in 1946. Shoot them down.' }],
            [{ goal: { type: 'scout', where: 'high', radius: 180 }, title: 'Look Up', speaker: 'command',
                text: 'Something is descending. Climb to the ceiling over the islands and get a fix on it.' }],
            [{ goal: { type: 'boss' }, title: 'From the Dark Side', speaker: 'archivist',
                text: 'It is the Stahlmond Zombot. Iron, rot and rockets. It flies — keep moving.' }],
        ],
    },
]);
