import { describe, it, expect } from 'vitest';
import { Card, Suit, makeDeck } from '../src/engine/cards';
import { resolveRun, resolveSet, resolvePair, resolveGroup, jokerSwapIndex } from '../src/engine/melds';
import { createGame, apply, GameState, handPenalty, Player, thresholds, finalScores, checkTake, RuleError } from '../src/engine/game';

let n = 0;
function c(code: string): Card {
  n++;
  if (code === 'JK') return { id: `JK-${n}`, joker: true, suit: null, rank: null };
  return { id: `${code}-${n}`, joker: false, suit: code[0] as Suit, rank: parseInt(code.slice(1), 10) };
}
const cs = (...codes: string[]) => codes.map(c);
const ids = (cards: Card[]) => cards.map((x) => x.id);

/** Oyuncu 0'ın sırası, kart çekmiş durumda. */
function setup(hands: Card[][], o: { deck?: number; phase?: 'draw' | 'play' } = {}): GameState {
  const s = createGame(hands.map((_, i) => `O${i}`), { seed: 1 });
  s.players.forEach((p, i) => (p.hand = hands[i]));
  s.deck = cs(...Array.from({ length: o.deck ?? 30 }, () => 'C2'));
  s.current = 0;
  s.turn = { phase: o.phase ?? 'play', taken: null, takenMustOpen: false, takenMustUse: false, actedSinceTake: false };
  return s;
}
const fill = (k: number) => cs(...Array.from({ length: k }, () => 'S2'));

describe('deste', () => {
  it('106 kart, 2 joker', () => {
    const d = makeDeck();
    expect(d.length).toBe(106);
    expect(d.filter((x) => x.joker).length).toBe(2);
  });
  it('herkese 14 kart dağıtılır', () => {
    const s = createGame(['A', 'B', 'C', 'D'], { seed: 7 });
    s.players.forEach((p) => expect(p.hand.length).toBe(14));
    expect(s.deck.length).toBe(106 - 56);
  });
});

describe('per, çift, joker', () => {
  it('As puanları: A-2-3 = 6, Q-K-A = 31, A-A-A = 33', () => {
    expect(resolveRun(cs('H1', 'H2', 'H3'))!.points).toBe(6);
    expect(resolveRun(cs('H12', 'H13', 'H1'))!.points).toBe(31);
    expect(resolveSet(cs('H1', 'S1', 'D1'))!.points).toBe(33);
  });
  it('K-A-2 geçersiz', () => expect(resolveRun(cs('H13', 'H1', 'H2'))).toBeNull());
  it('farklı renkler seri olamaz', () => expect(resolveRun(cs('H4', 'S5', 'H6'))).toBeNull());
  it('aynı renkten iki kart gruba giremez', () => expect(resolveSet(cs('S7', 'S7', 'H7'))).toBeNull());
  it('çift birebir aynı kart', () => {
    expect(resolvePair(cs('S7', 'S7'))).not.toBeNull();
    expect(resolvePair(cs('H2', 'S2'))).toBeNull();
    expect(resolvePair(cs('JK', 'JK'))).toBeNull();
    expect(resolvePair(cs('S7', 'JK'))!.suit).toBe('S');
  });
  it('joker konuma göre: joker+3+4 → 2, 3+4+joker → 5', () => {
    expect(resolveRun(cs('JK', 'C3', 'C4'))!.slots[0].value).toBe(2);
    expect(resolveRun(cs('C3', 'C4', 'JK'))!.slots[2].value).toBe(5);
    const r = resolveRun(cs('JK', 'C4', 'JK', 'C6', 'C7'))!;
    expect([r.slots[0].value, r.slots[2].value]).toEqual([3, 5]);
  });
  it('belirsiz per: yüksek puan, eşitse grup', () => {
    expect(resolveGroup(cs('JK', 'JK', 'H5'))!).toMatchObject({ kind: 'set', points: 15 });
    expect(resolveGroup(cs('H5', 'JK', 'JK'))!).toMatchObject({ kind: 'run', points: 18 });
    expect(resolveGroup(cs('JK', 'H5', 'JK'))!).toMatchObject({ kind: 'set', points: 15 });
  });
  it('A-A tam seri yalnızca açılışta (allowFull)', () => {
    const full = cs('H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11', 'H12', 'H13', 'H1');
    expect(resolveRun(full)).toBeNull();
    expect(resolveRun(full, true)).not.toBeNull();
  });
  it('joker değiştirme hedefleri', () => {
    const run = cs('C3', 'JK', 'C5');
    expect(jokerSwapIndex('run', run, c('C4'))).toBe(1);
    expect(jokerSwapIndex('run', run, c('H4'))).toBe(-1);
    const set3 = cs('H7', 'S7', 'JK');
    expect(jokerSwapIndex('set', set3, c('C7'))).toBe(2);
    expect(jokerSwapIndex('set', set3, c('D7'))).toBe(2);
    expect(jokerSwapIndex('set', set3, c('H7'))).toBe(-1);
    expect(jokerSwapIndex('pair', cs('S7', 'JK'), c('S7'))).toBe(1);
    expect(jokerSwapIndex('pair', cs('S7', 'JK'), c('H7'))).toBe(-1);
  });
});

describe('açma ve baraj', () => {
  it('70 reddedilir, 71 kabul', () => {
    // 10+10+10 (J Q K kupa) =30, 9 9 9 =27, 4 5 =9 eksik → 66 + 4-5-6 karo 15 = ...
    const a = cs('H11', 'H12', 'H13', 'S9', 'D9', 'C9', 'D3', 'D4', 'D5'); // 30+27+12 = 69
    const s = setup([[...a, ...fill(3)], fill(14)]);
    expect(() => apply(s, 0, { type: 'open', groups: [ids(a.slice(0, 3)), ids(a.slice(3, 6)), ids(a.slice(6))] })).toThrow(RuleError);
    const b = cs('H11', 'H12', 'H13', 'S9', 'D9', 'C9', 'D4', 'D5', 'D6'); // 30+27+15 = 72
    const s2 = setup([[...b, ...fill(3)], fill(14)]);
    const r = apply(s2, 0, { type: 'open', groups: [ids(b.slice(0, 3)), ids(b.slice(3, 6)), ids(b.slice(6))] });
    expect(r.players[0].opened).toBe('normal');
    expect(r.players[0].openValue).toBe(72);
  });
  it('yıldızlar: 101 → 1, 121 → 2; çift 6 → 1, 7 → 2', async () => {
    const { starsForPoints, starsForPairs } = await import('../src/engine/game');
    expect([100, 101, 120, 121].map(starsForPoints)).toEqual([0, 1, 1, 2]);
    expect([5, 6, 7].map(starsForPairs)).toEqual([0, 1, 2]);
  });
  it('yükselen baraj', () => {
    const s = setup([fill(14), fill(14), fill(14)]);
    expect(thresholds(s)).toEqual({ normal: 71, pairs: 5 });
    s.players[1].opened = 'normal'; s.players[1].openValue = 75;
    expect(thresholds(s)).toEqual({ normal: 76, pairs: 5 });
    s.players[2].opened = 'pairs'; s.players[2].openValue = 5;
    expect(thresholds(s)).toEqual({ normal: 101, pairs: 6 });
    s.players[1].openValue = 105;
    expect(thresholds(s).normal).toBe(106);
    s.players[2].openValue = 6;
    expect(thresholds(s)).toEqual({ normal: 121, pairs: 7 });
  });
  it('121 açılışı 1 yıldızlıları siler, 2 yıldızlıları silmez', () => {
    const a = cs('H10', 'H11', 'H12', 'H13', 'H1', 'S10', 'S11', 'S12', 'S13', 'S1', 'D10', 'C10', 'H10'); // 51+51+30 = 132
    const s = setup([[...a, ...fill(2)], fill(14), fill(14)]);
    Object.assign(s.players[1], { opened: 'normal', openValue: 101, stars: 1 });
    Object.assign(s.players[2], { opened: 'normal', openValue: 125, stars: 2 });
    // eşik 126 → 132 yeterli
    const r = apply(s, 0, { type: 'open', groups: [ids(a.slice(0, 5)), ids(a.slice(5, 10)), ids(a.slice(10))] });
    expect(r.players[0].stars).toBe(2);
    expect(r.players[1].stars).toBe(0);
    expect(r.players[2].stars).toBe(2);
  });
  it('yerden alan açmamış oyuncu açmadan bitiremez; Çifte Gitçi muaf', () => {
    const s = setup([fill(14), fill(14)], { phase: 'draw' });
    s.discard = [c('H5')]; s.discardBy = 1;
    const t = apply(s, 0, { type: 'take' });
    expect(() => apply(t, 0, { type: 'discard', cardId: t.players[0].hand[0].id })).toThrow(/açmalısınız/);
    const u = apply(t, 0, { type: 'undoTake' });
    expect(u.turn.phase).toBe('draw');
    const t2 = apply(s, 0, { type: 'take', declareCift: true });
    const after = apply(t2, 0, { type: 'discard', cardId: t2.players[0].hand[0].id });
    expect(after.current).toBe(1);
  });
  it('yerden alınan kart geri atılamaz, atılan joker alınamaz', () => {
    const s = setup([fill(14), fill(14)], { phase: 'draw' });
    s.discard = [c('H5')]; s.discardBy = 1;
    const t = apply(s, 0, { type: 'take', declareCift: true });
    expect(() => apply(t, 0, { type: 'discard', cardId: t.turn.taken! })).toThrow(/geri atamazsınız/);
    const s2 = setup([fill(14), fill(14)], { phase: 'draw' });
    s2.discard = [c('JK')]; s2.discardBy = 1; s2.deadJoker = true;
    expect(checkTake(s2, 0).allowed).toBe(false);
  });
  it('normal açan çift ekleyemez, çift açan per ekleyemez', () => {
    const s = setup([cs('H5', 'H6', 'H7', 'S3', 'S3', 'S2'), fill(14)]);
    s.players[0].opened = 'normal'; s.players[0].openValue = 80;
    expect(() => apply(s, 0, { type: 'meld', groups: [ids(s.players[0].hand.slice(3, 5))] })).toThrow();
    s.players[0].opened = 'pairs';
    expect(() => apply(s, 0, { type: 'meld', groups: [ids(s.players[0].hand.slice(0, 3))] })).toThrow();
  });
  it('açmamış oyuncu işleyemez ve joker alamaz', () => {
    const s = setup([cs('C4', 'S2', 'S3'), fill(14)]);
    s.melds = [{ id: 1, owner: 1, kind: 'run', cards: cs('C3', 'JK', 'C5') }];
    expect(() => apply(s, 0, { type: 'swapJoker', meldId: 1, cardId: s.players[0].hand[0].id })).toThrow(/açmış/);
    s.players[0].opened = 'normal';
    const r = apply(s, 0, { type: 'swapJoker', meldId: 1, cardId: s.players[0].hand[0].id });
    expect(r.players[0].hand.some((x) => x.joker)).toBe(true);
    expect(r.melds[0].cards.every((x) => !x.joker)).toBe(true);
  });
});

describe('Çifte Git', () => {
  it('önceki oyuncu açmamışsa izin sorulur; Çifte Git ise alan da demeli', () => {
    const s = setup([fill(14), fill(14)], { phase: 'draw' });
    s.discard = [c('H5')]; s.discardBy = 1;
    expect(checkTake(s, 0)).toMatchObject({ allowed: true, askPrevious: 1 });
    const s2 = apply(s, 1, { type: 'declareCift' });
    expect(checkTake(s2, 0)).toMatchObject({ allowed: true, needsCift: true });
    expect(() => apply(s2, 0, { type: 'take' })).toThrow(/Çifte Git/);
    s2.players[0].opened = 'normal';
    expect(checkTake(s2, 0).allowed).toBe(false);
  });
  it('önceki oyuncu normal açtıysa soru yok', () => {
    const s = setup([fill(14), fill(14)], { phase: 'draw' });
    s.discard = [c('H5')]; s.discardBy = 1; s.players[1].opened = 'normal';
    expect(checkTake(s, 0).askPrevious).toBeNull();
  });
  it('Çifte Git deyip normal açma: kartlar elde kalır, 202', () => {
    const a = cs('H11', 'H12', 'H13', 'S9', 'D9', 'C9', 'D4', 'D5', 'D6');
    const s = setup([[...a, ...fill(3)], fill(14)]);
    s.players[0].cift = true;
    const r = apply(s, 0, { type: 'open', groups: [ids(a.slice(0, 3)), ids(a.slice(3, 6)), ids(a.slice(6))] });
    expect(r.players[0].opened).toBe('none');
    expect(r.players[0].hand.length).toBe(12);
    expect(r.players[0].wrongOpen).toBe(true);
  });
});

describe('ceza tablosu', () => {
  const P = (o: Partial<Player>): Player => ({
    id: 'x', name: 'x', isBot: false, hand: cs('H5', 'S5'), opened: 'none', openValue: 0, cift: false,
    wrongOpen: false, stars: 0, starsDeleted: false, immediate: 0, ...o,
  });
  const ctx = (winnerOpened: 'normal' | 'pairs' | 'none', jokerFinish: boolean) => ({ winner: 9, winnerOpened, jokerFinish });
  // K = 10
  const rows: [string, Partial<Player>, number[]][] = [
    ['açmamış', {}, [101, 202, 202, 404]],
    ['Çifte Git, açamamış', { cift: true }, [202, 404, 202, 404]],
    ['normal açmış', { opened: 'normal' }, [10, 20, 20, 40]],
    ['çift açmış', { opened: 'pairs', cift: true }, [20, 40, 20, 40]],
  ];
  for (const [name, o, exp] of rows) {
    it(name, () => {
      const p = P(o);
      expect([
        handPenalty(p, false, ctx('normal', false)),
        handPenalty(p, false, ctx('normal', true)),
        handPenalty(p, false, ctx('pairs', false)),
        handPenalty(p, false, ctx('pairs', true)),
      ]).toEqual(exp);
    });
  }
  it('deste bitti: çarpansız', () => {
    const d = { winner: null, winnerOpened: 'none' as const, jokerFinish: false };
    expect(handPenalty(P({}), false, d)).toBe(101);
    expect(handPenalty(P({ cift: true }), false, d)).toBe(202);
    expect(handPenalty(P({ opened: 'normal' }), false, d)).toBe(10);
    expect(handPenalty(P({ opened: 'pairs' }), false, d)).toBe(20);
  });
  it('elde joker: açmış 71, çift açmış (71+K)×2, açmamış yalnızca 101', () => {
    const d = { winner: null, winnerOpened: 'none' as const, jokerFinish: false };
    expect(handPenalty(P({ opened: 'normal', hand: cs('JK', 'H5') }), false, d)).toBe(76);
    expect(handPenalty(P({ opened: 'pairs', hand: cs('JK', 'H5') }), false, d)).toBe(152);
    expect(handPenalty(P({ hand: cs('JK', 'H5') }), false, d)).toBe(101);
  });
  it('As elde 11', () => {
    const d = { winner: null, winnerOpened: 'none' as const, jokerFinish: false };
    expect(handPenalty(P({ opened: 'normal', hand: cs('H1') }), false, d)).toBe(11);
  });
  it('Çifte Git yanlış açma: açamazsa 202 / jokerle 404; çift açıp bitiremezse 202 + K×2', () => {
    expect(handPenalty(P({ cift: true, wrongOpen: true }), false, ctx('normal', false))).toBe(202);
    expect(handPenalty(P({ cift: true, wrongOpen: true }), false, ctx('normal', true))).toBe(404);
    expect(handPenalty(P({ cift: true, wrongOpen: true, opened: 'pairs' }), false, ctx('normal', false))).toBe(222);
  });
  it('anında ceza (joker atma 71) çarpılmaz', () => {
    expect(handPenalty(P({ opened: 'normal', immediate: 71 }), false, ctx('normal', true))).toBe(20 + 71);
  });
});

describe('akış', () => {
  it('oyun ortasında joker atma +71 ve sonraki oyuncu alamaz', () => {
    const s = setup([cs('JK', 'H5', 'H6'), fill(14)]);
    const r = apply(s, 0, { type: 'discard', cardId: s.players[0].hand[0].id });
    expect(r.players[0].immediate).toBe(71);
    expect(checkTake(r, 1).allowed).toBe(false);
  });
  it('son kart joker → jokerle bitiş, rakiplere ×2', () => {
    const s = setup([cs('JK'), cs('H5', 'S5')]);
    s.players[0].opened = 'normal'; s.players[1].opened = 'normal';
    const r = apply(s, 0, { type: 'discard', cardId: s.players[0].hand[0].id });
    expect(r.phase).toBe('handOver');
    expect(r.history[0]).toMatchObject({ winner: 0, jokerFinish: true, penalties: [0, 20] });
  });
  it('deste bitince son çeken atar ve el biter', () => {
    const s = setup([cs('H5', 'S9'), fill(14)], { deck: 0 });
    const r = apply(s, 0, { type: 'discard', cardId: s.players[0].hand[0].id });
    expect(r.phase).toBe('handOver');
    expect(r.history[0].winner).toBeNull();
  });
  it('son kart pere işlenerek bitirilemez', () => {
    const s = setup([cs('C6'), fill(14)]);
    s.players[0].opened = 'normal';
    s.melds = [{ id: 1, owner: 1, kind: 'run', cards: cs('C3', 'C4', 'C5') }];
    expect(() => apply(s, 0, { type: 'layoff', meldId: 1, cardId: s.players[0].hand[0].id })).toThrow(/en az bir kart/);
  });
  it('elden bitme: yükselen baraj yok, 71 yeter', () => {
    // 30 + 27 + 22 + 18 = 97 puan, 14 kart + atılacak 1 kart
    const a = cs('H11', 'H12', 'H13', 'S9', 'D9', 'C9', 'D4', 'D5', 'D6', 'D7', 'S3', 'S4', 'S5', 'S6', 'H2');
    const groups = [ids(a.slice(0, 3)), ids(a.slice(3, 6)), ids(a.slice(6, 10)), ids(a.slice(10, 14))];
    const mk = () => {
      const s = setup([a.map((x) => ({ ...x })), fill(14)]);
      s.players[1].opened = 'normal'; s.players[1].openValue = 115; // eşik 116
      return s;
    };
    // elden değil (5 kart kalıyor): 79 < 116 → reddedilir
    expect(() => apply(mk(), 0, { type: 'open', groups: groups.slice(0, 3) })).toThrow(/116/);
    // elden (1 kart kalıyor): 97 ≥ 71 → kabul, sonra atınca el biter
    const r = apply(mk(), 0, { type: 'open', groups });
    expect(r.players[0].hand.length).toBe(1);
    const done = apply(r, 0, { type: 'discard', cardId: r.players[0].hand[0].id });
    expect(done.history[0].winner).toBe(0);
  });
});

describe('skor', () => {
  it('final formülü örnekleri', () => {
    expect(1200 - 5 * 101).toBe(695);
    expect(1500 - 10 * 101).toBe(490);
    expect(900 - 3 * 101).toBe(597);
  });
  it('11 elde eşitlik → 2 el daha', () => {
    const s = setup([cs('H5'), cs('H5')]);
    s.handNo = 11;
    s.history = Array.from({ length: 10 }, (_, i) => ({ hand: i + 1, winner: 0, jokerFinish: false, pairFinish: false, penalties: [0, 0], stars: [0, 0], noOpenDeckEnd: false }));
    s.players[0].opened = 'normal'; s.players[1].opened = 'normal';
    s.players[1].hand = cs('H5'); // bitirmeyen oyuncu 5 ceza
    s.history[0].penalties = [5, 0];
    const r = apply(s, 0, { type: 'discard', cardId: s.players[0].hand[0].id });
    expect(finalScores(r).map((f) => f.final)).toEqual([5, 5]);
    expect(r.targetHands).toBe(13);
    expect(r.phase).toBe('handOver');
  });
  it('ilk iki el kimse açamadan deste bitince oyun yeniden başlar', () => {
    let s = setup([cs('H5', 'S9'), fill(14)], { deck: 0 });
    s = apply(s, 0, { type: 'discard', cardId: s.players[0].hand[0].id });
    s = apply(s, 0, { type: 'nextHand' });
    expect(s.handNo).toBe(2);
    s.deck = []; s.turn.phase = 'play';
    s = apply(s, s.current, { type: 'discard', cardId: s.players[s.current].hand[0].id });
    expect(s.restartPending).toBe(true);
    s = apply(s, 0, { type: 'nextHand' });
    expect(s.handNo).toBe(1);
    expect(s.history.length).toBe(0);
  });
  it('A-A tam seriyle elden açan oyunu kazanır', () => {
    const full = cs('H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11', 'H12', 'H13', 'H1');
    const s = setup([[...full, c('S2')], fill(14)]);
    const r = apply(s, 0, { type: 'open', groups: [ids(full)] });
    expect(r).toMatchObject({ phase: 'gameOver', winner: 0, fullRunWin: true });
  });
});
