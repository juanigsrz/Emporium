import { createPortal } from 'react-dom'
import { useToastStore, type ToastKind } from '../store/toast'

function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === 'success') {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-ink bg-sage text-ink">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    )
  }
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-ink bg-coral text-ink">
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </span>
  )
}

/** Global toast stack. Mounted once in App; fed by the toast store. */
export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className="toast-enter pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border-2 border-ink bg-cream px-4 py-3 shadow-card"
        >
          <ToastIcon kind={t.kind} />
          <span className="flex-1 text-sm font-semibold text-ink">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="-mr-1 shrink-0 rounded-lg p-1 text-moss/60 transition-colors hover:bg-sage/30 hover:text-ink"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
