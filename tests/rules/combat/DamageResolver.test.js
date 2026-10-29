/**
 * DamageResolver - damage, critical hits, transfer, CASE and ammunition
 * explosions against the BattleMech Manual:
 *
 *   p42  damage flow: armour -> internal structure -> critical hits; a hit that
 *        destroys a location resolves only explosive criticals
 *   p44  transfer: missing arm/leg -> same-side torso, destroyed side torso ->
 *        centre torso, destroyed head/centre torso -> nothing; a rear hit that
 *        transfers stays a rear hit; a destroyed side torso blows off its arm
 *   p46  Determining Critical Hits Table: 2-7 none, 8-9 one, 10-11 two,
 *        12 three on a torso or a blown-off head/limb; two blocks of six slots
 *        on a torso or arm; multi-slot components (p46's example: the double
 *        heat sink) are disabled once and later slots soak the hit, while
 *        sensors are excepted and each sensor slot is its own component; a
 *        destroyed head kills the MechWarrior
 *   p58  an ammunition explosion injures the MechWarrior for 2 points
 *   p96  ammunition explosion damage
 *   p118 CASE: internal structure damage only, excess ignored
 *   p139 a hit-location roll of 2 is a through-armour critical
 */

import { describe, it, expect } from 'vitest';
import { DamageResolver } from '../../../src/rules/combat/DamageResolver.js';

// ---------------------------------------------------------------------------
// Fixtures - a 100-ton record sheet (twelve slots in the torsos and arms, six
// in the head and legs, p6).
// ---------------------------------------------------------------------------

function slotList(items) {
  return items.map((item, index) => ({ slot: index + 1, item, status: 'ok' }));
}

const TWELVE_EMPTY = new Array(7).fill('empty');

function makeUnit(overrides = {}) {
  return {
    armor: {
      head: { front: 9, rear: 0 },
      centerTorso: { front: 31, rear: 10 },
      leftTorso: { front: 21, rear: 7 },
      rightTorso: { front: 21, rear: 7 },
      leftArm: { front: 17, rear: 0 },
      rightArm: { front: 17, rear: 0 },
      leftLeg: { front: 21, rear: 0 },
      rightLeg: { front: 21, rear: 0 }
    },
    internalStructure: {
      head: 3,
      centerTorso: 10,
      leftTorso: 8,
      rightTorso: 8,
      leftArm: 6,
      rightArm: 6,
      leftLeg: 8,
      rightLeg: 8
    },
    criticalSlots: {
      head: slotList(['life_support', 'sensors', 'cockpit', 'sensors', 'life_support', 'empty']),
      centerTorso: slotList([
        'engine', 'engine', 'engine', 'gyro', 'gyro', 'gyro',
        'gyro', 'med_laser', 'med_laser', 'empty', 'empty', 'empty'
      ]),
      leftTorso: slotList([
        'lrm20', 'lrm20', 'lrm20', 'lrm20', 'lrm20', 'lrm20_ammo',
        'lrm20_ammo', 'heat_sink', 'heat_sink', 'heat_sink', 'heat_sink', 'srm6_ammo'
      ]),
      rightTorso: slotList([
        'ac20', 'ac20', 'ac20', 'ac20', 'ac20', 'ac20',
        'ac20', 'ac20', 'ac20', 'ac20', 'heat_sink', 'empty'
      ]),
      leftArm: slotList([
        'shoulder', 'upper_arm_actuator', 'lower_arm_actuator', 'hand_actuator',
        'med_laser', ...TWELVE_EMPTY.slice(0, 7)
      ]),
      rightArm: slotList([
        'shoulder', 'upper_arm_actuator', 'lower_arm_actuator', 'hand_actuator',
        'large_laser', ...TWELVE_EMPTY.slice(0, 7)
      ]),
      leftLeg: slotList(['hip', 'upper_leg_actuator', 'lower_leg_actuator', 'foot_actuator', 'heat_sink', 'heat_sink']),
      rightLeg: slotList(['hip', 'upper_leg_actuator', 'lower_leg_actuator', 'foot_actuator', 'heat_sink', 'heat_sink'])
    },
    engine: { hits: 0 },
    gyro: { hits: 0 },
    pilot: { gunnery: 4, piloting: 5, hits: 0, conscious: true },
    equipment: {
      weapons: [
        { type: 'lrm20', location: 'leftTorso' },
        { type: 'ac20', location: 'rightTorso' },
        { type: 'med_laser', location: 'centerTorso' },
        { type: 'med_laser', location: 'centerTorso' },
        { type: 'med_laser', location: 'leftArm' },
        { type: 'large_laser', location: 'rightArm' }
      ],
      ammo: {
        lrm20_ammo: { type: 'lrm20', shots: 6, explosive: true },
        srm6_ammo: { type: 'srm6', shots: 15, explosive: true }
      },
      other: {}
    },
    heatSinks: { count: 20, damaged: 0, type: 'single' },
    prone: false,
    applyPilotDamage(points = 1) {
      this.pilot.hits = Math.min(6, (this.pilot.hits || 0) + points);
      if (this.pilot.hits >= 6) {
        this.pilot.conscious = false;
        this.pilot.dead = true;
      }
      return this.pilot.hits;
    },
    isLocationDestroyed(location) {
      return this.internalStructure[location] <= 0;
    },
    ...overrides
  };
}

/**
 * A Mech with double heat sinks. p46's own multi-slot example: each double heat
 * sink fills three critical slots, so the left torso carries two of them in six
 * consecutive slots.
 */
function makeDoubleSinkUnit() {
  const unit = makeUnit({ heatSinks: { count: 10, damaged: 0, type: 'double' } });
  unit.criticalSlots.leftTorso = slotList([
    'heat_sink', 'heat_sink', 'heat_sink',
    'heat_sink', 'heat_sink', 'heat_sink',
    'lrm20', 'lrm20', 'lrm20', 'lrm20', 'lrm20', 'empty'
  ]);
  return unit;
}

/**
 * Dice for the critical-hit routines: roll2d6 comes from twoD6, each 1D6 from
 * oneD6 (p46: the block and the slot are separate 1D6 rolls). Values repeat
 * when a list runs out, which keeps a fixed-roll test stable.
 */
function roller({ twoD6 = [7], oneD6 = [1] } = {}) {
  let i2 = 0;
  let i1 = 0;
  return {
    roll2d6() { return twoD6[Math.min(i2++, twoD6.length - 1)]; },
    roll1d6() { return oneD6[Math.min(i1++, oneD6.length - 1)]; }
  };
}

const noCrit = roller({ twoD6: [7] });

describe('DamageResolver', () => {
  const resolver = new DamageResolver();

  // =========================================================================
  // Armour and internal structure (p42)
  // =========================================================================

  describe('applyDamage - armor first (p42)', () => {
    it('absorbs damage with armor and does not penetrate', () => {
      const unit = makeUnit();
      const result = resolver.applyDamage(unit, 'centerTorso', 10);

      expect(result.absorbedByArmor).toBe(10);
      expect(result.penetratedInternal).toBe(false);
      expect(unit.armor.centerTorso.front).toBe(21); // 31 - 10
      expect(result.remaining).toBe(0);
    });

    it('applies damage to rear armor when the attack came from the rear (p42)', () => {
      const unit = makeUnit();
      const result = resolver.applyDamage(unit, 'centerTorso', 5, true);

      expect(result.absorbedByArmor).toBe(5);
      expect(unit.armor.centerTorso.rear).toBe(5); // 10 - 5
      expect(unit.armor.centerTorso.front).toBe(31); // unchanged
    });

    it('uses front armor for an arm even when flagged as a rear attack (p42)', () => {
      // p139: only the three torso locations have a rear armour value.
      const unit = makeUnit();
      resolver.applyDamage(unit, 'leftArm', 10, true);

      expect(unit.armor.leftArm.front).toBe(7); // 17 - 10
    });

    it('sends excess damage into internal structure', () => {
      const unit = makeUnit();
      const result = resolver.applyDamage(unit, 'leftTorso', 25, false, noCrit);

      expect(result.absorbedByArmor).toBe(21);
      expect(result.penetratedInternal).toBe(true);
      expect(result.internalDamage).toBe(4);
      expect(unit.internalStructure.leftTorso).toBe(4); // 8 - 4
      expect(result.remaining).toBe(0);
    });

    it('a rear hit that transfers inward stays on rear armour (p42/p44)', () => {
      const unit = makeUnit();
      // Left torso rear 7 + 8 internal = 15. 20 damage leaves 5 to transfer.
      const result = resolver.applyDamage(unit, 'leftTorso', 20, true, noCrit);

      expect(result.absorbedByArmor).toBe(7);
      expect(result.locationDestroyed).toBe(true);
      expect(result.transferLocation).toBe('centerTorso');
      expect(unit.armor.centerTorso.rear).toBe(5); // 10 - 5
      expect(unit.armor.centerTorso.front).toBe(31); // front armour untouched
    });
  });

  // =========================================================================
  // Location destruction and transfer (p44)
  // =========================================================================

  describe('applyDamage - destruction and transfer (p44)', () => {
    it('transfers excess damage from a destroyed arm to the same-side torso', () => {
      const unit = makeUnit();
      // Left arm: 17 armor + 6 internal. 30 damage leaves 7.
      const result = resolver.applyDamage(unit, 'leftArm', 30, false, noCrit);

      expect(result.locationDestroyed).toBe(true);
      expect(result.transferLocation).toBe('leftTorso');
      expect(unit.armor.leftTorso.front).toBe(14); // 21 - 7
      expect(result.remaining).toBe(0);
    });

    it('transfers excess damage from a destroyed side torso to the centre torso', () => {
      const unit = makeUnit();
      // Left torso: 21 armor + 8 internal. 40 damage leaves 11.
      const result = resolver.applyDamage(unit, 'leftTorso', 40, false, noCrit);

      expect(result.locationDestroyed).toBe(true);
      expect(result.transferLocation).toBe('centerTorso');
      expect(unit.armor.centerTorso.front).toBe(20); // 31 - 11
    });

    it('passes damage through a destroyed limb with armour still on it (p44)', () => {
      // A side torso hit blows the arm off without damaging the arm's armour;
      // later damage to that missing arm must transfer, not stop in the armour.
      const unit = makeUnit();
      unit.internalStructure.leftArm = 0;

      const result = resolver.applyDamage(unit, 'leftArm', 5, false, noCrit);

      expect(result.absorbedByArmor).toBe(0);
      expect(result.transferLocation).toBe('leftTorso');
      expect(unit.armor.leftTorso.front).toBe(16); // 21 - 5
    });

    it('keeps a rear attack on rear armour when it transfers from a limb (p44)', () => {
      const unit = makeUnit();
      // Left arm: 17 armour + 6 internal. 30 damage leaves 7 to transfer.
      const result = resolver.applyDamage(unit, 'leftArm', 30, true, noCrit);

      expect(result.transferLocation).toBe('leftTorso');
      expect(unit.armor.leftTorso.rear).toBe(0); // 7 - 7, rear armour
      expect(unit.armor.leftTorso.front).toBe(21); // front armour untouched
    });

    it('does not transfer damage out of a destroyed head (p44)', () => {
      const unit = makeUnit();
      const result = resolver.applyDamage(unit, 'head', 20, false, noCrit);

      expect(result.locationDestroyed).toBe(true);
      expect(result.transferLocation).toBeUndefined();
      expect(unit.armor.centerTorso.front).toBe(31);
    });

    it('does not transfer damage out of a destroyed centre torso (p44)', () => {
      const unit = makeUnit();
      const result = resolver.applyDamage(unit, 'centerTorso', 50, false, noCrit);

      expect(result.locationDestroyed).toBe(true);
      expect(result.transferLocation).toBeUndefined();
      expect(unit.destroyed).toBe(true);
    });

    it('blows off the arm when a side torso is destroyed, leaving its armor (p44/p118)', () => {
      const unit = makeUnit();
      resolver.applyDamage(unit, 'leftTorso', 40, false, noCrit);

      expect(unit.isLocationDestroyed('leftArm')).toBe(true);
      expect(unit.armor.leftArm.front).toBe(17); // not damaged by the torso loss
      expect(unit.equipment.weapons.some((w) => w.location === 'leftArm')).toBe(false);
      expect(unit.criticalSlots.leftArm.every((s) => s.item === 'empty' || s.status === 'destroyed')).toBe(true);
    });

    it('destroys the head and kills the MechWarrior (p44)', () => {
      const unit = makeUnit();
      // Head: 9 armor + 3 internal. 15 damage.
      resolver.applyDamage(unit, 'head', 15, false, noCrit);

      expect(unit.internalStructure.head).toBe(0);
      expect(unit.destroyed).toBe(true);
      expect(unit.pilot.dead).toBe(true);
      expect(unit.pilot.conscious).toBe(false);
    });
  });

  describe('getTransferLocation (p44)', () => {
    it('sends a missing arm or leg to the torso on the same side', () => {
      expect(resolver.getTransferLocation('leftArm')).toBe('leftTorso');
      expect(resolver.getTransferLocation('rightArm')).toBe('rightTorso');
      expect(resolver.getTransferLocation('leftLeg')).toBe('leftTorso');
      expect(resolver.getTransferLocation('rightLeg')).toBe('rightTorso');
    });

    it('sends additional damage from a destroyed side torso to the centre torso', () => {
      expect(resolver.getTransferLocation('leftTorso')).toBe('centerTorso');
      expect(resolver.getTransferLocation('rightTorso')).toBe('centerTorso');
    });

    it('transfers nothing from a destroyed head or centre torso', () => {
      expect(resolver.getTransferLocation('head')).toBeNull();
      expect(resolver.getTransferLocation('centerTorso')).toBeNull();
    });
  });

  // =========================================================================
  // Determining Critical Hits Table (p46/p143)
  // =========================================================================

  describe('Determining Critical Hits Table (p46)', () => {
    it('rolls no critical hit on 2-7', () => {
      for (const roll of [2, 5, 7]) {
        const result = resolver.applyCriticalHit(makeUnit(), 'centerTorso', roller({ twoD6: [roll] }));
        expect(result.roll).toBe(roll);
        expect(result.criticals).toHaveLength(0);
        expect(result.blownOff).toBe(false);
      }
    });

    it('rolls one critical hit on 8-9', () => {
      const result = resolver.applyCriticalHit(
        makeUnit(), 'centerTorso', roller({ twoD6: [9], oneD6: [1, 1] })
      );
      expect(result.criticals).toHaveLength(1);
    });

    it('rolls two critical hit locations on 10-11', () => {
      const result = resolver.applyCriticalHit(
        makeUnit(), 'centerTorso', roller({ twoD6: [10], oneD6: [1, 1, 1, 2] })
      );
      expect(result.criticals).toHaveLength(2);
      expect(result.criticals.map((c) => c.slot)).toEqual([1, 2]);
    });

    it('rolls three critical hit locations on a torso 12', () => {
      const unit = makeUnit();
      const result = resolver.applyCriticalHit(
        unit,
        'centerTorso',
        roller({ twoD6: [12], oneD6: [1, 1, 1, 2, 1, 3] })
      );

      expect(result.criticals).toHaveLength(3);
      // Three engine slots rolled: three engine hits.
      expect(unit.engine.hits).toBe(3);
    });

    it('blows off an arm on a 12 (p46)', () => {
      const unit = makeUnit();
      const result = resolver.applyCriticalHit(unit, 'leftArm', roller({ twoD6: [12] }));

      expect(result.blownOff).toBe(true);
      expect(result.criticals).toHaveLength(0);
      expect(unit.internalStructure.leftArm).toBe(0);
      expect(unit.armor.leftArm.front).toBe(17); // the arm itself is not damaged
      expect(unit.equipment.weapons.some((w) => w.location === 'leftArm')).toBe(false);
      expect(unit.prone).toBe(false);
    });

    it('blows off a leg on a 12 and the Mech falls (p46)', () => {
      const unit = makeUnit();
      const result = resolver.applyCriticalHit(unit, 'leftLeg', roller({ twoD6: [12] }));

      expect(result.blownOff).toBe(true);
      expect(unit.internalStructure.leftLeg).toBe(0);
      expect(unit.prone).toBe(true);
    });

    it('blows off the head on a 12 and kills the MechWarrior (p44/p46)', () => {
      const unit = makeUnit();
      const result = resolver.applyCriticalHit(unit, 'head', roller({ twoD6: [12] }));

      expect(result.blownOff).toBe(true);
      expect(unit.internalStructure.head).toBe(0);
      expect(unit.destroyed).toBe(true);
      expect(unit.pilot.dead).toBe(true);
    });
  });

  // =========================================================================
  // Slot selection: two blocks of six (p46)
  // =========================================================================

  describe('critical hit slot selection (p46)', () => {
    it('picks from the first block on a block roll of 1-3', () => {
      // 1D6 = 2 -> first block, then 1D6 = 5 -> the fifth slot (a gyro).
      const result = resolver.applyCriticalHit(
        makeUnit(), 'centerTorso', roller({ twoD6: [8], oneD6: [2, 5] })
      );

      expect(result.criticals[0].slot).toBe(5);
      expect(result.criticals[0].item).toBe('gyro');
    });

    it('picks from the second block on a block roll of 4-6', () => {
      // 1D6 = 5 -> second block, then 1D6 = 2 -> slot 8 (a medium laser).
      const result = resolver.applyCriticalHit(
        makeUnit(), 'centerTorso', roller({ twoD6: [8], oneD6: [5, 2] })
      );

      expect(result.criticals[0].slot).toBe(8);
      expect(result.criticals[0].item).toBe('med_laser');
    });

    it('rolls both dice again when the slot is inapplicable (empty)', () => {
      // First roll: block 2, slot 5 -> slot 11, which is empty. Then block 1,
      // slot 3 -> engine.
      const result = resolver.applyCriticalHit(
        makeUnit(), 'centerTorso', roller({ twoD6: [8], oneD6: [5, 5, 1, 3] })
      );

      expect(result.criticals[0].slot).toBe(3);
      expect(result.criticals[0].item).toBe('engine');
    });

    it('rolls both dice again when the slot cannot take critical damage (CASE)', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftTorso[0].item = 'case'; // p46: CASE cannot be critted

      const result = resolver.applyCriticalHit(
        unit, 'leftTorso', roller({ twoD6: [8], oneD6: [1, 1, 1, 2] })
      );

      expect(result.criticals[0].slot).toBe(2);
      expect(result.criticals[0].item).toBe('lrm20');
      expect(unit.criticalSlots.leftTorso[0].status).toBe('ok');
    });

    it('the head and legs have one block of six, so a single 1D6 picks the slot', () => {
      const result = resolver.applyCriticalHit(
        makeUnit(), 'leftLeg', roller({ twoD6: [8], oneD6: [2] })
      );

      expect(result.criticals[0].slot).toBe(2);
      expect(result.criticals[0].item).toBe('upper_leg_actuator');
    });

    it('ignores a torso block that is entirely inapplicable and rolls one die (p46)', () => {
      const unit = makeUnit();
      // Empty the whole second block of six in the left torso.
      for (let i = 6; i < 12; i++) {
        unit.criticalSlots.leftTorso[i] = { slot: i + 1, item: 'empty', status: 'ok' };
      }
      // Only the first block is left, so a single 1D6 of 5 takes the fifth slot.
      const result = resolver.applyCriticalHit(
        unit, 'leftTorso', roller({ twoD6: [8], oneD6: [5] })
      );

      expect(result.criticals[0].slot).toBe(5);
      expect(result.criticals[0].item).toBe('lrm20');
    });
  });

  // =========================================================================
  // Multi-slot components (p46)
  // =========================================================================

  describe('multi-slot components (p46)', () => {
    it('disables a ten-slot autocannon once and soaks later hits on its slots', () => {
      const unit = makeUnit();
      const result = resolver.applyCriticalHit(
        unit,
        'rightTorso',
        roller({ twoD6: [10], oneD6: [1, 1, 1, 3] }) // two crits, both on ac20 slots
      );

      expect(result.criticals).toHaveLength(2);
      expect(result.criticals[0].item).toBe('ac20');
      expect(result.criticals[0].soaked).toBeUndefined();
      expect(result.criticals[1].soaked).toBe(true);
      expect(result.criticals[1].effect).toContain('no further effect');
    });

    it('treats each sensor slot as its own component: the p46 sensor exception', () => {
      // p46 Multi-slot Components: "A single critical hit disables any item or
      // structural component except the engine, gyro, or sensors, regardless of
      // its number of slots." Sensors are excepted from the soak rule, so each
      // sensor slot is a separate critical target.
      const unit = makeUnit();
      const result = resolver.applyCriticalHit(
        unit,
        'head',
        roller({ twoD6: [10], oneD6: [2, 4] }) // slot 2 then slot 4: both sensors
      );

      expect(result.criticals.map((c) => c.item)).toEqual(['sensors', 'sensors']);
      expect(result.criticals[1].soaked).toBeUndefined();
      expect(unit.criticalSlots.head[1].status).toBe('destroyed');
      expect(unit.criticalSlots.head[3].status).toBe('destroyed');
    });

    it('scores each heat sink separately', () => {
      const unit = makeUnit();
      // Block 2, slot 2 -> slot 8, a single heat sink.
      resolver.applyCriticalHit(unit, 'leftTorso', roller({ twoD6: [8], oneD6: [5, 2] }));
      expect(unit.heatSinks.damaged).toBe(1);

      // The same slot is now inapplicable, so the next hit rolls again.
      resolver.applyCriticalHit(unit, 'leftTorso', roller({ twoD6: [8], oneD6: [5, 2, 5, 3] }));
      expect(unit.heatSinks.damaged).toBe(2);
    });

    it('destroys one double heat sink for three critical hits on its slots (p46)', () => {
      // p46: "Some items, such as double heat sinks, take up multiple slots on
      // the Critical Hit Table. A single critical hit disables any item ...
      // regardless of its number of slots. Critical hits on additional slots
      // occupied by the item have no further effect, but soak up the hit."
      const unit = makeDoubleSinkUnit();

      // Three critical hits, all landing on the first sink's three slots
      // (block 1, slots 1-3).
      const result = resolver.applyCriticalHit(
        unit,
        'leftTorso',
        roller({ twoD6: [12], oneD6: [1, 1, 1, 2, 1, 3] })
      );

      expect(result.criticals).toHaveLength(3);
      expect(unit.heatSinks.damaged).toBe(1); // one sink, not three
      expect(result.criticals[1].soaked).toBe(true);
      expect(result.criticals[2].soaked).toBe(true);
      // The soaked hits are still marked on the sink's slots.
      expect(unit.criticalSlots.leftTorso.slice(0, 3).every((s) => s.status === 'destroyed'))
        .toBe(true);

      // A critical on the next three-slot sink destroys the second one.
      const next = resolver.applyCriticalHit(
        unit,
        'leftTorso',
        roller({ twoD6: [8], oneD6: [1, 4] })
      );
      expect(next.criticals[0].soaked).toBeUndefined();
      expect(unit.heatSinks.damaged).toBe(2);
    });
  });

  // =========================================================================
  // Critical hits from internal damage, and the destroying hit (p42/p46)
  // =========================================================================

  describe('critical hits from internal damage (p42/p46)', () => {
    it('rolls once on the crit table when internal structure is damaged', () => {
      const unit = makeUnit();
      // Center torso: 31 armor + 9 of 10 internal -> one internal hit, one roll.
      const result = resolver.applyDamage(
        unit, 'centerTorso', 40, false, roller({ twoD6: [8], oneD6: [1, 1] })
      );

      expect(result.penetratedInternal).toBe(true);
      expect(result.criticalResults).toHaveLength(1);
      expect(result.criticalHits).toHaveLength(1);
      expect(unit.engine.hits).toBe(1);
    });

    it('does not roll a critical hit when the armour holds', () => {
      const unit = makeUnit();
      const dice = roller({ twoD6: [12] });
      const result = resolver.applyDamage(unit, 'centerTorso', 10, false, dice);

      expect(result.criticalResults).toHaveLength(0);
    });

    it('resolves only explosive criticals on a hit that destroys the location (p42)', () => {
      const unit = makeUnit();
      // Left torso: 21 armour + 8 internal. The 40th point destroys it.
      // Crit roll 9, block 2 slot 1 -> slot 7, an LRM-20 ammo bin.
      const result = resolver.applyDamage(
        unit, 'leftTorso', 40, false, roller({ twoD6: [9], oneD6: [4, 1] })
      );

      expect(result.locationDestroyed).toBe(true);
      expect(result.ammoExplosion).toBe(true);
      expect(unit.equipment.ammo.lrm20_ammo.shots).toBe(0);
    });

    it('discards a non-explosive critical on a hit that destroys the location (p42)', () => {
      const unit = makeUnit();
      // Center torso destroyed; crit roll 9 lands on an engine slot.
      const result = resolver.applyDamage(
        unit, 'centerTorso', 50, false, roller({ twoD6: [9], oneD6: [1, 1] })
      );

      expect(result.locationDestroyed).toBe(true);
      expect(result.criticalResults[0].criticals[0].discarded).toBe(true);
      expect(unit.engine.hits).toBe(0);
      expect(unit.criticalSlots.centerTorso[0].status).toBe('ok');
    });

    it('rolls a critical hit for every damage grouping that penetrates', () => {
      const unit = makeUnit();
      // Center torso: 31 armour + 10 internal. Two groupings reach structure
      // (35 then 5 points), so p46 calls for two rolls on the crit table.
      const first = resolver.applyDamage(
        unit, 'centerTorso', 35, false, roller({ twoD6: [8], oneD6: [1, 1] })
      );
      const second = resolver.applyDamage(
        unit, 'centerTorso', 5, false, roller({ twoD6: [8], oneD6: [1, 2] })
      );

      expect(first.criticalResults).toHaveLength(1);
      expect(second.criticalResults).toHaveLength(1);
      expect(unit.internalStructure.centerTorso).toBe(1); // 10 - 4 - 5
      expect(unit.engine.hits).toBe(2);
    });
  });

  // =========================================================================
  // Through-armour critical (p32/p139)
  // =========================================================================

  describe('through-armour critical (p32/p139)', () => {
    it('rolls on the crit table while the armour stays intact', () => {
      const unit = makeUnit();
      const result = resolver.applyThroughArmorCritical(
        unit, 'centerTorso', roller({ twoD6: [9], oneD6: [1, 1] })
      );

      expect(result).not.toBeNull();
      expect(result.roll).toBe(9);
      expect(result.criticals).toHaveLength(1);
      expect(unit.engine.hits).toBe(1);
      expect(unit.armor.centerTorso.front).toBe(31); // armour untouched
    });

    it('can be requested from applyDamage without penetrating the armour', () => {
      const unit = makeUnit();
      const result = resolver.applyDamage(
        unit, 'centerTorso', 5, false,
        roller({ twoD6: [9], oneD6: [1, 1] }),
        { throughArmorCritical: true }
      );

      expect(result.absorbedByArmor).toBe(5);
      expect(result.penetratedInternal).toBe(false);
      expect(result.throughArmorCritical.criticals).toHaveLength(1);
      expect(unit.engine.hits).toBe(1);
      expect(unit.armor.centerTorso.front).toBe(26);
    });

    it('does not fire on a limb or the head', () => {
      const unit = makeUnit();
      expect(resolver.applyThroughArmorCritical(unit, 'leftArm', roller({ twoD6: [9] }))).toBeNull();
      expect(resolver.applyThroughArmorCritical(unit, 'head', roller({ twoD6: [9] }))).toBeNull();
    });
  });

  // =========================================================================
  // CASE and ammunition explosions (p96/p118/p44)
  // =========================================================================

  describe('CASE and ammunition explosions (p102/p118/p44)', () => {
    it('CASE contains the blast in internal structure and ignores the excess', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftTorso[11] = { slot: 12, item: 'case', status: 'ok' };
      // p102: one LRM-20 shot is 20 damage (launcher size 20 x 1 per missile),
      // more than the 8 internal structure the left torso has left.
      unit.equipment.ammo.lrm20_ammo.shots = 1;

      resolver.resolveAmmoExplosion(unit, 'lrm20_ammo', noCrit);

      expect(unit.equipment.ammo.lrm20_ammo.shots).toBe(0);
      expect(unit.isLocationDestroyed('leftTorso')).toBe(true);
      expect(unit.armor.leftTorso.front).toBe(21); // p44: explosions bypass armour
      expect(unit.internalStructure.centerTorso).toBe(10); // p118: excess ignored
      expect(unit.armor.centerTorso.front).toBe(31);
      // p118: the arm blows off but is itself undamaged.
      expect(unit.isLocationDestroyed('leftArm')).toBe(true);
      expect(unit.armor.leftArm.front).toBe(17);
    });

    it('without CASE the excess transfers inward, bypassing armour (p44)', () => {
      const unit = makeUnit();
      unit.equipment.ammo.lrm20_ammo.shots = 1; // 20 damage vs 8 internal

      resolver.resolveAmmoExplosion(unit, 'lrm20_ammo', noCrit);

      expect(unit.isLocationDestroyed('leftTorso')).toBe(true);
      expect(unit.armor.leftTorso.front).toBe(21); // armour bypassed
      expect(unit.armor.centerTorso.front).toBe(31); // armour bypassed again
      // 12 points transfer: 10 internal + the rest lost with the centre torso.
      expect(unit.internalStructure.centerTorso).toBe(0);
      expect(unit.destroyed).toBe(true);
    });

    it('CASE in another location does not protect the ammunition', () => {
      const unit = makeUnit();
      unit.criticalSlots.rightTorso[11] = { slot: 12, item: 'case', status: 'ok' };
      unit.equipment.ammo.lrm20_ammo.shots = 1;

      resolver.resolveAmmoExplosion(unit, 'lrm20_ammo', noCrit);

      expect(unit.internalStructure.centerTorso).toBe(0);
    });

    it('a destroyed CASE slot does not protect the ammunition', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftTorso[11] = { slot: 12, item: 'case', status: 'destroyed' };
      unit.equipment.ammo.lrm20_ammo.shots = 1;

      resolver.resolveAmmoExplosion(unit, 'lrm20_ammo', noCrit);

      expect(unit.internalStructure.centerTorso).toBe(0);
    });

    it('explodes a missile bin for the launcher size per shot (p102)', () => {
      const unit = makeUnit();
      unit.equipment.ammo.lrm20_ammo.shots = 3; // 3 x 20 = 60 damage

      resolver.resolveAmmoExplosion(unit, 'lrm20_ammo', noCrit);

      // 60 points wipe the left torso (8) and the centre torso (10).
      expect(unit.isLocationDestroyed('leftTorso')).toBe(true);
      expect(unit.internalStructure.centerTorso).toBe(0);
      expect(unit.destroyed).toBe(true);
    });

    it('uses launcher size x damage per missile for an SRM-6 bin (p102)', () => {
      const unit = makeUnit();
      // SRM-6: 6 (launcher size) x 2 (per missile) = 12 per shot.
      unit.equipment.ammo.srm6_ammo.shots = 1;

      resolver.resolveAmmoExplosion(unit, 'srm6_ammo', noCrit);

      expect(unit.isLocationDestroyed('leftTorso')).toBe(true);
      expect(unit.internalStructure.centerTorso).toBe(6); // 12 - 8 transferred
    });

    it('injures the MechWarrior for 2 points (p58)', () => {
      const unit = makeUnit();
      // A two-tube SRM bin: 2 x 2 = 4 points, less than the 8 internal structure.
      unit.equipment.ammo.srm2_ammo = { type: 'srm2', shots: 1, explosive: true };
      unit.criticalSlots.leftTorso[11] = { slot: 12, item: 'srm2_ammo', status: 'ok' };

      resolver.resolveAmmoExplosion(unit, 'srm2_ammo', noCrit);

      expect(unit.pilot.hits).toBe(2);
      expect(unit.internalStructure.leftTorso).toBe(4); // 8 - 4
      expect(unit.isLocationDestroyed('leftTorso')).toBe(false);
    });

    it('explodes the bin in the location that was hit when the same ammo is carried twice', () => {
      const unit = makeUnit();
      unit.equipment.ammo.lrm20_ammo.shots = 1;
      unit.criticalSlots.rightTorso[11] = { slot: 12, item: 'lrm20_ammo', status: 'ok' };

      resolver.resolveAmmoExplosion(unit, 'lrm20_ammo', noCrit, 'rightTorso');

      expect(unit.isLocationDestroyed('rightTorso')).toBe(true);
      expect(unit.isLocationDestroyed('leftTorso')).toBe(false);
    });

    it('does nothing for an empty bin', () => {
      const unit = makeUnit();
      unit.equipment.ammo.lrm20_ammo.shots = 0;

      expect(resolver.resolveAmmoExplosion(unit, 'lrm20_ammo', noCrit)).toBe(false);
    });
  });

  // =========================================================================
  // destroyLocation - an explicit destruction, not a transfer
  // =========================================================================

  describe('destroyLocation', () => {
    it('zeros armour and internal structure', () => {
      const unit = makeUnit();
      resolver.destroyLocation(unit, 'leftArm');

      expect(unit.armor.leftArm.front).toBe(0);
      expect(unit.internalStructure.leftArm).toBe(0);
    });

    it('a destroyed leg makes the Mech prone', () => {
      const unit = makeUnit();
      resolver.destroyLocation(unit, 'leftLeg');

      expect(unit.prone).toBe(true);
    });

    it('a destroyed torso takes the arm with it, undamaged (p44)', () => {
      const unit = makeUnit();
      resolver.destroyLocation(unit, 'leftTorso');

      expect(unit.armor.leftTorso.front).toBe(0);
      expect(unit.internalStructure.leftTorso).toBe(0);
      expect(unit.internalStructure.leftArm).toBe(0);
      expect(unit.armor.leftArm.front).toBe(17);
    });
  });
});
