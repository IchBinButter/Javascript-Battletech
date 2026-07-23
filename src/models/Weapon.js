/**
 * Weapon - represents a weapon type with its combat stats.
 * Simple data class, primarily read from JSON definitions.
 */

export class Weapon {
  constructor(def) {
    this.id = def.id;
    this.name = def.name;
    this.type = def.type;       // DE, DB, MG, SRM, LRM
    this.heat = def.heat;
    this.damage = def.damage;
    this.minRange = def.minRange || 0;
    this.shortRange = def.shortRange;
    this.mediumRange = def.mediumRange;
    this.longRange = def.longRange;
    this.cluster = def.cluster || false;
    this.clusterSize = def.clusterSize || null;
    this.ammoPerShot = def.ammoPerShot || 0;
    this.special = def.special || {};
  }

  /** Get range modifier based on distance in hexes */
  getRangeModifier(distance) {
    if (distance <= this.shortRange) return 0;
    if (distance <= this.mediumRange) return 2;
    if (distance <= this.longRange) return 4;
    return null; // out of range
  }

  /** Check if target is in range */
  isInRange(distance) {
    return distance >= this.minRange && distance <= this.longRange;
  }

  /** Check if it's a missile weapon (SRM/LRM) */
  isMissile() {
    return this.cluster && (this.type === 'SRM' || this.type === 'LRM');
  }

  /** Check if weapon uses ammo */
  usesAmmo() {
    return this.ammoPerShot > 0;
  }

  /**
   * Get short range bracket label from distance.
   * Returns 'min', 'short', 'medium', 'long', or 'out'.
   */
  getRangeBracket(distance) {
    if (distance < this.minRange) return 'min';
    if (distance <= this.shortRange) return 'short';
    if (distance <= this.mediumRange) return 'medium';
    if (distance <= this.longRange) return 'long';
    return 'out';
  }

  /** Create from weapon definition by ID */
  static fromDef(weaponId, weaponsData) {
    const def = weaponsData.weapons.find(w => w.id === weaponId);
    if (!def) {
      throw new Error(`Weapon not found: ${weaponId}`);
    }
    return new Weapon(def);
  }

  /** Create a weapon lookup map from weapons data */
  static createLookup(weaponsData) {
    const map = {};
    for (const def of weaponsData.weapons) {
      map[def.id] = new Weapon(def);
    }
    return map;
  }
}
