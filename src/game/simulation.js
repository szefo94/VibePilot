/**
 * Gameplay simulation with bounded sub-steps.
 *
 * A frame's elapsed time (60 fps frame units, capped at 6 by main.js) is split into steps of at most
 * MAX_SIM_STEP, so flight, AI, collisions, projectiles and effects never integrate more than one 60 fps frame
 * at once. The same inputs give the same results at 60, 20 or 10 fps, and long frames can't skip collisions.
 * Frames shorter than a step run a single partial step, so high-refresh displays don't judder.
 */
import { TARGET_FPS } from '../config.js';
import { state } from '../state.js';
import * as perf from '../debug/perf.js';
import { updatePhysics } from '../player/flight.js';
import { updateAI } from '../ai.js';
import { resolveCollisions } from '../combat/collision.js';
import { updateProjectiles } from '../combat/projectiles.js';
import { updateEffects } from '../effects/effects.js';

export const MAX_SIM_STEP = 1; // one 60 fps frame

export function simulate(dt) {
    let remaining = dt;
    while (remaining > 1e-9 && !state.isGameOver) {
        const step = Math.min(MAX_SIM_STEP, remaining);
        remaining -= step;
        // Spawn protection is simulation state in seconds; steps are in 60 fps frame units
        if (state._graceTimer > 0) state._graceTimer = Math.max(0, state._graceTimer - step / TARGET_FPS);
        perf.begin('physics'); updatePhysics(step); perf.end('physics');
        perf.begin('ai'); updateAI(step); perf.end('ai');
        perf.begin('collisions'); resolveCollisions(); perf.end('collisions');
        perf.begin('projectiles'); updateProjectiles(step); perf.end('projectiles');
        perf.begin('effects'); updateEffects(step); perf.end('effects'); // ideas 1-6, 10
    }
}
