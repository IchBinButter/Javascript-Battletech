import { describe, it, expect } from 'vitest';
import {
  createTestEngine,
  createTestUnit,
  createWeaponDef,
  makeDiceRoller,
  hitTables
} from '../helpers/testUtils.js';

describe('Integration: GameEngine Action Processing Flow', () => {
  function createEngineWithUnits() {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 3 };
    jenner.position = { hexKey: '7,7', facing: 0 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    return { engine, atlas, jenner };
  }

  describe('processAction dispatching', () => {
    it('rejects unknown action types', () => {
      const { engine } = createEngineWithUnits();
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, { type: 'invalidAction' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
    });

    it('rejects actions from wrong player', () => {
      const { engine } = createEngineWithUnits();
      engine.phaseManager.enterPhase('movement');
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(1, {
        type: 'move',
        unitId: 'jenner-1',
        path: ['7,7', '7,8'],
        movementType: 'walk'
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not your turn');
    });

    it('emits actionProcessed event for every action', () => {
      const { engine } = createEngineWithUnits();
      const processed = [];
      engine.eventBus.on('actionProcessed', (data) => {
        processed.push({ type: data.action.type, success: data.result.success });
      });

      engine.processAction(0, { type: 'endPhase' });
      expect(processed).toHaveLength(1);
      expect(processed[0].type).toBe('endPhase');
      expect(processed[0].success).toBe(true);
    });

    it('logs every action with phase info', () => {
      const { engine } = createEngineWithUnits();

      engine.processAction(0, { type: 'endPhase' }); // initiative -> movement
      engine.stateManager.getState().currentPlayer = 0;
      engine.processAction(0, {
        type: 'move',
        unitId: 'atlas-0',
        path: ['5,7', '5,8'],
        movementType: 'walk'
      });

      expect(engine.actionLog).toHaveLength(2);
      // endPhase action is logged AFTER nextPhase() runs, so phase = new phase
      expect(engine.actionLog[0].phase).toBe('movement');
      expect(engine.actionLog[1].phase).toBe('movement');
    });
  });

  describe('movement action flow', () => {
    it('validates and applies movement', () => {
      const { engine, atlas } = createEngineWithUnits();
      engine.phaseManager.enterPhase('movement');
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'move',
        unitId: 'atlas-0',
        path: ['5,7', '5,8'],
        movementType: 'walk'
      });

      expect(result.success).toBe(true);
      expect(result.unitId).toBe('atlas-0');
      expect(result.finalHex).toBe('5,8');
      expect(atlas.position.hexKey).toBe('5,8');
    });

    it('rejects movement for non-existent unit', () => {
      const { engine } = createEngineWithUnits();
      engine.phaseManager.enterPhase('movement');
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'move',
        unitId: 'nonexistent',
        path: ['5,7', '5,8'],
        movementType: 'walk'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unit not found');
    });

    it('emits unitMoved event on successful move', () => {
      const { engine } = createEngineWithUnits();
      const moved = [];
      engine.eventBus.on('unitMoved', (data) => moved.push(data));

      engine.phaseManager.enterPhase('movement');
      engine.stateManager.getState().currentPlayer = 0;
      engine.processAction(0, {
        type: 'move',
        unitId: 'atlas-0',
        path: ['5,7', '5,8'],
        movementType: 'walk'
      });

      expect(moved).toHaveLength(1);
      expect(moved[0].unitId).toBe('atlas-0');
      expect(moved[0].hexKey).toBe('5,8');
    });

    it('sets movement modifier based on movement type', () => {
      const { engine, atlas } = createEngineWithUnits();
      engine.phaseManager.enterPhase('movement');
      engine.stateManager.getState().currentPlayer = 0;

      engine.processAction(0, {
        type: 'move',
        unitId: 'atlas-0',
        path: ['5,7', '5,8'],
        movementType: 'run'
      });

      expect(atlas._movementModifier).toBe(2); // run = +2
    });
  });

  describe('fire action flow', () => {
    it('requires attackResolver to be initialized', () => {
      const { engine, atlas, jenner } = createEngineWithUnits();
      engine.attackResolver = null;
      engine.phaseManager.enterPhase('weapon_attack');
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: createWeaponDef('med_laser'),
        weaponLocation: 'rightArm'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });

    it('rejects fire for non-existent attacker', () => {
      const { engine } = createEngineWithUnits();
      engine.phaseManager.enterPhase('weapon_attack');
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'nonexistent',
        targetId: 'jenner-1',
        weapon: createWeaponDef('med_laser'),
        weaponLocation: 'rightArm'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Attacker not found');
    });

    it('rejects fire for non-existent target', () => {
      const { engine } = createEngineWithUnits();
      engine.phaseManager.enterPhase('weapon_attack');
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'nonexistent',
        weapon: createWeaponDef('med_laser'),
        weaponLocation: 'rightArm'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Target not found');
    });

    it('accumulates heat on attacker when firing', () => {
      const { engine, atlas } = createEngineWithUnits();
      engine.diceRoller = makeDiceRoller(8);
      engine.phaseManager.enterPhase('weapon_attack');
      engine.stateManager.getState().currentPlayer = 0;

      engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: createWeaponDef('med_laser'),
        weaponLocation: 'rightArm'
      });

      expect(atlas.heat).toBe(3);
    });
  });

  describe('physical attack action flow', () => {
    it('rejects physical attack for non-existent units', () => {
      const { engine } = createEngineWithUnits();
      engine.phaseManager.enterPhase('physical_attack');
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'physicalAttack',
        attackerId: 'nonexistent',
        targetId: 'jenner-1',
        attackType: 'punch'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unit not found');
    });

    it('rejects unknown physical attack type', () => {
      const { engine } = createEngineWithUnits();
      engine.phaseManager.enterPhase('physical_attack');
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'physicalAttack',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        attackType: 'invalidAttack'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown physical attack');
    });
  });

  describe('selectUnit action', () => {
    it('returns unit info for valid selection', () => {
      const { engine } = createEngineWithUnits();
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'selectUnit',
        unitId: 'atlas-0'
      });

      expect(result.success).toBe(true);
      expect(result.unitId).toBe('atlas-0');
    });

    it('rejects selecting opponent unit', () => {
      const { engine } = createEngineWithUnits();
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'selectUnit',
        unitId: 'jenner-1'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not your unit');
    });
  });

  describe('confirmFacing action', () => {
    it('is rejected when not in movement phase', () => {
      const { engine, atlas } = createEngineWithUnits();
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'confirmFacing',
        unitId: 'atlas-0',
        facing: 3
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Only in movement phase');
    });

    it('updates unit facing in movement phase', () => {
      const { engine, atlas } = createEngineWithUnits();
      engine.phaseManager.enterPhase('movement');
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'confirmFacing',
        unitId: 'atlas-0',
        facing: 3
      });

      expect(result.success).toBe(true);
      expect(atlas.position.facing).toBe(3);
    });
  });

  describe('StateManager integration', () => {
    it('state manager returns the game state', () => {
      const { engine } = createEngineWithUnits();
      const state = engine.stateManager.getState();
      expect(state).toBeDefined();
      expect(state.units).toBeDefined();
      expect(state.turn).toBe(1);
    });

    it('state changes are trackable via subscribers', () => {
      const { engine } = createEngineWithUnits();
      let notified = false;
      engine.stateManager.subscribe(() => { notified = true; });

      engine.stateManager.applyStateChange((state) => {
        state.turn = 99;
      });

      expect(notified).toBe(true);
      expect(engine.stateManager.getState().turn).toBe(99);
    });

    it('undo restores previous state', () => {
      const { engine } = createEngineWithUnits();
      const originalTurn = engine.stateManager.getState().turn;

      engine.stateManager.applyStateChange((state) => {
        state.turn = 99;
      });
      expect(engine.stateManager.getState().turn).toBe(99);

      engine.stateManager.undo();
      expect(engine.stateManager.getState().turn).toBe(originalTurn);
    });
  });

  describe('EventBus integration', () => {
    it('supports multiple listeners on same event', () => {
      const { engine } = createEngineWithUnits();
      const calls = [];
      engine.eventBus.on('phaseChanged', () => calls.push('a'));
      engine.eventBus.on('phaseChanged', () => calls.push('b'));

      engine.phaseManager.enterPhase('movement');
      expect(calls).toEqual(['a', 'b']);
    });

    it('off removes a specific listener', () => {
      const { engine } = createEngineWithUnits();
      const calls = [];
      const listener = () => calls.push('called');
      engine.eventBus.on('phaseChanged', listener);

      engine.phaseManager.enterPhase('movement');
      expect(calls).toHaveLength(1);

      engine.eventBus.off('phaseChanged', listener);
      engine.phaseManager.enterPhase('weapon_attack');
      expect(calls).toHaveLength(1);
    });

    it('removeAll clears all listeners', () => {
      const { engine } = createEngineWithUnits();
      const calls = [];
      engine.eventBus.on('phaseChanged', () => calls.push('a'));
      engine.eventBus.on('phaseChanged', () => calls.push('b'));

      engine.eventBus.removeAll();
      engine.phaseManager.enterPhase('movement');
      expect(calls).toHaveLength(0);
    });
  });

  describe('DiceRoller integration', () => {
    it('dice roller produces deterministic results', () => {
      const { engine } = createEngineWithUnits();
      const roller = engine.diceRoller;
      const roll1 = roller.roll2d6();

      // Reset and roll again - should get same result
      roller.reset();
      const roll2 = roller.roll2d6();
      expect(roll1).toBe(roll2);
    });
  });
});
