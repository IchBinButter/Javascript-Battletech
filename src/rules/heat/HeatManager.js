/**
 * HeatManager - BattleTech heat tracking and effects.
 * Manages heat generation, dissipation, and heat level effects.
 * Heat level effects come from HeatScale (src/data/heatScale.json).
 */

import { getHeatEffects, describeHeatEffects } from './HeatScale.js';

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
   * Heat level effects for the unit's current heat.
   * MP is not written here: it is derived by getMaxMP from the same scale.
   * @returns {{
   *   effects: string[],
   *   shutdownCheck: boolean,
   *   shutdownTarget: number|null,
   *   ammoExplosionCheck: boolean,
   *   ammoTarget: number|null,
   *   autoShutdown: boolean
   * }}
   */
  applyHeatEffects(unit) {
    unit._movementModifier = 0;

    const scale = getHeatEffects(unit.heat);
    const effects = describeHeatEffects(unit.heat);

    return {
      effects,
      shutdownCheck: scale.shutdownAvoid !== null,
      shutdownTarget: scale.shutdownAvoid,
      ammoExplosionCheck: scale.ammoExplosionAvoid !== null,
      ammoTarget: scale.ammoExplosionAvoid,
      autoShutdown: scale.autoShutdown
    };
  }

  /**
   * Check for involuntary shutdown.
   * The target is an avoid target: roll 2d6 and meet or beat it.
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
   * Check for a heat-induced ammo explosion.
   * The target is an avoid target: roll 2d6 and meet or beat it.
   * @returns {{ exploded: boolean, roll: number, target: number }}
   */
  checkAmmoExplosion(unit, diceRoller, ammoTarget) {
    if (!ammoTarget) return { exploded: false, roll: 0, target: 0 };

    const roll = diceRoller.roll2d6();
    const exploded = roll < ammoTarget;

    return { exploded, roll, target: ammoTarget };
  }

  /**
   * Resolve heat phase for all units.
   */
  resolveHeatPhase(gameState, diceRoller) {
    const results = [];

    for (const unit of Object.values(gameState.units)) {
      const dissipation = this.applyHeatDissipation(unit, gameState);
      const heatEffects = this.applyHeatEffects(unit);

      if (heatEffects.autoShutdown) {
        unit.shutdown = true;
        heatEffects.effects.push('Unit AUTO SHUTDOWN');
      } else if (heatEffects.shutdownCheck) {
        const shutdownResult = this.checkShutdown(unit, diceRoller, heatEffects.shutdownTarget);
        if (shutdownResult.shutdown) {
          heatEffects.effects.push(`Unit SHUTDOWN (rolled ${shutdownResult.roll}, needed ${shutdownResult.target}+)`);
        }
      }

      if (heatEffects.ammoExplosionCheck) {
        const ammoResult = this.checkAmmoExplosion(unit, diceRoller, heatEffects.ammoTarget);
        if (ammoResult.exploded) {
          for (const [binName, ammo] of Object.entries(unit.equipment.ammo)) {
            if (ammo.shots > 0) {
              heatEffects.effects.push(`AMMO EXPLOSION in ${binName}! (rolled ${ammoResult.roll}, needed ${ammoResult.target}+)`);
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
