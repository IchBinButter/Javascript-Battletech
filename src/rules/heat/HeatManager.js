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

    if (unit.heat <= 13) {
      // No effects
    } else if (unit.heat === 14) {
      effects.push('+1 TN to weapons fire');
    } else if (unit.heat === 15) {
      effects.push('+2 TN to weapons fire');
    } else if (unit.heat === 16) {
      effects.push('+3 TN to weapons fire');
    } else if (unit.heat === 17) {
      effects.push('+4 TN to weapons fire');
    } else if (unit.heat === 18) {
      effects.push('+5 TN to weapons fire');
      effects.push('-1 Walk MP');
      mpReduction = 1;
    } else if (unit.heat === 19) {
      effects.push('+6 TN to weapons fire');
      effects.push('-2 Walk MP');
      mpReduction = 2;
      ammoExplosionCheck = true;
      ammoTarget = 4;
    } else if (unit.heat === 20) {
      effects.push('+7 TN to weapons fire');
      effects.push('-3 Walk MP');
      mpReduction = 3;
      shutdownCheck = true;
      shutdownTarget = 4;
      ammoExplosionCheck = true;
      ammoTarget = 6;
    } else if (unit.heat === 21) {
      effects.push('+8 TN to weapons fire');
      effects.push('-4 Walk MP');
      mpReduction = 4;
      shutdownCheck = true;
      shutdownTarget = 6;
      ammoExplosionCheck = true;
      ammoTarget = 8;
    } else if (unit.heat === 22) {
      effects.push('+9 TN to weapons fire');
      effects.push('-5 Walk MP');
      mpReduction = 5;
      shutdownCheck = true;
      shutdownTarget = 8;
      ammoExplosionCheck = true;
      ammoTarget = 10;
    } else if (unit.heat === 23) {
      effects.push('+10 TN to weapons fire');
      effects.push('-6 Walk MP');
      mpReduction = 6;
      shutdownCheck = true;
      shutdownTarget = 10;
      ammoExplosionCheck = true;
      ammoTarget = 12;
    } else {
      // Heat 24+: auto shutdown, auto ammo
      shutdownCheck = true;
      shutdownTarget = 'auto';
      ammoExplosionCheck = true;
      ammoTarget = 'auto';
      mpReduction = 999;
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
          if (shutdownResult.target === 'auto') {
            heatEffects.effects.push('Unit AUTO SHUTDOWN');
          } else {
            heatEffects.effects.push(`Unit SHUTDOWN (rolled ${shutdownResult.roll} vs ${shutdownResult.target}+)`);
          }
        }
      }

      if (heatEffects.ammoExplosionCheck) {
        if (heatEffects.ammoTarget === 'auto') {
          for (const [binName, ammo] of Object.entries(unit.equipment.ammo)) {
            if (ammo.shots > 0) {
              heatEffects.effects.push(`AMMO EXPLOSION in ${binName}! (auto)`);
              ammo.shots = 0;
            }
          }
        } else {
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
