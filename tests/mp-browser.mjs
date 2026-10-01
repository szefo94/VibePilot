// Multiplayer browser checks: a real server and two headless players (host + guest), driven through the live ES
// modules with dynamic import(). Covers team deathmatch (teams, bots, the flag, kills/deaths, score) and Ace Hunt
// in PvP, and the room picker. Run with `npm run test:mp-browser`; set BROWSER_PATH to a Chromium-based browser (see browser-probes.mjs).
import { chromium } from 'playwright-core';
import { startMpServer } from '../server/server.mjs';

const PORT = 8790;
const mp = await startMpServer({ port: PORT, log: () => {} });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let failures = 0;
const check = (name, pass, detail) => {
    if (!pass) failures++;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
/** Poll an async check in the page until it is true (waitForFunction does not await async predicates). */
async function until(page, fn, arg, timeout = 120000) {
    for (const end = Date.now() + timeout; Date.now() < end; await wait(400)) if (await page.evaluate(fn, arg).catch(() => false)) return true;
    return false;
}

/** A player in its own browser context; resolves once online with the room's map and enemies built. */
async function player(query, tag, joinsExisting) {
    const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
    page.setDefaultTimeout(120000);
    page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    await page.goto(`http://127.0.0.1:${PORT}/${query}`, { timeout: 120000 });
    if (joinsExisting) await page.waitForURL(/seed=/); // a later player reloads onto the room's map
    await until(page, async () => (await import('./src/net/net.js')).net.status === 'online'
        && (await import('./src/entities/registry.js')).groundUnits.some(u => u.userData.netId));
    return page;
}
const stats = page => page.evaluate(async () => {
    const { net } = await import('./src/net/net.js');
    const b = await import('./src/mp/bots.js');
    return { id: net.id, team: net.team, score: net.score, kd: net.stats, bots: b.botStats(), roster: document.getElementById('net-status').innerText };
});

try {
    // --- Team deathmatch ---------------------------------------------------------------------------------------
    const A = await player('?mp=tdm&room=probe&name=Alpha&autostart&invulnerable', 'A', false);
    await until(A, async () => { // the host has spawned all its bots and drawn the roster with them
        const s = (await import('./src/mp/bots.js')).botStats();
        return s.hosting && s.aces === 9 && s.teamBots.length === 9 && /Viper · bot/.test(document.getElementById('net-status').innerText);
    });
    let a = await stats(A);
    check('tdmHostFillsTeams', a.team === 0 && a.bots.hosting && a.bots.teamBots.filter(e => e.team === 0).length === 4 && a.bots.teamBots.filter(e => e.team === 1).length === 5, a.bots.teamBots);
    const rally = await A.evaluate(async () => { const { rivalList } = await import('./src/entities/rival.js'); return rivalList().filter(r => !r.gone).map(r => !!r.ai.rally); });
    check('tdmBotsRallyToFlag', rally.length === 9 && rally.every(Boolean), rally);
    const flag = await A.evaluate(async () => {
        const { obstacles } = await import('./src/entities/registry.js');
        const pole = obstacles.find(o => o.userData.coneBase?.x === 0 && o.userData.coneBase?.z === 0);
        return { pole: !!pole, top: pole?.userData.coneApex.y };
    });
    check('tdmFlagPoleIsSolid', flag.pole && flag.top > 0, flag);
    check('tdmScoreboard', /RED \d+ : BLUE \d+/.test(a.roster) && /Viper · bot/.test(a.roster) && /\dK\/\dD/.test(a.roster), a.roster);

    const B = await player('?mp=tdm&room=probe&name=Bravo&autostart&invulnerable', 'B', true);
    await until(B, async () => (await import('./src/mp/bots.js')).botStats().bots.length >= 8); // the host's bots have arrived
    await until(A, async () => (await import('./src/mp/bots.js')).botStats().teamBots.filter(e => e.team === 1).length === 4, undefined, 15000); // one Blue bot made room
    a = await stats(A);
    const b = await stats(B);
    const spawnDeaths = Object.entries(a.kd ?? {}).filter(([k, v]) => k.startsWith('b:') && v.d > 0).map(([k]) => k);
    check('tdmBotsSurviveSpawning', spawnDeaths.length === 0, spawnDeaths);
    check('tdmGuestJoinsOtherTeam', b.team === 1 && a.bots.teamBots.filter(e => e.team === 1).length === 4, { team: b.team, blue: a.bots.teamBots.filter(e => e.team === 1).length });
    check('tdmGuestSeesBots', b.bots.bots.length >= 8 && b.bots.bots.every(x => x.proxy === (x.team !== b.team)), b.bots.bots);

    // Bravo shoots down a Red bot: Blue scores, Bravo gets the kill and the XP
    const shot = await B.evaluate(async () => {
        const { airUnits } = await import('./src/entities/registry.js');
        const { beginHits } = await import('./src/combat/hits.js');
        const { state } = await import('./src/state.js');
        const u = airUnits.find(x => x.id?.startsWith('bot-') && x.hp > 0);
        const xp0 = state.xp + state.level * 1000;
        if (u) { const hits = beginHits('missile'); hits.damage(u, 999); hits.finish(); }
        return { id: u?.id, xp0 };
    });
    await until(B, async () => (await import('./src/net/net.js')).net.score[1] >= 1, undefined, 15000);
    const after = await stats(B);
    const gained = await B.evaluate(async x => { const { state } = await import('./src/state.js'); return state.xp + state.level * 1000 - x; }, shot.xp0);
    check('tdmBotKillScores', after.score[1] >= 1 && after.kd[`p${after.id}`]?.k === 1 && gained > 0, { score: after.score, kd: after.kd[`p${after.id}`], gained });

    // Ramming a bot takes it down (crash: a death, no kill)
    const ram = await B.evaluate(async () => {
        const { airUnits } = await import('./src/entities/registry.js');
        const u = airUnits.find(x => x.id?.startsWith('bot-') && x.hp > 0);
        u?.proxy.ram();
        return u?.id.slice(4);
    });
    await until(A, async id => { const { rivalList } = await import('./src/entities/rival.js'); return !rivalList().some(r => r.netBot === id && !r.gone && r.hp > 0); }, ram, 15000);
    const rammed = await A.evaluate(async id => { const { rivalList } = await import('./src/entities/rival.js'); return rivalList().some(r => r.netBot === id && !r.gone && r.hp > 0); }, ram);
    check('tdmRamDownsBot', !!ram && !rammed, ram);
    await A.context().close(); await B.context().close();

    // --- PvP: Ace Hunt aces are shared ---------------------------------------------------------------------------
    const H = await player('?mp=pvp&room=probe&name=Host&autostart&invulnerable', 'H', false);
    const G = await player('?mp=pvp&room=probe&name=Guest&autostart&invulnerable', 'G', true);
    await H.evaluate(async () => { const { spawnRival } = await import('./src/entities/rival.js'); spawnRival(); });
    await until(G, async () => (await import('./src/mp/bots.js')).botStats().bots.length === 1 && /☠ ACE/.test(document.getElementById('net-status').innerText), undefined, 15000);
    const g = await stats(G);
    check('pvpAceSharedWithGuest', g.bots.bots.length === 1 && /ACE/.test(g.bots.bots[0].name) && /☠ ACE/.test(g.roster), g.bots.bots);

    // --- Room picker: the bare address lists a room per mode with players and bots; joining one goes there ----
    const P = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
    P.on('pageerror', e => errors.push(`P: ${e.message}`));
    await P.goto(`http://127.0.0.1:${PORT}/`, { timeout: 120000 });
    await P.waitForSelector('#mp-rooms .mp-room', { timeout: 120000 });
    const rows = await P.$$eval('#mp-rooms .mp-room', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
    check('pickerListsEveryMode', ['Team deathmatch · lobby', 'PvP · lobby', 'Co-op · lobby', 'Shared skies · lobby'].every(t => rows.some(r => r.includes(t))), rows);
    check('pickerCountsPlayersAndBots', rows.some(r => r.includes('PvP · probe') && r.includes('2 / 10 players') && r.includes('1 bot')), rows.filter(r => r.includes('probe')));
    if (process.env.SHOT) await P.screenshot({ path: process.env.SHOT });
    await P.click('#mp-rooms .mp-room:has-text("Shared skies · lobby")');
    await P.waitForURL(/room=lobby/);
    const joined = await until(P, async () => { const { net } = await import('./src/net/net.js'); return net.status === 'online' && net.mode === 'skies' && net.room === 'lobby'; }, undefined, 60000);
    check('pickerJoinsRoom', joined);
} catch (e) {
    failures++;
    console.log(`FAIL exception ${e.message}`);
}
check('noPageErrors', errors.length === 0, errors.slice(0, 5));
await browser.close();
await mp.close();
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);

