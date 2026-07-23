/**
 * Deterministic PRNG using Mulberry32 algorithm.
 * Seeded from game ID and turn number, enabling replay and sync.
 */

export class DiceRoller {
  constructor(seed) {
    this._seed = seed;
    this._state = seed;
  }

  reset() {
    this._state = this._seed;
  }

  /** Returns a float in [0, 1) */
  next() {
    let t = (this._state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns integer in [1, 6] */
  roll1d6() {
    return Math.floor(this.next() * 6) + 1;
  }

  /** Returns sum of two 1d6 rolls [2, 12] */
  roll2d6() {
    return this.roll1d6() + this.roll1d6();
  }

  /** Returns array of n 1d6 rolls */
  rollNd6(n) {
    return Array.from({ length: n }, () => this.roll1d6());
  }
}

/**
 * Create a DiceRoller from a composite seed.
 * @param {string} gameId - Unique game identifier
 * @param {number} turn - Current turn number
 * @param {string} [phase] - Optional phase name
 * @returns {DiceRoller}
 */
export function createSeededDice(gameId, turn, phase = '') {
  const seedStr = `${gameId}-${turn}-${phase}`;
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    const char = seedStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return new DiceRoller(Math.abs(hash) || 1);
}
