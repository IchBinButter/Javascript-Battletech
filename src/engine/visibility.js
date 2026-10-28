/**
 * Visibility, state projection and hidden-unit reveals.
 *
 * The rules engine is shared by both players. Anything that leaves the engine
 * for a player - a UI refresh, a network patch, a replay - goes through
 * projectStateForPlayer, so hidden units never leak. Solo play passes the
 * whole state because there is nothing to hide.
 *
 * Hidden units (p82) stay hidden until they give themselves away. The trigger
 * list modelled here: a hidden 'Mech is revealed when it fires, when its own
 * move begins, when an enemy ends its move in a hex adjacent to it, when an
 * enemy moves into or ends next to a building hex it is hiding in, or when an
 * enemy is ordered into its hex. The p82 "Hidden 'Mechs" text is in the project
 * KB (chunk 42, BMM p82); these helpers encode the movement/fire triggers the
 * engine owns, not a paraphrase of the whole section.
 */

import { hexNeighbors } from '../hex/HexMath.js';

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
 *
 * Hidden-information fields beyond the units are filtered too: scheduled
 * battlefield support strikes are secret until they resolve (pre-designated
 * artillery hexes are written down secretly, p.77) and minefield positions
 * are hidden from the opponent (p.79).  The public battlefield state - fire,
 * smoke, buildings, weather - stays in the view unchanged.
 *
 * The view is shallow: its units are the live Unit instances. That is fine for
 * rendering, but a server must serialize the view before keeping it as the
 * "last sent" snapshot - otherwise the hidden state mutates the snapshot too
 * and every later diff looks empty.
 */
export function projectStateForPlayer(state, viewerId) {
  if (!state) return state;

  const units = {};
  for (const [id, unit] of Object.entries(state.units)) {
    if (canSee(viewerId, id, state)) units[id] = unit;
  }

  const view = Object.create(Object.getPrototypeOf(state));
  Object.assign(view, state, {
    units,
    hiddenUnits: {},
    battlefieldSupport: projectBattlefieldSupport(state.battlefieldSupport, viewerId),
    minefields: projectMinefields(state.minefields, viewerId)
  });
  return view;
}

/** Does a record carry this viewer's id? Numeric and string ids both work. */
function ownedByViewer(record, viewerId) {
  if (!record || record.owner === undefined || record.owner === null) return false;
  return String(record.owner) === String(viewerId);
}

/**
 * Scheduled strikes are secret: keep points/selections, but only the strikes
 * this viewer owns.  An ownerless record is unowned and hidden from every
 * viewer, exactly like an ownerless minefield; `scheduleSupportStrike` assigns
 * the acting player as owner, so the public API cannot create one.
 */
function projectBattlefieldSupport(support, viewerId) {
  if (!support || typeof support !== 'object') return support;

  const strikes = Array.isArray(support.strikes) ? support.strikes : [];
  const projected = {
    ...support,
    strikes: strikes
      .filter(strike => ownedByViewer(strike, viewerId))
      .map(strike => ({ ...strike }))
  };

  // Do not hand the caller the source array to mutate.
  if (Array.isArray(support.selections)) projected.selections = [...support.selections];
  return projected;
}

/**
 * Minefield hexes are placed secretly and are hidden from the opponent (p.79).
 * `Minefields.createMinefield` records an optional `owner`, so filter by it.
 * A field with no owner cannot be attributed to a player and is therefore
 * omitted from every projection rather than leaking to both sides; scenario
 * setup should pass `{ owner }` when placing fields.
 */
function projectMinefields(minefields, viewerId) {
  if (!minefields || typeof minefields !== 'object') return minefields;

  const projected = {};
  for (const [hexKey, field] of Object.entries(minefields)) {
    if (!ownedByViewer(field, viewerId)) continue;
    projected[hexKey] = { ...field };
  }
  return projected;
}


/** Convenience: is this unit visible to this player? */
export function isVisibleUnit(state, viewerId, unitId) {
  return canSee(viewerId, unitId, state);
}

/** The hidden-state entry for `unitId`, but only while it is actually hidden. */
function hiddenEntry(state, unitId) {
  if (!state || !state.hiddenUnits) return null;
  const entry = state.hiddenUnits[unitId];
  return entry && entry.hidden ? entry : null;
}

/**
 * Reveal a hidden unit, whatever gave it away (p82): firing, starting its own
 * move, being adjacent to an enemy that ended its move, being run into, a
 * minefield or an area-effect attack.  Mutates only the hidden flag, so the
 * state stays plain JSON.
 *
 * @param {object} state - the live GameState
 * @param {string} unitId - the unit to reveal
 * @returns {boolean} true when this call actually revealed the unit
 */
export function revealUnit(state, unitId) {
  const entry = hiddenEntry(state, unitId);
  if (!entry) return false;

  entry.hidden = false;
  return true;
}

/** Has this unit fired this turn? `firedThisTurn` is a Set live and an array
 *  after a JSON round-trip, so accept both. */
function hasFired(unit) {
  const fired = unit && unit.firedThisTurn;
  if (fired instanceof Set) return fired.size > 0;
  if (Array.isArray(fired)) return fired.length > 0;
  return false;
}

/**
 * Reveal a hidden unit because it fired (p82).
 *
 * The trigger is "has this unit fired this turn": GameEngine records each
 * declaration in `unit.firedThisTurn`, so a caller that has just resolved a
 * shot only has to call `revealOnFire(state, attackerId)`.
 *
 * Mutates `state.hiddenUnits[unitId].hidden` and nothing else; the state stays
 * plain JSON (no Sets, no DOM objects are introduced).
 *
 * @param {object} state - the live GameState
 * @param {string} unitId - the unit that may have given itself away
 * @returns {boolean} true when this call actually revealed the unit
 */
export function revealOnFire(state, unitId) {
  const entry = hiddenEntry(state, unitId);
  if (!entry) return false;

  const unit = state.units && state.units[unitId];
  if (!unit || !hasFired(unit)) return false;

  return revealUnit(state, unitId);
}

/**
 * Reveal a hidden unit because its own move is beginning (p82).
 *
 * A hidden 'Mech is revealed as soon as it starts to move - the opponent learns
 * where it was, not just where it ends up. Call this before the unit's position
 * changes so the reveal lands in the same state change as the move.
 *
 * @param {object} state - the live GameState
 * @param {string} unitId - the unit whose move begins
 * @returns {boolean} true when this call actually revealed the unit
 */
export function revealOnMove(state, unitId) {
  return revealUnit(state, unitId);
}

/**
 * Reveal hidden enemies standing next to the hex where `moverId` ended its move
 * (p82). This is the "visible 'Mech walks up to a hidden one" direction: the
 * mover is not revealed by adjacency - only the hidden defender is. A hidden
 * mover is handled separately by revealOnMove, which fires at the start of its
 * move.
 *
 * Friendly units never reveal anything, and a hidden enemy adjacent to the
 * mover counts even if that enemy is itself hidden (two 'Mechs in neighbouring
 * hexes know about each other).
 *
 * `excludeHexes` carries the hexes a jump passed over: p82 says jumping over a
 * hidden 'Mech does not reveal it, even though such a hex can be adjacent to
 * the landing hex.
 *
 * @param {object} state - the live GameState
 * @param {string} moverId - the unit that just finished moving
 * @param {{excludeHexes?: Set<string>|null}} [options]
 * @returns {string[]} ids of the hidden units this call revealed, if any
 */
export function revealOnAdjacentMove(state, moverId, { excludeHexes = null } = {}) {
  if (!state || !state.units) return [];

  const mover = state.units[moverId];
  const hexKey = mover && mover.position && mover.position.hexKey;
  if (!hexKey) return [];

  const neighbours = new Set(hexNeighbors(hexKey));
  const revealed = [];

  for (const [id, other] of Object.entries(state.units)) {
    if (id === moverId || !other || !other.position) continue;
    if (other.player === mover.player) continue;
    if (!neighbours.has(other.position.hexKey)) continue;
    if (excludeHexes && excludeHexes.has(other.position.hexKey)) continue;
    if (revealUnit(state, id)) revealed.push(id);
  }

  return revealed;
}

/** The Hex on the map for `hexKey`, whether the map stores a Map or an object. */
function hexAt(state, hexKey) {
  const hexes = state && state.map && state.map.hexes;
  if (!hexes) return null;
  return hexes instanceof Map ? (hexes.get(hexKey) || null) : (hexes[hexKey] || null);
}

/** An identity for the building `hex` belongs to, or null for a bare hex. */
function buildingIdOf(hex, hexKey) {
  const building = hex && hex.building;
  if (!building) return null;
  return building.id !== undefined && building.id !== null ? building.id : `hex:${hexKey}`;
}

/**
 * Reveal hidden enemies inside every building the mover moved into or ended
 * next to (p82 Buildings): "A 'Mech that moves into or ends its move adjacent
 * to a building hex reveals every hidden enemy 'Mech in that building,
 * regardless of the level a hidden 'Mech is on."
 *
 * This engine has no unit elevation, so every hidden enemy in the building's
 * hexes is revealed; the multi-hex building identity comes from the `id` that
 * BuildingRegistry writes onto `hex.building`.
 *
 * `excludeHexes` again holds hexes a jump passed over (jumping over a hex does
 * not reveal the 'Mechs in it).
 *
 * @param {object} state - the live GameState
 * @param {string} moverId - the unit that just finished moving
 * @param {{excludeHexes?: Set<string>|null}} [options]
 * @returns {string[]} ids of the hidden units this call revealed, if any
 */
export function revealInBuildings(state, moverId, { excludeHexes = null } = {}) {
  if (!state || !state.units) return [];

  const mover = state.units[moverId];
  const hexKey = mover && mover.position && mover.position.hexKey;
  if (!hexKey) return [];

  const buildingIds = new Set();

  // "Moves into": the hex it stopped in may itself be a building hex.
  const landingBuilding = buildingIdOf(hexAt(state, hexKey), hexKey);
  if (landingBuilding !== null) buildingIds.add(landingBuilding);

  // "Ends its move adjacent to": a building hex next door.
  for (const neighbour of hexNeighbors(hexKey)) {
    if (excludeHexes && excludeHexes.has(neighbour)) continue;
    const buildingId = buildingIdOf(hexAt(state, neighbour), neighbour);
    if (buildingId !== null) buildingIds.add(buildingId);
  }

  if (buildingIds.size === 0) return [];

  const revealed = [];
  for (const [id, other] of Object.entries(state.units)) {
    if (id === moverId || !other || !other.position) continue;
    if (other.player === mover.player) continue;
    if (excludeHexes && excludeHexes.has(other.position.hexKey)) continue;

    const otherHexKey = other.position.hexKey;
    const otherBuilding = buildingIdOf(hexAt(state, otherHexKey), otherHexKey);
    if (otherBuilding === null || !buildingIds.has(otherBuilding)) continue;

    if (revealUnit(state, id)) revealed.push(id);
  }

  return revealed;
}

/**
 * The id of the hidden enemy of `mover` standing in `hexKey`, or null.
 *
 * p82: a 'Mech ordered into a hex containing a hidden enemy 'Mech stops in the
 * adjacent hex and reveals it, instead of entering the hex. GameEngine applies
 * this to ground movement and truncates the move at the first blocked hex; a
 * jumping 'Mech ignores the rule and lands in the hex (p82 Jumping).
 *
 * @param {object} state - the live GameState
 * @param {string} hexKey - the hex the mover is trying to enter
 * @param {object} mover - the moving unit
 * @returns {string|null} the hidden enemy's unit id
 */
export function hiddenEnemyAt(state, hexKey, mover) {
  if (!state || !state.units || !mover || !hexKey) return null;

  for (const [id, unit] of Object.entries(state.units)) {
    if (id === mover.id || !unit || !unit.position) continue;
    if (unit.player === mover.player) continue;
    if (unit.position.hexKey !== hexKey) continue;

    const entry = state.hiddenUnits && state.hiddenUnits[id];
    if (entry && entry.hidden) return id;
  }

  return null;
}
