-- Logbook Limbah B3 — skema, RLS, dan fungsi.
-- Jalankan sekali di Supabase Dashboard > SQL Editor (atau `supabase db push`).
--
-- Model akses:
--   anon            : hanya INSERT ke public.kiriman_masuk (wajib token Turnstile valid),
--                     plus RPC form_options() & submit_kiriman(). Tidak bisa SELECT tabel apa pun.
--   authenticated   : SELECT/INSERT hanya jika terdaftar di public.admins.

-- ---------------------------------------------------------------------------
-- Ekstensi untuk verifikasi Turnstile dari dalam Postgres
-- ---------------------------------------------------------------------------
do $$
begin
  create extension if not exists http with schema extensions;
exception when others then
  raise warning 'Ekstensi http tidak bisa dibuat (%). Aktifkan di Dashboard > Database > Extensions.', sqlerrm;
end $$;

create schema if not exists private;
revoke all on schema private from public;
-- anon/authenticated perlu USAGE agar trigger (security invoker) bisa memanggil helper.
-- Schema ini tidak diekspos lewat API (hanya "public" yang diekspos).
grant usage on schema private to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tabel
-- ---------------------------------------------------------------------------
create table public.jenis_limbah (
  kode    text primary key check (kode ~ '^[A-Za-z0-9-]+$'),
  nama    text not null check (length(trim(nama)) > 0),
  urutan  int  not null default 0,
  aktif   boolean not null default true
);

create table public.admins (
  user_id    uuid primary key,
  email      text,
  created_at timestamptz not null default now()
);

create table public.kiriman_masuk (
  id             bigint generated always as identity primary key,
  kode_tiket     text not null unique,
  kode_limbah    text not null references public.jenis_limbah (kode),
  tanggal_masuk  date not null,
  sumber         text not null check (length(sumber) between 1 and 200),
  jumlah_kg      numeric(12, 2) not null check (jumlah_kg > 0),
  nama_pengirim  text not null check (length(nama_pengirim) between 1 and 120),
  entity         text not null check (length(entity) between 1 and 120),
  telepon        text not null check (telepon ~ '^0[1-9][0-9]{7,12}$'),
  -- Hanya kanal pengiriman token Turnstile; selalu dikosongkan oleh trigger.
  captcha_token  text check (captcha_token is null),
  created_at     timestamptz not null default now(),
  created_by     uuid
);
create index kiriman_masuk_tanggal_idx on public.kiriman_masuk (tanggal_masuk);

create table public.kiriman_keluar (
  id              bigint generated always as identity primary key,
  masuk_id        bigint not null references public.kiriman_masuk (id) on delete restrict,
  tanggal_keluar  date not null,
  jumlah_kg       numeric(12, 2) not null check (jumlah_kg > 0),
  tujuan          text not null check (length(tujuan) between 1 and 200),
  no_emanifest    text not null check (length(no_emanifest) between 1 and 100),
  kategori        text not null check (kategori in ('TPS', 'Non TPS')),
  created_at      timestamptz not null default now(),
  created_by      uuid
);
create index kiriman_keluar_masuk_idx on public.kiriman_keluar (masuk_id);

create table private.tiket_counter (
  periode text primary key, -- YYMM
  nomor   int not null
);

-- ---------------------------------------------------------------------------
-- Helper (security definer, di schema private)
-- ---------------------------------------------------------------------------
create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function private.today_jakarta()
returns date
language sql stable set search_path = ''
as $$ select (now() at time zone 'Asia/Jakarta')::date; $$;

create or replace function private.kode_limbah_aktif(p_kode text)
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.jenis_limbah where kode = p_kode and aktif); $$;

create or replace function private.next_ticket()
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_periode text := to_char(now() at time zone 'Asia/Jakarta', 'YYMM');
  v_nomor   int;
begin
  insert into private.tiket_counter as t (periode, nomor) values (v_periode, 1)
  on conflict (periode) do update set nomor = t.nomor + 1
  returning nomor into v_nomor;
  return 'HWTA-' || v_periode || '-' || lpad(v_nomor::text, 4, '0');
end;
$$;

-- Verifikasi token ke Cloudflare. Secret disimpan di Supabase Vault dengan nama 'turnstile_secret'.
create or replace function private.verify_turnstile(p_token text)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_secret text;
  v_resp   record;
begin
  if p_token is null or length(p_token) = 0 or length(p_token) > 2048 then
    return false;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'turnstile_secret' limit 1;
  if v_secret is null then
    raise exception 'Turnstile belum dikonfigurasi (secret "turnstile_secret" tidak ada di Vault).';
  end if;

  select * into v_resp from extensions.http_post(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    'secret=' || extensions.urlencode(v_secret) || '&response=' || extensions.urlencode(p_token),
    'application/x-www-form-urlencoded'
  );

  return v_resp.status = 200 and coalesce((v_resp.content::jsonb ->> 'success')::boolean, false);
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.today_jakarta(), private.next_ticket(),
  private.kode_limbah_aktif(text),
  private.verify_turnstile(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trigger validasi
-- ---------------------------------------------------------------------------
-- security invoker: current_user = peran pemanggil (anon / authenticated / postgres).
create or replace function private.kiriman_masuk_before_insert()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if not (private.is_admin() or current_user in ('postgres', 'service_role', 'supabase_admin')) then
    if not private.verify_turnstile(new.captcha_token) then
      raise exception 'Verifikasi Turnstile gagal. Muat ulang halaman lalu coba lagi.'
        using errcode = 'P0001';
    end if;
  end if;
  new.captcha_token := null;

  new.sumber        := trim(new.sumber);
  new.nama_pengirim := trim(new.nama_pengirim);
  new.entity        := trim(new.entity);
  new.telepon       := regexp_replace(coalesce(new.telepon, ''), '[\s().-]', '', 'g');
  new.telepon       := regexp_replace(new.telepon, '^(\+62|62)', '0');

  if new.tanggal_masuk > private.today_jakarta() then
    raise exception 'Tanggal masuk tidak boleh di masa depan.' using errcode = 'P0001';
  end if;
  if not private.kode_limbah_aktif(new.kode_limbah) then
    raise exception 'Kode limbah tidak dikenal.' using errcode = 'P0001';
  end if;

  new.kode_tiket := private.next_ticket();
  new.created_at := now();
  new.created_by := auth.uid();
  perform set_config('app.kode_tiket', new.kode_tiket, true);
  return new;
end;
$$;

create trigger kiriman_masuk_before_insert
before insert on public.kiriman_masuk
for each row execute function private.kiriman_masuk_before_insert();

create or replace function private.kiriman_keluar_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_masuk  public.kiriman_masuk;
  v_keluar numeric;
begin
  -- Kunci baris masuk agar dua input keluar bersamaan tidak melebihi jumlah.
  select * into v_masuk from public.kiriman_masuk where id = new.masuk_id for update;
  if not found then
    raise exception 'Kiriman masuk tidak ditemukan.' using errcode = 'P0001';
  end if;
  if new.tanggal_keluar > private.today_jakarta() then
    raise exception 'Tanggal keluar tidak boleh di masa depan.' using errcode = 'P0001';
  end if;
  if new.tanggal_keluar < v_masuk.tanggal_masuk then
    raise exception 'Tanggal keluar tidak boleh sebelum tanggal masuk (%).', v_masuk.tanggal_masuk
      using errcode = 'P0001';
  end if;
  select coalesce(sum(jumlah_kg), 0) into v_keluar from public.kiriman_keluar where masuk_id = new.masuk_id;
  if v_keluar + new.jumlah_kg > v_masuk.jumlah_kg then
    raise exception 'Jumlah keluar melebihi sisa kiriman (sisa % kg).', v_masuk.jumlah_kg - v_keluar
      using errcode = 'P0001';
  end if;

  new.tujuan       := trim(new.tujuan);
  new.no_emanifest := trim(new.no_emanifest);
  new.created_at   := now();
  new.created_by   := auth.uid();
  return new;
end;
$$;

revoke all on function private.kiriman_keluar_before_insert() from public, anon, authenticated;

create trigger kiriman_keluar_before_insert
before insert on public.kiriman_keluar
for each row execute function private.kiriman_keluar_before_insert();

-- ---------------------------------------------------------------------------
-- Hak akses tabel (Supabase memberi ALL ke anon/authenticated secara default — cabut dulu)
-- ---------------------------------------------------------------------------
revoke all on public.jenis_limbah, public.admins, public.kiriman_masuk, public.kiriman_keluar
  from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on private.tiket_counter from public, anon, authenticated;

grant insert (kode_limbah, tanggal_masuk, sumber, jumlah_kg, nama_pengirim, entity, telepon, captcha_token)
  on public.kiriman_masuk to anon, authenticated;
grant select on public.jenis_limbah, public.kiriman_masuk, public.kiriman_keluar, public.admins
  to authenticated;
grant insert on public.jenis_limbah to authenticated;
grant insert (masuk_id, tanggal_keluar, jumlah_kg, tujuan, no_emanifest, kategori)
  on public.kiriman_keluar to authenticated;

alter table public.jenis_limbah   enable row level security;
alter table public.admins         enable row level security;
alter table public.kiriman_masuk  enable row level security;
alter table public.kiriman_keluar enable row level security;
alter table private.tiket_counter enable row level security;

create policy "anon insert kiriman" on public.kiriman_masuk
  for insert to anon with check (true);
create policy "admin insert kiriman" on public.kiriman_masuk
  for insert to authenticated with check (private.is_admin());
create policy "admin select kiriman" on public.kiriman_masuk
  for select to authenticated using (private.is_admin());

create policy "admin select keluar" on public.kiriman_keluar
  for select to authenticated using (private.is_admin());
create policy "admin insert keluar" on public.kiriman_keluar
  for insert to authenticated with check (private.is_admin());

create policy "admin select jenis" on public.jenis_limbah
  for select to authenticated using (private.is_admin());
create policy "admin insert jenis" on public.jenis_limbah
  for insert to authenticated with check (private.is_admin());

create policy "admin lihat diri sendiri" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RPC publik
-- ---------------------------------------------------------------------------
-- Opsi form: master jenis limbah + saran Sumber (Site). Tidak mengandung nama/telepon.
create or replace function public.form_options()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'jenis', coalesce((
      select jsonb_agg(jsonb_build_object('kode', kode, 'nama', nama) order by urutan, kode)
      from public.jenis_limbah where aktif), '[]'::jsonb),
    'sumber', coalesce((
      select jsonb_agg(sumber order by sumber)
      from (select distinct sumber from public.kiriman_masuk limit 300) s), '[]'::jsonb)
  );
$$;

-- Simpan kiriman masuk dan kembalikan kode tiket. security invoker: insert berjalan sebagai anon,
-- tunduk pada RLS & trigger Turnstile. Kode tiket dibaca dari setting transaksi (anon tak bisa SELECT).
create or replace function public.submit_kiriman(
  p_kode_limbah text,
  p_tanggal_masuk date,
  p_sumber text,
  p_jumlah_kg numeric,
  p_nama_pengirim text,
  p_entity text,
  p_telepon text,
  p_captcha_token text
)
returns text
language plpgsql volatile set search_path = ''
as $$
begin
  insert into public.kiriman_masuk
    (kode_limbah, tanggal_masuk, sumber, jumlah_kg, nama_pengirim, entity, telepon, captcha_token)
  values
    (p_kode_limbah, p_tanggal_masuk, p_sumber, p_jumlah_kg, p_nama_pengirim, p_entity, p_telepon, p_captcha_token);
  return current_setting('app.kode_tiket');
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql stable set search_path = ''
as $$ select private.is_admin(); $$;

revoke all on function public.form_options(), public.is_admin(),
  public.submit_kiriman(text, date, text, numeric, text, text, text, text) from public, anon, authenticated;
grant execute on function public.form_options() to anon, authenticated;
grant execute on function public.submit_kiriman(text, date, text, numeric, text, text, text, text)
  to anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Seed master jenis limbah
-- ---------------------------------------------------------------------------
insert into public.jenis_limbah (kode, nama, urutan) values
  ('A102d',   'Aki, baterai bekas', 1),
  ('A106d',   'Limbah dari laboratorium yang mengandung B3', 2),
  ('A108d',   'Limbah terkontaminasi B3', 3),
  ('A111d',   'Refrigerant bekas', 4),
  ('B104d',   'Kemasan bekas B3', 5),
  ('B105d',   'Minyak pelumas bekas', 6),
  ('B107d',   'Limbah elektronik (CRT, lampu TL, PCB, karet kawat)', 7),
  ('B110d',   'Kain majun bekas', 8),
  ('B321-4',  'Kemasan bekas tinta', 9),
  ('B323-1',  'Sisa proses blasting', 10),
  ('A325-1',  'Limbah cat dan varnish', 11),
  ('A3330-1', 'Residue dasar tangki minyak bumi', 12),
  ('A330-2',  'Residue proses produksi', 13),
  ('B330-1',  'Lumpur oil base mud dan synthetic oil', 14),
  ('B330-2',  'Serbuk bor oil base dan/atau synthetic oil', 15),
  ('B330-4',  'Absorben dan/atau filter bekas', 16),
  ('A337-1',  'Limbah klinis infeksius', 17),
  ('A337-2',  'Limbah farmasi kadaluarsa', 18),
  ('A338-1',  'Bahan kimia kadaluarsa', 19),
  ('B353-1',  'Toner bekas', 20),
  ('B352-5',  'Material konstruksi mengandung asbestos', 21),
  ('B354-4',  'Material insulasi mengandung asbestos', 22)
on conflict (kode) do nothing;
