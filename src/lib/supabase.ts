import { createClient } from '@supabase/supabase-js'
import { config } from '../config'

export const supabase = createClient(
  config.supabaseUrl || 'http://localhost',
  config.supabaseAnonKey || 'missing',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
)

/** Ubah error Postgres/PostgREST menjadi pesan yang bisa dibaca pengguna. */
export function errorMessage(err: unknown): string {
  const msg = typeof err === 'object' && err && 'message' in err ? String(err.message) : String(err)
  if (/failed to fetch|network/i.test(msg)) return 'Tidak dapat terhubung ke server. Periksa koneksi internet.'
  if (/invalid login credentials/i.test(msg)) return 'Email atau password salah.'
  if (/telepon_check/.test(msg)) return 'Format nomor telepon tidak valid.'
  if (/jumlah_kg_check/.test(msg)) return 'Jumlah harus lebih dari 0.'
  if (/_check|violates/.test(msg)) return 'Data tidak valid. Periksa kembali isian.'
  if (/row-level security|permission denied/i.test(msg)) return 'Akses ditolak.'
  return msg
}
