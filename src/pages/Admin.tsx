import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export default function Admin() {
  const { profile } = useAuth();
  const [reports, setReports] = useState<{ id: string; target_type: string; target_id: string; reason: string; status: string; created_at: string }[]>([]);
  const load = async () => {
    const { data } = await supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(100);
    setReports(data ?? []);
  };
  useEffect(() => { load(); }, []);
  if (!profile?.is_admin) return <p>Bu sayfa yalnızca yöneticiye açık.</p>;
  const set = async (id: string, status: string) => { await supabase.from('reports').update({ status }).eq('id', id); load(); };
  const removePost = async (id: string) => { await supabase.from('posts').delete().eq('id', id); };
  return (
    <section className="panel stack" style={{ padding: 20 }}>
      <h1 style={{ fontSize: 22 }}>Şikâyetler</h1>
      <div style={{ overflowX: 'auto' }}>
        <table className="score-table">
          <thead><tr><th>Tarih</th><th>Tür</th><th>Neden</th><th>Durum</th><th>İşlem</th></tr></thead>
          <tbody>{reports.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.created_at).toLocaleString('tr-TR')}</td><td>{r.target_type}</td><td>{r.reason}</td><td>{r.status}</td>
              <td><div className="row" style={{ justifyContent: 'flex-end' }}>
                {r.target_type === 'post' && <button className="btn" onClick={async () => { await removePost(r.target_id); set(r.id, 'resolved'); }}>Gönderiyi sil</button>}
                <button className="btn btn-ghost" onClick={() => set(r.id, 'dismissed')}>Yoksay</button>
              </div></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
