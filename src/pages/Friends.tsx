import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

interface Row { requester_id: string; addressee_id: string; status: string; requester: { username: string } | null; addressee: { username: string } | null; }

export default function Friends() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ username: string; display_name: string }[]>([]);
  const load = async () => {
    const { data } = await supabase.from('friendships').select('requester_id, addressee_id, status, requester:profiles!friendships_requester_id_fkey(username), addressee:profiles!friendships_addressee_id_fkey(username)');
    setRows((data ?? []) as unknown as Row[]);
  };
  useEffect(() => { load(); }, []);
  const search = async () => {
    if (q.trim().length < 2) return;
    const { data } = await supabase.from('profiles').select('username, display_name').ilike('username', `%${q.trim()}%`).limit(20);
    setFound(data ?? []);
  };
  const accept = async (r: Row) => { await supabase.from('friendships').update({ status: 'accepted' }).match({ requester_id: r.requester_id, addressee_id: r.addressee_id }); load(); };
  const remove = async (r: Row) => { await supabase.from('friendships').delete().match({ requester_id: r.requester_id, addressee_id: r.addressee_id }); load(); };
  const incoming = rows.filter((r) => r.status === 'pending' && r.addressee_id === profile?.id);
  const friends = rows.filter((r) => r.status === 'accepted');
  const other = (r: Row) => (r.requester_id === profile?.id ? r.addressee : r.requester)?.username;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="panel stack" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 18 }}>Kullanıcı ara</h2>
        <div className="row">
          <label htmlFor="q" style={{ position: 'absolute', left: -9999 }}>Kullanıcı adı</label>
          <input id="q" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Kullanıcı adı"
            style={{ flex: 1, minHeight: 44, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line-strong)', background: '#08211A', color: 'var(--text)' }} />
          <button className="btn btn-gold" onClick={search}>Ara</button>
        </div>
        {found.map((f) => <Link key={f.username} to={`/u/${f.username}`}>@{f.username} · {f.display_name}</Link>)}
      </section>
      {incoming.length > 0 && (
        <section className="panel stack" style={{ padding: 20 }}>
          <h2 style={{ fontSize: 18 }}>Arkadaşlık istekleri</h2>
          {incoming.map((r) => (
            <div key={r.requester_id} className="row" style={{ justifyContent: 'space-between' }}>
              <Link to={`/u/${r.requester?.username}`}>@{r.requester?.username}</Link>
              <div className="row"><button className="btn btn-gold" onClick={() => accept(r)}>Kabul et</button><button className="btn" onClick={() => remove(r)}>Reddet</button></div>
            </div>
          ))}
        </section>
      )}
      <section className="panel stack" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 18 }}>Arkadaşların ({friends.length})</h2>
        {friends.length === 0 && <p className="muted" style={{ margin: 0 }}>Henüz arkadaşın yok. Yukarıdan arayıp istek gönderebilirsin.</p>}
        {friends.map((r) => (
          <div key={r.requester_id + r.addressee_id} className="row" style={{ justifyContent: 'space-between' }}>
            <Link to={`/u/${other(r)}`}>@{other(r)}</Link>
            <button className="btn btn-ghost" onClick={() => remove(r)}>Arkadaşlıktan çıkar</button>
          </div>
        ))}
      </section>
    </div>
  );
}
