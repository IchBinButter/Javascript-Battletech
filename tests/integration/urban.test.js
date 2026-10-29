/**
 * Urban combat integration (BMM p66-73): moving into buildings, collapse and
 * combat within buildings, driven through the real engine.
 */

import { describe, it, expect } from 'vitest';
import { createTestEngine, createTestUnit, createWeaponDef, makeDiceRoller, makeSequencedDiceRoller } from '../helpers/testUtils.js';
import { BuildingRegistry, buildingCombat, damageReduction } from '../../src/rules/urban/Buildings.js';
import { Weapon } from '../../src/models/Weapon.js';

const mediumBuilding = (cf = 40, levels = 2, id = 'b1') => ({ id, type: 'medium', levels, cf, currentCF: cf });

function urbanEngine({ units, buildings = {}, phase = 'movement', diceRoller = makeDiceRoller(7) }) {
  const engine = createTestEngine({ units });
  engine.diceRoller = diceRoller;

  const state = engine.stateManager.getState();
  for (const [hexKey, building] of Object.entries(buildings)) {
    const hex = state.map.hexes.get(hexKey);
    if (hex) hex.building = { ...building };
  }

  engine.phaseManager.enterPhase(phase);
  return engine;
}

const place = (unit, hexKey, facing = 0) => {
  unit.position = { hexKey, facing };
  return unit;
};

describe('moving into a building (p67)', () => {
  it('damages the hex by tonnage / 10 and rolls a PSR', () => {
    const locust = place(createTestUnit('locust-lct1v', 0, 'locust'), '4,5');
    const engine = urbanEngine({ units: { locust }, buildings: { '5,5': mediumBuilding() } });

    const result = engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    expect(result.success).toBe(true);
    expect(engine.stateManager.getState().map.hexes.get('5,5').building.currentCF).toBe(38);
  });

  it('costs the Mech tonnage / 10 damage when the PSR fails', () => {
    // Rolls: PSR 2 (fails), hit location 7, basement 7 (none).
    const locust = place(createTestUnit('locust-lct1v', 0, 'locust'), '4,5');
    const engine = urbanEngine({
      units: { locust },
      buildings: { '5,5': mediumBuilding() },
      diceRoller: makeSequencedDiceRoller([2, 7, 7])
    });

    const armourBefore = JSON.stringify(locust.armor);

    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    expect(JSON.stringify(locust.armor)).not.toBe(armourBefore);
    // The hex takes its damage either way.
    expect(engine.stateManager.getState().map.hexes.get('5,5').building.currentCF).toBe(38);
  });

  it('does not damage the building when jumping onto it', () => {
    const locust = place(createTestUnit('locust-lct1v', 0, 'locust'), '2,5');
    const engine = urbanEngine({ units: { locust }, buildings: { '5,5': mediumBuilding() } });

    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['2,5', '5,5'], movementType: 'jump'
    });

    expect(engine.stateManager.getState().map.hexes.get('5,5').building.currentCF).toBe(40);
  });
});

describe('collapse (p73)', () => {
  it('reduces a hex to rubble and damages its occupant', () => {
    const locust = place(createTestUnit('locust-lct1v', 0, 'locust'), '4,5');
    const engine = urbanEngine({
      units: { locust },
      buildings: { '5,5': mediumBuilding(2) },
      diceRoller: makeDiceRoller(7)
    });

    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    const hex = engine.stateManager.getState().map.hexes.get('5,5');
    expect(hex.building.currentCF).toBe(0);
    expect(hex.terrainType).toBe('rubble');
  });

  it('brings the rest of a building down once more than half is gone', () => {
    const locust = place(createTestUnit('locust-lct1v', 0, 'locust'), '4,5');
    const engine = urbanEngine({
      units: { locust },
      buildings: {
        '5,5': mediumBuilding(2, 2, 'block'),
        '6,5': mediumBuilding(40, 2, 'block'),
        '5,6': mediumBuilding(40, 2, 'block'),
        '6,6': mediumBuilding(40, 2, 'block')
      }
    });

    const state = engine.stateManager.getState();
    // Two of four hexes already down: entering makes it three.
    state.map.hexes.get('6,5').building.currentCF = 0;
    state.map.hexes.get('5,6').building.currentCF = 0;

    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    expect(state.map.hexes.get('6,6').building.currentCF).toBe(0);
    expect(state.map.hexes.get('6,6').terrainType).toBe('rubble');
  });

  it('leaves neighbouring hexes standing below the halfway mark', () => {
    const locust = place(createTestUnit('locust-lct1v', 0, 'locust'), '4,5');
    const engine = urbanEngine({
      units: { locust },
      buildings: {
        '5,5': mediumBuilding(2, 2, 'block'),
        '6,5': mediumBuilding(40, 2, 'block'),
        '5,6': mediumBuilding(40, 2, 'block'),
        '6,6': mediumBuilding(40, 2, 'block')
      }
    });

    const state = engine.stateManager.getState();
    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    expect(state.map.hexes.get('6,5').building.currentCF).toBe(40);
    expect(state.map.hexes.get('6,6').terrainType).not.toBe('rubble');
  });
});

describe('basements (p66)', () => {
  it('rolls once per hex and drops the Mech when a basement is rolled', () => {
    // PSR 7 (passes), basement 2 (double basement), hit location 7.
    const locust = place(createTestUnit('locust-lct1v', 0, 'locust'), '4,5');
    const engine = urbanEngine({
      units: { locust },
      buildings: { '5,5': mediumBuilding(90) },
      diceRoller: makeSequencedDiceRoller([7, 2, 7])
    });

    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    const hex = engine.stateManager.getState().map.hexes.get('5,5');
    expect(hex.basement).toMatchObject({ kind: 'double', depth: 2 });
    expect(locust.prone).toBe(true);
    expect(locust.basementDepth).toBe(2);
    // 90 - 2 (entry) - 4 (double basement floor, tonnage/10 x 2)
    expect(hex.building.currentCF).toBe(84);
  });

  it('does not roll a basement twice for the same hex', () => {
    const first = place(createTestUnit('locust-lct1v', 0, 'locust'), '4,5');
    const second = place(createTestUnit('jenner-jr7d', 0, 'jenner'), '4,6');
    const engine = urbanEngine({
      units: { locust: first, jenner: second },
      buildings: { '5,5': mediumBuilding(90) },
      diceRoller: makeSequencedDiceRoller([7, 7, 7])
    });

    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });
    const rolled = engine.stateManager.getState().map.hexes.get('5,5').basement;

    engine.processAction(0, {
      type: 'move', unitId: 'jenner', path: ['4,6', '5,5'], movementType: 'walk'
    });

    expect(engine.stateManager.getState().map.hexes.get('5,5').basement).toBe(rolled);
  });

  it('drops a Mech heavier than the hex CF even with no basement roll', () => {
    // Atlas is 100 tons; a CF 40 hex cannot hold it. Basement roll 7 = none.
    const atlas = place(createTestUnit('atlas-as7d', 0, 'atlas'), '4,5', 2); // facing the building hex
    const engine = urbanEngine({
      units: { atlas },
      buildings: { '5,5': mediumBuilding(40) },
      diceRoller: makeSequencedDiceRoller([7, 7, 7])
    });

    engine.processAction(0, {
      type: 'move', unitId: 'atlas', path: ['4,5', '5,5'], movementType: 'walk'
    });

    expect(atlas.prone).toBe(true);
    expect(atlas.basementDepth).toBe(1);
  });
});

describe('combat within buildings (p72)', () => {
  const combat = (buildings, attackerHex = '5,8', targetHex = '5,5') => {
    const attacker = place(createTestUnit('atlas-as7d', 0, 'atlas'), attackerHex, 0);
    const target = place(createTestUnit('locust-lct1v', 1, 'locust'), targetHex, 3);
    const engine = urbanEngine({
      units: { atlas: attacker, locust: target },
      buildings,
      phase: 'weapon_attack'
    });
    return { engine, attacker, target };
  };

  it('does not add the p72 modifier for a shot from outside into a building (p71)', () => {
    // Reviewer's probe: the attacker at 5,8 is in the open, the target is
    // inside the medium building hex 5,5. That is p71 "Attacking 'Mechs
    // Inside Buildings", not p72 "Combat Within Buildings", so the attack has
    // no "Combat within buildings" modifier: it resolves on Gunnery 4, not 5.
    const { engine, attacker, target } = combat({ '5,5': mediumBuilding(40) });
    const state = engine.stateManager.getState();
    const weapon = createWeaponDef('med_laser');

    const urban = buildingCombat(attacker, target, state);
    expect(urban.targetInside).toBe(true); // the building still protects the target
    expect(urban.sameBuilding).toBe(false); // but the pair is not in one building

    const result = engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'locust', weapon,
      weaponLocation: 'rightArm'
    });

    expect(result.success).toBe(true);
    expect(result.targetNumber).toBe(4); // base Gunnery, no +1
    expect(result.modifiers.some(m => m.startsWith('Combat within buildings'))).toBe(false);
    // p71 keeps the CF protection for a 'Mech inside the building.
    expect(result.hitLocations[0].buildingAbsorbed).toBe(4); // ceil(40 / 10)
  });

  it('keeps the p72 +1 for a target inside the same building hex', () => {
    // Both 'Mechs are inside one building hex, so p72 applies and the target
    // inside costs +1: the attack resolves at TN 5.
    const attacker = place(createTestUnit('atlas-as7d', 0, 'atlas'), '5,5', 0);
    const target = place(createTestUnit('locust-lct1v', 1, 'locust'), '5,5', 3);
    const engine = urbanEngine({
      units: { atlas: attacker, locust: target },
      buildings: { '5,5': mediumBuilding(40) },
      phase: 'weapon_attack',
      diceRoller: makeDiceRoller(7)
    });
    const state = engine.stateManager.getState();
    const weapon = createWeaponDef('med_laser');

    const urban = buildingCombat(attacker, target, state);
    expect(urban.sameBuilding).toBe(true);
    expect(urban.modifier).toBe(1); // +1 target inside, no intervening hex/level

    const result = engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'locust', weapon
    });

    expect(result.success).toBe(true);
    expect(result.targetNumber).toBe(5); // 4 Gunnery + 1 combat within buildings
    expect(result.modifiers).toContain('Combat within buildings: +1');
  });

  it('blocks an outside shot at an inside target through any intervening building hex (p71)', () => {
    // p71 requires line of sight: the target's own building hex does not
    // count, but every intervening building hex blocks - even a light one the
    // generic terrain-height LOS would not block at standing height.
    const attacker = place(createTestUnit('atlas-as7d', 0, 'atlas'), '4,4', 3);
    const target = place(createTestUnit('locust-lct1v', 1, 'locust'), '4,6', 3);
    const engine = urbanEngine({
      units: { atlas: attacker, locust: target },
      buildings: {
        '4,5': { id: 'wall', type: 'light', levels: 1, cf: 15, currentCF: 15 },
        '4,6': { id: 'house', type: 'light', levels: 1, cf: 15, currentCF: 15 }
      },
      phase: 'weapon_attack'
    });
    const state = engine.stateManager.getState();
    const weapon = createWeaponDef('med_laser');

    const urban = buildingCombat(attacker, target, state);
    expect(urban.sameBuilding).toBe(false);
    expect(urban.targetInside).toBe(true);
    expect(urban.interveningHexes).toBe(1);

    // The generic LOS alone would NOT block this light building at standing
    // height, so the block below comes from p71's building rule.
    const genericLos = engine.los.calculateLOS('4,4', '4,6', state, { attacker, target });
    expect(genericLos.blocked).toBe(false);

    const result = engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'locust', weapon
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('LOS blocked by 1 intervening building hex');
  });

  it('absorbs CF / 10 of a hit and charges it to the hex at the end of the phase', () => {
    const { engine } = combat({ '5,5': mediumBuilding(40) });
    const state = engine.stateManager.getState();
    const weapon = createWeaponDef('med_laser');

    const result = engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'locust', weapon,
      weaponLocation: 'rightArm'
    });

    expect(result.success).toBe(true);
    const hex = state.map.hexes.get('5,5');
    // p72: "Resolve damage to the building's CF at the end of the Weapon
    // Attack Phase." Until then the hex keeps its starting CF.
    expect(hex.building.currentCF).toBe(40);
    expect(hex._pendingCFDamage).toBe(4); // ceil(40 / 10)

    engine.processAction(0, { type: 'endPhase' }); // weapon_attack -> physical_attack

    expect(hex.building.currentCF).toBe(36); // 40 - ceil(40/10), a 5-point laser
    expect(hex._pendingCFDamage).toBeUndefined(); // the bank is cleared with the phase
  });

  it('gives a roof occupant no building protection and leaves the hex CF intact', () => {
    const attacker = place(createTestUnit('atlas-as7d', 0, 'atlas'), '5,8', 0);
    const target = place(createTestUnit('locust-lct1v', 1, 'locust'), '5,5', 3);
    target.position.level = 2; // the roof of the two-level medium building
    const engine = urbanEngine({
      units: { atlas: attacker, locust: target },
      buildings: { '5,5': mediumBuilding(40) },
      phase: 'weapon_attack',
      diceRoller: makeDiceRoller(7)
    });
    const state = engine.stateManager.getState();
    const hex = state.map.hexes.get('5,5');
    const weapon = createWeaponDef('med_laser');

    const urban = buildingCombat(attacker, target, state);
    expect(urban.targetOnRoof).toBe(true);
    expect(urban.targetInside).toBe(false);

    const result = engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'locust', weapon,
      weaponLocation: 'rightArm'
    });

    expect(result.success).toBe(true);
    expect(result.hit).toBe(true);
    // p72 protection is for a 'Mech inside the building. A roof occupant is
    // not inside, so the full 5-point hit reaches the 'Mech and the hex's CF
    // is untouched.
    expect(result.hitLocations[0].damage).toBe(5);
    expect(result.hitLocations[0].damageResult).toBeDefined(); // reached the 'Mech
    expect(result.hitLocations[0].buildingAbsorbed).toBeUndefined();
    expect(hex._pendingCFDamage).toBe(0);
    expect(hex.building.currentCF).toBe(40);

    engine.processAction(0, { type: 'endPhase' }); // the banked CF damage is settled
    expect(hex.building.currentCF).toBe(40);
  });

  it('still absorbs CF / 10 for a target inside the building', () => {
    const attacker = place(createTestUnit('atlas-as7d', 0, 'atlas'), '5,8', 0);
    // No position.level: the documented approximation is inside on the ground
    // floor, so the building hex protects it.
    const target = place(createTestUnit('locust-lct1v', 1, 'locust'), '5,5', 3);
    const engine = urbanEngine({
      units: { atlas: attacker, locust: target },
      buildings: { '5,5': mediumBuilding(40) },
      phase: 'weapon_attack',
      diceRoller: makeDiceRoller(7)
    });
    const state = engine.stateManager.getState();
    const hex = state.map.hexes.get('5,5');
    const weapon = createWeaponDef('med_laser');

    const result = engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'locust', weapon,
      weaponLocation: 'rightArm'
    });

    expect(result.success).toBe(true);
    expect(result.hit).toBe(true);
    expect(result.hitLocations[0].buildingAbsorbed).toBe(4); // ceil(40 / 10)
    expect(result.hitLocations[0].damage).toBe(1); // 5-point laser minus 4
    expect(hex._pendingCFDamage).toBe(4);
    expect(hex.building.currentCF).toBe(40); // charged at the end of the phase
  });

  it('uses the start-of-phase CF for every hit (p72 example: 38 becomes 19)', () => {
    const attacker = place(createTestUnit('atlas-as7d', 0, 'atlas'), '5,8', 0);
    const target = place(createTestUnit('atlas-as7d', 1, 'target'), '5,5', 3);
    const engine = urbanEngine({
      units: { atlas: attacker, target },
      buildings: { '5,5': mediumBuilding(38) },
      phase: 'weapon_attack',
      diceRoller: makeDiceRoller(7)
    });
    const state = engine.stateManager.getState();
    const hex = state.map.hexes.get('5,5');

    // The manual's Hunchback example: an AC/10 hit, a small laser, a large
    // laser and the 5- and 4-point groupings of an LRM-15. "Each attack's
    // damage is thus reduced by 4 (38 / 10 = 3.8, rounded up to 4)", and the
    // hex's CF is only cut "at the end of the Weapon Attack Phase".
    const damageValues = [10, 3, 8, 5, 4];
    const absorbed = [];

    for (const damage of damageValues) {
      engine.phaseManager.clearQueue();
      state.currentPlayer = 0;
      const shot = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas',
        targetId: 'target',
        weapon: new Weapon({
          id: `test_${damage}`, name: `Test ${damage}`, type: 'DE', heat: 0,
          damage, shortRange: 3, mediumRange: 6, longRange: 9
        })
      });

      expect(shot.success).toBe(true);
      expect(shot.hit).toBe(true);
      absorbed.push(shot.hitLocations[0].buildingAbsorbed);
    }

    // A 3-point hit is fully absorbed by the 4-point reduction, exactly as the
    // manual's small laser does: 4 + 3 + 4 + 4 + 4 = 19.
    expect(absorbed).toEqual([4, 3, 4, 4, 4]);
    expect(hex.building.currentCF).toBe(38);

    engine.processAction(0, { type: 'endPhase' }); // weapon_attack -> physical_attack

    expect(hex.building.currentCF).toBe(19); // 38 - 19
  });

  it('damageReduction reads the start-of-phase CF snapshot', () => {
    const hex = { hexKey: '5,5', building: mediumBuilding(40) };
    expect(damageReduction(hex)).toBe(4);

    hex._cfAtPhaseStart = 38;
    hex.building.currentCF = 10;
    expect(damageReduction(hex)).toBe(4); // ceil(38 / 10), not ceil(10 / 10)
  });

  it('rejects a shot through three intervening building hexes of the same building', () => {
    // The LOS line 4,4 -> 4,8 runs through 4,5, 4,6 and 4,7, so all three
    // building hexes genuinely intervene. Both units are in building hexes of
    // one multi-hex building, so p72's building rule - not the generic
    // terrain-height LOS - decides and reports the building message.
    const attacker = place(createTestUnit('atlas-as7d', 0, 'atlas'), '4,4', 0);
    const target = place(createTestUnit('locust-lct1v', 1, 'locust'), '4,8', 3);
    const engine = urbanEngine({
      units: { atlas: attacker, locust: target },
      buildings: {
        '4,4': mediumBuilding(40, 2, 'block'),
        '4,5': mediumBuilding(40, 2, 'block'),
        '4,6': mediumBuilding(40, 2, 'block'),
        '4,7': mediumBuilding(40, 2, 'block'),
        '4,8': mediumBuilding(40, 2, 'block')
      },
      phase: 'weapon_attack'
    });
    const state = engine.stateManager.getState();

    const urban = buildingCombat(attacker, target, state);
    expect(urban.sameBuilding).toBe(true);
    expect(urban.interveningHexes).toBe(3); // 4,5, 4,6 and 4,7 lie on the line
    expect(urban.losBlocked).toBe(true);

    const weapon = createWeaponDef('med_laser');
    const result = engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'locust', weapon,
      weaponLocation: 'rightArm'
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('LOS blocked by 3 intervening building hexes/levels');
  });

  it('allows a shot across one intervening building hex of the same building', () => {
    // Regression for the verifier's probe: 4,4 -> 4,6 has exactly one
    // intervening building hex (4,5). p72 allows up to two intervening
    // building hexes/levels, so the shot must be legal even though the generic
    // terrain-height LOS treats 4,5 as a level-2 hill on a level-0 line.
    const attacker = place(createTestUnit('atlas-as7d', 0, 'atlas'), '4,4', 3);
    const target = place(createTestUnit('locust-lct1v', 1, 'locust'), '4,6', 3);
    const engine = urbanEngine({
      units: { atlas: attacker, locust: target },
      buildings: {
        '4,4': mediumBuilding(40, 2, 'block'),
        '4,5': mediumBuilding(40, 2, 'block'),
        '4,6': mediumBuilding(40, 2, 'block')
      },
      phase: 'weapon_attack',
      diceRoller: makeDiceRoller(7)
    });
    const state = engine.stateManager.getState();

    const urban = buildingCombat(attacker, target, state);
    expect(urban.sameBuilding).toBe(true);
    expect(urban.interveningHexes).toBe(1);
    expect(urban.modifier).toBe(2); // +1 target inside, +1 intervening building hex
    expect(urban.losBlocked).toBe(false);

    // The generic p22 LOS really would block this pair; p72 must take
    // precedence for units inside the same building.
    const genericLos = engine.los.calculateLOS('4,4', '4,6', state, { attacker, target });
    expect(genericLos.blocked).toBe(true);

    const weapon = createWeaponDef('med_laser');
    const directCalc = engine.attackResolver.calculateTargetNumber(
      attacker, weapon, target, state, { buildingModifier: urban.modifier }
    );
    // p72: 4 Gunnery + 2 combat within buildings; nothing else modifies TN.
    expect(directCalc.targetNumber).toBe(6);

    const result = engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'locust', weapon,
      weaponLocation: 'rightArm'
    });

    expect(result.success).toBe(true);
    // The modifier computed in _handleFire now reaches the actual attack roll:
    // the resolved TN matches the direct calculation (it used to be 4, the
    // base Gunnery, because resolveWeaponAttack dropped buildingModifier).
    expect(result.targetNumber).toBe(6);
    expect(result.targetNumber).toBe(directCalc.targetNumber);
    expect(result.modifiers).toContain('Combat within buildings: +2');
    expect(result.hit).toBe(true); // roll 7 beats TN 6
  });

  it('reproduces the p72 combat-within-buildings worked example', () => {
    // The p72 diagram: Hex A is a Level 4 heavy building hex, Hex C an
    // adjacent Level 3 heavy hex of the same building; CF is 60 on every
    // level. The BattleMaster has run to Level 0 of Hex A; the Warhammer is at
    // Level 1 of Hex A after moving 5 hexes; the Locust is at Level 2 in Hex
    // C; the Wolverine is on the Level 4 roof of Hex A.
    const battlemaster = place(createTestUnit('atlas-as7d', 0, 'battlemaster'), '5,5', 0);
    battlemaster.position.level = 0;
    battlemaster.movementMode = 'run';
    battlemaster._movementModifier = 2;

    const warhammer = place(createTestUnit('warhammer-whm6d', 1, 'warhammer'), '5,5', 3);
    warhammer.position.level = 1;
    warhammer.hexesMoved = 5;

    const locust = place(createTestUnit('locust-lct1v', 1, 'locust'), '6,5', 3);
    locust.position.level = 2;
    locust.hexesMoved = 0;

    const wolverine = place(createTestUnit('wolverine-wvr6r', 1, 'wolverine'), '5,5', 3);
    wolverine.position.level = 4; // the roof

    const engine = urbanEngine({
      units: { battlemaster, warhammer, locust, wolverine },
      buildings: {
        '5,5': { id: 'p72', type: 'heavy', levels: 4, cf: 60, currentCF: 60 },
        '6,5': { id: 'p72', type: 'heavy', levels: 3, cf: 60, currentCF: 60 }
      },
      phase: 'weapon_attack'
    });
    const state = engine.stateManager.getState();
    const machineGun = createWeaponDef('machinegun');

    // Warhammer: 4 Gunnery + 2 (the BattleMaster ran) + 2 (the Warhammer moved
    // 5 hexes) + 2 combat within buildings = 10.
    const vsWarhammer = buildingCombat(battlemaster, warhammer, state);
    expect(vsWarhammer.modifier).toBe(2);
    const warhammerCalc = engine.attackResolver.calculateTargetNumber(
      battlemaster, machineGun, warhammer, state, { buildingModifier: vsWarhammer.modifier }
    );
    expect(warhammerCalc.modifiers).toContain('Combat within buildings: +2');
    // p28: the machine gun's Min Range is 0, so the same-hex (distance 0)
    // shot carries no minimum-range penalty; the manual's TN is exact.
    expect(warhammerCalc.targetNumber).toBe(10);

    // The same-building pair keeps the p72 modifier on the live path: the
    // engine resolves the Warhammer shot at the manual TN 10.
    const warhammerShot = engine.processAction(0, {
      type: 'fire', attackerId: battlemaster.id, targetId: warhammer.id, weapon: machineGun
    });
    expect(warhammerShot.success).toBe(true);
    expect(warhammerShot.targetNumber).toBe(10);
    expect(warhammerShot.modifiers).toContain('Combat within buildings: +2');

    // Locust: 4 Gunnery + 2 (ran) + 2 combat within buildings = 8.
    const vsLocust = buildingCombat(battlemaster, locust, state);
    expect(vsLocust.modifier).toBe(2);
    const locustCalc = engine.attackResolver.calculateTargetNumber(
      battlemaster, machineGun, locust, state, { buildingModifier: vsLocust.modifier }
    );
    expect(locustCalc.targetNumber).toBe(8);

    // Wolverine: three building levels between Level 0 and the Level 4 roof,
    // so there is no line of sight from the BattleMaster.
    const vsWolverine = buildingCombat(battlemaster, wolverine, state);
    expect(vsWolverine.interveningLevels).toBe(3);
    expect(vsWolverine.losBlocked).toBe(true);
    const shot = engine.processAction(0, {
      type: 'fire', attackerId: battlemaster.id, targetId: wolverine.id, weapon: machineGun
    });
    expect(shot.success).toBe(false);
    expect(shot.error).toContain('LOS blocked');
  });
});

describe('BuildingRegistry.isMostlyDestroyed against the engine map', () => {
  it('reads destroyed hexes from the live map', () => {
    const engine = urbanEngine({
      units: {},
      buildings: {
        '5,5': mediumBuilding(40, 2, 'block'),
        '6,5': mediumBuilding(40, 2, 'block'),
        '5,6': mediumBuilding(40, 2, 'block')
      }
    });
    const hexes = engine.stateManager.getState().map.hexes;

    expect(BuildingRegistry.isMostlyDestroyed('block', hexes)).toBe(false);
    hexes.get('5,5').building.currentCF = 0;
    hexes.get('6,5').building.currentCF = 0;
    expect(BuildingRegistry.isMostlyDestroyed('block', hexes)).toBe(true);
  });
});
