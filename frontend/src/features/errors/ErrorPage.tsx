import type { ReactNode } from 'react'
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePageTitle } from '../../hooks/usePageTitle'

/** Shared parchment card used by both the 404 and the generic error screens. */
function ErrorShell({
  badge,
  title,
  body,
  children,
}: {
  badge: string
  title: string
  body: string
  children: ReactNode
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center sm:py-24">
      <div className="relative mb-8 grid h-24 w-24 place-items-center rounded-3xl border-2 border-ink bg-butter shadow-card">
        <svg width="44" height="44" viewBox="0 0 16 16" aria-hidden="true" className="text-ink">
          <g fill="currentColor">
            <circle cx="4.5" cy="4.5" r="1.7" />
            <circle cx="11.5" cy="4.5" r="1.7" />
            <circle cx="4.5" cy="11.5" r="1.7" />
            <circle cx="11.5" cy="11.5" r="1.7" />
          </g>
        </svg>
        <span className="absolute -bottom-3 -right-3 rounded-full border-2 border-ink bg-coral px-2.5 py-0.5 font-display text-sm font-bold text-ink shadow-pop-sm">
          {badge}
        </span>
      </div>
      <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">{title}</h1>
      <p className="mt-4 max-w-md text-base leading-relaxed text-moss">{body}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{children}</div>
    </div>
  )
}

const homeBtnCls =
  'rounded-2xl border-2 border-ink bg-butter px-6 py-3 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0'
const ghostBtnCls =
  'rounded-2xl border-2 border-ink/15 bg-cream px-6 py-3 text-sm font-semibold text-moss transition-colors hover:bg-sage/30'

/** Catch-all 404 page for unmatched routes. */
export function NotFoundPage() {
  const { t } = useTranslation()
  usePageTitle(t('errors.notFound.title'))
  return (
    <ErrorShell badge="404" title={t('errors.notFound.title')} body={t('errors.notFound.body')}>
      <Link to="/" className={homeBtnCls}>
        {t('errors.notFound.backHome')}
      </Link>
    </ErrorShell>
  )
}

/** Route-level errorElement. Renders the 404 page for 404 responses, otherwise
 *  a generic recoverable-error card with reload + home actions. */
export function RouteErrorBoundary() {
  const { t } = useTranslation()
  const error = useRouteError()
  usePageTitle(t('errors.generic.title'))

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />
  }

  return (
    <ErrorShell badge="!" title={t('errors.generic.title')} body={t('errors.generic.body')}>
      <button type="button" onClick={() => window.location.reload()} className={homeBtnCls}>
        {t('errors.generic.reload')}
      </button>
      <Link to="/" className={ghostBtnCls}>
        {t('errors.generic.backHome')}
      </Link>
    </ErrorShell>
  )
}
