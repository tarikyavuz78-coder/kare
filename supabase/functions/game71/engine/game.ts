// Bu dosya src/engine'den otomatik kopyalanır; burada düzenlemeyin.
// 71 – oyun durumu ve hamleler. Kurallar: "71 Kart Oyunu – Kesin Kural Belgesi".
import { Card, makeDeck, nextRandom, penaltyValue, cardLabel } from './cards.ts';
import { MeldKind, resolveAs, resolveGroup, resolvePair, isFullRun, jokerSwapIndex, Resolved } from './melds.ts';

export class RuleError extends Error {}
function fail(msg: string): never { throw new RuleError(msg); }

export type OpenType = 'none' | 'normal' | 'pairs';

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  hand: Card[];
  opened: OpenType;
  /** Normal açılışta puan, çift açılışta çift sayısı (ilk açılış). */
  openValue: number;
  /** Çifte Git durumu (Çifte Git diyen veya çiftle açan). */
  cift: boolean;
  /** Çifte Git deyip normal açmaya çalıştı (+202). */
  wrongOpen: boolean;
  stars: number;
  starsDeleted: boolean;
  /** Anında yazılan, çarpansız cezalar (oyun ortasında joker atma +71). */
  immediate: number;
}

export interface TableMeld { id: number; owner: number; kind: MeldKind; cards: Card[]; }

export interface Turn {
  phase: 'draw' | 'play';
  taken: string | null;
  takenMustOpen: boolean;
  takenMustUse: boolean;
  actedSinceTake: boolean;
  /** Alma geri alındıysa bu tur yeniden yerden alınamaz. */
  noTake?: boolean;
  /** Bu tur desteden çekilen kart. */
  drawn?: string;
  /** Yerden almadan önceki masa durumu: almayı geri al, turdaki her şeyi geri alır. */
  snapshot?: Snapshot;
}

export interface Snapshot { players: Player[]; melds: TableMeld[]; nextMeldId: number; discard: Card[]; discardOwners?: number[]; discardBy: number | null; deadJoker: boolean; logLength: number; }

export interface HandRecord {
  hand: number;
  winner: number | null;
  jokerFinish: boolean;
  pairFinish: boolean;
  penalties: number[];
  stars: number[];
  noOpenDeckEnd: boolean;
}

export interface GameState {
  rng: number;
  players: Player[];
  handNo: number;
  targetHands: number;
  deck: Card[];
  discard: Card[];
  discardBy: number | null;
  deadJoker: boolean;
  melds: TableMeld[];
  nextMeldId: number;
  /** Atılan her kartın sahibi (discard ile aynı sırada): her oyuncunun önündeki yığın. */
  discardOwners?: number[];
  /** Her yeni turda bir artar (süre sayacı bununla sıfırlanır). */
  turnNo?: number;
  current: number;
  turn: Turn;
  phase: 'playing' | 'handOver' | 'gameOver';
  history: HandRecord[];
  lastWinner: number | null;
  restartPending: boolean;
  winner: number | null;
  fullRunWin: boolean;
  log: string[];
}

export type Action =
  | { type: 'draw' }
  | { type: 'take'; declareCift?: boolean }
  | { type: 'undoTake' }
  | { type: 'declareCift' }
  | { type: 'open'; groups: string[][] }
  | { type: 'meld'; groups: string[][] }
  | { type: 'layoff'; meldId: number; cardId: string; side?: 'left' | 'right' }
  | { type: 'swapJoker'; meldId: number; cardId: string }
  | { type: 'discard'; cardId: string }
  | { type: 'nextHand' };

export const BASE_NORMAL = 71;
export const BASE_PAIRS = 5;
export const MAX_PAIRS = 7;
export const UNOPENED_PENALTY = 101;
export const CIFT_UNOPENED_PENALTY = 202;
export const WRONG_OPEN_PENALTY = 202;
export const STAR_VALUE = 101;

// ---------------------------------------------------------------- yardımcılar

function rand(s: GameState): number {
  const [v, next] = nextRandom(s.rng);
  s.rng = next;
  return v;
}

function shuffle<T>(s: GameState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const prevIndex = (s: GameState, i: number) => (i - 1 + s.players.length) % s.players.length;

export function starsForPoints(points: number): number {
  return points >= 121 ? 2 : points >= 101 ? 1 : 0;
}
export function starsForPairs(count: number): number {
  return count >= 7 ? 2 : count === 6 ? 1 : 0;
}

/** Yükselen baraj: masadaki en yüksek açılışa göre sonraki açılışların alt sınırı. */
export function thresholds(s: GameState): { normal: number; pairs: number } {
  let maxNormal = 0;
  let maxPairs = 0;
  for (const p of s.players) {
    if (p.opened === 'normal') maxNormal = Math.max(maxNormal, p.openValue);
    if (p.opened === 'pairs') maxPairs = Math.max(maxPairs, p.openValue);
  }
  let normal = BASE_NORMAL;
  if (maxNormal) normal = Math.max(normal, maxNormal + 1);
  if (maxPairs >= 6) normal = Math.max(normal, 121);
  else if (maxPairs === 5) normal = Math.max(normal, 101);
  const pairs = maxPairs ? maxPairs + 1 : BASE_PAIRS;
  return { normal, pairs };
}

function pickCards(p: Player, ids: string[]): Card[] {
  return ids.map((id) => {
    const c = p.hand.find((x) => x.id === id);
    if (!c) fail('Bu kart elinizde değil.');
    return c;
  });
}

function removeFromHand(p: Player, ids: string[]) {
  const set = new Set(ids);
  p.hand = p.hand.filter((c) => !set.has(c.id));
}

function assertTurn(s: GameState, pi: number) {
  if (s.phase !== 'playing') fail('El oynanmıyor.');
  if (s.current !== pi) fail('Sıra sizde değil.');
}

function assertPlay(s: GameState, pi: number) {
  assertTurn(s, pi);
  if (s.turn.phase !== 'play') fail('Önce kart çekmelisiniz.');
}

function noteUse(s: GameState, ids: string[]) {
  if (s.turn.taken) s.turn.actedSinceTake = true;
  if (s.turn.taken && ids.includes(s.turn.taken)) s.turn.takenMustUse = false;
}

function addMeld(s: GameState, owner: number, r: Resolved) {
  s.melds.push({ id: s.nextMeldId++, owner, kind: r.kind, cards: r.slots.map((x) => x.card) });
}

function flatIds(groups: string[][]): string[] {
  const ids = groups.flat();
  if (new Set(ids).size !== ids.length) fail('Aynı kart iki kez kullanılamaz.');
  return ids;
}

/** 2 yıldızlı açılış (121+ veya 7 çift), masadaki 1 yıldızlı açılışların yıldızını siler. */
function deleteOneStars(s: GameState, by: number) {
  s.players.forEach((p, i) => {
    if (i !== by && p.opened !== 'none' && p.stars === 1) {
      p.stars = 0;
      p.starsDeleted = true;
      s.log.push(`${p.name} adlı oyuncunun yıldızı silindi.`);
    }
  });
}

// ---------------------------------------------------------------- oyun kurulumu

export interface NewGameOptions { seed?: number; bots?: boolean[]; ids?: string[]; targetHands?: number; }

export function createGame(names: string[], opts: NewGameOptions = {}): GameState {
  if (names.length < 2 || names.length > 4) fail('Oyun 2–4 kişiyle oynanır.');
  const s: GameState = {
    rng: (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0,
    players: names.map((name, i) => ({
      id: opts.ids?.[i] ?? `p${i}`, name, isBot: opts.bots?.[i] ?? false, hand: [],
      opened: 'none', openValue: 0, cift: false, wrongOpen: false, stars: 0, starsDeleted: false, immediate: 0,
    })),
    handNo: 1,
    targetHands: opts.targetHands ?? 11,
    deck: [], discard: [], discardOwners: [], discardBy: null, deadJoker: false, melds: [], nextMeldId: 1,
    current: 0,
    turn: { phase: 'draw', taken: null, takenMustOpen: false, takenMustUse: false, actedSinceTake: false },
    phase: 'playing', history: [], lastWinner: null, restartPending: false, winner: null, fullRunWin: false, log: [],
  };
  startHand(s, Math.floor(rand(s) * names.length));
  return s;
}

function startHand(s: GameState, starter: number) {
  s.deck = shuffle(s, makeDeck());
  for (const p of s.players) {
    p.hand = s.deck.splice(0, 14);
    p.opened = 'none'; p.openValue = 0; p.cift = false; p.wrongOpen = false;
    p.stars = 0; p.starsDeleted = false; p.immediate = 0;
  }
  s.discard = []; s.discardOwners = []; s.discardBy = null; s.deadJoker = false; s.melds = [];
  s.current = starter;
  s.turnNo = (s.turnNo ?? 0) + 1;
  s.turn = { phase: 'draw', taken: null, takenMustOpen: false, takenMustUse: false, actedSinceTake: false };
  s.phase = 'playing';
  s.log.push(`${s.handNo}. el başladı. ${s.players[starter].name} başlıyor.`);
}

// ---------------------------------------------------------------- yerden alma kontrolü

export interface TakeCheck {
  allowed: boolean;
  reason?: string;
  /** Önceki oyuncuya 5 saniyelik "Çifte Git?" sorusu sorulmalı. */
  askPrevious: number | null;
  /** Kartı almak için alan oyuncunun da Çifte Git demesi gerekiyor. */
  needsCift: boolean;
}

export function checkTake(s: GameState, pi: number): TakeCheck {
  const no = (reason: string): TakeCheck => ({ allowed: false, reason, askPrevious: null, needsCift: false });
  if (s.phase !== 'playing' || s.current !== pi || s.turn.phase !== 'draw') return no('Şu an yerden kart alamazsınız.');
  const top = s.discard[s.discard.length - 1];
  if (!top || s.discardBy !== prevIndex(s, pi)) return no('Yerde alınabilecek kart yok.');
  if (s.deadJoker) return no('Atılan joker alınamaz.');
  if (s.turn.noTake) return no('Bu tur yerden almayı geri aldınız.');
  const prev = s.players[s.discardBy];
  const me = s.players[pi];
  if (prev.cift) {
    if (me.cift) return { allowed: true, askPrevious: null, needsCift: false };
    if (me.opened === 'normal') return no(`${prev.name} Çifte Git dedi. Normal açtığınız için bu kartı alamazsınız.`);
    return { allowed: true, askPrevious: null, needsCift: true };
  }
  return { allowed: true, askPrevious: prev.opened === 'none' ? s.discardBy : null, needsCift: false };
}

// ---------------------------------------------------------------- hamleler

export function apply(state: GameState, pi: number, a: Action): GameState {
  const s: GameState = structuredClone(state);
  switch (a.type) {
    case 'draw': return doDraw(s, pi);
    case 'take': return doTake(s, pi, !!a.declareCift);
    case 'undoTake': return doUndoTake(s, pi);
    case 'declareCift': return doDeclareCift(s, pi);
    case 'open': return doOpen(s, pi, a.groups);
    case 'meld': return doMeld(s, pi, a.groups);
    case 'layoff': return doLayoff(s, pi, a.meldId, a.cardId, a.side ?? 'right');
    case 'swapJoker': return doSwap(s, pi, a.meldId, a.cardId);
    case 'discard': return doDiscard(s, pi, a.cardId);
    case 'nextHand': return doNextHand(s);
  }
}

function doDraw(s: GameState, pi: number): GameState {
  assertTurn(s, pi);
  if (s.turn.phase !== 'draw') fail('Bu tur zaten kart aldınız.');
  const c = s.deck.shift();
  if (!c) fail('Deste bitti.');
  s.players[pi].hand.push(c);
  s.turn.phase = 'play';
  s.turn.drawn = c.id;
  return s;
}

function doTake(s: GameState, pi: number, declareCift: boolean): GameState {
  const chk = checkTake(s, pi);
  if (!chk.allowed) fail(chk.reason!);
  const snapshot: Snapshot = structuredClone({ players: s.players, melds: s.melds, nextMeldId: s.nextMeldId, discard: s.discard, discardOwners: s.discardOwners, discardBy: s.discardBy, deadJoker: s.deadJoker, logLength: s.log.length });
  const me = s.players[pi];
  if (chk.needsCift) {
    if (!declareCift) fail('Bu kartı almak için Çifte Git demelisiniz.');
    me.cift = true;
    s.log.push(`${me.name} Çifte Git dedi.`);
  } else if (declareCift && me.opened === 'none' && !me.cift) {
    me.cift = true;
    s.log.push(`${me.name} Çifte Git dedi.`);
  }
  const c = s.discard.pop()!;
  s.discardOwners?.pop();
  me.hand.push(c);
  s.turn = {
    phase: 'play', taken: c.id,
    takenMustOpen: me.opened === 'none' && !me.cift,
    takenMustUse: me.opened !== 'none',
    actedSinceTake: false,
    snapshot,
  };
  s.log.push(`${me.name} yerden ${cardLabel(c)} aldı.`);
  return s;
}

function doUndoTake(s: GameState, pi: number): GameState {
  assertPlay(s, pi);
  const snap = s.turn.snapshot;
  if (!s.turn.taken || !snap) fail('Geri alınacak bir yerden alma yok.');
  s.players = snap.players; s.melds = snap.melds; s.nextMeldId = snap.nextMeldId;
  s.discard = snap.discard; s.discardOwners = snap.discardOwners; s.discardBy = snap.discardBy; s.deadJoker = snap.deadJoker;
  s.log = s.log.slice(0, snap.logLength);
  s.turn = { phase: 'draw', taken: null, takenMustOpen: false, takenMustUse: false, actedSinceTake: false, noTake: true };
  return s;
}

function doDeclareCift(s: GameState, pi: number): GameState {
  if (s.phase !== 'playing') fail('El oynanmıyor.');
  const p = s.players[pi];
  if (p.cift) return s;
  if (p.opened === 'normal') fail('Normal açan oyuncu Çifte Gidemez.');
  p.cift = true;
  s.log.push(`${p.name} Çifte Git dedi.`);
  return s;
}

function doOpen(s: GameState, pi: number, groups: string[][]): GameState {
  assertPlay(s, pi);
  const me = s.players[pi];
  if (me.opened !== 'none') fail('Zaten açtınız.');
  if (!groups.length) fail('Açmak için kart seçin.');
  const ids = flatIds(groups);
  const cardGroups = groups.map((g) => pickCards(me, g));
  if (me.hand.length - ids.length < 1) fail('Atmak için elinizde en az bir kart kalmalı.');
  if (s.turn.takenMustOpen && !ids.includes(s.turn.taken!)) fail('Yerden aldığınız kartı açılışta kullanmalısınız.');
  const leavesOne = me.hand.length - ids.length === 1; // elden bitme: açılıştan sonra yalnızca atılacak kart kalır
  const th = thresholds(s);

  if (cardGroups.every((g) => g.length === 2)) {
    const res = cardGroups.map((g) => resolvePair(g));
    if (res.some((r) => !r)) fail('Geçersiz çift var.');
    const count = res.length;
    if (count > MAX_PAIRS) fail('En fazla 7 çift açılabilir.');
    const minPairs = leavesOne ? BASE_PAIRS : th.pairs;
    if (count < minPairs) fail(`Çiftle açmak için en az ${minPairs} çift gerekir.`);
    res.forEach((r) => addMeld(s, pi, r!));
    removeFromHand(me, ids);
    me.opened = 'pairs'; me.openValue = count; me.cift = true;
    me.stars = starsForPairs(count);
    s.log.push(`${me.name} ${count} çiftle açtı${me.stars ? ` (★${me.stars})` : ''}.`);
    if (me.stars === 2) deleteOneStars(s, pi);
  } else {
    const res = cardGroups.map((g) => resolveGroup(g, true));
    if (res.some((r) => !r)) fail('Geçersiz per var.');
    const total = res.reduce((a, r) => a + r!.points, 0);
    const min = leavesOne ? BASE_NORMAL : th.normal;
    if (total < min) fail(`Açmak için en az ${min} puan gerekir. Seçilen perler: ${total}.`);
    if (me.cift) {
      if (me.wrongOpen) fail('Çifte Git dediniz, normal açamazsınız.');
      me.wrongOpen = true;
      s.log.push(`${me.name} Çifte Git deyip normal açmaya çalıştı: +${WRONG_OPEN_PENALTY} ceza. Kartlar ele döndü.`);
      return s;
    }
    if (res.some((r) => isFullRun(r!))) {
      res.forEach((r) => addMeld(s, pi, r!));
      removeFromHand(me, ids);
      s.phase = 'gameOver'; s.winner = pi; s.fullRunWin = true;
      s.log.push(`${me.name} A'dan A'ya tam seri açtı ve oyunu kazandı!`);
      return s;
    }
    res.forEach((r) => addMeld(s, pi, r!));
    removeFromHand(me, ids);
    me.opened = 'normal'; me.openValue = total;
    me.stars = starsForPoints(total);
    s.log.push(`${me.name} ${total} puanla açtı${me.stars ? ` (★${me.stars})` : ''}.`);
    if (me.stars === 2) deleteOneStars(s, pi);
  }
  if (s.turn.taken && ids.includes(s.turn.taken)) { s.turn.takenMustOpen = false; s.turn.takenMustUse = false; }
  noteUse(s, ids);
  return s;
}

function doMeld(s: GameState, pi: number, groups: string[][]): GameState {
  assertPlay(s, pi);
  const me = s.players[pi];
  if (me.opened === 'none') fail('Önce elinizi açmalısınız.');
  const ids = flatIds(groups);
  const cardGroups = groups.map((g) => pickCards(me, g));
  if (me.hand.length - ids.length < 1) fail('Atmak için elinizde en az bir kart kalmalı.');
  let res: (Resolved | null)[];
  if (me.opened === 'pairs') {
    res = cardGroups.map((g) => resolvePair(g));
    if (res.some((r) => !r)) fail('Çift açan oyuncu yalnızca çift ekleyebilir.');
    const owned = s.melds.filter((m) => m.owner === pi && m.kind === 'pair').length;
    if (owned + res.length > MAX_PAIRS) fail('En fazla 7 çift olabilir.');
  } else {
    res = cardGroups.map((g) => resolveGroup(g, false));
    if (res.some((r) => !r || r.kind === 'pair')) fail('Geçersiz per var.');
  }
  res.forEach((r) => addMeld(s, pi, r!));
  removeFromHand(me, ids);
  noteUse(s, ids);
  return s;
}

function doLayoff(s: GameState, pi: number, meldId: number, cardId: string, side: 'left' | 'right'): GameState {
  assertPlay(s, pi);
  const me = s.players[pi];
  if (me.opened === 'none') fail('Açmadan kart işleyemezsiniz.');
  const meld = s.melds.find((m) => m.id === meldId);
  if (!meld) fail('Per bulunamadı.');
  if (meld.kind === 'pair') fail('Çiftlere kart işlenemez.');
  const [card] = pickCards(me, [cardId]);
  if (me.hand.length - 1 < 1) fail('Atmak için elinizde en az bir kart kalmalı.');
  const cards = meld.kind === 'run' && side === 'left' ? [card, ...meld.cards] : [...meld.cards, card];
  const r = resolveAs(meld.kind, cards);
  if (!r) fail('Bu kart bu pere işlenemez.');
  meld.cards = cards;
  removeFromHand(me, [cardId]);
  noteUse(s, [cardId]);
  s.log.push(`${me.name} ${cardLabel(card)} işledi.`);
  return s;
}

function doSwap(s: GameState, pi: number, meldId: number, cardId: string): GameState {
  assertPlay(s, pi);
  const me = s.players[pi];
  if (me.opened === 'none') fail('Jokeri almak için elinizi açmış olmalısınız.');
  const meld = s.melds.find((m) => m.id === meldId);
  if (!meld) fail('Per bulunamadı.');
  const [card] = pickCards(me, [cardId]);
  const idx = jokerSwapIndex(meld.kind, meld.cards, card);
  if (idx < 0) fail('Bu kart buradaki jokerin yerine geçemez.');
  const joker = meld.cards[idx];
  meld.cards = meld.cards.map((c, i) => (i === idx ? card : c));
  removeFromHand(me, [cardId]);
  me.hand.push(joker);
  noteUse(s, [cardId]);
  s.log.push(`${me.name} ${cardLabel(card)} koyup jokeri aldı.`);
  return s;
}

function doDiscard(s: GameState, pi: number, cardId: string): GameState {
  assertPlay(s, pi);
  const me = s.players[pi];
  if (s.turn.takenMustOpen) fail('Yerden kart aldınız: bu tur o kartla açmalısınız (ya da almayı geri alın).');
  if (s.turn.takenMustUse) fail('Yerden aldığınız kartı bu tur kullanmalısınız (ya da almayı geri alın).');
  if (s.turn.taken === cardId) fail('Yerden aldığınız kartı geri atamazsınız.');
  const [card] = pickCards(me, [cardId]);
  removeFromHand(me, [cardId]);
  s.discard.push(card);
  (s.discardOwners ??= []).push(pi);
  s.discardBy = pi;
  s.deadJoker = card.joker;
  if (me.hand.length === 0) {
    s.log.push(`${me.name} ${card.joker ? 'jokerle ' : ''}eli bitirdi.`);
    endHand(s, pi, card.joker);
    return s;
  }
  if (card.joker) {
    me.immediate += 71;
    s.log.push(`${me.name} joker attı: +71 ceza.`);
  } else {
    s.log.push(`${me.name} ${cardLabel(card)} attı.`);
  }
  if (s.deck.length === 0) {
    s.log.push('Deste bitti.');
    endHand(s, null, false);
    return s;
  }
  s.current = (pi + 1) % s.players.length;
  s.turnNo = (s.turnNo ?? 0) + 1;
  s.turn = { phase: 'draw', taken: null, takenMustOpen: false, takenMustUse: false, actedSinceTake: false };
  return s;
}

// ---------------------------------------------------------------- el sonu ve skor

export interface FinishContext { winner: number | null; winnerOpened: OpenType; jokerFinish: boolean; }

/** Bir oyuncunun el cezası (Kural belgesi, Bölüm 10). */
export function handPenalty(p: Player, isWinner: boolean, ctx: FinishContext): number {
  const wrong = p.wrongOpen && p.opened !== 'none' ? WRONG_OPEN_PENALTY : 0;
  if (isWinner) return p.immediate + wrong;
  const jm = ctx.jokerFinish ? 2 : 1;
  const cm = ctx.winnerOpened === 'pairs' ? 2 : 1;
  let base: number;
  if (p.opened === 'none') {
    base = p.cift ? CIFT_UNOPENED_PENALTY * jm : UNOPENED_PENALTY * cm * jm;
  } else {
    const k = p.hand.reduce((a, c) => a + penaltyValue(c), 0);
    base = p.opened === 'normal' ? k * cm * jm : k * 2 * jm;
  }
  return base + p.immediate + wrong;
}

function endHand(s: GameState, winner: number | null, jokerFinish: boolean) {
  const ctx: FinishContext = {
    winner, jokerFinish,
    winnerOpened: winner === null ? 'none' : s.players[winner].opened,
  };
  const rec: HandRecord = {
    hand: s.handNo, winner, jokerFinish,
    pairFinish: ctx.winnerOpened === 'pairs',
    penalties: s.players.map((p, i) => handPenalty(p, i === winner, ctx)),
    stars: s.players.map((p) => p.stars),
    noOpenDeckEnd: winner === null && s.players.every((p) => p.opened === 'none'),
  };
  s.history.push(rec);
  if (winner !== null) s.lastWinner = winner;
  s.phase = 'handOver';

  if (s.handNo === 2 && s.history.length === 2 && s.history.every((h) => h.noOpenDeckEnd)) {
    s.restartPending = true;
    s.log.push('İlk iki el kimse açamadan deste bitmesiyle sona erdi. Oyun yeniden başlatılacak.');
    return;
  }
  if (s.handNo >= s.targetHands) {
    const finals = finalScores(s).map((f) => f.final);
    const min = Math.min(...finals);
    const leaders = finals.filter((f) => f === min).length;
    if (leaders === 1) {
      s.phase = 'gameOver';
      s.winner = finals.indexOf(min);
      s.log.push(`Oyun bitti. Kazanan: ${s.players[s.winner].name}.`);
    } else {
      s.targetHands += 2;
      s.log.push('Final skorları eşit. İki el daha oynanacak.');
    }
  }
}

export function finalScores(s: GameState) {
  return s.players.map((p, i) => {
    const penalty = s.history.reduce((a, h) => a + h.penalties[i], 0);
    const stars = s.history.reduce((a, h) => a + h.stars[i], 0);
    return { name: p.name, penalty, stars, final: penalty - stars * STAR_VALUE };
  });
}

function doNextHand(s: GameState): GameState {
  if (s.phase !== 'handOver') fail('El henüz bitmedi.');
  if (s.restartPending) {
    s.history = []; s.handNo = 1; s.lastWinner = null; s.restartPending = false; s.targetHands = 11;
    startHand(s, Math.floor(rand(s) * s.players.length));
    return s;
  }
  s.handNo += 1;
  const starter = s.lastWinner ?? Math.floor(rand(s) * s.players.length);
  startHand(s, starter);
  return s;
}

// ---------------------------------------------------------------- görünüm

/** Bir oyuncuya gönderilecek görünüm: rakiplerin eli ve deste gizlenir. */
export function viewFor(s: GameState, pi: number) {
  return {
    ...s,
    rng: 0,
    deck: [],
    turn: { ...s.turn, snapshot: undefined },
    deckCount: s.deck.length,
    players: s.players.map((p, i) => (i === pi ? p : { ...p, hand: [], handCount: p.hand.length })),
    thresholds: thresholds(s),
  };
}
