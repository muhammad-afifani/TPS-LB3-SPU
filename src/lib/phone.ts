/** Normalisasi nomor Indonesia: hapus spasi/tanda baca, +62/62 → 0. Harus sama dengan trigger DB. */
export function normalizePhone(input: string): string {
  return input.replace(/[\s().-]/g, '').replace(/^(\+62|62)/, '0')
}

/** Nomor HP (08xx) atau telepon rumah/kantor (0xx) Indonesia, 9–14 digit. */
export function isValidPhone(input: string): boolean {
  return /^0[1-9]\d{7,12}$/.test(normalizePhone(input))
}
