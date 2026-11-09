import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, errorText } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export default function NewPost() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !profile) return;
    setBusy(true); setErr(null);
    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${profile.id}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from('posts').upload(path, file, { contentType: file.type });
      if (up.error) throw up.error;
      const { error } = await supabase.from('posts').insert({ author_id: profile.id, image_path: path, caption });
      if (error) throw error;
      nav('/');
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="panel stack" style={{ padding: 24, maxWidth: 520 }}>
      <h1 style={{ fontSize: 22 }}>Fotoğraf paylaş</h1>
      <div className="field"><label htmlFor="photo">Fotoğraf (JPG, PNG veya WEBP, en fazla 8 MB)</label>
        <input id="photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /></div>
      {file && <img src={URL.createObjectURL(file)} alt="Önizleme" style={{ maxWidth: '100%', borderRadius: 12 }} />}
      <div className="field"><label htmlFor="caption">Açıklama</label>
        <textarea id="caption" rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} /></div>
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn btn-gold" disabled={!file || busy}>{busy ? 'Paylaşılıyor…' : 'Paylaş'}</button>
    </form>
  );
}
