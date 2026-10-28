/**
 * PhysicalAttackResolver - physical attacks (BMM p34-40).
 *
 * Base target numbers (Physical Attack Modifiers Table, p137):
 *   punch 0, kick -2, push -1, club -1, charge and DFA use the comparative
 *   Piloting Skill modifier (p34).
 *
 * Damage (p38): punch 1 per 10 tons, kick 1 per 5 tons, physical weapons per
 * the p38 table, charge attacker tonnage/10 per hex charged. Fractions round up.
 *
 * Attacking across levels uses the Different Levels table (p140), which decides
 * both what can be attempted and which hit location table applies.
 */

import { hexDistance, directionBetween } from '../../hex/HexMath.js';
import { getTargetArc, ARC } from './ArcRules.js';
import { getActuatorDamage as readActuatorDamage } from './UnitDamage.js';
import hitTables from '../../data/hitTables.json' with { type: 'json' };
import physicalWeapons from '../../data/physicalWeapons.json' with { type: 'json' };

const PUNCH_TABLE = hitTables.hitLocation.punch;
const KICK_TABLE = hitTables.hitLocation.kick;

/** Base target number modifier by attack type (p137). */
const BASE_MODIFIER = {
  punch: 0,
  kick: -2,
  push: -1,
  club: -1,
  charge: 0,
  dfa: 0
};

/** p37: a DFA always applies the +3 jumping modifier; it is not pre-applied. */
const DFA_JUMPING_MODIFIER = 3;

/** A declared option-table attack costs +4 (p38 footnote). */
const OPTION_TABLE_MODIFIER = 4;

const PHYSICAL_WEAPON_LIST = physicalWeapons.weapons;

export class PhysicalAttackResolver {
  constructor() {
    this.physicalWeapons = PHYSICAL_WEAPON_LIST;
  }

  /** Look up a physical weapon definition by id or definition. */
  getPhysicalWeapon(idOrDef) {
    if (!idOrDef) return null;
    if (typeof idOrDef === 'object') return idOrDef;
    return this.physicalWeapons.find(w => w.id === idOrDef) || null;
  }

  /**
   * Destroyed actuators in a location, by kind (p29, p47-49).
   * Shared with the weapon-attack modifiers and movement rules.
   */
  getActuatorDamage(unit, location) {
    return readActuatorDamage(unit, location);
  }

  _destroyed(unit, location) {
    return typeof unit.isLocationDestroyed === 'function'
      ? unit.isLocationDestroyed(location)
      : false;
  }

  /** Did this 'Mech fire from that location this turn? */
  _firedFrom(unit, location) {
    const fired = unit.firedThisTurn;
    if (!fired) return false;
    if (typeof fired.has === 'function') return fired.has(location);
    if (Array.isArray(fired)) return fired.includes(location);
    return false;
  }

  /**
   * Punch modifiers for one arm (p29): a destroyed shoulder forbids punching,
   * each arm actuator adds +2 and halves the damage, a hand actuator adds +1.
   * An arm that fired this turn cannot punch at all (p38).
   */
  punchModifiers(unit, arm) {
    if (!arm) return { legal: true, tn: 0, damageMultiplier: 1 };
    if (this._destroyed(unit, arm)) {
      return { legal: false, reason: `${arm} destroyed` };
    }
    if (this._firedFrom(unit, arm)) {
      return { legal: false, reason: `Weapons fired from ${arm} this turn` };
    }

    const damage = this.getActuatorDamage(unit, arm);
    if (damage.shoulder) {
      return { legal: false, reason: `Shoulder actuator destroyed on ${arm}` };
    }

    let tn = 0;
    let multiplier = 1;
    if (damage.upperArm) { tn += 2; multiplier *= 0.5; }
    if (damage.lowerArm) { tn += 2; multiplier *= 0.5; }
    if (damage.hand) { tn += 1; }

    return { legal: true, tn, damageMultiplier: multiplier };
  }

  /**
   * Physical weapon modifiers for one arm (p29, p38): the weapon needs its arm,
   * and a destroyed hand actuator rules it out entirely.
   */
  physicalWeaponModifiers(unit, arm) {
    if (this._destroyed(unit, arm)) {
      return { legal: false, reason: `${arm} destroyed` };
    }
    if (this._firedFrom(unit, arm)) {
      return { legal: false, reason: `Weapons fired from ${arm} this turn` };
    }

    const damage = this.getActuatorDamage(unit, arm);
    if (damage.shoulder) {
      return { legal: false, reason: `Shoulder actuator destroyed on ${arm}` };
    }
    if (damage.hand) {
      return { legal: false, reason: `Hand actuator destroyed on ${arm}` };
    }

    let tn = 0;
    let multiplier = 1;
    if (damage.upperArm) { tn += 2; multiplier *= 0.5; }
    if (damage.lowerArm) { tn += 2; multiplier *= 0.5; }

    return { legal: true, tn, damageMultiplier: multiplier };
  }

  /**
   * Kick modifiers (p29/p38): both hip actuators must be undamaged to kick at
   * all; each upper or lower leg actuator adds +2 and halves the damage
   * cumulatively; a foot actuator adds +1.
   */
  kickModifiers(unit) {
    for (const leg of ['leftLeg', 'rightLeg']) {
      if (this._destroyed(unit, leg)) {
        return { legal: false, reason: `${leg} destroyed` };
      }
      if (this.getActuatorDamage(unit, leg).hip) {
        return { legal: false, reason: 'Hip actuator destroyed' };
      }
    }

    let tn = 0;
    let multiplier = 1;
    for (const leg of ['leftLeg', 'rightLeg']) {
      const damage = this.getActuatorDamage(unit, leg);
      if (damage.upperLeg) { tn += 2; multiplier *= 0.5; }
      if (damage.lowerLeg) { tn += 2; multiplier *= 0.5; }
      if (damage.foot) { tn += 1; }
    }

    return { legal: true, tn, damageMultiplier: multiplier };
  }

  /** Is the target in the attacker's forward arc? Torso twists are ignored (p38). */
  _inForwardArc(attacker, target) {
    return getTargetArc(attacker, target.position.hexKey) === ARC.FORWARD;
  }

  /** Attack direction: the side of the target the blow comes from (p32). */
  _attackDirection(attacker, target) {
    const bearing = directionBetween(target.position.hexKey, attacker.position.hexKey);
    if (bearing === -1) return 'front';
    const diff = ((bearing - target.position.facing + 3) % 6 + 3) % 6;
    if (diff === 3) return 'rear';
    if (diff === 2) return 'right';
    if (diff === 4) return 'left';
    return 'front';
  }

  _standardLocation(roll, direction) {
    const table = hitTables.hitLocation[direction] || hitTables.hitLocation.front;
    const entry = table[roll.toString()];
    return entry ? { location: entry.location, isRear: Boolean(entry.isRear) } : { location: 'centerTorso', isRear: false };
  }

  /**
   * Different Levels table (p140). Returns why a physical attack is not
   * possible, or null when it is.
   */
  _levelRestriction(type, target, levelDiff) {
    const diff = Number.isFinite(levelDiff) ? levelDiff : 0;
    const proneTarget = Boolean(target.prone);

    if (type === 'dfa') return null; // always allowed

    if (proneTarget) {
      // p140: a prone target one level higher can still be punched or hit with
      // a physical weapon; one level lower only a DFA reaches it.
      if (diff < 0) return 'A prone target below the attacker can only be attacked by DFA';
      if (diff > 1) return 'A prone target above the attacker can only be attacked by DFA';
      if (type === 'punch' || type === 'physicalWeapon') return null;
      return `A prone target cannot be ${type === 'kick' ? 'kicked' : 'charged or pushed'}`;
    }

    if (diff < -1 || diff > 1) return 'Physical attacks only reach one level up or down';
    if (type === 'kick') return diff === -1 ? 'Cannot kick a target one level lower' : null;
    if (type === 'push') return diff === 0 ? null : 'A push needs the target at the same level';
    return null;
  }

  /**
   * Which hit location table an attack at this level difference uses (p140).
   * null means the standard table.
   */
  _tableFor(type, levelDiff) {
    if (type === 'punch') return levelDiff === 1 ? 'kick' : 'punch';
    if (type === 'kick') return levelDiff === 1 ? 'punch' : 'kick';
    if (type === 'physicalWeapon') {
      if (levelDiff === 1) return 'kick';
      if (levelDiff === -1) return 'punch';
      return null;
    }
    return null;
  }

  _pickPunchArm(attacker, target) {
    const arc = getTargetArc(attacker, target.position.hexKey);
    if (arc === ARC.LEFT) return 'leftArm';
    if (arc === ARC.RIGHT) return 'rightArm';
    return 'rightArm';
  }

  /**
   * Resolve a punch attack against one arm.
   * @param {object} [options] - { arm, levelDifference }
   */
  resolvePunch(attacker, target, diceRoller, options = {}) {
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    const levelDiff = options.levelDifference || 0;
    const levelProblem = this._levelRestriction('punch', target, levelDiff);
    if (levelProblem) return { success: false, reason: levelProblem };

    // Punches only reach the forward or side arcs (p38).
    const arc = getTargetArc(attacker, target.position.hexKey);
    if (arc === ARC.REAR) {
      return { success: false, reason: 'Target not in forward or side arc' };
    }

    const arm = options.arm || this._pickPunchArm(attacker, target);
    const armMods = this.punchModifiers(attacker, arm);
    if (!armMods.legal) {
      return { success: false, reason: armMods.reason };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'punch', { arm });
    const roll = diceRoller.roll2d6();
    const hit = roll >= tn;

    let damage = 0;
    let locations = [];

    if (hit) {
      const base = Math.ceil(attacker.tonnage / 10);
      damage = Math.max(1, Math.floor(base * armMods.damageMultiplier));
      const locRoll = diceRoller.roll2d6();
      const table = this._tableFor('punch', levelDiff);
      const location = table === 'kick'
        ? this.kickLocation(locRoll)
        : this.punchLocation(locRoll);
      locations = [{ location, damage }];
    }

    return {
      success: true,
      type: 'punch',
      arm,
      hit,
      roll,
      targetNumber: tn,
      damage,
      hitLocations: locations
    };
  }

  /**
   * Resolve a kick attack.
   */
  resolveKick(attacker, target, diceRoller, options = {}) {
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    const levelDiff = options.levelDifference || 0;
    const levelProblem = this._levelRestriction('kick', target, levelDiff);
    if (levelProblem) return { success: false, reason: levelProblem };

    const legMods = this.kickModifiers(attacker);
    if (!legMods.legal) {
      return { success: false, reason: legMods.reason };
    }
    if (!this._inForwardArc(attacker, target)) {
      return { success: false, reason: 'Target not in forward arc' };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'kick');
    const roll = diceRoller.roll2d6();
    const hit = roll >= tn;

    let damage = 0;
    let locations = [];
    let psrRequired = false;

    if (hit) {
      const base = Math.ceil(attacker.tonnage / 5);
      damage = Math.max(1, Math.floor(base * legMods.damageMultiplier));
      const locRoll = diceRoller.roll2d6();
      const table = this._tableFor('kick', levelDiff);
      const location = table === 'punch'
        ? this.punchLocation(locRoll)
        : this.kickLocation(locRoll);
      locations = [{ location, damage }];
    } else {
      psrRequired = true; // missed kick: PSR (p54, modifier 0)
    }

    return {
      success: true,
      type: 'kick',
      hit,
      roll,
      targetNumber: tn,
      damage,
      hitLocations: locations,
      psrRequired
    };
  }

  /**
   * Resolve a charge attack.
   */
  resolveCharge(attacker, target, distanceCharged, diceRoller, options = {}) {
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    const levelDiff = options.levelDifference || 0;
    const levelProblem = this._levelRestriction('charge', target, levelDiff);
    if (levelProblem) return { success: false, reason: levelProblem };
    if (!this._inForwardArc(attacker, target)) {
      return { success: false, reason: 'Target not in forward arc' };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'charge');
    const roll = diceRoller.roll2d6();
    const hit = roll >= tn;

    let attackerDamage = 0;
    let targetDamage = 0;
    let locations = [];

    if (hit) {
      targetDamage = Math.ceil((attacker.tonnage / 10) * distanceCharged);
      const locRoll = diceRoller.roll2d6();
      locations = [{ location: this.punchLocation(locRoll), damage: targetDamage }];
      attackerDamage = Math.ceil(target.tonnage / 10);
    }

    return {
      success: true,
      type: 'charge',
      hit,
      roll,
      targetNumber: tn,
      attackerDamage,
      targetDamage,
      hitLocations: locations,
      distanceCharged
    };
  }

  /**
   * Resolve a Death From Above attack.
   */
  resolveDFA(attacker, target, diceRoller, options = {}) {
    if (!attacker.movement || !attacker.movement.jump || attacker.movement.jump <= 0) {
      return { success: false, reason: 'No jump jets' };
    }
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'dfa');
    const roll = diceRoller.roll2d6();
    const hit = roll >= tn;

    let targetDamage = 0;
    let attackerDamage = 0;
    let locations = [];

    if (hit) {
      // DFA damage is left as-is: the KB chunk for p37 does not state the
      // formula, and guessing it would be worse than keeping the old value.
      targetDamage = Math.floor(attacker.tonnage / 10) + Math.floor(attacker.tonnage / 5);
      attackerDamage = Math.floor(attacker.tonnage / 10);
      const locRoll = diceRoller.roll2d6();
      locations = [{ location: this.punchLocation(locRoll), damage: targetDamage }];
    } else {
      attackerDamage = Math.floor(attacker.tonnage / 10);
    }

    return {
      success: true,
      type: 'dfa',
      hit,
      roll,
      targetNumber: tn,
      targetDamage,
      attackerDamage,
      hitLocations: locations,
      // p54: a failed DFA drops the attacker; a successful one does not.
      attackerProne: !hit
    };
  }

  /**
   * Resolve a push attack.
   */
  resolvePush(attacker, target, diceRoller, options = {}) {
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    const levelDiff = options.levelDifference || 0;
    const levelProblem = this._levelRestriction('push', target, levelDiff);
    if (levelProblem) return { success: false, reason: levelProblem };

    if (hexDistance(attacker.position.hexKey, target.position.hexKey) !== 1) {
      return { success: false, reason: 'Push target must be adjacent' };
    }
    if (!this._inForwardArc(attacker, target)) {
      return { success: false, reason: 'Push target must be directly in front' };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'push');
    const roll = diceRoller.roll2d6();
    const success = roll >= tn;

    return {
      success,
      type: 'push',
      roll,
      targetNumber: tn,
      targetPsrRequired: success
    };
  }

  /**
   * Resolve a physical weapon attack (hatchet, sword, mace, claws, ...) from the
   * p38 table.
   * @param {string|object} weaponRef - weapon id or definition
   * @param {object} [options] - { arm, levelDifference, usePunchTable }
   */
  resolvePhysicalWeapon(attacker, target, weaponRef, diceRoller, options = {}) {
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    const weapon = this.getPhysicalWeapon(weaponRef);
    if (!weapon) return { success: false, reason: 'Unknown physical weapon' };

    const levelDiff = options.levelDifference || 0;
    const levelProblem = this._levelRestriction('physicalWeapon', target, levelDiff);
    if (levelProblem) return { success: false, reason: levelProblem };

    const arm = options.arm || 'rightArm';
    const arc = getTargetArc(attacker, target.position.hexKey);
    if (arc === ARC.REAR) {
      return { success: false, reason: 'Target not in forward or side arc' };
    }
    if (arc === ARC.LEFT && arm !== 'leftArm') {
      return { success: false, reason: `Target is in the left arc; ${arm} cannot reach it` };
    }
    if (arc === ARC.RIGHT && arm !== 'rightArm') {
      return { success: false, reason: `Target is in the right arc; ${arm} cannot reach it` };
    }

    const armMods = this.physicalWeaponModifiers(attacker, arm);
    if (!armMods.legal) {
      return { success: false, reason: armMods.reason };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'physicalWeapon', {
      arm,
      weapon,
      usePunchTable: options.usePunchTable
    });
    const roll = diceRoller.roll2d6();
    const hit = roll >= tn;

    let damage = 0;
    let locations = [];

    if (hit) {
      let base;
      if (Number.isFinite(weapon.fixedDamage)) {
        base = weapon.fixedDamage;
      } else {
        base = Math.ceil(attacker.tonnage / weapon.damagePerTons) + (weapon.damageBonus || 0);
      }

      // TSM doubles the damage of the weapons it applies to (p117).
      const tsmActive = Boolean(attacker.equipment && attacker.equipment.other &&
        attacker.equipment.other.tsm && (attacker.heat || 0) >= 9);
      if (weapon.tsm && tsmActive) base *= 2;

      damage = Math.max(1, Math.floor(base * armMods.damageMultiplier));

      const locRoll = diceRoller.roll2d6();
      let table = this._tableFor('physicalWeapon', levelDiff);
      if (weapon.table === 'punch') table = 'punch';
      if (weapon.table === 'option' && options.usePunchTable && !table) table = 'punch';

      let location;
      if (table === 'punch') {
        location = this.punchLocation(locRoll);
      } else if (table === 'kick') {
        location = this.kickLocation(locRoll);
      } else {
        const std = this._standardLocation(locRoll, this._attackDirection(attacker, target));
        location = std.location;
      }
      locations = [{ location, damage }];
    }

    return {
      success: true,
      type: 'physicalWeapon',
      weapon: weapon.id,
      arm,
      hit,
      roll,
      targetNumber: tn,
      damage,
      hitLocations: locations
    };
  }

  /**
   * Base target number for a physical attack (p137).
   */
  calculatePhysicalTN(attacker, target, type, options = {}) {
    let tn = attacker.pilot.piloting;

    tn += BASE_MODIFIER[type] || 0;

    if (type === 'charge' || type === 'dfa') {
      // Comparative modifier (p34): the better pilot is favoured.
      tn += attacker.pilot.piloting - target.pilot.piloting;
    }

    if (type === 'dfa') {
      // p37: always add the jumping modifier, and no terrain modifiers apply.
      tn += DFA_JUMPING_MODIFIER;
    } else {
      tn += attacker.getAttackerMovementModifier();
    }

    // DFA ignores terrain modifiers (p37) but not the target's movement.
    if (target && typeof target.getTargetMovementModifier === 'function') {
      tn += target.getTargetMovementModifier();
    }

    if (attacker.prone) tn += 2;

    if (type === 'punch') {
      const armMods = this.punchModifiers(attacker, options.arm);
      if (!armMods.legal) return 999;
      tn += armMods.tn;
    } else if (type === 'kick') {
      const legMods = this.kickModifiers(attacker);
      if (!legMods.legal) return 999;
      tn += legMods.tn;
    } else if (type === 'physicalWeapon') {
      const weapon = options.weapon || this.getPhysicalWeapon(options.weaponId);
      if (weapon) tn += weapon.toHit || 0;
      const armMods = this.physicalWeaponModifiers(attacker, options.arm || 'rightArm');
      if (!armMods.legal) return 999;
      tn += armMods.tn;
      if (options.usePunchTable && weapon && weapon.table === 'option') {
        tn += OPTION_TABLE_MODIFIER;
      }
    }

    return Math.max(2, Math.min(12, tn));
  }

  punchLocation(roll) {
    const entry = PUNCH_TABLE[roll.toString()];
    return entry ? entry.location : 'centerTorso';
  }

  kickLocation(roll) {
    const entry = KICK_TABLE[roll.toString()];
    return entry ? entry.location : 'leftLeg';
  }

  chargeLocation(roll) {
    return this.punchLocation(roll);
  }
}
