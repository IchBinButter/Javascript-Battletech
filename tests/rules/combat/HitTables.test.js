import { describe, it, expect } from 'vitest';
import { AttackResolver } from '../../../src/rules/combat/AttackResolver.js';
import hitTables from '../../../src/data/hitTables.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Source: BattleMech Manual (BMM) p139, 'Mech Hit Location Table.
//
// The table has exactly three columns: Left Side | Front/Rear | Right Side.
// There is no separate rear column. Row-to-roll mapping quoted from p139 (2D6):
//
//   Roll  Left Side      Front/Rear     Right Side
//   2*    Left Torso     Center Torso   Right Torso
//   3     Left Leg       Right Arm      Right Leg
//   4     Left Arm       Right Arm      Right Arm
//   5     Left Arm       Right Leg      Right Arm
//   6     Left Leg       Right Torso    Right Leg
//   7     Left Torso     Center Torso   Right Torso
//   8     Center Torso   Left Torso     Center Torso
//   9     Right Torso    Left Leg       Left Torso
//   10    Right Arm      Left Arm       Left Arm
//   11    Right Leg      Left Arm       Left Leg
//   12    Head           Head           Head
//
//   * p139 footnote: a result of 2 may inflict a critical hit (see also p32).
//
// Rear attacks use the Front/Rear column. p44 (Transferring Damage): damage
// dealt to the rear hit zone that transfers inward "transfers to the
// appropriate rear torso facing" (for example rear damage hitting a missing
// left leg transfers to the left rear torso). Only the center/left/right
// torso locations have rear armour, so only they carry isRear; arms, legs and
// the head do not (BMM p8/p42 armour diagrams).
// ---------------------------------------------------------------------------

const ROLLS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

// p139 Front/Rear column, row for row.
const P139_FRONT = {
  2: 'centerTorso',
  3: 'rightArm',
  4: 'rightArm',
  5: 'rightLeg',
  6: 'rightTorso',
  7: 'centerTorso',
  8: 'leftTorso',
  9: 'leftLeg',
  10: 'leftArm',
  11: 'leftArm',
  12: 'head'
};

// p139 Left Side column, row for row.
const P139_LEFT = {
  2: 'leftTorso',
  3: 'leftLeg',
  4: 'leftArm',
  5: 'leftArm',
  6: 'leftLeg',
  7: 'leftTorso',
  8: 'centerTorso',
  9: 'rightTorso',
  10: 'rightArm',
  11: 'rightLeg',
  12: 'head'
};

// p139 Right Side column, row for row (mirror of the Left Side column).
const P139_RIGHT = {
  2: 'rightTorso',
  3: 'rightLeg',
  4: 'rightArm',
  5: 'rightArm',
  6: 'rightLeg',
  7: 'rightTorso',
  8: 'centerTorso',
  9: 'leftTorso',
  10: 'leftArm',
  11: 'leftLeg',
  12: 'head'
};

const TORSO_LOCATIONS = new Set(['centerTorso', 'leftTorso', 'rightTorso']);

// Number of 2D6 combinations producing each total, used to weight p139 rows.
const D6_COMBINATIONS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

function locationWeight(table, location) {
  return ROLLS.reduce((total, roll) => (
    table[roll].location === location ? total + D6_COMBINATIONS[roll] : total
  ), 0);
}

function swapSide(location) {
  if (location.startsWith('left')) return location.replace(/^left/, 'right');
  if (location.startsWith('right')) return location.replace(/^right/, 'left');
  return location;
}

describe("'Mech Hit Location Table (BMM p139)", () => {
  const resolver = new AttackResolver(hitTables);
  const front = hitTables.hitLocation.front;
  const left = hitTables.hitLocation.left;
  const right = hitTables.hitLocation.right;
  const rear = hitTables.hitLocation.rear;

  describe('front (p139 Front/Rear column)', () => {
    it('matches every p139 row', () => {
      for (const roll of ROLLS) {
        expect(front[roll].location, `p139 Front/Rear, roll ${roll}`).toBe(P139_FRONT[roll]);
      }
    });

    it('puts the critical on roll 2 only and the head on roll 12', () => {
      expect(front['2'].location).toBe('centerTorso');
      expect(front['2'].critical).toBe(true);
      for (const roll of ROLLS.filter((r) => r !== '2')) {
        expect(front[roll].critical, `p139 Front/Rear, roll ${roll}`).toBeUndefined();
      }
      expect(front['12'].location).toBe('head');
    });
  });

  describe('left side (p139 Left Side column)', () => {
    it('matches every p139 row', () => {
      for (const roll of ROLLS) {
        expect(left[roll].location, `p139 Left Side, roll ${roll}`).toBe(P139_LEFT[roll]);
      }
    });

    it('criticals the near-side left torso on roll 2 (p139 footnote)', () => {
      expect(left['2']).toEqual({ location: 'leftTorso', critical: true });
    });

    it('puts the head on roll 12', () => {
      expect(left['12'].location).toBe('head');
    });

    it('derives the p139 weighting: near side 21/36, CT 5/36, far side 9/36, head 1/36', () => {
      expect(locationWeight(left, 'leftTorso')).toBe(7);  // rolls 2 (1) + 7 (6)
      expect(locationWeight(left, 'leftArm')).toBe(7);    // rolls 4 (3) + 5 (4)
      expect(locationWeight(left, 'leftLeg')).toBe(7);    // rolls 3 (2) + 6 (5)
      expect(locationWeight(left, 'centerTorso')).toBe(5); // roll 8
      expect(locationWeight(left, 'rightTorso')).toBe(4);  // roll 9
      expect(locationWeight(left, 'rightArm')).toBe(3);    // roll 10
      expect(locationWeight(left, 'rightLeg')).toBe(2);    // roll 11
      expect(locationWeight(left, 'head')).toBe(1);        // roll 12
    });
  });

  describe('right side (p139 Right Side column)', () => {
    it('matches every p139 row', () => {
      for (const roll of ROLLS) {
        expect(right[roll].location, `p139 Right Side, roll ${roll}`).toBe(P139_RIGHT[roll]);
      }
    });

    it('criticals the near-side right torso on roll 2 (p139 footnote)', () => {
      expect(right['2']).toEqual({ location: 'rightTorso', critical: true });
    });

    it('puts the head on roll 12', () => {
      expect(right['12'].location).toBe('head');
    });

    it('derives the p139 weighting: near side 21/36, CT 5/36, far side 9/36, head 1/36', () => {
      expect(locationWeight(right, 'rightTorso')).toBe(7);  // rolls 2 (1) + 7 (6)
      expect(locationWeight(right, 'rightArm')).toBe(7);    // rolls 4 (3) + 5 (4)
      expect(locationWeight(right, 'rightLeg')).toBe(7);    // rolls 3 (2) + 6 (5)
      expect(locationWeight(right, 'centerTorso')).toBe(5); // roll 8
      expect(locationWeight(right, 'leftTorso')).toBe(4);   // roll 9
      expect(locationWeight(right, 'leftArm')).toBe(3);     // roll 10
      expect(locationWeight(right, 'leftLeg')).toBe(2);     // roll 11
      expect(locationWeight(right, 'head')).toBe(1);        // roll 12
    });

    it('is the p139 mirror of the left side column', () => {
      for (const roll of ROLLS) {
        expect(swapSide(left[roll].location), `mirror at roll ${roll}`).toBe(right[roll].location);
      }
    });
  });

  describe('rear (p139 Front/Rear column + p44 rear torso facing)', () => {
    it('is not a separate table: every location equals the front column', () => {
      for (const roll of ROLLS) {
        expect(rear[roll].location, `rear roll ${roll}`).toBe(front[roll].location);
      }
    });

    it('flags isRear on the three torso locations only (p44)', () => {
      for (const roll of ROLLS) {
        const expected = TORSO_LOCATIONS.has(rear[roll].location);
        expect(rear[roll].isRear ?? false, `rear roll ${roll} (${rear[roll].location})`).toBe(expected);
      }
    });

    it('does not put isRear on arms, legs or the head, which have no rear armour', () => {
      // p139 Front/Rear: roll 3 rightArm, 4 rightArm, 5 rightLeg, 9 leftLeg, 10 leftArm, 11 leftArm, 12 head
      for (const roll of ['3', '4', '5', '9', '10', '11', '12']) {
        expect(rear[roll].isRear, `rear roll ${roll}`).toBeUndefined();
      }
    });

    it('keeps the p139 roll-2 through-armour critical on the center torso', () => {
      expect(rear['2']).toEqual({ location: 'centerTorso', critical: true, isRear: true });
    });
  });

  describe('AttackResolver.determineHitLocation (direction -> p139 column)', () => {
    it('uses the Left Side column for a left-side attack', () => {
      expect(resolver.determineHitLocation(2, 'left')).toMatchObject({ location: 'leftTorso', critical: true });
      expect(resolver.determineHitLocation(3, 'left')).toMatchObject({ location: 'leftLeg' });
      expect(resolver.determineHitLocation(6, 'left')).toMatchObject({ location: 'leftLeg' });
      expect(resolver.determineHitLocation(7, 'left')).toMatchObject({ location: 'leftTorso' });
      expect(resolver.determineHitLocation(8, 'left')).toMatchObject({ location: 'centerTorso' });
      expect(resolver.determineHitLocation(9, 'left')).toMatchObject({ location: 'rightTorso' });
      expect(resolver.determineHitLocation(10, 'left')).toMatchObject({ location: 'rightArm' });
      expect(resolver.determineHitLocation(11, 'left')).toMatchObject({ location: 'rightLeg' });
    });

    it('uses the Right Side column for a right-side attack', () => {
      expect(resolver.determineHitLocation(2, 'right')).toMatchObject({ location: 'rightTorso', critical: true });
      expect(resolver.determineHitLocation(3, 'right')).toMatchObject({ location: 'rightLeg' });
      expect(resolver.determineHitLocation(6, 'right')).toMatchObject({ location: 'rightLeg' });
      expect(resolver.determineHitLocation(7, 'right')).toMatchObject({ location: 'rightTorso' });
      expect(resolver.determineHitLocation(8, 'right')).toMatchObject({ location: 'centerTorso' });
      expect(resolver.determineHitLocation(9, 'right')).toMatchObject({ location: 'leftTorso' });
      expect(resolver.determineHitLocation(10, 'right')).toMatchObject({ location: 'leftArm' });
      expect(resolver.determineHitLocation(11, 'right')).toMatchObject({ location: 'leftLeg' });
    });

    it('uses the Front/Rear column for a front attack', () => {
      expect(resolver.determineHitLocation(2, 'front')).toMatchObject({ location: 'centerTorso', critical: true });
      expect(resolver.determineHitLocation(3, 'front')).toMatchObject({ location: 'rightArm' });
      expect(resolver.determineHitLocation(8, 'front')).toMatchObject({ location: 'leftTorso' });
      expect(resolver.determineHitLocation(10, 'front')).toMatchObject({ location: 'leftArm' });
      expect(resolver.determineHitLocation(12, 'front')).toMatchObject({ location: 'head' });
    });

    it('uses the Front/Rear column for a rear attack with rear armour on torsos only (p44)', () => {
      expect(resolver.determineHitLocation(2, 'rear')).toMatchObject({ location: 'centerTorso', critical: true, isRear: true });
      expect(resolver.determineHitLocation(3, 'rear')).toMatchObject({ location: 'rightArm', isRear: false });
      expect(resolver.determineHitLocation(5, 'rear')).toMatchObject({ location: 'rightLeg', isRear: false });
      expect(resolver.determineHitLocation(7, 'rear')).toMatchObject({ location: 'centerTorso', isRear: true });
      expect(resolver.determineHitLocation(8, 'rear')).toMatchObject({ location: 'leftTorso', isRear: true });
      expect(resolver.determineHitLocation(9, 'rear')).toMatchObject({ location: 'leftLeg', isRear: false });
      expect(resolver.determineHitLocation(12, 'rear')).toMatchObject({ location: 'head', isRear: false });
    });
  });

  describe('Cluster Hits Table (BMM p139)', () => {
    it('has the 13 canonical weapon-size columns for every 2D6 roll', () => {
      const expectedColumns = ['2', '3', '4', '5', '6', '7', '9', '10', '12', '15', '20', '30', '40'];
      for (const roll of ROLLS) {
        expect(Object.keys(hitTables.clusterTable[roll]).sort((a, b) => a - b), `roll ${roll}`)
          .toEqual(expectedColumns);
      }
    });

    it('matches quoted p139 anchor values', () => {
      // p139 Cluster Hits Table, printed rows 2, 7 and 12.
      expect(hitTables.clusterTable['2']).toMatchObject({ 2: 1, 6: 2, 12: 4, 20: 6, 40: 12 });
      expect(hitTables.clusterTable['7']).toMatchObject({ 2: 1, 6: 4, 12: 8, 20: 12, 40: 24 });
      expect(hitTables.clusterTable['12']).toMatchObject({ 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 9: 9, 10: 10, 12: 12, 15: 15, 20: 20, 30: 30, 40: 40 });
    });

    it('resolves the 5 column directly from p139 instead of a proportional guess', () => {
      // Size 5 is a real p139 column (LRM 5 / SRM 5): roll 7 = 3, roll 2 = 1.
      expect(resolver.resolveClusterHit(7, 5)).toBe(3);
      expect(resolver.resolveClusterHit(2, 5)).toBe(1);
    });

    it('resolves p139 cluster results for standard launchers', () => {
      expect(resolver.resolveClusterHit(2, 20)).toBe(6);
      expect(resolver.resolveClusterHit(7, 6)).toBe(4);
      expect(resolver.resolveClusterHit(7, 20)).toBe(12);
      expect(resolver.resolveClusterHit(12, 20)).toBe(20);
    });
  });
});
