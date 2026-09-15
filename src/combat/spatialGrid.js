/** Uniform spatial hash grid for broad-phase bullet collision. */
import { airUnits, groundUnits } from '../entities/registry.js';
import { groundUnitWorldPos } from './damage.js';

// --- Spatial Grid for bullet collision (§2.3) ---
const _GRID_CELL = 120;
const _grid = new Map();
export function _gridBuild() {
    _grid.clear();
    const add = (obj, pos) => {
        const k = `${Math.floor(pos.x / _GRID_CELL)},${Math.floor(pos.z / _GRID_CELL)}`;
        if (!_grid.has(k)) _grid.set(k, []);
        _grid.get(k).push(obj);
    };
    groundUnits.forEach(u => { if (u.userData.hp > 0) add(u, groundUnitWorldPos(u)); });
    airUnits.forEach(au => { if (au.hp > 0) add(au, au.group.position); });
}
export function _gridQuery(x, z, r) {
    const cr = Math.ceil(r / _GRID_CELL), cx = Math.floor(x / _GRID_CELL), cz = Math.floor(z / _GRID_CELL);
    const out = [];
    for (let dx = -cr; dx <= cr; dx++) {
        for (let dz = -cr; dz <= cr; dz++) {
            const cell = _grid.get(`${cx + dx},${cz + dz}`);
            if (cell) out.push(...cell);
        }
    }
    return out;
}
