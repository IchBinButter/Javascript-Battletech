import { describe, it, expect } from 'vitest';
import {
  createTestEngine,
  createTestUnit,
  createWeaponDef,
  makeDiceRoller,
  makeSequencedDiceRoller,
  createTestGameState,
  createTestMap,
  hitTables
} from '../helpers/testUtils.js';

const PUNCH_TABLE = hitTables.hitLocation.punch;
const KICK_TABLE = hitTables.hitLocation.kick;

describe('Integration: Two Mechs Attacking Each Other', () => {
  function setupEngagement(atlasHex = '5,7', jennerHex = '7,7') {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: atlasHex, facing: 0 };
    jenner.position = { hexKey: jennerHex, facing: 3 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    return { engine, atlas, jenner };
  }

  function setupWeaponPhase(engine, currentPlayer) {
    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = currentPlayer;
  }

  function setupPhysicalPhase(engine, currentPlayer) {
    engine.phaseManager.enterPhase('physical_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = currentPlayer;
  }

  // =========================================================================
  // PER-UNIT ALTERNATION
  // =========================================================================

  describe('per-unit alternation', () => {
    it('loser fires first in weapon attack phase (default initiative choice)', () => {
      const { engine, atlas, jenner } = setupEngagement();

      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      expect(engine.stateManager.getState().initiativeWinner).toBe(0);

      engine.processAction(0, { type: 'endPhase' }); // init -> weapon (skips movement)

      const weaponQueue = engine.phaseManager.phaseUnitQueue;
      expect(weaponQueue.length).toBe(2);
      expect(weaponQueue[0].playerId).toBe(1);
      expect(weaponQueue[0].unitId).toBe('jenner-1');
      expect(weaponQueue[1].playerId).toBe(0);
      expect(weaponQueue[1].unitId).toBe('atlas-0');
    });

    it('winner fires first in weapon attack phase when goFirst is chosen', () => {
      const { engine } = setupEngagement();

      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      expect(engine.stateManager.getState().initiativeWinner).toBe(0);

      engine.phaseManager.chooseInitiative(true);

      engine.processAction(0, { type: 'endPhase' }); // init -> weapon

      const weaponQueue = engine.phaseManager.phaseUnitQueue;
      expect(weaponQueue[0].playerId).toBe(0);
      expect(weaponQueue[0].unitId).toBe('atlas-0');
      expect(weaponQueue[1].playerId).toBe(1);
      expect(weaponQueue[1].unitId).toBe('jenner-1');
    });

    it('winner always fires first in physical attack phase regardless of choice', () => {
      const { engine } = setupEngagement();

      engine.diceRoller = makeSequencedDiceRoller([5, 8]);
      engine.phaseManager.enterPhase('initiative');
      expect(engine.stateManager.getState().initiativeWinner).toBe(1); // P1 wins

      engine.phaseManager.chooseInitiative(false); // loser goes first in weapon
      engine.processAction(0, { type: 'endPhase' }); // init -> movement
      engine.processAction(0, { type: 'endPhase' }); // movement -> weapon
      engine.processAction(0, { type: 'endPhase' }); // weapon -> physical

      const physQueue = engine.phaseManager.phaseUnitQueue;
      expect(physQueue[0].playerId).toBe(1); // winner always first in phys
      expect(physQueue[0].unitId).toBe('jenner-1');
      expect(physQueue[1].playerId).toBe(0);
      expect(physQueue[1].unitId).toBe('atlas-0');
    });

    it('queue alternation: both units fire in correct order', () => {
      const { engine, atlas, jenner } = setupEngagement();

      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.processAction(0, { type: 'endPhase' }); // init -> movement
      engine.processAction(0, { type: 'endPhase' }); // movement -> weapon

      engine.diceRoller = makeDiceRoller(8);
      const medLaser = createWeaponDef('med_laser');

      const queue = engine.phaseManager.phaseUnitQueue;
      expect(queue[0].playerId).toBe(1); // loser fires first
      expect(queue[0].unitId).toBe('jenner-1');
      expect(queue[1].playerId).toBe(0); // winner fires second
      expect(queue[1].unitId).toBe('atlas-0');

      const r1 = engine.processAction(1, {
        type: 'fire',
        attackerId: 'jenner-1',
        targetId: 'atlas-0',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });
      expect(r1.hit).toBe(true);
      expect(jenner.heat).toBe(3);

      engine.phaseManager.advanceQueue();
      const r2 = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });
      expect(r2.hit).toBe(true);
      expect(atlas.heat).toBe(3);
    });
  });

  // =========================================================================
  // TARGET MOVEMENT MODIFIER
  // =========================================================================

  describe('target movement modifier', () => {
    it('adds no modifier when target moved 0-2 hexes', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      jenner.hexesMoved = 0;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.hit).toBe(true);
      expect(result.targetNumber).toBeLessThanOrEqual(4);
    });

    it('adds +2 to TN when target moved 5-6 hexes', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(10);

      jenner.hexesMoved = 5;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.hit).toBe(true);
      expect(result.targetNumber).toBe(6);
      expect(result.modifiers).toContain('Target moved: +2');
    });

    it('adds +4 to TN when target moved 10-17 hexes', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(12);

      jenner.hexesMoved = 10;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.hit).toBe(true);
      expect(result.targetNumber).toBe(8);
      expect(result.modifiers).toContain('Target moved: +4');
    });

    it('uses jump movement minimum +1 even at 0 hexes', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      jenner.hexesMoved = 0;
      jenner.movementMode = 'jump';

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.hit).toBe(true);
      expect(result.targetNumber).toBe(5);
      expect(result.modifiers).toContain('Target moved: +1');
    });
  });

  // =========================================================================
  // FULL HEAT SCALE (via engine integration)
  // =========================================================================

  describe('heat accumulation and effects', () => {
    it('accumulates heat from multiple weapon fires', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      const medLaser = createWeaponDef('med_laser');
      const largeLaser = createWeaponDef('large_laser');
      const ppc = createWeaponDef('ppc');

      engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });
      engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: largeLaser,
        weaponLocation: 'rightTorso'
      });
      engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: ppc,
        weaponLocation: 'rightArm'
      });

      expect(atlas.heat).toBe(3 + 8 + 10); // 21 total
    });

    it('heat modifier is factored into subsequent TN calculations', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      atlas.heat = 13; // +2 heat modifier (starts at heat 13)

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.targetNumber).toBe(6); // 4 + 2 heat
      expect(result.modifiers).toContain('Attacker heat: +2');
    });

    it('heat dissipates during heat phase', () => {
      const { engine, atlas } = setupEngagement();
      atlas.heat = 25;

      engine.phaseManager.enterPhase('heat');

      expect(atlas.heat).toBeCloseTo(5); // 25 - 20 sinks
    });

    it('heat 20 triggers shutdown check', () => {
      const { engine, atlas } = setupEngagement();
      atlas.heat = 40;
      engine.diceRoller = makeDiceRoller(2); // roll 2 < 4 target -> shutdown

      engine.phaseManager.enterPhase('heat');

      expect(atlas.heat).toBe(20); // 40 - 20 sinks = 20
      expect(atlas.shutdown).toBe(true);
    });

    it('shutdown target applies -4 to hit', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      jenner.shutdown = true;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.hit).toBe(true);
      expect(result.targetNumber).toBe(2); // 4 - 4 = 0, clamped to 2
      expect(result.modifiers).toContain('Target shutdown: -4');
    });

    it('full heat scale: heat 5-9 adds +1 to weapon TN', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      atlas.heat = 8;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.targetNumber).toBe(5);
      expect(result.modifiers).toContain('Attacker heat: +1');
    });

    it('full heat scale: heat 15-19 adds +3 to weapon TN', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(10);

      atlas.heat = 17;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.targetNumber).toBe(7);
      expect(result.modifiers).toContain('Attacker heat: +3');
    });

    it('full heat scale: heat 20+ adds +4 to weapon TN', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(10);

      atlas.heat = 24;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.targetNumber).toBe(8);
      expect(result.modifiers).toContain('Attacker heat: +4');
    });
  });

  // =========================================================================
  // PHYSICAL ATTACKS WITH CORRECT TABLES
  // =========================================================================

  describe('physical attacks', () => {
    it('punch uses punch hit table (head on roll 2 and 12, no legs)', () => {
      const { engine, atlas, jenner } = setupEngagement('5,8', '5,7');
      setupPhysicalPhase(engine, 0);

      const sequencer = makeSequencedDiceRoller([8, 2]); // hit on roll 8, loc roll 2
      engine.diceRoller = sequencer;

      const result = engine.processAction(0, {
        type: 'physicalAttack',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        attackType: 'punch'
      });

      expect(result.success).toBe(true);
      expect(result.type).toBe('punch');
      expect(result.hit).toBe(true);
      expect(result.damage).toBe(10); // 100/10
      expect(result.hitLocations.length).toBe(1);
      expect(result.hitLocations[0].location).toBe('head');
    });

    it('punch cannot hit legs (verify punch table has no leg entries)', () => {
      for (let roll = 2; roll <= 12; roll++) {
        const loc = PUNCH_TABLE[roll.toString()].location;
        expect(['leftLeg', 'rightLeg']).not.toContain(loc);
      }
    });

    it('kick uses kick table (legs only)', () => {
      const { engine, atlas, jenner } = setupEngagement('5,8', '5,7');
      setupPhysicalPhase(engine, 0);

      const sequencer = makeSequencedDiceRoller([8, 3]); // hit on roll 8, loc roll 3
      engine.diceRoller = sequencer;

      const result = engine.processAction(0, {
        type: 'physicalAttack',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        attackType: 'kick'
      });

      expect(result.success).toBe(true);
      expect(result.type).toBe('kick');
      expect(result.hit).toBe(true);
      expect(result.damage).toBe(20); // 100/5
      expect(result.hitLocations.length).toBe(1);
      const kickLoc = result.hitLocations[0].location;
      expect(['leftLeg', 'rightLeg']).toContain(kickLoc);
    });

    it('kick table only contains leg locations', () => {
      for (let roll = 2; roll <= 12; roll++) {
        const loc = KICK_TABLE[roll.toString()].location;
        expect(['leftLeg', 'rightLeg']).toContain(loc);
      }
    });

    it('kick roll 2 lands on leftLeg', () => {
      expect(KICK_TABLE['2'].location).toBe('leftLeg');
    });

    it('kick roll 7 lands on rightLeg', () => {
      expect(KICK_TABLE['7'].location).toBe('rightLeg');
    });

    it('punch roll 7 lands on centerTorso', () => {
      expect(PUNCH_TABLE['7'].location).toBe('centerTorso');
    });

    it('punch is rejected when both arms are destroyed', () => {
      const { engine, atlas, jenner } = setupEngagement('5,8', '5,7');
      setupPhysicalPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      atlas.internalStructure.leftArm = 0;
      atlas.internalStructure.rightArm = 0;

      const result = engine.processAction(0, {
        type: 'physicalAttack',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        attackType: 'punch'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('destroyed');
    });

    it('kick is rejected when both legs are destroyed', () => {
      const { engine, atlas, jenner } = setupEngagement('5,8', '5,7');
      setupPhysicalPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      atlas.internalStructure.leftLeg = 0;
      atlas.internalStructure.rightLeg = 0;

      const result = engine.processAction(0, {
        type: 'physicalAttack',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        attackType: 'kick'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('destroyed');
    });

    it('missed kick requires PSR', () => {
      const { engine, atlas, jenner } = setupEngagement('5,8', '5,7');
      setupPhysicalPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(2); // always miss

      const result = engine.processAction(0, {
        type: 'physicalAttack',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        attackType: 'kick'
      });

      expect(result.hit).toBe(false);
      expect(result.psrRequired).toBe(true);
    });

    it('Jenner punch damage = ceil(35/10) = 4', () => {
      const { engine, atlas, jenner } = setupEngagement('5,8', '5,7');
      setupPhysicalPhase(engine, 0);
      engine.phaseManager.clearQueue();
      engine.stateManager.getState().currentPlayer = 1;

      engine.diceRoller = makeDiceRoller(8);

      const result = engine.processAction(1, {
        type: 'physicalAttack',
        attackerId: 'jenner-1',
        targetId: 'atlas-0',
        attackType: 'punch'
      });

      expect(result.success).toBe(true);
      if (result.hit) {
        expect(result.damage).toBe(4);
      }
    });

    it('Jenner kick damage = floor(35/5) = 7', () => {
      const { engine, atlas, jenner } = setupEngagement('5,8', '5,7');
      setupPhysicalPhase(engine, 0);
      engine.phaseManager.clearQueue();
      engine.stateManager.getState().currentPlayer = 1;

      engine.diceRoller = makeDiceRoller(8);

      const result = engine.processAction(1, {
        type: 'physicalAttack',
        attackerId: 'jenner-1',
        targetId: 'atlas-0',
        attackType: 'kick'
      });

      expect(result.success).toBe(true);
      if (result.hit) {
        expect(result.damage).toBe(7);
      }
    });
  });

  // =========================================================================
  // G.A.T.O.R. MODIFIERS
  // =========================================================================

  describe('GATOR modifiers', () => {
    it('G: Gunnery 4 is the base target number', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.targetNumber).toBe(4);
    });

    it('A: Attacker movement modifier adds to TN (run = +2)', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      atlas._movementModifier = 2;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.targetNumber).toBe(6);
      expect(result.modifiers).toContain('Attacker moved: +2');
    });

    it('T: Target in light woods hex adds +1', () => {
      const { engine, atlas, jenner } = setupEngagement();
      const gs = engine.stateManager.getState();
      gs.map.hexes.set('7,7', {
        hexKey: '7,7',
        terrainType: 'light_woods',
        level: 0,
        getHeight() { return 0; },
        modifiers: {}
      });

      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.targetNumber).toBe(5);
      expect(result.modifiers).toContain('Target in light woods: +1');
    });

    it('O: Pilot hits add +1 per hit to TN', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      atlas.pilot.hits = 3;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.targetNumber).toBe(7);
      expect(result.modifiers).toContain('Pilot hits: +3');
    });

    it('R: Range modifier adds +2 at medium range', () => {
      const { engine, atlas, jenner } = setupEngagement('5,7', '10,7');
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(10);

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.targetNumber).toBe(6); // 4 + 2 range
      expect(result.modifiers).toContain('Range: +2');
    });

    it('R: Range modifier adds +4 at long range', () => {
      const { engine, atlas, jenner } = setupEngagement('5,7', '13,7');
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(12);

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.hit).toBe(true);
      expect(result.targetNumber).toBe(8);
      expect(result.modifiers).toContain('Range: +4');
    });

    it('comprehensive GATOR: all components combine correctly', () => {
      const { engine, atlas, jenner } = setupEngagement('5,7', '10,7');
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(12);

      atlas._movementModifier = 2; // +2 attacker moved
      atlas.heat = 8;              // +1 heat (starts at 8)
      jenner.hexesMoved = 5;       // +2 target moved

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      // G=4 + A=2 + T=2(tgt moved) + O=1(heat) + R=2(medium) = 11
      expect(result.targetNumber).toBe(11);
      expect(result.modifiers).toContain('Attacker moved: +2');
      expect(result.modifiers).toContain('Target moved: +2');
      expect(result.modifiers).toContain('Attacker heat: +1');
      expect(result.modifiers).toContain('Range: +2');
    });

    it('TN is clamped to minimum 2', () => {
      const { engine, atlas, jenner } = setupEngagement('5,7', '5,6');
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      atlas.pilot.gunnery = 0;
      jenner.prone = true;
      jenner.shutdown = true;
      jenner.immobile = true;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.targetNumber).toBe(2);
    });
  });

  // =========================================================================
  // DAMAGE RESOLUTION
  // =========================================================================

  describe('damage resolution', () => {
    it('applies damage to armor when armor is sufficient', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(7);

      const initialArmor = jenner.getArmor('centerTorso');

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.hit).toBe(true);
      const totalDamage = result.hitLocations.reduce((s, h) => s + h.damage, 0);
      expect(totalDamage).toBe(5);
      expect(jenner.getArmor('centerTorso')).toBeLessThan(initialArmor);
    });

    it('accumulates damage across multiple hits to same location', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(7);

      const medLaser = createWeaponDef('med_laser');
      const initialArmor = jenner.getArmor('centerTorso');

      engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });
      engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(jenner.getArmor('centerTorso')).toBeLessThanOrEqual(initialArmor - 10);
    });

    it('penetrates to internal structure when armor is depleted', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(7);

      jenner.armor.centerTorso.front = 2;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.hit).toBe(true);
      expect(jenner.armor.centerTorso.front).toBe(0);
      expect(jenner.internalStructure.centerTorso).toBeLessThan(11);
    });

    it('location is destroyed when internal structure reaches 0', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(7);

      jenner.armor.centerTorso.front = 0;
      jenner.internalStructure.centerTorso = 2;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.hit).toBe(true);
      expect(jenner.internalStructure.centerTorso).toBe(0);
      expect(jenner.isLocationDestroyed('centerTorso')).toBe(true);
    });

    it('mech is destroyed when CT is gone', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(7);

      jenner.armor.centerTorso.front = 0;
      jenner.internalStructure.centerTorso = 3;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.hit).toBe(true);
      expect(jenner.isDestroyed()).toBe(true);
    });

    it('physical attack also resolves damage', () => {
      const { engine, atlas, jenner } = setupEngagement('5,8', '5,7');
      setupPhysicalPhase(engine, 0);

      const initialArmor = jenner.getArmor('centerTorso');
      engine.diceRoller = makeSequencedDiceRoller([8, 7]);

      const result = engine.processAction(0, {
        type: 'physicalAttack',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        attackType: 'punch'
      });

      expect(result.success).toBe(true);
      if (result.hit) {
        expect(jenner.getArmor('centerTorso')).toBeLessThan(initialArmor);
      }
    });
  });

  // =========================================================================
  // HEAT ACCUMULATION DETAILS
  // =========================================================================

  describe('heat accumulation details', () => {
    it('medium laser generates 3 heat', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      const medLaser = createWeaponDef('med_laser');
      engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(atlas.heat).toBe(3);
    });

    it('PPC generates 10 heat', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      const ppc = createWeaponDef('ppc');
      engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: ppc,
        weaponLocation: 'rightArm'
      });

      expect(atlas.heat).toBe(10);
    });

    it('heat refactored into GATOR target number', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(8);

      atlas.heat = 17; // +3 heat mod (starts at 17)

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.targetNumber).toBe(7);
      expect(result.modifiers).toContain('Attacker heat: +3');
    });

    it('weapon firing always adds heat even on miss', () => {
      const { engine, atlas, jenner } = setupEngagement();
      setupWeaponPhase(engine, 0);
      engine.diceRoller = makeDiceRoller(2);

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.hit).toBe(false);
      expect(atlas.heat).toBe(3);
    });

    it('Atlas has 20 single heat sinks dissipating 20 heat per turn', () => {
      const { engine, atlas } = setupEngagement();
      atlas.heat = 35;

      const gs = engine.stateManager.getState();
      engine.heatManager.applyHeatDissipation(atlas, gs);

      expect(atlas.heat).toBe(15);
    });

    it('Jenner has 10 single heat sinks dissipating 10 heat per turn', () => {
      const { engine, jenner } = setupEngagement();
      jenner.heat = 18;

      const gs = engine.stateManager.getState();
      engine.heatManager.applyHeatDissipation(jenner, gs);

      expect(jenner.heat).toBe(8);
    });
  });

  // =========================================================================
  // PHASE RESTRICTIONS
  // =========================================================================

  describe('phase restrictions', () => {
    it('fire rejected in movement phase', () => {
      const { engine } = setupEngagement();
      engine.phaseManager.enterPhase('movement');
      engine.stateManager.getState().currentPlayer = 0;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('weapon attack phase');
    });

    it('move rejected in weapon attack phase', () => {
      const { engine } = setupEngagement();
      engine.phaseManager.enterPhase('weapon_attack');
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'move',
        unitId: 'atlas-0',
        path: ['5,7', '5,8'],
        movementType: 'walk'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('movement phase');
    });

    it('physical attack rejected in weapon attack phase', () => {
      const { engine } = setupEngagement();
      engine.phaseManager.enterPhase('weapon_attack');
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'physicalAttack',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        attackType: 'punch'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('physical attack phase');
    });

    it('fire rejected in heat phase', () => {
      const { engine } = setupEngagement();
      engine.phaseManager.enterPhase('heat');
      engine.stateManager.getState().currentPlayer = 0;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.success).toBe(false);
    });

    it('physical attack rejected in initiative phase', () => {
      const { engine } = setupEngagement();
      engine.phaseManager.enterPhase('initiative');
      engine.stateManager.getState().currentPlayer = 0;

      const result = engine.processAction(0, {
        type: 'physicalAttack',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        attackType: 'kick'
      });

      expect(result.success).toBe(false);
    });

    it('fire rejected in end phase', () => {
      const { engine } = setupEngagement();
      engine.phaseManager.enterPhase('end');
      engine.stateManager.getState().currentPlayer = 0;

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.success).toBe(false);
    });

    it('wrong player rejected by queue', () => {
      const { engine } = setupEngagement();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.processAction(0, { type: 'endPhase' }); // init -> weapon

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not your turn');
    });
  });
});
