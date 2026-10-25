-- Meniru bagian Supabase yang dipakai migrasi, HANYA untuk test lokal (jangan dijalankan di Supabase).
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Default privileges Supabase: semua tabel/fungsi baru di public terbuka untuk anon & authenticated.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Vault
create schema vault;
create table vault.secrets (name text primary key, secret text not null);
create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;

-- Ekstensi http palsu: token "ok-token" dianggap valid oleh "Cloudflare".
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create type extensions.http_response as (status int, content_type text, headers text[], content text);
create function extensions.urlencode(text) returns text language sql immutable as $$ select $1 $$;
create function extensions.http_post(uri text, content text, content_type text)
returns extensions.http_response language sql volatile as $$
  select row(200, 'application/json', null,
    case when content like '%secret=test-secret&response=ok-token'
      then '{"success": true}' else '{"success": false}' end)::extensions.http_response
$$;
