import { Card as C, SUIT_SYMBOL, rankLabel, SUIT_NAME } from '../engine/cards';
import { resolveGroup, resolvePair } from '../engine/melds';

type Size = 'xs' | 's' | 'm' | 'l';
const WIDTH: Record<Size, number> = { xs: 30, s: 40, m: 50, l: 72 };
function dims(w: number) {
  return { w, h: Math.round(w * 1.42), fs: Math.max(9, Math.round(w * 0.26)), cs: w >= 38 ? Math.round(w * 0.5) : 0, r: Math.max(4, Math.round(w * 0.12)) };
}

export function cardName(c: C): string {
  return c.joker ? 'Joker' : `${SUIT_NAME[c.suit!]} ${rankLabel(c.rank!)}`;
}

export function CardFace({ card, size = 'm', w }: { card: C; size?: Size; w?: number }) {
  const z = dims(w ?? WIDTH[size]);
  const style = { width: z.w, height: z.h, borderRadius: z.r };
  if (card.joker) {
    return (
      <div className="card joker" style={style} aria-label="Joker">
        <div className="jk" style={{ fontSize: Math.max(7, z.fs - 6) }}>
          <b style={{ fontSize: z.cs || 16 }}>★</b>{z.w >= 36 && 'JOKER'}
        </div>
      </div>
    );
  }
  const red = card.suit === 'H' || card.suit === 'D';
  return (
    <div className={`card ${red ? 'red' : 'black'}`} style={style} aria-label={cardName(card)}>
      <div className="corner" style={{ fontSize: z.fs }}>
        <span>{rankLabel(card.rank!)}</span>
        <span>{SUIT_SYMBOL[card.suit!]}</span>
      </div>
      {z.cs > 0 && <div className="center" style={{ fontSize: z.cs }}>{SUIT_SYMBOL[card.suit!]}</div>}
    </div>
  );
}

export function CardBacks({ count, vertical = false }: { count: number; vertical?: boolean }) {
  const n = Math.min(count, 8);
  return (
    <div style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row' }} aria-label={`${count} kart`}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card-back" style={vertical
          ? { width: 40, height: 28, marginTop: i ? -20 : 0 }
          : { width: 28, height: 40, marginLeft: i ? -18 : 0 }} />
      ))}
    </div>
  );
}

/**
 * Seçilen kartları geçerli bir per sırasına dizer. Oyuncunun seçtiği sıra geçerliyse korunur
 * (jokerin yeri oyuncunun kararıdır); değilse kartlar sıralanır ve jokerler boşluklara yerleştirilir.
 */
export function arrangeGroup(cards: C[]): { cards: C[]; kind: 'run' | 'set' | 'pair'; points: number } | null {
  if (cards.length === 2) {
    const p = resolvePair(cards);
    return p ? { cards, kind: 'pair', points: p.points } : null;
  }
  const direct = resolveGroup(cards);
  if (direct) return { cards, kind: direct.kind as 'run' | 'set', points: direct.points };
  const reals = cards.filter((c) => !c.joker);
  const jokers = cards.filter((c) => c.joker);
  let best: { cards: C[]; kind: 'run' | 'set'; points: number } | null = null;
  for (const aceHigh of [false, true]) {
    const sorted = [...reals].sort((a, b) => val(a, aceHigh) - val(b, aceHigh));
    const tryInsert = (arr: C[], left: C[]) => {
      if (!left.length) {
        const r = resolveGroup(arr);
        if (r && (!best || r.points > best.points)) best = { cards: arr, kind: r.kind as 'run' | 'set', points: r.points };
        return;
      }
      for (let i = 0; i <= arr.length; i++) tryInsert([...arr.slice(0, i), left[0], ...arr.slice(i)], left.slice(1));
    };
    tryInsert(sorted, jokers);
  }
  return best;
}
function val(c: C, aceHigh: boolean) { return c.rank === 1 && aceHigh ? 14 : c.rank!; }

export const AVATAR_COLORS = ['#2D6F8F', '#8F5A2D', '#7A3E78', '#3E7A4E'];
