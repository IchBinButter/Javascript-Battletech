/**
 * Visibility and state projection.
 *
 * The rules engine is shared by both players. Anything that leaves the engine
 * for a player - a UI refresh, a network patch, a replay - goes through
 * projectStateForPlayer, so hidden units never leak. Solo play passes the
 * whole state because there is nothing to hide.
 */

/** Can `viewerId` see `targetId`? (p82) */
export function canSee(viewerId, targetId, state) {
  if (!state || !state.units) return false;
  const target = state.units[targetId];
  if (!target) return false;
  if (target.player === viewerId) return true;

  const hidden = state.hiddenUnits && state.hiddenUnits[targetId];
  return !(hidden && hidden.hidden);
}

/**
 * A view of the state with everything this player must not know removed.
 * Keeps the GameState prototype so the UI can still call its helpers.
 */
export function projectStateForPlayer(state, viewerId) {
  if (!state) return state;

  const units = {};
  for (const [id, unit] of Object.entries(state.units)) {
    if (canSee(viewerId, id, state)) units[id] = unit;
  }

  const view = Object.create(Object.getPrototypeOf(state));
  Object.assign(view, state, { units, hiddenUnits: {} });
  return view;
}

/** Convenience: is this unit visible to this player? */
export function isVisibleUnit(state, viewerId, unitId) {
  return canSee(viewerId, unitId, state);
}
