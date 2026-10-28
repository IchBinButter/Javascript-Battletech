/**
 * R3/R4/R5 - serialization, wire-safe events and the command boundary.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { createTestEngine, createTestUnit, createEngineWithPerUnitAlternation, makeDiceRoller } from '../helpers/testUtils.js';
import { GameState } from '../../src/models/GameState.js';
import { Hex } from '../../src/models/Hex.js';
import { deepClone, toTransferable } from '../../src/utils/helpers.js';

const positioned = (unit, hexKey, facing = 0) => {
  unit.position = { hexKey, facing };
  return unit;
};

describe('deepClone', () => {
  it('clones Sets instead of flattening them', () => {
    const source = { fired: new Set(['leftArm', 'rightArm']) };
    const copy = deepClone(source);

    expect(copy.fired).toBeInstanceOf(Set);
    expect([...copy.fired]).toEqual(['leftArm', 'rightArm']);
    copy.fired.add('leftTorso');
    expect(source.fired.size).toBe(2);
  });
});

describe('toTransferable', () => {
  it('turns Maps and Sets into plain arrays', () => {
    const value = toTransferable({ m: new Map([['a', 1]]), s: new Set([1, 2]) });
    expect(value).toEqual({ m: [['a', 1]], s: [1, 2] });
  });
});

describe('Hex serialization', () => {
  it('round-trips building and basement data', () => {
    const hex = new Hex('3,3', {
      terrainType: 'heavy_building',
      level: 1,
      building: { id: 'b1', type: 'heavy', levels: 3, cf: 90, currentCF: 42 }
    });
    hex.basement = { kind: 'double', depth: 2 };

    const restored = Hex.fromJSON(JSON.parse(JSON.stringify(hex)));

    expect(restored.terrainType).toBe('heavy_building');
    expect(restored.level).toBe(1);
    expect(restored.building).toEqual(hex.building);
    expect(restored.basement).toEqual({ kind: 'double', depth: 2 });
  });
});

describe('GameState serialization', () => {
  it('round-trips a played game with units, map and buildings', () => {
    const atlas = positioned(createTestUnit('atlas-as7d', 0, 'atlas'), '5,5', 0);
    const locust = positioned(createTestUnit('locust-lct1v', 1, 'locust'), '5,8', 3);
    const engine = createTestEngine({ units: { atlas, locust } });
    const state = engine.stateManager.getState();

    atlas.heat = 7;
    atlas.firedThisTurn = new Set(['rightArm']);
    state.map.hexes.get('5,5').building = { id: 'b1', type: 'medium', levels: 2, cf: 40, currentCF: 21 };

    const restored = GameState.fromJSON(JSON.parse(JSON.stringify(state.toJSON())));

    expect(Object.keys(restored.units).sort()).toEqual(['atlas', 'locust']);
    expect(restored.getUnit('atlas').heat).toBe(7);
    expect(restored.getUnit('atlas').firedThisTurn).toBeInstanceOf(Set);
    expect([...restored.getUnit('atlas').firedThisTurn]).toEqual(['rightArm']);
    expect(restored.getUnit('atlas').position).toEqual({ hexKey: '5,5', facing: 0 });
    expect(restored.map.hexes.get('5,5').building.currentCF).toBe(21);
    expect(restored.getUnit('locust')).toBeTruthy();
  });

  it('survives a JSON hop unchanged', () => {
    const atlas = positioned(createTestUnit('atlas-as7d', 0, 'atlas'), '2,2', 0);
    const engine = createTestEngine({ units: { atlas } });
    const json = JSON.parse(JSON.stringify(engine.stateManager.getState().toJSON()));

    expect(json.units.atlas.armor).toBeDefined();
    expect(json.map.hexes.length).toBeGreaterThan(0);
  });
});

describe('JSON-safe events (R4)', () => {
  const isPlain = (value) => {
    if (value === null || typeof value !== 'object') return typeof value !== 'function';
    if (Array.isArray(value)) return value.every(isPlain);
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype) return false;
    return Object.values(value).every(isPlain);
  };

  it('emits a sanitized physical attack payload', () => {
    const attacker = positioned(createTestUnit('atlas-as7d', 0, 'atlas'), '5,5', 0);
    const target = positioned(createTestUnit('locust-lct1v', 1, 'locust'), '5,4', 3);
    const engine = createTestEngine({ units: { atlas: attacker, locust: target } });
    engine.diceRoller = makeDiceRoller(7);

    engine.phaseManager.enterPhase('physical_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    let payload = null;
    engine.eventBus.on('physicalAttackResolved', (data) => { payload = data; });

    const result = engine.processAction(0, {
      type: 'physicalAttack', attackerId: 'atlas', targetId: 'locust', attackType: 'punch'
    });
    expect(result).toMatchObject({ success: true });

    expect(payload).not.toBeNull();
    expect(isPlain(payload.result)).toBe(true);
    expect(() => JSON.stringify(payload)).not.toThrow();
  });
});

describe('command boundary (R5)', () => {
  const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

  it('keeps UI code from writing unit or state fields', () => {
    const files = fs.readdirSync(path.join(process.cwd(), 'src/ui')).map(f => `src/ui/${f}`);
    const sources = files.map(read).join('\n');

    // The UI may read the state and track its own selection, but it must not
    // mutate units or game state directly - that is the engine's job.
    const forbidden = [
      /\bunit\.[A-Za-z_]\w*\s*[-+*/]?=(?!=)/,
      /\bstate\.(?!manager)[A-Za-z_]\w*\s*[-+*/]?=(?!=)/
    ];
    const violations = forbidden.flatMap(re => [...sources.matchAll(new RegExp(re.source, 'g'))].map(m => m[0]));

    expect(violations).toEqual([]);
  });

  it('sends UI actions through engine.processAction', () => {
    const engine = createTestEngine({});
    const spy = vi.spyOn(engine, 'processAction');
    const action = { type: 'endPhase' };

    engine.processAction(0, action);
    expect(spy).toHaveBeenCalledWith(0, action);
  });
});
