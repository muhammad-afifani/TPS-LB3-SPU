import type { ReactNode } from 'react'

interface Props {
  id: string
  label: string
  error?: string
  hint?: string
  children: ReactNode
}

export function Field({ id, label, error, hint, children }: Props) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-stone-800">
        {label} <span className="text-red-700" aria-hidden>*</span>
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-stone-500">{hint}</p>
      ) : null}
    </div>
  )
}
