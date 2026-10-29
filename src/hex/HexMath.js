/**
 * HexMath - Pure math functions for hex grid operations.
 *
 * Coordinate system: Flat-top hexes, even-q offset coordinates.
 * Primary key format: "col,row" string (e.g., "12,34").
 * For distance/line calculations, we convert internally to cube coordinates.
 *
 * Facing: 0 = north (top), increments clockwise:
 *   0=N (0°), 1=NE (60°), 2=SE (120°), 3=S (180°), 4=SW (240°), 5=NW (300°)
 */

import { parseHexKey, hexKey } from '../utils/helpers.js';
export { hexKey };

/**
 * Convert even-q offset to cube coordinates.
 * Cube: q + r + s = 0
 */
export function offsetToCube(col, row) {
  const q = col;
  const r = row - (col - (col & 1)) / 2;
  const s = -q - r;
  return { q, r, s };
}

/**
 * Convert cube to even-q offset coordinates.
 */
export function cubeToOffset(q, r, s) {
  const col = q;
  const row = r + (q - (q & 1)) / 2;
  return { col, row };
}

/**
 * Round cube coordinates to nearest integer cube.
 */
function cubeRound(q, r, s) {
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  } else {
    rs = -rq - rr;
  }

  return { q: rq, r: rr, s: rs };
}

/**
 * Distance between two hexes in hex units.
 */
export function hexDistance(key1, key2) {
  const a = parseHexKey(key1);
  const b = parseHexKey(key2);
  const ca = offsetToCube(a.col, a.row);
  const cb = offsetToCube(b.col, b.row);
  return Math.max(
    Math.abs(ca.q - cb.q),
    Math.abs(ca.r - cb.r),
    Math.abs(ca.s - cb.s)
  );
}

/**
 * Direction vectors for even-q offset hex neighbors.
 * Order: N, NE, SE, S, SW, NW (matching facing system)
 */
const EVEN_NEIGHBORS = [
  { dc: 0, dr: -1 },   // 0: N
  { dc: 1, dr: -1 },   // 1: NE
  { dc: 1, dr: 0 },    // 2: SE
  { dc: 0, dr: 1 },    // 3: S
  { dc: -1, dr: 0 },   // 4: SW
  { dc: -1, dr: -1 }   // 5: NW
];

const ODD_NEIGHBORS = [
  { dc: 0, dr: -1 },   // 0: N
  { dc: 1, dr: 0 },    // 1: NE
  { dc: 1, dr: 1 },    // 2: SE
  { dc: 0, dr: 1 },    // 3: S
  { dc: -1, dr: 1 },   // 4: SW
  { dc: -1, dr: 0 }    // 5: NW
];

/**
 * Get all 6 neighbor hex keys.
 */
export function hexNeighbors(key) {
  const { col, row } = parseHexKey(key);
  const isEven = col % 2 === 0;
  const offsets = isEven ? EVEN_NEIGHBORS : ODD_NEIGHBORS;

  return offsets.map(d => hexKey(col + d.dc, row + d.dr));
}

/**
 * Get neighbor in a specific direction (0-5 facing).
 */
export function getNeighborInDirection(key, direction) {
  const { col, row } = parseHexKey(key);
  const isEven = col % 2 === 0;
  const offsets = isEven ? EVEN_NEIGHBORS : ODD_NEIGHBORS;
  const d = offsets[direction % 6];
  return hexKey(col + d.dc, row + d.dr);
}

/**
 * Bresenham's line algorithm over a hex grid.
 * Returns array of hex keys the line passes through (inclusive of start and end).
 */
export function hexLine(startKey, endKey) {
  const a = parseHexKey(startKey);
  const b = parseHexKey(endKey);

  const ca = offsetToCube(a.col, a.row);
  const cb = offsetToCube(b.col, b.row);

  const N = hexDistance(startKey, endKey);
  const results = [];

  for (let i = 0; i <= N; i++) {
    const t = N === 0 ? 0 : i / N;
    const q = ca.q + (cb.q - ca.q) * t;
    const r = ca.r + (cb.r - ca.r) * t;
    const s = ca.s + (cb.s - ca.s) * t;
    const rounded = cubeRound(q + 1e-6, r + 1e-6, s + 2e-6);
    const offset = cubeToOffset(rounded.q, rounded.r, rounded.s);
    results.push(hexKey(offset.col, offset.row));
  }

  return results;
}

/**
 * Get all hexes at exact distance from center.
 */
export function hexRing(centerKey, radius) {
  if (radius === 0) return [centerKey];

  const { col, row } = parseHexKey(centerKey);
  const center = offsetToCube(col, row);

  // Start at one corner of the ring
  let cube = {
    q: center.q + 1,
    r: center.r - 1,
    s: center.s
  };

  // Rotate to correct start for radius
  for (let i = 1; i < radius; i++) {
    cube = { q: cube.q + 1, r: cube.r - 1, s: cube.s };
  }

  const results = [];
  const cubeDirs = [
    { dq: 1, dr: 0, ds: -1 },
    { dq: 0, dr: 1, ds: -1 },
    { dq: -1, dr: 1, ds: 0 },
    { dq: -1, dr: 0, ds: 1 },
    { dq: 0, dr: -1, ds: 1 },
    { dq: 1, dr: -1, ds: 0 }
  ];

  for (let dir = 0; dir < 6; dir++) {
    for (let i = 0; i < radius; i++) {
      const offset = cubeToOffset(cube.q, cube.r, cube.s);
      results.push(hexKey(offset.col, offset.row));
      cube.q += cubeDirs[dir].dq;
      cube.r += cubeDirs[dir].dr;
      cube.s += cubeDirs[dir].ds;
    }
  }

  return results;
}

/**
 * Get all hexes within maxRadius of center.
 */
export function hexSpiral(centerKey, maxRadius) {
  const results = [centerKey];
  for (let r = 1; r <= maxRadius; r++) {
    results.push(...hexRing(centerKey, r));
  }
  return results;
}

/**
 * Convert facing (0-5) to an angle in radians.
 * 0 = north (top) = -PI/2 in screen coords.
 */
export function facingToAngle(facing) {
  // Screen coords: y increases downward, so north is -PI/2
  return -Math.PI / 2 + (facing * Math.PI / 3);
}

/**
 * Get the direction (0-5 facing) from one hex to another.
 * Returns -1 if same hex.
 */
export function directionBetween(fromKey, toKey) {
  if (fromKey === toKey) return -1;

  const { col, row } = parseHexKey(fromKey);
  const center = offsetToCube(col, row);

  let bestDir = 0;
  let bestDist = Infinity;

  for (let dir = 0; dir < 6; dir++) {
    const neighbor = getNeighborInDirection(fromKey, dir);
    const d = hexDistance(neighbor, toKey);
    if (d < bestDist) {
      bestDist = d;
      bestDir = dir;
    }
  }

  return bestDir;
}

/**
 * Facing offset: given a facing (0-5) and a turning amount (-1 = left 1 hexside, +1 = right 1 hexside),
 * returns the new facing.
 */
export function adjustFacing(facing, turnHexsides) {
  return ((facing + turnHexsides) % 6 + 6) % 6;
}

/**
 * Calculate the 6 corner points of a hex for rendering.
 * @param {number} centerX - Pixel x center
 * @param {number} centerY - Pixel y center
 * @param {number} size - Hex size (center to vertex distance)
 * @returns {Array<{x: number, y: number}>} Array of 6 corner points
 */
export function getHexCorners(centerX, centerY, size) {
  const corners = [];
  // Flat-top hex: vertices start at 0° (right)
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i);
    corners.push({
      x: centerX + size * Math.cos(angle),
      y: centerY + size * Math.sin(angle)
    });
  }
  return corners;
}

/**
 * Distance between the centres of two horizontally adjacent columns.
 * A flat-top hex is 2 * hexSize wide, but columns interlock: each hex covers
 * only a quarter of its own width past its centre, so the stride is 1.5x.
 */
export function hexColumnStride(hexSize) {
  return 1.5 * hexSize;
}

/** Distance between the centres of two vertically adjacent hexes. */
export function hexRowStride(hexSize) {
  return Math.sqrt(3) * hexSize;
}

/**
 * Convert hex key to pixel center coordinates.
 * Flat-top, even-q layout: adjacent columns interlock at a 1.5 * hexSize
 * horizontal stride and odd columns sit half a row lower.
 */
export function hexToPixel(key, hexSize) {
  const { col, row } = parseHexKey(key);
  const colStride = hexColumnStride(hexSize);
  const rowStride = hexRowStride(hexSize);

  const x = hexSize + col * colStride;
  const y = hexSize + row * rowStride + (col % 2 === 0 ? 0 : rowStride / 2);

  return { x, y };
}

/**
 * Tolerances used when picking the hex under a pixel. Exact ties happen on
 * shared edges and vertices; PICK_EPSILON keeps floating-point noise from
 * changing the winner, and PICK_DIST_EPSILON is its square, for use on the
 * squared distances.
 */
const PICK_EPSILON = 1e-9;
const PICK_DIST_EPSILON = PICK_EPSILON * PICK_EPSILON;

/**
 * Convert pixel coordinates to hex key.
 * Uses the even-q offset grid and mirrors hexToPixel exactly.
 */
export function pixelToHex(px, py, hexSize) {
  const colStride = hexColumnStride(hexSize);
  const rowStride = hexRowStride(hexSize);

  // Estimate the column, then the row for that column's parity. Near a
  // column boundary the parity-driven row estimate can be off by one, so the
  // estimate is only a seed: the closest centre among it and its six
  // neighbours wins.
  let col = Math.round((px - hexSize) / colStride);
  col = Math.max(0, col);

  const rowOffset = col % 2 === 0 ? 0 : rowStride / 2;

  let row = Math.round((py - hexSize - rowOffset) / rowStride);
  row = Math.max(0, row);

  const candidates = [hexKey(col, row), ...hexNeighbors(hexKey(col, row))];

  let bestKey = hexKey(col, row);
  let bestCol = col;
  let bestRow = row;
  let bestDist = Infinity;

  for (const key of candidates) {
    const center = hexToPixel(key, hexSize);
    const dist = (px - center.x) ** 2 + (py - center.y) ** 2;
    const { col: candCol, row: candRow } = parseHexKey(key);

    // Closest centre wins. Exact ties (a click on a shared edge or vertex)
    // go to the lowest row, then the lowest column so picking is stable.
    const closer = dist < bestDist - PICK_DIST_EPSILON;
    const tied = Math.abs(dist - bestDist) <= PICK_DIST_EPSILON;
    const winsTie = tied && (candRow < bestRow || (candRow === bestRow && candCol < bestCol));

    if (closer || winsTie) {
      bestKey = key;
      bestCol = candCol;
      bestRow = candRow;
      bestDist = dist;
    }
  }

  return bestKey;
}
