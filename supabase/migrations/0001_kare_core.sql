-- Kare çekirdek şeması: profiller, sosyal özellikler, çip defteri, davetler, oyun masaları, Türk Şekerleri
-- Çip bakiyesi yalnızca SECURITY DEFINER fonksiyonlarla değişir; istemci doğrudan yazamaz.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiller
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_.]{3,24}$'),
  display_name text not null default '',
  avatar_url text,
  bio text not null default '' check (char_length(bio) <= 300),
  chips bigint not null default 0 check (chips >= 0),
  last_daily_bonus date,
  referral_code text unique not null default substr(encode(gen_random_bytes(6), 'hex'), 1, 8),
  referred_by uuid references public.profiles(id),
  device_hash text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiller herkese açık" on public.profiles for select to authenticated using (true);
create policy "kendi profilini güncelle" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (username, display_name, avatar_url, bio, device_hash) on public.profiles to authenticated;

-- ---------------------------------------------------------------- sosyal
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  image_path text not null,
  caption text not null default '' check (char_length(caption) <= 2200),
  created_at timestamptz not null default now()
);
create index on public.posts (author_id, created_at desc);
create index on public.posts (created_at desc);

create table public.likes (
  post_id uuid references public.posts(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index on public.comments (post_id, created_at);

create table public.follows (
  follower_id uuid references public.profiles(id) on delete cascade,
  followee_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create table public.friendships (
  requester_id uuid references public.profiles(id) on delete cascade,
  addressee_id uuid references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'profile', 'message')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 500),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.follows enable row level security;
alter table public.friendships enable row level security;
alter table public.reports enable row level security;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;

create policy "gönderiler" on public.posts for select to authenticated using (true);
create policy "gönderi ekle" on public.posts for insert to authenticated with check (author_id = auth.uid());
create policy "gönderi sil" on public.posts for delete to authenticated using (author_id = auth.uid() or public.is_admin());

create policy "beğeniler" on public.likes for select to authenticated using (true);
create policy "beğen" on public.likes for insert to authenticated with check (user_id = auth.uid());
create policy "beğeniyi geri al" on public.likes for delete to authenticated using (user_id = auth.uid());

create policy "yorumlar" on public.comments for select to authenticated using (true);
create policy "yorum ekle" on public.comments for insert to authenticated with check (author_id = auth.uid());
create policy "yorum sil" on public.comments for delete to authenticated using (author_id = auth.uid() or public.is_admin());

create policy "takipler" on public.follows for select to authenticated using (true);
create policy "takip et" on public.follows for insert to authenticated with check (follower_id = auth.uid());
create policy "takibi bırak" on public.follows for delete to authenticated using (follower_id = auth.uid());

create policy "arkadaşlıklarım" on public.friendships for select to authenticated using (auth.uid() in (requester_id, addressee_id));
create policy "istek gönder" on public.friendships for insert to authenticated with check (requester_id = auth.uid() and status = 'pending');
create policy "isteği kabul et" on public.friendships for update to authenticated using (addressee_id = auth.uid()) with check (addressee_id = auth.uid() and status = 'accepted');
create policy "arkadaşlığı sil" on public.friendships for delete to authenticated using (auth.uid() in (requester_id, addressee_id));

create policy "şikâyet et" on public.reports for insert to authenticated with check (reporter_id = auth.uid());
create policy "şikâyetler (yönetici)" on public.reports for select to authenticated using (public.is_admin() or reporter_id = auth.uid());
create policy "şikâyet çöz (yönetici)" on public.reports for update to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- çip defteri
create table public.chip_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null,
  balance_after bigint not null,
  reason text not null check (reason in ('daily_bonus', 'referral', 'game_entry', 'game_win', 'game_refund', 'bot_entry', 'bot_win', 'candy_reward', 'candy_life', 'admin')),
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index on public.chip_ledger (user_id, created_at desc);
alter table public.chip_ledger enable row level security;
create policy "kendi çip hareketlerim" on public.chip_ledger for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Tek giriş noktası: bakiyeyi değiştirir ve deftere yazar. İstemciye kapalı.
create or replace function public.chip_apply(p_user uuid, p_amount bigint, p_reason text, p_ref uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_balance bigint;
begin
  update public.profiles set chips = chips + p_amount where id = p_user returning chips into v_balance;
  if v_balance is null then raise exception 'Kullanıcı bulunamadı'; end if;
  insert into public.chip_ledger (user_id, amount, balance_after, reason, ref_id) values (p_user, p_amount, v_balance, p_reason, p_ref);
  return v_balance;
end $$;
revoke all on function public.chip_apply(uuid, bigint, text, uuid) from public, anon, authenticated;

-- Günlük 5000 çip (Türkiye saatiyle gece yarısından sonra ilk giriş)
create or replace function public.claim_daily_bonus() returns jsonb language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Europe/Istanbul')::date; v_last date; v_balance bigint;
begin
  select last_daily_bonus into v_last from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Profil yok'; end if;
  if v_last is not null and v_last >= v_today then
    return jsonb_build_object('granted', false, 'balance', (select chips from public.profiles where id = auth.uid()));
  end if;
  update public.profiles set last_daily_bonus = v_today where id = auth.uid();
  v_balance := public.chip_apply(auth.uid(), 5000, 'daily_bonus');
  return jsonb_build_object('granted', true, 'amount', 5000, 'balance', v_balance);
end $$;
revoke all on function public.claim_daily_bonus() from public, anon;
grant execute on function public.claim_daily_bonus() to authenticated;

-- ---------------------------------------------------------------- davetler
create table public.referrals (
  invitee_id uuid primary key references public.profiles(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'rewarded', 'flagged')),
  rewarded_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.referrals enable row level security;
create policy "davetlerim" on public.referrals for select to authenticated using (inviter_id = auth.uid() or invitee_id = auth.uid() or public.is_admin());

-- Davet ödülü: davet edilen e-postasını doğrulamış ve ilk oyununu bitirmişse davet edene 10.000 çip.
-- Aynı cihaz kimliğine sahip hesaplar işaretlenir, ödül verilmez.
create or replace function public.maybe_reward_referral(p_invitee uuid) returns void language plpgsql security definer set search_path = public, auth as $$
declare r public.referrals; v_confirmed timestamptz; v_dev_invitee text; v_dev_inviter text;
begin
  select * into r from public.referrals where invitee_id = p_invitee and status = 'pending' for update;
  if not found then return; end if;
  select email_confirmed_at into v_confirmed from auth.users where id = p_invitee;
  if v_confirmed is null then return; end if;
  select device_hash into v_dev_invitee from public.profiles where id = p_invitee;
  select device_hash into v_dev_inviter from public.profiles where id = r.inviter_id;
  if v_dev_invitee is not null and v_dev_invitee = v_dev_inviter then
    update public.referrals set status = 'flagged' where invitee_id = p_invitee;
    return;
  end if;
  update public.referrals set status = 'rewarded', rewarded_at = now() where invitee_id = p_invitee;
  perform public.chip_apply(r.inviter_id, 10000, 'referral', p_invitee);
end $$;
revoke all on function public.maybe_reward_referral(uuid) from public, anon, authenticated;

-- Yeni kullanıcı: profil oluştur, davet kodu varsa davet kaydı aç
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare v_inviter uuid; v_username text;
begin
  v_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', 'oyuncu' || substr(new.id::text, 1, 8)), '[^a-zA-Z0-9_.]', '', 'g'));
  if char_length(v_username) < 3 or char_length(v_username) > 24 or exists (select 1 from public.profiles where username = v_username) then
    v_username := 'oyuncu' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;
  insert into public.profiles (id, username, display_name, device_hash)
  values (new.id, v_username, left(coalesce(new.raw_user_meta_data->>'display_name', v_username), 40), new.raw_user_meta_data->>'device_hash');
  select id into v_inviter from public.profiles where referral_code = new.raw_user_meta_data->>'referral_code';
  if v_inviter is not null and v_inviter <> new.id then
    update public.profiles set referred_by = v_inviter where id = new.id;
    insert into public.referrals (invitee_id, inviter_id) values (new.id, v_inviter);
  end if;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- 71 masaları (sunucu fonksiyonu yönetir)
create table public.game_tables (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id),
  seats int not null check (seats between 2 and 4),
  is_private boolean not null default false,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished', 'abandoned')),
  entry_fee int not null default 500,
  human_count int,
  winner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create table public.table_players (
  table_id uuid references public.game_tables(id) on delete cascade,
  seat int not null check (seat between 0 and 3),
  user_id uuid references public.profiles(id),
  is_bot boolean not null default false,
  bot_reason text check (bot_reason in ('empty_seat', 'disconnected')),
  left_at timestamptz,
  last_seen timestamptz not null default now(),
  primary key (table_id, seat)
);
create unique index on public.table_players (table_id, user_id) where user_id is not null;

-- Oyunun tam durumu (desteler, eller): yalnızca sunucu okur.
create table public.game_states (
  table_id uuid primary key references public.game_tables(id) on delete cascade,
  state jsonb not null,
  version int not null default 0,
  updated_at timestamptz not null default now()
);
-- Her oyuncuya kendi görünümü (rakip elleri gizli). Realtime ile dinlenir.
create table public.player_views (
  table_id uuid references public.game_tables(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  view jsonb not null,
  version int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (table_id, user_id)
);
create table public.table_messages (
  id bigint generated always as identity primary key,
  table_id uuid not null references public.game_tables(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create table public.table_invites (
  table_id uuid references public.game_tables(id) on delete cascade,
  invitee_id uuid references public.profiles(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (table_id, invitee_id)
);

alter table public.game_tables enable row level security;
alter table public.table_players enable row level security;
alter table public.game_states enable row level security; -- politika yok: istemciye tamamen kapalı
alter table public.player_views enable row level security;
alter table public.table_messages enable row level security;
alter table public.table_invites enable row level security;

create or replace function public.at_table(p_table uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.table_players where table_id = p_table and user_id = auth.uid()) $$;

create policy "açık masalar ve benim masalarım" on public.game_tables for select to authenticated
  using (not is_private or host_id = auth.uid() or public.at_table(id) or exists (select 1 from public.table_invites i where i.table_id = game_tables.id and i.invitee_id = auth.uid()));
create policy "masa oyuncuları" on public.table_players for select to authenticated using (true);
create policy "kendi görünümüm" on public.player_views for select to authenticated using (user_id = auth.uid());
create policy "masa sohbeti oku" on public.table_messages for select to authenticated using (public.at_table(table_id));
create policy "masa sohbeti yaz" on public.table_messages for insert to authenticated with check (user_id = auth.uid() and public.at_table(table_id));
create policy "davetlerim (masa)" on public.table_invites for select to authenticated using (invitee_id = auth.uid() or inviter_id = auth.uid());
create policy "masaya davet et" on public.table_invites for insert to authenticated with check (inviter_id = auth.uid() and public.at_table(table_id));

-- ---------------------------------------------------------------- Türk Şekerleri
create table public.candy_progress (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  level int not null default 1 check (level between 1 and 1000),
  lives int not null default 5 check (lives between 0 and 5),
  lives_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.candy_progress enable row level security;
create policy "kendi ilerlemem" on public.candy_progress for select to authenticated using (user_id = auth.uid());

-- Canlar: en fazla 5, her 30 dakikada 1 yenilenir. Yenilenmiş durumu döner.
create or replace function public.candy_state() returns public.candy_progress language plpgsql security definer set search_path = public as $$
declare p public.candy_progress; v_gain int;
begin
  insert into public.candy_progress (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select * into p from public.candy_progress where user_id = auth.uid() for update;
  if p.lives < 5 then
    v_gain := floor(extract(epoch from (now() - p.lives_updated_at)) / 1800)::int;
    if v_gain > 0 then
      p.lives := least(5, p.lives + v_gain);
      p.lives_updated_at := case when p.lives = 5 then now() else p.lives_updated_at + make_interval(secs => v_gain * 1800) end;
      update public.candy_progress set lives = p.lives, lives_updated_at = p.lives_updated_at where user_id = auth.uid();
    end if;
  end if;
  return p;
end $$;

create or replace function public.candy_start_level() returns public.candy_progress language plpgsql security definer set search_path = public as $$
declare p public.candy_progress;
begin
  p := public.candy_state();
  if p.lives <= 0 then raise exception 'Canınız kalmadı'; end if;
  return p;
end $$;

-- Seviye kaybı: 1 can gider.
create or replace function public.candy_lose_level() returns public.candy_progress language plpgsql security definer set search_path = public as $$
declare p public.candy_progress;
begin
  p := public.candy_state();
  if p.lives <= 0 then return p; end if;
  update public.candy_progress set lives = lives - 1, lives_updated_at = case when lives = 5 then now() else lives_updated_at end, updated_at = now()
    where user_id = auth.uid() returning * into p;
  return p;
end $$;

-- Seviye geçme: yalnızca mevcut seviye geçilebilir; her 10 seviyede 5000 çip.
create or replace function public.candy_complete_level(p_level int) returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.candy_progress; v_reward int := 0;
begin
  p := public.candy_state();
  if p_level <> p.level then raise exception 'Geçersiz seviye'; end if;
  update public.candy_progress set level = level + 1, updated_at = now() where user_id = auth.uid();
  if p_level % 10 = 0 then
    v_reward := 5000;
    perform public.chip_apply(auth.uid(), 5000, 'candy_reward');
  end if;
  return jsonb_build_object('level', p_level + 1, 'reward', v_reward);
end $$;

-- Canı biten oyuncu 100 çiple 1 can alır.
create or replace function public.candy_buy_life() returns public.candy_progress language plpgsql security definer set search_path = public as $$
declare p public.candy_progress;
begin
  p := public.candy_state();
  if p.lives > 0 then raise exception 'Canınız bitmeden can alamazsınız'; end if;
  perform public.chip_apply(auth.uid(), -100, 'candy_life');
  update public.candy_progress set lives = 1, lives_updated_at = now(), updated_at = now() where user_id = auth.uid() returning * into p;
  return p;
end $$;

revoke all on function public.candy_state(), public.candy_start_level(), public.candy_lose_level(), public.candy_complete_level(int), public.candy_buy_life() from public, anon;
grant execute on function public.candy_state(), public.candy_start_level(), public.candy_lose_level(), public.candy_complete_level(int), public.candy_buy_life() to authenticated;
revoke all on function public.is_admin(), public.at_table(uuid) from public, anon;
grant execute on function public.is_admin(), public.at_table(uuid) to authenticated;

-- ---------------------------------------------------------------- depolama: gönderi görselleri
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posts', 'posts', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "gönderi görseli yükle" on storage.objects for insert to authenticated
  with check (bucket_id = 'posts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "gönderi görselini sil" on storage.objects for delete to authenticated
  using (bucket_id = 'posts' and (storage.foldername(name))[1] = auth.uid()::text);

-- Realtime: oyuncu görünümleri ve masa sohbeti
alter publication supabase_realtime add table public.player_views, public.table_messages, public.table_players, public.game_tables;

-- 0002: sunucu fonksiyonu (service_role) çip işlemleri ve bot masaları
grant execute on function public.chip_apply(uuid, bigint, text, uuid) to service_role;
grant execute on function public.maybe_reward_referral(uuid) to service_role;
alter table public.game_tables add column if not exists vs_bots boolean not null default false;
alter table public.game_tables add column if not exists rewarded boolean not null default true;
