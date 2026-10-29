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
   * p10: "The side that lost Initiative must act first." The Weapon Attack
   * Phase repeats that, and p12's Physical Attack Phase repeats the Weapon
   * Attack Phase, so the loser declares first in all three acting phases.
   * Nothing in p10/p12 lets the winner choose the phase order (the manual's
   * only winner choice there is the pre-game deployment side), so there is no
   * winner-goes-first option - H-11 removed that house rule.
   *
   * Before the first Initiative Phase there is no recorded winner; both slots
   * fall back to the first player so the pre-roll declaration queue is stable.
   *
   * @param {number|null} winner - player id that won initiative
   * @param {Array<{id:number}>} players
   * @returns {number[]} player ids in declaration order (loser first)
   */
  getInitiativeOrder(winner, players) {
    const loser = players.find(p => p.id !== winner) || players[0];
    const winnerPlayer = players.find(p => p.id === winner) || players[0];

    return [loser.id, winnerPlayer.id];
  }
}
