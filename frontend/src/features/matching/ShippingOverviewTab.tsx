import { useMemo, useState } from 'react'
import { useShippingOverview } from '../../api/shipping'
import type { Shipment } from '../../api/shipping'
import { GameThumb } from '../../components/GameThumb'

type StatusFilter = 'all' | 'PENDING' | 'SENT' | 'RECEIVED'

const STATUS_PILL: Record<Shipment['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  SENT: 'bg-blue-50 text-blue-700 border-blue-200',
  RECEIVED: 'bg-green-50 text-green-700 border-green-200',
}

interface TraderRow {
  username: string
  outTotal: number
  outSent: number
  inTotal: number
  inReceived: number
}

function buildRollup(shipments: Shipment[]): TraderRow[] {
  const map = new Map<string, TraderRow>()
  const row = (u: string) => {
    let r = map.get(u)
    if (!r) {
      r = { username: u, outTotal: 0, outSent: 0, inTotal: 0, inReceived: 0 }
      map.set(u, r)
    }
    return r
  }
  for (const s of shipments) {
    const g = row(s.giver_username)
    g.outTotal++
    if (s.status === 'SENT' || s.status === 'RECEIVED') g.outSent++
    const rcv = row(s.receiver_username)
    rcv.inTotal++
    if (s.status === 'RECEIVED') rcv.inReceived++
  }
  return [...map.values()].sort((a, b) => a.username.localeCompare(b.username))
}

const label = (s: Shipment['status']) => s.charAt(0) + s.slice(1).toLowerCase()

export function ShippingOverviewTab({ slug }: { slug: string }) {
  const { data: shipments = [], isLoading } = useShippingOverview(slug, true)
  const [filter, setFilter] = useState<StatusFilter>('all')

  const counts = useMemo(
    () => ({
      PENDING: shipments.filter((s) => s.status === 'PENDING').length,
      SENT: shipments.filter((s) => s.status === 'SENT').length,
      RECEIVED: shipments.filter((s) => s.status === 'RECEIVED').length,
    }),
    [shipments],
  )
  const rollup = useMemo(() => buildRollup(shipments), [shipments])
  const rows = filter === 'all' ? shipments : shipments.filter((s) => s.status === filter)

  if (isLoading) return <p className="py-6 text-center text-sm text-gray-400">Loading…</p>
  if (shipments.length === 0)
    return <p className="py-6 text-center text-sm text-gray-400">No shipments yet.</p>

  return (
    <div className="space-y-5">
      {/* Status count bar */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1 font-medium text-amber-700">Pending {counts.PENDING}</span>
        <span className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1 font-medium text-blue-700">Sent {counts.SENT}</span>
        <span className="rounded-md border border-green-200 bg-green-50 px-3 py-1 font-medium text-green-700">Received {counts.RECEIVED}</span>
      </div>

      {/* Per-trader rollup */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Per-trader progress</h3>
        <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
          {rollup.map((t) => {
            const behind = t.outSent < t.outTotal || t.inReceived < t.inTotal
            return (
              <div key={t.username} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-28 truncate font-medium text-gray-800">{t.username}</span>
                <span className="text-xs text-gray-500">sending {t.outSent}/{t.outTotal}</span>
                <span className="text-xs text-gray-500">receiving {t.inReceived}/{t.inTotal}</span>
                {behind && <span className="ml-auto text-xs font-medium text-amber-600" title="Behind">⚠ behind</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Filterable table */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">All shipments</h3>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as StatusFilter)}
            className="ml-auto rounded-md border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="RECEIVED">Received</option>
          </select>
        </div>
        <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
          {rows.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2">
              <GameThumb src={s.board_game_thumbnail} alt={s.board_game_name} className="h-9 w-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-800">{s.board_game_name}</p>
                <p className="text-xs text-gray-500">{s.giver_username} → {s.receiver_username}</p>
              </div>
              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium ${STATUS_PILL[s.status]}`}>
                {label(s.status)}
              </span>
              <span className="hidden w-24 shrink-0 text-right text-[11px] text-gray-400 sm:block">
                {s.status === 'RECEIVED' && s.received_at
                  ? new Date(s.received_at).toLocaleDateString()
                  : s.status === 'SENT' && s.sent_at
                  ? new Date(s.sent_at).toLocaleDateString()
                  : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
