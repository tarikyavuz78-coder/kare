import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, postImageUrl, errorText } from '../lib/supabase';
import { useAuth } from '../lib/auth';

interface Post { id: string; author_id: string; image_path: string; caption: string; created_at: string; author: { username: string; display_name: string } | null; likes: { user_id: string }[]; comments: { count: number }[]; }

export default function Feed({ authorId }: { authorId?: string }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => {
    let q = supabase.from('posts').select('id, author_id, image_path, caption, created_at, author:profiles!posts_author_id_fkey(username, display_name), likes(user_id), comments(count)').order('created_at', { ascending: false }).limit(60);
    if (authorId) q = q.eq('author_id', authorId);
    const { data, error } = await q;
    if (error) setErr(errorText(error)); else setPosts(data as unknown as Post[]);
  };
  useEffect(() => { load(); }, [authorId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <p className="error">{err}</p>;
  if (!posts) return <p className="muted">Yükleniyor…</p>;
  if (!posts.length) return (
    <div className="panel stack" style={{ padding: 24, alignItems: 'flex-start' }}>
      <h2 style={{ fontSize: 18 }}>Henüz gönderi yok</h2>
      <p className="muted" style={{ margin: 0 }}>İlk fotoğrafı sen paylaş ya da arkadaşlarını takip et.</p>
      <Link className="btn btn-gold" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} to="/paylas">Fotoğraf paylaş</Link>
    </div>
  );
  return <div className="grid-cards">{posts.map((p) => <PostCard key={p.id} post={p} onChange={load} />)}</div>;
}

function PostCard({ post, onChange }: { post: Post; onChange: () => void }) {
  const { profile } = useAuth();
  const liked = post.likes.some((l) => l.user_id === profile?.id);
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<{ id: string; body: string; author: { username: string } | null }[]>([]);
  const [text, setText] = useState('');
  const [reported, setReported] = useState(false);
  const toggleLike = async () => {
    if (!profile) return;
    if (liked) await supabase.from('likes').delete().match({ post_id: post.id, user_id: profile.id });
    else await supabase.from('likes').insert({ post_id: post.id, user_id: profile.id });
    onChange();
  };
  const loadComments = async () => {
    const { data } = await supabase.from('comments').select('id, body, author:profiles!comments_author_id_fkey(username)').eq('post_id', post.id).order('created_at');
    setComments((data ?? []) as unknown as typeof comments);
  };
  const send = async () => {
    if (!text.trim() || !profile) return;
    await supabase.from('comments').insert({ post_id: post.id, author_id: profile.id, body: text.trim() });
    setText(''); loadComments(); onChange();
  };
  const report = async () => {
    if (!profile) return;
    await supabase.from('reports').insert({ reporter_id: profile.id, target_type: 'post', target_id: post.id, reason: 'Uygunsuz içerik' });
    setReported(true);
  };
  return (
    <article className="panel post">
      <img src={postImageUrl(post.image_path)} alt={post.caption || 'Gönderi'} loading="lazy" />
      <div className="post-body">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Link to={`/u/${post.author?.username}`} style={{ fontWeight: 700, textDecoration: 'none' }}>@{post.author?.username}</Link>
          <span className="muted" style={{ fontSize: 12 }}>{new Date(post.created_at).toLocaleDateString('tr-TR')}</span>
        </div>
        {post.caption && <p style={{ margin: 0 }}>{post.caption}</p>}
        <div className="row">
          <button className={`btn ${liked ? 'btn-gold' : ''}`} onClick={toggleLike} aria-pressed={liked}>♥ {post.likes.length}</button>
          <button className="btn" onClick={() => { setOpen(!open); if (!open) loadComments(); }} aria-expanded={open}>Yorumlar ({post.comments[0]?.count ?? 0})</button>
          {post.author_id !== profile?.id && <button className="btn btn-ghost" onClick={report} disabled={reported}>{reported ? 'Bildirildi' : 'Şikâyet et'}</button>}
        </div>
        {open && (
          <div className="stack" style={{ gap: 6 }}>
            {comments.map((c) => <p key={c.id} style={{ margin: 0, fontSize: 14 }}><b>@{c.author?.username}</b> {c.body}</p>)}
            <div className="row">
              <label htmlFor={`c-${post.id}`} className="muted" style={{ position: 'absolute', left: -9999 }}>Yorum yaz</label>
              <input id={`c-${post.id}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Yorum yaz…" maxLength={1000}
                style={{ flex: 1, minHeight: 44, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line-strong)', background: '#08211A', color: 'var(--text)' }} />
              <button className="btn btn-gold" onClick={send}>Gönder</button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
