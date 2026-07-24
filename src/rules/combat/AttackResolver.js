/**
 * AttackResolver - Weapon attack resolution (G.A.T.O.R.).
 * Handles target number calculation, hit location, and cluster hits.
 */

import { hexDistance, directionBetween } from '../../hex/HexMath.js';
import { LineOfSight } from './LineOfSight.js';

export class AttackResolver {
  constructor(hitTables) {
    this.hitTables = hitTables;
    this.los = new LineOfSight();
  }

  /**
   * Calculate the G.A.T.O.R. target number for a weapon attack.
   * G = Gunnery skill (base)
   * A = Attacker movement modifier
   * T = Target modifiers (movement + terrain)
   * O = Other mods (heat, damage, pilot hits, woods)
   * R = Range modifier
   */
  calculateTargetNumber(attacker, weaponDef, target, gameState) {
    const mods = [];
    let tn = attacker.pilot.gunnery;
    mods.push(`Gunnery: ${tn}`);

    // A - Attacker movement modifier
    const attackerMod = attacker.getAttackerMovementModifier();
    tn += attackerMod;
    if (attackerMod > 0) mods.push(`Attacker moved: +${attackerMod}`);

    // T - Target movement modifier (computed from hexes moved)
    const targetMod = this._getTargetMovementModifier(target);
    tn += targetMod;
    if (targetMod > 0) mods.push(`Target moved: +${targetMod}`);

    // T - Target terrain modifier (woods occupied)
    const targetHex = gameState.map.hexes.get(target.position.hexKey);
    if (targetHex) {
      if (targetHex.terrainType === 'light_woods') {
        tn += 1;
        mods.push(`Target in light woods: +1`);
      } else if (targetHex.terrainType === 'heavy_woods') {
        tn += 2;
        mods.push(`Target in heavy woods: +2`);
      }
    }

    // Compute distance early for prone and range modifiers
    const distance = hexDistance(attacker.position.hexKey, target.position.hexKey);

    // T - Target prone (adjacent = -2, non-adjacent = +1)
    if (target.prone) {
      if (distance === 1) {
        tn -= 2;
        mods.push(`Target prone (adjacent): -2`);
      } else {
        tn += 1;
        mods.push(`Target prone: +1`);
      }
    } else if (target.immobile) {
      tn -= 4;
      mods.push(`Target immobile: -4`);
    }

    // T - Target shutdown
    if (target.shutdown) {
      tn -= 4;
      mods.push(`Target shutdown: -4`);
    }

    // O - Attacker heat
    const heatMod = this.getHeatModifier(attacker.heat);
    tn += heatMod;
    if (heatMod > 0) mods.push(`Attacker heat: +${heatMod}`);

    // O - Attacker damage (weapon damage to self)
    // (simplified: check if any location has taken >20 damage, +1 per location)
    // Omitted for simplicity in initial version

    // O - Pilot hits
    if (attacker.pilot.hits > 0) {
      tn += attacker.pilot.hits;
      mods.push(`Pilot hits: +${attacker.pilot.hits}`);
    }

    // O - Woods between attacker and target
    const losResult = this.los.calculateLOS(
      attacker.position.hexKey,
      target.position.hexKey,
      gameState
    );
    if (losResult.woodsCount > 0) {
      tn += losResult.woodsCount;
      mods.push(`Woods between: +${losResult.woodsCount}`);
    }

    // O - Targeting Computer
    const targetCompTypes = ['DE', 'DB', 'P'];
    if (targetCompTypes.includes(weaponDef.type) &&
        attacker.equipment &&
        attacker.equipment.other &&
        attacker.equipment.other.targeting_computer) {
      tn -= 1;
      mods.push(`Targeting Computer: -1`);
    }

    // O - Partial cover
    if (losResult.partialCover) {
      tn += 1;
      mods.push(`Partial cover: +1`);
    }

    // O - Minimum range
    if (distance < weaponDef.minRange) {
      const minRangeMod = weaponDef.minRange - distance;
      tn += minRangeMod;
      mods.push(`Min range: +${minRangeMod}`);
    }

    // R - Range modifier
    const rangeMod = weaponDef.getRangeModifier(distance);
    if (rangeMod === null) {
      return { canFire: false, targetNumber: 999, modifiers: mods, reason: 'Out of range' };
    }
    tn += rangeMod;
    if (rangeMod > 0) mods.push(`Range: +${rangeMod}`);

    return {
      canFire: true,
      targetNumber: Math.max(2, tn),
      modifiers: mods,
      rangeMod,
      distance,
      losResult,
      minimumRangeMod: distance < weaponDef.minRange ? weaponDef.minRange - distance : 0
    };
  }

  /**
   * Resolve a full weapon attack (one weapon, one target).
   * @returns {{
   *   hit: boolean,
   *   roll: number,
   *   targetNumber: number,
   *   hitLocations: Array<{location, isRear, damage}>,
   *   details: string,
   *   clusterHits: number
   * }}
   */
  resolveWeaponAttack(attacker, weaponDef, weaponInstance, target, gameState, diceRoller) {
    const calc = this.calculateTargetNumber(attacker, weaponDef, target, gameState);

    if (!calc.canFire) {
      return {
        hit: false,
        roll: 0,
        targetNumber: 999,
        hitLocations: [],
        details: `Cannot fire: ${calc.reason}`,
        clusterHits: 0,
        modifiers: calc.modifiers
      };
    }

    const roll = diceRoller.roll2d6();
    const hit = roll >= calc.targetNumber;

    const result = {
      hit,
      roll,
      targetNumber: calc.targetNumber,
      hitLocations: [],
      details: `Rolled ${roll} (need ${calc.targetNumber}): ${hit ? 'HIT' : 'MISS'}
        Base: ${attacker.pilot.gunnery}
        Modifiers: ${calc.modifiers.join(' | ')}
        Distance: ${calc.distance} hexes, Range: ${weaponDef.getRangeBracket(calc.distance)}`,
      clusterHits: weaponDef.clusterSize || 1,
      modifiers: calc.modifiers,
      weaponDef,
      weaponInstance
    };

    if (hit) {
      // Determine cluster hits for missile weapons
      if (weaponDef.cluster) {
        const clusterRoll = diceRoller.roll2d6();
        result.clusterHits = this.resolveClusterHit(clusterRoll, weaponDef.clusterSize);
        result.details += `\n        Cluster roll: ${clusterRoll} = ${result.clusterHits} missiles hit`;
      }

      // Determine hit location(s)
      const attackDirection = this.getAttackDirection(attacker, target);
      for (let i = 0; i < result.clusterHits; i++) {
        const locRoll = diceRoller.roll2d6();
        const location = this.determineHitLocation(locRoll, attackDirection);
        result.hitLocations.push({
          location: location.location,
          isRear: location.isRear || false,
          damage: weaponDef.damage,
          roll: locRoll
        });
      }
    }

    return result;
  }

  /**
   * Determine hit location from 2D6 roll and attack direction.
   */
  determineHitLocation(roll, attackDirection = 'front') {
    const table = this.hitTables.hitLocation[attackDirection];
    if (!table) return { location: 'centerTorso' };

    const entry = table[roll.toString()];
    if (!entry) return { location: 'centerTorso' };

    return {
      location: entry.location,
      critical: entry.critical || false,
      isRear: entry.isRear || false
    };
  }

  /**
   * Resolve cluster hits from the cluster table.
   * @param {number} roll - 2D6 roll
   * @param {number} clusterSize - Maximum cluster size (e.g. 2, 4, 6 for SRM, 5-20 for LRM)
   * @returns {number} Number of missiles that hit
   */
  resolveClusterHit(roll, clusterSize) {
    const table = this.hitTables.clusterTable;
    const rollEntry = table[roll.toString()];

    if (!rollEntry) {
      return clusterSize;
    }

    const tableKey = clusterSize.toString();
    const directHits = rollEntry[tableKey];
    if (directHits !== undefined) {
      return directHits;
    }

    const standardColumns = [2, 4, 6, 10, 15, 20];
    const col = standardColumns.find((c) => c % clusterSize === 0);
    if (col) {
      const scale = col / clusterSize;
      const baseHits = rollEntry[col.toString()];
      if (baseHits !== undefined) {
        return Math.max(1, Math.floor(baseHits / scale));
      }
    }

    return clusterSize;
  }

  /**
   * Get attack direction (front/left/right/rear) from attacker to target.
   */
  getAttackDirection(attacker, target) {
    // directionBetween imported at top of file
    const attackerToTarget = directionBetween(attacker.position.hexKey, target.position.hexKey);
    const targetFacing = target.position.facing;

    if (attackerToTarget === -1) return 'front';

    const diff = ((attackerToTarget - targetFacing + 3) % 6 + 3) % 6;

    if (diff <= 1 || diff >= 5) return 'front';
    if (diff === 3) return 'rear';
    if (diff === 2) return 'right';
    if (diff === 4) return 'left';
    return 'front';
  }

  /**
   * Heat modifier based on attacker heat level.
   */
  getHeatModifier(heat) {
    if (heat < 5) return 0;
    if (heat < 10) return 1;
    if (heat < 15) return 2;
    if (heat < 20) return 3;
    return 4;
  }

  /**
   * Compute target movement modifier from hexes moved.
   * Falls back to unit.getTargetMovementModifier() if hexesMoved not set.
   */
  _getTargetMovementModifier(target) {
    if (target.hexesMoved !== undefined) {
      const hm = target.hexesMoved;
      if (target.movementMode === 'jump') {
        return Math.max(1, hm);
      }
      if (hm <= 2) return 0;
      if (hm <= 4) return 1;
      if (hm <= 6) return 2;
      if (hm <= 9) return 3;
      if (hm <= 17) return 4;
      if (hm <= 24) return 5;
      return 6;
    }
    return target.getTargetMovementModifier ? target.getTargetMovementModifier() : 0;
  }
}
