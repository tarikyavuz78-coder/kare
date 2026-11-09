import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BotGame from '../game71/BotGame';

export default function Play71({ defaultName = 'Sen', onGameEnd }: { defaultName?: string; onGameEnd?: (won: boolean) => void }) {
  const nav = useNavigate();
  const [players, setPlayers] = useState(4);
  const [started, setStarted] = useState(false);
  if (started) return <BotGame playerName={defaultName} players={players} onExit={() => setStarted(false)} onGameEnd={onGameEnd} />;
  return (
    <div className="shell" style={{ paddingTop: 24 }}>
      <div className="panel stack" style={{ padding: 24, maxWidth: 480, margin: '0 auto' }}>
        <div className="row"><div className="logo">71</div><h1 style={{ fontSize: 24 }}>Bota karşı 71</h1></div>
        <p className="muted" style={{ margin: 0 }}>Orta seviye yapay zekâ rakiplerle 11 el. Kurallar otomatik uygulanır.</p>
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }} className="stack">
          <legend style={{ fontWeight: 600, marginBottom: 8 }}>Oyuncu sayısı</legend>
          <div className="row">
            {[2, 3, 4].map((n) => (
              <button key={n} className={`btn ${players === n ? 'btn-gold' : ''}`} aria-pressed={players === n} onClick={() => setPlayers(n)}>{n} oyuncu</button>
            ))}
          </div>
        </fieldset>
        <button className="btn btn-gold" onClick={() => setStarted(true)}>Oyunu Başlat</button>
        <button className="btn btn-ghost" onClick={() => nav('/71')}>Geri</button>
      </div>
    </div>
  );
}
