/**
 * R4 contract: every event the engine emits must be plain data.
 *
 * The server broadcasts these payloads to clients, so a class instance (a
 * Weapon, a Set, a Map) that survives here would be silently flattened by
 * JSON.stringify and arrive at the client without its methods.
 */

import { describe, it, expect, vi } from 'vitest';
import { createTestEngine, createTestUnit, createWeaponDef, makeDiceRoller } from '../helpers/testUtils.js';

/** Throws when the value contains anything that JSON cannot round-trip. */
function assertPlain(value, path = 'payload') {
  if (value === null || value === undefined) return;

  const kind = typeof value;
  if (kind === 'function') throw new Error(`function at ${path}`);
  if (kind !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPlain(entry, `${path}[${index}]`));
    return;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`${value.constructor ? value.constructor.name : 'class'} instance at ${path}`);
  }

  for (const [key, entry] of Object.entries(value)) {
    assertPlain(entry, `${path}.${key}`);
  }
}

function recordEvents(engine) {
  const events = [];
  const original = engine.eventBus.emit.bind(engine.eventBus);

  vi.spyOn(engine.eventBus, 'emit').mockImplementation((name, payload) => {
    events.push({ name, payload });
    return original(name, payload);
  });

  return events;
}

function buildEngine() {
  const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
  const jenner = createTestUnit('jenner-jr7d', 1, 'jenner');
  atlas.position = { hexKey: '5,5', facing: 0 };
  jenner.position = { hexKey: '5,4', facing: 3 };

  const engine = createTestEngine({ units: { atlas, jenner } });
  engine.diceRoller = makeDiceRoller(7);
  return { engine, atlas, jenner };
}

function driveTurn(engine) {
  engine.phaseManager.enterPhase('initiative');
  engine.phaseManager.enterPhase('movement');
  engine.phaseManager.clearQueue();
  engine.stateManager.getState().currentPlayer = 0;

  engine.processAction(0, {
    type: 'move', unitId: 'atlas', path: ['5,5', '5,6'], movementType: 'walk'
  });

  engine.phaseManager.enterPhase('weapon_attack');
  engine.phaseManager.clearQueue();
  engine.stateManager.getState().currentPlayer = 0;

  engine.processAction(0, {
    type: 'fire', attackerId: 'atlas', targetId: 'jenner',
    weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
  });

  engine.phaseManager.enterPhase('physical_attack');
  engine.phaseManager.clearQueue();
  engine.stateManager.getState().currentPlayer = 0;

  engine.processAction(0, {
    type: 'physicalAttack', attackerId: 'atlas', targetId: 'jenner', attackType: 'punch'
  });

  engine.phaseManager.enterPhase('heat');
  engine.phaseManager.enterPhase('end');
}

describe('event payload contract', () => {
  it('every emitted payload is plain data', () => {
    const { engine } = buildEngine();
    const events = recordEvents(engine);

    driveTurn(engine);

    expect(events.length).toBeGreaterThan(5);

    const failures = [];
    for (const { name, payload } of events) {
      try {
        assertPlain(payload, `${name}`);
      } catch (error) {
        failures.push(error.message);
      }
    }

    expect(failures).toEqual([]);
  });

  it('payloads survive a JSON hop without losing their fields', () => {
    const { engine } = buildEngine();
    const events = recordEvents(engine);

    driveTurn(engine);

    const fire = events.find(e => e.name === 'unitAttacked');
    expect(fire).toBeDefined();

    const wire = JSON.parse(JSON.stringify(fire.payload));
    expect(wire.result.targetNumber).toBe(fire.payload.result.targetNumber);
    expect(wire.result.hit).toBe(fire.payload.result.hit);
  });

  it('covers the urban events as well', () => {
    const { engine, atlas } = buildEngine();
    const state = engine.stateManager.getState();
    // A hex the Atlas will flatten just by walking into it.
    state.map.hexes.get('5,6').building = {
      id: 'b1', type: 'medium', levels: 2, cf: 3, currentCF: 3
    };
    // Face the destination so the move costs one point of movement.
    atlas.position.facing = 3;

    const events = recordEvents(engine);

    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.clearQueue();
    state.currentPlayer = 0;
    const moveResult = engine.processAction(0, {
      type: 'move', unitId: 'atlas', path: ['5,5', '5,6'], movementType: 'walk'
    });
    expect(moveResult).toMatchObject({ success: true });
    // A medium building adds +2 to the one point for entering a hex (p136),
    // so the Atlas spends all three of its MP.
    expect(moveResult.remainingMP).toBe(0);

    const names = events.map(e => e.name);
    expect(names).toContain('buildingEntered');
    expect(names).toContain('buildingCollapsed');

    for (const { name, payload } of events) {
      expect(() => assertPlain(payload, name)).not.toThrow();
    }
  });
});
