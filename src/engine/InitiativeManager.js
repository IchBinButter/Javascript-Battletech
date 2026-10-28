/**
 * InitiativeManager - Handle initiative rolls and move order.
 */

export class InitiativeManager {
  /**
   * Roll initiative for all players.
   * Each side rolls 2d6, high wins. Ties are re-rolled.
   * @returns {{ winner: number, rolls: Array<{playerId, roll}> }}
   */
  rollInitiative(players, diceRoller) {
    const rolls = players.map(p => ({
      playerId: p.id,
      roll: diceRoller.roll2d6()
    }));

    rolls.sort((a, b) => b.roll - a.roll);

    let retries = 0;
    while (rolls.length > 1 && rolls[0].roll === rolls[1].roll && retries < 100) {
      retries++;
      const tied = rolls.filter(r => r.roll === rolls[0].roll);
      for (const t of tied) {
        t.roll = diceRoller.roll2d6();
      }
      rolls.sort((a, b) => b.roll - a.roll);
    }

    if (rolls.length > 1 && rolls[0].roll === rolls[1].roll) {
      // Deterministic fallback after 100 re-rolls: lowest player id wins, so a
      // replay or a server never disagrees with a client about the winner.
      const tied = rolls.filter(r => r.roll === rolls[0].roll);
      const winner = tied.reduce((best, r) => (r.playerId < best.playerId ? r : best), tied[0]);
      return {
        winner: winner.playerId,
        rolls
      };
    }

    return {
      winner: rolls[0].playerId,
      rolls
    };
  }

  /**
   * Get the move order for a given phase.
   * Movement/Weapon phases: initiative loser moves first.
   * Physical attack phase: initiative winner moves first.
   */
  getInitiativeOrder(winner, players, phase) {
    const loser = players.find(p => p.id !== winner) || players[0];
    const winnerPlayer = players.find(p => p.id === winner) || players[0];

    if (phase === 'physical_attack') {
      return [winnerPlayer.id, loser.id];
    }

    return [loser.id, winnerPlayer.id];
  }
}
