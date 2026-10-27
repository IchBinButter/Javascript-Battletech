/**
 * AttackResolver - Weapon attack resolution (G.A.T.O.R.).
 * Handles target number calculation, hit location, and cluster hits.
 */

import { hexDistance, directionBetween } from '../../hex/HexMath.js';
import { LineOfSight } from './LineOfSight.js';
import { canWeaponFireAt, isLegLocation } from './ArcRules.js';
import { getHeatEffects } from '../heat/HeatScale.js';

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
  calculateTargetNumber(attacker, weaponDef, target, gameState, options = {}) {
    const mods = [];
    let tn = attacker.pilot.gunnery;
    mods.push(`Gunnery: ${tn}`);

    // F - Firing arc (p24). A weapon can only fire into arcs it bears on, so an
    // out-of-arc shot is not a hard shot: it is not a shot at all.
    let arcInfo = null;
    if (options.weaponLocation) {
      arcInfo = canWeaponFireAt(attacker, weaponDef, target.position.hexKey, {
        weaponLocation: options.weaponLocation,
        mount: weaponDef ? weaponDef.mount : undefined
      });
      if (!arcInfo.legal) {
        return {
          canFire: false,
          outOfArc: true,
          arc: arcInfo.arc,
          targetNumber: 999,
          modifiers: mods,
          reason: arcInfo.reason
        };
      }
    }

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

    // T - Target prone (flat -4, prone = immobile)
    if (target.prone) {
      tn -= 4;
      mods.push(`Target prone: -4`);
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
      gameState,
      { attacker, target }
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
    if (distance <= weaponDef.minRange) {
      const minRangeMod = weaponDef.minRange - distance + 1;
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
      arc: arcInfo ? arcInfo.arc : undefined,
      targetNumber: Math.max(2, tn),
      modifiers: mods,
      rangeMod,
      distance,
      losResult,
      minimumRangeMod: distance <= weaponDef.minRange ? weaponDef.minRange - distance + 1 : 0
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
    const calc = this.calculateTargetNumber(attacker, weaponDef, target, gameState, {
      weaponLocation: weaponInstance ? weaponInstance.location : undefined
    });

    if (!calc.canFire) {
      return {
        hit: false,
        canFire: false,
        outOfArc: calc.outOfArc === true,
        arc: calc.arc,
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
      arc: calc.arc,
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

        // Partial cover (p26/p32): a leg hit strikes the cover instead. The
        // hit is not re-rolled and does no damage to the Mech; if the cover is
        // a building, the building takes it (urban combat, later).
        const absorbedByCover = Boolean(
          calc.losResult && calc.losResult.partialCover && isLegLocation(location.location)
        );

        if (absorbedByCover) {
          result.details += `\n        Leg hit (${location.location}) absorbed by partial cover`;
        }

        result.hitLocations.push({
          location: location.location,
          isRear: location.isRear || false,
          damage: absorbedByCover ? 0 : weaponDef.damage,
          roll: locRoll,
          absorbedByCover,
          coverHex: absorbedByCover ? calc.losResult.partialCoverHex : undefined
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
   * Attack direction (front/left/right/rear) - the side of the target the fire
   * comes from (p32).
   *
   * Use the bearing from the target TO the attacker. The direction the shot
   * travels is the opposite vector, and using it resolved every front hit on
   * the rear hit location table.
   */
  getAttackDirection(attacker, target) {
    const bearing = directionBetween(target.position.hexKey, attacker.position.hexKey);
    const targetFacing = target.position.facing;

    if (bearing === -1) return 'front';

    const diff = ((bearing - targetFacing + 3) % 6 + 3) % 6;

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
    return getHeatEffects(heat).toHitModifier;
  }

  /**
   * Standard TMM from hex-count ladder (0-2→0, 3-4→1, 5-6→2, 7-9→3, 10-17→4, 18-24→5, 25+→6).
   */
  _computeStandardTmm(hexesMoved) {
    if (hexesMoved <= 2) return 0;
    if (hexesMoved <= 4) return 1;
    if (hexesMoved <= 6) return 2;
    if (hexesMoved <= 9) return 3;
    if (hexesMoved <= 17) return 4;
    if (hexesMoved <= 24) return 5;
    return 6;
  }

  /**
   * Compute target movement modifier from hexes moved.
   * Falls back to unit.getTargetMovementModifier() if hexesMoved not set.
   */
  _getTargetMovementModifier(target) {
    if (target.hexesMoved !== undefined) {
      const hm = target.hexesMoved;
      const tmm = this._computeStandardTmm(hm);
      if (target.movementMode === 'jump') {
        return Math.max(1, tmm + 1);
      }
      return tmm;
    }
    return target.getTargetMovementModifier ? target.getTargetMovementModifier() : 0;
  }
}
