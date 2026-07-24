/**
 * SkiddingRules - Skidding mechanics for BattleTech.
 */

import { getNeighborInDirection, adjustFacing } from '../../hex/HexMath.js';

export class SkiddingRules {
  /**
   * Check if a unit should skid.
   * Skidding occurs when:
   * - Running and attempting to turn 2+ hexsides
   * - Moving on ice/pavement and attempting a turn
   * @returns {{ willSkid: boolean, reason: string }}
   */
  checkSkid(unit, fromKey, toKey, movementType, gameState) {
    const hex = gameState.map.hexes.get(fromKey);

    if (movementType !== 'run') {
      return { willSkid: false, reason: '' };
    }

    const onIce = hex && hex.modifiers.ice;
    const onPavement = hex && hex.terrainType === 'pavement';

    if (onIce || onPavement) {
      return { willSkid: true, reason: `Moving on ${onIce ? 'ice' : 'pavement'} while running` };
    }

    // Rapid turn: turning 2+ hexsides while running
    if (unit._rapidTurnHexsides >= 2) {
      return { willSkid: true, reason: `Rapid turn of ${unit._rapidTurnHexsides} hexsides while running` };
    }

    return { willSkid: false, reason: '' };
  }

  /**
   * Resolve a skid.
   * Unit continues moving in skid direction (uses unit's current facing) using remaining MP.
   * @returns {{ path: string[], damage: number, collisions: any[] }}
   */
  resolveSkid(unit, remainingMP, gameState, diceRoller) {
    const path = [];
    const collisions = [];
    let currentKey = unit.position.hexKey;
    const direction = unit.position.facing;
    let totalHexes = remainingMP;

    for (let i = 0; i < totalHexes; i++) {
      const nextKey = getNeighborInDirection(currentKey, direction);
      const nextHex = gameState.map.hexes.get(nextKey);

      if (!nextHex) break;

      path.push(nextKey);

      if (nextHex.occupiedBy) {
        const hexesSkidded = path.length;
        const collisionDamage = Math.ceil(unit.tonnage / 10) * hexesSkidded;
        collisions.push({
          hex: nextKey,
          unitId: nextHex.occupiedBy,
          type: 'unit',
          damageToTarget: collisionDamage,
          damageToSelf: collisionDamage
        });
        break;
      }

      if (nextHex.building) {
        collisions.push({
          hex: nextKey,
          type: 'building',
          buildingType: nextHex.building.type
        });
        break;
      }

      currentKey = nextKey;

      if ((nextHex.modifiers.ice || nextHex.terrainType === 'pavement') && diceRoller) {
        const roll = diceRoller.roll2d6();
        const piloting = unit.pilot ? unit.pilot.piloting : 5;
        if (roll < piloting) {
          totalHexes += remainingMP;
        }
      }
    }

    const damage = Math.ceil(unit.tonnage / 10) * path.length;

    return {
      path,
      collisions,
      damage,
      finalHex: currentKey
    };
  }
}
