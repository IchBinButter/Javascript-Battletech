/**
 * DamageResolver - Damage application and critical hit resolution.
 *
 * Follows the p42 damage flow: armour first, then internal structure, then one
 * roll on the Determining Critical Hits Table (p46/p143) for every hit that
 * reaches the internal structure. A hit that destroys a location resolves only
 * explosive criticals (p42). Excess damage transfers inward (p44), a destroyed
 * side torso blows off its arm, destroying the head kills the MechWarrior
 * (p44), CASE contains an ammunition explosion (p118) and an explosion that is
 * not contained keeps transferring through internal structure (p44).
 *
 * p52 ammunition: every critical slot that holds ammunition is its own bin, and
 * an exploding bin destroys only "all of the appropriate ammo type in a single
 * critical slot" - never the other bins of the same type.
 */

import weaponsData from '../../data/weapons.json' with { type: 'json' };
import {
  hasCASE,
  isCritImmuneItem,
  isExplosiveItem,
  isLimbLocation,
  isMultiSlotItem,
  isTorsoLocation,
  classifyCriticalItem
} from './UnitDamage.js';

/**
 * Damage one shot of this weapon's ammunition does when the bin explodes.
 *
 * p102: "A critical hit to a missile ammunition bin causes damage equal to the
 * launcher size times the number of remaining shots times the damage inflicted
 * per missile" - i.e. the launcher's full Damage Value per shot left in the bin
 * (the worked example is an SRM-6 with 12 shots left: 6 x 12 x 2 = 144). A
 * non-cluster weapon is just its Damage Value per shot.
 */
function ammoDamagePerShot(ammoType) {
  const weapon = weaponsData.weapons.find((w) => w.id === ammoType);
  if (!weapon) return 1;
  if (weapon.cluster && weapon.clusterSize) {
    return (weapon.damage || 1) * weapon.clusterSize;
  }
  return weapon.damage || 1;
}

/** The ammo type a bin feeds: its `type` field, or the bin key without `_ammo`. */
function ammoBinType(bin, key) {
  if (bin && bin.type) return bin.type;
  return String(key || '').replace(/_ammo$/, '');
}

/**
 * p46: an inapplicable slot means "roll both dice again". The bound only exists
 * so a degenerate dice roller cannot spin forever; after it we fall back to the
 * first applicable slot, which is still a legal result.
 */
const MAX_CRIT_SLOT_ATTEMPTS = 24;

export class DamageResolver {
  /**
   * Apply damage to a unit location.
   *
   * @param {object} unit
   * @param {string} location
   * @param {number} damage
   * @param {boolean} [isRear] - the attack came from the rear arc (p42)
   * @param {object} [diceRoller]
   * @param {object} [options]
   * @param {boolean} [options.throughArmorCritical] - this hit was a hit-location
   *   roll of 2, so it also gets a through-armour critical (p32/p139)
   * @returns {{
   *   remaining: number,
   *   absorbedByArmor: number,
   *   penetratedInternal: boolean,
   *   internalDamage: number,
   *   locationDestroyed: boolean,
   *   criticalHits: Array<{slot, item, location, effect}>,
   *   criticalResults: Array<object>,
   *   ammoExplosion: boolean,
   *   transferLocation?: string
   * }}
   */
  applyDamage(unit, location, damage, isRear = false, diceRoller = null, options = {}) {
    const result = {
      remaining: damage,
      absorbedByArmor: 0,
      penetratedInternal: false,
      internalDamage: 0,
      locationDestroyed: false,
      criticalHits: [],
      criticalResults: [],
      ammoExplosion: false
    };

    // p44: damage dealt to an already-destroyed location transfers to the next
    // location inward. This is what makes a missing arm or leg (or a side torso
    // that has already lost its structure) pass damage on instead of absorbing
    // it with leftover armour. A rear attack stays a rear attack on the way in.
    if (unit.internalStructure && unit.internalStructure[location] !== undefined
        && unit.internalStructure[location] <= 0) {
      const transferLocation = this.getTransferLocation(location);
      if (transferLocation) {
        const transferResult = this.applyDamage(unit, transferLocation, damage, isRear, diceRoller);
        result.remaining = transferResult.remaining;
        result.transferLocation = transferLocation;
        result.transferResult = transferResult;
        return result;
      }
      result.remaining = damage;
      return result;
    }

    const armorLoc = unit.armor && unit.armor[location];
    if (!armorLoc) {
      result.remaining = damage;
      return result;
    }

    // p42: a rear attack uses the rear torso armour. Arms, legs and the head
    // have no rear armour, so those hits always face front armour.
    const rearFacing = Boolean(isRear) && isTorsoLocation(location);
    let remaining = damage;
    const armorVal = (rearFacing ? armorLoc.rear : armorLoc.front) || 0;

    if (armorVal > 0) {
      const absorbed = Math.min(remaining, armorVal);
      remaining -= absorbed;
      result.absorbedByArmor = absorbed;
      if (rearFacing) {
        armorLoc.rear -= absorbed;
      } else {
        armorLoc.front -= absorbed;
      }
    }

    // p32/p139: a hit-location roll of 2 allows a critical hit in the torso
    // rolled even while its armour is intact ("through-armour critical").
    if (options.throughArmorCritical && diceRoller) {
      const tac = this.applyThroughArmorCritical(unit, location, diceRoller);
      if (tac) {
        result.throughArmorCritical = tac;
        this._collectCriticals(tac, result);
      }
    }

    // Apply remaining damage to internal structure
    if (remaining > 0 && unit.internalStructure[location] !== undefined) {
      const internalBefore = unit.internalStructure[location];
      const absorbedInternal = Math.min(remaining, internalBefore);
      remaining -= absorbedInternal;
      unit.internalStructure[location] = internalBefore - absorbedInternal;
      result.internalDamage = absorbedInternal;
      result.penetratedInternal = absorbedInternal > 0;

      const destroyedNow = unit.internalStructure[location] <= 0;

      // p46: internal structure damage forces one roll on the Determining
      // Critical Hits Table. p42: if this hit also destroys the location, only
      // critical hits that strike explosive components are resolved.
      if (diceRoller && absorbedInternal > 0) {
        const crit = this.applyCriticalHit(unit, location, diceRoller, {
          explosiveOnly: destroyedNow
        });
        result.criticalResults.push(crit);
        this._collectCriticals(crit, result);
      }

      if (destroyedNow) {
        result.locationDestroyed = true;
        this.handleLocationDestruction(unit, location, diceRoller);
      }

      result.remaining = remaining;

      // p44: excess damage transfers inward. "Damage dealt to the rear hit
      // zone that transfers inward transfers to the appropriate rear torso
      // facing", so the arc travels with the damage even though a limb itself
      // only has front armour.
      if (remaining > 0 && destroyedNow) {
        const transferLocation = this.getTransferLocation(location);
        if (transferLocation) {
          const transferResult = this.applyDamage(unit, transferLocation, remaining, isRear, diceRoller);
          result.remaining = transferResult.remaining;
          result.transferLocation = transferLocation;
          result.transferResult = transferResult;
        }
      }

      return result;
    }

    result.remaining = remaining;
    return result;
  }

  /** Fold one crit-table result into an applyDamage result. */
  _collectCriticals(crit, result) {
    if (!crit || !Array.isArray(crit.criticals)) return;
    if (crit.criticals.length > 0) {
      result.criticalHits.push(...crit.criticals);
      if (crit.criticals.some((c) => c.ammoExplosion)) {
        result.ammoExplosion = true;
      }
    }
  }

  /**
   * Through-armour critical (p32/p139): a hit-location roll of 2 lets the
   * attacker roll once on the Determining Critical Hits Table even though the
   * armour in that torso is still intact. The armour takes only the normal
   * damage; the critical is additional.
   */
  applyThroughArmorCritical(unit, location, diceRoller) {
    if (!diceRoller || !isTorsoLocation(location)) return null;
    return this.applyCriticalHit(unit, location, diceRoller, { throughArmor: true });
  }

  /**
   * Roll on the Determining Critical Hits Table (p46/p143) and apply the result.
   *
   * 2-7 no critical hit; 8-9 one critical; 10-11 two criticals; 12 blows the
   * head or a limb off, or inflicts three critical hits on a torso.
   *
   * @returns {{location, roll, criticals: Array<object>, blownOff: boolean, throughArmor: boolean}}
   */
  applyCriticalHit(unit, location, diceRoller, options = {}) {
    const table = this.rollCriticalHits(location, diceRoller);
    const result = {
      location,
      roll: table.roll,
      criticals: [],
      blownOff: false,
      throughArmor: Boolean(options.throughArmor)
    };

    if (table.blownOff) {
      result.blownOff = this.blowOffLocation(unit, location);
      return result;
    }

    for (let i = 0; i < table.criticals; i++) {
      const crit = this.resolveCriticalSlot(unit, location, diceRoller, options);
      if (crit) result.criticals.push(crit);
    }

    return result;
  }

  /** The p46 Determining Critical Hits bands, without applying anything. */
  rollCriticalHits(location, diceRoller) {
    const roll = this._roll2d6(diceRoller);
    if (roll <= 7) return { roll, criticals: 0, blownOff: false };
    if (roll <= 9) return { roll, criticals: 1, blownOff: false };
    if (roll <= 11) return { roll, criticals: 2, blownOff: false };

    // 12: "Head or Limb Blown Off / Roll 3 Critical Hit Locations (Roll 3
    // critical hit locations if the hit struck a torso location)" - p46.
    const blowsOff = location === 'head' || isLimbLocation(location);
    return { roll, criticals: blowsOff ? 0 : 3, blownOff: blowsOff };
  }

  /**
   * Apply one critical hit to a slot of the location.
   *
   * p46: the critical table of a torso or arm is two blocks of six slots - 1D6
   * for the block (1-3 / 4-6) and 1D6 for the slot inside it. The head and legs
   * have a single block of six, so one 1D6 picks the slot. Inapplicable slots
   * mean roll both dice again.
   */
  resolveCriticalSlot(unit, location, diceRoller, options = {}) {
    const slots = unit.criticalSlots && unit.criticalSlots[location];
    if (!slots || slots.length === 0) return null;

    const slot = this.selectCriticalSlot(unit, location, slots, diceRoller);
    if (!slot) return null;

    const crit = { slot: slot.slot, item: slot.item, location };

    // p46 Multi-slot Components: a hit on another slot of a component that is
    // already disabled has no further effect, but soaks up the hit.
    if (this.isSoakedSlot(unit, location, slots, slot)) {
      slot.status = 'destroyed';
      return { ...crit, effect: 'no further effect (component already destroyed)', soaked: true };
    }

    // p42: when the hit destroyed the location, only explosive components are
    // resolved; the other critical hit results are discarded.
    if (options.explosiveOnly && !isExplosiveItem(slot.item)) {
      return { ...crit, effect: 'discarded (location destroyed)', discarded: true };
    }

    slot.status = 'destroyed';
    return { ...crit, ...this.applyItemCritical(unit, slot, location, diceRoller) };
  }

  /**
   * Pick the slot a single critical hit lands in. Returns null when the whole
   * location has nothing left that can take a critical hit.
   */
  selectCriticalSlot(unit, location, slots, diceRoller) {
    const size = slots.length;

    // A torso or arm has two blocks of six slots; the head and legs have one.
    const blocks = size > 6
      ? [{ start: 0, length: 6 }, { start: 6, length: size - 6 }]
      : [{ start: 0, length: size }];

    // p46: "If one of the blocks of six is filled entirely with inapplicable
    // slots, simply ignore that block and only roll 1D6" - so a usable block is
    // chosen first when the other one cannot take a critical hit at all.
    const usable = blocks.filter((block) => slots
      .slice(block.start, block.start + block.length)
      .some((slot) => this.isApplicableSlot(slot)));
    if (usable.length === 0) return null;

    for (let attempt = 0; attempt < MAX_CRIT_SLOT_ATTEMPTS; attempt++) {
      let index;
      if (usable.length === 1 && blocks.length === 1) {
        // Head or leg: one 1D6 for the single block of six.
        index = this._roll1d6(diceRoller) - 1;
      } else if (usable.length === 1) {
        // Only one of the two torso/arm blocks can take the hit.
        index = usable[0].start + this._roll1d6(diceRoller) - 1;
      } else {
        const blockRoll = this._roll1d6(diceRoller);
        const block = blockRoll <= 3 ? blocks[0] : blocks[1];
        index = block.start + this._roll1d6(diceRoller) - 1;
      }

      if (index < 0 || index >= size) continue;
      const slot = slots[index];
      if (!this.isApplicableSlot(slot)) continue;
      return slot;
    }

    return slots.find((slot) => this.isApplicableSlot(slot)) || null;
  }

  /** p46 Inapplicable Slots: already hit, empty, or immune to critical damage. */
  isApplicableSlot(slot) {
    if (!slot) return false;
    if (slot.status === 'destroyed') return false;
    return !isCritImmuneItem(slot.item);
  }

  /**
   * Is this slot part of a multi-slot component that has already been disabled
   * by an earlier critical hit? (p46, "soak up the hit")
   */
  isSoakedSlot(unit, location, slots, slot) {
    if (!isMultiSlotItem(slot.item, unit)) return false;
    const key = this.componentKey(unit, location, slots, slot);
    return slots.some((other) => other !== slot
      && other.status === 'destroyed'
      && this.componentKey(unit, location, slots, other) === key);
  }

  /**
   * Identity of the physical component a slot belongs to. Slots are grouped
   * into consecutive runs of the same item and then into components of the
   * size that item occupies.
   */
  componentKey(unit, location, slots, slot) {
    const kind = classifyCriticalItem(slot.item);

    // The life-support package is one component even though the record sheet
    // splits its slots. Sensors are explicitly not (p46): each sensor slot is
    // its own component, so there is no key to merge.
    if (kind === 'life_support') {
      return `${location}#${slot.item}`;
    }

    const index = slots.indexOf(slot);
    const span = this.slotsPerComponent(unit, location, slot.item);
    if (span <= 1) return `${location}#${index}`;

    let start = index;
    while (start > 0 && slots[start - 1].item === slot.item) start -= 1;
    const componentIndex = Math.floor((index - start) / span);
    return `${location}#${slot.item}#${start}#${componentIndex}`;
  }

  /**
   * How many slots one physical component fills. A single heat sink, ammunition
   * bin, jump jet or actuator is one slot; a double heat sink fills three (p46's
   * multi-slot example), the life-support package two, and a weapon as many slots
   * as the roster shows for it. Sensors are one slot per component (p46 exception).
   */
  slotsPerComponent(unit, location, item) {
    const kind = classifyCriticalItem(item);
    const slots = (unit.criticalSlots && unit.criticalSlots[location]) || [];
    const count = slots.filter((s) => s.item === item).length;

    if (kind === 'heat_sink') {
      // A double heat sink fills three slots, a single one slot.
      const type = String(unit.heatSinks && unit.heatSinks.type || '').toLowerCase();
      return type === 'double' ? 3 : 1;
    }

    if (kind === 'life_support') {
      return Math.max(1, count);
    }

    if (kind === 'equipment') {
      const weapons = (unit.equipment && unit.equipment.weapons) || [];
      const inLocation = weapons.filter((w) => w.location === location && w.type === item).length;
      if (inLocation > 0) return Math.max(1, Math.round(count / inLocation));
      return 1;
    }

    return 1;
  }

  /** Resolve the game effect of destroying one slot's item (p47-49). */
  applyItemCritical(unit, slot, location, diceRoller) {
    switch (classifyCriticalItem(slot.item)) {
      case 'ammo': {
        // p52: the hit slot is its own bin. Only that bin explodes; any other
        // bins of the same ammo type in the unit stay loaded.
        const binKey = this.findAmmoBinKey(unit, location, slot);
        const exploded = binKey
          ? this.resolveAmmoExplosion(unit, binKey, diceRoller, location)
          : false;
        return {
          ammoBin: binKey,
          ammoExplosion: exploded,
          effect: exploded ? 'AMMO EXPLOSION!' : 'Ammo bin destroyed'
        };
      }
      case 'engine':
        if (!unit.engine) unit.engine = { hits: 0 };
        if ((unit.engine.hits || 0) >= 3) {
          return { effect: 'no further effect (engine already destroyed)', soaked: true };
        }
        unit.engine.hits = (unit.engine.hits || 0) + 1;
        // p47: the third engine critical destroys the Mech.
        if (unit.engine.hits >= 3) unit.destroyed = true;
        return {
          effect: unit.engine.hits >= 3
            ? 'Engine destroyed - unit disabled!'
            : `Engine hit (${unit.engine.hits})`
        };
      case 'gyro':
        if (!unit.gyro) unit.gyro = { hits: 0 };
        if ((unit.gyro.hits || 0) >= 2) {
          return { effect: 'no further effect (gyro already destroyed)', soaked: true };
        }
        unit.gyro.hits = (unit.gyro.hits || 0) + 1;
        // p48: a destroyed gyro puts the Mech on the ground.
        if (unit.gyro.hits >= 2) unit.prone = true;
        return {
          effect: unit.gyro.hits >= 2
            ? 'Gyro destroyed - auto-fall!'
            : `Gyro hit (${unit.gyro.hits})`
        };
      case 'cockpit':
        this.killPilot(unit);
        return { effect: 'COCKPIT DESTROYED - PILOT KILLED!' };
      case 'sensors':
        // p46 excepts the sensors from one-hit disable, so every sensor slot is
        // its own critical and each hit applies the p28 "Sensor hit +2" (the p49
        // effect text is not in the KB, so nothing more is claimed here).
        return { effect: 'Sensors hit (+2 TN)' };
      case 'life_support':
        return { effect: 'Life support destroyed' };
      case 'heat_sink':
        if (!unit.heatSinks) unit.heatSinks = { damaged: 0 };
        unit.heatSinks.damaged = (unit.heatSinks.damaged || 0) + 1;
        return { effect: `Heat sink destroyed (${unit.heatSinks.damaged} damaged)` };
      case 'jump_jet':
        return { effect: 'Jump jet destroyed' };
      case 'ecm':
        return { effect: 'ECM destroyed' };
      default:
        return { effect: `${slot.item} destroyed` };
    }
  }

  /**
   * The ammunition bin a critical slot occupies (p52: one bin per slot).
   *
   * Roster and imported bins carry the `location` and `slot` they sit in, so a
   * critical hit on one of several bins of the same type explodes only that
   * bin. A fixture whose bins carry no slot metadata falls back to the
   * critical-slot item id (the original single-entry-per-type model).
   *
   * @param {object} unit
   * @param {string} location
   * @param {object} slot - the critical slot that was hit
   * @returns {string|null} key into unit.equipment.ammo
   */
  findAmmoBinKey(unit, location, slot) {
    if (!slot) return null;
    const ammo = (unit.equipment && unit.equipment.ammo) || {};

    for (const [key, bin] of Object.entries(ammo)) {
      if (bin && bin.location === location && bin.slot === slot.slot) return key;
    }

    for (const [key, bin] of Object.entries(ammo)) {
      if (!bin) continue;
      if (bin.location && bin.location !== location) continue;
      if (key === slot.item || `${bin.type}_ammo` === slot.item) return key;
    }

    return null;
  }

  /**
   * Resolve the bin a resolveAmmoExplosion call names.
   *
   * An exact bin key wins. Callers that pass an ammo type id instead (the
   * original API, and synthetic heat fixtures keyed by weapon id) get a bin of
   * that type: one in the given location when there is one, otherwise the bin
   * with the most shots remaining - p52's own tie-break, "the one with the most
   * shots remaining explodes".
   *
   * @returns {{key: string, bin: object}|null}
   */
  findAmmoBin(unit, ammoBin, location = null) {
    if (!ammoBin) return null;
    const ammo = (unit.equipment && unit.equipment.ammo) || {};
    if (Object.prototype.hasOwnProperty.call(ammo, ammoBin) && ammo[ammoBin]) {
      return { key: ammoBin, bin: ammo[ammoBin] };
    }

    const type = String(ammoBin || '').replace(/_ammo$/, '');
    const candidates = Object.entries(ammo).filter(([key, bin]) => {
      if (!bin) return false;
      return key === ammoBin
        || bin.type === ammoBin
        || bin.type === type
        || `${bin.type}_ammo` === ammoBin;
    });
    if (candidates.length === 0) return null;

    const atLocation = location
      ? candidates.filter(([, bin]) => bin.location === location)
      : [];
    const pool = atLocation.length > 0 ? atLocation : candidates;
    const best = pool.reduce((chosen, entry) => (
      (entry[1].shots || 0) > (chosen[1].shots || 0) ? entry : chosen
    ));
    return { key: best[0], bin: best[1] };
  }

  /**
   * Where a bin sits: the hit location first (a critical hit knows the slot it
   * struck), then the bin's own location metadata, then a scan of the critical
   * slots for the bin's item.
   */
  ammoBinLocation(unit, key, bin, explodedLocation = null) {
    if (explodedLocation) return explodedLocation;
    if (bin && bin.location) return bin.location;

    const itemId = bin && bin.type ? `${bin.type}_ammo` : key;
    for (const [location, slots] of Object.entries(unit.criticalSlots || {})) {
      if ((slots || []).some((s) => s.item === itemId || s.item === key)) return location;
    }
    return null;
  }

  /**
   * Resolve an ammunition explosion (p52/p96/p102/p118/p44).
   *
   * Exactly one bin explodes: the named bin (a critical hit names the slot it
   * destroyed, a heat-induced explosion names the bin HeatManager selected). Its
   * damage is the per-shot Damage Value times the shots remaining in that bin -
   * for a missile launcher, launcher size x damage per missile per shot (p102).
   * The explosion bypasses armour and, unless CASE contains it, keeps
   * transferring through internal structure (p44); the MechWarrior takes 2
   * points of damage (p58). Other bins of the same ammo type are untouched.
   *
   * @param {object} unit
   * @param {string} ammoBin - key into unit.equipment.ammo, e.g. 'lrm20_ammo' or
   *   'lrm20_ammo#2'; an ammo type id (e.g. 'lrm20' / 'lrm20_ammo') is also
   *   accepted for callers that only know the type
   * @param {object} [diceRoller]
   * @param {string} [explodedLocation] - location of the slot that was hit; when
   *   omitted the bin's own location is used
   * @returns {boolean} true when a bin with shots remaining exploded
   */
  resolveAmmoExplosion(unit, ammoBin, diceRoller, explodedLocation = null) {
    const found = this.findAmmoBin(unit, ammoBin, explodedLocation);
    if (!found || !found.bin || (found.bin.shots || 0) <= 0) return false;
    const { key, bin } = found;

    // p52: all of the appropriate ammo in that one critical slot explodes; the
    // other bins of the same type stay loaded.
    const perShot = ammoDamagePerShot(ammoBinType(bin, key));
    const explosionDamage = (bin.shots || 0) * perShot;
    bin.shots = 0;

    // p58: an ammunition explosion injures the MechWarrior for 2 points.
    if (typeof unit.applyPilotDamage === 'function') {
      unit.applyPilotDamage(2);
    }

    const location = this.ammoBinLocation(unit, key, bin, explodedLocation);
    if (location) {
      this.applyExplosionDamage(unit, location, explosionDamage, diceRoller);
    }

    return true;
  }

  /**
   * Apply explosion damage to internal structure, bypassing armour.
   *
   * p118 CASE: damage goes to the internal structure of the location that holds
   * the ammunition and any excess is ignored instead of transferring. Without
   * CASE, p44: the excess transfers to the next location inward, still bypassing
   * armour.
   */
  applyExplosionDamage(unit, location, damage, diceRoller) {
    const seen = new Set();
    let loc = location;
    let remaining = damage;

    while (loc && remaining > 0 && !seen.has(loc)) {
      seen.add(loc);
      const structure = unit.internalStructure ? unit.internalStructure[loc] : undefined;
      if (structure === undefined) break;

      const absorbed = Math.min(remaining, structure);
      unit.internalStructure[loc] = structure - absorbed;
      remaining -= absorbed;

      if (unit.internalStructure[loc] <= 0) {
        this.handleLocationDestruction(unit, loc, diceRoller);
      }

      // p118: CASE contains the blast in this location; excess is ignored.
      if (hasCASE(unit, loc)) return;

      loc = this.getTransferLocation(loc);
    }
  }

  /**
   * Handle effects of a location being destroyed.
   */
  handleLocationDestruction(unit, location) {
    switch (location) {
      case 'head':
      case 'centerTorso':
        unit.destroyed = true;
        if (location === 'head') {
          // p44: destroying the head kills the MechWarrior.
          this.killPilot(unit);
        }
        break;
      case 'leftArm':
      case 'rightArm':
        // Arm destroyed: weapons in the arm are lost with it.
        if (unit.equipment && Array.isArray(unit.equipment.weapons)) {
          unit.equipment.weapons = unit.equipment.weapons.filter((w) => w.location !== location);
        }
        break;
      case 'leftLeg':
      case 'rightLeg':
        // Leg destroyed: the Mech falls.
        unit.prone = true;
        break;
      case 'leftTorso':
      case 'rightTorso':
        // p44/p118: the loss of all internal structure in a side torso blows
        // off the arm on that side. The arm is not damaged by the destruction
        // itself - its armor stays on the record sheet.
        this.blowOffLimb(unit, location === 'leftTorso' ? 'leftArm' : 'rightArm');
        break;
    }
  }

  /**
   * A 12 on the Determining Critical Hits Table blows off a limb or the head
   * (p46). Returns whether this location can be blown off.
   */
  blowOffLocation(unit, location) {
    if (!unit.internalStructure) return false;

    if (location === 'head') {
      unit.internalStructure.head = 0;
      unit.destroyed = true;
      this.killPilot(unit);
      return true;
    }

    if (!isLimbLocation(location)) return false;

    this.blowOffLimb(unit, location);
    if (location === 'leftLeg' || location === 'rightLeg') {
      unit.prone = true;
    }
    return true;
  }

  /**
   * Blow a limb off without damaging it: the location loses its internal
   * structure, the arm's or leg's own armor is left alone, its weapons are lost
   * and its slots are gone.
   */
  blowOffLimb(unit, location) {
    if (!unit.internalStructure || unit.internalStructure[location] === undefined) return;
    unit.internalStructure[location] = 0;

    for (const slot of (unit.criticalSlots && unit.criticalSlots[location]) || []) {
      if (slot.item !== 'empty') slot.status = 'destroyed';
    }

    if (unit.equipment && Array.isArray(unit.equipment.weapons)) {
      unit.equipment.weapons = unit.equipment.weapons.filter((w) => w.location !== location);
    }
  }

  /** Kill the MechWarrior (p44 head destruction, p47 cockpit critical). */
  killPilot(unit) {
    if (!unit.pilot) return;
    unit.pilot.dead = true;
    unit.pilot.conscious = false;
  }

  /**
   * Directly destroy a location.
   */
  destroyLocation(unit, location) {
    const armorLoc = unit.armor && unit.armor[location];
    if (armorLoc) {
      armorLoc.front = 0;
      armorLoc.rear = 0;
    }
    if (unit.internalStructure && unit.internalStructure[location] !== undefined) {
      unit.internalStructure[location] = 0;
    }
    this.handleLocationDestruction(unit, location);
  }

  /**
   * Get the location damage transfers to when a location is destroyed (p44).
   *
   * Damage to a missing arm or leg transfers to the torso on the same side;
   * additional damage to a destroyed side torso transfers to the centre torso.
   * Damage from a destroyed head or centre torso does not transfer.
   */
  getTransferLocation(location) {
    const transferMap = {
      leftArm: 'leftTorso',
      rightArm: 'rightTorso',
      leftLeg: 'leftTorso',
      rightLeg: 'rightTorso',
      leftTorso: 'centerTorso',
      rightTorso: 'centerTorso'
    };
    return transferMap[location] || null;
  }

  _roll2d6(diceRoller) {
    if (diceRoller && typeof diceRoller.roll2d6 === 'function') return diceRoller.roll2d6();
    return this._roll1d6(diceRoller) + this._roll1d6(diceRoller);
  }

  _roll1d6(diceRoller) {
    if (diceRoller && typeof diceRoller.roll1d6 === 'function') return diceRoller.roll1d6();
    if (diceRoller && typeof diceRoller.next === 'function') {
      return Math.floor(diceRoller.next() * 6) + 1;
    }
    return 1;
  }
}
