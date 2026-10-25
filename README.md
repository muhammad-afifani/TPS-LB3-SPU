# Logbook Limbah B3

Aplikasi web statis untuk mencatat limbah B3 yang masuk ke HWTA dan yang keluar (diserahkan ke pihak ketiga), dengan export logbook ke Excel.

- **Form publik** (`/`) — tanpa login, dilindungi Cloudflare Turnstile. Setelah kirim, pengirim mendapat kode tiket `HWTA-YYMM-NNNN`.
- **Admin** (`/admin`) — login email + password. Melihat semua kiriman (termasuk nama & telepon), mencatat limbah keluar per kiriman, dan export `.xlsx`.

Stack: Vite + React + TypeScript + Tailwind, Supabase Free (Postgres + Auth + RLS), Cloudflare Turnstile, GitHub Pages. Tidak ada secret di repo; semua `VITE_*` bersifat publik.

---

## 1. Setup Supabase

1. Buat project baru di <https://supabase.com> (paket Free).
2. **Database > Extensions** → aktifkan **`http`** (schema `extensions`). Dipakai untuk memverifikasi token Turnstile dari dalam database.
3. **SQL Editor** → tempel seluruh isi [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → **Run**. Ini membuat tabel, RLS, fungsi, dan seed 22 jenis limbah.
4. **Matikan pendaftaran publik**: **Authentication > Sign In / Providers** → nonaktifkan **Allow new users to sign up**. Jangan aktifkan magic link / provider lain.
5. **Buat akun admin**: **Authentication > Users > Add user > Create new user** → isi email & password, centang **Auto Confirm User**.
6. **Daftarkan akun itu sebagai admin** (SQL Editor):

   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'admin@perusahaan.co.id';
   ```

   Hanya akun di tabel `admins` yang bisa melihat/menambah data. Akun yang login tetapi tidak terdaftar akan melihat pesan "belum terdaftar sebagai admin".
7. Catat **Project URL** dan **anon (publishable) key** dari **Project Settings > API**. Jangan pernah memakai `service_role` key di aplikasi ini.

### Model keamanan

| Peran | Hak |
|---|---|
| `anon` (publik) | Hanya `INSERT` ke `kiriman_masuk` (wajib token Turnstile valid), serta RPC `form_options()` (daftar jenis limbah + saran Sumber — tanpa nama/telepon) dan `submit_kiriman()` (mengembalikan kode tiket). Tidak bisa `SELECT` tabel mana pun. |
| `authenticated` + terdaftar di `admins` | `SELECT` & `INSERT` pada `kiriman_masuk`, `kiriman_keluar`, `jenis_limbah`. |
| `authenticated` lain | Tidak melihat data apa pun. |

Validasi di database (trigger), jadi tidak bisa dilewati lewat API langsung:
- Tanggal masuk/keluar tidak boleh di masa depan (zona Asia/Jakarta); tanggal keluar ≥ tanggal masuk.
- Jumlah > 0; total keluar per kiriman tidak boleh melebihi jumlah masuknya.
- Telepon dinormalisasi (`+62`/`62` → `0`) dan harus format Indonesia (`0` + 8–13 digit).
- Kode tiket dibuat server: `HWTA-YYMM-NNNN`, nomor urut reset tiap bulan.

Tidak ada UPDATE/DELETE dari aplikasi. Koreksi data dilakukan admin lewat **Table Editor** di Supabase Dashboard.

## 2. Setup Cloudflare Turnstile

1. Di <https://dash.cloudflare.com> → **Turnstile** → **Add widget**.
2. Hostname: domain GitHub Pages Anda (mis. `namauser.github.io`) dan `localhost` untuk development. Mode: **Managed**.
3. Salin **Site Key** (publik) → dipakai sebagai `VITE_TURNSTILE_SITE_KEY`.
4. Simpan **Secret Key** di **Supabase Vault** (SQL Editor) — bukan di repo:

   ```sql
   select vault.create_secret('0x4AAAAAAA...SECRET...', 'turnstile_secret');
   ```

   Untuk mengganti: `select vault.update_secret((select id from vault.secrets where name = 'turnstile_secret'), '0x4AAA...BARU');`

Tanpa secret ini semua kiriman publik akan ditolak (fail-closed).

> Uji lokal: Cloudflare menyediakan kunci uji yang selalu lolos — site key `1x00000000000000000000AA` dan secret `1x0000000000000000000000000000000AA`. Jangan dipakai di produksi.

## 3. Deploy ke GitHub Pages

1. Repo GitHub → **Settings > Pages** → **Source: GitHub Actions**.
2. **Settings > Secrets and variables > Actions > Variables** → tambahkan *Repository variables*:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_TURNSTILE_SITE_KEY`
   - (opsional) `VITE_BASE` — default `/<nama-repo>/`; isi `/` jika memakai custom domain.
3. Push ke branch `main` (atau jalankan workflow **Deploy ke GitHub Pages** manual). Workflow menjalankan lint, unit test, test RLS, build, lalu deploy.
4. Buka `https://<user>.github.io/<repo>/` untuk form publik dan `https://<user>.github.io/<repo>/admin` untuk admin.

`/admin` bekerja di GitHub Pages karena build menyalin `index.html` ke `404.html`.

## 4. Development lokal

```bash
cp .env.example .env.local   # isi URL, anon key, site key
npm install
npm run dev                  # http://localhost:5173  (admin: /admin)
```

| Perintah | Fungsi |
|---|---|
| `npm run build` | Typecheck + build ke `dist/` |
| `npm run lint` | ESLint |
| `npm test` | Unit test (format telepon, layout export Excel) |
| `npm run test:rls` | Test RLS: menjalankan migrasi di Postgres sementara lalu menguji hak `anon`, user biasa, dan admin. Butuh binary PostgreSQL (`initdb`, `pg_ctl`, `psql`); set `PG_BIN` bila tidak di lokasi default. |

Test RLS memakai tiruan minimal Supabase (`supabase/tests/00_supabase_stub.sql`: peran, `auth.uid()`, Vault, dan ekstensi `http` palsu). Jangan jalankan file stub itu di project Supabase.

## 5. Export Excel

Tombol **Export Excel** di halaman admin membuat `.xlsx` di browser (SheetJS) dengan kolom:

| A | B | C | D | E | F | G | H | I | J | K | L | M | N |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Kode Limbah | Jenis Limbah | Tanggal Masuk | Sumber (Site) | Jumlah (Kg) | Maksimal Penyimpanan s/d Tanggal (+90 Hari) | | Tanggal Keluar | Jumlah (Kg) | Tujuan Penyerahan | No. e-Manifest | | Sisa Limbah B3 (Kg) | TPS/Non TPS |

- Satu baris per kiriman masuk, urut tanggal masuk. Catatan keluar pertama mengisi H–K dan N di baris yang sama; bila satu kiriman keluar lebih dari sekali, catatan berikutnya ditaruh di baris tambahan tepat di bawahnya (hanya A–B terisi agar rumus per kode tetap benar).
- **F** = rumus `=C2+90`.
- **M** = rumus `=SUMIF(A:A, kode, E:E) - SUMIF(A:A, kode, I:I)` (total masuk − total keluar untuk kode yang sama).

### Mengubah batas 90 hari

Ubah `maxStorageDays` di [`src/config.ts`](src/config.ts). Nilai ini dipakai untuk rumus kolom F, judul kolom, dan penanda "lewat batas" di halaman admin.

## Struktur

```
src/
  config.ts              pengaturan (batas hari, env)
  pages/PublicForm.tsx   form limbah masuk
  pages/AdminPage.tsx    login, daftar kiriman, form keluar, export
  lib/exportExcel.ts     pembuat sheet logbook
  components/Turnstile.tsx
supabase/
  migrations/0001_init.sql
  tests/                 test RLS + runner
.github/workflows/deploy.yml
```
