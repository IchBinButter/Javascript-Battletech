/**
 * FacingRules - Facing and torso twist mechanics.
 */

import { directionBetween, getNeighborInDirection, adjustFacing } from '../../hex/HexMath.js';

export class FacingRules {
  /**
   * Get valid facing options after arriving at a hex.
   * Each of the 6 hexsides can be a valid facing.
   */
  getValidFacings(unit, hexKey, movementType) {
    return [0, 1, 2, 3, 4, 5];
  }

  /**
   * Calculate torso twist direction.
   * Torso twist allows twisting ±1 hexside for torso-mounted weapons.
   * Returns: -1 (left), 0 (no twist), 1 (right)
   */
  calculateTorsoTwist(unit, targetHex, gameState) {
    const fromKey = unit.position.hexKey;
    const targetDirection = directionBetween(fromKey, targetHex);

    if (targetDirection === -1) return 0; // Same hex

    const facing = unit.position.facing;
    const diff = ((targetDirection - facing + 3) % 6 + 3) % 6;

    // Can twist 1 hexside in either direction
    if (diff === 0) return 0;
    if (diff === 1) return 1;
    if (diff === 5) return -1;

    return 0; // Beyond 1 hexside - torso can't twist that far
  }

  /**
   * Check if a target is in the unit's firing arc.
   * @param {number} arc - 'front', 'left', 'right', 'rear' - relevant arc for weapon
   * @returns {boolean}
   */
  isInFiringArc(unit, targetKey, gameState, arc = 'front') {
    const fromKey = unit.position.hexKey;
    const targetDirection = directionBetween(fromKey, targetKey);
    if (targetDirection === -1) return false; // Same hex

    const facing = unit.position.facing;
    let diff = ((targetDirection - facing + 3) % 6 + 3) % 6;

    // Apply torso twist if applicable
    if (unit.torsoTwist !== 0 && (arc === 'torso' || arc === 'front')) {
      diff = ((diff - unit.torsoTwist + 6) % 6);
    }

    switch (arc) {
      case 'front': return diff <= 1 || diff >= 5; // Front 3 hexsides (0, 1, 5)
      case 'rear': return diff === 3;                // Rear 1 hexside
      case 'left': return diff === 4 || diff === 5;  // Left side
      case 'right': return diff === 1 || diff === 2; // Right side
      case 'arm': return diff <= 2 || diff >= 4;     // Arm arc (5 hexsides, no rear)
      case 'torso': {
        // Torso twist: front arc ±1 hexside
        const twistedDiff = ((diff - unit.torsoTwist + 6) % 6);
        return twistedDiff <= 1 || twistedDiff >= 5;
      }
      default: return false;
    }
  }

  /**
   * Reset torso twist at end of turn.
   */
  resetTorsoTwist(unit) {
    unit.torsoTwist = 0;
    unit.armsReversed = false;
  }

  /**
   * Get the attack direction (front, left, right, rear) from attacker to target.
   * This determines which hit location table to use.
   */
  getAttackDirection(attacker, target) {
    const attackerToTarget = directionBetween(attacker.position.hexKey, target.position.hexKey);
    const targetFacing = target.position.facing;

    if (attackerToTarget === -1) return 'front'; // Same hex

    const diff = ((attackerToTarget - targetFacing + 3) % 6 + 3) % 6;

    if (diff <= 1 || diff >= 5) return 'front';
    if (diff === 3) return 'rear';
    if (diff === 2 || diff === 3) return 'right';
    return 'left';
  }
}
