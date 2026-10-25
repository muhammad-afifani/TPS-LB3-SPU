import { config } from '../config'

/** Tanggal hari ini (YYYY-MM-DD) di zona waktu config. */
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone }).format(new Date())
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** YYYY-MM-DD → DD/MM/YYYY */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function formatKg(n: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n)
}
