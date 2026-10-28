/**
 * Unit (Mech) class representing all BattleMech state.
 * Most properties are initialized from JSON mech definition.
 */

import { deepClone } from '../utils/helpers.js';
import { getMaxMP } from '../rules/movement/maxMP.js';

const LOCATIONS = [
  'head', 'centerTorso', 'leftTorso', 'rightTorso',
  'leftArm', 'rightArm', 'leftLeg', 'rightLeg'
];

export class Unit {
  constructor(mechDef, playerId, unitId = null) {
    this.id = unitId || `${mechDef.id}-${playerId}-${Date.now()}`;
    this.player = playerId;
    this.name = mechDef.name;
    this.tonnage = mechDef.tonnage;

    // Movement
    this.movement = { ...mechDef.movement };

    // Pilot
    this.pilot = {
      gunnery: 4,      // 4 = regular skill
      piloting: 5,
      hits: 0,
      conscious: true
    };

    // Position and state
    this.position = { hexKey: null, facing: 0 };
    this.prone = false;
    this.shutdown = false;
    this.immobile = false;
    this.torsoTwist = 0;   // -1, 0, +1
    this.armsReversed = false;
    this.hexesMoved = 0;
    this.movementMode = 'walk';

    // Heat
    this.heat = 0;

    // Armor
    this.armor = deepClone(mechDef.armor);
    this._initialArmor = deepClone(mechDef.armor);

    // Internal structure
    this.internalStructure = deepClone(mechDef.internalStructure);

    // Critical slots
    this.criticalSlots = deepClone(mechDef.criticalSlots);

    // Equipment
    this.equipment = {
      weapons: mechDef.equipment.weapons.map(w => ({ ...w })),
      ammo: deepClone(mechDef.equipment.ammo),
      other: deepClone(mechDef.equipment.other || {})
    };

    // Heat sinks
    this.heatSinks = { ...mechDef.heatSinks };

    // Engine
    this.engine = { ...mechDef.engine };

    // Gyro
    this.gyro = { ...mechDef.gyro };

    // Status flags
    this.initiativeModifier = 0;
  }

  /**
   * Current MP for this turn, derived from movement mode, heat, MASC and TSM.
   * Never stored, so it cannot drift out of sync with the heat scale.
   */
  get currentMP() {
    return getMaxMP(this, this.movementMode || 'walk');
  }

  /**
   * How tall the Mech itself is, in levels (BMM p22).
   * Standing Mechs are two levels tall, prone Mechs one.
   */
  getHeightLevels() {
    return this.prone ? 1 : 2;
  }

  /**
   * LOS level: the Mech's height plus the level of the hex it stands in (p22).
   * @param {number} hexLevel - level of the underlying hex (building level excluded)
   */
  getLOSLevel(hexLevel = 0) {
    return hexLevel + this.getHeightLevels();
  }

  /**
   * Damage the MechWarrior (p58). A warrior takes up to 5 points and dies on
   * the sixth; each point forces a consciousness roll in the End Phase.
   * @returns {number} total hits taken
   */
  applyPilotDamage(points = 1) {
    this.pilot.hits = Math.min(6, (this.pilot.hits || 0) + points);
    if (this.pilot.hits >= 6) {
      this.pilot.conscious = false;
      this.pilot.dead = true;
    }
    return this.pilot.hits;
  }

  /** Get current armor for a location (front or rear) */
  getArmor(location, isRear = false) {
    const loc = this.armor[location];
    if (!loc) return 0;
    return isRear ? (loc.rear || 0) : loc.front;
  }

  /** Get the initial (max) armor value for a location */
  getMaxArmor(location, isRear = false) {
    const loc = this._initialArmor[location];
    if (!loc) return 0;
    return isRear ? (loc.rear || 0) : loc.front;
  }

  /** Get current internal structure for a location */
  getInternal(location) {
    return this.internalStructure[location] || 0;
  }

  /**
   * Apply damage to armor first, then internal, then critical hits.
   * @returns {{ remaining: number, penetratedInternal: boolean, destroyed: boolean }}
   */
  applyDamage(location, damage, isRear = false) {
    const result = { remaining: damage, penetratedInternal: false, destroyed: false };

    // Apply to armor first
    const armorLoc = this.armor[location];
    if (armorLoc) {
      const armorVal = isRear ? armorLoc.rear : armorLoc.front;
      if (armorVal > 0) {
        const absorbed = Math.min(damage, armorVal);
        damage -= absorbed;
        if (isRear) {
          armorLoc.rear -= absorbed;
        } else {
          armorLoc.front -= absorbed;
        }
      }
    }

    result.remaining = damage;

    // If damage remains, apply to internal structure
    if (damage > 0 && this.internalStructure[location] !== undefined) {
      result.penetratedInternal = true;
      const absorbed = Math.min(damage, this.internalStructure[location]);
      damage -= absorbed;
      this.internalStructure[location] -= absorbed;

      if (this.internalStructure[location] <= 0) {
        result.destroyed = true;
      }

      result.remaining = damage;
    }

    return result;
  }

  /** Check if the unit is destroyed (head gone, CT gone, or both legs gone) */
  isDestroyed() {
    return this.internalStructure.head <= 0 || this.internalStructure.centerTorso <= 0
      || (this.internalStructure.leftLeg <= 0 && this.internalStructure.rightLeg <= 0);
  }

  /** Check if location is destroyed (internal structure gone) */
  isLocationDestroyed(location) {
    return this.internalStructure[location] <= 0;
  }

  /** Get weapon instances in a specific location */
  getWeaponsInLocation(location) {
    return this.equipment.weapons.filter(w => w.location === location);
  }

  /** Get all weapons the unit has */
  getAllWeapons() {
    return [...this.equipment.weapons];
  }

  /** Check if unit has ammo for a weapon */
  getAmmo(ammoBin) {
    if (!ammoBin) return null;
    return this.equipment.ammo[ammoBin] || null;
  }

  /** Consume ammo for a weapon. Returns false if no ammo left. */
  consumeAmmo(ammoBin, amount = 1) {
    const ammo = this.equipment.ammo[ammoBin];
    if (!ammo || ammo.shots < amount) return false;
    ammo.shots -= amount;
    return true;
  }

  /** Get current heat dissipation (accounting for damaged sinks) */
  getHeatDissipation() {
    const type = this.heatSinks.type;
    const sinkCount = Math.max(0, this.heatSinks.count - this.heatSinks.damaged);
    return type === 'double' ? sinkCount * 2 : sinkCount;
  }

  /** Get movement modifier for gunnery (how much the unit moved this turn) */
  getAttackerMovementModifier() {
    // Determined by movement mode used this turn (walk/run/jump)
    // This is set externally by movement calculator
    return this._movementModifier || 0;
  }

  getTargetMovementModifier() {
    // Target modifiers are calculated per attack based on target's movement
    // Simplification: based on movement mode and hexes moved
    return this._targetMovementModifier || 0;
  }

  /** Static factory to create unit from mech definition ID */
  static fromMechId(mechId, playerId, mechsData) {
    const mechDef = mechsData.mechs.find(m => m.id === mechId);
    if (!mechDef) {
      throw new Error(`Mech not found: ${mechId}`);
    }
    return new Unit(mechDef, playerId);
  }
}
