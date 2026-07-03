import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { usePaymentsOverview, usePaymentsSummary } from '../../api/payments'
import type { SettlementPayment } from '../../api/payments'

type StatusFilter = '' | 'PENDING' | 'PAID' | 'CONFIRMED'

const STATUS_PILL: Record<SettlementPayment['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  PAID: 'bg-violet-50 text-violet-700 border-violet-200',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

export function PaymentsOverviewTab({ slug }: { slug: string }) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<StatusFilter>('')
  const [page, setPage] = useState(1)

  const { data: summary, isLoading: summaryLoading } = usePaymentsSummary(slug, true)
  const { data: pageData, isLoading } = usePaymentsOverview(slug, page, filter, true)

  const counts = summary?.counts ?? {}
  const rollup = summary?.users ?? []
  const rows = pageData?.results ?? []
  const total = pageData?.count ?? 0
  const pageSize = 24
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  function changeFilter(next: StatusFilter) {
    setFilter(next)
    setPage(1)
  }

  if (!isLoading && !summaryLoading && total === 0 && rollup.length === 0) {
    return <p className="py-6 text-center text-sm text-moss">{t('matching.payments.overviewEmpty')}</p>
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-700">{t('matching.paymentStatus.PENDING')} {counts.PENDING ?? 0}</span>
        <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 font-semibold text-violet-700">{t('matching.paymentStatus.PAID')} {counts.PAID ?? 0}</span>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">{t('matching.paymentStatus.CONFIRMED')} {counts.CONFIRMED ?? 0}</span>
      </div>

      {rollup.length > 0 && (
        <div>
          <h3 className="mb-2 font-display text-sm font-bold text-ink">{t('matching.payments.perUserHeading')}</h3>
          <div className="divide-y-2 divide-ink/10 overflow-hidden rounded-2xl border-2 border-ink/15 bg-cream">
            {rollup.map((u) => {
              const behind = u.owe_paid < u.owe_total || u.due_confirmed < u.due_total
              return (
                <div key={u.username} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Link to={`/u/${u.username}`} className="w-28 truncate font-semibold text-indigo-500 hover:underline">{u.username}</Link>
                  <span className="text-xs text-moss">{t('matching.progressPaying', { done: u.owe_paid, total: u.owe_total })}</span>
                  <span className="text-xs text-moss">{t('matching.progressReceiving', { done: u.due_confirmed, total: u.due_total })}</span>
                  {behind && <span className="ml-auto text-xs font-medium text-amber-600" title={t('matching.behindTitle')}>⚠ {t('matching.behind')}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="font-display text-sm font-bold text-ink">{t('matching.payments.allHeading')}</h3>
          <select
            value={filter}
            onChange={(e) => changeFilter(e.target.value as StatusFilter)}
            className="ml-auto rounded-xl border-2 border-ink/15 bg-cream px-2 py-1 text-xs font-medium text-ink focus:outline-none focus:ring-2 focus:ring-sage"
            aria-label={t('matching.filterByStatusAriaLabel')}
          >
            <option value="">{t('matching.allStatuses')}</option>
            <option value="PENDING">{t('matching.paymentStatus.PENDING')}</option>
            <option value="PAID">{t('matching.paymentStatus.PAID')}</option>
            <option value="CONFIRMED">{t('matching.paymentStatus.CONFIRMED')}</option>
          </select>
        </div>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-moss">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-moss">{t('matching.payments.noneFiltered')}</p>
        ) : (
          <div className="divide-y-2 divide-ink/10 overflow-hidden rounded-2xl border-2 border-ink/15 bg-cream">
            {rows.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">
                    <Link to={`/u/${p.from_username}`} className="text-indigo-500 hover:underline">{p.from_username}</Link>
                    {' → '}
                    <Link to={`/u/${p.to_username}`} className="text-indigo-500 hover:underline">{p.to_username}</Link>
                  </p>
                </div>
                <span className="text-sm font-bold text-ink">${p.amount}</span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_PILL[p.status]}`}>
                  {t('matching.paymentStatus.' + p.status, { defaultValue: p.status })}
                </span>
              </div>
            ))}
          </div>
        )}

        {total > pageSize && (
          <div className="mt-3 flex items-center justify-between text-xs text-moss">
            <button onClick={() => setPage((x) => Math.max(1, x - 1))} disabled={page <= 1}
              className="rounded-xl border-2 border-ink/15 bg-cream px-2 py-1 font-semibold text-moss disabled:opacity-40">{t('matching.pagination.prev')}</button>
            <span>{t('matching.pagination.pageOf', { page, total: lastPage })}</span>
            <button onClick={() => setPage((x) => Math.min(lastPage, x + 1))} disabled={page >= lastPage}
              className="rounded-xl border-2 border-ink/15 bg-cream px-2 py-1 font-semibold text-moss disabled:opacity-40">{t('matching.pagination.next')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
