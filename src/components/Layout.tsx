import type { ReactNode } from 'react'

export function Layout({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="bg-green-900 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-lg font-bold leading-tight">{title}</h1>
            {subtitle && <p className="text-sm text-green-100">{subtitle}</p>}
          </div>
          {actions}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
    </div>
  )
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'info'; children: ReactNode }) {
  const cls = kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'
  return (
    <div role="alert" className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>
      {children}
    </div>
  )
}
