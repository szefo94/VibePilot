// Focused browser regression probes (see PROJECT_REVIEW.md). Each probe loads the game in a fresh page,
// imports the live ES modules with dynamic import() and checks one behaviour.
//
//   npm run test:browser                  # all probes
//   npm run test:browser -- pause grace   # selected probes
//
// Browser: set BROWSER_PATH to a Chromium-based executable (Chrome, Brave, Edge), or install
// Playwright's Chromium once with `npx playwright-core install chromium`.
import { chromium } from 'playwright-core';
import { startServer } from '../scripts/serve.mjs';

const only = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));

const worldReady = page => page.waitForFunction(async () => {
    const { groundUnits } = await import('./src/entities/registry.js');
    return groundUnits.length > 20;
}, null, { timeout: 60000 });

const probes = {
    // Startup: no uncaught errors, world populated, HUD attached
    async startup(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { groundUnits, airUnits, enemies } = await import('./src/entities/registry.js');
            return { ground: groundUnits.length, air: airUnits.length, fighters: enemies.length, pass: groundUnits.length > 20 && enemies.length > 0 && !!document.querySelector('canvas') };
        });
    },
    // #19 start menu holds the game until Start; Esc opens a focused pause menu with a visible cursor
    menus: Object.assign(async page => {
        await worldReady(page);
        const read = () => page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            return {
                awaiting: state.awaitingStart, paused: state.isPaused, elapsed: state._gameElapsed, missiles: state.missileAmmo,
                startVisible: !document.getElementById('start-menu').hidden,
                pauseVisible: getComputedStyle(document.getElementById('paused')).display !== 'none',
                focused: document.activeElement?.dataset?.action ?? document.activeElement?.tagName,
                cursor: getComputedStyle(document.body).cursor,
            };
        });
        const menu = await read();
        await page.keyboard.press('r'); await wait(400);
        const blocked = await read();
        await page.keyboard.press('Enter'); await wait(400);
        const started = await read(); await wait(400);
        const running = await read();
        await page.keyboard.press('Escape'); await wait(300);
        const paused = await read();
        await page.keyboard.press('Escape'); await wait(300);
        const resumed = await read();
        const pass = menu.awaiting && menu.startVisible && menu.cursor === 'auto'
            && blocked.elapsed === menu.elapsed && blocked.missiles === menu.missiles
            && !started.awaiting && !started.startVisible && running.elapsed > started.elapsed
            && paused.paused && paused.pauseVisible && paused.focused === 'resume' && paused.cursor === 'auto'
            && !resumed.paused && !resumed.pauseVisible && resumed.cursor === 'none';
        return { menu, blocked, started, paused, resumed, pass };
    }, { query: '' }),
    // #19 settings apply immediately and persist
    async settings(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { openSettings, closeSettings } = await import('./src/game/session.js');
            const { settings } = await import('./src/core/settings.js');
            openSettings();
            document.querySelector('[data-setting="invertPitch"]').click();
            const volume = document.querySelector('[data-setting="volume"]');
            volume.value = '0.3'; volume.dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('[data-setting="showReferencePanels"]').click();
            const stored = JSON.parse(localStorage.getItem('vibepilot_settings'));
            const panelsHidden = getComputedStyle(document.getElementById('instructions')).display === 'none';
            closeSettings();
            return { stored, panelsHidden, invertPitch: settings.invertPitch, pass: stored.invertPitch === true && stored.volume === 0.3 && stored.showReferencePanels === false && panelsHidden && document.getElementById('settings-dialog').hidden };
        });
    },
    // #19 / section 5: "Replay this map" reloads the same seed (identical islets) and skips the start menu
    async replay(page) {
        await worldReady(page);
        const islets = () => page.evaluate(async () => (await import('./src/world/world.js')).islets.map(i => [Math.round(i.x), Math.round(i.z), Math.round(i.radius)]).join(';'));
        const before = await islets();
        const seed = await page.evaluate(async () => { (await import('./src/game/gameOver.js')).triggerGameOver(); return window.__vpSeed; });
        const focused = await page.evaluate(() => document.activeElement?.dataset?.action);
        await Promise.all([page.waitForNavigation(), page.click('#game-over [data-action="replay"]')]);
        await worldReady(page);
        const after = await page.evaluate(async () => ({ search: location.search, seed: window.__vpSeed, awaiting: (await import('./src/state.js')).state.awaitingStart }));
        const sameMap = (await islets()) === before;
        return { seed, focused, after, sameMap, pass: after.seed === seed && sameMap && after.search.includes('autostart') && !after.awaiting && focused === 'restart' };
    },
    // #1 spawn protection counts down in simulated seconds (independent of how slow the headless frames are)
    async grace(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const frames = n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
            state._graceTimer = 5;
            const g0 = state._graceTimer, e0 = state._gameElapsed;
            await frames(30);
            const simSeconds = (state._gameElapsed - e0) / 60, graceUsed = g0 - state._graceTimer;
            return { simSeconds: +simSeconds.toFixed(3), graceUsed: +graceUsed.toFixed(3), pass: simSeconds > 0 && Math.abs(graceUsed - simSeconds) < 0.02 };
        });
    },
    // #2 paused keyboard/mouse actions do not consume ammo; unpaused still works
    async pause(page) {
        const ammo = () => page.evaluate(async () => { const { state } = await import('./src/state.js'); return { paused: state.isPaused, m: state.missileAmmo, b: state.bombAmmo, f: state.flareAmmo, n: state.napalmAmmo }; });
        await page.keyboard.press('Escape');
        const before = await ammo();
        for (const k of ['r', 'e', 'q', 'x']) await page.keyboard.press(k);
        await page.mouse.click(700, 400, { button: 'right' });
        const during = await ammo();
        await page.keyboard.press('Escape');
        await page.keyboard.press('r');
        const after = await ammo();
        return { before, during, after, pass: before.paused && ['m', 'b', 'f', 'n'].every(k => during[k] === before[k]) && !after.paused && after.m === before.m - 1 };
    },
    // #3 parented airport turrets use world coordinates; #8/#11 airport death exposes turrets in the world
    async turrets(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const { groundUnits } = await import('./src/entities/registry.js');
            const { groundUnitWorldPos, canDamageGround } = await import('./src/combat/damage.js');
            const { killGroundUnit } = await import('./src/entities/groundUnits.js');
            const { scene } = await import('./src/core/scene.js');
            await new Promise(r => { let i = 0; const f = () => (++i >= 3 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }); // let updateAI refresh caches
            state.isPaused = true;
            const airport = groundUnits.find(u => u.userData.type === 'airport' && u.userData.dependents?.length);
            if (!airport) return { pass: false, error: 'no airport' };
            const t = airport.userData.dependents[0];
            const expected = t.getWorldPosition(new THREE.Vector3());
            const cachedErr = groundUnitWorldPos(t).distanceTo(expected);
            const localDiffers = t.position.distanceTo(expected) > 1;
            const protectedBefore = !canDamageGround(t, 'bullet') && !canDamageGround(t, 'missile');
            airport.userData._alive = true; airport.userData.hp = 0;
            killGroundUnit(airport);
            const after = { parentIsScene: t.parent === scene, inRegistry: groundUnits.includes(t), exposed: canDamageGround(t, 'bullet'), worldPosKept: groundUnitWorldPos(t).distanceTo(expected) < 0.01 };
            return { cachedErr, localDiffers, protectedBefore, after, pass: cachedErr < 0.01 && localDiffers && protectedBefore && Object.values(after).every(Boolean) };
        });
    },
    // #4 direct missile hit on a large unit deals damage; #5 one blast damages every original victim
    async missileSplash(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const { enemies, missiles, groundUnits } = await import('./src/entities/registry.js');
            const { updateProjectiles } = await import('./src/combat/projectiles.js');
            const { createGroundUnit } = await import('./src/entities/groundUnits.js');
            const { scene } = await import('./src/core/scene.js');
            const { groundLevel } = await import('./src/config.js');
            state.isPaused = true;
            const [e1, e2] = enemies;
            const place = (e, x) => e.parts.forEach(p => { p.position.set(x, 60, 900); p.userData.hp = 10; });
            place(e1, 900); place(e2, 901);
            const missile = (x, y, z) => { const m = new THREE.Object3D(); m.position.set(x, y, z); m.velocity = new THREE.Vector3(); m.life = 100; m.speed = 0; m.dropPhase = 1; m.trailTimer = 99; m.target = null; scene.add(m); missiles.push(m); };
            missile(900.5, 60, 900);
            updateProjectiles(0);
            const splash = { e1Alive: enemies.includes(e1), e2Alive: enemies.includes(e2) };
            const d = createGroundUnit('destroyer'); d.position.set(-900, groundLevel + 1, -900); d.userData.hp = 100; scene.add(d); groundUnits.push(d);
            missile(-900 + 51, groundLevel + 6, -900); // inside the 50-radius collision sphere, 51 units from the centre
            updateProjectiles(0);
            return { splash, destroyerHp: d.userData.hp, pass: !splash.e1Alive && !splash.e2Alive && d.userData.hp < 100 };
        });
    },
    // #6 enemies leaving the map are recycled without score/XP
    async outOfBounds(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const { enemies } = await import('./src/entities/registry.js');
            const { updateAI } = await import('./src/ai.js');
            state.isPaused = true;
            const before = { score: state.score, xp: state.xp, n: enemies.length };
            const [a, b] = enemies; // two at once also exercises deferred removal
            for (const e of [a, b]) e.parts.forEach(p => { p.position.x += 5000; });
            updateAI(0);
            const after = { score: state.score, xp: state.xp, n: enemies.length, gone: !enemies.includes(a) && !enemies.includes(b) };
            return { before, after, pass: after.score === before.score && after.xp === before.xp && after.n === before.n && after.gone };
        });
    },
    // #7 gun cadence independent of frame rate
    async cadence(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const { keys } = await import('./src/input.js');
            const { updatePhysics } = await import('./src/player/flight.js');
            state.isPaused = true;
            const shotsAt = (dt, frameUnits) => {
                state.gunAmmo = 1e6; state.shootCooldown = 0; keys[' '] = true;
                const before = state.gunAmmo;
                for (let f = 0; f < frameUnits / dt; f++) updatePhysics(dt);
                keys[' '] = false;
                return before - state.gunAmmo;
            };
            const r = { fps144: shotsAt(60 / 144, 240), fps60: shotsAt(1, 240), fps20: shotsAt(3, 240), fps10: shotsAt(6, 240) };
            return { ...r, pass: Math.max(...Object.values(r)) - Math.min(...Object.values(r)) <= 1 };
        });
    },
    // #8 one damage pipeline: eligibility per weapon, one death + one reward per target, rewards per kind
    async damagePipeline(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const { groundUnits, airUnits, enemies } = await import('./src/entities/registry.js');
            const { beginHits } = await import('./src/combat/hits.js');
            const { killGroundUnit } = await import('./src/entities/groundUnits.js');
            const frames = n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
            await frames(3); // updateAI marks ground units alive
            state.isPaused = true;
            const tanks = groundUnits.filter(u => u.userData.type === 'tank' && u.userData.hp > 0);
            const hangar = groundUnits.find(u => u.userData.type === 'hangar');
            const [tank, spareTank] = tanks, air = airUnits.find(a => a.hp > 0), fighter = enemies[0];
            const hangarHp = hangar.userData.hp, score0 = state.score;
            const blast = beginHits('missile');
            const hangarTookMissile = blast.damage(hangar, 50);
            blast.damage(tank, 9999); blast.damage(tank, 9999); // struck and splashed in the same blast
            blast.damage(air, 9999); blast.damage(fighter, 9999);
            const result = blast.finish();
            // streak multiplier ×1, ×2, ×3 for three kills within 5 s
            const expected = tank.userData.xpValue * 1 + air.xpValue * 2 + 25 * 3;
            const bomb = beginHits('bomb'); const hangarTookBomb = bomb.damage(hangar, 10); bomb.finish();
            const score1 = state.score;
            killGroundUnit(spareTank, { reward: false });
            return {
                kills: result.kills, scoreGained: score1 - score0, expected, hangarTookMissile, hangarTookBomb,
                removed: !groundUnits.includes(tank) && !airUnits.includes(air) && !enemies.includes(fighter),
                noRewardKill: state.score === score1 && !groundUnits.includes(spareTank),
                pass: result.kills === 3 && score1 - score0 === expected && !hangarTookMissile && hangarTookBomb && hangar.userData.hp === hangarHp - 10 && !groundUnits.includes(tank) && !airUnits.includes(air) && !enemies.includes(fighter) && state.score === score1,
            };
        });
    },
    // #20 entity contract: one HP/alive/position rule for every unit kind; missile + reticle share targeting
    async entityContract(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const { airUnits, enemies, baseMarkers } = await import('./src/entities/registry.js');
            const { entityKind, isAlive, missileTargets, nearestAlive } = await import('./src/entities/contract.js');
            const { beginHits } = await import('./src/combat/hits.js');
            const { plane } = await import('./src/player/plane.js');
            state.isPaused = true;
            const kinds = [...new Set([...missileTargets()].map(entityKind))].sort();
            const airBase = baseMarkers.find(bm => bm.units.length > 1 && bm.units.every(u => u.group) && bm.units.filter(isAlive).length > 1);
            const victim = airBase.units.find(isAlive);
            const aliveBefore = airBase.alive;
            const hits = beginHits('missile'); hits.damage(victim, 1e6); hits.finish();
            const fighter = enemies[0];
            plane.position.copy(fighter.parts[0].position).add(new THREE.Vector3(2, 0, 0));
            const nearest = nearestAlive(plane.position, missileTargets());
            return {
                kinds, aliveBefore, aliveAfter: airBase.alive, airHpOnlyOnUnit: airUnits.every(a => !('hp' in a.userData)),
                nearestIsFighter: nearest === fighter,
                pass: kinds.join() === 'air,fighter,ground' && airBase.alive === aliveBefore - 1 && airUnits.every(a => !('hp' in a.userData)) && nearest === fighter,
            };
        });
    },
    // #7 bounded sub-steps: the same flight gives the same result at 60, 20 and 10 fps
    async fixedStep(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const { simulate } = await import('./src/game/simulation.js');
            const { updatePhysics } = await import('./src/player/flight.js');
            const { plane } = await import('./src/player/plane.js');
            const { keys } = await import('./src/input.js');
            state.isPaused = true; // freeze the real loop; drive the simulation directly
            const start = { pos: plane.position.clone().setY(10), quat: plane.quaternion.clone() };
            const fly = (step, frames, stepFn) => {
                plane.position.copy(start.pos); plane.quaternion.copy(start.quat);
                Object.assign(state, { speed: 0.5, pitchRate: 0, rollRate: 0, yawRate: 0, _graceTimer: 1000 });
                state._mouseNDC.x = state._mouseNDC.y = 0;
                keys.w = keys.ArrowLeft = keys.a = true;
                for (let i = 0; i < frames; i++) stepFn(step);
                keys.w = keys.ArrowLeft = keys.a = false;
                return plane.position.clone();
            };
            const p60 = fly(1, 120, simulate), p20 = fly(3, 40, simulate), p10 = fly(6, 20, simulate);
            const unstepped10 = fly(6, 20, updatePhysics); // the old behaviour: one big integration per frame
            const r = v => +v.toFixed(4);
            return { at20: r(p20.distanceTo(p60)), at10: r(p10.distanceTo(p60)), unsteppedAt10: r(unstepped10.distanceTo(p60)), pass: p20.distanceTo(p60) < 1e-6 && p10.distanceTo(p60) < 1e-6 && !state.isGameOver };
        });
    },
    // #7 swept bullets hit a target crossed between two samples
    async sweptBullet(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const { enemies, bullets } = await import('./src/entities/registry.js');
            const { resolveCollisions } = await import('./src/combat/collision.js');
            const { scene } = await import('./src/core/scene.js');
            state.isPaused = true;
            const e = enemies[0];
            e.parts.forEach((p, i) => { p.position.set(1500 + i * 50, 100, 1500); p.userData.hp = 5; });
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.3), new THREE.MeshBasicMaterial());
            b.userData = { type: 'bullet', collisionRadius: 0.3, damage: 1 }; b.life = 100; b.velocity = new THREE.Vector3(10.8, 0, 0);
            b.prevPosition = new THREE.Vector3(1494.6, 100, 1500); b.position.set(1505.4, 100, 1500);
            scene.add(b); bullets.push(b);
            resolveCollisions();
            return { partHp: e.parts[0].userData.hp, bulletRemoved: !bullets.includes(b), pass: e.parts[0].userData.hp === 4 && !bullets.includes(b) };
        });
    },
    // #10 debug helpers are not recreated every frame and are released when toggled off
    async debugLeak(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const { scene } = await import('./src/core/scene.js');
            const Original = THREE.Box3Helper; let made = 0, disposed = 0;
            THREE.Box3Helper = class extends Original { constructor(...args) { super(...args); made++; this.geometry.addEventListener('dispose', () => disposed++); } };
            const frames = n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
            state.isPaused = true;
            state.debugCollision = true; await frames(3);
            const afterOn = made; await frames(30);
            const afterMore = made;
            state.debugCollision = false; await frames(3);
            let helpersLeft = 0; scene.traverse(o => { if (o.userData.debugHelper) helpersLeft++; });
            THREE.Box3Helper = Original;
            return { afterOn, afterMore, disposed, helpersLeft, pass: afterOn > 0 && afterMore === afterOn && helpersLeft === 0 && disposed === made };
        });
    },
    // #11 destroying one tank must not dispose geometry shared with other tanks
    async sharedGeometry(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const { groundUnits } = await import('./src/entities/registry.js');
            const { killGroundUnit } = await import('./src/entities/groundUnits.js');
            const { updateEffects } = await import('./src/effects/effects.js');
            state.isPaused = true;
            const tanks = groundUnits.filter(u => u.userData.type === 'tank');
            if (tanks.length < 2) return { pass: false, error: 'need two tanks' };
            const used = new Set(); tanks[1].traverse(c => { if (c.geometry) used.add(c.geometry); });
            const shared = []; tanks[0].traverse(c => { if (c.geometry && used.has(c.geometry) && !shared.includes(c.geometry)) shared.push(c.geometry); });
            let sharedDisposed = 0;
            shared.forEach(g => g.addEventListener('dispose', () => sharedDisposed++));
            tanks[0].userData._alive = true;
            killGroundUnit(tanks[0]);
            for (let i = 0; i < 80; i++) updateEffects(1);
            return { sharedGeometries: shared.length, sharedDisposed, removed: !tanks[0].parent, pass: shared.length > 0 && sharedDisposed === 0 && !tanks[0].parent };
        });
    },
    // #12 destroyed fence searchlights stop detecting; alarm colour fades back
    async searchlight(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { _searchlights, _damageFenceNear } = await import('./src/entities/fences.js');
            for (let i = 0; i < 100 && !_searchlights.some(sl => sl.range === 90); i++) await new Promise(r => setTimeout(r, 100));
            const towerLight = _searchlights.find(sl => sl.range === 90); // watchtower lights (airport lights use 140)
            if (!towerLight) return { pass: false, error: 'no fence searchlight' };
            _damageFenceNear(towerLight.worldPos, 2);
            const destroyed = { registered: _searchlights.includes(towerLight), intensity: towerLight.spot.intensity };
            const sl = _searchlights[0];
            sl.idleColor = sl.spot.color.clone(); sl.spot.color.setHex(0xff4400); sl.alarmed = true;
            await new Promise(r => setTimeout(r, 4000));
            const faded = { alarmed: sl.alarmed, color: sl.spot.color.getHexString(), idle: sl.idleColor.getHexString() };
            return { destroyed, faded, pass: !destroyed.registered && destroyed.intensity === 0 && !faded.alarmed && faded.color === faded.idle };
        });
    },
    // #16 light budget: few, constant lights in shaders; destroying searchlights never recompiles; nearest is lit
    async lightBudget(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const { scene, renderer } = await import('./src/core/scene.js');
            const { plane } = await import('./src/player/plane.js');
            const { _searchlights, _damageFenceNear } = await import('./src/entities/fences.js');
            const { LIGHT_BUDGET } = await import('./src/effects/lightBudget.js');
            const frames = n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
            for (let i = 0; i < 100 && _searchlights.filter(sl => sl.range === 90).length < 3; i++) await frames(2);
            state.isPaused = true;
            const lightsInShaders = () => { let n = 0; scene.traverseVisible(o => { if (o.isLight) n++; }); return n; };
            await frames(3);
            const before = { lights: lightsInShaders(), programs: renderer.info.programs.length };
            const towers = _searchlights.filter(sl => sl.range === 90).slice(0, 2);
            towers.forEach(sl => _damageFenceNear(sl.worldPos, 2));
            await frames(3);
            const after = { lights: lightsInShaders(), programs: renderer.info.programs.length };
            const target = _searchlights[0];
            plane.position.set(target.worldPos.x + 5, target.worldPos.y, target.worldPos.z + 5);
            await frames(2);
            let nearestLit = false;
            scene.traverseVisible(o => { if (o.isPointLight && o.intensity > 0 && o.position.distanceTo(target.worldPos) < 0.01) nearestLit = true; });
            return { budget: LIGHT_BUDGET, before, after, nearestLit, pass: before.lights <= LIGHT_BUDGET + 3 && after.lights === before.lights && after.programs === before.programs && nearestLit };
        });
    },
    // #15 colour-lines mode covers objects spawned while it is on and keeps no per-mesh state
    async colorMode(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { scene } = await import('./src/core/scene.js');
            const { _toggleColorMode, colorModeEnabled } = await import('./src/effects/colorMode.js');
            const existing = scene.children.find(o => o.isMesh);
            const originalMaterial = existing.material, originalBackground = scene.background;
            _toggleColorMode();
            const spawned = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
            scene.add(spawned);
            const on = { enabled: colorModeEnabled(), override: !!scene.overrideMaterial, existingUntouched: existing.material === originalMaterial };
            scene.remove(spawned);
            _toggleColorMode();
            const off = { enabled: colorModeEnabled(), override: !!scene.overrideMaterial, backgroundRestored: scene.background === originalBackground };
            return { on, off, pass: on.enabled && on.override && on.existingUntouched && !off.enabled && !off.override && off.backgroundRestored };
        });
    },
    // #13 islet meshes match their polygons (not mirrored) and face up
    async islets(page) {
        await worldReady(page);
        return page.evaluate(async () => {
            const { islets } = await import('./src/world/world.js');
            let worst = 0, facesUp = true;
            for (const isl of islets) {
                isl.mesh.updateMatrixWorld(true);
                const pos = isl.mesh.geometry.attributes.position, v = new THREE.Vector3(), pts = [];
                for (let i = 0; i < pos.count; i++) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(isl.mesh.matrixWorld).clone());
                for (const p of isl.polygon) worst = Math.max(worst, Math.min(...pts.map(q => Math.hypot(q.x - p.x, q.z - p.z))));
                facesUp = facesUp && new THREE.Vector3(0, 0, 1).applyQuaternion(isl.mesh.quaternion).y > 0.99;
            }
            return { islets: islets.length, worstVertexErr: +worst.toFixed(4), facesUp, pass: islets.length > 0 && worst < 0.01 && facesUp };
        });
    },
    // #17 denied storage must not break startup or game over
    storageDenied: Object.assign(async page => {
        await worldReady(page);
        return page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const { triggerGameOver } = await import('./src/game/gameOver.js');
            state.score = 1234;
            triggerGameOver();
            const shown = getComputedStyle(document.getElementById('game-over')).display;
            return { highScore: state._highScore, shown, pass: state.isGameOver && shown === 'block' && state._highScore === 1234 };
        });
    }, { init: () => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }) }),
    // #21 an enabled splash holds the simulation until dismissed
    async splash(page) {
        await worldReady(page);
        const during = await page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const splash = await import('./src/ui/splash.js');
            splash.runSplash();
            const t0 = state._gameElapsed;
            await new Promise(r => setTimeout(r, 800));
            return { active: splash.splashActive, held: state._gameElapsed === t0, heldAt: t0, overlay: !!document.getElementById('splash-screen') };
        });
        await page.keyboard.press('Escape'); // first input starts the type-out
        await page.keyboard.press('Escape'); // second dismisses it
        await wait(1200);
        const after = await page.evaluate(async () => {
            const { state } = await import('./src/state.js');
            const splash = await import('./src/ui/splash.js');
            // elapsed time vs. the held value (the random world may end the run soon after, which stops the clock)
            return { active: splash.splashActive, overlay: !!document.getElementById('splash-screen'), paused: state.isPaused, gameOver: state.isGameOver, elapsed: state._gameElapsed };
        });
        return { during, after, pass: during.active && during.held && during.overlay && !after.active && !after.overlay && !after.paused && after.elapsed > during.heldAt };
    },
};

const unknown = only.filter(name => !probes[name]);
if (unknown.length) { console.error(`Unknown probe(s): ${unknown.join(', ')}. Available: ${Object.keys(probes).join(', ')}`); process.exit(2); }

const server = await startServer(Number(process.env.PORT) || 0); // 0 = any free port
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
    executablePath: process.env.BROWSER_PATH || undefined,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let failed = 0;
try {
    for (const [name, probe] of Object.entries(probes)) {
        if (only.length && !only.includes(name)) continue;
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        if (probe.init) await page.addInitScript(probe.init);
        await page.goto(`${base}/index.html${probe.query ?? '?autostart'}`, { waitUntil: 'load' }); // most probes skip the start menu
        await page.waitForTimeout(1200);
        let result;
        try { result = await probe(page); } catch (e) { result = { error: e.message, pass: false }; }
        if (errors.length) { result.pageErrors = errors; result.pass = false; }
        if (!result.pass) failed++;
        console.log(`${result.pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(result)}`);
        await page.close();
    }
} finally {
    await browser.close();
    server.close();
}
process.exit(failed ? 1 : 0);
