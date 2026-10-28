/**
 * 6.4 hidden units - reveal triggers (BMM p82).
 *
 * The p82 "Hidden 'Mechs" text is in the project KB (chunk 42), so these tests
 * assert that trigger list: a hidden 'Mech is revealed when it fires, when its
 * own move begins, when an enemy ends its move in a hex adjacent to it, when an
 * enemy moves into or ends next to a building it hides in, when an enemy is
 * ordered into its hex, and when a jump lands in its hex. Jumping over a hex
 * does not reveal the 'Mech hidden there, and hidden 'Mechs revealed by enemy
 * movement cannot move that phase.
 *
 * The direction matters: a visible 'Mech that walks up to a hidden one reveals
 * the *hidden* 'Mech, not itself (p82). `revealOnAdjacentMove` therefore returns
 * the ids of the hidden enemies it gave away.
 */

import { describe, it, expect } from 'vitest';
import { createTestMap, createTestUnit, createTestEngine } from '../helpers/testUtils.js';
import {
  canSee,
  hiddenEnemyAt,
  projectStateForPlayer,
  revealOnAdjacentMove,
  revealOnFire,
  revealOnMove
} from '../../src/engine/visibility.js';
import { directionBetween, hexNeighbors } from '../../src/hex/HexMath.js';

/**
 * Build an engine from `{ unitId: { mech, player, hexKey, facing } }` and mark
 * the units named in `hidden` as hidden. The map defaults to the standard 17x15
 * clear test map; pass `map` (from createTestMap) for buildings.
 */
function setup({ positions = {}, hidden = {}, map = null } = {}) {
  const units = {};
  for (const [unitId, spec] of Object.entries(positions)) {
    const unit = createTestUnit(spec.mech, spec.player, unitId);
    unit.position = { hexKey: spec.hexKey, facing: spec.facing || 0 };
    units[unitId] = unit;
  }

  const engine = createTestEngine(map ? { units, map } : { units });
  const state = engine.stateManager.getState();
  state.hiddenUnits = {};
  for (const [unitId, isHidden] of Object.entries(hidden)) {
    state.hiddenUnits[unitId] = { hidden: Boolean(isHidden) };
  }
  return { engine, state, units };
}

/** Enter movement with an empty unit queue so processAction accepts the mover. */
function startMovement(engine, currentPlayer = 0) {
  engine.phaseManager.enterPhase('movement');
  engine.phaseManager.clearQueue();
  engine.stateManager.getState().currentPlayer = currentPlayer;
}

function move(engine, playerId, unitId, path, movementType = 'walk') {
  return engine.processAction(playerId, { type: 'move', unitId, path, movementType });
}

/** A visible player-0 Atlas at 5,5 and a hidden player-1 Locust at 5,4. */
function visibleAtlasBesideHiddenLocust() {
  return setup({
    positions: {
      atlas: { mech: 'atlas-as7d', player: 0, hexKey: '5,5', facing: 3 },
      locust: { mech: 'locust-lct1v', player: 1, hexKey: '5,4', facing: 0 }
    },
    hidden: { locust: true }
  });
}

describe('p82: a visible mover ending beside a hidden enemy reveals THAT ENEMY', () => {
  it('reveals the hidden enemy, not the mover (reviewer probe: Atlas at 5,5, Locust at 5,4)', () => {
    const { state } = visibleAtlasBesideHiddenLocust();

    expect(canSee(0, 'locust', state)).toBe(false);

    const revealed = revealOnAdjacentMove(state, 'atlas');

    expect(revealed).toEqual(['locust']);
    expect(state.hiddenUnits.locust.hidden).toBe(false);
    expect(canSee(0, 'locust', state)).toBe(true);
    // The mover was never hidden and is not added to the hidden state.
    expect(state.hiddenUnits.atlas).toBeUndefined();
  });

  it('does not give the mover away: adjacency alone never hides/reveals the mover', () => {
    // A hidden mover next to a visible enemy stays hidden through this trigger;
    // only revealOnMove (start of its own move) reveals it.
    const { state } = setup({
      positions: {
        mover: { mech: 'locust-lct1v', player: 1, hexKey: '5,5', facing: 3 },
        atlas: { mech: 'atlas-as7d', player: 0, hexKey: '5,4', facing: 0 }
      },
      hidden: { mover: true }
    });

    expect(revealOnAdjacentMove(state, 'mover')).toEqual([]);
    expect(state.hiddenUnits.mover.hidden).toBe(true);
  });

  it('checks all six neighbouring hexes, not just one', () => {
    for (const offset of [0, 1, 2, 3, 4, 5]) {
      const { state } = setup({
        positions: {
          mover: { mech: 'atlas-as7d', player: 0, hexKey: '5,5', facing: 3 },
          stalker: { mech: 'locust-lct1v', player: 1, hexKey: hexNeighbors('5,5')[offset], facing: 0 }
        },
        hidden: { stalker: true }
      });

      expect(revealOnAdjacentMove(state, 'mover')).toEqual(['stalker']);
      expect(state.hiddenUnits.stalker.hidden).toBe(false);
    }
  });

  it('does not reveal a hidden enemy two hexes away', () => {
    const { state } = setup({
      positions: {
        mover: { mech: 'atlas-as7d', player: 0, hexKey: '5,5', facing: 3 },
        stalker: { mech: 'locust-lct1v', player: 1, hexKey: '5,3', facing: 0 }
      },
      hidden: { stalker: true }
    });

    expect(revealOnAdjacentMove(state, 'mover')).toEqual([]);
    expect(state.hiddenUnits.stalker.hidden).toBe(true);
  });

  it('does not reveal a hidden friendly unit', () => {
    const { state } = setup({
      positions: {
        mover: { mech: 'atlas-as7d', player: 0, hexKey: '5,5', facing: 3 },
        ally: { mech: 'locust-lct1v', player: 0, hexKey: '5,4', facing: 0 }
      },
      hidden: { ally: true }
    });

    expect(revealOnAdjacentMove(state, 'mover')).toEqual([]);
    expect(state.hiddenUnits.ally.hidden).toBe(true);
  });

  it('ignores already-visible enemies and movers with no position', () => {
    const { state } = setup({
      positions: {
        mover: { mech: 'atlas-as7d', player: 0, hexKey: '5,5', facing: 3 },
        visible: { mech: 'locust-lct1v', player: 1, hexKey: '5,4', facing: 0 }
      },
      hidden: { visible: false }
    });

    expect(revealOnAdjacentMove(state, 'mover')).toEqual([]);

    state.units.mover.position = { hexKey: null, facing: 0 };
    expect(revealOnAdjacentMove(state, 'mover')).toEqual([]);
    expect(revealOnAdjacentMove(state, 'nobody')).toEqual([]);
  });

  it('keeps the hidden state JSON-safe', () => {
    const { state } = visibleAtlasBesideHiddenLocust();

    revealOnAdjacentMove(state, 'atlas');

    expect(JSON.parse(JSON.stringify(state.hiddenUnits))).toEqual({
      locust: { hidden: false }
    });
  });

  it('engine: a visible Atlas ending its move beside a hidden Locust reveals the Locust', () => {
    const { engine, state } = setup({
      positions: {
        atlas: {
          mech: 'atlas-as7d', player: 0, hexKey: '4,4',
          facing: directionBetween('4,4', '4,5')
        },
        locust: { mech: 'locust-lct1v', player: 1, hexKey: '5,5', facing: 3 }
      },
      hidden: { locust: true }
    });
    startMovement(engine, 0);

    // The Atlas starts at 4,4 (not adjacent to 5,5) and ends at 4,5, adjacent.
    const result = move(engine, 0, 'atlas', ['4,4', '4,5']);

    expect(result.success).toBe(true);
    expect(result.finalHex).toBe('4,5');
    expect(state.hiddenUnits.locust.hidden).toBe(false);
    expect(canSee(0, 'locust', state)).toBe(true);
    expect(state.hiddenUnits.atlas).toBeUndefined();
  });
});

describe('p82: a hidden Mech is revealed when its own move begins', () => {
  it('revealOnMove reveals the hidden mover', () => {
    const { state } = setup({
      positions: { mover: { mech: 'locust-lct1v', player: 1, hexKey: '5,5', facing: 0 } },
      hidden: { mover: true }
    });

    expect(canSee(0, 'mover', state)).toBe(false);
    expect(revealOnMove(state, 'mover')).toBe(true);

    expect(state.hiddenUnits.mover.hidden).toBe(false);
    expect(canSee(0, 'mover', state)).toBe(true);
  });

  it('does nothing for a visible unit or an unknown unit', () => {
    const { state } = setup({
      positions: {
        visible: { mech: 'locust-lct1v', player: 1, hexKey: '5,5', facing: 0 }
      }
    });

    expect(revealOnMove(state, 'visible')).toBe(false);
    expect(revealOnMove(state, 'nobody')).toBe(false);
    expect(state.hiddenUnits).toEqual({});
  });

  it('engine: a hidden Mech that moves away from every enemy is still revealed', () => {
    const { engine, state } = setup({
      positions: {
        ghost: { mech: 'locust-lct1v', player: 1, hexKey: '12,12', facing: 0 }
      },
      hidden: { ghost: true }
    });
    startMovement(engine, 1);

    const result = move(engine, 1, 'ghost', ['12,12', '12,11']);

    expect(result.success).toBe(true);
    expect(result.finalHex).toBe('12,11');
    // No enemy is anywhere near the destination; the move itself gave it away.
    expect(state.hiddenUnits.ghost.hidden).toBe(false);
    expect(Object.keys(projectStateForPlayer(state, 0).units)).toContain('ghost');
  });

  it('engine: the mover is already revealed when the unitMoved event fires', () => {
    const { engine, state } = setup({
      positions: {
        ghost: { mech: 'locust-lct1v', player: 1, hexKey: '12,12', facing: 0 }
      },
      hidden: { ghost: true }
    });
    startMovement(engine, 1);

    // "At the start of its move" means nobody observes a hidden unit moving:
    // the reveal must be in state before the move is announced.
    let hiddenWhenAnnounced = true;
    engine.eventBus.on('unitMoved', () => {
      hiddenWhenAnnounced = state.hiddenUnits.ghost.hidden;
    });

    move(engine, 1, 'ghost', ['12,12', '12,11']);

    expect(hiddenWhenAnnounced).toBe(false);
  });

  it('engine: a hidden mover moving beside a hidden enemy reveals both', () => {
    const { engine, state } = setup({
      positions: {
        mover: { mech: 'locust-lct1v', player: 1, hexKey: '4,4', facing: directionBetween('4,4', '4,5') },
        ghost: { mech: 'atlas-as7d', player: 0, hexKey: '5,5', facing: 3 }
      },
      hidden: { mover: true, ghost: true }
    });
    startMovement(engine, 1);

    const result = move(engine, 1, 'mover', ['4,4', '4,5']);

    expect(result.success).toBe(true);
    // The mover gave itself away by moving; the ghost by being adjacent.
    expect(state.hiddenUnits.mover.hidden).toBe(false);
    expect(state.hiddenUnits.ghost.hidden).toBe(false);
  });
});

describe('p82: moving into a hex containing a hidden enemy stops the mover short and reveals it', () => {
  it('stops in the hex before the hidden Mech and reveals it', () => {
    const { engine, state } = setup({
      positions: {
        mover: { mech: 'locust-lct1v', player: 0, hexKey: '4,5', facing: 0 },
        guard: { mech: 'atlas-as7d', player: 1, hexKey: '5,5', facing: 3 }
      },
      hidden: { guard: true }
    });
    startMovement(engine, 0);

    const result = move(engine, 0, 'mover', ['4,5', '5,5']);

    expect(result.success).toBe(true);
    // The move was ordered into 5,5 but stops in the adjacent 4,5 instead.
    expect(result.finalHex).toBe('4,5');
    expect(state.units.mover.position.hexKey).toBe('4,5');
    expect(state.hiddenUnits.guard.hidden).toBe(false);
    expect(result.stoppedShortOf).toBe('guard');
  });

  it('stops at the last hex before the hidden Mech on a longer path', () => {
    const { engine, state } = setup({
      positions: {
        mover: { mech: 'locust-lct1v', player: 0, hexKey: '4,5', facing: directionBetween('4,5', '5,5') },
        guard: { mech: 'atlas-as7d', player: 1, hexKey: '5,6', facing: 3 }
      },
      hidden: { guard: true }
    });
    startMovement(engine, 0);

    const result = move(engine, 0, 'mover', ['4,5', '5,5', '5,6']);

    expect(result.success).toBe(true);
    expect(result.finalHex).toBe('5,5');
    expect(state.units.mover.position.hexKey).toBe('5,5');
    expect(state.hiddenUnits.guard.hidden).toBe(false);
  });

  it('does not stop for a hidden friendly unit in the destination hex', () => {
    const { engine, state } = setup({
      positions: {
        mover: { mech: 'locust-lct1v', player: 0, hexKey: '4,5', facing: directionBetween('4,5', '5,5') },
        ally: { mech: 'atlas-as7d', player: 0, hexKey: '5,5', facing: 3 }
      },
      hidden: { ally: true }
    });
    startMovement(engine, 0);

    const result = move(engine, 0, 'mover', ['4,5', '5,5']);

    expect(result.success).toBe(true);
    expect(result.finalHex).toBe('5,5');
    expect(state.units.mover.position.hexKey).toBe('5,5');
    // A friendly unit never gives itself away to a friendly mover.
    expect(state.hiddenUnits.ally.hidden).toBe(true);
  });
});

describe('p82 Jumping: overflight does not reveal, a landing in the hex does', () => {
  it('jumps over a hidden Mech without blocking or revealing it', () => {
    const { engine, state } = setup({
      positions: {
        mover: { mech: 'jenner-jr7d', player: 0, hexKey: '5,5', facing: 3 },
        guard: { mech: 'locust-lct1v', player: 1, hexKey: '5,6', facing: 0 }
      },
      hidden: { guard: true }
    });
    startMovement(engine, 0);

    // The guard's hex is on the flight path and is adjacent to the landing hex.
    const result = move(engine, 0, 'mover', ['5,5', '5,6', '5,7'], 'jump');

    expect(result.success).toBe(true);
    expect(result.finalHex).toBe('5,7');
    expect(result.stoppedShortOf).toBeUndefined();
    expect(state.units.mover.position.hexKey).toBe('5,7');
    // "Jumping over hexes does not reveal 'Mechs hidden in them." (p82)
    expect(state.hiddenUnits.guard.hidden).toBe(true);
  });

  it('does not let a jump reveal a hidden Mech in an overflown building hex', () => {
    const map = createTestMap({
      '5,5': { terrainType: 'clear' },
      '5,6': {
        terrainType: 'clear',
        building: { id: 'b1', type: 'medium', levels: 1, cf: 40, currentCF: 40 }
      },
      '5,7': { terrainType: 'clear' }
    });
    const { engine, state } = setup({
      map,
      positions: {
        mover: { mech: 'jenner-jr7d', player: 0, hexKey: '5,5', facing: 3 },
        guard: { mech: 'locust-lct1v', player: 1, hexKey: '5,6', facing: 0 }
      },
      hidden: { guard: true }
    });
    startMovement(engine, 0);

    const result = move(engine, 0, 'mover', ['5,5', '5,6', '5,7'], 'jump');

    expect(result.success).toBe(true);
    expect(state.hiddenUnits.guard.hidden).toBe(true);
  });

  it('a jump into a hidden Mech\'s hex lands there and reveals it', () => {
    const { engine, state } = setup({
      positions: {
        mover: { mech: 'jenner-jr7d', player: 0, hexKey: '5,5', facing: 3 },
        guard: { mech: 'locust-lct1v', player: 1, hexKey: '5,7', facing: 0 }
      },
      hidden: { guard: true }
    });
    startMovement(engine, 0);

    const result = move(engine, 0, 'mover', ['5,5', '5,6', '5,7'], 'jump');

    expect(result.success).toBe(true);
    // Stop-short is ground movement only: the jump still lands in 5,7.
    expect(result.finalHex).toBe('5,7');
    expect(result.stoppedShortOf).toBeUndefined();
    expect(state.units.mover.position.hexKey).toBe('5,7');
    expect(state.hiddenUnits.guard.hidden).toBe(false);
  });
});

describe('p82: hidden Mechs revealed by movement cannot move that phase', () => {
  it('bar the revealed Mech from moving, but only for that turn', () => {
    const { engine, state } = setup({
      positions: {
        atlas: { mech: 'atlas-as7d', player: 0, hexKey: '4,4', facing: directionBetween('4,4', '4,5') },
        ghost: { mech: 'locust-lct1v', player: 1, hexKey: '5,5', facing: 0 }
      },
      hidden: { ghost: true }
    });
    startMovement(engine, 0);

    // The Atlas reveals the ghost by ending its move next to it.
    expect(move(engine, 0, 'atlas', ['4,4', '4,5']).success).toBe(true);
    expect(state.hiddenUnits.ghost.hidden).toBe(false);

    state.currentPlayer = 1;
    const blocked = move(engine, 1, 'ghost', ['5,5', '5,6']);

    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/cannot move this phase/i);
    expect(state.units.ghost.position.hexKey).toBe('5,5');

    // The bar is per turn: next turn the (now visible) Mech moves normally.
    state.turn = 2;
    const nextTurn = move(engine, 1, 'ghost', ['5,5', '5,6']);
    expect(nextTurn.success).toBe(true);
  });

  it('also bars a hidden Mech revealed by an entry stop-short', () => {
    const { engine, state } = setup({
      positions: {
        mover: { mech: 'locust-lct1v', player: 0, hexKey: '4,5', facing: 0 },
        guard: { mech: 'atlas-as7d', player: 1, hexKey: '5,5', facing: 3 }
      },
      hidden: { guard: true }
    });
    startMovement(engine, 0);

    // The move is ordered into the guard's hex and stops in 4,5 instead.
    const entry = move(engine, 0, 'mover', ['4,5', '5,5']);
    expect(entry.finalHex).toBe('4,5');
    expect(state.hiddenUnits.guard.hidden).toBe(false);

    state.currentPlayer = 1;
    const blocked = move(engine, 1, 'guard', ['5,5', '5,6']);

    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/cannot move this phase/i);
    expect(state.units.guard.position.hexKey).toBe('5,5');
  });
});

describe('p82 Buildings: a move into or next to a building reveals its hidden Mechs', () => {
  const building = (id) => ({ id, type: 'medium', levels: 1, cf: 40, currentCF: 40 });

  /** b1 spans 5,5 and 5,7 (non-adjacent hexes, same structure); b2 is far away. */
  function buildingMap() {
    return createTestMap({
      '4,4': { terrainType: 'clear' },
      '4,5': { terrainType: 'clear' },
      '5,5': { terrainType: 'clear', building: building('b1') },
      '5,7': { terrainType: 'clear', building: building('b1') },
      '9,9': { terrainType: 'clear', building: building('b2') }
    });
  }

  it('ending a move next to a building hex reveals hidden Mechs elsewhere in that building', () => {
    const { engine, state } = setup({
      map: buildingMap(),
      positions: {
        atlas: { mech: 'atlas-as7d', player: 0, hexKey: '4,4', facing: directionBetween('4,4', '4,5') },
        guard: { mech: 'locust-lct1v', player: 1, hexKey: '5,7', facing: 0 }
      },
      hidden: { guard: true }
    });
    startMovement(engine, 0);

    // The Atlas ends at 4,5: adjacent to the b1 hex 5,5, but not to the guard
    // in the other b1 hex 5,7. Only the building rule can reveal it.
    const result = move(engine, 0, 'atlas', ['4,4', '4,5']);

    expect(result.success).toBe(true);
    expect(state.hiddenUnits.guard.hidden).toBe(false);
  });

  it('a jump landing inside a building hex reveals hidden Mechs in that building', () => {
    const { engine, state } = setup({
      map: buildingMap(),
      positions: {
        mover: { mech: 'jenner-jr7d', player: 0, hexKey: '4,4', facing: directionBetween('4,4', '4,5') },
        guard: { mech: 'locust-lct1v', player: 1, hexKey: '5,7', facing: 0 }
      },
      hidden: { guard: true }
    });
    startMovement(engine, 0);

    const result = move(engine, 0, 'mover', ['4,4', '4,5', '5,5'], 'jump');

    expect(result.success).toBe(true);
    expect(result.finalHex).toBe('5,5');
    expect(state.hiddenUnits.guard.hidden).toBe(false);
  });

  it('does not reveal hidden Mechs in a different building', () => {
    const { engine, state } = setup({
      map: buildingMap(),
      positions: {
        atlas: { mech: 'atlas-as7d', player: 0, hexKey: '4,4', facing: directionBetween('4,4', '4,5') },
        guard: { mech: 'locust-lct1v', player: 1, hexKey: '9,9', facing: 0 }
      },
      hidden: { guard: true }
    });
    startMovement(engine, 0);

    const result = move(engine, 0, 'atlas', ['4,4', '4,5']);

    expect(result.success).toBe(true);
    expect(state.hiddenUnits.guard.hidden).toBe(true);
  });
});

describe('hiddenEnemyAt', () => {
  it('finds a hidden enemy in the hex and ignores everyone else', () => {
    const { state } = setup({
      positions: {
        mover: { mech: 'locust-lct1v', player: 0, hexKey: '4,5', facing: 0 },
        enemy: { mech: 'atlas-as7d', player: 1, hexKey: '5,5', facing: 3 },
        visibleEnemy: { mech: 'jenner-jr7d', player: 1, hexKey: '4,6', facing: 3 },
        ally: { mech: 'locust-lct1v', player: 0, hexKey: '4,4', facing: 0 }
      },
      hidden: { enemy: true, ally: true }
    });

    expect(hiddenEnemyAt(state, '5,5', state.units.mover)).toBe('enemy');
    expect(hiddenEnemyAt(state, '4,6', state.units.mover)).toBeNull(); // visible
    expect(hiddenEnemyAt(state, '4,4', state.units.mover)).toBeNull(); // friendly
    expect(hiddenEnemyAt(state, '9,9', state.units.mover)).toBeNull(); // empty
  });
});

describe('revealOnFire', () => {
  function hiddenSpotter() {
    const scenario = setup({
      positions: {
        spotter: { mech: 'atlas-as7d', player: 0, hexKey: '5,5', facing: 0 },
        enemy: { mech: 'locust-lct1v', player: 1, hexKey: '12,12', facing: 3 }
      },
      hidden: { spotter: true }
    });
    return scenario;
  }

  it('reveals a hidden unit that has fired this turn', () => {
    const { state, units } = hiddenSpotter();
    units.spotter.firedThisTurn = new Set(['rightArm']);

    expect(canSee(1, 'spotter', state)).toBe(false);
    expect(revealOnFire(state, 'spotter')).toBe(true);

    expect(state.hiddenUnits.spotter.hidden).toBe(false);
    expect(canSee(1, 'spotter', state)).toBe(true);
  });

  it('leaves a hidden unit hidden when it has not fired', () => {
    const { state, units } = hiddenSpotter();
    units.spotter.firedThisTurn = new Set();

    expect(revealOnFire(state, 'spotter')).toBe(false);
    expect(state.hiddenUnits.spotter.hidden).toBe(true);
  });

  it('treats a missing firedThisTurn as "has not fired"', () => {
    const { state } = hiddenSpotter();

    expect(revealOnFire(state, 'spotter')).toBe(false);
    expect(state.hiddenUnits.spotter.hidden).toBe(true);
  });

  it('accepts the JSON form of firedThisTurn (an array)', () => {
    const { state, units } = hiddenSpotter();
    // Unit.toJSON() turns the Set into an array; a helper that only understood
    // Set would silently stop revealing after a save/load or a wire hop.
    units.spotter.firedThisTurn = ['leftArm'];

    expect(revealOnFire(state, 'spotter')).toBe(true);
    expect(state.hiddenUnits.spotter.hidden).toBe(false);
  });

  it('does nothing to a unit that is already visible', () => {
    const { state, units } = hiddenSpotter();
    state.hiddenUnits.spotter.hidden = false;
    units.spotter.firedThisTurn = new Set(['rightArm']);

    expect(revealOnFire(state, 'spotter')).toBe(false);
    expect(state.hiddenUnits.spotter.hidden).toBe(false);
  });

  it('ignores units with no hidden-state entry and unknown units', () => {
    const { state, units } = hiddenSpotter();
    units.enemy.firedThisTurn = new Set(['rightArm']);

    expect(revealOnFire(state, 'enemy')).toBe(false);
    expect(revealOnFire(state, 'nobody')).toBe(false);
    expect(state.hiddenUnits.enemy).toBeUndefined();
  });

  it('reveals only the unit that fired', () => {
    const { state, units } = hiddenSpotter();
    const ally = createTestUnit('jenner-jr7d', 0, 'ally');
    ally.position = { hexKey: '5,6', facing: 0 };
    state.units.ally = ally;
    state.hiddenUnits.ally = { hidden: true };
    units.spotter.firedThisTurn = new Set(['rightArm']);

    expect(revealOnFire(state, 'spotter')).toBe(true);

    expect(state.hiddenUnits.spotter.hidden).toBe(false);
    expect(state.hiddenUnits.ally.hidden).toBe(true);
  });

  it('keeps the hidden state JSON-safe', () => {
    const { state, units } = hiddenSpotter();
    units.spotter.firedThisTurn = new Set(['rightArm']);

    revealOnFire(state, 'spotter');

    expect(JSON.parse(JSON.stringify(state.hiddenUnits))).toEqual({
      spotter: { hidden: false }
    });
    expect(typeof state.hiddenUnits.spotter.hidden).toBe('boolean');
  });

  it('makes a fired unit appear in the opponent projection', () => {
    const { state, units } = hiddenSpotter();
    units.spotter.firedThisTurn = new Set(['rightArm']);

    expect(Object.keys(projectStateForPlayer(state, 1).units)).toEqual(['enemy']);

    revealOnFire(state, 'spotter');

    expect(Object.keys(projectStateForPlayer(state, 1).units).sort())
      .toEqual(['enemy', 'spotter']);
  });
});
