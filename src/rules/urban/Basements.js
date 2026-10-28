/**
 * Basements - the p66 Basements Table.
 *
 * A building hex may have a basement. The roll happens once per hex per
 * scenario, the first time a Mech enters it at Level 0.
 */

const TABLE = [
  { roll: 2, kind: 'double', depth: 2 },
  { roll: 3, kind: 'basement', depth: 1 },
  { roll: 4, kind: 'basement', depth: 1 },
  { roll: 5, kind: 'none', depth: 0 },
  { roll: 6, kind: 'none', depth: 0 },
  { roll: 7, kind: 'none', depth: 0 },
  { roll: 8, kind: 'none', depth: 0 },
  { roll: 9, kind: 'small', depth: 0 },
  { roll: 10, kind: 'basement', depth: 1 },
  { roll: 11, kind: 'basement', depth: 1 },
  { roll: 12, kind: 'double', depth: 2 }
];

/** Basements Table lookup. */
export function basementForRoll(roll) {
  if (!Number.isFinite(roll) || roll < 2 || roll > 12) return { roll, kind: 'none', depth: 0 };
  const entry = TABLE.find(row => row.roll === roll);
  return { roll, kind: entry.kind, depth: entry.depth };
}

/** Roll the basement for a hex. */
export function rollBasement(diceRoller) {
  return basementForRoll(diceRoller.roll2d6());
}

/**
 * Falling damage from dropping into a basement (p57): tonnage / 10, multiplied
 * by the levels fallen plus one.
 */
export function basementFallDamage(unit, depth) {
  const levels = Math.max(1, depth || 0);
  return Math.ceil((unit.tonnage || 0) / 10) * (levels + 1);
}

/**
 * Damage a collapsing basement floor does to the building hex (p66):
 * tonnage / 10, doubled for a two-level basement.
 */
export function basementCollapseDamage(unit, depth) {
  const base = Math.ceil((unit.tonnage || 0) / 10);
  return depth >= 2 ? base * 2 : base;
}
