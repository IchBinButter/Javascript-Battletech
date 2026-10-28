/**
 * Battlefield Support - scheduled aerospace and artillery strikes (BMM p.75-79).
 *
 * The Battlefield Support Table (p.78/146) is kept as data: the Target Number,
 * the number of Damage Value groupings and whether a miss scatters.  A Damage
 * Value grouping is five points of damage (table footnote **), so a Heavy
 * Bombing strike rolls six separate 5-point groups, each with its own hit
 * location roll.  Artillery lists one number per blast radius (target hex,
 * adjacent hexes, two hexes out), so its groupings are stored as an array.
 *
 * This is the minimal scheduled-strike primitive:
 *
 *   state.battlefieldSupport.strikes = [
 *     { hexKey: '5,5', turn: 3, type: 'light_strike', owner: 0 }
 *   ]
 *
 * Booking spends the type's Battlefield Support Point cost from
 * `state.battlefieldSupport.points` (p.75) and records the acting player as
 * owner by default.  An ownerless record is treated as unowned by the
 * projector, so it is hidden from every viewer.
 *
 * A strike resolves when the End Phase of its turn is entered and then
 * expires, whatever the result.  Defensive air cover, pre-plotted artillery
 * hexes, spotters, TAG/Copperhead homing and strafing's five-hex line are out
 * of scope; a strafing run is resolved against its single scheduled hex.
 */

import hitTables from '../../data/hitTables.json' with { type: 'json' };
import { getNeighborInDirection, hexNeighbors } from '../../hex/HexMath.js';

/** Points of damage in one Damage Value grouping (Battlefield Support table, p.78). */
export const DAMAGE_PER_GROUPING = 5;

/**
 * Battlefield Support Table (p.78/146).
 *
 * `damageGroupings` is the number of five-point groupings applied to the
 * target hex, or - for artillery - an array giving the number of groupings
 * for the target hex and each successive ring of adjacent hexes.
 */
export const BATTLEFIELD_SUPPORT_TABLE = {
  light_strike: {
    name: 'Light Strike', category: 'aerospace', targetNumber: 5,
    damageGroupings: 2, weaponType: 'N/A', bspCost: 2, scatters: false
  },
  light_bombing: {
    name: 'Light Bombing', category: 'aerospace', targetNumber: 5,
    damageGroupings: 3, weaponType: 'AE', bspCost: 3, scatters: true
  },
  heavy_strike: {
    name: 'Heavy Strike', category: 'aerospace', targetNumber: 6,
    damageGroupings: 4, weaponType: 'N/A', bspCost: 3, scatters: false
  },
  heavy_bombing: {
    name: 'Heavy Bombing', category: 'aerospace', targetNumber: 7,
    damageGroupings: 6, weaponType: 'AE', bspCost: 4, scatters: true
  },
  strafing: {
    name: 'Strafing', category: 'aerospace', targetNumber: 7,
    damageGroupings: 3, weaponType: 'DE', bspCost: 5, scatters: false
  },
  thumper: {
    name: 'Thumper', category: 'artillery', targetNumber: 8,
    damageGroupings: [3, 1], weaponType: 'AE', bspCost: 3, scatters: true
  },
  sniper: {
    name: 'Sniper', category: 'artillery', targetNumber: 8,
    damageGroupings: [4, 2], weaponType: 'AE', bspCost: 4, scatters: true
  },
  long_tom: {
    name: 'Long Tom', category: 'artillery', targetNumber: 8,
    damageGroupings: [5, 3, 1], weaponType: 'AE', bspCost: 6, scatters: true
  },
  light_density: {
    name: 'Light Density', category: 'minefield', targetNumber: 9,
    damageGroupings: 2, weaponType: 'AE', bspCost: 0.5, scatters: false
  },
  medium_density: {
    name: 'Medium Density', category: 'minefield', targetNumber: 8,
    damageGroupings: 4, weaponType: 'AE', bspCost: 2, scatters: false
  },
  heavy_density: {
    name: 'Heavy Density', category: 'minefield', targetNumber: 7,
    damageGroupings: 6, weaponType: 'AE', bspCost: 4, scatters: false
  }
};

/** Compact spellings accepted in scenario data ("HeavyBombing", "long-tom"). */
const COMPACT_ALIASES = {
  lightstrike: 'light_strike',
  lightbombing: 'light_bombing',
  heavystrike: 'heavy_strike',
  heavybombing: 'heavy_bombing',
  strafing: 'strafing',
  thumper: 'thumper',
  sniper: 'sniper',
  longtom: 'long_tom',
  lightdensity: 'light_density',
  mediumdensity: 'medium_density',
  heavydensity: 'heavy_density'
};

/** Canonical table key for a support type, or null when it is unknown. */
export function normalizeSupportType(type) {
  if (typeof type !== 'string') return null;

  const key = type.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (Object.prototype.hasOwnProperty.call(BATTLEFIELD_SUPPORT_TABLE, key)) {
    return key;
  }

  const compact = key.replace(/_/g, '');
  return Object.prototype.hasOwnProperty.call(COMPACT_ALIASES, compact)
    ? COMPACT_ALIASES[compact]
    : null;
}

/** Table row for a support type (with its canonical key), or null. */
export function supportTypeData(type) {
  const key = normalizeSupportType(type);
  if (!key) return null;
  return { key, ...BATTLEFIELD_SUPPORT_TABLE[key] };
}

/**
 * Scatter Diagram order (p.77), mapped onto the engine's facing order:
 * 0 = N, 1 = NE, 2 = SE, 3 = S, 4 = SW, 5 = NW.
 *
 * Assumption (not verified against the project KB): the KB page set does not
 * include the p.77 artillery body or its Scatter Diagram, so this roll-to-
 * direction mapping is encoded here rather than quoted from the manual.
 */
export const SCATTER_DIRECTIONS = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];

/**
 * Destination of a scattershot: a 1D6 direction roll, then one hex per point
 * of Margin of Failure (p.76-77).
 */
export function scatterDestination(hexKey, directionRoll, distance) {
  const directionIndex = ((Math.trunc(directionRoll) - 1) % 6 + 6) % 6;
  let target = hexKey;
  for (let step = 0; step < Math.max(0, Math.trunc(distance) || 0); step++) {
    target = getNeighborInDirection(target, directionIndex);
  }
  return target;
}

/** The live strike queue, without creating one. */
export function scheduledStrikes(state) {
  const support = state && state.battlefieldSupport;
  return support && Array.isArray(support.strikes) ? support.strikes : [];
}

function ensureSupportState(state) {
  if (!state.battlefieldSupport || typeof state.battlefieldSupport !== 'object') {
    state.battlefieldSupport = { points: 0, selections: [] };
  }
  if (!Array.isArray(state.battlefieldSupport.strikes)) {
    state.battlefieldSupport.strikes = [];
  }
  return state.battlefieldSupport;
}

/**
 * Book a strike for a later End Phase.  The record is plain JSON data.
 *
 * Booking spends the support type's BSP cost from
 * `state.battlefieldSupport.points` (p.75) and records the acting player as
 * the owner by default (`schedule.owner`, else `state.currentPlayer`), so the
 * public API cannot create an ownerless strike.  An insufficient point pool
 * throws before anything is recorded.
 *
 * @param {object} state - GameState
 * @param {{hexKey: string, turn?: number, type: string, owner?: number|string}} schedule
 * @returns {{hexKey: string, turn: number, type: string, owner: number|string}}
 */
export function scheduleSupportStrike(state, schedule = {}) {
  if (!state) throw new Error('scheduleSupportStrike needs a game state');

  const type = normalizeSupportType(schedule.type);
  if (!type) throw new Error(`Unknown Battlefield Support type: ${schedule.type}`);

  const def = BATTLEFIELD_SUPPORT_TABLE[type];
  if (def.category === 'minefield') {
    throw new Error('Minefields are placed before deployment; they are not scheduled strikes');
  }
  if (typeof schedule.hexKey !== 'string' || schedule.hexKey.length === 0) {
    throw new Error('A scheduled strike needs a target hexKey');
  }

  const turn = schedule.turn === undefined ? state.turn : Number(schedule.turn);
  if (!Number.isInteger(turn) || turn < 1) {
    throw new Error(`Invalid strike turn: ${schedule.turn}`);
  }

  // Owner defaults to the acting player, so no new ownerless strikes can be
  // created through this API; a null/undefined owner is otherwise treated as
  // unowned by the projector.
  const owner = schedule.owner === undefined || schedule.owner === null
    ? state.currentPlayer
    : schedule.owner;
  if (owner === undefined || owner === null) {
    throw new Error('A scheduled strike needs an owner (no acting player)');
  }

  const support = ensureSupportState(state);
  const points = Number(support.points);
  const availablePoints = Number.isFinite(points) ? points : 0;
  const cost = Number(def.bspCost) || 0;
  if (availablePoints < cost) {
    throw new Error(
      `Not enough Battlefield Support Points for ${def.name}: ` +
      `${availablePoints} available, ${cost} needed`
    );
  }

  const record = { hexKey: schedule.hexKey, turn, type, owner };
  support.points = availablePoints - cost;
  support.strikes.push(record);
  return record;
}

/** Strikes whose turn has arrived (a missed End Phase does not strand them). */
export function dueSupportStrikes(state) {
  const turn = Number(state && state.turn) || 1;
  return scheduledStrikes(state).filter(strike => Number(strike.turn) <= turn);
}

/** Remove one resolved strike from the queue. */
export function expireSupportStrike(state, strike) {
  const strikes = ensureSupportState(state).strikes;
  const index = strikes.indexOf(strike);
  if (index >= 0) strikes.splice(index, 1);
  return strikes;
}

function normalizeUnits(units) {
  if (!Array.isArray(units)) return [];

  const list = [];
  for (const unit of units) {
    if (!unit) continue;
    const id = unit.id ?? unit.unitId;
    const hexKey = unit.hexKey ?? (unit.position && unit.position.hexKey);
    if (!id || typeof hexKey !== 'string') continue;
    list.push({ id, hexKey });
  }
  return list;
}

/** Number of groupings in each blast ring, e.g. 2 -> [2], [3, 1] -> [3, 1]. */
function groupingBands(def) {
  return Array.isArray(def.damageGroupings) ? def.damageGroupings : [def.damageGroupings];
}

/** All hexes exactly `radius` hexes from the centre (radius 0 is the centre). */
function hexesAtDistance(centre, radius) {
  if (radius <= 0) return [centre];

  let frontier = [centre];
  const seen = new Set([centre]);
  for (let step = 0; step < radius; step++) {
    const next = [];
    for (const key of frontier) {
      for (const neighbour of hexNeighbors(key)) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return frontier;
}

/**
 * Apply every grouping of an attack to every unit in range.  Each grouping
 * gets its own hit location roll (Successful Attack, p.75-77).
 */
function collectHits({ hexKey, bands, units, diceRoller, isRear, automatic = false }) {
  const hits = [];
  const table = hitTables.hitLocation[isRear ? 'rear' : 'front'] || hitTables.hitLocation.front;

  for (let radius = 0; radius < bands.length; radius++) {
    const groupings = Math.max(0, Math.trunc(bands[radius]) || 0);
    if (groupings === 0) continue;

    for (const ringHex of hexesAtDistance(hexKey, radius)) {
      for (const unit of units) {
        if (unit.hexKey !== ringHex) continue;

        for (let group = 0; group < groupings; group++) {
          const locationRoll = diceRoller.roll2d6();
          const entry = table[String(locationRoll)] || table['7'];
          hits.push({
            unitId: unit.id,
            hexKey: ringHex,
            location: entry.location,
            isRear,
            damage: DAMAGE_PER_GROUPING,
            roll: locationRoll,
            radius,
            automatic
          });
        }
      }
    }
  }

  return hits;
}

/**
 * Resolve one scheduled strike without touching the game state.
 *
 * A successful attack rolls 1D6 for attack direction (1-4 front, 5-6 rear,
 * p.75), then a hit location for each grouping.  A miss on a scattering type
 * walks one hex per point of Margin of Failure in the Scatter Diagram
 * direction and automatically attacks whatever is there; a miss on a strike
 * that does not scatter has no effect (p.76-77).
 *
 * @param {object} strike - { hexKey, turn, type }
 * @param {{diceRoller: object, units?: Array}} context
 * @returns {object} plain-data resolution
 */
export function resolveSupportStrike(strike, context = {}) {
  const { diceRoller } = context;
  if (!diceRoller || typeof diceRoller.roll2d6 !== 'function') {
    throw new Error('resolveSupportStrike needs a dice roller');
  }

  const def = supportTypeData(strike && strike.type);
  if (!def) throw new Error(`Unknown Battlefield Support type: ${strike && strike.type}`);

  const units = normalizeUnits(context.units);
  const bands = groupingBands(def);
  const targetNumber = def.targetNumber;
  const roll = diceRoller.roll2d6();

  const resolution = {
    type: def.key,
    name: def.name,
    category: def.category,
    weaponType: def.weaponType,
    hexKey: strike.hexKey,
    turn: strike.turn,
    targetNumber,
    roll,
    success: roll >= targetNumber,
    damageGroupings: def.damageGroupings,
    groupingDamage: DAMAGE_PER_GROUPING,
    attackDirection: null,
    attackDirectionRoll: null,
    hits: [],
    scatter: null
  };

  if (resolution.success) {
    const directionRoll = diceRoller.roll1d6();
    const isRear = directionRoll >= 5;
    resolution.attackDirectionRoll = directionRoll;
    resolution.attackDirection = isRear ? 'rear' : 'front';
    resolution.hits = collectHits({
      hexKey: strike.hexKey, bands, units, diceRoller, isRear
    });
    return resolution;
  }

  // A strike that does not scatter simply misses (p.76: "Unsuccessful Attack: No effect").
  if (!def.scatters) return resolution;

  const marginOfFailure = targetNumber - roll;
  const directionRoll = diceRoller.roll1d6();
  const scatteredHex = scatterDestination(strike.hexKey, directionRoll, marginOfFailure);

  resolution.scatter = {
    marginOfFailure,
    directionRoll,
    direction: SCATTER_DIRECTIONS[((directionRoll - 1) % 6 + 6) % 6],
    hexKey: scatteredHex
  };
  // The scattered attack hits whatever is there automatically.  The manual
  // derives its attack direction from the original target hex; the simplified
  // primitive resolves those hit locations on the front column.
  resolution.hits = collectHits({
    hexKey: scatteredHex, bands, units, diceRoller, isRear: false, automatic: true
  });

  return resolution;
}
