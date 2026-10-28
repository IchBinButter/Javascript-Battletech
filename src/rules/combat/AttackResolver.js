/**
 * AttackResolver - Weapon attack resolution (G.A.T.O.R.).
 * Handles target number calculation, hit location, and cluster hits.
 */

import { hexDistance, directionBetween } from '../../hex/HexMath.js';
import { LineOfSight } from './LineOfSight.js';
import { canWeaponFireAt, isLegLocation } from './ArcRules.js';
import { armWeaponModifier, hasSensorHit } from './UnitDamage.js';
import { quirkTargetModifier } from '../quirks/Quirks.js';
import { getHeatEffects } from '../heat/HeatScale.js';
import { attackModifier } from '../weather/WeatherRules.js';

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

    // T - Target prone (p28): -2 from an adjacent hex, +1 from anywhere else.
    if (target.prone) {
      const proneMod = distance === 1 ? -2 : 1;
      tn += proneMod;
      mods.push(`Target prone${distance === 1 ? ' (adjacent)' : ''}: ${proneMod > 0 ? '+' : ''}${proneMod}`);
    } else if (target.immobile) {
      tn -= 4;
      mods.push(`Target immobile: -4`);
    }

    // T - Target shutdown
    if (target.shutdown) {
      tn -= 4;
      mods.push(`Target shutdown: -4`);
    }

    // T - Target skidding (p28)
    if (target.skidding || target._skidding) {
      tn += 2;
      mods.push(`Target skidding: +2`);
    }

    // A - Attacker skidding, and firing while prone (p28)
    if (attacker.skidding || attacker._skidding) {
      tn += 1;
      mods.push(`Attacker skidding: +1`);
    }
    if (attacker.prone) {
      tn += 2;
      mods.push(`Attacker prone: +2`);
    }

    // A - Attacker damage: sensors (p28/p49) and the firing arm's actuators.
    if (hasSensorHit(attacker)) {
      tn += 2;
      mods.push(`Sensors hit: +2`);
    }
    const armMod = armWeaponModifier(attacker, options.weaponLocation);
    if (armMod > 0) {
      tn += armMod;
      mods.push(`Arm actuators damaged: +${armMod}`);
    }

    // O - Secondary target this phase (p27): +1 forward, +2 side or rear.
    if (options.multipleTargetModifier) {
      tn += options.multipleTargetModifier;
      mods.push(`Secondary target: +${options.multipleTargetModifier}`);
    }

    // Urban combat (p72): +1 for a target inside a building, plus +1 for each
    // intervening building hex/level (the caller caps that part at +3).
    if (options.buildingModifier) {
      tn += options.buildingModifier;
      mods.push(`Combat within buildings: +${options.buildingModifier}`);
    }

    // O - Attacker heat
    const heatMod = this.getHeatModifier(attacker.heat);
    tn += heatMod;
    if (heatMod > 0) mods.push(`Attacker heat: +${heatMod}`);

    // O - Weather conditions (p138)
    const weatherMod = attackModifier(gameState.weather, weaponDef.type, target);
    if (weatherMod.modifier > 0) {
      tn += weatherMod.modifier;
      mods.push(`Weather: +${weatherMod.modifier}`);
    }

    // O - Attacker damage (weapon damage to self)
    // (simplified: check if any location has taken >20 damage, +1 per location)
    // Omitted for simplicity in initial version

    // O - Pilot hits
    if (attacker.pilot.hits > 0) {
      tn += attacker.pilot.hits;
      mods.push(`Pilot hits: +${attacker.pilot.hits}`);
    }

    // O - Terrain and woods come from the line of sight that matters: the
    // attacker's own, or the spotter's for indirect fire (p30).
    const isIndirect = Boolean(options.indirect);
    const spotter = options.spotter || null;
    const losSource = isIndirect && spotter ? spotter : attacker;

    const losResult = this.los.calculateLOS(
      losSource.position.hexKey,
      target.position.hexKey,
      gameState,
      { attacker: losSource, target }
    );
    if (losResult.woodsCount > 0) {
      tn += losResult.woodsCount;
      mods.push(`Woods between: +${losResult.woodsCount}`);
    }

    if (isIndirect) {
      // p30: +1 for indirect fire, plus the spotter's own movement modifier.
      tn += 1;
      mods.push('Indirect fire: +1');

      if (spotter) {
        const spotterMove = typeof spotter.getAttackerMovementModifier === 'function'
          ? spotter.getAttackerMovementModifier()
          : 0;
        if (spotterMove > 0) {
          tn += spotterMove;
          mods.push(`Spotter moved: +${spotterMove}`);
        }
      }

      if (options.spotterAttacked) {
        tn += 1;
        mods.push('Spotter attacked: +1');
      }
    }

    // p30: a Mech that spots and also attacks takes +1 on its own attacks.
    if (attacker.spottedThisPhase) {
      tn += 1;
      mods.push('Spotting for indirect fire: +1');
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

    // O - Design quirks (p82-95): Poor Targeting raises the TN in one range
    // bracket, Sensor Ghosts on every ranged attack, Inaccurate Weapon on the
    // weapon it names. The bracket comes from the same distance as the range
    // modifier above, so the two can never disagree. A shot inside a weapon's
    // minimum range is still a Short range attack for quirks; the minimum
    // range modifier is additional (p27).
    const bracket = typeof weaponDef.getRangeBracket === 'function'
      ? weaponDef.getRangeBracket(distance)
      : undefined;
    const quirkMod = quirkTargetModifier(attacker, {
      weapon: weaponDef,
      rangeBracket: bracket === 'min' ? 'short' : bracket,
      distance,
      target
    });
    if (quirkMod.modifier !== 0) {
      tn += quirkMod.modifier;
      mods.push(...quirkMod.reasons);
    }

    return {
      canFire: true,
      arc: arcInfo ? arcInfo.arc : undefined,
      indirect: isIndirect,
      partialCoverKind: losResult.partialCoverKind,
      targetNumber: Math.max(2, tn),
      modifiers: mods,
      rangeMod,
      quirkModifier: quirkMod.modifier,
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
  resolveWeaponAttack(attacker, weaponDef, weaponInstance, target, gameState, diceRoller, options = {}) {
    const isIndirect = Boolean(options.indirect);
    const isAimed = Boolean(options.aimedLocation);

    // Aimed shots (p30): immobile targets only, no cluster weapons, and never
    // combined with indirect fire.
    if (isAimed) {
      if (!target.immobile) {
        return {
          hit: false, canFire: false, roll: 0, targetNumber: 999, hitLocations: [],
          clusterHits: 0, details: 'Aimed shots require an immobile target', modifiers: []
        };
      }
      if (weaponDef.cluster) {
        return {
          hit: false, canFire: false, roll: 0, targetNumber: 999, hitLocations: [],
          clusterHits: 0, details: 'Cluster weapons cannot make aimed shots', modifiers: []
        };
      }
      if (isIndirect) {
        return {
          hit: false, canFire: false, roll: 0, targetNumber: 999, hitLocations: [],
          clusterHits: 0, details: 'No aimed shots with indirect fire', modifiers: []
        };
      }
    }

    const calc = this.calculateTargetNumber(attacker, weaponDef, target, gameState, {
      weaponLocation: weaponInstance ? weaponInstance.location : undefined,
      indirect: isIndirect,
      spotter: options.spotter,
      spotterAttacked: options.spotterAttacked,
      multipleTargetModifier: options.multipleTargetModifier
    });

    if (!calc.canFire) {
      return {
        hit: false,
        canFire: false,
        outOfArc: calc.outOfArc === true,
        arc: calc.arc,
        indirect: isIndirect,
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
      indirect: isIndirect,
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
        let location = this.determineHitLocation(locRoll, attackDirection);

        // Aimed shot (p30): on 6, 7 or 8 the shot lands on the designated spot.
        if (isAimed && i === 0) {
          const aimRoll = diceRoller.roll2d6();
          result.aimRoll = aimRoll;
          if (aimRoll >= 6 && aimRoll <= 8) {
            location = { location: options.aimedLocation, isRear: false };
            result.details += `\n        Aimed shot (${aimRoll}) hits ${options.aimedLocation}`;
          } else {
            result.details += `\n        Aimed shot (${aimRoll}) misses the mark`;
          }
        }

        // Partial cover (p26/p32): a leg hit strikes the cover instead. Indirect
        // fire always strikes the target unless the cover is water (p30).
        const coverApplies = Boolean(
          calc.losResult && calc.losResult.partialCover &&
          (!isIndirect || calc.losResult.partialCoverKind === 'water')
        );
        const absorbedByCover = Boolean(coverApplies && isLegLocation(location.location));

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
