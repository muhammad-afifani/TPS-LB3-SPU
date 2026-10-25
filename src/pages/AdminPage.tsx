import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { config } from '../config'
import { Field } from '../components/Field'
import { Alert, Layout } from '../components/Layout'
import { addDaysISO, formatDate, formatKg, todayISO } from '../lib/dates'
import { downloadLogbook } from '../lib/exportExcel'
import { errorMessage, supabase } from '../lib/supabase'
import type { JenisLimbah, KirimanKeluar, KirimanMasuk } from '../lib/types'

const PAGE = 1000
const SHOW_STEP = 50
const MASUK_COLUMNS =
  'id,kode_tiket,kode_limbah,tanggal_masuk,sumber,jumlah_kg,nama_pengirim,entity,telepon,created_at,' +
  'kiriman_keluar(id,masuk_id,tanggal_keluar,jumlah_kg,tujuan,no_emanifest,kategori)'

const sisaOf = (m: KirimanMasuk) =>
  Math.round((Number(m.jumlah_kg) - m.kiriman_keluar.reduce((s, k) => s + Number(k.jumlah_kg), 0)) * 100) / 100

export function AdminPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!ready) return <Layout title="Admin Logbook Limbah B3">Memuat…</Layout>
  if (!session) return <LoginForm />
  return <AdminGate session={session} />
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(errorMessage(error))
  }

  return (
    <Layout title="Admin Logbook Limbah B3" subtitle="Masuk untuk melanjutkan">
      <form onSubmit={onSubmit} className="mx-auto max-w-sm space-y-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
        <Field id="email" label="Email">
          <input id="email" type="email" className="input" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="password" label="Password">
          <input id="password" type="password" className="input" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Alert>{error}</Alert>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Memproses…' : 'Masuk'}
        </button>
      </form>
    </Layout>
  )
}

function LogoutButton() {
  return (
    <button type="button" className="rounded-lg border border-green-700 px-3 py-1.5 text-sm font-medium hover:bg-green-800" onClick={() => supabase.auth.signOut()}>
      Logout
    </button>
  )
}

function AdminGate({ session }: { session: Session }) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('is_admin').then(({ data, error }) => {
      if (error) setError(errorMessage(error))
      else setIsAdmin(data === true)
    })
  }, [session.user.id])

  const layout = (children: ReactNode) => (
    <Layout title="Admin Logbook Limbah B3" subtitle={session.user.email} actions={<LogoutButton />}>
      {children}
    </Layout>
  )
  if (error) return layout(<Alert>{error}</Alert>)
  if (isAdmin === null) return layout('Memeriksa akses…')
  if (!isAdmin)
    return layout(
      <Alert>
        Akun ini belum terdaftar sebagai admin. Minta pengelola menambahkan akun Anda ke tabel <code>admins</code> (lihat README).
      </Alert>,
    )
  return layout(<AdminHome />)
}

function AdminHome() {
  const [jenis, setJenis] = useState<JenisLimbah[]>([])
  const [masuk, setMasuk] = useState<KirimanMasuk[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [onlySisa, setOnlySisa] = useState(false)
  const [shown, setShown] = useState(SHOW_STEP)
  const [openKeluar, setOpenKeluar] = useState<number | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const j = await supabase.from('jenis_limbah').select('kode,nama').order('urutan')
      if (j.error) throw j.error
      const all: KirimanMasuk[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('kiriman_masuk')
          .select(MASUK_COLUMNS)
          .order('tanggal_masuk', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + PAGE - 1)
        if (error) throw error
        all.push(...(data as unknown as KirimanMasuk[]))
        if (data.length < PAGE) break
      }
      setJenis(j.data)
      setMasuk(all)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- memuat data awal
    load()
  }, [load])

  const namaByKode = useMemo(() => new Map(jenis.map((j) => [j.kode, j.nama])), [jenis])
  const tujuanList = useMemo(() => [...new Set(masuk.flatMap((m) => m.kiriman_keluar.map((k) => k.tujuan)))].sort(), [masuk])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return masuk.filter((m) => {
      if (onlySisa && sisaOf(m) <= 0) return false
      if (!q) return true
      return [m.kode_tiket, m.kode_limbah, namaByKode.get(m.kode_limbah), m.sumber, m.nama_pengirim, m.entity, m.telepon]
        .some((v) => v?.toLowerCase().includes(q))
    })
  }, [masuk, query, onlySisa, namaByKode])

  function onKeluarSaved(k: KirimanKeluar) {
    setMasuk((list) => list.map((m) => (m.id === k.masuk_id ? { ...m, kiriman_keluar: [...m.kiriman_keluar, k] } : m)))
    setOpenKeluar(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input type="search" className="input" placeholder="Cari tiket, kode, site, pengirim…" value={query} onChange={(e) => { setQuery(e.target.value); setShown(SHOW_STEP) }} />
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1 whitespace-nowrap" onClick={() => { setLoading(true); load() }} disabled={loading}>
            Muat ulang
          </button>
          <button type="button" className="btn-primary flex-1 whitespace-nowrap" disabled={loading || masuk.length === 0}
            onClick={() => downloadLogbook(masuk, jenis, config.maxStorageDays, todayISO())}>
            Export Excel
          </button>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input type="checkbox" className="size-4 accent-green-800" checked={onlySisa} onChange={(e) => setOnlySisa(e.target.checked)} />
        Hanya tampilkan yang masih ada sisa
      </label>

      {error && <Alert>{error}</Alert>}
      {loading && <p className="text-sm text-stone-600">Memuat data…</p>}
      {!loading && !error && (
        <p className="text-sm text-stone-600">
          {filtered.length} dari {masuk.length} kiriman masuk
        </p>
      )}

      <ul className="space-y-3">
        {filtered.slice(0, shown).map((m) => (
          <MasukCard key={m.id} m={m} nama={namaByKode.get(m.kode_limbah) ?? ''} tujuanList={tujuanList}
            open={openKeluar === m.id} onOpen={() => setOpenKeluar(m.id)} onClose={() => setOpenKeluar(null)} onSaved={onKeluarSaved} />
        ))}
      </ul>
      {filtered.length > shown && (
        <button type="button" className="btn-secondary w-full" onClick={() => setShown((n) => n + SHOW_STEP)}>
          Tampilkan lebih banyak
        </button>
      )}
    </div>
  )
}

interface CardProps {
  m: KirimanMasuk
  nama: string
  tujuanList: string[]
  open: boolean
  onOpen: () => void
  onClose: () => void
  onSaved: (k: KirimanKeluar) => void
}

function MasukCard({ m, nama, tujuanList, open, onOpen, onClose, onSaved }: CardProps) {
  const sisa = sisaOf(m)
  const batas = addDaysISO(m.tanggal_masuk, config.maxStorageDays)
  const lewat = sisa > 0 && batas < todayISO()
  return (
    <li className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-semibold text-stone-500">{m.kode_tiket}</p>
          <p className="font-semibold">
            {m.kode_limbah} - {nama}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${sisa > 0 ? 'bg-amber-100 text-amber-900' : 'bg-stone-100 text-stone-600'}`}>
          Sisa {formatKg(sisa)} kg
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <Info label="Tanggal masuk" value={formatDate(m.tanggal_masuk)} />
        <Info label="Jumlah" value={`${formatKg(Number(m.jumlah_kg))} kg`} />
        <Info label={`Batas simpan (+${config.maxStorageDays} hari)`} value={formatDate(batas)} warn={lewat} />
        <Info label="Sumber (Site)" value={m.sumber} />
        <Info label="Pengirim" value={m.nama_pengirim} />
        <Info label="Entity" value={m.entity} />
        <div>
          <dt className="text-stone-500">Telepon</dt>
          <dd>
            <a className="text-green-800 underline" href={`tel:${m.telepon}`}>
              {m.telepon}
            </a>
          </dd>
        </div>
      </dl>

      {m.kiriman_keluar.length > 0 && (
        <div className="mt-3 border-t border-stone-100 pt-3">
          <p className="mb-1 text-sm font-semibold text-stone-700">Keluar</p>
          <ul className="space-y-1 text-sm">
            {m.kiriman_keluar.map((k) => (
              <li key={k.id} className="rounded-md bg-stone-50 px-2 py-1.5">
                {formatDate(k.tanggal_keluar)} · {formatKg(Number(k.jumlah_kg))} kg → {k.tujuan} · e-Manifest {k.no_emanifest} · {k.kategori}
              </li>
            ))}
          </ul>
        </div>
      )}

      {open ? (
        <KeluarForm m={m} sisa={sisa} tujuanList={tujuanList} onCancel={onClose} onSaved={onSaved} />
      ) : (
        sisa > 0 && (
          <button type="button" className="btn-secondary mt-3 w-full sm:w-auto" onClick={onOpen}>
            Catat keluar
          </button>
        )
      )}
    </li>
  )
}

function Info({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-stone-500">{label}</dt>
      <dd className={warn ? 'font-semibold text-red-700' : ''}>
        {value}
        {warn && ' (lewat)'}
      </dd>
    </div>
  )
}

interface KeluarFormProps {
  m: KirimanMasuk
  sisa: number
  tujuanList: string[]
  onCancel: () => void
  onSaved: (k: KirimanKeluar) => void
}

function KeluarForm({ m, sisa, tujuanList, onCancel, onSaved }: KeluarFormProps) {
  const [tanggal, setTanggal] = useState(todayISO())
  const [jumlah, setJumlah] = useState(String(sisa))
  const [tujuan, setTujuan] = useState('')
  const [manifest, setManifest] = useState('')
  const [kategori, setKategori] = useState<'TPS' | 'Non TPS' | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const idp = `k${m.id}-`

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const n = Number(jumlah.replace(',', '.'))
    if (!tanggal || tanggal > todayISO() || tanggal < m.tanggal_masuk)
      return setError(`Tanggal keluar harus antara ${formatDate(m.tanggal_masuk)} dan hari ini.`)
    if (!Number.isFinite(n) || n <= 0) return setError('Jumlah harus angka lebih dari 0.')
    if (n > sisa) return setError(`Jumlah melebihi sisa (${formatKg(sisa)} kg).`)
    if (!tujuan.trim() || !manifest.trim() || !kategori) return setError('Lengkapi semua isian.')

    setBusy(true)
    setError(null)
    const { data, error } = await supabase
      .from('kiriman_keluar')
      .insert({ masuk_id: m.id, tanggal_keluar: tanggal, jumlah_kg: n, tujuan: tujuan.trim(), no_emanifest: manifest.trim(), kategori })
      .select('id,masuk_id,tanggal_keluar,jumlah_kg,tujuan,no_emanifest,kategori')
      .single()
    setBusy(false)
    if (error) return setError(errorMessage(error))
    onSaved(data as KirimanKeluar)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-3 space-y-3 rounded-lg border border-green-200 bg-green-50/50 p-3">
      <p className="text-sm font-semibold text-green-900">Catat limbah keluar — {m.kode_tiket}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${idp}tgl`} label="Tanggal keluar">
          <input id={`${idp}tgl`} type="date" className="input" min={m.tanggal_masuk} max={todayISO()} value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </Field>
        <Field id={`${idp}jml`} label="Jumlah (Kg)" hint={`Sisa ${formatKg(sisa)} kg`}>
          <input id={`${idp}jml`} className="input" inputMode="decimal" value={jumlah} onChange={(e) => setJumlah(e.target.value)} />
        </Field>
        <Field id={`${idp}tujuan`} label="Tujuan penyerahan">
          <input id={`${idp}tujuan`} className="input" list={`${idp}tujuan-list`} autoComplete="off" maxLength={200} value={tujuan} onChange={(e) => setTujuan(e.target.value)} />
          <datalist id={`${idp}tujuan-list`}>
            {tujuanList.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field id={`${idp}manifest`} label="No. e-Manifest">
          <input id={`${idp}manifest`} className="input" maxLength={100} value={manifest} onChange={(e) => setManifest(e.target.value)} />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-stone-800">
          TPS/Non TPS <span className="text-red-700" aria-hidden>*</span>
        </legend>
        <div className="flex gap-2">
          {(['TPS', 'Non TPS'] as const).map((v) => (
            <label key={v} className={`flex flex-1 cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium ${kategori === v ? 'border-green-800 bg-green-800 text-white' : 'border-stone-300 bg-white'}`}>
              <input type="radio" name={`${idp}kategori`} className="sr-only" checked={kategori === v} onChange={() => setKategori(v)} />
              {v}
            </label>
          ))}
        </div>
      </fieldset>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={onCancel} disabled={busy}>
          Batal
        </button>
        <button type="submit" className="btn-primary flex-1" disabled={busy}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </form>
  )
}
