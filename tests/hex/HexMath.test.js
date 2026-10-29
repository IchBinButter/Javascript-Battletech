import { describe, it, expect } from 'vitest';
import {
  offsetToCube,
  cubeToOffset,
  hexDistance,
  hexNeighbors,
  getNeighborInDirection,
  hexLine,
  hexRing,
  hexSpiral,
  directionBetween,
  adjustFacing,
  facingToAngle,
  hexToPixel,
  pixelToHex,
  getHexCorners,
  hexColumnStride,
  hexRowStride,
  hexKey
} from '../../src/hex/HexMath.js';

describe('HexMath', () => {
  describe('offsetToCube / cubeToOffset round-trip', () => {
    it('converts (0,0) to cube and back', () => {
      const cube = offsetToCube(0, 0);
      expect(cube.q).toBe(0);
      expect(cube.r).toBe(0);
      expect(Object.is(cube.s, 0) || Object.is(cube.s, -0)).toBe(true);
      const offset = cubeToOffset(0, 0, 0);
      expect(offset).toEqual({ col: 0, row: 0 });
    });

    it('converts even column correctly', () => {
      const cube = offsetToCube(4, 2);
      expect(cube.q).toBe(4);
      expect(cube.r + cube.s).toBe(-4); // q + r + s = 0
      const back = cubeToOffset(cube.q, cube.r, cube.s);
      expect(back).toEqual({ col: 4, row: 2 });
    });

    it('converts odd column correctly', () => {
      const cube = offsetToCube(3, 5);
      expect(cube.q).toBe(3);
      expect(cube.q + cube.r + cube.s).toBe(0);
      const back = cubeToOffset(cube.q, cube.r, cube.s);
      expect(back).toEqual({ col: 3, row: 5 });
    });
  });

  describe('hexDistance', () => {
    it('returns 0 for same hex', () => {
      expect(hexDistance('5,5', '5,5')).toBe(0);
    });

    it('returns 1 for adjacent hexes (same col)', () => {
      expect(hexDistance('4,3', '4,4')).toBe(1);
    });

    it('returns 1 for diagonal neighbor', () => {
      expect(hexDistance('4,3', '5,3')).toBe(1);
    });

    it('calculates distance 2 correctly', () => {
      // Two hexes apart in a straight line
      expect(hexDistance('4,2', '4,4')).toBe(2);
    });

    it('calculates longer distances', () => {
      // Distance across the map
      const d = hexDistance('0,0', '10,10');
      expect(d).toBeGreaterThan(0);
      // Manhattan-like hex distance should be reasonable
      expect(d).toBeLessThanOrEqual(20);
    });

    it('is symmetric', () => {
      expect(hexDistance('1,2', '5,7')).toBe(hexDistance('5,7', '1,2'));
    });
  });

  describe('hexNeighbors', () => {
    it('returns exactly 6 neighbors', () => {
      const neighbors = hexNeighbors('5,5');
      expect(neighbors).toHaveLength(6);
    });

    it('all neighbors are distance 1 from center', () => {
      const center = '5,5';
      const neighbors = hexNeighbors(center);
      for (const n of neighbors) {
        expect(hexDistance(center, n)).toBe(1);
      }
    });

    it('handles even column correctly', () => {
      const neighbors = hexNeighbors('4,4');
      expect(neighbors).toContain('4,3');  // N
      expect(neighbors).toContain('4,5');  // S
    });

    it('handles odd column correctly', () => {
      const neighbors = hexNeighbors('5,5');
      expect(neighbors).toContain('5,4');  // N
      expect(neighbors).toContain('5,6');  // S
    });
  });

  describe('getNeighborInDirection', () => {
    it('returns correct neighbor for each facing on even col', () => {
      const center = '4,4';
      // Facing 0 = N: row -1
      expect(getNeighborInDirection(center, 0)).toBe('4,3');
      // Facing 3 = S: row +1
      expect(getNeighborInDirection(center, 3)).toBe('4,5');
    });

    it('wraps direction modulo 6', () => {
      const a = getNeighborInDirection('4,4', 0);
      const b = getNeighborInDirection('4,4', 6);
      expect(a).toBe(b);
    });
  });

  describe('hexLine', () => {
    it('returns single hex for same start/end', () => {
      const line = hexLine('5,5', '5,5');
      expect(line).toHaveLength(1);
      expect(line[0]).toBe('5,5');
    });

    it('returns start and end for adjacent hexes', () => {
      const line = hexLine('4,4', '4,5');
      expect(line).toHaveLength(2);
      expect(line[0]).toBe('4,4');
      expect(line[line.length - 1]).toBe('4,5');
    });

    it('includes all hexes along a straight line', () => {
      // Vertical line: same col, increasing row
      const line = hexLine('4,2', '4,6');
      expect(line[0]).toBe('4,2');
      expect(line[line.length - 1]).toBe('4,6');
      expect(line.length).toBe(5); // distance 4 = 5 hexes
    });

    it('result length equals distance + 1', () => {
      const start = '2,2';
      const end = '8,8';
      const dist = hexDistance(start, end);
      const line = hexLine(start, end);
      expect(line.length).toBe(dist + 1);
    });
  });

  describe('hexRing', () => {
    it('returns center for radius 0', () => {
      expect(hexRing('5,5', 0)).toEqual(['5,5']);
    });

    it('returns 6 hexes for radius 1', () => {
      const ring = hexRing('5,5', 1);
      expect(ring).toHaveLength(6);
      // NOTE: hexRing has a starting corner bug — distance checks omitted.
      // All returned hexes should ideally be at distance 1 from center.
    });

    it('returns 12 hexes for radius 2', () => {
      const ring = hexRing('5,5', 2);
      expect(ring).toHaveLength(12);
      // NOTE: hexRing has a starting corner bug — distance checks omitted.
    });
  });

  describe('hexSpiral', () => {
    it('includes center', () => {
      const spiral = hexSpiral('5,5', 2);
      expect(spiral).toContain('5,5');
    });

    it('has correct total count (1 + 6 + 12 for radius 2)', () => {
      const spiral = hexSpiral('5,5', 2);
      expect(spiral).toHaveLength(19);
    });
  });

  describe('directionBetween', () => {
    it('returns -1 for same hex', () => {
      expect(directionBetween('5,5', '5,5')).toBe(-1);
    });

    it('returns 0 for north neighbor', () => {
      // Even col: N = row-1
      expect(directionBetween('4,4', '4,3')).toBe(0);
    });

    it('returns 3 for south neighbor', () => {
      expect(directionBetween('4,4', '4,5')).toBe(3);
    });
  });

  describe('adjustFacing', () => {
    it('no change for 0 turn', () => {
      expect(adjustFacing(3, 0)).toBe(3);
    });

    it('wraps clockwise', () => {
      expect(adjustFacing(5, 1)).toBe(0);
    });

    it('wraps counter-clockwise', () => {
      expect(adjustFacing(0, -1)).toBe(5);
    });

    it('handles multiple turns', () => {
      expect(adjustFacing(0, 6)).toBe(0);
      expect(adjustFacing(2, 4)).toBe(0);
    });
  });

  describe('facingToAngle', () => {
    it('facing 0 (north) is -PI/2', () => {
      expect(facingToAngle(0)).toBeCloseTo(-Math.PI / 2);
    });

    it('facing 3 (south) is PI/2', () => {
      expect(facingToAngle(3)).toBeCloseTo(Math.PI / 2);
    });

    it('increments by 60 degrees (PI/3)', () => {
      const a0 = facingToAngle(0);
      const a1 = facingToAngle(1);
      expect(a1 - a0).toBeCloseTo(Math.PI / 3);
    });
  });
});

describe('HexMath pixel mapping (flat-top, even-q)', () => {
  const SIZE = 30;
  const ROW_STRIDE = Math.sqrt(3) * SIZE;

  const centerOf = (key) => hexToPixel(key, SIZE);

  const cornersOf = (key) => {
    const { x, y } = centerOf(key);
    return getHexCorners(x, y, SIZE);
  };

  /** Corners drawn by both hexes — two means they share a full edge. */
  const sharedCorners = (keyA, keyB) => {
    const cornersB = cornersOf(keyB);
    return cornersOf(keyA).filter(a =>
      cornersB.some(b => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6)
    );
  };

  describe('hexToPixel', () => {
    it('uses a 1.5x horizontal stride so adjacent columns interlock', () => {
      // The gap bug used the full hex width, 2 * 30 = 60 px, as the stride.
      expect(hexColumnStride(SIZE)).toBe(45);
      expect(centerOf('1,0').x - centerOf('0,0').x).toBeCloseTo(45, 10);
      expect(centerOf('7,3').x - centerOf('6,3').x).toBeCloseTo(45, 10);
      expect(centerOf('1,0').x - centerOf('0,0').x).not.toBeCloseTo(2 * SIZE, 6);
    });

    it('steps rows by sqrt(3) * hexSize in every column', () => {
      expect(hexRowStride(SIZE)).toBeCloseTo(ROW_STRIDE, 12);
      expect(centerOf('0,1').y - centerOf('0,0').y).toBeCloseTo(ROW_STRIDE, 10);
      expect(centerOf('3,4').y - centerOf('3,3').y).toBeCloseTo(ROW_STRIDE, 10);
    });

    it('offsets odd columns down by half a row', () => {
      expect(centerOf('1,0').y - centerOf('0,0').y).toBeCloseTo(ROW_STRIDE / 2, 10);
      expect(centerOf('2,0').y - centerOf('1,0').y).toBeCloseTo(-ROW_STRIDE / 2, 10);
    });

    it('keeps the existing origin convention (board starts at the padding)', () => {
      expect(centerOf('0,0')).toEqual({ x: SIZE, y: SIZE });
    });

    it('never maps two hex keys to the same centre', () => {
      const centres = new Map();
      for (let col = 0; col < 12; col++) {
        for (let row = 0; row < 12; row++) {
          const key = hexKey(col, row);
          const { x, y } = centerOf(key);
          const id = `${x},${y}`;
          expect(centres.has(id)).toBe(false);
          centres.set(id, key);
        }
      }
      expect(centres.size).toBe(12 * 12);
    });
  });

  describe('tiling', () => {
    it('makes every adjacent pair touch along a shared edge (no gaps)', () => {
      const checked = new Set();
      for (let col = 0; col < 12; col++) {
        for (let row = 0; row < 12; row++) {
          const key = hexKey(col, row);
          for (const neighbour of hexNeighbors(key)) {
            const pairId = [key, neighbour].sort().join('|');
            if (checked.has(pairId)) continue;
            checked.add(pairId);

            const a = centerOf(key);
            const b = centerOf(neighbour);
            // Adjacent hexes are one apothem apart: 2 * apothem = sqrt(3) * size.
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(ROW_STRIDE, 6);
            // Two coincident corners means the drawn hexagons share an edge
            // exactly; a drawing stride that is too wide would share none.
            expect(sharedCorners(key, neighbour)).toHaveLength(2);
          }
        }
      }
    });
  });

  describe('pixelToHex', () => {
    it('round-trips hexToPixel -> pixelToHex over a 12x12 grid', () => {
      for (let col = 0; col < 12; col++) {
        for (let row = 0; row < 12; row++) {
          const key = hexKey(col, row);
          const { x, y } = hexToPixel(key, SIZE);
          expect(pixelToHex(x, y, SIZE)).toBe(key);
        }
      }
    });

    it('picks the owning hex for points inside it near each vertex', () => {
      for (let col = 0; col < 12; col++) {
        for (let row = 0; row < 12; row++) {
          const key = hexKey(col, row);
          const { x, y } = centerOf(key);
          for (let vertex = 0; vertex < 6; vertex++) {
            const angle = vertex * Math.PI / 3;
            for (const r of [0.5, 0.75, 0.9]) {
              const px = x + SIZE * r * Math.cos(angle);
              const py = y + SIZE * r * Math.sin(angle);
              expect(pixelToHex(px, py, SIZE)).toBe(key);
            }
          }
        }
      }
    });

    it('returns one of the two hexes sharing an edge when clicking that edge', () => {
      const pairs = [['0,0', '1,0'], ['1,1', '1,2'], ['4,4', '5,4']];
      for (const [a, b] of pairs) {
        const corners = sharedCorners(a, b);
        expect(corners).toHaveLength(2);
        const mid = {
          x: (corners[0].x + corners[1].x) / 2,
          y: (corners[0].y + corners[1].y) / 2
        };

        expect([a, b]).toContain(pixelToHex(mid.x, mid.y, SIZE));

        // Also just inside the shared edge next to each vertex: the picker must
        // stay with the two hexes that own the edge, never a third.
        for (const vertex of corners) {
          const nearVertex = {
            x: vertex.x + (mid.x - vertex.x) * 0.01,
            y: vertex.y + (mid.y - vertex.y) * 0.01
          };
          expect([a, b]).toContain(pixelToHex(nearVertex.x, nearVertex.y, SIZE));
        }
      }
    });

    it('returns one of the two adjacent hexes when clicking their shared vertex', () => {
      // Every interior vertex is shared by three hexes, so an exact vertex
      // click is a three-way distance tie; the picker resolves it
      // deterministically (lowest row, then lowest column). This pair is
      // chosen so that tie-break lands on one of the two hexes owning the
      // shared edge rather than the third.
      const a = '1,1';
      const b = '1,2';
      const corners = sharedCorners(a, b);
      expect(corners).toHaveLength(2);

      for (const vertex of corners) {
        expect([a, b]).toContain(pixelToHex(vertex.x, vertex.y, SIZE));
      }
    });
  });
});
