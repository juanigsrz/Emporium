import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useShippingOverview, useShippingSummary } from '../../api/shipping'
import type { Shipment } from '../../api/shipping'
import { GameThumb } from '../../components/GameThumb'

type StatusFilter = '' | 'PENDING' | 'SENT' | 'RECEIVED'

const STATUS_PILL: Record<Shipment['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  SENT: 'bg-blue-50 text-blue-700 border-blue-200',
  RECEIVED: 'bg-green-50 text-green-700 border-green-200',
}

const label = (s: Shipment['status']) => s.charAt(0) + s.slice(1).toLowerCase()

export function ShippingOverviewTab({ slug }: { slug: string }) {
  const [filter, setFilter] = useState<StatusFilter>('')
  const [page, setPage] = useState(1)

  const { data: summary } = useShippingSummary(slug, true)
  const { data: pageData, isLoading } = useShippingOverview(slug, page, filter, true)

  const counts = summary?.counts ?? {}
  const rollup = summary?.traders ?? []
  const rows = pageData?.results ?? []
  const total = pageData?.count ?? 0
  const pageSize = 24
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  function changeFilter(next: StatusFilter) {
    setFilter(next)
    setPage(1)
  }

  return (
    <div className="space-y-5">
      {/* Status count bar */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-700">Pending {counts.PENDING ?? 0}</span>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 font-semibold text-blue-700">Sent {counts.SENT ?? 0}</span>
        <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 font-semibold text-green-700">Received {counts.RECEIVED ?? 0}</span>
      </div>

      {/* Per-trader rollup */}
      {rollup.length > 0 && (
        <div>
          <h3 className="mb-2 font-display text-sm font-bold text-ink">Per-trader progress</h3>
          <div className="divide-y-2 divide-ink/10 overflow-hidden rounded-2xl border-2 border-ink/15 bg-cream">
            {rollup.map((t) => {
              const behind = t.out_sent < t.out_total || t.in_received < t.in_total
              return (
                <div key={t.username} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Link to={`/u/${t.username}`} className="w-28 truncate font-semibold text-indigo-500 hover:underline">{t.username}</Link>
                  <span className="text-xs text-moss">sending {t.out_sent}/{t.out_total}</span>
                  <span className="text-xs text-moss">receiving {t.in_received}/{t.in_total}</span>
                  {behind && <span className="ml-auto text-xs font-medium text-amber-600" title="Behind">⚠ behind</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filterable, paginated table */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="font-display text-sm font-bold text-ink">All shipments</h3>
          <select
            value={filter}
            onChange={(e) => changeFilter(e.target.value as StatusFilter)}
            className="ml-auto rounded-xl border-2 border-ink/15 bg-cream px-2 py-1 text-xs font-medium text-ink focus:outline-none focus:ring-2 focus:ring-sage"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="RECEIVED">Received</option>
          </select>
        </div>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-moss">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-moss">No shipments.</p>
        ) : (
          <div className="divide-y-2 divide-ink/10 overflow-hidden rounded-2xl border-2 border-ink/15 bg-cream">
            {rows.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2">
                <GameThumb src={s.board_game_thumbnail} alt={s.board_game_name} className="h-9 w-9" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{s.board_game_name}</p>
                  <p className="text-xs text-moss">
                    <Link to={`/u/${s.giver_username}`} className="text-indigo-500 hover:underline">{s.giver_username}</Link>
                    {' → '}
                    <Link to={`/u/${s.receiver_username}`} className="text-indigo-500 hover:underline">{s.receiver_username}</Link>
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_PILL[s.status]}`}>
                  {label(s.status)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Pagination controls */}
        {total > pageSize && (
          <div className="mt-3 flex items-center justify-between text-xs text-moss">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-xl border-2 border-ink/15 bg-cream px-2 py-1 font-semibold text-moss disabled:opacity-40"
            >
              ← Prev
            </button>
            <span>Page {page} of {lastPage}</span>
            <button
              onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
              disabled={page >= lastPage}
              className="rounded-xl border-2 border-ink/15 bg-cream px-2 py-1 font-semibold text-moss disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
