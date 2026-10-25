import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildLogbookSheet, HEADERS } from './exportExcel'
import type { KirimanMasuk } from './types'

const base = { nama_pengirim: 'X', entity: 'Y', telepon: '081234567890', created_at: '' }
const masuk: KirimanMasuk[] = [
  {
    ...base, id: 2, kode_tiket: 'HWTA-2610-0002', kode_limbah: 'B105d', tanggal_masuk: '2026-10-05', sumber: 'Site B', jumlah_kg: 20,
    kiriman_keluar: [
      { id: 2, masuk_id: 2, tanggal_keluar: '2026-10-20', jumlah_kg: 5, tujuan: 'PT C', no_emanifest: 'EM-2', kategori: 'Non TPS' },
      { id: 1, masuk_id: 2, tanggal_keluar: '2026-10-10', jumlah_kg: 8, tujuan: 'PT B', no_emanifest: 'EM-1', kategori: 'TPS' },
    ],
  },
  { ...base, id: 1, kode_tiket: 'HWTA-2610-0001', kode_limbah: 'B105d', tanggal_masuk: '2026-10-01', sumber: 'Site A', jumlah_kg: 10, kiriman_keluar: [] },
  { ...base, id: 3, kode_tiket: 'HWTA-2610-0003', kode_limbah: 'A102d', tanggal_masuk: '2026-10-02', sumber: 'Site A', jumlah_kg: 3.5, kiriman_keluar: [] },
]
const jenis = [
  { kode: 'A102d', nama: 'Aki, baterai bekas' },
  { kode: 'B105d', nama: 'Minyak pelumas bekas' },
]

describe('buildLogbookSheet', () => {
  const ws = buildLogbookSheet(masuk, jenis, 90)

  it('header A–N persis', () => {
    const row = HEADERS(90).map((_, c) => ws[XLSX.utils.encode_cell({ r: 0, c })]?.v)
    expect(row).toEqual([
      'Kode Limbah', 'Jenis Limbah', 'Tanggal Masuk', 'Sumber (Site)', 'Jumlah (Kg)',
      'Maksimal Penyimpanan s/d Tanggal (+90 Hari)', '', 'Tanggal Keluar', 'Jumlah (Kg)',
      'Tujuan Penyerahan', 'No. e-Manifest', '', 'Sisa Limbah B3 (Kg)', 'TPS/Non TPS',
    ])
    expect(ws['!ref']).toBe('A1:N5')
  })

  it('satu baris per kiriman masuk, urut tanggal; keluar tambahan di baris bawahnya', () => {
    expect(['A2', 'D2', 'A3', 'D3', 'A4', 'D4', 'H4', 'A5', 'C5', 'H5'].map((a) => ws[a]?.v)).toEqual([
      'B105d', 'Site A', 'A102d', 'Site A', 'B105d', 'Site B', 46305, 'B105d', undefined, 46315,
    ])
    expect(ws.J4.v).toBe('PT B')
    expect(ws.N4.v).toBe('TPS')
    expect(ws.N5.v).toBe('Non TPS')
    expect(ws.E5).toBeUndefined()
  })

  it('kolom F rumus tanggal masuk + 90 hari', () => {
    expect(ws.F2.f).toBe('C2+90')
    expect(ws.F2.v).toBe(ws.C2.v + 90)
    expect(ws.C2.z).toBe('dd/mm/yyyy')
    expect(buildLogbookSheet(masuk, jenis, 30).F2.f).toBe('C2+30')
  })

  it('kolom M rumus total masuk - total keluar per kode', () => {
    expect(ws.M2.f).toBe('SUMIF($A$2:$A$5,A2,$E$2:$E$5)-SUMIF($A$2:$A$5,A2,$I$2:$I$5)')
    expect(ws.M2.v).toBe(17) // 10 + 20 - 8 - 5
    expect(ws.M3.v).toBe(3.5)
    expect(ws.M5.v).toBe(17)
  })

  it('kolom pemisah G dan L kosong', () => {
    for (let r = 2; r <= 5; r++) {
      expect(ws[`G${r}`]).toBeUndefined()
      expect(ws[`L${r}`]).toBeUndefined()
    }
  })
})
