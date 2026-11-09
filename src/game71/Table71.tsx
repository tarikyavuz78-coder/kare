import { Fragment, ReactNode, useEffect, useMemo, useRef, useState, PointerEvent as RPointerEvent, KeyboardEvent as RKeyboardEvent } from 'react';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { Capacitor } from '@capacitor/core';
import { Card as C } from '../engine/cards';
import { Action, GameState, Player, finalScores, thresholds } from '../engine/game';
import { jokerSwapIndex, resolveAs, resolveGroup, resolvePair } from '../engine/melds';
import { suggestMelds, suggestPairs } from '../engine/bot';
import { CardFace, AVATAR_COLORS, cardName } from './ui';
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
}

type DragSrc = { kind: 'rack'; id: string } | { kind: 'deck' } | { kind: 'pile' };

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

/** Bir oyuncunun önündeki yığının en üstteki kartı. */
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

export default function Table71({ s, me, act, takeRequest, onExit, title, canAdvance = true, onNewGame, headerExtra, sideExtra, waitingText }: Props) {
  const mine = s.players[me];
  const compact = useCompact();
  const n = s.players.length;
  const prev = (me - 1 + n) % n;
  const myTurn = s.phase === 'playing' && s.current === me;
  const canDraw = myTurn && s.turn.phase === 'draw';
  const canPlay = myTurn && s.turn.phase === 'play';

  // telefonda masa yalnızca yatay oynanır
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => undefined);
    return () => { ScreenOrientation.unlock().catch(() => undefined); };
  }, []);

  const [rack, setRack] = useState<RackSlots>(() => autoSeri(mine.hand));
  const handNoRef = useRef(s.handNo);
  const pendingSlot = useRef<number | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ src: DragSrc; card: C | null; x: number; y: number } | null>(null);
  const pending = useRef<{ src: DragSrc; card: C | null; x0: number; y0: number; moved: boolean } | null>(null);
  const [ciftAsk, setCiftAsk] = useState(false);
  const handRef = useRef<HTMLDivElement>(null);
  const width = useWidth(handRef);

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

  const cw = width ? Math.max(26, Math.min(compact ? 38 : 64, Math.floor((width - 87) / 16))) : compact ? 34 : 56;
  const ch = Math.round(cw * 1.42);
  const labelH = compact ? 12 : 16;

  const leftTop = pileTop(s, prev);
  const rightTop = pileTop(s, me);
  const lastDiscard = s.discard[s.discard.length - 1];
  const canTake = canDraw && !!leftTop && s.discardBy === prev && lastDiscard?.id === leftTop.id && !s.deadJoker;

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
  const others = s.players.map((p, i) => ({ p, i })).filter((x) => x.i !== me);
  const ownersWithMelds = s.players.map((p, i) => ({ p, i, melds: s.melds.filter((m) => m.owner === i) })).filter((x) => x.melds.length);

  const opponents = (
    <div className="opponents">
      {others.map(({ p, i }) => {
        const top = pileTop(s, i);
        return (
          <div key={i} className={`panel seat ${s.current === i && s.phase === 'playing' ? 'active' : ''}`}>
            <div className="avatar" style={{ background: AVATAR_COLORS[i % 4] }}>{p.name[0]}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <strong style={{ fontSize: 14 }}>{p.name}{p.isBot && !compact && <span className="muted"> · Bot</span>}</strong>
              <div className="row" style={{ gap: 4 }}><StatusChips p={p} /></div>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{handCount(p)} kart</span>
            {!compact && top && i !== prev && <div title="Son attığı kart"><CardFace card={top} w={30} /></div>}
          </div>
        );
      })}
    </div>
  );

  const pile = (side: 'left' | 'right') => {
    const top = side === 'left' ? leftTop : rightTop;
    const hot = side === 'left' ? canTake : canPlay;
    return (
      <div className={`pile ${hot ? 'hot' : ''}`} style={{ width: cw + 8 }}>
        <div className="well" data-drop={side === 'right' ? 'discard' : undefined} style={{ width: cw + 6, height: ch + 6 }}
          onClick={side === 'right' && selId && canPlay ? () => discard(selId) : undefined}
          aria-label={side === 'right' ? 'Atılan kartlar: kart atmak için buraya sürükle' : `${s.players[prev].name} adlı oyuncunun attığı kart`}>
          {top && side === 'left' && canTake ? (
            <div className="rcard" role="button" tabIndex={0} aria-label={`Yerden al: ${cardName(top)}`}
              onPointerDown={begin({ kind: 'pile' }, top)} onKeyDown={onKey({ kind: 'pile' })}>
              <CardFace card={top} w={cw} />
            </div>
          ) : top ? <CardFace card={top} w={cw} /> : null}
        </div>
        <span className="pile-label">{side === 'left' ? s.players[prev].name : 'At'}</span>
      </div>
    );
  };

  const actions = (
    <>
      {canDraw && <>
        <button className="btn btn-gold" onClick={draw}>Desteden Çek</button>
        <button className="btn" disabled={!canTake} onClick={take}>Yerden Al</button>
      </>}
      {canPlay && mine.opened === 'none' && <>
        <button className="btn btn-gold" disabled={!meldSegs.length} onClick={openNormal}>Per Aç</button>
        <button className="btn btn-pair" disabled={!pairCount} onClick={openPairs}>Çift Aç</button>
      </>}
      {canPlay && mine.opened !== 'none' && (
        <button className="btn btn-gold" disabled={!meldGroups.length} onClick={meldMore}>{mine.opened === 'pairs' ? 'Çift İndir' : 'Per İndir'}</button>
      )}
      {canPlay && s.turn.taken && <button className="btn" onClick={() => act({ type: 'undoTake' })}>Almayı Geri Al</button>}
      {canPlay && <button className="btn" disabled={!selId} onClick={() => selId && discard(selId)}>Kartı At</button>}
      {s.phase === 'playing' && mine.opened === 'none' && !mine.cift && <button className="btn btn-cift" onClick={() => setCiftAsk(true)}>Çifte Git</button>}
    </>
  );

  return (
    <div className="game">
      <div className="rotate-hint">Oynamak için telefonunuzu yatay çevirin.</div>
      <header className="topbar">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <button className="logo" onClick={onExit} aria-label="Masadan çık" style={{ border: 'none' }}>71</button>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <strong style={{ fontFamily: 'Sora' }}>El {s.handNo}/{s.targetHands}</strong>
            {!compact && <span className="muted" style={{ fontSize: 12 }}>{title}</span>}
          </div>
        </div>
        {compact && opponents}
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          {!compact && <span className="muted" style={{ fontSize: 12 }}>Baraj: {th.normal} puan · {th.pairs} çift</span>}
          {headerExtra}
        </div>
      </header>

      <div className="game-body">
        <main className="game-main">
          {!compact && opponents}

          <section className="table" aria-label="Masa">
            <div className="melds">
              {ownersWithMelds.length === 0 && <span className="muted" style={{ margin: 'auto' }}>Henüz kimse açmadı.</span>}
              {ownersWithMelds.map(({ p, i, melds }) => (
                <div key={i}>
                  <div className="meld-owner">{i === me ? 'Senin perlerin' : p.name}</div>
                  <div className="meld-row">
                    {melds.map((m) => {
                      const t = targetFor(m);
                      return (
                        <div key={m.id} className={`meld ${t ? 'target' : ''}`} data-drop="meld" data-meld={m.id}
                          onClick={t && selId ? () => playOnMeld(m.id, selId) : undefined}
                          role={t && selId ? 'button' : undefined} aria-label={t && selId ? 'Seçili kartı buraya işle' : undefined}>
                          {m.cards.map((c) => <CardFace key={c.id} card={c} size={compact ? 'xs' : 's'} />)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className={`deck ${canDraw ? 'hot' : ''}`} role="button" tabIndex={canDraw ? 0 : -1} aria-label="Desteden kart çek"
              onPointerDown={canDraw ? begin({ kind: 'deck' }, null) : undefined} onKeyDown={onKey({ kind: 'deck' })}>
              <div className="card-back" style={compact ? { width: 36, height: 51, borderRadius: 6 } : { width: 58, height: 82, borderRadius: 8, boxShadow: '3px 3px 0 #0B2A21' }} />
              <span className="muted" style={{ fontSize: 12 }}>Deste {s.deckCount ?? s.deck.length}</span>
            </div>
          </section>

          <div className="hand-area" ref={handRef}>
            <div className="hand-bar">
              <div className="row" style={{ gap: 8 }}>
                {myTurn && <span className="chip chip-turn">Sıra sende</span>}
                <StatusChips p={mine} />
                {waitingText && <span className="muted" style={{ fontSize: 13 }}>{waitingText}</span>}
              </div>
              <div className="per-info" aria-live="polite">
                <span>Per <b style={{ color: perPts >= th.normal ? 'var(--ok)' : 'var(--text)' }}>{perPts}</b></span>
                <span>Çift <b style={{ color: pairCount >= th.pairs ? 'var(--ok)' : 'var(--text)' }}>{pairCount}</b></span>
                {mine.opened === 'none' && !compact && <span className="muted">baraj {th.normal} · {th.pairs} çift</span>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" onClick={() => setRack(autoSeri(mine.hand))}>Seri Diz</button>
                <button className="btn" onClick={() => setRack(autoCift(mine.hand))}>Çift Diz</button>
                {compact && actions}
              </div>
            </div>

            <div className="rack-wrap">
              {pile('left')}
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
                              <CardFace card={card} w={cw} />
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
              {pile('right')}
            </div>

            {!compact && <div className="actions">{actions}</div>}
            {!compact && <div className="rack-hint">Kartları sürükleyerek diz; aralarına boşluk bıraktığın kartlar ayrı per sayılır. Atmak için kartı sağdaki “At” kutusuna, işlemek için masadaki pere sürükle.</div>}
          </div>
        </main>

        <aside className="sidebar">
          <section className="stack" style={{ gap: 8 }}>
            <h2 style={{ fontSize: 15 }}>Skor · {s.history.length} el</h2>
            <table className="score-table">
              <thead><tr><th>Oyuncu</th><th>Ceza</th><th>★</th><th>Final</th></tr></thead>
              <tbody>
                {scores.map((f, i) => (
                  <tr key={i}><td style={{ fontWeight: i === me ? 700 : 500 }}>{f.name}</td><td>{f.penalty}</td><td style={{ color: 'var(--gold-soft)' }}>{f.stars}</td><td style={{ fontWeight: 700 }}>{f.final}</td></tr>
                ))}
              </tbody>
            </table>
            <span className="muted" style={{ fontSize: 11 }}>Final = Ceza − (★ × 101)</span>
          </section>
          <section className="stack" style={{ gap: 8 }}>
            <h2 style={{ fontSize: 15 }}>Son hamleler</h2>
            <ol className="log">{s.log.slice(-10).reverse().map((l, i) => <li key={i}>{l}</li>)}</ol>
          </section>
          {sideExtra}
        </aside>
      </div>

      {drag && (
        <div className="drag-ghost" style={{ left: drag.x - cw / 2, top: drag.y - ch / 2 }}>
          {drag.card ? <CardFace card={drag.card} w={cw} /> : <div className="card-back" style={{ width: cw, height: ch, borderRadius: 8 }} />}
        </div>
      )}

      {ciftAsk && (
        <ConfirmBox title="Çifte Git" text="Bu el yalnızca çiftle açabilirsin ve bu karar el bitene kadar geri alınamaz."
          yes="Çifte Git" onYes={() => { setCiftAsk(false); act({ type: 'declareCift' }); }} onNo={() => setCiftAsk(false)} />
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

function StatusChips({ p }: { p: Player }) {
  return <>
    {p.opened === 'normal' && <span className="chip chip-open">Açtı · {p.openValue}</span>}
    {p.opened === 'pairs' && <span className="chip chip-pair">{p.openValue} çift</span>}
    {p.cift && p.opened === 'none' && <span className="chip chip-cift">Çifte Git</span>}
    {p.stars > 0 && <span className="chip chip-star">★ {p.stars}</span>}
    {p.starsDeleted && <span className="chip" style={{ background: '#3A1418', color: '#FFD9DC' }}>★ silindi</span>}
    {p.opened === 'none' && !p.cift && <span className="muted" style={{ fontSize: 12 }}>Açmadı</span>}
  </>;
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
