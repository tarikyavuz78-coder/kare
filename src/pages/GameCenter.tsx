import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

const REASONS: Record<string, string> = {
  daily_bonus: 'Günlük çip', referral: 'Arkadaş daveti', game_entry: '71 masa girişi', game_win: '71 kazanç', game_refund: '71 iade',
  bot_entry: 'Bota karşı giriş', bot_win: 'Bota karşı kazanç', candy_reward: 'Türk Şekerleri ödülü', candy_life: 'Türk Şekerleri can', admin: 'Yönetici',
};

export default function GameCenter() {
  const { profile } = useAuth();
  const [ledger, setLedger] = useState<{ id: number; amount: number; reason: string; created_at: string }[]>([]);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    supabase.from('chip_ledger').select('id, amount, reason, created_at').order('created_at', { ascending: false }).limit(30).then(({ data }) => setLedger(data ?? []));
  }, [profile?.chips]);
  if (!profile) return null;
  const link = `${location.origin}${location.pathname}#/giris?davet=${profile.referral_code}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="panel" style={{ padding: 20, display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="muted">Çip bakiyen</span>
          <strong style={{ fontFamily: 'Sora', fontSize: 34, color: 'var(--gold-soft)', fontVariantNumeric: 'tabular-nums' }}>{profile.chips.toLocaleString('tr-TR')}</strong>
          <span className="muted" style={{ fontSize: 13 }}>Her gün ilk girişte 5.000 çip. Çipler sanaldır, satılmaz ve paraya çevrilemez.</span>
        </div>
      </section>
      <section className="grid-cards">
        <Link to="/71" className="panel stack" style={{ padding: 20, textDecoration: 'none', color: 'var(--text)' }}>
          <div className="logo" aria-hidden="true">71</div>
          <h2 style={{ fontSize: 18 }}>71</h2>
          <span className="muted">Online masa: giriş 500 çip, kazanan 2.000–3.000 çip. Bota karşı: kazanırsan 750 çip.</span>
        </Link>
        <Link to="/sekerler" className="panel stack" style={{ padding: 20, textDecoration: 'none', color: 'var(--text)' }}>
          <div className="logo" aria-hidden="true" style={{ background: '#C8507A', color: '#fff' }}>TŞ</div>
          <h2 style={{ fontSize: 18 }}>Türk Şekerleri</h2>
          <span className="muted">Her 10 seviyede 5.000 çip. Canın biterse 100 çiple yeni can.</span>
        </Link>
      </section>
      <section className="panel stack" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 18 }}>Arkadaşını davet et, 10.000 çip kazan</h2>
        <p className="muted" style={{ margin: 0 }}>Davet ettiğin arkadaşın e-postasını doğrulayıp ilk oyununu bitirince 10.000 çip hesabına eklenir.</p>
        <div className="row">
          <code style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', background: '#08211A', padding: '10px 12px', borderRadius: 10, userSelect: 'all' }}>{link}</code>
          <button className="btn btn-gold" onClick={copy}>{copied ? 'Kopyalandı' : 'Bağlantıyı kopyala'}</button>
        </div>
        <span className="muted" style={{ fontSize: 13 }}>Davet kodun: <b>{profile.referral_code}</b></span>
      </section>
      <section className="panel stack" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 18 }}>Çip hareketleri</h2>
        <table className="score-table">
          <thead><tr><th>Tarih</th><th>İşlem</th><th>Çip</th></tr></thead>
          <tbody>{ledger.map((l) => (
            <tr key={l.id}><td>{new Date(l.created_at).toLocaleString('tr-TR')}</td><td>{REASONS[l.reason] ?? l.reason}</td>
              <td style={{ color: l.amount >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 700 }}>{l.amount > 0 ? '+' : ''}{l.amount.toLocaleString('tr-TR')}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}
