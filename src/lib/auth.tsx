import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, Profile } from './supabase';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  bonus: number | null;
  refresh: () => Promise<void>;
  dismissBonus: () => void;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [bonus, setBonus] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) { setProfile(null); return; }
    const { data } = await supabase.from('profiles').select('*').eq('id', s.session.user.id).single();
    setProfile(data as Profile | null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Oturum açılınca profili yükle ve günlük çipi iste
  useEffect(() => {
    if (!session) { setProfile(null); return; }
    (async () => {
      const { data } = await supabase.rpc('claim_daily_bonus');
      if (data?.granted) setBonus(data.amount);
      await refresh();
    })();
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider value={{ session, profile, loading, bonus, refresh, dismissBonus: () => setBonus(null) }}>
      {children}
    </Ctx.Provider>
  );
}
