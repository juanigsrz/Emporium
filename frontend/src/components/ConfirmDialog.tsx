import type { ReactNode } from 'react'

type ConfirmDialogProps = {
  title: string
  body: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  destructive?: boolean
  pending?: boolean
}

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = false,
  pending = false,
}: ConfirmDialogProps) {
  const confirmCls = destructive
    ? 'flex-1 rounded-2xl border-2 border-ink bg-red-300 px-4 py-2.5 text-sm font-bold text-red-950 shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60'
    : 'flex-1 rounded-2xl border-2 border-ink bg-butter px-4 py-2.5 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onCancel} aria-hidden="true" />
      <div className="relative w-full max-w-sm rounded-3xl border-2 border-ink bg-cream p-6 shadow-card">
        <h2 className="mb-2 font-display text-lg font-bold text-ink">{title}</h2>
        <div className="mb-5 text-sm text-moss">{body}</div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-2xl border-2 border-ink/15 bg-cream px-4 py-2.5 text-sm font-semibold text-moss hover:bg-sage/30 transition-colors"
          >
            Cancel
          </button>
          <button onClick={onConfirm} disabled={pending} className={confirmCls}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
