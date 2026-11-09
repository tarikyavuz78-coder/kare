import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase, Profile } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import Feed from './Feed';

export default function ProfilePage() {
  const { username } = useParams();
  const { profile: me } = useAuth();
  const [p, setP] = useState<Profile | null | undefined>(undefined);
  const [stats, setStats] = useState({ followers: 0, following: 0, iFollow: false, friend: 'none' as 'none' | 'pending' | 'accepted' });
  const load = async () => {
    const { data } = await supabase.from('profiles').select('*').eq('username', username).maybeSingle();
    setP(data as Profile | null);
    if (!data || !me) return;
    const [fr, fg, mine, fs] = await Promise.all([
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', data.id),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', data.id),
      supabase.from('follows').select('*').match({ follower_id: me.id, followee_id: data.id }),
      supabase.from('friendships').select('status').or(`and(requester_id.eq.${me.id},addressee_id.eq.${data.id}),and(requester_id.eq.${data.id},addressee_id.eq.${me.id})`),
    ]);
    setStats({ followers: fr.count ?? 0, following: fg.count ?? 0, iFollow: !!mine.data?.length, friend: (fs.data?.[0]?.status as 'pending' | 'accepted') ?? 'none' });
  };
  useEffect(() => { load(); }, [username, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (p === undefined) return <p className="muted">Yükleniyor…</p>;
  if (!p) return <p>Bu kullanıcı bulunamadı.</p>;
  const self = me?.id === p.id;
  const follow = async () => {
    if (stats.iFollow) await supabase.from('follows').delete().match({ follower_id: me!.id, followee_id: p.id });
    else await supabase.from('follows').insert({ follower_id: me!.id, followee_id: p.id });
    load();
  };
  const befriend = async () => { await supabase.from('friendships').insert({ requester_id: me!.id, addressee_id: p.id }); load(); };
  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="panel" style={{ padding: 20, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="avatar" style={{ width: 72, height: 72, fontSize: 28, background: '#2D6F8F' }} aria-hidden="true">{p.display_name[0]?.toUpperCase()}</div>
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 22 }}>{p.display_name}</h1>
          <span className="muted">@{p.username}</span>
          {p.bio && <p style={{ margin: 0 }}>{p.bio}</p>}
          <span className="muted" style={{ fontSize: 14 }}>{stats.followers} takipçi · {stats.following} takip</span>
        </div>
        {!self && (
          <div className="row">
            <button className={`btn ${stats.iFollow ? '' : 'btn-gold'}`} onClick={follow}>{stats.iFollow ? 'Takibi bırak' : 'Takip et'}</button>
            <button className="btn" onClick={befriend} disabled={stats.friend !== 'none'}>
              {stats.friend === 'accepted' ? 'Arkadaşsınız' : stats.friend === 'pending' ? 'İstek gönderildi' : 'Arkadaş ekle'}
            </button>
          </div>
        )}
      </section>
      <Feed authorId={p.id} />
    </div>
  );
}
