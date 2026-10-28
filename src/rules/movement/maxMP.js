/**
 * maxMP - the single function that decides how much MP a unit has.
 *
 * Movement validation, the unit's currentMP getter and the UI all call this,
 * so heat penalties, MASC and TSM can never disagree with each other.
 */

import equipmentData from '../../data/equipment.json' with { type: 'json' };
import { getHeatEffects } from '../heat/HeatScale.js';
import { getHipHits } from '../combat/UnitDamage.js';

const MASC = equipmentData.equipment.find(e => e.id === 'masc') || { mpMultiplier: 2 };
const TSM = equipmentData.equipment.find(e => e.id === 'tsm') || { heatThreshold: 9, walkMPBonus: 2 };

/**
 * Maximum MP available in a movement mode after heat, MASC and TSM.
 * @param {Unit} unit
 * @param {'walk'|'run'|'jump'} movementType
 * @returns {number}
 */
export function getMaxMP(unit, movementType = 'walk') {
  const movement = unit.movement || {};

  let mp;
  switch (movementType) {
    case 'run': mp = movement.run; break;
    case 'jump': mp = movement.jump; break;
    default: mp = movement.walk; break;
  }
  if (!Number.isFinite(mp)) mp = 0;

  // MASC doubles walking MP while active.
  if (movementType === 'walk' && unit.mascActive) {
    mp = Math.floor(mp * (MASC.mpMultiplier || 2));
  }

  // Heat only penalises ground movement.
  if (movementType !== 'jump') {
    mp -= getHeatEffects(unit.heat).movementPenalty;

    // A destroyed hip halves walking MP, rounded up; two hips stop the Mech
    // (p48). Running MP is recalculated from the halved walking MP.
    if (movementType === 'walk') {
      const hipHits = getHipHits(unit);
      if (hipHits >= 2) mp = 0;
      else if (hipHits === 1) mp = Math.ceil(mp / 2);
    }

    // TSM adds walking MP once the unit is hot enough.
    const hasTSM = Boolean(unit.equipment && unit.equipment.other && unit.equipment.other.tsm);
    if (movementType === 'walk' && hasTSM && (unit.heat || 0) >= (TSM.heatThreshold ?? 9)) {
      mp += TSM.walkMPBonus ?? 2;
    }
  }

  return Math.max(0, mp);
}
