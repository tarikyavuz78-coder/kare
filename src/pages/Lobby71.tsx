import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { callGame } from '../game71/OnlineGame';

interface TableRow { id: string; seats: number; status: string; is_private: boolean; vs_bots: boolean; host: { username: string } | null; players: { user_id: string | null; is_bot: boolean }[]; }

export default function Lobby71() {
  const { profile, refresh } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState<TableRow[]>([]);
  const [mine, setMine] = useState<TableRow[]>([]);
  const [invites, setInvites] = useState<{ table_id: string; inviter: { username: string } | null }[]>([]);
  const [seats, setSeats] = useState(4);
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    if (!profile) return;
    const sel = 'id, seats, status, is_private, vs_bots, host:profiles!game_tables_host_id_fkey(username), players:table_players(user_id, is_bot)';
    const [o, m, i] = await Promise.all([
      supabase.from('game_tables').select(sel).eq('status', 'waiting').eq('is_private', false).order('created_at', { ascending: false }).limit(30),
      supabase.from('game_tables').select(sel + ', me:table_players!inner(user_id, left_at)').in('status', ['waiting', 'playing']).eq('me.user_id', profile.id).is('me.left_at', null).order('created_at', { ascending: false }),
      supabase.from('table_invites').select('table_id, inviter:profiles!table_invites_inviter_id_fkey(username)').eq('invitee_id', profile.id),
    ]);
    setOpen((o.data ?? []) as unknown as TableRow[]);
    setMine((m.data ?? []) as unknown as TableRow[]);
    setInvites((i.data ?? []) as unknown as typeof invites);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel('lobi').on('postgres_changes', { event: '*', schema: 'public', table: 'game_tables' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      const r = await callGame<{ tableId: string; rewarded?: boolean }>(body);
      await refresh();
      nav(`/71/masa/${r.tableId}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="panel stack" style={{ padding: 20 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row"><div className="logo" aria-hidden="true">71</div><h1 style={{ fontSize: 22 }}>71 Lobisi</h1></div>
          <span className="chips-badge">{profile?.chips.toLocaleString('tr-TR')} çip</span>
        </div>
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }} className="stack">
          <legend style={{ fontWeight: 600, marginBottom: 8 }}>Masa büyüklüğü</legend>
          <div className="row">{[2, 3, 4].map((n) => <button key={n} className={`btn ${seats === n ? 'btn-gold' : ''}`} aria-pressed={seats === n} onClick={() => setSeats(n)}>{n} kişilik</button>)}</div>
        </fieldset>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} style={{ width: 20, height: 20 }} /> Yalnızca davet ettiklerim katılsın</label>
        <div className="row">
          <button className="btn btn-gold" disabled={busy} onClick={() => run({ op: 'create', seats, isPrivate: priv })}>Masa kur (500 çip)</button>
          <button className="btn" disabled={busy} onClick={() => run({ op: 'create', seats, vsBots: true })}>Bota karşı oyna (500 çip, kazanırsan 750)</button>
          <button className="btn btn-ghost" onClick={() => nav('/71/pratik')}>Pratik (çipsiz)</button>
        </div>
        <span className="muted" style={{ fontSize: 13 }}>Online masada kazanan, girişlerin toplamını ve 1.000 çip ödülü alır. Boş koltuklara 15 saniye sonra bot oturur; botlar ödüle sayılmaz. Bota karşı ödül günde 10 oyunla sınırlı.</span>
        {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      </section>

      {invites.length > 0 && (
        <section className="panel stack" style={{ padding: 20 }}>
          <h2 style={{ fontSize: 18 }}>Masa davetleri</h2>
          {invites.map((i) => (
            <div key={i.table_id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>@{i.inviter?.username} seni masasına çağırıyor</span>
              <button className="btn btn-gold" disabled={busy} onClick={() => run({ op: 'join', tableId: i.table_id })}>Katıl (500 çip)</button>
            </div>
          ))}
        </section>
      )}

      {mine.length > 0 && (
        <section className="panel stack" style={{ padding: 20 }}>
          <h2 style={{ fontSize: 18 }}>Masaların</h2>
          {mine.map((t) => (
            <div key={t.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{t.vs_bots ? 'Bota karşı' : `${t.seats} kişilik masa`} · {t.status === 'waiting' ? 'bekliyor' : 'oynanıyor'}</span>
              <button className="btn" onClick={() => nav(`/71/masa/${t.id}`)}>Masaya dön</button>
            </div>
          ))}
        </section>
      )}

      <section className="panel stack" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 18 }}>Açık masalar</h2>
        {open.length === 0 && <p className="muted" style={{ margin: 0 }}>Şu an bekleyen masa yok. Yukarıdan yeni bir masa kurabilirsin.</p>}
        {open.map((t) => (
          <div key={t.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span>@{t.host?.username} · {t.players.length}/{t.seats} oyuncu</span>
            <button className="btn btn-gold" disabled={busy || t.players.some((p) => p.user_id === profile?.id)} onClick={() => run({ op: 'join', tableId: t.id })}>Katıl (500 çip)</button>
          </div>
        ))}
      </section>
    </div>
  );
}
