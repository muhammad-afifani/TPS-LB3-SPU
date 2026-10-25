// Pengaturan aplikasi. Ubah di sini bila aturan berubah.
export const config = {
  /** Batas lama penyimpanan limbah di TPS/HWTA (hari) — dipakai kolom F export Excel. */
  maxStorageDays: 90,
  /** Zona waktu acuan "hari ini". */
  timeZone: 'Asia/Jakarta',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined,
}

export const missingEnv = (
  [
    ['VITE_SUPABASE_URL', config.supabaseUrl],
    ['VITE_SUPABASE_ANON_KEY', config.supabaseAnonKey],
    ['VITE_TURNSTILE_SITE_KEY', config.turnstileSiteKey],
  ] as const
)
  .filter(([, v]) => !v)
  .map(([k]) => k)
