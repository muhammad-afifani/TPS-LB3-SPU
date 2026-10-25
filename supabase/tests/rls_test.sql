-- Test RLS dasar. Dijalankan oleh run-rls-tests.sh (Postgres lokal + 00_supabase_stub.sql).
\set QUIET on
set client_min_messages = notice;

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.expect_fail(label text, stmt text, msg_like text default null)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if msg_like is not null and sqlerrm not ilike msg_like then
      raise exception 'FAIL [%]: error tak terduga: %', label, sqlerrm;
    end if;
    raise notice 'ok   %', label;
    return;
  end;
  raise exception 'FAIL [%]: perintah seharusnya ditolak', label;
end $$;

create function tests.ok(label text, cond boolean)
returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL [%]', label; end if;
  raise notice 'ok   %', label;
end $$;

grant execute on all functions in schema tests to anon, authenticated;

insert into vault.secrets values ('turnstile_secret', 'test-secret');
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'admin@contoh.id'),
  ('22222222-2222-2222-2222-222222222222', 'bukan-admin@contoh.id');
insert into public.admins (user_id, email) values ('11111111-1111-1111-1111-111111111111', 'admin@contoh.id');

select set_config('tests.periode', to_char(now() at time zone 'Asia/Jakarta', 'YYMM'), false);

-- =========================================================================
-- ANON
-- =========================================================================
set role anon;

select tests.expect_fail('anon tidak bisa SELECT jenis_limbah',   'select * from public.jenis_limbah',   'permission denied%');
select tests.expect_fail('anon tidak bisa SELECT kiriman_masuk',  'select * from public.kiriman_masuk',  'permission denied%');
select tests.expect_fail('anon tidak bisa SELECT kiriman_keluar', 'select * from public.kiriman_keluar', 'permission denied%');
select tests.expect_fail('anon tidak bisa SELECT admins',         'select * from public.admins',         'permission denied%');
select tests.expect_fail('anon tidak bisa SELECT tiket_counter',  'select * from private.tiket_counter', 'permission denied%');
select tests.expect_fail('anon tidak bisa SELECT kolom nama',     'select nama_pengirim, telepon from public.kiriman_masuk', 'permission denied%');

select tests.ok('form_options berisi 22 jenis limbah',
  jsonb_array_length(public.form_options() -> 'jenis') = 22);
select tests.ok('form_options format kode/nama',
  public.form_options() -> 'jenis' -> 0 = '{"kode": "A102d", "nama": "Aki, baterai bekas"}'::jsonb);

select tests.ok('submit_kiriman mengembalikan tiket HWTA-YYMM-0001',
  public.submit_kiriman('B105d', current_date - 3, 'SPU Senipah', 12.5, 'Budi Santoso', 'PT Kontraktor A',
    '+62 812-3456-7890', 'ok-token') = 'HWTA-' || current_setting('tests.periode') || '-0001');
select tests.ok('tiket berikutnya HWTA-YYMM-0002',
  public.submit_kiriman('B105d', current_date, 'SPU Senipah', 7, 'Siti Aminah', 'PT Kontraktor B',
    '021-5551234', 'ok-token') = 'HWTA-' || current_setting('tests.periode') || '-0002');

-- INSERT langsung ke tabel (tanpa RPC) tetap diizinkan, tetap wajib Turnstile.
insert into public.kiriman_masuk (kode_limbah, tanggal_masuk, sumber, jumlah_kg, nama_pengirim, entity, telepon, captcha_token)
values ('A102d', current_date - 10, 'Site Handil', 3, 'Andi', 'PT C', '081298765432', 'ok-token');
select tests.ok('anon INSERT langsung berhasil', true);

select tests.expect_fail('anon INSERT tanpa token Turnstile ditolak',
  $q$insert into public.kiriman_masuk (kode_limbah, tanggal_masuk, sumber, jumlah_kg, nama_pengirim, entity, telepon)
     values ('A102d', current_date, 'X', 1, 'A', 'B', '081234567890')$q$, '%Turnstile%');
select tests.expect_fail('anon INSERT token Turnstile salah ditolak',
  $q$select public.submit_kiriman('A102d', current_date, 'X', 1, 'A', 'B', '081234567890', 'token-palsu')$q$, '%Turnstile%');
select tests.expect_fail('tanggal masuk masa depan ditolak',
  $q$select public.submit_kiriman('A102d', current_date + 2, 'X', 1, 'A', 'B', '081234567890', 'ok-token')$q$, '%masa depan%');
select tests.expect_fail('jumlah 0 ditolak',
  $q$select public.submit_kiriman('A102d', current_date, 'X', 0, 'A', 'B', '081234567890', 'ok-token')$q$, '%jumlah_kg_check%');
select tests.expect_fail('jumlah negatif ditolak',
  $q$select public.submit_kiriman('A102d', current_date, 'X', -4, 'A', 'B', '081234567890', 'ok-token')$q$, '%jumlah_kg_check%');
select tests.expect_fail('telepon tidak valid ditolak',
  $q$select public.submit_kiriman('A102d', current_date, 'X', 1, 'A', 'B', '12345', 'ok-token')$q$, '%telepon_check%');
select tests.expect_fail('nama kosong ditolak',
  $q$select public.submit_kiriman('A102d', current_date, 'X', 1, '   ', 'B', '081234567890', 'ok-token')$q$, '%nama_pengirim_check%');
select tests.expect_fail('kode limbah tak dikenal ditolak',
  $q$select public.submit_kiriman('ZZZ', current_date, 'X', 1, 'A', 'B', '081234567890', 'ok-token')$q$, '%tidak dikenal%');
select tests.expect_fail('anon tidak bisa menentukan kode_tiket sendiri',
  $q$insert into public.kiriman_masuk (kode_tiket, kode_limbah, tanggal_masuk, sumber, jumlah_kg, nama_pengirim, entity, telepon, captcha_token)
     values ('HWTA-0000-9999', 'A102d', current_date, 'X', 1, 'A', 'B', '081234567890', 'ok-token')$q$, 'permission denied%');
select tests.expect_fail('anon INSERT ... RETURNING ditolak (tidak bisa membaca balik)',
  $q$insert into public.kiriman_masuk (kode_limbah, tanggal_masuk, sumber, jumlah_kg, nama_pengirim, entity, telepon, captcha_token)
     values ('A102d', current_date, 'X', 1, 'A', 'B', '081234567890', 'ok-token') returning nama_pengirim, telepon$q$, 'permission denied%');
select tests.expect_fail('anon tidak bisa UPDATE kiriman_masuk',
  $q$update public.kiriman_masuk set jumlah_kg = 1$q$, 'permission denied%');
select tests.expect_fail('anon tidak bisa DELETE kiriman_masuk',
  $q$delete from public.kiriman_masuk$q$, 'permission denied%');
select tests.expect_fail('anon tidak bisa INSERT kiriman_keluar',
  $q$insert into public.kiriman_keluar (masuk_id, tanggal_keluar, jumlah_kg, tujuan, no_emanifest, kategori)
     values (1, current_date, 1, 'X', 'M-1', 'TPS')$q$, 'permission denied%');
select tests.expect_fail('anon tidak bisa INSERT jenis_limbah',
  $q$insert into public.jenis_limbah (kode, nama) values ('X1', 'Uji')$q$, 'permission denied%');
select tests.expect_fail('anon tidak bisa memanggil is_admin()',
  $q$select public.is_admin()$q$, 'permission denied%');

select tests.ok('form_options memberi saran sumber dari data sebelumnya',
  public.form_options() -> 'sumber' = '["SPU Senipah", "Site Handil"]'::jsonb);
select tests.ok('form_options tidak membocorkan nama/telepon',
  public.form_options()::text !~* '(budi|siti|\mandi\M|0812|5551234|kontraktor)');

reset role;

-- =========================================================================
-- AUTHENTICATED BUKAN ADMIN
-- =========================================================================
set role authenticated;
set request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select tests.ok('non-admin: is_admin() = false', public.is_admin() = false);
select tests.ok('non-admin tidak melihat kiriman_masuk', (select count(*) from public.kiriman_masuk) = 0);
select tests.ok('non-admin tidak melihat jenis_limbah', (select count(*) from public.jenis_limbah) = 0);
select tests.expect_fail('non-admin tidak bisa INSERT kiriman_keluar',
  $q$insert into public.kiriman_keluar (masuk_id, tanggal_keluar, jumlah_kg, tujuan, no_emanifest, kategori)
     values (1, current_date, 1, 'X', 'M-1', 'TPS')$q$, '%row-level security%');
select tests.expect_fail('non-admin tanpa token tidak bisa INSERT kiriman_masuk',
  $q$insert into public.kiriman_masuk (kode_limbah, tanggal_masuk, sumber, jumlah_kg, nama_pengirim, entity, telepon)
     values ('A102d', current_date, 'X', 1, 'A', 'B', '081234567890')$q$, '%Turnstile%');

reset role;

-- =========================================================================
-- ADMIN
-- =========================================================================
set role authenticated;
set request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select tests.ok('admin: is_admin() = true', public.is_admin());
select tests.ok('admin melihat semua kiriman_masuk', (select count(*) from public.kiriman_masuk) = 3);
select tests.ok('admin melihat nama & telepon (sudah dinormalisasi)',
  exists (select 1 from public.kiriman_masuk where nama_pengirim = 'Budi Santoso' and telepon = '081234567890'));
select tests.ok('admin melihat 22 jenis limbah', (select count(*) from public.jenis_limbah) = 22);

insert into public.kiriman_keluar (masuk_id, tanggal_keluar, jumlah_kg, tujuan, no_emanifest, kategori)
select id, current_date, 10, 'PT Pengolah Limbah', 'EM-001', 'TPS' from public.kiriman_masuk where nama_pengirim = 'Budi Santoso';
select tests.ok('admin INSERT kiriman_keluar berhasil', (select count(*) from public.kiriman_keluar) = 1);

select tests.expect_fail('keluar melebihi sisa ditolak',
  $q$insert into public.kiriman_keluar (masuk_id, tanggal_keluar, jumlah_kg, tujuan, no_emanifest, kategori)
     select id, current_date, 3, 'X', 'EM-002', 'TPS' from public.kiriman_masuk where nama_pengirim = 'Budi Santoso'$q$, '%melebihi%');
select tests.expect_fail('tanggal keluar sebelum tanggal masuk ditolak',
  $q$insert into public.kiriman_keluar (masuk_id, tanggal_keluar, jumlah_kg, tujuan, no_emanifest, kategori)
     select id, current_date - 20, 1, 'X', 'EM-003', 'TPS' from public.kiriman_masuk where nama_pengirim = 'Andi'$q$, '%sebelum tanggal masuk%');
select tests.expect_fail('kategori selain TPS/Non TPS ditolak',
  $q$insert into public.kiriman_keluar (masuk_id, tanggal_keluar, jumlah_kg, tujuan, no_emanifest, kategori)
     select id, current_date, 1, 'X', 'EM-004', 'Lainnya' from public.kiriman_masuk where nama_pengirim = 'Andi'$q$, '%kategori_check%');
select tests.expect_fail('admin tidak bisa UPDATE kiriman_masuk',
  $q$update public.kiriman_masuk set jumlah_kg = 1$q$, 'permission denied%');
select tests.expect_fail('admin tidak bisa DELETE kiriman_keluar',
  $q$delete from public.kiriman_keluar$q$, 'permission denied%');

insert into public.kiriman_masuk (kode_limbah, tanggal_masuk, sumber, jumlah_kg, nama_pengirim, entity, telepon)
values ('B110d', current_date, 'Gudang', 2, 'Admin', 'PHM', '081111111111');
select tests.ok('admin INSERT kiriman_masuk tanpa Turnstile berhasil', (select count(*) from public.kiriman_masuk) = 4);

reset role;
reset request.jwt.claims;

-- =========================================================================
-- Integritas data
-- =========================================================================
select tests.ok('captcha_token tidak pernah tersimpan',
  not exists (select 1 from public.kiriman_masuk where captcha_token is not null));
select tests.ok('semua kode tiket unik & berformat HWTA-YYMM-NNNN',
  (select bool_and(kode_tiket ~ '^HWTA-[0-9]{4}-[0-9]{4}$') and count(distinct kode_tiket) = count(*)
   from public.kiriman_masuk));
select tests.ok('created_by admin tercatat',
  exists (select 1 from public.kiriman_keluar where created_by = '11111111-1111-1111-1111-111111111111'));
