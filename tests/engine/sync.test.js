/**
 * M3 / M4 - the sync primitives the multiplayer server will use.
 *
 * M3: snapshot + diff + apply must reconstruct the live state exactly.
 * M4: a diff computed from a player's projected view must never mention a
 *     hidden unit.
 */

import { describe, it, expect } from 'vitest';
import { createTestEngine, createTestUnit, createWeaponDef, makeDiceRoller } from '../helpers/testUtils.js';
import { GameState } from '../../src/models/GameState.js';
import { StateManager } from '../../src/engine/StateManager.js';
import { projectStateForPlayer } from '../../src/engine/visibility.js';

const json = (value) => JSON.parse(JSON.stringify(value));
const manager = new StateManager({});

const positioned = (unit, hexKey, facing = 0) => {
  unit.position = { hexKey, facing };
  return unit;
};

function setup() {
  const atlas = positioned(createTestUnit('atlas-as7d', 0, 'atlas'), '5,7', 0);
  const jenner = positioned(createTestUnit('jenner-jr7d', 1, 'jenner'), '5,5', 3);
  const engine = createTestEngine({ units: { atlas, jenner } });
  engine.diceRoller = makeDiceRoller(7);
  return { engine, atlas, jenner };
}

/** A patch as a client receives it: plain data, no class instances. */
const makePatch = (engine, snapshotJson) =>
  json(manager.getStateDiff(snapshotJson, engine.stateManager.getState()));

const applyPatch = (snapshotJson, patch) => {
  const copy = json(snapshotJson);
  manager.applyStateDiff(copy, patch);
  return copy;
};

describe('M3 state sync', () => {
  it('rebuilds the live state from a snapshot plus its diff', () => {
    const { engine } = setup();
    const state = engine.stateManager.getState();
    const snapshot = json(state.toJSON());

    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();
    state.currentPlayer = 0;
    engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'jenner',
      weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
    });

    // State that is not on a unit: a damaged building, fire and smoke.
    state.map.hexes.get('5,5').building = {
      id: 'b1', type: 'light', levels: 1, cf: 15, currentCF: 9
    };
    state.fireHexes = ['5,5'];
    state.smokeHexes = { '5,6': { level: 'light', turnsRemaining: 6 } };

    const patch = makePatch(engine, snapshot);
    const restored = GameState.fromJSON(applyPatch(snapshot, patch));

    const restoredJson = json(restored.toJSON());
    const liveJson = json(state.toJSON());

    const unitFieldDiff = {};
    for (const id of Object.keys(liveJson.units)) {
      const fields = Object.keys(liveJson.units[id]).filter(
        key => JSON.stringify(liveJson.units[id][key]) !== JSON.stringify(restoredJson.units[id][key])
      );
      if (fields.length > 0) unitFieldDiff[id] = fields;
    }

    const liveHexes = new Map(liveJson.map.hexes);
    const restoredHexes = new Map(restoredJson.map.hexes);
    const hexFieldDiff = {};
    for (const [key, hex] of liveHexes) {
      const other = restoredHexes.get(key) || {};
      const fields = Object.keys(hex).filter(
        field => JSON.stringify(hex[field]) !== JSON.stringify(other[field])
      );
      if (fields.length > 0) hexFieldDiff[key] = fields;
    }

    expect({ unitFieldDiff, hexFieldDiff }).toEqual({ unitFieldDiff: {}, hexFieldDiff: {} });
  });

  it('carries fire, smoke and hex changes in the patch', () => {
    const { engine } = setup();
    const state = engine.stateManager.getState();
    const snapshot = json(state.toJSON());

    state.fireHexes = ['5,5'];
    state.smokeHexes = { '5,6': { level: 'light', turnsRemaining: 6 } };
    state.map.hexes.get('5,5').terrainType = 'rubble';

    const patch = makePatch(engine, snapshot);

    expect(patch.fireHexes).toEqual(['5,5']);
    expect(patch.smokeHexes).toEqual({ '5,6': { level: 'light', turnsRemaining: 6 } });
    expect(patch.hexUpdates['5,5'].terrainType).toBe('rubble');
  });

  it('carries minefields and scheduled strikes through a patch and fromJSON', () => {
    const { engine } = setup();
    const state = engine.stateManager.getState();
    const snapshot = json(state.toJSON());

    state.minefields = { '5,6': { type: 'light', strength: 2 } };
    state.battlefieldSupport = {
      ...state.battlefieldSupport,
      strikes: [{ hexKey: '5,6', turn: 2, type: 'light_strike', owner: 0 }]
    };

    const patch = makePatch(engine, snapshot);

    expect(patch.minefields).toEqual({ '5,6': { type: 'light', strength: 2 } });
    expect(patch.battlefieldSupport.strikes)
      .toEqual([{ hexKey: '5,6', turn: 2, type: 'light_strike', owner: 0 }]);

    const restored = GameState.fromJSON(applyPatch(snapshot, patch));
    expect(restored.minefields).toEqual(state.minefields);
    expect(restored.battlefieldSupport.strikes).toEqual(state.battlefieldSupport.strikes);
    expect(restored.battlefieldSupport.points).toBe(state.battlefieldSupport.points);
  });

  it('sends an empty patch when nothing changed', () => {
    const { engine } = setup();
    const snapshot = json(engine.stateManager.getState().toJSON());

    const patch = makePatch(engine, snapshot);

    expect(patch.turn).toBeUndefined();
    expect(patch.phase).toBeUndefined();
    expect(patch.unitUpdates).toEqual({});
    expect(patch.hexUpdates).toBeUndefined();
    expect(patch.fireHexes).toBeUndefined();
    expect(patch.minefields).toBeUndefined();
    expect(patch.battlefieldSupport).toBeUndefined();
  });
});

describe('M4 projection-safe patches', () => {
  it('never mentions a hidden unit in a projected patch', () => {
    const { engine } = setup();
    const state = engine.stateManager.getState();
    state.hiddenUnits = { jenner: { hidden: true } };

    const viewBefore = projectStateForPlayer(state, 0);
    state.units.jenner.heat = 9;
    const viewAfter = projectStateForPlayer(state, 0);

    const patch = json(manager.getStateDiff(viewBefore, viewAfter));

    expect(viewBefore.units.jenner).toBeUndefined();
    expect(Object.keys(patch.unitUpdates)).not.toContain('jenner');
  });

  it('would leak through a raw patch, proving the projection matters', () => {
    const { engine } = setup();
    const state = engine.stateManager.getState();
    const snapshot = json(state.toJSON());

    state.units.jenner.heat = 9;
    const rawPatch = json(manager.getStateDiff(snapshot, state));

    expect(Object.keys(rawPatch.unitUpdates)).toContain('jenner');
  });

  it('keeps a hidden unit out of the client state when patches are applied', () => {
    const { engine } = setup();
    const state = engine.stateManager.getState();
    state.hiddenUnits = { jenner: { hidden: true } };

    // What player 0 is allowed to see, serialized as the server would send it.
    const clientSnapshot = json(projectStateForPlayer(state, 0).toJSON());

    state.units.jenner.heat = 9;
    state.units.atlas.heat = 4;
    state.phase = 'movement';

    const patch = json(manager.getStateDiff(
      clientSnapshot,
      projectStateForPlayer(state, 0)
    ));
    const patched = applyPatch(clientSnapshot, patch);

    expect(patched.phase).toBe('movement');
    expect(Object.keys(patch.unitUpdates)).toEqual(['atlas']);
    // The hidden unit was never in the client snapshot, so it cannot appear.
    expect(patched.units.jenner).toBeUndefined();
  });

  it('keeps the opponent\'s strikes and minefields out of the projection and its patch', () => {
    const { engine } = setup();
    const state = engine.stateManager.getState();

    state.battlefieldSupport = {
      points: 12,
      selections: [],
      strikes: [{ hexKey: '5,6', turn: 2, type: 'light_strike', owner: 0 }]
    };
    state.minefields = {};

    // Player 0's client snapshot: only their own strike is visible.
    const clientSnapshot = json(projectStateForPlayer(state, 0).toJSON());

    // The opponent schedules a secret strike and places a hidden minefield;
    // player 0 also updates their own strike and places their own field.
    state.battlefieldSupport.strikes = [
      { hexKey: '5,6', turn: 3, type: 'light_strike', owner: 0 },
      { hexKey: '7,7', turn: 2, type: 'sniper', owner: 1 }
    ];
    state.minefields = {
      '5,6': { type: 'light', strength: 2, owner: 0 },
      '8,8': { type: 'medium', strength: 4, owner: 1 }
    };

    const view = projectStateForPlayer(state, 0);
    expect(view.battlefieldSupport.strikes).toEqual([
      { hexKey: '5,6', turn: 3, type: 'light_strike', owner: 0 }
    ]);
    expect(view.minefields).toEqual({ '5,6': { type: 'light', strength: 2, owner: 0 } });

    // The raw state still holds every secret.
    expect(state.battlefieldSupport.strikes).toHaveLength(2);
    expect(state.minefields['8,8']).toBeDefined();

    // A patch computed from the two projected views carries only the viewer's
    // own hidden-information fields.
    const patch = json(manager.getStateDiff(clientSnapshot, view));
    expect(patch.battlefieldSupport.strikes).toEqual([
      { hexKey: '5,6', turn: 3, type: 'light_strike', owner: 0 }
    ]);
    expect(patch.minefields).toEqual({ '5,6': { type: 'light', strength: 2, owner: 0 } });
    expect(JSON.stringify(patch)).not.toContain('7,7');
    expect(JSON.stringify(patch)).not.toContain('8,8');

    // Projection cloned the filtered fields instead of handing out source data.
    expect(view.battlefieldSupport).not.toBe(state.battlefieldSupport);
    expect(view.minefields).not.toBe(state.minefields);
  });

  it('hides an ownerless strike and an ownerless minefield from every viewer', () => {
    const { engine } = setup();
    const state = engine.stateManager.getState();
    // An ownerless strike is unowned: it must not leak into either view.
    state.battlefieldSupport = {
      ...state.battlefieldSupport,
      strikes: [{ hexKey: '9,9', turn: 2, type: 'thumper', owner: null }]
    };
    // A minefield with no owner cannot be attributed to a player either.
    state.minefields = { '9,9': { type: 'light', strength: 2 } };

    for (const viewerId of [0, 1]) {
      const view = projectStateForPlayer(state, viewerId);
      expect(view.battlefieldSupport.strikes).toEqual([]);
      expect(view.minefields).toEqual({});
    }

    // The raw state still holds the manually inserted ownerless records.
    expect(state.battlefieldSupport.strikes).toHaveLength(1);
  });
});
