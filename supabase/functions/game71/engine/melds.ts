// Bu dosya src/engine'den otomatik kopyalanır; burada düzenlemeyin.
// 71 – per (seri, grup) ve çift çözümleme
import { Card, Suit } from './cards.ts';

export type MeldKind = 'run' | 'set' | 'pair';

export interface Slot {
  card: Card;
  /** Kartın masadaki karşılığı. Seride değer 1..14 (14 = üst uçtaki As). Grup/çiftte değer = sayı. */
  value: number;
  /** Jokerin yerine geçtiği renk. 3'lü gruptaki jokerde null (eksik iki renkten biri). */
  suit: Suit | null;
}

export interface Resolved {
  kind: MeldKind;
  slots: Slot[];
  points: number;
  suit: Suit | null; // seri ve çift için renk
  rank: number | null; // grup ve çift için sayı
}

function runValuePoints(v: number): number {
  if (v === 1) return 1; // A-2-3 serisinde As
  if (v === 14) return 11; // Q-K-A serisinde As
  return Math.min(v, 10);
}

function rankPoints(r: number): number {
  return r === 1 ? 11 : Math.min(r, 10);
}

/**
 * Seri: aynı renk, ardışık, en az 3 kart. Kartların sırası önemlidir:
 * joker durduğu yerdeki kartın yerine geçer (joker+3+4 → 2).
 * K-A-2 geçersiz. As aynı seride iki uçta yalnızca 14 kartlık tam seride (allowFull) olabilir.
 */
export function resolveRun(cards: Card[], allowFull = false): Resolved | null {
  const n = cards.length;
  if (n < 3 || n > 14) return null;
  const reals = cards.map((c, i) => ({ c, i })).filter((x) => !x.c.joker);
  if (reals.length === 0) return null;
  const suit = reals[0].c.suit!;
  if (reals.some((x) => x.c.suit !== suit)) return null;
  const first = reals[0];
  const options = first.c.rank === 1 ? [1, 14] : [first.c.rank!];
  let best: Resolved | null = null;
  for (const v of options) {
    const start = v - first.i;
    const end = start + n - 1;
    if (start < 1 || end > 14) continue;
    if (start === 1 && end === 14 && !(allowFull && n === 14)) continue;
    let ok = true;
    for (const r of reals) {
      const val = start + r.i;
      const rk = val === 14 ? 1 : val;
      if (rk !== r.c.rank) { ok = false; break; }
    }
    if (!ok) continue;
    const slots = cards.map((c, i) => ({ card: c, value: start + i, suit }));
    const points = slots.reduce((a, s) => a + runValuePoints(s.value), 0);
    if (!best || points > best.points) best = { kind: 'run', slots, points, suit, rank: null };
  }
  return best;
}

/** Grup: aynı sayı, farklı renkler, 3 veya 4 kart. Jokerler eksik renklerin yerine geçer. */
export function resolveSet(cards: Card[]): Resolved | null {
  const n = cards.length;
  if (n < 3 || n > 4) return null;
  const reals = cards.filter((c) => !c.joker);
  if (reals.length === 0) return null;
  const rank = reals[0].rank!;
  if (reals.some((c) => c.rank !== rank)) return null;
  if (new Set(reals.map((c) => c.suit)).size !== reals.length) return null;
  const slots = cards.map((c) => ({ card: c, value: rank, suit: c.joker ? null : c.suit }));
  return { kind: 'set', slots, points: rankPoints(rank) * n, suit: null, rank };
}

/** Çift: renk ve sayısı birebir aynı iki kart. Joker yanındaki kartın aynısı olur. İki joker çift değildir. */
export function resolvePair(cards: Card[]): Resolved | null {
  if (cards.length !== 2) return null;
  const reals = cards.filter((c) => !c.joker);
  if (reals.length === 0) return null;
  if (reals.length === 2 && (reals[0].suit !== reals[1].suit || reals[0].rank !== reals[1].rank)) return null;
  const { suit, rank } = reals[0];
  const slots = cards.map((c) => ({ card: c, value: rank!, suit }));
  return { kind: 'pair', slots, points: rankPoints(rank!) * 2, suit, rank };
}

/**
 * Per çözümleme (seri veya grup). Hem seri hem grup olabilen perlerde
 * (joker+joker+5 gibi) yüksek puan verilen seçilir, eşitse grup.
 */
export function resolveGroup(cards: Card[], allowFull = false): Resolved | null {
  const run = resolveRun(cards, allowFull);
  const set = resolveSet(cards);
  if (run && set) return run.points > set.points ? run : set;
  return run ?? set;
}

/** Masadaki bir peri, sabit türüyle yeniden çözümler (işleme ve joker değiştirme için). */
export function resolveAs(kind: MeldKind, cards: Card[]): Resolved | null {
  if (kind === 'run') return resolveRun(cards, false);
  if (kind === 'set') return resolveSet(cards);
  return resolvePair(cards);
}

export function isFullRun(r: Resolved): boolean {
  return r.kind === 'run' && r.slots.length === 14;
}

/** Bir kartın, perdeki jokerin yerine konup konamayacağını söyler; konabiliyorsa jokerin indeksini döner. */
export function jokerSwapIndex(kind: MeldKind, cards: Card[], card: Card): number {
  if (card.joker) return -1;
  const r = resolveAs(kind, cards);
  if (!r) return -1;
  if (kind === 'run') {
    return r.slots.findIndex((s) => s.card.joker && s.suit === card.suit && (s.value === 14 ? 1 : s.value) === card.rank);
  }
  if (kind === 'set') {
    if (card.rank !== r.rank) return -1;
    const present = new Set(cards.filter((c) => !c.joker).map((c) => c.suit));
    if (present.has(card.suit)) return -1;
    return cards.findIndex((c) => c.joker);
  }
  // pair
  if (card.suit !== r.suit || card.rank !== r.rank) return -1;
  return cards.findIndex((c) => c.joker);
}
