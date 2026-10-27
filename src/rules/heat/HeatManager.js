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
      case 'walk':
        // Walking generates 1 heat per BMM
        heat += 1;
        break;
      case 'run':
        heat += 2; // Running generates 2 heat
        break;
      case 'jump':
        // Jumping generates 1 heat per hex jumped, minimum 3
        heat += Math.max(3, jumpHexes);
        break;
      default:
        // Stationary: 0 heat from movement
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
   * Apply heat level effects based on current heat (BMM full heat scale, 20+ thresholds).
   * @returns {{ effects: string[], shutdownCheck: boolean, shutdownTarget: number|string, ammoExplosionCheck: boolean, ammoTarget: number|string }}
   */
  applyHeatEffects(unit, diceRoller) {
    const effects = [];
    let shutdownCheck = false;
    let shutdownTarget = null;
    let ammoExplosionCheck = false;
    let ammoTarget = null;

    unit._movementModifier = 0;

    let mpReduction = 0;

    if (unit.heat < 5) {
      // 0-4: No effect
    } else if (unit.heat < 10) {
      // 5-9: +1 TN, -1 Walk MP
      effects.push('+1 TN to weapons fire');
      effects.push('-1 Walk MP');
      mpReduction = 1;
    } else if (unit.heat < 15) {
      // 10-14: +2 TN, -2 Walk MP
      effects.push('+2 TN to weapons fire');
      effects.push('-2 Walk MP');
      mpReduction = 2;
    } else if (unit.heat < 20) {
      // 15-19: +3 TN, -3 Walk MP
      effects.push('+3 TN to weapons fire');
      effects.push('-3 Walk MP');
      mpReduction = 3;
    } else if (unit.heat < 24) {
      // 20-23: +4 TN, -3 Walk MP, shutdown 4+ avoid
      effects.push('+4 TN to weapons fire');
      effects.push('-3 Walk MP');
      mpReduction = 3;
      shutdownCheck = true;
      shutdownTarget = 4;
    } else {
      // 24+: +4 TN, -3 Walk MP, shutdown 4+ avoid, ammo explosion 8+ check
      effects.push('+4 TN to weapons fire');
      effects.push('-3 Walk MP');
      mpReduction = 3;
      shutdownCheck = true;
      shutdownTarget = 4;
      ammoExplosionCheck = true;
      ammoTarget = 8;
    }

    // TSM bonus: +2 walk MP at 9+ heat
    const hasTSM = unit.equipment?.other?.tsm;
    const tsmBonus = (hasTSM && unit.heat >= 9) ? 2 : 0;

    unit.currentMP = Math.max(0, unit.movement.walk - mpReduction + tsmBonus);

    return { effects, shutdownCheck, shutdownTarget, ammoExplosionCheck, ammoTarget };
  }

  /**
   * Check for involuntary shutdown.
   * @param {number|string} shutdownTarget - Target number needed to avoid shutdown, or 'auto'
   * @returns {{ shutdown: boolean, roll: number, target: number|string }}
   */
  checkShutdown(unit, diceRoller, shutdownTarget) {
    if (!shutdownTarget) return { shutdown: false, roll: 0, target: 0 };

    if (shutdownTarget === 'auto') {
      unit.shutdown = true;
      return { shutdown: true, roll: 0, target: 'auto' };
    }

    const roll = diceRoller.roll2d6();
    const shutdown = roll < shutdownTarget;

    if (shutdown) {
      unit.shutdown = true;
    }

    return { shutdown, roll, target: shutdownTarget };
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
        const shutdownResult = this.checkShutdown(unit, diceRoller, heatEffects.shutdownTarget);
        if (shutdownResult.shutdown) {
          heatEffects.effects.push(`Unit SHUTDOWN (rolled ${shutdownResult.roll} vs ${shutdownResult.target}+)`);
        }
      }

      if (heatEffects.ammoExplosionCheck) {
        const ammoRoll = diceRoller.roll2d6();
        if (ammoRoll >= heatEffects.ammoTarget) {
          for (const [binName, ammo] of Object.entries(unit.equipment.ammo)) {
            if (ammo.shots > 0) {
              heatEffects.effects.push(`AMMO EXPLOSION in ${binName}! (rolled ${ammoRoll} vs ${heatEffects.ammoTarget}+)`);
              ammo.shots = 0;
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
