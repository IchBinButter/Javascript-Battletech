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
   * Get the declaration order for a phase.
   *
   * p10: "The side that lost Initiative must act first." p12: the Physical
   * Attack Phase "repeat[s] the steps given for the Weapon Attack Phase", so
   * the initiative loser declares physical attacks first as well - there is no
   * winner-first phase in the sequence of play.
   *
   * @param {number} winner - player id that won initiative
   * @param {Array<{id:number}>} players
   * @param {string} [phase] - kept for callers that pass the phase
   * @returns {number[]} player ids in declaration order (loser first)
   */
  getInitiativeOrder(winner, players, phase) {
    const loser = players.find(p => p.id !== winner) || players[0];
    const winnerPlayer = players.find(p => p.id === winner) || players[0];

    return [loser.id, winnerPlayer.id];
  }
}
