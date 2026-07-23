/**
 * HeatManager - BattleTech heat tracking and effects.
 * Manages heat generation, dissipation, and heat level effects.
 */

export class HeatManager {
  /**
   * Calculate total heat generation for the turn.
   * @param {Unit} unit
   * @param {Array} weaponsFired - Array of weapon defs fired
   * @param {string} movementType - 'stationary', 'walk', 'run', 'jump'
   * @param {number} jumpHexes - Number of hexes jumped (if jumping)
   * @returns {number} Total heat generated
   */
  calculateHeatGeneration(unit, weaponsFired, movementType, jumpHexes = 0) {
    let heat = 0;

    // Weapon heat
    for (const weapon of weaponsFired) {
      heat += weapon.heat;
    }

    // Movement heat
    switch (movementType) {
      case 'run':
        heat += 2; // Running generates 2 heat
        break;
      case 'jump':
        // Jumping generates 3 heat per hex jumped, minimum 3
        heat += Math.max(3, jumpHexes * 3);
        break;
      default:
        // Walk or stationary: 0 heat from movement
        break;
    }

    // External heat (fire, plasma, etc.)
    if (unit._externalHeat) {
      heat += unit._externalHeat;
    }

    return heat;
  }

  /**
   * Calculate and apply heat dissipation.
   * @returns {number} Heat dissipated
   */
  applyHeatDissipation(unit, gameState) {
    let dissipation = unit.getHeatDissipation();

    // Standing in water doubles dissipation ONLY from heat sinks mounted in legs
    const hex = unit.position.hexKey ? gameState.map.hexes.get(unit.position.hexKey) : null;
    if (hex && (hex.terrainType === 'water_depth1' || hex.terrainType === 'water_depth2')) {
      // Count heat sinks in legs
      let legSinks = 0;
      const leftLegSlots = (unit.criticalSlots && unit.criticalSlots.leftLeg) || [];
      const rightLegSlots = (unit.criticalSlots && unit.criticalSlots.rightLeg) || [];
      for (const slot of leftLegSlots) {
        if (slot.item && slot.item.includes('heat_sink') && slot.status === 'ok') legSinks++;
      }
      for (const slot of rightLegSlots) {
        if (slot.item && slot.item.includes('heat_sink') && slot.status === 'ok') legSinks++;
      }
      // Double only leg sink dissipation
      dissipation += legSinks;
    }

    unit.heat = Math.max(0, unit.heat - dissipation);
    return dissipation;
  }

  /**
   * Apply heat level effects based on current heat.
   * @returns {{ effects: string[], shutdownCheck: boolean, ammoExplosionCheck: boolean }}
   */
  applyHeatEffects(unit, diceRoller) {
    const effects = [];
    let shutdownCheck = false;
    let ammoExplosionCheck = false;

    // Reset movement modifiers from heat
    unit._movementModifier = 0;

    if (unit.heat < 5) {
      // No effects
    } else if (unit.heat < 10) {
      effects.push('+1 TN to weapons fire');
      unit._movementModifier = 0;
    } else if (unit.heat < 15) {
      effects.push('+2 TN to weapons fire');
      effects.push('-1 Walk MP');
      unit._movementModifier = 0;
    } else if (unit.heat < 20) {
      effects.push('+3 TN to weapons fire');
      effects.push('-2 Walk MP');
      unit._movementModifier = 0;
    } else if (unit.heat < 24) {
      effects.push('+4 TN to weapons fire');
      effects.push('-3 Walk MP');
      shutdownCheck = true; // 4+ on 2d6 to avoid shutdown
    } else {
      // Heat 24+
      effects.push('+4 TN to weapons fire');
      effects.push('-3 Walk MP');
      shutdownCheck = true; // 4+ on 2d6 to avoid shutdown
      ammoExplosionCheck = true; // 8+ on 2d6 = explosion
    }

    // TSM bonus: +1 walk MP at 9+ heat
    const hasTSM = unit.equipment?.other?.tsm;
    const tsmBonus = (hasTSM && unit.heat >= 9) ? 1 : 0;

    // Apply movement reduction
    const mpReduction = unit.heat < 10 ? 0 :
      unit.heat < 15 ? 1 :
      unit.heat < 20 ? 2 :
      unit.heat < 24 ? 3 : 999;
    unit.currentMP = Math.max(0, unit.movement.walk - mpReduction + tsmBonus);

    return { effects, shutdownCheck, ammoExplosionCheck };
  }

  /**
   * Check for involuntary shutdown.
   * @returns {{ shutdown: boolean, roll: number, target: number }}
   */
  checkShutdown(unit, diceRoller) {
    const roll = diceRoller.roll2d6();
    let target = 4; // Need 4+ on 2d6 to avoid shutdown

    if (unit.heat < 20) return { shutdown: false, roll: 0, target: 0 };

    // At heat 20+, roll 4+ on 2d6 to avoid shutdown
    const shutdown = roll < target;
    if (shutdown) {
      unit.shutdown = true;
    }

    return { shutdown, roll, target };
  }

  /**
   * Resolve heat phase for all units.
   */
  resolveHeatPhase(gameState, diceRoller) {
    const results = [];

    for (const unit of Object.values(gameState.units)) {
      const dissipation = this.applyHeatDissipation(unit, gameState);
      const heatEffects = this.applyHeatEffects(unit, diceRoller);

      if (heatEffects.shutdownCheck) {
        const shutdownResult = this.checkShutdown(unit, diceRoller);
        if (shutdownResult.shutdown) {
          heatEffects.effects.push(`Unit SHUTDOWN (rolled ${shutdownResult.roll} vs ${shutdownResult.target})`);
        }
      }

      if (heatEffects.ammoExplosionCheck) {
        const ammoRoll = diceRoller.roll2d6();
        if (ammoRoll >= 8) {
          // Find ammo bins and check each one
          for (const [binName, ammo] of Object.entries(unit.equipment.ammo)) {
            if (ammo.shots > 0) {
              // Ammo explosion!
              heatEffects.effects.push(`AMMO EXPLOSION in ${binName}!`);
              ammo.shots = 0; // Simplified
            }
          }
        }
      }

      results.push({
        unitId: unit.id,
        heat: unit.heat,
        dissipation,
        effects: heatEffects.effects
      });
    }

    return results;
  }
}
