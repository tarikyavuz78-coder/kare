import { Fragment, ReactNode, useEffect, useMemo, useRef, useState, PointerEvent as RPointerEvent, KeyboardEvent as RKeyboardEvent } from 'react';
import { Card as C, SUIT_SYMBOL, rankLabel } from '../engine/cards';
import { Action, GameState, Player, finalScores, thresholds } from '../engine/game';
import { jokerSwapIndex, resolveAs, resolveGroup, resolvePair } from '../engine/melds';
import { suggestMelds, suggestPairs } from '../engine/bot';
import { AVATAR_COLORS, cardName } from './ui';
import { COLS, ROWS, RackSlots, groupsOf, layoutGroups, moveCard, syncRack } from './rack';

export type TableView = Omit<GameState, 'players'> & { players: (Player & { handCount?: number })[]; deckCount?: number };

interface Props {
  s: TableView;
  me: number;
  act: (a: Action) => void;
  takeRequest: () => void;
  onExit: () => void;
  title: string;
  canAdvance?: boolean;
  onNewGame?: () => void;
  headerExtra?: ReactNode;
  sideExtra?: ReactNode;
  waitingText?: string | null;
  /** Süre dolunca çağrılır: en soldaki kartın kimliği. */
  onTimeout?: (cardId: string | null) => void;
  turnStartedAt?: number | null;
  paused?: boolean;
  leaveText?: string;
}

type DragSrc = { kind: 'rack'; id: string } | { kind: 'deck' } | { kind: 'pile' };
type Seat = 'left' | 'top' | 'right';

const handCount = (p: Player & { handCount?: number }) => p.handCount ?? p.hand.length;

function useCompact() {
  const q = '(max-height: 520px)';
  const [c, setC] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setC(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return c;
}

function useWidth(ref: React.RefObject<HTMLElement>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Istaka taşı görünümünde kart: ortada büyük sayı, altında renk simgesi. */
export function Tile({ card, w }: { card: C; w: number }) {
  const h = Math.round(w * 1.3);
  const style = { width: w, height: h, borderRadius: Math.max(4, Math.round(w * 0.12)) };
  if (card.joker) {
    return (
      <div className="tile joker" style={style} aria-label="Joker">
        <span className="tr" style={{ fontSize: Math.round(w * 0.55) }}>★</span>
        {w >= 34 && <span className="tj" style={{ fontSize: Math.max(7, Math.round(w * 0.18)) }}>JOKER</span>}
      </div>
    );
  }
  const red = card.suit === 'H' || card.suit === 'D';
  return (
    <div className={`tile ${red ? 'red' : 'black'}`} style={style} aria-label={cardName(card)}>
      <span className="tr" style={{ fontSize: Math.round(w * (card.rank === 10 ? 0.44 : 0.52)) }}>{rankLabel(card.rank!)}</span>
      <span className="ts" style={{ fontSize: Math.round(w * 0.36) }}>{SUIT_SYMBOL[card.suit!]}</span>
    </div>
  );
}

function pileTop(s: TableView, i: number): C | null {
  const owners = s.discardOwners;
  if (owners && owners.length === s.discard.length) {
    for (let k = s.discard.length - 1; k >= 0; k--) if (owners[k] === i) return s.discard[k];
    return null;
  }
  return s.discardBy === i ? s.discard[s.discard.length - 1] ?? null : null;
}

const SUIT_ORDER = { H: 0, D: 1, C: 2, S: 3 } as const;
function sortIds(cards: C[]): string[] {
  return [...cards].sort((a, b) => {
    if (a.joker !== b.joker) return a.joker ? 1 : -1;
    if (a.joker) return 0;
    return SUIT_ORDER[a.suit!] - SUIT_ORDER[b.suit!] || a.rank! - b.rank!;
  }).map((c) => c.id);
}
function autoSeri(hand: C[]): RackSlots {
  const groups = suggestMelds(hand);
  const used = new Set(groups.flat());
  return layoutGroups(groups, sortIds(hand.filter((c) => !used.has(c.id))));
}
function autoCift(hand: C[]): RackSlots {
  const groups = suggestPairs(hand);
  const used = new Set(groups.flat());
  return layoutGroups(groups, sortIds(hand.filter((c) => !used.has(c.id))));
}

export default function Table71({ s, me, act, takeRequest, onExit, title, canAdvance = true, onNewGame, headerExtra, sideExtra, waitingText, onTimeout, turnStartedAt, paused, leaveText }: Props) {
  const mine = s.players[me];
  const compact = useCompact();
  const n = s.players.length;
  const prev = (me - 1 + n) % n;
  const myTurn = s.phase === 'playing' && s.current === me;
  const canDraw = myTurn && s.turn.phase === 'draw';
  const canPlay = myTurn && s.turn.phase === 'play';

  const [rack, setRack] = useState<RackSlots>(() => autoSeri(mine.hand));
  const handNoRef = useRef(s.handNo);
  const pendingSlot = useRef<number | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ src: DragSrc; card: C | null; x: number; y: number } | null>(null);
  const pending = useRef<{ src: DragSrc; card: C | null; x0: number; y0: number; moved: boolean } | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { if (!mine.cift) setShowAll(false); }, [mine.cift, s.handNo]);
  const [modal, setModal] = useState<null | 'cift' | 'leave' | 'score' | 'chat'>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useWidth(rootRef);

  const handIds = mine.hand.map((c) => c.id).join(',');
  useEffect(() => {
    if (handNoRef.current !== s.handNo) { handNoRef.current = s.handNo; setRack(autoSeri(mine.hand)); }
    else {
      const prefer = pendingSlot.current;
      const ids = mine.hand.map((c) => c.id);
      setRack((r) => syncRack(r, ids, prefer));
    }
    pendingSlot.current = null;
    setSelId((id) => (id && mine.hand.some((c) => c.id === id) ? id : null));
  }, [handIds, s.handNo]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(mine.hand.map((c) => [c.id, c])), [mine.hand]);
  const segs = useMemo(() => groupsOf(rack).map((g) => {
    const ids = g.ids.filter((id) => byId.has(id));
    const cards = ids.map((id) => byId.get(id)!);
    let kind: 'meld' | 'pair' | null = null;
    let pts = 0;
    if (cards.length === 2 && resolvePair(cards)) kind = 'pair';
    else if (cards.length >= 3) { const r = resolveGroup(cards, true); if (r) { kind = 'meld'; pts = r.points; } }
    return { ...g, ids, kind, pts };
  }), [rack, byId]);
  const meldSegs = segs.filter((g) => g.kind === 'meld');
  const pairSegs = segs.filter((g) => g.kind === 'pair');
  const perPts = meldSegs.reduce((a, g) => a + g.pts, 0);
  const pairCount = pairSegs.length;
  const th = thresholds(s as GameState);

  // ölçüler: ıstaka iki yanındaki büyük düğmelerle tüm genişliği kaplar
  const bigBtn = compact ? 70 : 120;
  const cw = width ? Math.max(28, Math.min(compact ? 40 : 74, Math.floor((width - bigBtn - 16 - 16 - 39) / 14))) : compact ? 40 : 64;
  const ch = Math.round(cw * 1.3);
  const labelH = compact ? 11 : 15;
  const pileW = compact ? 30 : 46;
  const meldW = compact ? 24 : 36;

  const leftTop = pileTop(s, prev);
  const lastDiscard = s.discard[s.discard.length - 1];
  const canTake = canDraw && !!leftTop && s.discardBy === prev && lastDiscard?.id === leftTop.id && !s.deadJoker;

  // oturma düzeni: ben altta, sıradaki sağda, önceki solda
  const seatOf: Partial<Record<Seat, number>> = {};
  if (n === 2) seatOf.top = (me + 1) % n;
  if (n === 3) { seatOf.right = (me + 1) % n; seatOf.left = (me + 2) % n; }
  if (n === 4) { seatOf.right = (me + 1) % n; seatOf.top = (me + 2) % n; seatOf.left = (me + 3) % n; }

  // ---------------------------------------------------------------- 1 dakikalık hamle süresi
  const TURN_MS = 60000;
  const [localStart, setLocalStart] = useState(() => Date.now());
  useEffect(() => { setLocalStart(Date.now()); }, [s.turnNo, s.current, s.handNo, s.phase]);
  const start = turnStartedAt ?? localStart;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (s.phase !== 'playing') return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [s.phase]);
  const secondsLeft = Math.max(0, Math.ceil((TURN_MS - (now - start)) / 1000));
  const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const firedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!onTimeout || !myTurn || paused || drag || now - start < TURN_MS || firedRef.current === start) return;
    firedRef.current = start;
    const leftmost = rack.find((id) => !!id && id !== s.turn.taken && byId.has(id)) ?? null;
    setSelId(null);
    onTimeout(leftmost);
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps
  const askLeave = () => (s.phase === 'gameOver' ? onExit() : setModal('leave'));

  // ---------------------------------------------------------------- hamleler
  const draw = () => act({ type: 'draw' });
  const take = () => takeRequest();
  const discard = (id: string) => { act({ type: 'discard', cardId: id }); setSelId(null); };
  const openNormal = () => act({ type: 'open', groups: meldSegs.map((g) => g.ids) });
  const openPairs = () => act({ type: 'open', groups: pairSegs.map((g) => g.ids) });
  const meldGroups = (mine.opened === 'pairs' ? pairSegs : meldSegs).map((g) => g.ids);
  const meldMore = () => act({ type: 'meld', groups: meldGroups });

  const playOnMeld = (meldId: number, cardId: string, x?: number, el?: HTMLElement) => {
    const m = s.melds.find((mm) => mm.id === meldId);
    const card = byId.get(cardId);
    if (!m || !card) return;
    if (jokerSwapIndex(m.kind, m.cards, card) >= 0) { act({ type: 'swapJoker', meldId, cardId }); setSelId(null); return; }
    let side: 'left' | 'right' = 'right';
    if (m.kind === 'run') {
      const okR = !!resolveAs('run', [...m.cards, card]);
      const okL = !!resolveAs('run', [card, ...m.cards]);
      let wantLeft = false;
      if (el && x !== undefined) { const r = el.getBoundingClientRect(); wantLeft = x < r.left + r.width / 2; }
      side = wantLeft ? (okL ? 'left' : 'right') : okR ? 'right' : okL ? 'left' : 'right';
    }
    act({ type: 'layoff', meldId, cardId, side });
    setSelId(null);
  };

  const activeCard = drag?.src.kind === 'rack' ? byId.get(drag.src.id) : selId ? byId.get(selId) : undefined;
  const targetFor = (m: TableView['melds'][number]) => {
    if (!canPlay || mine.opened === 'none' || !activeCard) return false;
    if (jokerSwapIndex(m.kind, m.cards, activeCard) >= 0) return true;
    if (m.kind === 'pair') return false;
    return !!resolveAs(m.kind, [...m.cards, activeCard]) || (m.kind === 'run' && !!resolveAs('run', [activeCard, ...m.cards]));
  };

  // ---------------------------------------------------------------- sürükle-bırak ve dokunma
  const tap = (src: DragSrc) => {
    if (src.kind === 'rack') setSelId((cur) => (cur === src.id ? null : src.id));
    else if (src.kind === 'deck' && canDraw) draw();
    else if (src.kind === 'pile' && canTake) take();
  };
  const drop = (src: DragSrc, el: HTMLElement | null, x: number) => {
    const zone = el?.dataset.drop;
    if (src.kind === 'rack') {
      if (zone === 'slot') { const to = Number(el!.dataset.slot); setRack((r) => moveCard(r, r.indexOf(src.id), to)); }
      else if (zone === 'discard') discard(src.id);
      else if (zone === 'meld') playOnMeld(Number(el!.dataset.meld), src.id, x, el!);
      return;
    }
    if (zone !== 'slot' && zone !== 'rack') return;
    if (zone === 'slot') pendingSlot.current = Number(el!.dataset.slot);
    if (src.kind === 'deck' && canDraw) draw();
    if (src.kind === 'pile' && canTake) take();
  };
  const begin = (src: DragSrc, card: C | null) => (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = { src, card, x0: e.clientX, y0: e.clientY, moved: false };
    pending.current = p;
    const move = (ev: PointerEvent) => {
      if (pending.current !== p) return;
      if (!p.moved && Math.hypot(ev.clientX - p.x0, ev.clientY - p.y0) < 6) return;
      p.moved = true;
      setDrag({ src, card, x: ev.clientX, y: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (pending.current !== p) return;
      pending.current = null;
      setDrag(null);
      if (ev.type === 'pointercancel') return;
      if (!p.moved) { tap(src); return; }
      const hit = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      drop(src, hit?.closest<HTMLElement>('[data-drop]') ?? null, ev.clientX);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const onKey = (src: DragSrc) => (e: RKeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(src); }
  };

  // ---------------------------------------------------------------- parçalar
  const scores = finalScores(s as GameState);
  const lastHand = s.history[s.history.length - 1];
  const seqMelds = s.melds.filter((m) => m.kind !== 'pair');
  const pairMelds = s.melds.filter((m) => m.kind === 'pair');
  const owners = (list: typeof s.melds) => s.players.map((p, i) => ({ p, i, melds: list.filter((m) => m.owner === i) })).filter((x) => x.melds.length);

  const meldEl = (m: TableView['melds'][number]) => {
    const t = targetFor(m);
    return (
      <div key={m.id} className={`meld ${t ? 'target' : ''}`} data-drop="meld" data-meld={m.id}
        onClick={t && selId ? () => playOnMeld(m.id, selId) : undefined}
        role={t && selId ? 'button' : undefined} aria-label={t && selId ? 'Seçili kartı buraya işle' : undefined}>
        {m.cards.map((c) => <Tile key={c.id} card={c} w={meldW} />)}
      </div>
    );
  };

  const chips = (p: Player) => (
    <>
      {p.opened === 'normal' && <span className="pchip open">Açtı {p.openValue}</span>}
      {p.opened === 'pairs' && <span className="pchip pair">{p.openValue} çift</span>}
      {p.cift && p.opened === 'none' && <span className="pchip cift">Çifte Git</span>}
      {p.stars > 0 && <span className="pchip star">★{p.stars}</span>}
      {p.starsDeleted && <span className="pchip del">★ silindi</span>}
    </>
  );

  const plate = (i: number, orient: 'v' | 'h') => {
    const p = s.players[i];
    const active = s.current === i && s.phase === 'playing';
    return (
      <div className={`plate ${orient} ${active ? 'active' : ''}`}>
        <div className="avatar" style={{ background: AVATAR_COLORS[i % 4] }}>{p.name[0]}</div>
        <div className="pname">{p.name}{p.isBot ? ' · Bot' : ''}</div>
        <div className="pchips">{chips(p)}</div>
        <div className="pcount">{handCount(p)} kart</div>
        {active && <div className="ptimer">{turnStartedAt != null || i === me ? clock : '…'}</div>}
      </div>
    );
  };

  const pileCards = (i: number) => {
    const owners = s.discardOwners;
    if (owners && owners.length === s.discard.length) return s.discard.filter((_, k) => owners[k] === i);
    const t = pileTop(s, i);
    return t ? [t] : [];
  };
  const stackW = compact ? 26 : 40;
  const stackH = Math.round(stackW * 1.3);
  const step = Math.round(stackH * 0.42);
  const pile = (i: number | null, kind: 'take' | 'mine' | 'show') => {
    const cards = i === null ? [] : pileCards(i);
    const top = cards[cards.length - 1] ?? null;
    const hot = kind === 'take' ? canTake : kind === 'mine' ? canPlay : false;
    const label = kind === 'mine' ? 'At' : i !== null ? s.players[i].name : '';
    const onWell = () => {
      if (kind === 'mine' && selId && canPlay) { discard(selId); return; }
      if (mine.cift && s.discard.length) setShowAll((v) => !v);
    };
    const older = cards.slice(0, -1).reverse();
    return (
      <div className={`pile ${hot ? 'hot' : ''}`}>
        <div className="well pstack" data-drop={kind === 'mine' ? 'discard' : undefined} style={{ width: stackW + 8, minHeight: stackH + 6 }}
          onClick={onWell}
          aria-label={kind === 'mine' ? 'Kart atmak için buraya sürükle' : `${label} adlı oyuncunun attığı kartlar`}>
          {top && (kind === 'take' && canTake ? (
            <div className="rcard" role="button" tabIndex={0} aria-label={`Yerden al: ${cardName(top)}`} style={{ zIndex: cards.length }}
              onPointerDown={begin({ kind: 'pile' }, top)} onKeyDown={onKey({ kind: 'pile' })} onClick={(e) => e.stopPropagation()}>
              <Tile card={top} w={stackW} />
            </div>
          ) : <div style={{ zIndex: cards.length }}><Tile card={top} w={stackW} /></div>)}
          {older.map((c, k) => (
            <div key={c.id} style={{ marginBottom: step - stackH, zIndex: cards.length - 1 - k }}><Tile card={c} w={stackW} /></div>
          ))}
        </div>
        {label && <span className="pile-label">{label}{cards.length > 1 ? ` · ${cards.length}` : ''}</span>}
      </div>
    );
  };

  const actions = (
    <>
      {canPlay && mine.opened === 'none' && meldSegs.length > 0 && <button className="abtn gold" onClick={openNormal}>Per Aç</button>}
      {canPlay && mine.opened === 'none' && pairCount > 0 && <button className="abtn pair" onClick={openPairs}>Çift Aç</button>}
      {canPlay && mine.opened !== 'none' && meldGroups.length > 0 && <button className="abtn gold" onClick={meldMore}>{mine.opened === 'pairs' ? 'Çift İndir' : 'Per İndir'}</button>}
      {canPlay && s.turn.taken && <button className="abtn" onClick={() => act({ type: 'undoTake' })}>Geri Al</button>}
      {canPlay && selId && <button className="abtn" onClick={() => discard(selId)}>Kartı At</button>}
      {s.phase === 'playing' && mine.opened === 'none' && !mine.cift && <button className="abtn cift" onClick={() => setModal('cift')}>Çifte Git</button>}
    </>
  );

  const corner = (pos: 'tl' | 'tr' | 'bl' | 'br') => {
    if (pos === 'bl') return pile(prev, 'take');
    if (pos === 'br') return pile(me, 'mine');
    if (pos === 'tl') return seatOf.top !== undefined && n === 4 ? pile(seatOf.top, 'show') : null;
    return seatOf.right !== undefined ? pile(seatOf.right, 'show') : null;
  };

  return (
    <div className="g71" ref={rootRef}>
      <div className="rotate-hint">Oynamak için telefonunuzu yatay çevirin.</div>

      <header className="g-top">
        <div className="g-top-l">
          <button className="g-logo" onClick={askLeave} aria-label="Oyundan ayrıl">71</button>
          {headerExtra}
          <div className={`g-clock ${myTurn && secondsLeft <= 10 ? 'urgent' : ''}`} aria-label="Hamle süresi">
            <span aria-hidden="true">⏱</span> {myTurn ? clock : '–'}
          </div>
        </div>
        <div className="g-top-c">{seatOf.top !== undefined && plate(seatOf.top, 'h')}</div>
        <div className="g-top-r">
          <button className="g-ibtn" onClick={() => setModal('score')}>Skor</button>
          {sideExtra && <button className="g-ibtn" onClick={() => setModal('chat')}>Sohbet</button>}
          <button className="g-ibtn leave-btn" onClick={askLeave}>Oyundan Ayrıl</button>
        </div>
      </header>

      <div className="g-mid">
        <div className="g-side">
          {corner('tl')}
          <div className="g-side-plate">{seatOf.left !== undefined && plate(seatOf.left, 'h')}</div>
          {corner('bl')}
        </div>

        <section className="g-table" aria-label="Masa">
          {seqMelds.length === 0 && <span className="g-empty">Henüz kimse açmadı</span>}
          <div className="meld-flow">
            {owners(seqMelds).map(({ p, i, melds }) => (
              <Fragment key={i}>
                <span className="meld-owner">{i === me ? 'Sen' : p.name}</span>
                {melds.map(meldEl)}
              </Fragment>
            ))}
          </div>
        </section>

        <aside className="g-info">
          <div className="ibox">El {s.handNo}/{s.targetHands}</div>
          <div className="ibox">Baraj {th.normal}</div>
          <div className="ibox">{th.pairs} çift</div>
          <div className="ibox dim">{title}</div>
          <div className={`deck ${canDraw ? 'hot' : ''}`} role="button" tabIndex={canDraw ? 0 : -1} aria-label="Desteden kart çek"
            onPointerDown={canDraw ? begin({ kind: 'deck' }, null) : undefined} onKeyDown={onKey({ kind: 'deck' })}>
            <div className="deck-tile" style={{ width: pileW + 8, height: Math.round((pileW + 8) * 1.3) }}>
              <span>{s.deckCount ?? s.deck.length}</span>
            </div>
          </div>
        </aside>

        <section className="g-pairs" aria-label="Çiftler">
          {pairMelds.length === 0 && <span className="g-empty small">Çiftler</span>}
          {owners(pairMelds).map(({ p, i, melds }) => (
            <div key={i} className="pair-group">
              <span className="meld-owner">{i === me ? 'Sen' : p.name}</span>
              <div className="pair-list">{melds.map(meldEl)}</div>
            </div>
          ))}
        </section>

        <div className="g-side">
          {corner('tr')}
          <div className="g-side-plate">{seatOf.right !== undefined && plate(seatOf.right, 'h')}</div>
          {corner('br')}
        </div>
      </div>

      <div className="g-bar">
        <div className="g-actions">{actions}</div>
        <div className={`me-plate ${myTurn ? 'active' : ''}`}>
          <div className="avatar" style={{ background: AVATAR_COLORS[me % 4] }}>{mine.name[0]}</div>
          <span className="pname">{mine.name}</span>
          {chips(mine)}
          {myTurn ? <span className={`ptimer ${secondsLeft <= 10 ? 'urgent' : ''}`}>Sıra sende · {clock}</span> : waitingText ? <span className="pwait">{waitingText}</span> : null}
        </div>
        <div className="per-bubble" aria-live="polite">
          <span className={perPts >= th.normal ? 'ok' : ''}>{perPts}</span>
          <small>per</small>
          <span className={pairCount >= th.pairs ? 'ok' : ''}>{pairCount}</span>
          <small>çift</small>
        </div>
      </div>

      <div className="g-rack-row">
        <div className="rack-wrap">
          <div className="rack" data-drop="rack" style={{ gridTemplateColumns: `repeat(${COLS}, ${cw}px)`, gridTemplateRows: Array(ROWS).fill(`${ch}px ${labelH}px`).join(' ') }}>
            {Array.from({ length: ROWS }, (_, row) => (
              <Fragment key={row}>
                {Array.from({ length: COLS }, (_, col) => {
                  const i = row * COLS + col;
                  const id = rack[i];
                  const card = id ? byId.get(id) : undefined;
                  return (
                    <div key={i} className="slot" data-drop="slot" data-slot={i} style={{ gridRow: row * 2 + 1, gridColumn: col + 1 }}
                      onClick={!card && selId ? () => setRack((r) => moveCard(r, r.indexOf(selId), i)) : undefined}>
                      {card && (
                        <div role="button" tabIndex={0} aria-label={cardName(card)} aria-pressed={selId === card.id}
                          className={`rcard ${selId === card.id ? 'sel' : ''} ${drag?.src.kind === 'rack' && drag.src.id === card.id ? 'dragging' : ''}`}
                          onPointerDown={begin({ kind: 'rack', id: card.id }, card)} onKeyDown={onKey({ kind: 'rack', id: card.id })}>
                          <Tile card={card} w={cw} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {segs.filter((g) => g.row === row && g.kind).map((g) => (
                  <div key={`g${g.start}`} className={`glabel ${g.kind}`} style={{ gridRow: row * 2 + 2, gridColumn: `${(g.start % COLS) + 1} / ${(g.end % COLS) + 2}` }}>
                    {g.kind === 'meld' ? g.pts : 'çift'}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
        <div className="bigbtns" style={{ width: bigBtn }}>
          <button className="bigbtn" onClick={() => setRack(autoCift(mine.hand))} aria-label="Çift diz">
            <span className="bb-icon" aria-hidden="true"><i>5</i><i>5</i></span>
            <span className="bb-text">ÇİFT DİZ</span>
          </button>
          <button className="bigbtn" onClick={() => setRack(autoSeri(mine.hand))} aria-label="Seri diz">
            <span className="bb-icon" aria-hidden="true"><i>1</i><i>2</i><i>3</i></span>
            <span className="bb-text">SERİ DİZ</span>
          </button>
        </div>
      </div>

      {showAll && (
        <div className="all-discards" role="dialog" aria-label="Atılan bütün kartlar" onClick={() => setShowAll(false)}>
          <div className="ad-panel">
            <h3>Atılan bütün kartlar</h3>
            {s.players.map((p, i) => {
              const cs = pileCards(i);
              return cs.length ? (
                <div key={i} className="ad-row"><span className="meld-owner">{i === me ? 'Sen' : p.name}</span>
                  <div className="ad-cards">{cs.map((c) => <Tile key={c.id} card={c} w={meldW} />)}</div></div>
              ) : null;
            })}
            <span className="muted" style={{ fontSize: 12 }}>Kapatmak için tekrar dokun.</span>
          </div>
        </div>
      )}
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x - cw / 2, top: drag.y - ch / 2 }}>
          {drag.card ? <Tile card={drag.card} w={cw} /> : <div className="deck-tile" style={{ width: cw, height: ch }} />}
        </div>
      )}

      {modal === 'leave' && (
        <ConfirmBox title="Oyundan ayrıl" text={leaveText ?? 'Oyundan ayrılırsan bu oyun senin için biter.'}
          yes="Ayrıl" onYes={() => { setModal(null); onExit(); }} onNo={() => setModal(null)} />
      )}
      {modal === 'cift' && (
        <ConfirmBox title="Çifte Git" text="Bu el yalnızca çiftle açabilirsin ve bu karar el bitene kadar geri alınamaz."
          yes="Çifte Git" onYes={() => { setModal(null); act({ type: 'declareCift' }); }} onNo={() => setModal(null)} />
      )}
      {modal === 'score' && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-label="Skor">
          <div className="panel modal">
            <h2>Skor · {s.history.length} el</h2>
            <table className="score-table">
              <thead><tr><th>Oyuncu</th><th>Ceza</th><th>★</th><th>Final</th></tr></thead>
              <tbody>{scores.map((f, i) => (
                <tr key={i}><td style={{ fontWeight: i === me ? 700 : 500 }}>{f.name}</td><td>{f.penalty}</td><td>{f.stars}</td><td style={{ fontWeight: 700 }}>{f.final}</td></tr>
              ))}</tbody>
            </table>
            <span className="muted" style={{ fontSize: 12 }}>Final = Ceza − (★ × 101)</span>
            <h3 style={{ fontSize: 15 }}>Son hamleler</h3>
            <ol className="log">{s.log.slice(-12).reverse().map((l, i) => <li key={i}>{l}</li>)}</ol>
            <button className="btn btn-gold" onClick={() => setModal(null)}>Kapat</button>
          </div>
        </div>
      )}
      {modal === 'chat' && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-label="Sohbet">
          <div className="panel modal">
            {sideExtra}
            <button className="btn" onClick={() => setModal(null)}>Kapat</button>
          </div>
        </div>
      )}
      {s.phase === 'handOver' && lastHand && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-label="El sonucu">
          <div className="panel modal">
            <h2>{s.restartPending ? 'Oyun yeniden başlıyor' : `${lastHand.hand}. el bitti`}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {lastHand.winner === null ? 'Deste bitti.' : `${s.players[lastHand.winner].name} eli ${lastHand.jokerFinish ? 'jokerle ' : ''}${lastHand.pairFinish ? 'çiftle ' : ''}bitirdi.`}
            </p>
            <table className="score-table">
              <thead><tr><th>Oyuncu</th><th>Bu el ceza</th><th>Bu el ★</th><th>Toplam final</th></tr></thead>
              <tbody>{s.players.map((p, i) => (
                <tr key={i}><td>{p.name}</td><td>{lastHand.penalties[i]}</td><td>{lastHand.stars[i]}</td><td>{scores[i].final}</td></tr>
              ))}</tbody>
            </table>
            {canAdvance ? <button className="btn btn-gold" onClick={() => act({ type: 'nextHand' })}>Sonraki El</button> : <span className="muted">Sonraki el birazdan başlayacak…</span>}
          </div>
        </div>
      )}
      {s.phase === 'gameOver' && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-label="Oyun sonu">
          <div className="panel modal">
            <h2>{s.winner === me ? 'Kazandın!' : `Kazanan: ${s.players[s.winner!].name}`}</h2>
            {s.fullRunWin && <p style={{ margin: 0 }}>A'dan A'ya tam seriyle oyun kazanıldı.</p>}
            <table className="score-table">
              <thead><tr><th>Oyuncu</th><th>Ceza</th><th>★</th><th>Final</th></tr></thead>
              <tbody>{scores.map((f, i) => ({ ...f, i })).sort((a, b) => a.final - b.final).map((f) => (
                <tr key={f.i}><td style={{ fontWeight: f.i === s.winner ? 700 : 500 }}>{f.name}</td><td>{f.penalty}</td><td>{f.stars}</td><td>{f.final}</td></tr>
              ))}</tbody>
            </table>
            <div className="row">
              {onNewGame && <button className="btn btn-gold" onClick={onNewGame}>Yeni Oyun</button>}
              <button className="btn" onClick={onExit}>Çık</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ConfirmBox({ title, text, yes, onYes, onNo }: { title: string; text: string; yes: string; onYes: () => void; onNo: () => void }) {
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-label={title}>
      <div className="panel modal" style={{ maxWidth: 420 }}>
        <h2>{title}</h2>
        <p style={{ margin: 0 }}>{text}</p>
        <div className="row">
          <button className="btn btn-cift" onClick={onYes}>{yes}</button>
          <button className="btn" onClick={onNo}>Vazgeç</button>
        </div>
      </div>
    </div>
  );
}
