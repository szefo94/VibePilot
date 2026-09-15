/** Shared damage rules for ground units: weapon eligibility and world-space position. */

/**
 * World-space position of a ground unit. Airport turrets are parented to their airport, so their
 * `.position` is local — always use this for targeting, range, collision and splash checks.
 * Cached on `userData.worldPos` and refreshed every frame by updateAI.
 */
export function groundUnitWorldPos(u) {
    return u.userData.worldPos || refreshGroundUnitWorldPos(u);
}
export function refreshGroundUnitWorldPos(u) {
    if (!u.userData.worldPos) u.userData.worldPos = new THREE.Vector3();
    return u.getWorldPosition(u.userData.worldPos);
}

/**
 * Whether `weapon` ('bullet' | 'bomb' | 'missile' | 'napalm') can damage ground unit `gu` right now:
 * dead units take no damage, units with a living protector (airport turrets) are immune, and
 * bomb-only units (hangars) ignore every weapon except bombs.
 */
export function canDamageGround(gu, weapon) {
    const ud = gu.userData;
    if (!(ud.hp > 0)) return false;
    if (ud.protector && ud.protector.userData.hp > 0) return false;
    if (ud.bombOnly && weapon !== 'bomb') return false;
    return true;
}
