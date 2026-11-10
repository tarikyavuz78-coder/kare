// 71 online oyun sunucusu (Supabase Edge Function, Deno).
// Kartlar, hamle doğrulama, botlar, Çifte Git izni, bağlantı kopması ve çip ödülleri burada yönetilir.
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { Action, GameState, RuleError, apply, checkTake, createGame, finalScores, viewFor } from './engine/game.ts';
import { botAction, botAnswersCift, botShouldDeclareCift } from './engine/bot.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ENTRY = 500;
const BONUS = 1000;
const BOT_WIN = 750;
const BOT_DAILY_LIMIT = 10;
const FILL_AFTER_MS = 15_000;
const DISCONNECT_MS = 60_000;
const ASK_MS = 5_000;
const HAND_OVER_MS = 8_000;
const BOT_NAMES = ['Ayşe', 'Mehmet', 'Zeynep', 'Can'];

interface Seat { userId: string | null; name: string; isBot: boolean; left: boolean; }
interface Meta { seats: Seat[]; pendingAsk: { prev: number; taker: number; deadline: number } | null; handOverAt: number | null; vsBots: boolean; turnStartedAt?: number; }
const TURN_MS = 15_000;
const turnKey = (g: GameState) => `${g.handNo}:${g.current}:${g.phase}`;
interface Stored { game: GameState; meta: Meta; }

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

class UserError extends Error {}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u.user) return json({ error: 'Giriş yapmalısınız.' }, 401);
    const uid = u.user.id;
    const body = await req.json();
    switch (body.op) {
      case 'create': return json(await createTable(uid, body));
      case 'join': return json(await joinTable(uid, body.tableId));
      case 'tick': return json(await mutate(body.tableId, (st, t) => tick(st, t, uid)));
      case 'act': return json(await mutate(body.tableId, (st) => act(st, uid, body.action as Action)));
      case 'take': return json(await mutate(body.tableId, (st) => humanTake(st, uid, !!body.declareCift)));
      case 'answer': return json(await mutate(body.tableId, (st) => answerAsk(st, uid, !!body.yes)));
      case 'timeout': return json(await mutate(body.tableId, (st) => timeoutMove(st, uid, body.cardId ?? null)));
      case 'leave': return json(await mutate(body.tableId, (st, t) => leave(st, t, uid)));
      default: return json({ error: 'Bilinmeyen işlem.' }, 400);
    }
  } catch (e) {
    if (e instanceof RuleError || e instanceof UserError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: 'Sunucu hatası.' }, 500);
  }
});

// ------------------------------------------------------------ masa kurma

async function profileName(uid: string): Promise<string> {
  const { data } = await admin.from('profiles').select('username').eq('id', uid).single();
  return data?.username ?? 'Oyuncu';
}

async function charge(uid: string, amount: number, reason: string, ref: string) {
  const { error } = await admin.rpc('chip_apply', { p_user: uid, p_amount: -amount, p_reason: reason, p_ref: ref });
  if (error) throw new UserError(/check|Yetersiz/i.test(error.message) ? 'Yeterli çipin yok (en az 500 çip gerekir).' : error.message);
}

async function todayCount(uid: string, reason: string): Promise<number> {
  // Türkiye saati sabit UTC+3: bugünün gece yarısı
  const ymd = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const { count } = await admin.from('chip_ledger').select('*', { count: 'exact', head: true })
    .eq('user_id', uid).eq('reason', reason).gte('created_at', `${ymd}T00:00:00+03:00`);
  return count ?? 0;
}

async function createTable(uid: string, body: { seats?: number; isPrivate?: boolean; vsBots?: boolean }) {
  const seats = Math.min(4, Math.max(2, Number(body.seats) || 4));
  const vsBots = !!body.vsBots;
  const rewarded = vsBots ? (await todayCount(uid, 'bot_entry')) < BOT_DAILY_LIMIT : true;
  const { data: t, error } = await admin.from('game_tables')
    .insert({ host_id: uid, seats, is_private: vsBots || !!body.isPrivate, vs_bots: vsBots, rewarded, entry_fee: rewarded ? ENTRY : 0 })
    .select().single();
  if (error) throw error;
  try {
    if (rewarded) await charge(uid, ENTRY, vsBots ? 'bot_entry' : 'game_entry', t.id);
  } catch (e) {
    await admin.from('game_tables').delete().eq('id', t.id);
    throw e;
  }
  await admin.from('table_players').insert({ table_id: t.id, seat: 0, user_id: uid });
  if (vsBots) {
    const name = await profileName(uid);
    const seatList: Seat[] = [{ userId: uid, name, isBot: false, left: false }, ...BOT_NAMES.slice(0, seats - 1).map((n) => ({ userId: null, name: n, isBot: true, left: false }))];
    await admin.from('table_players').insert(seatList.slice(1).map((_, i) => ({ table_id: t.id, seat: i + 1, is_bot: true, bot_reason: 'empty_seat' })));
    await startGame(t.id, seatList, 1, true);
  }
  return { tableId: t.id, rewarded };
}

async function joinTable(uid: string, tableId: string) {
  const { data: t } = await admin.from('game_tables').select('*').eq('id', tableId).single();
  if (!t || t.status !== 'waiting') throw new UserError('Bu masa artık oyuncu almıyor.');
  const { data: players } = await admin.from('table_players').select('*').eq('table_id', tableId);
  if (players!.some((p) => p.user_id === uid)) return { tableId };
  const taken = new Set(players!.map((p) => p.seat));
  const seat = [0, 1, 2, 3].find((s) => s < t.seats && !taken.has(s));
  if (seat === undefined) throw new UserError('Masa dolu.');
  await charge(uid, ENTRY, 'game_entry', tableId);
  const { error } = await admin.from('table_players').insert({ table_id: tableId, seat, user_id: uid });
  if (error) { await admin.rpc('chip_apply', { p_user: uid, p_amount: ENTRY, p_reason: 'game_refund', p_ref: tableId }); throw new UserError('Koltuk doldu, çipin iade edildi.'); }
  if (players!.length + 1 === t.seats) await fillAndStart(tableId);
  return { tableId };
}

async function fillAndStart(tableId: string) {
  const { data: t } = await admin.from('game_tables').update({ status: 'playing', started_at: new Date().toISOString() }).eq('id', tableId).eq('status', 'waiting').select().single();
  if (!t) return; // başka bir istek başlattı
  const { data: players } = await admin.from('table_players').select('*').eq('table_id', tableId);
  const seats: Seat[] = [];
  let b = 0;
  for (let s = 0; s < t.seats; s++) {
    const p = players!.find((x) => x.seat === s);
    if (p) seats.push({ userId: p.user_id, name: await profileName(p.user_id), isBot: false, left: false });
    else {
      seats.push({ userId: null, name: BOT_NAMES[b++], isBot: true, left: false });
      await admin.from('table_players').insert({ table_id: tableId, seat: s, is_bot: true, bot_reason: 'empty_seat' });
    }
  }
  await startGame(tableId, seats, seats.filter((x) => !x.isBot).length, false);
}

async function startGame(tableId: string, seats: Seat[], humans: number, vsBots: boolean) {
  const game = createGame(seats.map((s) => s.name), { bots: seats.map((s) => s.isBot), ids: seats.map((s, i) => s.userId ?? `bot${i}`) });
  const st: Stored = { game, meta: { seats, pendingAsk: null, handOverAt: null, vsBots, turnStartedAt: Date.now() } };
  runBots(st);
  await admin.from('game_tables').update({ status: 'playing', human_count: humans, started_at: new Date().toISOString() }).eq('id', tableId);
  await admin.from('game_states').insert({ table_id: tableId, state: st, version: 1 });
  await writeViews(tableId, st, 1);
}

// ------------------------------------------------------------ durum değişikliği (iyimser kilit)

type Mutator = (st: Stored, table: Record<string, unknown>) => Promise<unknown> | unknown;

async function mutate(tableId: string, fn: Mutator) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: t } = await admin.from('game_tables').select('*').eq('id', tableId).single();
    if (!t) throw new UserError('Masa bulunamadı.');
    if (t.status === 'abandoned') throw new UserError('Bu oyun sona erdi.');
    const { data: row } = await admin.from('game_states').select('state, version').eq('table_id', tableId).maybeSingle();
    if (!row) {
      // masa henüz başlamadı: yalnızca bekleme kontrolü
      if (t.status === 'waiting' && Date.now() - new Date(t.created_at).getTime() >= FILL_AFTER_MS) await fillAndStart(tableId);
      return { waiting: t.status === 'waiting' };
    }
    const st = row.state as Stored;
    const before = JSON.stringify(st);
    const key0 = turnKey(st.game);
    const result = await fn(st, t);
    runBots(st);
    autoResolve(st);
    runBots(st);
    if (turnKey(st.game) !== key0) st.meta.turnStartedAt = Date.now();
    if (JSON.stringify(st) === before) return result ?? { ok: true };
    const { data: upd } = await admin.from('game_states').update({ state: st, version: row.version + 1, updated_at: new Date().toISOString() })
      .eq('table_id', tableId).eq('version', row.version).select('version');
    if (!upd?.length) continue; // çakışma: yeniden dene
    await writeViews(tableId, st, row.version + 1);
    if (st.game.phase === 'gameOver' && t.status === 'playing') await payout(tableId, st, t);
    return result ?? { ok: true };
  }
  throw new UserError('Masa meşgul, tekrar dene.');
}

function seatOf(st: Stored, uid: string): number {
  const i = st.meta.seats.findIndex((s) => s.userId === uid);
  if (i < 0) throw new UserError('Bu masada değilsiniz.');
  return i;
}

function act(st: Stored, uid: string, a: Action) {
  const pi = seatOf(st, uid);
  if (st.meta.seats[pi].left) throw new UserError('Masadan ayrıldınız.');
  if (st.meta.pendingAsk) throw new UserError('Çifte Git cevabı bekleniyor.');
  if (a.type === 'take') return humanTake(st, uid, !!(a as { declareCift?: boolean }).declareCift);
  st.game = apply(st.game, pi, a);
  if (a.type === 'nextHand') st.meta.handOverAt = null;
}

function humanTake(st: Stored, uid: string, declareCift: boolean) {
  const pi = seatOf(st, uid);
  if (st.meta.pendingAsk) throw new UserError('Çifte Git cevabı bekleniyor.');
  const chk = checkTake(st.game, pi);
  if (!chk.allowed) throw new UserError(chk.reason!);
  if (chk.needsCift) {
    if (!declareCift) return { needsCift: true };
    st.game = apply(st.game, pi, { type: 'take', declareCift: true });
    return { ok: true };
  }
  if (chk.askPrevious !== null) {
    const prev = st.meta.seats[chk.askPrevious];
    if (prev.isBot) {
      if (botAnswersCift(st.game, chk.askPrevious)) {
        st.game = apply(st.game, chk.askPrevious, { type: 'declareCift' });
        return { message: `${prev.name} Çifte Git dedi. Bu kartı alamazsın.` };
      }
    } else {
      st.meta.pendingAsk = { prev: chk.askPrevious, taker: pi, deadline: Date.now() + ASK_MS };
      return { waitingAnswer: true };
    }
  }
  st.game = apply(st.game, pi, { type: 'take' });
  return { ok: true };
}

function answerAsk(st: Stored, uid: string, yes: boolean) {
  const pi = seatOf(st, uid);
  const ask = st.meta.pendingAsk;
  if (!ask || ask.prev !== pi) throw new UserError('Cevap beklenen bir soru yok.');
  resolveAsk(st, yes);
}

function resolveAsk(st: Stored, yes: boolean) {
  const ask = st.meta.pendingAsk!;
  st.meta.pendingAsk = null;
  st.meta.turnStartedAt = Date.now();
  if (yes) {
    st.game = apply(st.game, ask.prev, { type: 'declareCift' });
    if (st.meta.seats[ask.taker].isBot) st.game = apply(st.game, ask.taker, { type: 'draw' });
  } else {
    st.game = apply(st.game, ask.taker, { type: 'take' });
  }
}

function autoResolve(st: Stored) {
  if (st.meta.pendingAsk && Date.now() >= st.meta.pendingAsk.deadline) resolveAsk(st, false);
  if (st.game.phase === 'handOver') {
    if (st.meta.handOverAt === null) st.meta.handOverAt = Date.now();
    else if (Date.now() - st.meta.handOverAt >= HAND_OVER_MS || st.meta.seats.every((s) => s.isBot || s.left)) {
      st.game = apply(st.game, 0, { type: 'nextHand' });
      st.meta.handOverAt = null;
    }
  }
}

/** Sıradaki oyuncu bot olduğu sürece botları oynatır. */
function runBots(st: Stored) {
  for (let guard = 0; guard < 2000; guard++) {
    const g = st.game;
    if (g.phase !== 'playing' || st.meta.pendingAsk) return;
    const pi = g.current;
    if (!st.meta.seats[pi].isBot) return;
    const me = g.players[pi];
    if (g.turn.phase === 'draw' && !me.cift && me.opened === 'none' && botShouldDeclareCift(g, pi)) { st.game = apply(g, pi, { type: 'declareCift' }); continue; }
    let a: Action = botAction(g, pi);
    if (a.type === 'take') {
      const chk = checkTake(g, pi);
      if (chk.askPrevious !== null) {
        const prev = st.meta.seats[chk.askPrevious];
        if (!prev.isBot && !prev.left) { st.meta.pendingAsk = { prev: chk.askPrevious, taker: pi, deadline: Date.now() + ASK_MS }; return; }
        if (botAnswersCift(g, chk.askPrevious)) { st.game = apply(g, chk.askPrevious, { type: 'declareCift' }); a = { type: 'draw' }; }
      }
    }
    try { st.game = apply(st.game, pi, a); }
    catch (e) {
      if (!(e instanceof RuleError)) throw e;
      const s = st.game;
      if (s.turn.phase === 'draw') st.game = apply(s, pi, { type: 'draw' });
      else if (s.turn.taken) st.game = apply(s, pi, { type: 'undoTake' });
      else {
        const h = s.players[pi].hand.filter((c) => !c.joker);
        st.game = apply(s, pi, { type: 'discard', cardId: (h[0] ?? s.players[pi].hand[0]).id });
      }
    }
  }
}

/** Süre dolunca: yerden alma geri alınır, desteden çekilir, en soldaki kart (yoksa ilk kart) atılır. */
function autoMove(st: Stored, pi: number, cardId: string | null) {
  if (st.game.phase !== 'playing' || st.game.current !== pi || st.meta.pendingAsk) return;
  if (st.game.turn.taken) st.game = apply(st.game, pi, { type: 'undoTake' });
  if (st.game.turn.phase === 'draw') st.game = apply(st.game, pi, { type: 'draw' });
  const hand = st.game.players[pi].hand;
  const id = cardId && hand.some((c) => c.id === cardId) ? cardId : hand[0].id;
  st.game = apply(st.game, pi, { type: 'discard', cardId: id });
}

function timeoutMove(st: Stored, uid: string, cardId: string | null) {
  const pi = seatOf(st, uid);
  if (st.game.current !== pi || Date.now() - (st.meta.turnStartedAt ?? 0) < TURN_MS - 1000) return { ok: false };
  autoMove(st, pi, cardId);
  return { ok: true };
}

async function tick(st: Stored, _t: Record<string, unknown>, uid: string) {
  const tableId = String(_t.id);
  const pi = seatOf(st, uid);
  const now = new Date();
  await admin.from('table_players').update({ last_seen: now.toISOString() }).eq('table_id', tableId).eq('seat', pi);
  const seat = st.meta.seats[pi];
  // bağlantısı kopmuş oyuncu geri döndü: kontrolü geri al
  if (seat.isBot && !seat.left && seat.userId) {
    seat.isBot = false;
    st.game.players[pi].isBot = false;
    await admin.from('table_players').update({ is_bot: false, bot_reason: null }).eq('table_id', tableId).eq('seat', pi);
  }
  const g = st.game;
  if (g.phase === 'playing' && !st.meta.pendingAsk && !st.meta.seats[g.current].isBot && Date.now() - (st.meta.turnStartedAt ?? Date.now()) > TURN_MS + 7000) autoMove(st, g.current, null);
  if (st.meta.vsBots) return;
  const { data: players } = await admin.from('table_players').select('*').eq('table_id', tableId);
  for (const p of players ?? []) {
    const s = st.meta.seats[p.seat];
    if (!s?.userId || s.isBot) continue;
    if (now.getTime() - new Date(p.last_seen).getTime() > DISCONNECT_MS) {
      s.isBot = true;
      st.game.players[p.seat].isBot = true;
      await admin.from('table_players').update({ is_bot: true, bot_reason: 'disconnected' }).eq('table_id', tableId).eq('seat', p.seat);
    }
  }
}

async function leave(st: Stored, t: Record<string, unknown>, uid: string) {
  const pi = seatOf(st, uid);
  const s = st.meta.seats[pi];
  s.left = true; s.isBot = true;
  st.game.players[pi].isBot = true;
  if (st.meta.pendingAsk?.prev === pi) resolveAsk(st, false);
  await admin.from('table_players').update({ is_bot: true, bot_reason: 'disconnected', left_at: new Date().toISOString() }).eq('table_id', String(t.id)).eq('seat', pi);
  if (st.meta.vsBots || !st.meta.seats.some((x) => x.userId && !x.left)) {
    await admin.from('game_tables').update({ status: 'abandoned', finished_at: new Date().toISOString() }).eq('id', String(t.id)).eq('status', 'playing');
  }
  return { ok: true };
}

// ------------------------------------------------------------ görünümler ve ödül

async function writeViews(tableId: string, st: Stored, version: number) {
  const rows = st.meta.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.userId).map(({ s, i }) => ({
    table_id: tableId, user_id: s.userId, version, updated_at: new Date().toISOString(),
    view: { ...viewFor(st.game, i), meta: { tableId, seat: i, seats: st.meta.seats.map((x) => ({ name: x.name, isBot: x.isBot, left: x.left })), pendingAsk: st.meta.pendingAsk, vsBots: st.meta.vsBots, handOverAt: st.meta.handOverAt, turnStartedAt: st.meta.turnStartedAt ?? null, serverNow: Date.now() } },
  }));
  if (rows.length) await admin.from('player_views').upsert(rows);
}

async function payout(tableId: string, st: Stored, t: Record<string, unknown>) {
  const { data: claimed } = await admin.from('game_tables').update({ status: 'finished', finished_at: new Date().toISOString() }).eq('id', tableId).eq('status', 'playing').select().single();
  if (!claimed) return; // ödül zaten dağıtıldı
  const eligible = st.meta.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.userId && !s.left && !s.isBot);
  let winner = st.game.winner!;
  if (!eligible.some((e) => e.i === winner)) {
    const finals = finalScores(st.game);
    const best = eligible.sort((a, b) => finals[a.i].final - finals[b.i].final)[0];
    winner = best ? best.i : -1;
  }
  const winnerId = winner >= 0 ? st.meta.seats[winner].userId : null;
  if (winnerId) {
    if (st.meta.vsBots) {
      if (t.rewarded) await admin.rpc('chip_apply', { p_user: winnerId, p_amount: BOT_WIN, p_reason: 'bot_win', p_ref: tableId });
    } else {
      const humans = Number(t.human_count) || 1;
      await admin.rpc('chip_apply', { p_user: winnerId, p_amount: humans * ENTRY + BONUS, p_reason: 'game_win', p_ref: tableId });
    }
  }
  await admin.from('game_tables').update({ winner_id: winnerId }).eq('id', tableId);
  for (const s of st.meta.seats) if (s.userId) await admin.rpc('maybe_reward_referral', { p_invitee: s.userId });
}
