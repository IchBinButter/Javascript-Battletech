/**
 * R2 - determinism. Nothing that reaches a replay, a save file or a server may
 * depend on the wall clock or on Math.random.
 */

import { describe, it, expect } from 'vitest';
import { Unit } from '../../src/models/Unit.js';
import { GameEngine } from '../../src/engine/GameEngine.js';
import { InitiativeManager } from '../../src/engine/InitiativeManager.js';
import { HexGrid } from '../../src/hex/HexGrid.js';
import { createTestEngine } from '../helpers/testUtils.js';
import { makeDiceRoller } from '../helpers/testUtils.js';
import mechsData from '../../src/data/mechs.json' with { type: 'json' };

const atlasDef = mechsData.mechs.find(m => m.id === 'atlas-as7d');

describe('unit ids', () => {
  it('are sequential instead of clock based', () => {
    const first = new Unit(atlasDef, 0);
    const second = new Unit(atlasDef, 0);

    expect(first.id).toMatch(/^atlas-as7d-0-\d+$/);
    expect(second.id).not.toBe(first.id);
    expect(Number(second.id.split('-').pop())).toBe(Number(first.id.split('-').pop()) + 1);
  });

  it('still honour an explicit id', () => {
    expect(new Unit(atlasDef, 1, 'custom').id).toBe('custom');
  });
});

describe('game ids and dice', () => {
  it('assigns sequential game ids when none is given', () => {
    const a = createTestEngine({});
    const b = createTestEngine({});
    expect(a.gameId).not.toBe(b.gameId);
    expect(a.gameId).toMatch(/^game-\d+$/);
  });

  it('uses an injected game id to seed the dice', () => {
    const first = new GameEngine({ turn: 1, units: {}, map: { hexes: new Map() } }, { gameId: 'replay-1' });
    const second = new GameEngine({ turn: 1, units: {}, map: { hexes: new Map() } }, { gameId: 'replay-1' });

    const rollsA = [first.diceRoller.roll2d6(), first.diceRoller.roll2d6()];
    const rollsB = [second.diceRoller.roll2d6(), second.diceRoller.roll2d6()];
    expect(rollsA).toEqual(rollsB);
  });

  it('accepts an injected dice roller', () => {
    const roller = makeDiceRoller(5);
    const engine = new GameEngine({ turn: 1, units: {}, map: { hexes: new Map() } }, { diceRoller: roller });
    expect(engine.diceRoller).toBe(roller);
  });
});

describe('initiative ties', () => {
  it('fall back to the lowest player id, not a random pick', () => {
    const manager = new InitiativeManager();
    // A roller that always returns the same value forces the 100-retry fallback.
    const stuck = { roll2d6: () => 7 };

    const result = manager.rollInitiative([{ id: 1 }, { id: 0 }], stuck);
    expect(result.winner).toBe(0);
  });
});

describe('map generation', () => {
  it('takes an injectable random source', () => {
    const gridA = HexGrid.createDefaultMap(() => 0.5);
    const gridB = HexGrid.createDefaultMap(() => 0.5);

    for (const [key, hex] of gridA.hexes) {
      const other = gridB.hexes.get(key);
      expect(other.terrainType).toBe(hex.terrainType);
      expect(other.level).toBe(hex.level);
    }
  });
});
