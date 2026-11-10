import { useEffect, useRef, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Action } from '../engine/game';
import Table71, { ConfirmBox, TableView } from './Table71';

interface Meta { tableId: string; seat: number; seats: { name: string; isBot: boolean; left: boolean }[]; pendingAsk: { prev: number; taker: number; deadline: number } | null; vsBots: boolean; turnStartedAt?: number | null; serverNow?: number; }
type View = TableView & { meta: Meta };

export async function callGame<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('game71', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const j = await error.context.json().catch(() => null);
      throw new Error(j?.error ?? 'Sunucu hatası.');
    }
    throw new Error('Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.');
  }
  return data as T;
}

export default function OnlineGame({ tableId, onExit }: { tableId: string; onExit: () => void }) {
  const { profile, refresh } = useAuth();
  const [view, setView] = useState<View | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [takeCift, setTakeCift] = useState(false);
  const [recvAt, setRecvAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [table, setTable] = useState<{ status: string; seats: number; created_at: string } | null>(null);
  const [seated, setSeated] = useState<{ seat: number; user: { username: string } | null; is_bot: boolean }[]>([]);
  const [messages, setMessages] = useState<{ id: number; body: string; user: { username: string } | null }[]>([]);
  const [chat, setChat] = useState('');
  const lastVersion = useRef(0);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };
  const call = async (body: Record<string, unknown>) => {
    try { return await callGame({ tableId, ...body }); } catch (e) { say((e as Error).message); return null; }
  };

  // görünüm, masa ve sohbet
  useEffect(() => {
    if (!profile) return;
    const loadView = async () => {
      const { data } = await supabase.from('player_views').select('view, version').eq('table_id', tableId).eq('user_id', profile.id).maybeSingle();
      if (data && data.version >= lastVersion.current) { lastVersion.current = data.version; setView(data.view as View); setRecvAt(Date.now()); }
    };
    const loadTable = async () => {
      const { data: t } = await supabase.from('game_tables').select('status, seats, created_at').eq('id', tableId).single();
      setTable(t);
      const { data: p } = await supabase.from('table_players').select('seat, is_bot, user:profiles(username)').eq('table_id', tableId).order('seat');
      setSeated((p ?? []) as unknown as typeof seated);
    };
    const loadChat = async () => {
      const { data } = await supabase.from('table_messages').select('id, body, user:profiles(username)').eq('table_id', tableId).order('id').limit(100);
      setMessages((data ?? []) as unknown as typeof messages);
    };
    loadView(); loadTable(); loadChat();
    const ch = supabase.channel(`masa-${tableId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_views', filter: `user_id=eq.${profile.id}` }, (p) => {
        const row = p.new as { table_id: string; view: View; version: number };
        if (row.table_id === tableId && row.version >= lastVersion.current) { lastVersion.current = row.version; setView(row.view); setRecvAt(Date.now()); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_players', filter: `table_id=eq.${tableId}` }, loadTable)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_tables', filter: `id=eq.${tableId}` }, () => { loadTable(); refresh(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'table_messages', filter: `table_id=eq.${tableId}` }, loadChat)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tableId, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // yoklama: bağlantı takibi, 15 saniye sonra bot, süresi dolan sorular
  useEffect(() => {
    const beat = () => callGame({ op: 'tick', tableId }).catch(() => undefined);
    beat();
    const t = setInterval(beat, 5000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [tableId]);

  const act = async (a: Action) => { await call({ op: 'act', action: a }); };
  const takeRequest = async () => {
    const r = await call({ op: 'take' }) as { needsCift?: boolean; message?: string; waitingAnswer?: boolean } | null;
    if (r?.needsCift) setTakeCift(true);
    if (r?.message) say(r.message);
    if (r?.waitingAnswer) say('Önceki oyuncunun cevabı bekleniyor (5 saniye).');
  };
  const sendChat = async () => {
    if (!chat.trim() || !profile) return;
    await supabase.from('table_messages').insert({ table_id: tableId, user_id: profile.id, body: chat.trim().slice(0, 300) });
    setChat('');
  };

  const chatBox = (
    <section className="stack" style={{ gap: 8 }}>
      <h2 style={{ fontSize: 15 }}>Masa sohbeti</h2>
      <div className="log" style={{ maxHeight: 180, overflow: 'auto' }}>
        {messages.map((m) => <div key={m.id}><b>{m.user?.username}:</b> {m.body}</div>)}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <label htmlFor="chat" style={{ position: 'absolute', left: -9999 }}>Mesaj</label>
        <input id="chat" value={chat} onChange={(e) => setChat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendChat()} maxLength={300}
          style={{ flex: 1, minWidth: 0, minHeight: 40, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line-strong)', background: '#08211A', color: 'var(--text)' }} />
        <button className="btn" onClick={sendChat}>Gönder</button>
      </div>
    </section>
  );

  if (!view) {
    const left = table ? Math.max(0, 15 - Math.floor((now - new Date(table.created_at).getTime()) / 1000)) : 15;
    return (
      <div className="shell" style={{ paddingTop: 32 }}>
        <div className="panel stack" style={{ padding: 24, maxWidth: 520, margin: '0 auto' }}>
          <h1 style={{ fontSize: 22 }}>Oyuncular bekleniyor</h1>
          <p className="muted" style={{ margin: 0 }}>{left > 0 ? `${left} saniye sonra boş koltuklara bot oturacak.` : 'Masa hazırlanıyor…'}</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {Array.from({ length: table?.seats ?? 4 }, (_, i) => {
              const p = seated.find((x) => x.seat === i);
              return <li key={i}>{p ? (p.is_bot ? 'Bot' : `@${p.user?.username}`) : 'Boş koltuk'}</li>;
            })}
          </ul>
          <InviteFriends tableId={tableId} />
          {toast && <p className="error">{toast}</p>}
          <button className="btn btn-ghost" onClick={onExit}>Lobiye dön</button>
        </div>
      </div>
    );
  }

  const me = view.meta.seat;
  const ask = view.meta.pendingAsk;
  const askLeft = ask ? Math.max(0, Math.ceil((ask.deadline - now) / 1000)) : 0;
  const turnStart = view.meta.turnStartedAt && view.meta.serverNow ? recvAt - (view.meta.serverNow - view.meta.turnStartedAt) : null;
  return (
    <>
      <Table71 s={view} me={me} act={act} takeRequest={takeRequest} title={view.meta.vsBots ? 'Bota karşı' : 'Online masa'}
        onExit={async () => { if (view.phase !== 'gameOver') await call({ op: 'leave' }); onExit(); }}
        canAdvance={view.meta.vsBots}
        leaveText="Ayrılırsan giriş çipini kaybedersin ve bu oyuna geri dönemezsin."
        onTimeout={(cardId) => { call({ op: 'timeout', cardId }); }} turnStartedAt={turnStart} paused={!!ask}
        headerExtra={<span className="chips-badge">{profile?.chips.toLocaleString('tr-TR')} çip</span>}
        sideExtra={view.meta.vsBots ? undefined : chatBox}
        waitingText={ask && ask.prev !== me ? `${view.players[ask.prev].name} cevap veriyor… (${askLeft})` : view.phase === 'playing' && view.current !== me ? `${view.players[view.current].name} oynuyor…` : null} />
      {ask && ask.prev === me && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-label="Çifte Git sorusu">
          <div className="panel modal" style={{ maxWidth: 420 }}>
            <h2>Çifte Git?</h2>
            <p style={{ margin: 0 }}>{view.players[ask.taker].name} attığın kartı almak istiyor. Çifte Git dersen alamaz, ama sen bu el yalnızca çiftle açabilirsin.</p>
            <div className="row">
              <button className="btn btn-cift" onClick={() => call({ op: 'answer', yes: true })}>Çifte Git</button>
              <button className="btn" onClick={() => call({ op: 'answer', yes: false })}>Alsın ({askLeft})</button>
            </div>
          </div>
        </div>
      )}
      {takeCift && (
        <ConfirmBox title="Çifte Git" text="Önceki oyuncu Çifte Git dedi. Kartı almak için sen de Çifte Git demelisin. Bu el yalnızca çiftle açabilirsin."
          yes="Çifte Git ve al" onYes={() => { setTakeCift(false); call({ op: 'take', declareCift: true }); }} onNo={() => setTakeCift(false)} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function InviteFriends({ tableId }: { tableId: string }) {
  const { profile } = useAuth();
  const [friends, setFriends] = useState<{ id: string; username: string }[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  useEffect(() => {
    if (!profile) return;
    supabase.from('friendships').select('requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, username), addressee:profiles!friendships_addressee_id_fkey(id, username)').eq('status', 'accepted')
      .then(({ data }) => setFriends((data ?? []).map((r) => (r.requester_id === profile.id ? r.addressee : r.requester) as unknown as { id: string; username: string })));
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!friends.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <strong>Arkadaşını davet et</strong>
      {friends.map((f) => (
        <div key={f.id} className="row" style={{ justifyContent: 'space-between' }}>
          <span>@{f.username}</span>
          <button className="btn" disabled={sent.includes(f.id)} onClick={async () => {
            await supabase.from('table_invites').insert({ table_id: tableId, invitee_id: f.id, inviter_id: profile!.id });
            setSent((s) => [...s, f.id]);
          }}>{sent.includes(f.id) ? 'Davet edildi' : 'Davet et'}</button>
        </div>
      ))}
    </div>
  );
}
