import { describe, it, expect } from 'vitest';
import { COLS, groupsOf, layoutGroups, moveCard, syncRack } from '../src/game71/rack';
import { createGame, apply } from '../src/engine/game';
import { suggestMelds, suggestPairs } from '../src/engine/bot';
import { Card, Suit } from '../src/engine/cards';

let n = 0;
const c = (code: string): Card => (n++, code === 'JK' ? { id: `JK${n}`, joker: true, suit: null, rank: null } : { id: `${code}-${n}`, joker: false, suit: code[0] as Suit, rank: +code.slice(1) });

describe('ıstaka', () => {
  it('gruplar arasında boşluk bırakılır, boşlukla ayrılanlar ayrı grup sayılır', () => {
    const r = layoutGroups([['a', 'b', 'c'], ['d', 'e']], ['f']);
    expect(r.slice(0, 8)).toEqual(['a', 'b', 'c', null, 'd', 'e', null, 'f']);
    expect(groupsOf(r).map((g) => g.ids)).toEqual([['a', 'b', 'c'], ['d', 'e'], ['f']]);
  });
  it('sıra sonu grubu böler', () => {
    const r = Array(28).fill(null); r[COLS - 1] = 'x'; r[COLS] = 'y';
    expect(groupsOf(r).length).toBe(2);
  });
  it('dolu yuvaya bırakınca kartlar kayar', () => {
    const r = layoutGroups([['a', 'b', 'c']], []);
    const m = moveCard(r, 2, 0);
    expect(m.slice(0, 4)).toEqual(['c', 'a', 'b', null]);
  });
  it('yeni kart grupları birleştirmez, tercih edilen yuvaya gelir', () => {
    const r = layoutGroups([['a', 'b', 'c']], []);
    const s1 = syncRack(r, ['a', 'b', 'c', 'n'], null);
    expect(s1.indexOf('n')).toBe(4);
    const s2 = syncRack(r, ['a', 'b', 'c', 'n'], 20);
    expect(s2[20]).toBe('n');
    const s3 = syncRack(r, ['a', 'c'], null);
    expect(s3.slice(0, 3)).toEqual(['a', null, 'c']);
  });
  it('Seri Diz ve Çift Diz önerileri', () => {
    const hand = [c('H2'), c('S2'), c('D2'), c('C2'), c('C3'), c('C4'), c('H9'), c('H9'), c('S5')];
    const melds = suggestMelds(hand);
    expect(melds.flat().length).toBeGreaterThanOrEqual(6);
    const pairs = suggestPairs(hand);
    expect(pairs.length).toBe(1);
  });
  it('her oyuncunun attığı kart kendi yığınına gider, alınınca çıkar', () => {
    let s = createGame(['A', 'B'], { seed: 3 });
    const p = s.current;
    s = apply(s, p, { type: 'draw' });
    s = apply(s, p, { type: 'discard', cardId: s.players[p].hand[0].id });
    expect(s.discardOwners).toEqual([p]);
    const q = s.current;
    s = apply(s, q, { type: 'take', declareCift: true });
    expect(s.discardOwners).toEqual([]);
    s = apply(s, q, { type: 'undoTake' });
    expect(s.discardOwners).toEqual([p]);
  });
});
