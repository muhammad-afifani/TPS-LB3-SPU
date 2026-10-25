import { useEffect, useState, type FormEvent } from 'react'
import { config } from '../config'
import { Field } from '../components/Field'
import { Alert, Layout } from '../components/Layout'
import { Turnstile } from '../components/Turnstile'
import { todayISO } from '../lib/dates'
import { isValidPhone, normalizePhone } from '../lib/phone'
import { errorMessage, supabase } from '../lib/supabase'
import type { JenisLimbah } from '../lib/types'

interface FormState {
  kode_limbah: string
  tanggal_masuk: string
  sumber: string
  jumlah_kg: string
  nama_pengirim: string
  entity: string
  telepon: string
}

type Errors = Partial<Record<keyof FormState, string>>

const emptyForm = (): FormState => ({
  kode_limbah: '',
  tanggal_masuk: todayISO(),
  sumber: '',
  jumlah_kg: '',
  nama_pengirim: '',
  entity: '',
  telepon: '',
})

function validate(f: FormState): Errors {
  const e: Errors = {}
  if (!f.kode_limbah) e.kode_limbah = 'Pilih kode dan jenis limbah.'
  if (!f.tanggal_masuk) e.tanggal_masuk = 'Isi tanggal masuk.'
  else if (f.tanggal_masuk > todayISO()) e.tanggal_masuk = 'Tanggal tidak boleh di masa depan.'
  if (!f.sumber.trim()) e.sumber = 'Isi sumber (site).'
  const jumlah = Number(f.jumlah_kg.replace(',', '.'))
  if (!f.jumlah_kg.trim() || !Number.isFinite(jumlah) || jumlah <= 0) e.jumlah_kg = 'Jumlah harus angka lebih dari 0.'
  if (!f.nama_pengirim.trim()) e.nama_pengirim = 'Isi nama pengirim.'
  if (!f.entity.trim()) e.entity = 'Isi entity.'
  if (!f.telepon.trim()) e.telepon = 'Isi nomor telepon.'
  else if (!isValidPhone(f.telepon)) e.telepon = 'Format tidak valid. Contoh: 081234567890 atau +62 812 3456 7890.'
  return e
}

export function PublicForm() {
  const [jenis, setJenis] = useState<JenisLimbah[]>([])
  const [sumberList, setSumberList] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<Errors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [turnstileKey, setTurnstileKey] = useState(0)
  const [ticket, setTicket] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('form_options').then(({ data, error }) => {
      if (error) setLoadError(errorMessage(error))
      else {
        setJenis(data?.jenis ?? [])
        setSumberList(data?.sumber ?? [])
      }
      setLoading(false)
    })
  }, [])

  const set = (key: keyof FormState) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    if (errors[key]) setErrors((er) => ({ ...er, [key]: undefined }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    const errs = validate(form)
    setErrors(errs)
    if (Object.keys(errs).length > 0) {
      document.getElementById(Object.keys(errs)[0])?.focus()
      return
    }
    if (!token) {
      setSubmitError('Selesaikan verifikasi keamanan (Turnstile) terlebih dahulu.')
      return
    }
    setSubmitting(true)
    const { data, error } = await supabase.rpc('submit_kiriman', {
      p_kode_limbah: form.kode_limbah,
      p_tanggal_masuk: form.tanggal_masuk,
      p_sumber: form.sumber.trim(),
      p_jumlah_kg: Number(form.jumlah_kg.replace(',', '.')),
      p_nama_pengirim: form.nama_pengirim.trim(),
      p_entity: form.entity.trim(),
      p_telepon: normalizePhone(form.telepon),
      p_captcha_token: token,
    })
    setSubmitting(false)
    // Token Turnstile hanya sekali pakai — selalu muat ulang widget.
    setTurnstileKey((k) => k + 1)
    if (error) {
      setSubmitError(errorMessage(error))
      return
    }
    const s = form.sumber.trim()
    if (!sumberList.includes(s)) setSumberList((l) => [...l, s].sort())
    setTicket(data as string)
    window.scrollTo(0, 0)
  }

  function fillAgain() {
    // Data pengirim dipertahankan agar pengirim yang sama cepat mengisi limbah berikutnya.
    setForm((f) => ({ ...emptyForm(), sumber: f.sumber, nama_pengirim: f.nama_pengirim, entity: f.entity, telepon: f.telepon }))
    setErrors({})
    setSubmitError(null)
    setTicket(null)
  }

  if (ticket) {
    return (
      <Layout title="Logbook Limbah B3" subtitle="Limbah masuk ke HWTA">
        <div className="rounded-xl border border-green-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-green-800">Data limbah masuk tersimpan.</p>
          <p className="mt-4 text-sm text-stone-600">Kode tiket Anda:</p>
          <p className="mt-1 select-all font-mono text-3xl font-bold tracking-wide text-stone-900">{ticket}</p>
          <p className="mt-3 text-sm text-stone-600">Catat atau foto kode tiket ini sebagai bukti penyerahan.</p>
          <button type="button" className="btn-primary mt-6 w-full sm:w-auto" onClick={fillAgain}>
            Isi lagi
          </button>
        </div>
      </Layout>
    )
  }

  const err = (k: keyof FormState) => (errors[k] ? { 'aria-invalid': true, 'aria-describedby': `${k}-error` } : {})

  return (
    <Layout title="Logbook Limbah B3" subtitle="Formulir limbah masuk ke HWTA">
      {loadError && (
        <div className="mb-4">
          <Alert>Gagal memuat data formulir: {loadError}</Alert>
        </div>
      )}
      <form noValidate onSubmit={onSubmit} className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
        <p className="text-sm text-stone-600">Semua kolom wajib diisi.</p>

        <Field id="kode_limbah" label="Kode dan Jenis Limbah B3" error={errors.kode_limbah}>
          <select id="kode_limbah" className="input" value={form.kode_limbah} onChange={set('kode_limbah')} disabled={loading} {...err('kode_limbah')}>
            <option value="">{loading ? 'Memuat…' : '— Pilih —'}</option>
            {jenis.map((j) => (
              <option key={j.kode} value={j.kode}>
                {j.kode} - {j.nama}
              </option>
            ))}
          </select>
        </Field>

        <Field id="tanggal_masuk" label="Tanggal masuk limbah ke HWTA" error={errors.tanggal_masuk}>
          <input id="tanggal_masuk" type="date" className="input" max={todayISO()} value={form.tanggal_masuk} onChange={set('tanggal_masuk')} {...err('tanggal_masuk')} />
        </Field>

        <Field id="sumber" label="Sumber (Site)" error={errors.sumber} hint="Ketik atau pilih dari saran.">
          <input id="sumber" className="input" list="sumber-list" autoComplete="off" maxLength={200} value={form.sumber} onChange={set('sumber')} {...err('sumber')} />
          <datalist id="sumber-list">
            {sumberList.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>

        <Field id="jumlah_kg" label="Jumlah (Kg)" error={errors.jumlah_kg}>
          <input id="jumlah_kg" className="input" inputMode="decimal" placeholder="0" value={form.jumlah_kg} onChange={set('jumlah_kg')} {...err('jumlah_kg')} />
        </Field>

        <Field id="nama_pengirim" label="Nama pengirim limbah ke HWTA" error={errors.nama_pengirim}>
          <input id="nama_pengirim" className="input" autoComplete="name" maxLength={120} value={form.nama_pengirim} onChange={set('nama_pengirim')} {...err('nama_pengirim')} />
        </Field>

        <Field id="entity" label="Entity" error={errors.entity}>
          <input id="entity" className="input" autoComplete="organization" maxLength={120} value={form.entity} onChange={set('entity')} {...err('entity')} />
        </Field>

        <Field id="telepon" label="No. telepon yang dapat dihubungi" error={errors.telepon} hint="Contoh: 081234567890">
          <input id="telepon" type="tel" className="input" autoComplete="tel" inputMode="tel" maxLength={20} value={form.telepon} onChange={set('telepon')} {...err('telepon')} />
        </Field>

        {config.turnstileSiteKey && <Turnstile siteKey={config.turnstileSiteKey} resetKey={turnstileKey} onToken={setToken} />}

        {submitError && <Alert>{submitError}</Alert>}

        <button type="submit" className="btn-primary w-full" disabled={submitting || loading || !!loadError}>
          {submitting ? 'Menyimpan…' : 'Kirim'}
        </button>
      </form>
    </Layout>
  )
}
