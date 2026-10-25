import { useEffect, useRef } from 'react'

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile tidak tersedia')))
    s.onerror = () => {
      scriptPromise = null
      reject(new Error('Gagal memuat Turnstile'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

interface Props {
  siteKey: string
  /** Ganti nilainya untuk memuat ulang widget (token Turnstile hanya sekali pakai). */
  resetKey: number
  onToken: (token: string | null) => void
}

export function Turnstile({ siteKey, resetKey, onToken }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  useEffect(() => {
    onTokenRef.current = onToken
  })

  useEffect(() => {
    let widgetId: string | null = null
    let cancelled = false
    onTokenRef.current(null)
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !ref.current) return
        widgetId = ts.render(ref.current, {
          sitekey: siteKey,
          language: 'id',
          theme: 'light',
          size: 'flexible',
          callback: (t: string) => onTokenRef.current(t),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        })
      })
      .catch(() => onTokenRef.current(null))
    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey, resetKey])

  return <div ref={ref} className="min-h-[65px]" />
}
