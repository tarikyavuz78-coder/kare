// Bu dosya src/engine'den otomatik kopyalanır; burada düzenlemeyin.
// 71 – kart tanımları, deste ve yardımcılar
export type Suit = 'H' | 'D' | 'C' | 'S'; // Kupa, Karo, Sinek, Maça
export const SUITS: Suit[] = ['H', 'D', 'C', 'S'];
export const SUIT_NAME: Record<Suit, string> = { H: 'Kupa', D: 'Karo', C: 'Sinek', S: 'Maça' };
export const SUIT_SYMBOL: Record<Suit, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };

export interface Card {
  id: string;
  joker: boolean;
  suit: Suit | null;
  rank: number | null; // 1 = As, 11 = J, 12 = Q, 13 = K
}

/** Açmış oyuncunun elinde kalan ya da oyun ortasında atılan jokerin cezası. */
export const JOKER_PENALTY = 71;

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const copy of ['a', 'b']) {
    for (const s of SUITS) {
      for (let r = 1; r <= 13; r++) deck.push({ id: `${s}${r}${copy}`, joker: false, suit: s, rank: r });
    }
  }
  deck.push({ id: 'JKa', joker: true, suit: null, rank: null });
  deck.push({ id: 'JKb', joker: true, suit: null, rank: null });
  return deck; // 106 kart
}

export function rankLabel(r: number): string {
  return r === 1 || r === 14 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r);
}

export function cardLabel(c: Card): string {
  return c.joker ? 'Joker' : SUIT_SYMBOL[c.suit!] + rankLabel(c.rank!);
}

/** Elde kalan kartın ceza değeri: As 11, J/Q/K 10, joker 71. */
export function penaltyValue(c: Card): number {
  if (c.joker) return JOKER_PENALTY;
  if (c.rank === 1) return 11;
  return Math.min(c.rank!, 10);
}

export function sameFace(a: Card, b: Card): boolean {
  return !a.joker && !b.joker && a.suit === b.suit && a.rank === b.rank;
}

/** Belirlenebilir rastgele sayı üreteci (mulberry32). Durum oyun durumunda saklanır. */
export function nextRandom(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}
