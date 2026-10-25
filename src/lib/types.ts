export interface JenisLimbah {
  kode: string
  nama: string
}

export interface KirimanKeluar {
  id: number
  masuk_id: number
  tanggal_keluar: string
  jumlah_kg: number
  tujuan: string
  no_emanifest: string
  kategori: 'TPS' | 'Non TPS'
}

export interface KirimanMasuk {
  id: number
  kode_tiket: string
  kode_limbah: string
  tanggal_masuk: string
  sumber: string
  jumlah_kg: number
  nama_pengirim: string
  entity: string
  telepon: string
  created_at: string
  kiriman_keluar: KirimanKeluar[]
}
