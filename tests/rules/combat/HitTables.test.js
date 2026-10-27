import { describe, it, expect } from 'vitest';
import { AttackResolver } from '../../../src/rules/combat/AttackResolver.js';
import hitTables from '../../../src/data/hitTables.json' with { type: 'json' };

const BMM_CLUSTER_TABLE = {
  "2":  { "2": 1, "3": 1, "4": 1,  "5": 1,  "6": 2,  "7": 2,  "9": 3,  "10": 3,  "12": 4,  "15": 5,  "20": 6,  "30": 10, "40": 12 },
  "3":  { "2": 1, "3": 1, "4": 2,  "5": 2,  "6": 2,  "7": 2,  "9": 3,  "10": 3,  "12": 4,  "15": 5,  "20": 6,  "30": 10, "40": 12 },
  "4":  { "2": 1, "3": 1, "4": 2,  "5": 2,  "6": 3,  "7": 3,  "9": 4,  "10": 4,  "12": 5,  "15": 6,  "20": 9,  "30": 12, "40": 18 },
  "5":  { "2": 1, "3": 2, "4": 2,  "5": 3,  "6": 3,  "7": 4,  "9": 5,  "10": 6,  "12": 8,  "15": 9,  "20": 12, "30": 18, "40": 24 },
  "6":  { "2": 1, "3": 2, "4": 2,  "5": 3,  "6": 4,  "7": 4,  "9": 5,  "10": 6,  "12": 8,  "15": 9,  "20": 12, "30": 18, "40": 24 },
  "7":  { "2": 1, "3": 2, "4": 3,  "5": 3,  "6": 4,  "7": 4,  "9": 5,  "10": 6,  "12": 8,  "15": 9,  "20": 12, "30": 18, "40": 24 },
  "8":  { "2": 2, "3": 2, "4": 3,  "5": 3,  "6": 4,  "7": 4,  "9": 5,  "10": 6,  "12": 8,  "15": 9,  "20": 12, "30": 18, "40": 24 },
  "9":  { "2": 2, "3": 2, "4": 3,  "5": 4,  "6": 5,  "7": 6,  "9": 7,  "10": 8,  "12": 10, "15": 12, "20": 16, "30": 24, "40": 32 },
  "10": { "2": 2, "3": 3, "4": 3,  "5": 4,  "6": 5,  "7": 6,  "9": 7,  "10": 8,  "12": 10, "15": 12, "20": 16, "30": 24, "40": 32 },
  "11": { "2": 2, "3": 3, "4": 4,  "5": 5,  "6": 6,  "7": 7,  "9": 9,  "10": 10, "12": 12, "15": 15, "20": 20, "30": 30, "40": 40 },
  "12": { "2": 2, "3": 3, "4": 4,  "5": 5,  "6": 6,  "7": 7,  "9": 9,  "10": 10, "12": 12, "15": 15, "20": 20, "30": 30, "40": 40 }
};

const D6_PROB = { 2: 1/36, 3: 2/36, 4: 3/36, 5: 4/36, 6: 5/36, 7: 6/36, 8: 5/36, 9: 4/36, 10: 3/36, 11: 2/36, 12: 1/36 };

const LEFT_LOCS  = new Set(['leftArm', 'leftLeg', 'leftTorso']);
const RIGHT_LOCS = new Set(['rightArm', 'rightLeg', 'rightTorso']);

describe('HitTable BMM compliance', () => {
  const resolver = new AttackResolver(hitTables);

  describe('clusterTable', () => {
    it('matches BMM canonical values for all roll × column combinations', () => {
      for (const roll of ['2','3','4','5','6','7','8','9','10','11','12']) {
        for (const col of ['2','4','6','10','15','20']) {
          expect(hitTables.clusterTable[roll][col]).toBe(
            BMM_CLUSTER_TABLE[roll][col],
            `Mismatch at roll=${roll}, column=${col}`
          );
        }
      }
    });

    it('has only canonical columns', () => {
      for (const roll of ['2','3','4','5','6','7','8','9','10','11','12']) {
        const cols = Object.keys(hitTables.clusterTable[roll]).sort();
        expect(cols).toEqual(['10','12','15','2','20','3','30','4','40','5','6','7','9']);
      }
    });

    it('roll 12 on cluster 20 returns all 20 hits', () => {
      expect(resolver.resolveClusterHit(12, 20)).toBe(20);
    });

    it('roll 2 returns correct hits per column', () => {
      expect(resolver.resolveClusterHit(2, 2)).toBe(1);
      expect(resolver.resolveClusterHit(2, 4)).toBe(1);
      expect(resolver.resolveClusterHit(2, 6)).toBe(2);
      expect(resolver.resolveClusterHit(2, 10)).toBe(3);
      expect(resolver.resolveClusterHit(2, 15)).toBe(5);
      expect(resolver.resolveClusterHit(2, 20)).toBe(6);
    });

    it('roll 7 on LRM-20 returns 8 hits', () => {
      expect(resolver.resolveClusterHit(7, 20)).toBe(12);
    });

    it('roll 7 on SRM-6 returns 4 hits', () => {
      expect(resolver.resolveClusterHit(7, 6)).toBe(4);
    });

    it('handles non-canonical cluster size 5 via proportional scaling', () => {
      expect(resolver.resolveClusterHit(7, 5)).toBe(3);
      expect(resolver.resolveClusterHit(11, 5)).toBe(5);
      expect(resolver.resolveClusterHit(2, 5)).toBe(1);
    });
  });

  describe('left side hit table', () => {
    it('weights right-side locations on low rolls (3-6)', () => {
      expect(hitTables.hitLocation.left['3'].location).toBe('rightArm');
      expect(hitTables.hitLocation.left['4'].location).toBe('rightArm');
      expect(hitTables.hitLocation.left['5'].location).toBe('rightLeg');
      expect(hitTables.hitLocation.left['6'].location).toBe('rightTorso');
    });

    it('centers CT on roll 7', () => {
      expect(hitTables.hitLocation.left['7'].location).toBe('centerTorso');
    });

    it('maps left-side locations to high rolls (8-11)', () => {
      expect(hitTables.hitLocation.left['8'].location).toBe('leftTorso');
      expect(hitTables.hitLocation.left['9'].location).toBe('leftLeg');
      expect(hitTables.hitLocation.left['10'].location).toBe('leftArm');
      expect(hitTables.hitLocation.left['11'].location).toBe('leftArm');
    });

    it('has CT critical on 2 and head on 12', () => {
      expect(hitTables.hitLocation.left['2']).toEqual({ location: 'centerTorso', critical: true });
      expect(hitTables.hitLocation.left['12'].location).toBe('head');
    });

    it('left + right side probabilities are balanced by 2d6 symmetry', () => {
      let leftProb = 0, rightProb = 0;
      for (const [roll, p] of Object.entries(D6_PROB)) {
        const loc = hitTables.hitLocation.left[roll].location;
        if (LEFT_LOCS.has(loc))  leftProb  += p;
        if (RIGHT_LOCS.has(loc)) rightProb += p;
      }
      expect(leftProb).toBeCloseTo(rightProb);
      expect(leftProb).toBeCloseTo(14/36);
    });
  });

  describe('right side hit table', () => {
    it('weights left-side locations on low rolls (3-6)', () => {
      expect(hitTables.hitLocation.right['3'].location).toBe('leftArm');
      expect(hitTables.hitLocation.right['4'].location).toBe('leftArm');
      expect(hitTables.hitLocation.right['5'].location).toBe('leftLeg');
      expect(hitTables.hitLocation.right['6'].location).toBe('leftTorso');
    });

    it('centers CT on roll 7', () => {
      expect(hitTables.hitLocation.right['7'].location).toBe('centerTorso');
    });

    it('maps right-side locations to high rolls (8-11)', () => {
      expect(hitTables.hitLocation.right['8'].location).toBe('rightTorso');
      expect(hitTables.hitLocation.right['9'].location).toBe('rightLeg');
      expect(hitTables.hitLocation.right['10'].location).toBe('rightArm');
      expect(hitTables.hitLocation.right['11'].location).toBe('rightArm');
    });

    it('has CT critical on 2 and head on 12', () => {
      expect(hitTables.hitLocation.right['2']).toEqual({ location: 'centerTorso', critical: true });
      expect(hitTables.hitLocation.right['12'].location).toBe('head');
    });

    it('left + right side probabilities are balanced by 2d6 symmetry', () => {
      let leftProb = 0, rightProb = 0;
      for (const [roll, p] of Object.entries(D6_PROB)) {
        const loc = hitTables.hitLocation.right[roll].location;
        if (LEFT_LOCS.has(loc))  leftProb  += p;
        if (RIGHT_LOCS.has(loc)) rightProb += p;
      }
      expect(leftProb).toBeCloseTo(rightProb);
      expect(leftProb).toBeCloseTo(14/36);
    });
  });

  describe('determineHitLocation integration', () => {
    it('left side attack maps roll 3 to rightArm', () => {
      const loc = resolver.determineHitLocation(3, 'left');
      expect(loc.location).toBe('rightArm');
    });

    it('right side attack maps roll 3 to leftArm', () => {
      const loc = resolver.determineHitLocation(3, 'right');
      expect(loc.location).toBe('leftArm');
    });

    it('front table is unchanged', () => {
      expect(resolver.determineHitLocation(3, 'front').location).toBe('rightArm');
      expect(resolver.determineHitLocation(7, 'front').location).toBe('centerTorso');
      expect(resolver.determineHitLocation(10, 'front').location).toBe('leftArm');
      expect(resolver.determineHitLocation(12, 'front').location).toBe('head');
    });
  });

  describe('left vs right side asymmetry', () => {
    it('left and right tables are mirror images of each other', () => {
      const swapSide = (loc) => {
        if (loc.startsWith('left'))  return loc.replace(/^left/, 'right');
        if (loc.startsWith('right')) return loc.replace(/^right/, 'left');
        return loc;
      };

      for (let roll = 2; roll <= 12; roll++) {
        const leftLoc = hitTables.hitLocation.left[roll.toString()].location;
        const rightLoc = hitTables.hitLocation.right[roll.toString()].location;
        expect(swapSide(leftLoc)).toBe(rightLoc);
      }
    });
  });
});
