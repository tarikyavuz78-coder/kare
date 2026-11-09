import { ReactNode } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { supabase } from './lib/supabase';
import Login from './pages/Login';
import Feed from './pages/Feed';
import NewPost from './pages/NewPost';
import ProfilePage from './pages/ProfilePage';
import Friends from './pages/Friends';
import GameCenter from './pages/GameCenter';
import Admin from './pages/Admin';
import Lobby71 from './pages/Lobby71';
import Play71 from './pages/Play71';
import OnlineGame from './game71/OnlineGame';
import Candy from './candy/Candy';

function Shell({ children }: { children: ReactNode }) {
  const { profile, bonus, dismissBonus } = useAuth();
  return (
    <div className="shell">
      <nav className="nav" aria-label="Ana menü">
        <NavLink to="/" className="logo" aria-label="Kare ana sayfa" style={{ color: 'var(--gold-ink)' }}>K</NavLink>
        <NavLink to="/" end>Akış</NavLink>
        <NavLink to="/paylas">Paylaş</NavLink>
        <NavLink to="/oyunlar">Oyunlar</NavLink>
        <NavLink to="/arkadaslar">Arkadaşlar</NavLink>
        {profile?.is_admin && <NavLink to="/yonetim">Yönetim</NavLink>}
        <span className="spacer" />
        <NavLink to="/oyunlar" className="chips-badge" aria-label="Çip bakiyesi">{profile?.chips.toLocaleString('tr-TR') ?? '–'} çip</NavLink>
        {profile && <NavLink to={`/u/${profile.username}`}>@{profile.username}</NavLink>}
        <button className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>Çıkış</button>
      </nav>
      {bonus && (
        <div className="panel row" role="status" style={{ padding: 14, marginBottom: 16, justifyContent: 'space-between' }}>
          <span>Günün ilk girişi: <b style={{ color: 'var(--gold-soft)' }}>+{bonus.toLocaleString('tr-TR')} çip</b> hesabına eklendi.</span>
          <button className="btn btn-ghost" onClick={dismissBonus}>Tamam</button>
        </div>
      )}
      <main>{children}</main>
    </div>
  );
}

function TableRoute() {
  const { id } = useParams();
  const nav = useNavigate();
  return <OnlineGame tableId={id!} onExit={() => nav('/71')} />;
}

function Gate() {
  const { session, profile, loading } = useAuth();
  if (loading) return <p className="muted" style={{ padding: 24 }}>Yükleniyor…</p>;
  if (!session) {
    return (
      <Routes>
        <Route path="/71/pratik" element={<Play71 />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  if (!profile) return <p className="muted" style={{ padding: 24 }}>Profil yükleniyor…</p>;
  return (
    <Routes>
      <Route path="/71/masa/:id" element={<TableRoute />} />
      <Route path="/71/pratik" element={<Play71 defaultName={profile.username} />} />
      <Route path="/" element={<Shell><Feed /></Shell>} />
      <Route path="/paylas" element={<Shell><NewPost /></Shell>} />
      <Route path="/u/:username" element={<Shell><ProfilePage /></Shell>} />
      <Route path="/arkadaslar" element={<Shell><Friends /></Shell>} />
      <Route path="/oyunlar" element={<Shell><GameCenter /></Shell>} />
      <Route path="/71" element={<Shell><Lobby71 /></Shell>} />
      <Route path="/sekerler" element={<Shell><Candy /></Shell>} />
      <Route path="/yonetim" element={<Shell><Admin /></Shell>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return <AuthProvider><Gate /></AuthProvider>;
}
