import { useEffect, useMemo, useState } from 'react';
import { supabase, errorText } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Grid, SIZE, adjacent, findMatches, levelConfig, newGrid, resolve, rng, swap } from './logic';

const SWEETS = [
  { name: 'Lokum', color: '#E46A9A', shape: 'square' },
  { name: 'Baklava', color: '#E3A93B', shape: 'diamond' },
  { name: 'Akide', color: '#3F8FD8', shape: 'circle' },
  { name: 'Cezerye', color: '#E0702F', shape: 'pill' },
  { name: 'Pişmaniye', color: '#F2EEE3', shape: 'cloud' },
  { name: 'Fıstık ezmesi', color: '#79B84A', shape: 'triangle' },
] as const;

function Sweet({ kind }: { kind: number }) {
  if (kind < 0) return null;
  const s = SWEETS[kind];
  const common = { fill: s.color, stroke: 'rgba(0,0,0,.35)', strokeWidth: 2 };
  return (
    <svg viewBox="0 0 40 40" width="100%" height="100%" role="img" aria-label={s.name}>
      {s.shape === 'square' && <rect x="7" y="7" width="26" height="26" rx="6" {...common} />}
      {s.shape === 'diamond' && <polygon points="20,4 36,20 20,36 4,20" {...common} />}
      {s.shape === 'circle' && <circle cx="20" cy="20" r="14" {...common} />}
      {s.shape === 'pill' && <rect x="5" y="12" width="30" height="16" rx="8" {...common} />}
      {s.shape === 'cloud' && <path d="M10 28a7 7 0 0 1 1-14 9 9 0 0 1 17-2 7 7 0 0 1 2 16z" {...common} />}
      {s.shape === 'triangle' && <polygon points="20,5 36,33 4,33" {...common} />}
      <circle cx="15" cy="14" r="3" fill="rgba(255,255,255,.55)" />
    </svg>
  );
}

interface Progress { level: number; lives: number; lives_updated_at: string; }

export default function Candy() {
  const { profile, refresh } = useAuth();
  const [prog, setProg] = useState<Progress | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    const { data, error } = await supabase.rpc('candy_state');
    if (error) setMsg(errorText(error)); else setProg(data as Progress);
  };
  useEffect(() => { load(); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const start = async (level: number) => {
    setMsg(null);
    const { error } = await supabase.rpc('candy_start_level');
    if (error) { setMsg(errorText(error)); return; }
    setPlaying(level);
  };
  const buyLife = async () => {
    const { data, error } = await supabase.rpc('candy_buy_life');
    if (error) setMsg(errorText(error)); else { setProg(data as Progress); refresh(); }
  };
  const finish = async (won: boolean, level: number) => {
    if (won && prog && level < prog.level) {
      setMsg(`${level}. seviyeyi yeniden geçtin.`);
    } else if (won) {
      const { data, error } = await supabase.rpc('candy_complete_level', { p_level: level });
      if (error) setMsg(errorText(error));
      else setMsg(data.reward ? `Tebrikler! ${level}. seviyeyi geçtin ve 5.000 çip kazandın.` : `Tebrikler! ${level}. seviyeyi geçtin.`);
      refresh();
    } else {
      await supabase.rpc('candy_lose_level');
      setMsg(`${level}. seviyeyi geçemedin. 1 can gitti.`);
    }
    setPlaying(null);
    load();
  };

  if (playing !== null) return <Board level={playing} onEnd={(won) => finish(won, playing)} />;
  if (!prog) return <p className="muted">Yükleniyor…</p>;

  const nextLife = prog.lives < 5 ? Math.max(0, 1800 - Math.floor((now - new Date(prog.lives_updated_at).getTime()) / 1000)) : 0;
  const mm = String(Math.floor(nextLife / 60)).padStart(2, '0'), ss = String(nextLife % 60).padStart(2, '0');
  const levels = Array.from({ length: Math.max(50, prog.level + 4) }, (_, i) => i + 1);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="panel" style={{ padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 22 }}>Türk Şekerleri</h1>
          <span className="muted">Her 10 seviyede 5.000 çip. En fazla 5 can, her 30 dakikada 1 can yenilenir.</span>
        </div>
        <div className="row">
          <span className="chip chip-star" style={{ fontSize: 14 }} aria-label={`${prog.lives} can`}>♥ {prog.lives} / 5</span>
          {prog.lives < 5 && <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>Yeni can: {mm}:{ss}</span>}
          {prog.lives === 0 && <button className="btn btn-gold" onClick={buyLife}>100 çiple can al</button>}
        </div>
      </section>
      {msg && <p role="status" style={{ margin: 0, color: 'var(--gold-soft)' }}>{msg}</p>}
      <section className="panel" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Seviyeler</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 10 }}>
          {levels.map((l) => {
            const done = l < prog.level, current = l === prog.level;
            return (
              <button key={l} className={`btn ${current ? 'btn-gold' : ''}`} disabled={l > prog.level || prog.lives === 0}
                onClick={() => start(l)} aria-label={`${l}. seviye${done ? ', geçildi' : current ? ', sıradaki' : ', kilitli'}`}
                style={{ minHeight: 56, position: 'relative' }}>
                {l}{l % 10 === 0 && <span style={{ position: 'absolute', top: 2, right: 6, fontSize: 10 }}>5K</span>}
                {done && <span style={{ display: 'block', fontSize: 10, color: 'var(--ok)' }}>geçildi</span>}
              </button>
            );
          })}
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Geçilmiş seviyeleri tekrar oynayabilirsin; ödül yalnızca sıradaki seviyeyi ilk geçişte verilir.</p>
      </section>
    </div>
  );
}

function Board({ level, onEnd }: { level: number; onEnd: (won: boolean) => void }) {
  const cfg = levelConfig(level);
  const rand = useMemo(() => rng(Date.now() ^ (level * 7919)), [level]);
  const [grid, setGrid] = useState<Grid>(() => newGrid(cfg.kinds, rand));
  const [sel, setSel] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [moves, setMoves] = useState(cfg.moves);
  const [flash, setFlash] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<null | boolean>(null);

  const tap = (i: number) => {
    if (done !== null) return;
    if (sel === null) { setSel(i); return; }
    if (sel === i) { setSel(null); return; }
    if (!adjacent(sel, i)) { setSel(i); return; }
    const swapped = swap(grid, sel, i);
    const m = findMatches(swapped);
    setSel(null);
    if (!m.size) return; // geçersiz hamle: hamle hakkı düşmez
    setFlash(m);
    setGrid(swapped);
    setTimeout(() => {
      const r = resolve(swapped, cfg.kinds, rand);
      setGrid(r.grid);
      setFlash(new Set());
      const nextScore = score + r.score;
      const left = moves - 1;
      setScore(nextScore);
      setMoves(left);
      if (nextScore >= cfg.target) setDone(true);
      else if (left <= 0) setDone(false);
    }, 220);
  };

  const pct = Math.min(100, Math.round((score / cfg.target) * 100));
  return (
    <div className="stack" style={{ gap: 14, maxWidth: 520, margin: '0 auto' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 20 }}>{level}. seviye</h1>
        <span className="chip chip-star" style={{ fontSize: 14 }}>{moves} hamle</span>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}>
          <span>Puan: <b style={{ fontVariantNumeric: 'tabular-nums' }}>{score}</b></span><span className="muted">Hedef: {cfg.target}</span>
        </div>
        <div style={{ height: 10, borderRadius: 999, background: '#08211A', overflow: 'hidden' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--gold)', transition: 'width .3s' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${SIZE}, minmax(0, 1fr))`, gap: 4, background: '#08211A', padding: 8, borderRadius: 16, aspectRatio: '1', maxWidth: '100%' }}>
        {grid.map((k, i) => (
          <button key={i} onClick={() => tap(i)} aria-label={`Satır ${Math.floor(i / SIZE) + 1}, sütun ${(i % SIZE) + 1}`} aria-pressed={sel === i}
            style={{ all: 'unset', cursor: 'pointer', borderRadius: 10, padding: 3, background: sel === i ? 'rgba(232,184,74,.35)' : 'rgba(255,255,255,.04)', outline: sel === i ? '2px solid var(--gold)' : 'none',
              transform: flash.has(i) ? 'scale(.6)' : 'scale(1)', opacity: flash.has(i) ? 0.3 : 1, transition: 'transform .2s, opacity .2s' }}>
            <Sweet kind={k} />
          </button>
        ))}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Yan yana iki tatlıya sırayla dokun. Aynı tatlıdan 3 ya da daha fazlasını sıraya getir.</p>
      <button className="btn btn-ghost" onClick={() => onEnd(false)}>Seviyeden çık (1 can gider)</button>
      {done !== null && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-label="Seviye sonucu">
          <div className="panel modal" style={{ maxWidth: 380 }}>
            <h2>{done ? 'Seviye geçildi!' : 'Hamlelerin bitti'}</h2>
            <p style={{ margin: 0 }}>Puanın: {score} / {cfg.target}</p>
            <button className="btn btn-gold" onClick={() => onEnd(done)}>Devam</button>
          </div>
        </div>
      )}
    </div>
  );
}
