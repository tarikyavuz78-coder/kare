import { describe, it, expect } from 'vitest';
import { playBotGame } from '../src/engine/runner';

describe('botlarla tam oyun', () => {
  for (const [seed, n] of [[1, 4], [2, 3], [3, 2], [4, 4], [5, 4], [6, 3]] as const) {
    it(`seed ${seed}, ${n} oyuncu: oyun biter ve kartlar korunur`, () => {
      const { state, steps } = playBotGame(seed, n);
      expect(state.phase).toBe('gameOver');
      expect(state.history.length).toBeGreaterThanOrEqual(state.fullRunWin ? 0 : 11);
      const total = state.deck.length + state.discard.length + state.melds.reduce((a, m) => a + m.cards.length, 0)
        + state.players.reduce((a, p) => a + p.hand.length, 0);
      expect(total).toBe(106);
      const opens = state.history.filter((h) => h.winner !== null).length;
      console.log(`seed ${seed}: ${steps} adım, ${state.history.length} el, bitirilen el ${opens}, kazanan ${state.players[state.winner!].name}`);
    }, 60000);
  }
});
