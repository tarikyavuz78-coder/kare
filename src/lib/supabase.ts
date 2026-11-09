import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY);

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  chips: number;
  referral_code: string;
  is_admin: boolean;
  created_at: string;
}

export function postImageUrl(path: string): string {
  return supabase.storage.from('posts').getPublicUrl(path).data.publicUrl;
}

/** Aynı cihazdan açılan hesapları davet ödülünde işaretlemek için kalıcı cihaz kimliği. */
export function deviceHash(): string {
  try {
    let id = localStorage.getItem('kare.device');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('kare.device', id); }
    return id;
  } catch {
    return 'unknown';
  }
}

export function errorText(e: unknown): string {
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : String(e);
  if (/Invalid login credentials/i.test(m)) return 'E-posta ya da şifre hatalı.';
  if (/Email not confirmed/i.test(m)) return 'E-posta adresini henüz doğrulamadın. Gelen kutundaki bağlantıya tıkla.';
  if (/User already registered/i.test(m)) return 'Bu e-posta ile zaten bir hesap var.';
  if (/Password should be/i.test(m)) return 'Şifre en az 6 karakter olmalı.';
  if (/Yetersiz|chips_check|violates check constraint "profiles_chips/i.test(m)) return 'Yeterli çipin yok.';
  return m;
}
