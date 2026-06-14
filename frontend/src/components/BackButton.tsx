import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type BackButtonProps = {
  to?: string
  onClick?: () => void
  children: ReactNode
  className?: string
}

const baseCls =
  'inline-flex items-center gap-1.5 rounded-2xl border-2 border-ink/20 bg-cream px-4 py-2 text-sm font-semibold text-moss hover:bg-sage/40 transition-colors'

const Chevron = () => (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
)

export default function BackButton({ to, onClick, children, className = '' }: BackButtonProps) {
  const cls = `${baseCls} ${className}`.trim()
  if (to) {
    return (
      <Link to={to} className={cls}>
        <Chevron />
        {children}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      <Chevron />
      {children}
    </button>
  )
}
