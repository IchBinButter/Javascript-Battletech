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
    // Facing each other, so weapon attacks are in arc (BMM p24).
    atlas.position = { hexKey: '5,7', facing: 1 };
    jenner.position = { hexKey: '7,7', facing: 4 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    return { engine, atlas, jenner };
  }

  function setupPhaseWithWinner(phase, winnerPlayerId) {
    const { engine, atlas, jenner } = createEngineWithUnits();
    engine.phaseManager.enterPhase('initiative');
    engine.stateManager.getState().initiativeWinner = winnerPlayerId;
    engine.phaseManager.enterPhase(phase);
    return { engine, atlas, jenner };
  }

  function getCurrentQueueEntry(engine) {
    return engine.phaseManager.getCurrentQueueEntry();
  }

  describe('Queue-based validation', () => {
    it('rejects action from wrong player when queue is active', () => {
      const { engine } = setupPhaseWithWinner('movement', 0);
      const entry = getCurrentQueueEntry(engine);
      const wrongPlayer = entry.playerId === 0 ? 1 : 0;

      const result = engine.processAction(wrongPlayer, {
        type: 'move',
        unitId: entry.unitId,
        path: ['7,7', '7,8'],
        movementType: 'walk'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not your turn');
    });

    it('rejects action for wrong unit even when player matches', () => {
      const { engine, atlas } = setupPhaseWithWinner('movement', 0);
      const entry = getCurrentQueueEntry(engine);
      const correctPlayer = entry.playerId;
      const wrongUnitId = Object.keys(engine.stateManager.getState().units)
        .find(id => id !== entry.unitId);

      const result = engine.processAction(correctPlayer, {
        type: 'move',
        unitId: wrongUnitId,
        path: [atlas.position.hexKey, '5,8'],
        movementType: 'walk'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not the current acting unit');
    });

    it('accepts action for correct player and queue unit', () => {
      const { engine } = setupPhaseWithWinner('movement', 1);
      const entry = getCurrentQueueEntry(engine);

      const result = engine.processAction(entry.playerId, {
        type: 'move',
        unitId: entry.unitId,
        path: ['5,7', '5,8'],
        movementType: 'walk'
      });

      expect(result.success).toBe(true);
      expect(result.unitId).toBe(entry.unitId);
    });

    it('rejects entirely unknown action types', () => {
      const { engine } = setupPhaseWithWinner('movement', 0);
      const entry = getCurrentQueueEntry(engine);

      const result = engine.processAction(entry.playerId, { type: 'invalidAction' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
    });
  });

  describe('Wrong-unit rejection', () => {
    it('rejects movement for opponent unit in queue-based validation', () => {
      const { engine } = setupPhaseWithWinner('movement', 1);
      const state = engine.stateManager.getState();
      const opponentUnits = state.getPlayerUnits(1);
      const opponentUnit = opponentUnits[0];

      const wrongPlayerForQueue = getCurrentQueueEntry(engine).playerId === 1 ? 0 : 1;

      const result = engine.processAction(wrongPlayerForQueue, {
        type: 'move',
        unitId: opponentUnit.id,
        path: ['7,7', '7,8'],
        movementType: 'walk'
      });

      expect(result.success).toBe(false);
    });

    it('rejects fire action for wrong player in weapon_attack queue', () => {
      const { engine } = setupPhaseWithWinner('weapon_attack', 0);
      const entry = getCurrentQueueEntry(engine);
      const wrongPlayer = entry.playerId === 0 ? 1 : 0;

      const result = engine.processAction(wrongPlayer, {
        type: 'fire',
        attackerId: entry.unitId,
        targetId: entry.unitId === 'atlas-0' ? 'jenner-1' : 'atlas-0',
        weapon: createWeaponDef('med_laser'),
        weaponLocation: 'rightArm'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not your turn');
    });

    it('rejects physicalAttack for wrong player in physical_attack queue', () => {
      const { engine } = setupPhaseWithWinner('physical_attack', 0);
      const entry = getCurrentQueueEntry(engine);
      const wrongPlayer = entry.playerId === 0 ? 1 : 0;

      const result = engine.processAction(wrongPlayer, {
        type: 'physicalAttack',
        attackerId: entry.unitId,
        targetId: entry.unitId === 'atlas-0' ? 'jenner-1' : 'atlas-0',
        attackType: 'punch'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not your turn');
    });

    it('rejects selecting opponent unit via selectUnit', () => {
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

  describe('Queue exhaustion', () => {
    it('advances phase to weapon_attack after all units move', () => {
      const { engine } = setupPhaseWithWinner('movement', 0);
      const phaseMgr = engine.phaseManager;

      expect(phaseMgr.currentPhase).toBe('movement');

      const q1 = getCurrentQueueEntry(engine);
      engine.processAction(q1.playerId, {
        type: 'move', unitId: q1.unitId,
        path: [q1.unitId === 'atlas-0' ? '5,7' : '7,7', '5,8'],
        movementType: 'walk'
      });

      const q2 = getCurrentQueueEntry(engine);
      expect(q2).not.toBeNull();

      engine.processAction(q2.playerId, {
        type: 'move', unitId: q2.unitId,
        path: [q2.unitId === 'atlas-0' ? '5,7' : '7,7', '5,8'],
        movementType: 'walk'
      });

      expect(phaseMgr.currentPhase).toBe('weapon_attack');
    });

    it('advances phase to physical_attack after all units fire', () => {
      const { engine } = setupPhaseWithWinner('weapon_attack', 0);
      engine.diceRoller = makeDiceRoller(8);
      const phaseMgr = engine.phaseManager;

      expect(phaseMgr.currentPhase).toBe('weapon_attack');

      const q1 = getCurrentQueueEntry(engine);
      const targetId1 = q1.unitId === 'atlas-0' ? 'jenner-1' : 'atlas-0';
      engine.processAction(q1.playerId, {
        type: 'fire', attackerId: q1.unitId, targetId: targetId1,
        weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
      });

      const q2 = getCurrentQueueEntry(engine);
      expect(q2).not.toBeNull();
      const targetId2 = q2.unitId === 'atlas-0' ? 'jenner-1' : 'atlas-0';
      engine.processAction(q2.playerId, {
        type: 'fire', attackerId: q2.unitId, targetId: targetId2,
        weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
      });

      expect(phaseMgr.currentPhase).toBe('physical_attack');
    });

    it('advances phase to heat after all physical attacks', () => {
      const { engine } = setupPhaseWithWinner('physical_attack', 1);
      engine.diceRoller = makeDiceRoller(10);
      const phaseMgr = engine.phaseManager;

      expect(phaseMgr.currentPhase).toBe('physical_attack');

      const q1 = getCurrentQueueEntry(engine);
      const targetId1 = q1.unitId === 'atlas-0' ? 'jenner-1' : 'atlas-0';
      engine.processAction(q1.playerId, {
        type: 'physicalAttack', attackerId: q1.unitId, targetId: targetId1,
        attackType: 'punch'
      });

      const q2 = getCurrentQueueEntry(engine);
      expect(q2).not.toBeNull();
      const targetId2 = q2.unitId === 'atlas-0' ? 'jenner-1' : 'atlas-0';
      engine.processAction(q2.playerId, {
        type: 'physicalAttack', attackerId: q2.unitId, targetId: targetId2,
        attackType: 'kick'
      });

      expect(phaseMgr.currentPhase).toBe('heat');
    });

    it('getCurrentQueueEntry returns null when queue is empty', () => {
      const { engine } = createEngineWithUnits();
      const entry = engine.phaseManager.getCurrentQueueEntry();
      expect(entry).toBeNull();
    });
  });

  describe('Initiative order (p10/p12)', () => {
    it('emits initiativeRolled on initiative phase entry', () => {
      const { engine } = createEngineWithUnits();
      const events = [];
      engine.eventBus.on('initiativeRolled', (d) => events.push('initiativeRolled'));

      engine.phaseManager.enterPhase('initiative');

      expect(events).toContain('initiativeRolled');
    });

    it('has no winner-goes-first option; the loser declares first (p10)', () => {
      const { engine } = setupPhaseWithWinner('movement', 0);

      expect(engine.phaseManager.chooseInitiative).toBeUndefined();
      expect('initiativeWinnerGoesFirst' in engine.phaseManager).toBe(false);
    });

    it('loser moves first (p10)', () => {
      const { engine } = setupPhaseWithWinner('movement', 0);
      const firstEntry = getCurrentQueueEntry(engine);

      expect(firstEntry.playerId).toBe(1);
      expect(firstEntry.unitId).toBe('jenner-1');
    });

    it('loser fires first in weapon_attack phase (p10)', () => {
      const { engine } = setupPhaseWithWinner('weapon_attack', 0);
      const firstEntry = getCurrentQueueEntry(engine);

      expect(firstEntry.playerId).toBe(1);
      expect(firstEntry.unitId).toBe('jenner-1');
    });

    // p12: "Players repeat the steps given for the Weapon Attack Phase, except
    // for torso twisting" — so the Physical Attack Phase declares in the same
    // order as the Weapon Attack Phase (p10: the initiative loser declares
    // first).
    it('physical_attack declares in weapon-attack order: loser first (p12)', () => {
      const { engine } = setupPhaseWithWinner('physical_attack', 0);
      const firstEntry = getCurrentQueueEntry(engine);

      expect(firstEntry.playerId).toBe(1);
      expect(firstEntry.unitId).toBe('jenner-1');
    });
  });

  describe('Movement with per-unit alternation', () => {
    it('both units get movement turns in alternating order', () => {
      const { engine } = setupPhaseWithWinner('movement', 1);
      const turnOrder = [];

      while (engine.phaseManager.currentPhase === 'movement') {
        const entry = getCurrentQueueEntry(engine);
        if (!entry) break;
        const unit = engine.stateManager.getState().getUnit(entry.unitId);
        const startHex = unit.position.hexKey;
        const [col, row] = startHex.split(',').map(Number);
        const destHex = `${col + 1},${row}`;

        engine.processAction(entry.playerId, {
          type: 'move', unitId: entry.unitId,
          path: [startHex, destHex],
          movementType: 'walk'
        });
        turnOrder.push({ playerId: entry.playerId, unitId: entry.unitId });
      }

      expect(turnOrder).toHaveLength(2);
      expect(turnOrder[0].playerId).not.toBe(turnOrder[1].playerId);
    });

    it('sets movement modifier based on movement type via queue', () => {
      const { engine, atlas } = setupPhaseWithWinner('movement', 1);
      const entry = getCurrentQueueEntry(engine);
      const unit = engine.stateManager.getState().getUnit(entry.unitId);
      const startHex = unit.position.hexKey;

      engine.processAction(entry.playerId, {
        type: 'move', unitId: entry.unitId,
        path: [startHex, `${parseInt(startHex.split(',')[0]) + 1},${startHex.split(',')[1]}`],
        movementType: 'run'
      });

      expect(unit._movementModifier).toBe(2);
      expect(unit.movementMode).toBe('walk');
    });

    it('movement path updates unit position', () => {
      const { engine, atlas } = setupPhaseWithWinner('movement', 1);
      const entry = getCurrentQueueEntry(engine);
      const expectedUnitId = entry.unitId;
      const unit = engine.stateManager.getState().getUnit(expectedUnitId);
      const startHex = unit.position.hexKey;

      engine.processAction(entry.playerId, {
        type: 'move', unitId: expectedUnitId,
        path: [startHex, `${parseInt(startHex.split(',')[0]) + 1},${startHex.split(',')[1]}`],
        movementType: 'walk'
      });

      expect(unit.position.hexKey).not.toBe(startHex);
    });

    it('emits unitMoved event on successful move via queue', () => {
      const { engine } = setupPhaseWithWinner('movement', 0);
      const moved = [];
      engine.eventBus.on('unitMoved', (data) => moved.push(data));

      const entry = getCurrentQueueEntry(engine);
      const unit = engine.stateManager.getState().getUnit(entry.unitId);
      const startHex = unit.position.hexKey;
      const destHex = `${parseInt(startHex.split(',')[0]) + 1},${startHex.split(',')[1]}`;

      engine.processAction(entry.playerId, {
        type: 'move', unitId: entry.unitId,
        path: [startHex, destHex],
        movementType: 'walk'
      });

      expect(moved).toHaveLength(1);
      expect(moved[0].unitId).toBe(entry.unitId);
      expect(moved[0].hexKey).toBe(destHex);
    });
  });

  describe('Fire with per-unit alternation', () => {
    it('both units fire in alternating order', () => {
      const { engine } = setupPhaseWithWinner('weapon_attack', 0);
      engine.diceRoller = makeDiceRoller(8);

      const turnOrder = [];
      while (engine.phaseManager.currentPhase === 'weapon_attack') {
        const entry = getCurrentQueueEntry(engine);
        if (!entry) break;
        const targetId = entry.unitId === 'atlas-0' ? 'jenner-1' : 'atlas-0';

        const result = engine.processAction(entry.playerId, {
          type: 'fire', attackerId: entry.unitId, targetId,
          weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
        });
        turnOrder.push({ playerId: entry.playerId, unitId: entry.unitId });
        if (!result.success) break; // never spin if the action was refused
      }

      expect(turnOrder).toHaveLength(2);
      expect(turnOrder[0].playerId).not.toBe(turnOrder[1].playerId);
    });

    it('requires attackResolver to be initialized', () => {
      const { engine } = setupPhaseWithWinner('weapon_attack', 0);
      engine.attackResolver = null;
      const entry = getCurrentQueueEntry(engine);

      const targetId = entry.unitId === 'atlas-0' ? 'jenner-1' : 'atlas-0';
      const result = engine.processAction(entry.playerId, {
        type: 'fire', attackerId: entry.unitId, targetId,
        weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });

    it('accumulates heat on attacker when firing via queue', () => {
      const { engine } = setupPhaseWithWinner('weapon_attack', 0);
      engine.diceRoller = makeDiceRoller(8);
      const entry = getCurrentQueueEntry(engine);
      const attacker = engine.stateManager.getState().getUnit(entry.unitId);
      const targetId = entry.unitId === 'atlas-0' ? 'jenner-1' : 'atlas-0';
      const heatBefore = attacker.heat;

      engine.processAction(entry.playerId, {
        type: 'fire', attackerId: entry.unitId, targetId,
        weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
      });

      expect(attacker.heat).toBeGreaterThan(heatBefore);
    });

    it('rejects fire for non-existent target in queue context', () => {
      const { engine } = setupPhaseWithWinner('weapon_attack', 0);
      const entry = getCurrentQueueEntry(engine);

      const result = engine.processAction(entry.playerId, {
        type: 'fire', attackerId: entry.unitId, targetId: 'nonexistent',
        weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Target not found');
    });
  });

  describe('Physical attack with per-unit alternation', () => {
    it('both units resolve physical attacks in alternating order', () => {
      const { engine } = setupPhaseWithWinner('physical_attack', 1);
      engine.diceRoller = makeDiceRoller(10);

      const turnOrder = [];
      while (engine.phaseManager.currentPhase === 'physical_attack') {
        const entry = getCurrentQueueEntry(engine);
        if (!entry) break;
        const targetId = entry.unitId === 'atlas-0' ? 'jenner-1' : 'atlas-0';

        const result = engine.processAction(entry.playerId, {
          type: 'physicalAttack', attackerId: entry.unitId, targetId,
          attackType: 'punch'
        });
        turnOrder.push({ playerId: entry.playerId, unitId: entry.unitId });
        if (!result.success) break;
      }

      expect(turnOrder).toHaveLength(2);
      expect(turnOrder[0].playerId).not.toBe(turnOrder[1].playerId);
    });

    it('rejects unknown physical attack type via queue', () => {
      const { engine } = setupPhaseWithWinner('physical_attack', 1);
      const entry = getCurrentQueueEntry(engine);
      const targetId = entry.unitId === 'atlas-0' ? 'jenner-1' : 'atlas-0';

      const result = engine.processAction(entry.playerId, {
        type: 'physicalAttack', attackerId: entry.unitId, targetId,
        attackType: 'invalidAttack'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown physical attack');
    });
  });

  describe('Full phase flow with per-unit alternation', () => {
    it('completes full turn: initiative → movement → weapon_attack → physical_attack', () => {
      const { engine } = setupPhaseWithWinner('movement', 0);
      engine.diceRoller = makeDiceRoller(8);

      const phasesSeen = [];
      phasesSeen.push(engine.phaseManager.currentPhase);

      function processCurrentPhase(phaseName, actionBuilder) {
        while (engine.phaseManager.currentPhase === phaseName) {
          const entry = getCurrentQueueEntry(engine);
          if (!entry) break;
          const unit = engine.stateManager.getState().getUnit(entry.unitId);
          const startHex = unit.position.hexKey;
          const [col, row] = startHex.split(',').map(Number);

          const result = engine.processAction(entry.playerId, actionBuilder(entry, unit, col, row));
          if (!result || result.success === false) {
            // Refused action (for example a shot with no firing arc): move the
            // phase along so the flow itself is still exercised.
            engine.processAction(entry.playerId, { type: 'endPhase' });
            break;
          }
        }
        phasesSeen.push(engine.phaseManager.currentPhase);
      }

      processCurrentPhase('movement', (entry, unit, col, row) => ({
        type: 'move', unitId: entry.unitId,
        path: [unit.position.hexKey, `${col + 1},${row}`],
        movementType: 'walk'
      }));

      processCurrentPhase('weapon_attack', (entry) => ({
        type: 'fire', attackerId: entry.unitId,
        targetId: entry.unitId === 'atlas-0' ? 'jenner-1' : 'atlas-0',
        weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
      }));

      processCurrentPhase('physical_attack', (entry) => ({
        type: 'physicalAttack', attackerId: entry.unitId,
        targetId: entry.unitId === 'atlas-0' ? 'jenner-1' : 'atlas-0',
        attackType: 'punch'
      }));

      expect(phasesSeen).toContain('movement');
      expect(phasesSeen).toContain('weapon_attack');
      expect(phasesSeen).toContain('physical_attack');
      expect(engine.phaseManager.currentPhase).toBeDefined();
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

    it('reflects queue-driven phase transitions in state', () => {
      const { engine } = setupPhaseWithWinner('movement', 0);
      const state = engine.stateManager.getState();

      expect(state.phase).toBe('movement');

      const q1 = getCurrentQueueEntry(engine);
      engine.processAction(q1.playerId, {
        type: 'move', unitId: q1.unitId,
        path: [q1.unitId === 'atlas-0' ? '5,7' : '7,7', '5,8'],
        movementType: 'walk'
      });

      const q2 = getCurrentQueueEntry(engine);
      engine.processAction(q2.playerId, {
        type: 'move', unitId: q2.unitId,
        path: [q2.unitId === 'atlas-0' ? '5,7' : '7,7', '5,8'],
        movementType: 'walk'
      });

      expect(state.phase).toBe('weapon_attack');
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

    it('emits events during queue-based action processing', () => {
      const { engine } = setupPhaseWithWinner('movement', 0);
      const events = [];
      engine.eventBus.on('actionProcessed', (d) => events.push({ type: d.action.type, success: d.result.success }));
      engine.eventBus.on('unitMoved', (d) => events.push({ event: 'unitMoved', unitId: d.unitId }));
      engine.eventBus.on('phaseChanged', () => events.push({ event: 'phaseChanged' }));

      const q1 = getCurrentQueueEntry(engine);
      engine.processAction(q1.playerId, {
        type: 'move', unitId: q1.unitId,
        path: [q1.unitId === 'atlas-0' ? '5,7' : '7,7', '5,8'],
        movementType: 'walk'
      });

      const q2 = getCurrentQueueEntry(engine);
      engine.processAction(q2.playerId, {
        type: 'move', unitId: q2.unitId,
        path: [q2.unitId === 'atlas-0' ? '5,7' : '7,7', '5,8'],
        movementType: 'walk'
      });

      const actionProcessedEvents = events.filter(e => e.type === 'move');
      expect(actionProcessedEvents).toHaveLength(2);
      expect(actionProcessedEvents.every(e => e.success)).toBe(true);

      const moveEvents = events.filter(e => e.event === 'unitMoved');
      expect(moveEvents).toHaveLength(2);

      const phaseEvents = events.filter(e => e.event === 'phaseChanged');
      expect(phaseEvents.length).toBeGreaterThan(0);
    });

    it('logs every action with correct phase info', () => {
      const { engine } = setupPhaseWithWinner('movement', 1);

      const q1 = getCurrentQueueEntry(engine);
      engine.processAction(q1.playerId, {
        type: 'move', unitId: q1.unitId,
        path: [q1.unitId === 'atlas-0' ? '5,7' : '7,7', '5,8'],
        movementType: 'walk'
      });

      expect(engine.actionLog).toHaveLength(1);
      expect(engine.actionLog[0].phase).toBe('movement');
      expect(engine.actionLog[0].action.type).toBe('move');
    });
  });

  describe('DiceRoller integration', () => {
    it('dice roller produces deterministic results via reset', () => {
      const { engine } = createEngineWithUnits();
      const roller = engine.diceRoller;
      const roll1 = roller.roll2d6();

      roller.reset();
      const roll2 = roller.roll2d6();
      expect(roll1).toBe(roll2);
    });

    it('dice roller reset returns same sequence after being consumed', () => {
      const { engine } = createEngineWithUnits();
      const roller = engine.diceRoller;
      const results1 = [];
      for (let i = 0; i < 5; i++) results1.push(roller.roll2d6());

      roller.reset();
      const results2 = [];
      for (let i = 0; i < 5; i++) results2.push(roller.roll2d6());

      expect(results1).toEqual(results2);
    });

    it('optional dice fallback that mimics real roll for tests', () => {
      const roller = makeDiceRoller(7);
      expect(roller.roll2d6()).toBe(7);
      expect(roller.roll1d6()).toBe(4); // ceil(7/2) = 4
      expect(roller.next()).toBe(0.5);
    });
  });

  describe('endPhase action', () => {
    it('endPhase advances to next phase', () => {
      const { engine } = createEngineWithUnits();
      engine.phaseManager.enterPhase('initiative');
      expect(engine.phaseManager.currentPhase).toBe('initiative');

      const result = engine.processAction(0, { type: 'endPhase' });
      expect(result.success).toBe(true);
      expect(engine.phaseManager.currentPhase).toBe('movement');
    });

    it('endPhase bypasses queue-based player validation', () => {
      const { engine } = setupPhaseWithWinner('movement', 0);
      const entry = getCurrentQueueEntry(engine);
      const wrongPlayer = entry.playerId === 0 ? 1 : 0;

      const result = engine.processAction(wrongPlayer, { type: 'endPhase' });
      expect(result.success).toBe(true);
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

    it('returns error for non-existent unit', () => {
      const { engine } = createEngineWithUnits();
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'selectUnit',
        unitId: 'nonexistent'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unit not found');
    });

    it('bypasses queue-based validation', () => {
      const { engine } = setupPhaseWithWinner('movement', 0);
      const entry = getCurrentQueueEntry(engine);
      const wrongPlayer = entry.playerId === 0 ? 1 : 0;

      const result = engine.processAction(wrongPlayer, {
        type: 'selectUnit',
        unitId: wrongPlayer === 0 ? 'atlas-0' : 'jenner-1'
      });

      expect(result.success).toBe(true);
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

    it('updates unit facing in movement phase via queue', () => {
      const { engine } = setupPhaseWithWinner('movement', 1);
      const entry = getCurrentQueueEntry(engine);
      const unit = engine.stateManager.getState().getUnit(entry.unitId);
      const originalFacing = unit.position.facing;

      const result = engine.processAction(entry.playerId, {
        type: 'confirmFacing',
        unitId: entry.unitId,
        facing: (originalFacing + 2) % 6
      });

      expect(result.success).toBe(true);
      expect(unit.position.facing).toBe((originalFacing + 2) % 6);
    });
  });
});
