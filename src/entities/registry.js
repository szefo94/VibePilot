/** Live entity and projectile collections shared across systems. */
// Entities
export const bullets = [], bombs = [], missiles = [], missileTrailParticles = [], napalmBombs = [], napalmPatches = [], napalmFireParticles = [], flareParticles = [], enemyBullets = [], activeExplosions = []; // §4.5
export const enemies = [], groundUnits = [], airUnits = [];
export const obstacles = [], markers = [], collectibles = [];
export const baseMarkers = [], basesById = {};
export const _fenceRegistry = {}; // baseId → { posts:[{mesh,worldPos,tiltApplied}], bmRef }
export const _flagMeshes = [];    // { mesh, pivot: Vector3 }
