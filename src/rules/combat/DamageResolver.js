/**
 * DamageResolver - Damage application and critical hit resolution.
 * Handles armor → internal → critical hits, location destruction, ammo explosions.
 */

import weaponsData from '../../data/weapons.json' with { type: 'json' };

const weaponDamageLookup = {};
for (const w of weaponsData.weapons) {
  weaponDamageLookup[w.id] = w.damage;
}

export class DamageResolver {
  /**
   * Apply damage to a unit location.
   * @returns {{
   *   remaining: number,
   *   absorbedByArmor: number,
   *   penetratedInternal: boolean,
   *   internalDamage: number,
   *   locationDestroyed: boolean,
   *   criticalHits: Array<{slot, item, effect}>
   * }}
   */
  applyDamage(unit, location, damage, isRear = false, diceRoller = null) {
    const result = {
      remaining: damage,
      absorbedByArmor: 0,
      penetratedInternal: false,
      internalDamage: 0,
      locationDestroyed: false,
      criticalHits: [],
      ammoExplosion: false
    };

    const armorLoc = unit.armor[location];
    if (!armorLoc) {
      result.remaining = damage;
      return result;
    }

    // Apply to armor
    let remaining = damage;
    const armorVal = isRear ? (armorLoc.rear || 0) : armorLoc.front;

    if (armorVal > 0) {
      const absorbed = Math.min(remaining, armorVal);
      remaining -= absorbed;
      result.absorbedByArmor = absorbed;
      if (isRear) {
        armorLoc.rear -= absorbed;
      } else {
        armorLoc.front -= absorbed;
      }
    }

    // Apply remaining to internal structure
    if (remaining > 0 && unit.internalStructure[location] !== undefined) {
      result.penetratedInternal = true;
      const internalBefore = unit.internalStructure[location];
      const absorbed = Math.min(remaining, internalBefore);
      remaining -= absorbed;
      unit.internalStructure[location] -= absorbed;
      result.internalDamage = absorbed;

      // Single critical hit check per internal hit
      if (diceRoller && absorbed > 0) {
        const crit = this.applyCriticalHit(unit, location, diceRoller);
        if (crit) {
          result.criticalHits.push(crit);
          if (crit.ammoExplosion) {
            result.ammoExplosion = true;
          }
        }
      }

      if (unit.internalStructure[location] <= 0) {
        result.locationDestroyed = true;
        this.handleLocationDestruction(unit, location, diceRoller);
      }
    }

    result.remaining = remaining;

    // Transfer remaining damage
    if (remaining > 0 && result.locationDestroyed && location !== 'centerTorso' && location !== 'head') {
      // Damage transfers to next inward location
      let transferLocation = this.getTransferLocation(location);
      if (transferLocation && unit.isLocationDestroyed(transferLocation)) {
        transferLocation = 'centerTorso';
      }
      if (transferLocation) {
        const transferResult = this.applyDamage(unit, transferLocation, remaining, false, diceRoller);
        result.remaining = transferResult.remaining;
        result.transferLocation = transferLocation;
      }
    }

    return result;
  }

  /**
   * Apply a critical hit to a random slot in the given location.
   */
  applyCriticalHit(unit, location, diceRoller) {
    const slots = unit.criticalSlots[location];
    if (!slots || slots.length === 0) return null;

    // Roll to see if it's a critical hit (8+ on 2D6)
    const critRoll = diceRoller.roll2d6();
    if (critRoll < 8) return null;

    // Find a non-destroyed slot
    const validSlots = slots.filter(s => s.status === 'ok' && s.item !== 'empty');
    if (validSlots.length === 0) return null;

    const slot = validSlots[Math.floor(diceRoller.next() * validSlots.length)];
    slot.status = 'destroyed';

    const critResult = { slot: slot.slot, item: slot.item, location, effect: '' };

    // Handle specific item effects
    switch (true) {
      case slot.item.includes('ammo'):
        critResult.ammoExplosion = this.resolveAmmoExplosion(unit, slot.item, diceRoller);
        critResult.effect = critResult.ammoExplosion ? 'AMMO EXPLOSION!' : 'Ammo bin destroyed';
        break;
      case slot.item === 'engine':
        unit.engine.hits++;
        critResult.effect = unit.engine.hits >= 3 ? 'Engine destroyed - unit disabled!' : `Engine hit (${unit.engine.hits})`;
        break;
      case slot.item === 'gyro':
        unit.gyro.hits++;
        critResult.effect = unit.gyro.hits >= 2 ? 'Gyro destroyed - auto-fall!' : `Gyro hit (${unit.gyro.hits})`;
        break;
      case slot.item === 'cockpit':
        critResult.effect = 'COCKPIT DESTROYED - PILOT KILLED!';
        unit.pilot.conscious = false;
        break;
      case slot.item === 'sensors':
        critResult.effect = 'Sensors destroyed (+1 TN)';
        break;
      case slot.item === 'life_support':
        critResult.effect = 'Life support destroyed';
        break;
      case slot.item.includes('heat_sink'):
        unit.heatSinks.damaged++;
        critResult.effect = `Heat sink destroyed (${unit.heatSinks.damaged} damaged)`;
        break;
      case slot.item.includes('jump_jet'):
        critResult.effect = 'Jump jet destroyed';
        break;
      case slot.item === 'ecm':
        critResult.effect = 'ECM destroyed';
        break;
      default:
        critResult.effect = `${slot.item} destroyed`;
    }

    return critResult;
  }

  /**
   * Resolve ammo explosion.
   * Damage = remaining shots × weapon damage. Applied directly to internal.
   */
  resolveAmmoExplosion(unit, ammoBin, diceRoller) {
    const ammo = unit.equipment.ammo[ammoBin];
    if (!ammo || ammo.shots <= 0) return false;

    // Find which location this ammo is in
    let location = null;
    for (const loc of Object.keys(unit.criticalSlots)) {
      const slots = unit.criticalSlots[loc];
      if (slots.some(s => s.item === ammoBin)) {
        location = loc;
        break;
      }
    }

    // Calculate explosion damage
    // Ammo damage = remaining shots × weapon damage
    const wpnType = ammo.type;
    const wpnDamage = weaponDamageLookup[wpnType] || 1;
    const explosionDamage = ammo.shots * wpnDamage;
    ammo.shots = 0; // All ammo destroyed

    // p52: an ammunition explosion injures the MechWarrior for 2 points.
    if (typeof unit.applyPilotDamage === 'function') {
      unit.applyPilotDamage(2);
    }

    if (location) {
      // Check for CASE in this location only (must be equipped in same location as ammo)
      const hasCase = unit.criticalSlots[location].some(s => s.item === 'case' && s.status === 'ok');
      if (hasCase) {
        this.destroyLocation(unit, location);
        return true;
      }

      // No CASE: full internal damage to location (and potentially transfer)
      // Apply damage directly bypassing armor
      unit.internalStructure[location] = Math.max(0, unit.internalStructure[location] - explosionDamage);
      if (unit.internalStructure[location] <= 0) {
        this.handleLocationDestruction(unit, location, diceRoller);
      }
    }

    return true;
  }

  /**
   * Handle effects of a location being destroyed.
   */
  handleLocationDestruction(unit, location, diceRoller) {
    switch (location) {
    case 'head':
    case 'centerTorso':
      unit.destroyed = true;
      break;
      case 'leftArm':
      case 'rightArm':
        // Arm destroyed: weapons in arm lost, can't punch with it
        // Remove weapons from that arm
        unit.equipment.weapons = unit.equipment.weapons.filter(w => w.location !== location);
        break;
      case 'leftLeg':
      case 'rightLeg':
        // Leg destroyed: unit falls, movement halved
        if (!unit.prone) {
          unit.prone = true;
        }
        break;
      case 'leftTorso':
      case 'rightTorso':
        // Torso destruction: arm on that side also destroyed
        const arm = location === 'leftTorso' ? 'leftArm' : 'rightArm';
        if (!unit.isLocationDestroyed(arm)) {
          this.destroyLocation(unit, arm);
        }
        break;
    }
  }

  /**
   * Directly destroy a location.
   */
  destroyLocation(unit, location) {
    const armorLoc = unit.armor[location];
    if (armorLoc) {
      armorLoc.front = 0;
      armorLoc.rear = 0;
    }
    if (unit.internalStructure[location] !== undefined) {
      unit.internalStructure[location] = 0;
    }
    this.handleLocationDestruction(unit, location);
  }

  /**
   * Get the location damage transfers to when a location is destroyed.
   */
  getTransferLocation(location) {
    const transferMap = {
      leftArm: 'leftTorso',
      rightArm: 'rightTorso',
      leftLeg: 'leftTorso',
      rightLeg: 'rightTorso',
      leftTorso: 'leftArm',
      rightTorso: 'rightArm',
      head: 'centerTorso'
    };
    return transferMap[location] || null;
  }
}
