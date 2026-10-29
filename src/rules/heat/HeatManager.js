/**
 * HeatManager - BattleTech heat tracking and effects.
 * Manages heat generation, dissipation, and heat level effects.
 * Heat level effects come from HeatScale (src/data/heatScale.json).
 */

import { getHeatEffects, describeHeatEffects } from './HeatScale.js';
import { hasLifeSupportHit } from '../combat/UnitDamage.js';
import { DamageResolver } from '../combat/DamageResolver.js';
import weaponsData from '../../data/weapons.json' with { type: 'json' };
import { heatPerTurn } from '../weather/WeatherRules.js';
import { fireHeat, capOutsideHeat } from '../terrain/FireRules.js';

const WEAPON_DAMAGE = {};
for (const weapon of weaponsData.weapons) {
  // p52 measures destructive power by the damage one turn's worth of shots
  // does, so a cluster launcher counts damage x size (LRM-15 = 15).
  WEAPON_DAMAGE[weapon.id] = weapon.cluster
    ? weapon.damage * (weapon.clusterSize || 1)
    : weapon.damage;
}

export class HeatManager {
  /**
   * @param {DamageResolver} [damageResolver] - shared resolver for heat-induced
   *   ammunition explosions (H-08). The live Heat Phase path calls it for the
   *   one bin that explodes; a plain resolver is created when none is injected
   *   so the heat rules stay self-contained (GameEngine constructs its own).
   */
  constructor(damageResolver = null) {
    this.damageResolver = damageResolver || new DamageResolver();
  }

  /**
   * Heat leaked by a damaged engine each turn (p47 ENGINE, p50 Other Heat,
   * p51 Heat Point Table).
   *
   * p50: "The first engine hit to a 'Mech generates 5 points of heat per turn.
   * The second hit raises this to 10 (total) points of heat per turn."
   * p47 repeats it ("The first hit increases the 'Mech's heat build-up by 5
   * points per turn. The second adds another 5 points of heat build-up per turn
   * for a total of 10 points per turn") and p52 fixes the timing/exclusion:
   * "Engine critical hits do not generate heat while a 'Mech is shut down."
   *
   * A third engine hit destroys the 'Mech (p47), so 10 is the ceiling.
   * @returns {number} heat generated this turn by engine shielding damage
   */
  engineHeatPerTurn(unit) {
    if (!unit || unit.shutdown) return 0;
    const hits = (unit.engine && unit.engine.hits) || 0;
    if (hits >= 2) return 10;
    if (hits === 1) return 5;
    return 0;
  }

  /**
   * Calculate total heat generation for the turn.
   *
   * Note: this helper is not on the live turn pipeline (movement heat is still
   * unwired - Phase A). Fire is outside heat and is recorded by the Heat Phase
   * itself through `resolveOutsideHeat` below, so it is deliberately absent
   * here.
   * @param {Unit} unit
   * @param {Array} weaponsFired - Array of weapon defs fired
   * @param {string} movementType - 'stationary', 'walk', 'run', 'jump'
   * @param {number} jumpHexes - Number of hexes jumped (if jumping)
   * @returns {number} Total heat generated
   */
  calculateHeatGeneration(unit, weaponsFired, movementType, jumpHexes = 0) {
    let heat = 0;

    // Weapon heat. Firing-time effects (design quirks such as Poor Cooling
    // Jacket, p88) belong to the live fire path, which applies them when the
    // shot is declared (GameEngine._handleFire); this stays a plain heat total.
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

    // p50/p52: a damaged engine runs hot (first hit +5 per turn, second +10
    // total) unless the 'Mech is shut down. Shared with the live Heat Phase,
    // which applies the same amount.
    heat += this.engineHeatPerTurn(unit);

    return heat;
  }

  /**
   * The ammunition bin a heat-induced explosion destroys (p52): the one whose
   * ammo does the most damage per shot, then the one with the most shots.
   */
  mostDestructiveAmmoBin(unit) {
    const ammo = (unit.equipment && unit.equipment.ammo) || {};
    let best = null;
    let bestScore = -1;

    for (const [binName, bin] of Object.entries(ammo)) {
      if (!bin || bin.shots <= 0) continue;
      // p52: "Exploding weapons and their ammunition (such as Gauss rifles) ...
      // do not explode from overheating." Bins are explosive unless flagged off.
      if (bin.explosive === false) continue;
      // Real bins name their weapon in `type` (lrm20_ammo -> lrm20); synthetic
      // ones are keyed by the weapon id.
      const perShot = WEAPON_DAMAGE[bin.type] || WEAPON_DAMAGE[binName] || 1;
      const score = perShot * 1000 + bin.shots;
      if (score > bestScore) {
        bestScore = score;
        best = binName;
      }
    }

    return best;
  }

  /**
   * Depth of the water hex the unit is standing in, or 0 on dry land.
   * Depth 1 and 2 are the map terrains; deeper depths only exist in imported
   * terrain, so the depth is parsed from the terrain id.
   */
  waterDepth(unit, gameState) {
    const hexKey = unit && unit.position && unit.position.hexKey;
    if (!hexKey || !gameState || !gameState.map || !gameState.map.hexes) return 0;
    const hexes = gameState.map.hexes;
    const hex = typeof hexes.get === 'function' ? hexes.get(hexKey) : hexes[hexKey];
    const match = /^water_depth(\d+)$/.exec((hex && hex.terrainType) || '');
    return match ? Number(match[1]) : 0;
  }

  /**
   * Operational heat sinks mounted in the legs, counted as physical components
   * rather than critical slots. p46: a double heat sink occupies three critical
   * slots, so three consecutive operational heat-sink slots are one sink.
   */
  operationalLegSinks(unit, slotsPerSink = 1) {
    let sinks = 0;
    for (const leg of ['leftLeg', 'rightLeg']) {
      const slots = (unit.criticalSlots && unit.criticalSlots[leg]) || [];
      let run = 0;
      for (const slot of slots) {
        const isHeatSink = Boolean(slot && slot.item && slot.item.includes('heat_sink'));
        if (isHeatSink && slot.status === 'ok') {
          run += 1;
          if (run >= slotsPerSink) {
            sinks += 1;
            run = 0;
          }
        } else {
          run = 0;
        }
      }
    }
    return sinks;
  }

  /**
   * Extra heat dissipated because the unit is standing in water (p51).
   *
   * p51 DISSIPATING HEAT: "Submerged heat sinks dissipate twice as much heat. A
   * 'Mech standing in Depth 1 water has its leg-mounted heat sinks submerged. A
   * 'Mech standing in Depth 2 or deeper water or prone in Depth 1 or deeper
   * water has all of its heat sinks submerged (even those in the engine). No
   * more than 6 additional heat points per turn can be dissipated due to water."
   *
   * p50 Heat Point Table: "+1 additional per operational single heat sink under
   * water (maximum 6 points), +2 additional per operational double heat sink
   * underwater (maximum 6 points)." The base dissipation already counts every
   * operational sink at its normal value, so "twice as much" is an extra equal
   * to that sink's own value (single +1, double +2), capped at 6.
   *
   * @returns {number} additional heat points dissipated, 0 when not submerged
   */
  waterCoolingBonus(unit, gameState) {
    const depth = this.waterDepth(unit, gameState);
    if (depth <= 0) return 0;

    const type = String((unit.heatSinks && unit.heatSinks.type) || 'single').toLowerCase();
    const perSink = type === 'double' ? 2 : 1;
    const totalSinks = (unit.heatSinks && unit.heatSinks.count) || 0;
    const damagedSinks = (unit.heatSinks && unit.heatSinks.damaged) || 0;
    const operational = Math.max(0, totalSinks - damagedSinks);

    let submerged;
    if (depth >= 2 || unit.prone) {
      // p51: Depth 2+ (or prone in Depth 1) submerges every heat sink, including
      // the ones in the engine.
      submerged = operational;
    } else {
      // p51: Depth 1 standing submerges only the leg-mounted heat sinks.
      submerged = Math.min(operational, this.operationalLegSinks(unit, perSink === 2 ? 3 : 1));
    }

    return Math.min(6, submerged * perSink);
  }

  /**
   * Calculate and apply heat dissipation.
   * @returns {number} Heat dissipated
   */
  applyHeatDissipation(unit, gameState) {
    const dissipation = unit.getHeatDissipation() + this.waterCoolingBonus(unit, gameState);
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
   * Is the 'Mech standing in a burning hex during the Heat Phase? (p50)
   */
  isStandingInFire(unit, gameState) {
    const hexKey = unit && unit.position && unit.position.hexKey;
    const fireHexes = gameState && Array.isArray(gameState.fireHexes)
      ? gameState.fireHexes
      : [];
    return Boolean(hexKey && fireHexes.includes(hexKey));
  }

  /**
   * Burning hexes the 'Mech moved through during this turn's Movement Phase
   * (p50). GameEngine records the entered burning hexes on the unit together
   * with the turn they belong to, so a list left over from an earlier turn is
   * ignored rather than counted twice.
   */
  burningHexesMovedThrough(unit, gameState) {
    const record = unit && unit._burningHexesMovedThrough;
    if (!record || !Array.isArray(record.hexes)) return 0;
    const turn = gameState && gameState.turn;
    if (Number.isFinite(turn) && record.turn !== turn) return 0;
    return record.hexes.length;
  }

  /**
   * Outside heat for the turn (p50 "Outside Heat Sources"): fire, plasma and
   * weather are cumulative, to a maximum of 15 heat points in a single turn.
   * "Fire: During the Heat Phase, a 'Mech in a burning hex absorbs an
   * additional 5 Heat Points. A 'Mech also absorbs 2 Heat Points for each
   * burning hex it moved through during the Movement Phase."
   *
   * @returns {{total: number, weather: number, fire: number, plasma: number,
   *   capped: boolean, standingInFire: boolean, burningHexesMovedThrough: number}}
   */
  resolveOutsideHeat(unit, gameState) {
    const weather = heatPerTurn(gameState.weather);
    const standingInFire = this.isStandingInFire(unit, gameState);
    const burningHexesMovedThrough = this.burningHexesMovedThrough(unit, gameState);
    const fire = fireHeat({ standingInFire, burningHexesMovedThrough });
    // Plasma weapons and other outside sources feed the same accumulator.
    const plasma = Math.max(0, unit._externalHeat || 0);

    const uncapped = weather + fire + plasma;
    const total = capOutsideHeat(uncapped);

    return {
      total,
      weather,
      fire,
      plasma,
      capped: total !== uncapped,
      standingInFire,
      burningHexesMovedThrough
    };
  }

  /**
   * Resolve the heat-induced ammunition explosion (H-08, p52).
   *
   * p52: "When an overheated 'Mech's ammo explodes, the ammunition critical
   * slot with the most destructive ammo per shot explodes first... All of the
   * appropriate ammo type in a single critical slot explodes... Resolve the
   * explosion following the rules in Critical Hit Effects, page [47]." The
   * shared DamageResolver owns that damage: it applies the exploding bin's
   * per-shot Damage Value x its remaining shots to the bin's location,
   * bypassing armour (p44), honoring CASE (p118) and transferring inward, and
   * injures the MechWarrior for 2 points (p58).
   *
   * @param {object} unit
   * @param {string} ammoBin - key of the exploding bin in unit.equipment.ammo
   * @param {object} diceRoller
   * @returns {boolean} true when a bin exploded and its damage was applied
   */
  applyHeatAmmoExplosion(unit, ammoBin, diceRoller) {
    if (!this.damageResolver || typeof this.damageResolver.resolveAmmoExplosion !== 'function') {
      return false;
    }
    return this.damageResolver.resolveAmmoExplosion(unit, ammoBin, diceRoller);
  }

  /**
   * Resolve heat phase for all units.
   *
   * Order follows p51 "RECORDING HEAT BUILD-UP": generate heat (engine critical
   * hits, outside heat sources), then subtract what the heat sinks dissipate,
   * then apply the Heat Scale effects for the resulting level.
   */
  resolveHeatPhase(gameState, diceRoller) {
    const results = [];

    for (const unit of Object.values(gameState.units)) {
      // p47/p50: a damaged engine leaks 5 (first hit) or 10 (second) heat points
      // every turn; p52: not while the 'Mech is shut down. Applied here, in the
      // live Heat Phase, because that is when heat is generated and recorded -
      // not at critical-hit time.
      const engineHeat = this.engineHeatPerTurn(unit);
      if (engineHeat > 0) {
        unit.heat = Math.max(0, unit.heat + engineHeat);
      }

      // p50: outside heat sources (fire, plasma, weather) are cumulative, up to
      // 15 heat points in a single turn, and are recorded before dissipation.
      const outside = this.resolveOutsideHeat(unit, gameState);
      if (outside.total !== 0) {
        unit.heat = Math.max(0, unit.heat + outside.total);
      }

      const dissipation = this.applyHeatDissipation(unit, gameState);
      const heatEffects = this.applyHeatEffects(unit);

      if (engineHeat > 0) {
        heatEffects.effects.push(`Engine critical: +${engineHeat} heat`);
      }

      if (outside.fire > 0) {
        heatEffects.effects.push(`Fire: +${outside.fire} heat`);
      }

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
          // p52: only the most destructive bin explodes, not every bin. The
          // damage itself is the shared DamageResolver's job (H-08): it zeroes
          // that one bin and applies shots x per-shot Damage Value to its
          // location, plus the MechWarrior's 2 points of damage.
          const binName = this.mostDestructiveAmmoBin(unit);
          if (binName && this.applyHeatAmmoExplosion(unit, binName, diceRoller)) {
            heatEffects.effects.push(
              `AMMO EXPLOSION in ${binName}! (rolled ${ammoResult.roll}, needed ${ammoResult.target}+)`
            );
          }
        }
      }

      // p52: with life support gone, heat injures the MechWarrior.
      if (hasLifeSupportHit(unit)) {
        if (unit.heat >= 26) {
          if (typeof unit.applyPilotDamage === 'function') unit.applyPilotDamage(2);
          heatEffects.effects.push('Life support failure: pilot takes 2 damage');
        } else if (unit.heat >= 15) {
          if (typeof unit.applyPilotDamage === 'function') unit.applyPilotDamage(1);
          heatEffects.effects.push('Life support failure: pilot takes 1 damage');
        }
      }

      results.push({
        unitId: unit.id,
        heat: unit.heat,
        dissipation,
        engineHeat,
        outsideHeat: outside.total,
        fireHeat: outside.fire,
        effects: heatEffects.effects
      });
    }

    return results;
  }
}
