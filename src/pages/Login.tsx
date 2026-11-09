import { FormEvent, useState } from 'react';
import { supabase, deviceHash, errorText } from '../lib/supabase';

export default function Login() {
  const params = new URLSearchParams(location.search || location.hash.split('?')[1] || '');
  const invite = params.get('davet') ?? '';
  const [mode, setMode] = useState<'in' | 'up'>(invite ? 'up' : 'in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState(invite);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null); setMsg(null); setBusy(true);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        if (!/^[a-z0-9_.]{3,24}$/.test(username)) throw new Error('Kullanıcı adı 3–24 karakter olmalı; küçük harf, rakam, nokta ve alt çizgi kullanılabilir.');
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { username, display_name: username, referral_code: code.trim() || undefined, device_hash: deviceHash() } },
        });
        if (error) throw error;
        setMsg('Hesabın oluşturuldu. E-posta adresine gelen bağlantıyla hesabını doğrula, sonra giriş yap.');
        setMode('in');
      }
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="shell" style={{ paddingTop: 48 }}>
      <form onSubmit={submit} className="panel stack" style={{ padding: 24, maxWidth: 420, margin: '0 auto' }}>
        <div className="row"><div className="logo" aria-hidden="true">K</div><h1 style={{ fontSize: 26 }}>Kare</h1></div>
        <p className="muted" style={{ margin: 0 }}>Fotoğraflarını paylaş, arkadaşlarınla 71 ve Türk Şekerleri oyna.</p>
        <div className="row" role="tablist">
          <button type="button" className={`btn ${mode === 'in' ? 'btn-gold' : 'btn-ghost'}`} onClick={() => setMode('in')}>Giriş yap</button>
          <button type="button" className={`btn ${mode === 'up' ? 'btn-gold' : 'btn-ghost'}`} onClick={() => setMode('up')}>Üye ol</button>
        </div>
        {mode === 'up' && (
          <div className="field"><label htmlFor="username">Kullanıcı adı</label>
            <input id="username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoComplete="username" required /></div>
        )}
        <div className="field"><label htmlFor="email">E-posta</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></div>
        <div className="field"><label htmlFor="password">Şifre</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={6} required /></div>
        {mode === 'up' && (
          <div className="field"><label htmlFor="code">Davet kodu (varsa)</label>
            <input id="code" value={code} onChange={(e) => setCode(e.target.value)} /></div>
        )}
        {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
        {msg && <p style={{ margin: 0, color: 'var(--ok)' }} role="status">{msg}</p>}
        <button className="btn btn-gold" disabled={busy}>{mode === 'in' ? 'Giriş yap' : 'Üye ol'}</button>
      </form>
    </div>
  );
}
