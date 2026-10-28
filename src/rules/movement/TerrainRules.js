/**
 * Terrain modifications (BMM p61, Movement Costs Table p136).
 *
 * Ice, mud and deep snow add a Piloting Skill Roll modifier on top of their MP
 * cost; swamp does too. The values live in terrain.json so the rules and the
 * data stay in one place.
 */

import terrainData from '../../data/terrain.json' with { type: 'json' };

/** Which terrain modifications apply to a hex? */
export function terrainModifiersForHex(hex) {
  if (!hex) return { ice: false, mud: false, deepSnow: false, swamp: false };

  const modifiers = hex.modifiers || {};
  return {
    ice: Boolean(modifiers.ice),
    mud: Boolean(modifiers.mud),
    deepSnow: Boolean(modifiers.deepSnow),
    // Swamp is a terrain type in this code base, not a flag.
    swamp: hex.terrainType === 'swamp'
  };
}

/**
 * PSR modifier for standing in or entering a hex with a terrain modification.
 * @returns {{ modifier: number, reasons: string[] }}
 */
export function terrainPSRModifier(hex) {
  const flags = terrainModifiersForHex(hex);
  const reasons = [];
  let modifier = 0;

  const data = terrainData.modifiers || {};
  const apply = (flag, key, label) => {
    if (!flag) return;
    const value = (data[key] && data[key].psrModifier) || 0;
    if (value !== 0) {
      modifier += value;
      reasons.push(`${label}: +${value}`);
    } else {
      reasons.push(`${label}: +0`);
    }
  };

  apply(flags.ice, 'ice', 'Ice');
  apply(flags.mud, 'mud', 'Mud');
  apply(flags.deepSnow, 'deep_snow', 'Deep Snow');

  if (flags.swamp) {
    // Movement Costs Table, p136: swamp +1.
    modifier += 1;
    reasons.push('Swamp: +1');
  }

  return { modifier, reasons, flags };
}

/** Does this hex need a PSR to enter? */
export function requiresTerrainPSR(hex) {
  const flags = terrainModifiersForHex(hex);
  return flags.ice || flags.mud || flags.deepSnow || flags.swamp;
}
