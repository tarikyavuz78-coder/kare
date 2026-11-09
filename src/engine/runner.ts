// Yapay zekâ turlarını yürüten yardımcı (bot modu ve sunucu için ortak)
import { apply, checkTake, createGame, GameState, RuleError, Action } from './game';
import { botAction, botAnswersCift, botShouldDeclareCift } from './bot';

export const botStats = { errors: 0, lastErrors: [] as string[] };

/** Sıradaki botun tek bir hamlesini uygular. İzin sorusunu önceki oyuncu bot ise otomatik cevaplar. */
export function stepBot(s: GameState, askHuman?: (prev: number) => boolean): GameState {
  const pi = s.current;
  const me = s.players[pi];
  if (s.turn.phase === 'draw' && !me.cift && me.opened === 'none' && botShouldDeclareCift(s, pi)) {
    return apply(s, pi, { type: 'declareCift' });
  }
  let a: Action = botAction(s, pi);
  if (a.type === 'take') {
    const chk = checkTake(s, pi);
    if (chk.askPrevious !== null) {
      const prev = s.players[chk.askPrevious];
      const says = prev.isBot ? botAnswersCift(s, chk.askPrevious) : askHuman ? askHuman(chk.askPrevious) : false;
      if (says) {
        s = apply(s, chk.askPrevious, { type: 'declareCift' });
        a = { type: 'draw' };
      }
    }
  }
  try {
    return apply(s, pi, a);
  } catch (e) {
    if (!(e instanceof RuleError)) throw e;
    botStats.errors++;
    if (botStats.lastErrors.length < 20) botStats.lastErrors.push(`${a.type}: ${e.message}`);
    // güvenlik ağı: geçersiz bir bot hamlesinde turu basitçe bitir
    if (s.turn.phase === 'draw') return apply(s, pi, { type: 'draw' });
    if (s.turn.taken) return apply(s, pi, { type: 'undoTake' });
    const hand = s.players[pi].hand.filter((c) => c.id !== s.turn.taken && !c.joker);
    return apply(s, pi, { type: 'discard', cardId: (hand[0] ?? s.players[pi].hand[0]).id });
  }
}

/** Tamamen botlarla bir oyun oynatır (testler için). */
export function playBotGame(seed: number, players = 4, maxSteps = 200000): { state: GameState; steps: number } {
  let s = createGame(Array.from({ length: players }, (_, i) => `Bot${i + 1}`), { seed, bots: Array(players).fill(true) });
  let steps = 0;
  while (s.phase !== 'gameOver' && steps < maxSteps) {
    steps++;
    if (s.phase === 'handOver') { s = apply(s, 0, { type: 'nextHand' }); continue; }
    s = stepBot(s);
  }
  return { state: s, steps };
}
