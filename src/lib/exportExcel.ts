import * as XLSX from 'xlsx'
import type { JenisLimbah, KirimanMasuk } from './types'

const DATE_FMT = 'dd/mm/yyyy'
const NUM_FMT = '#,##0.00'

export const HEADERS = (maxDays: number) => [
  'Kode Limbah',
  'Jenis Limbah',
  'Tanggal Masuk',
  'Sumber (Site)',
  'Jumlah (Kg)',
  `Maksimal Penyimpanan s/d Tanggal (+${maxDays} Hari)`,
  '',
  'Tanggal Keluar',
  'Jumlah (Kg)',
  'Tujuan Penyerahan',
  'No. e-Manifest',
  '',
  'Sisa Limbah B3 (Kg)',
  'TPS/Non TPS',
]

/** YYYY-MM-DD → nomor seri tanggal Excel. */
function excelDate(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000 + 25_569
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Satu baris per kiriman masuk (A–F). Keluar pertama mengisi H–K & N di baris yang sama;
 * keluar berikutnya untuk kiriman yang sama ditaruh di baris tambahan tepat di bawahnya
 * (hanya A–B diisi agar rumus SUMIF kolom M tetap menghitung per kode).
 */
export function buildLogbookSheet(masuk: KirimanMasuk[], jenis: JenisLimbah[], maxDays: number): XLSX.WorkSheet {
  const namaByKode = new Map(jenis.map((j) => [j.kode, j.nama]))
  const sorted = [...masuk].sort((a, b) => a.tanggal_masuk.localeCompare(b.tanggal_masuk) || a.id - b.id)

  type Line = { m: KirimanMasuk; k?: KirimanMasuk['kiriman_keluar'][number]; first: boolean }
  const lines: Line[] = sorted.flatMap((m): Line[] => {
    const keluar = [...m.kiriman_keluar].sort((a, b) => a.tanggal_keluar.localeCompare(b.tanggal_keluar) || a.id - b.id)
    if (keluar.length === 0) return [{ m, first: true }]
    return keluar.map((k, i) => ({ m, k, first: i === 0 }))
  })

  // Nilai cache untuk kolom M (dihitung ulang oleh Excel dari rumus).
  const sisaByKode = new Map<string, number>()
  for (const m of masuk) {
    const keluar = m.kiriman_keluar.reduce((s, k) => s + Number(k.jumlah_kg), 0)
    sisaByKode.set(m.kode_limbah, (sisaByKode.get(m.kode_limbah) ?? 0) + Number(m.jumlah_kg) - keluar)
  }

  const ws: XLSX.WorkSheet = {}
  HEADERS(maxDays).forEach((h, c) => {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: 's', v: h }
  })

  const lastRow = lines.length + 1
  const rangeA = `$A$2:$A$${lastRow}`
  lines.forEach(({ m, k, first }, i) => {
    const r = i + 2 // nomor baris Excel (1-based, setelah header)
    const set = (col: string, cell: XLSX.CellObject) => {
      ws[`${col}${r}`] = cell
    }
    set('A', { t: 's', v: m.kode_limbah })
    set('B', { t: 's', v: namaByKode.get(m.kode_limbah) ?? '' })
    if (first) {
      const tgl = excelDate(m.tanggal_masuk)
      set('C', { t: 'n', v: tgl, z: DATE_FMT })
      set('D', { t: 's', v: m.sumber })
      set('E', { t: 'n', v: Number(m.jumlah_kg), z: NUM_FMT })
      set('F', { t: 'n', v: tgl + maxDays, f: `C${r}+${maxDays}`, z: DATE_FMT })
    }
    if (k) {
      set('H', { t: 'n', v: excelDate(k.tanggal_keluar), z: DATE_FMT })
      set('I', { t: 'n', v: Number(k.jumlah_kg), z: NUM_FMT })
      set('J', { t: 's', v: k.tujuan })
      set('K', { t: 's', v: k.no_emanifest })
      set('N', { t: 's', v: k.kategori })
    }
    set('M', {
      t: 'n',
      v: round2(sisaByKode.get(m.kode_limbah) ?? 0),
      f: `SUMIF(${rangeA},A${r},$E$2:$E$${lastRow})-SUMIF(${rangeA},A${r},$I$2:$I$${lastRow})`,
      z: NUM_FMT,
    })
  })

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(lastRow - 1, 0), c: 13 } })
  ws['!cols'] = [12, 40, 13, 22, 11, 22, 2, 13, 11, 28, 18, 2, 14, 12].map((wch) => ({ wch }))
  ws['!autofilter'] = { ref: `A1:N${Math.max(lastRow, 1)}` }
  return ws
}

export function downloadLogbook(masuk: KirimanMasuk[], jenis: JenisLimbah[], maxDays: number, today: string) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildLogbookSheet(masuk, jenis, maxDays), 'Logbook')
  XLSX.writeFile(wb, `logbook-limbah-b3_${today}.xlsx`, { compression: true })
}
