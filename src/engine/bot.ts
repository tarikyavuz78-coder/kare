// 71 – orta seviye yapay zekâ
import { Card, penaltyValue } from './cards';
import { resolveGroup, resolvePair, resolveAs, jokerSwapIndex } from './melds';
import { Action, GameState, checkTake, isIslek, thresholds, BASE_NORMAL, BASE_PAIRS, MAX_PAIRS } from './game';

interface Cand { reals: Card[]; jokers: number; order: (Card | null)[]; points: number; }

/** Elden çıkabilecek seri ve grup adayları (jokerler sayı olarak). */
function candidates(hand: Card[]): Cand[] {
  const reals = hand.filter((c) => !c.joker);
  const J = hand.length - reals.length;
  const out: Cand[] = [];
  const push = (order: (Card | null)[]) => {
    const cards = order.map((c) => c ?? ({ id: 'J?', joker: true, suit: null, rank: null } as Card));
    const r = resolveGroup(cards, false);
    if (!r) return;
    const rs = order.filter((c): c is Card => !!c);
    out.push({ reals: rs, jokers: order.length - rs.length, order, points: r.points });
  };
  // seriler
  for (const suit of ['H', 'D', 'C', 'S'] as const) {
    const byVal = new Map<number, Card>();
    for (const c of reals) if (c.suit === suit) {
      if (!byVal.has(c.rank!)) byVal.set(c.rank!, c);
      if (c.rank === 1 && !byVal.has(14)) byVal.set(14, c);
    }
    for (let start = 1; start <= 12; start++) {
      const order: (Card | null)[] = [];
      let used = 0;
      for (let v = start; v <= 14; v++) {
        if (start === 1 && v === 14) break;
        const card = byVal.get(v) ?? null;
        if (!card) used++;
        if (used > J) break;
        // aynı As hem 1 hem 14 olamaz
        if (card && card.rank === 1 && order.includes(card)) break;
        order.push(card);
        if (order.length >= 3 && order.some((x) => x)) push([...order]);
      }
    }
  }
  // gruplar
  const byRank = new Map<number, Card[]>();
  for (const c of reals) {
    const list = byRank.get(c.rank!) ?? [];
    if (!list.some((x) => x.suit === c.suit)) list.push(c);
    byRank.set(c.rank!, list);
  }
  for (const list of byRank.values()) {
    const subsets = (arr: Card[]): Card[][] => arr.reduce<Card[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
    for (const sub of subsets(list)) {
      for (let size = 3; size <= 4; size++) {
        const need = size - sub.length;
        if (sub.length === 0 || need < 0 || need > J) continue;
        push([...sub, ...Array(need).fill(null)]);
      }
    }
  }
  return out;
}

/** Çakışmayan en yüksek puanlı per kombinasyonu. */
function bestCombo(hand: Card[], mustInclude?: string): { melds: (Card | null)[][]; points: number; cards: number } {
  const J = hand.filter((c) => c.joker).length;
  const cands = candidates(hand).sort((a, b) => b.points - a.points);
  let best = { list: [] as Cand[], points: -1 };
  let nodes = 0;
  const used = new Set<string>();
  const dfs = (i: number, jokers: number, list: Cand[], pts: number) => {
    if (++nodes > 40000) return;
    if (pts > best.points && (!mustInclude || list.some((c) => c.reals.some((r) => r.id === mustInclude)))) best = { list: [...list], points: pts };
    for (let k = i; k < cands.length; k++) {
      const c = cands[k];
      if (jokers + c.jokers > J) continue;
      if (c.reals.some((r) => used.has(r.id))) continue;
      c.reals.forEach((r) => used.add(r.id));
      list.push(c);
      dfs(k + 1, jokers + c.jokers, list, pts + c.points);
      list.pop();
      c.reals.forEach((r) => used.delete(r.id));
    }
  };
  dfs(0, 0, [], 0);
  return { melds: best.list.map((c) => c.order), points: Math.max(best.points, 0), cards: best.list.reduce((a, c) => a + c.order.length, 0) };
}

/** Jokerlere gerçek kimlik atayıp kart kimliği gruplarına çevirir. */
function toIds(hand: Card[], melds: (Card | null)[][]): string[][] {
  const jokers = hand.filter((c) => c.joker).map((c) => c.id);
  return melds.map((m) => m.map((c) => (c ? c.id : jokers.shift()!)));
}

function pairGroups(hand: Card[]): string[][] {
  const reals = hand.filter((c) => !c.joker);
  const jokers = hand.filter((c) => c.joker).map((c) => c.id);
  const used = new Set<string>();
  const groups: string[][] = [];
  for (const a of reals) {
    if (used.has(a.id)) continue;
    const b = reals.find((x) => x.id !== a.id && !used.has(x.id) && x.suit === a.suit && x.rank === a.rank);
    if (b) { used.add(a.id); used.add(b.id); groups.push([a.id, b.id]); }
  }
  // jokerleri en yüksek tekli kartlarla eşle
  const singles = reals.filter((x) => !used.has(x.id)).sort((x, y) => penaltyValue(y) - penaltyValue(x));
  for (const j of jokers) { const s = singles.shift(); if (s) groups.push([s.id, j]); }
  return groups;
}

/** Hamle sırası yapay zekâda olduğunda tek bir hamle döner; tur bitene kadar tekrar çağrılır. */
export function botAction(s: GameState, pi: number): Action {
  const me = s.players[pi];
  const th = thresholds(s);

  if (s.turn.phase === 'draw') {
    const chk = checkTake(s, pi);
    const top = s.discard[s.discard.length - 1];
    if (chk.allowed && top && (!chk.needsCift || me.cift) && wantsCard(s, pi, top)) return { type: 'take' };
    return { type: 'draw' };
  }

  // açılış
  if (me.opened === 'none') {
    if (me.cift || s.turn.taken === null) {
      const pairs = pairGroups(me.hand).slice(0, MAX_PAIRS);
      const leavesOne = me.hand.length - pairs.length * 2 === 1;
      if (me.cift && pairs.length >= (leavesOne ? BASE_PAIRS : th.pairs)) return { type: 'open', groups: pairs };
    }
    if (!me.cift) {
      const combo = bestCombo(me.hand, s.turn.takenMustOpen ? s.turn.taken! : undefined);
      let melds = combo.melds;
      if (combo.cards >= me.hand.length) melds = melds.slice(0, -1);
      const points = melds.reduce((a, m) => a + (resolveGroup(m.map((c) => c ?? ({ id: 'J?', joker: true, suit: null, rank: null } as Card)))?.points ?? 0), 0);
      const cardsUsed = melds.reduce((a, m) => a + m.length, 0);
      const min = me.hand.length - cardsUsed === 1 ? BASE_NORMAL : th.normal;
      if (melds.length && points >= min) return { type: 'open', groups: toIds(me.hand, melds) };
      const pairs = pairGroups(me.hand);
      if (pairs.length >= Math.max(th.pairs, 6) && pairs.length <= MAX_PAIRS && me.hand.length - pairs.length * 2 >= 1) return { type: 'open', groups: pairs };
    }
    if (s.turn.taken && (s.turn.takenMustOpen || s.turn.takenMustUse)) return { type: 'undoTake' };
  } else {
    // joker değiştirme
    for (const m of s.melds) {
      if (!m.cards.some((c) => c.joker)) continue;
      for (const c of me.hand) if (!c.joker && jokerSwapIndex(m.kind, m.cards, c) >= 0) return { type: 'swapJoker', meldId: m.id, cardId: c.id };
    }
    // yeni per / çift
    if (me.opened === 'normal') {
      const combo = bestCombo(me.hand, s.turn.takenMustUse ? s.turn.taken! : undefined);
      if (combo.melds.length && combo.cards < me.hand.length) return { type: 'meld', groups: toIds(me.hand, combo.melds) };
    } else {
      const owned = s.melds.filter((m) => m.owner === pi && m.kind === 'pair').length;
      const pairs = pairGroups(me.hand).filter((g) => g.length === 2).slice(0, MAX_PAIRS - owned);
      const realPairs = pairs.filter((g) => g.every((id) => !me.hand.find((c) => c.id === id)!.joker) || me.hand.length - pairs.length * 2 === 1);
      if (realPairs.length && me.hand.length - realPairs.length * 2 >= 1) return { type: 'meld', groups: realPairs };
    }
    // işleme
    if (me.hand.length > 1) {
      const order = [...me.hand].sort((a, b) => Number(a.joker) - Number(b.joker));
      for (const c of order) {
        if (c.joker && me.hand.length > 2) continue; // jokeri bitiş için sakla
        for (const m of s.melds) {
          if (m.kind === 'pair') continue;
          if (resolveAs(m.kind, [...m.cards, c])) return { type: 'layoff', meldId: m.id, cardId: c.id, side: 'right' };
          if (m.kind === 'run' && resolveAs('run', [c, ...m.cards])) return { type: 'layoff', meldId: m.id, cardId: c.id, side: 'left' };
        }
      }
    }
    if (s.turn.takenMustUse) return { type: 'undoTake' };
  }

  return { type: 'discard', cardId: chooseDiscard(s, pi) };
}

function wantsCard(s: GameState, pi: number, card: Card): boolean {
  const me = s.players[pi];
  if (card.joker) return false;
  const hand = [...me.hand, card];
  if (me.cift) return me.hand.some((c) => !c.joker && c.suit === card.suit && c.rank === card.rank);
  if (me.opened === 'none') {
    const th = thresholds(s);
    const combo = bestCombo(hand, card.id);
    return combo.points >= th.normal && combo.cards < hand.length && combo.melds.some((m) => m.some((c) => c?.id === card.id));
  }
  if (me.opened === 'normal') {
    for (const m of s.melds) if (m.kind !== 'pair' && (resolveAs(m.kind, [...m.cards, card]) || (m.kind === 'run' && resolveAs('run', [card, ...m.cards])))) return me.hand.length > 1;
    const combo = bestCombo(hand, card.id);
    return combo.melds.length > 0 && combo.cards < hand.length;
  }
  return false;
}

function chooseDiscard(s: GameState, pi: number): string {
  const me = s.players[pi];
  const pool = me.hand.filter((c) => c.id !== s.turn.taken);
  if (me.hand.length === 1) return me.hand[0].id; // bitiş (joker de olabilir)
  const nonJoker = pool.filter((c) => !c.joker);
  const safe = nonJoker.filter((c) => !isIslek(s, c));
  const list = safe.length ? safe : nonJoker.length ? nonJoker : pool;
  // bir pere yakın olan kartları tut
  const score = (c: Card) => {
    let keep = 0;
    for (const o of me.hand) {
      if (o.id === c.id || o.joker) continue;
      if (o.rank === c.rank && o.suit !== c.suit) keep += 6;
      if (o.suit === c.suit && Math.abs(o.rank! - c.rank!) <= 2) keep += 5;
      if (o.suit === c.suit && o.rank === c.rank && me.cift) keep += 10;
    }
    return penaltyValue(c) - keep;
  };
  return [...list].sort((a, b) => score(b) - score(a))[0].id;
}

/** Önceki oyuncuya sorulan "Çifte Git?" sorusunun yapay zekâ cevabı. */
export function botAnswersCift(s: GameState, pi: number): boolean {
  const me = s.players[pi];
  if (me.opened !== 'none' || me.cift) return false;
  return pairGroups(me.hand).filter((g) => g.length === 2).length >= 5;
}

/** Turun başında yapay zekâ Çifte Git'e karar verir. */
export function botShouldDeclareCift(s: GameState, pi: number): boolean {
  return botAnswersCift(s, pi);
}

export { resolvePair };

/** Seri Diz: elden çıkabilecek en yüksek puanlı per kombinasyonu (kart kimlikleri, sıralı). */
export function suggestMelds(hand: Card[]): string[][] {
  return toIds(hand, bestCombo(hand).melds);
}

/** Çift Diz: birebir aynı kart çiftleri (jokerler en yüksek tekli kartla eşleşir). */
export function suggestPairs(hand: Card[]): string[][] {
  return pairGroups(hand).filter((g) => g.length === 2);
}
