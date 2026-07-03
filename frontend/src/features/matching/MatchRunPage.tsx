import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, Link } from 'react-router-dom'
import BackButton from '../../components/BackButton'
import { useEvent } from '../../api/events'
import type { EventStatus } from '../../api/events'
import { useAuthStore } from '../../store/auth'
import {
  useMatchRuns,
  useMatchRun,
  useMatchResult,
  useMyAssignments,
  useTriggerMatchRun,
  useUploadSolution,
  fetchWantsExport,
} from '../../api/matching'
import type { MatchRunListItem, MatchRunDetail, TradeAssignment } from '../../api/matching'
import { useShipments, useUpdateShipment } from '../../api/shipping'
import { ShippingOverviewTab } from './ShippingOverviewTab'
import type { Shipment } from '../../api/shipping'
import { useMyPayments, useUpdatePayment } from '../../api/payments'
import type { SettlementPayment } from '../../api/payments'
import { PaymentsOverviewTab } from './PaymentsOverviewTab'
import { GameThumb } from '../../components/GameThumb'

// ---- helpers ----

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function extractErrorMsg(err: unknown): string | null {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: unknown } }).response
    const data = resp?.data
    if (data && typeof data === 'object') {
      const vals = Object.values(data as Record<string, unknown>)
      if (vals.length > 0) {
        const first = vals[0]
        return Array.isArray(first) ? String(first[0]) : String(first)
      }
    }
    if (typeof data === 'string') return data
  }
  return null
}

// ---- Status pill ----

type RunStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'

const STATUS_PILL: Record<RunStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  RUNNING: 'bg-violet-50 text-violet-700 border-violet-200',
  DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILED: 'bg-red-50 text-red-700 border-red-200',
}

function StatusPill({ status }: { status: RunStatus }) {
  const { t } = useTranslation()
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_PILL[status]}`}
    >
      {status === 'RUNNING' && (
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-violet-500 animate-pulse" />
      )}
      {t('matching.runStatus.' + status, { defaultValue: status })}
    </span>
  )
}

// ---- Run list item ----

function RunListItem({
  run,
  selected,
  onSelect,
}: {
  run: MatchRunListItem
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-2xl border px-4 py-3 transition-colors ${
        selected
          ? 'border-indigo-300 bg-indigo-50'
          : 'border-ink/15 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-moss/70">#{run.id}</span>
          <StatusPill status={run.status} />
          <span className="text-xs text-moss/70">{run.algorithm}</span>
        </div>
        <span className="text-xs text-moss/70">{formatDate(run.created)}</span>
      </div>
      {run.summary && run.status === 'DONE' && (
        <div className="mt-1.5 flex items-center gap-3 text-xs text-moss">
          <span>{t('matching.run.cyclesCount', { count: run.summary.cycles })}</span>
          <span>{t('matching.run.matched', { count: run.summary.matched_wishes })}</span>
          <span>{t('matching.run.unmatched', { count: run.summary.unmatched })}</span>
        </div>
      )}
    </button>
  )
}

// ---- Trigger button (organizer only, MATCHING state only) ----

function TriggerRunButton({ slug, onTriggered }: { slug: string; onTriggered: (id: number) => void }) {
  const { t } = useTranslation()
  const trigger = useTriggerMatchRun()
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setError(null)
    try {
      const run = await trigger.mutateAsync(slug)
      onTriggered(run.id)
    } catch (err) {
      setError(extractErrorMsg(err) ?? t('matching.errors.unexpected'))
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={trigger.isPending}
        className="rounded-2xl border-2 border-ink bg-violet-400 px-4 py-2 text-sm font-bold text-white shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
      >
        {trigger.isPending ? t('matching.run.triggering') : t('matching.run.trigger')}
      </button>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ---- X-to-Y solve panel (organizer, MATCHING) — export wants + upload solution ----

type ObjectiveKey = 'trades' | 'users' | 'distance'

interface ObjectiveRow {
  key: ObjectiveKey
  checked: boolean
}

// Default: only 'trades' on (matches solver default; distance off => no locations
// emitted until opted in). List order = solver priority (topmost optimized first).
const DEFAULT_OBJECTIVES: ObjectiveRow[] = [
  { key: 'trades', checked: true },
  { key: 'users', checked: false },
  { key: 'distance', checked: false },
]

function XToYSolvePanel({ slug, onUploaded }: { slug: string; onUploaded: (id: number) => void }) {
  const { t } = useTranslation()
  const upload = useUploadSolution()
  const [output, setOutput] = useState('')
  const [open, setOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [objectives, setObjectives] = useState<ObjectiveRow[]>(DEFAULT_OBJECTIVES)
  const kpi = objectives.filter((o) => o.checked).map((o) => o.key)

  function toggleObjective(i: number) {
    setObjectives((os) =>
      os.map((o, idx) => (idx === i ? { ...o, checked: !o.checked } : o)),
    )
  }

  function moveObjective(i: number, dir: -1 | 1) {
    setObjectives((os) => {
      const j = i + dir
      if (j < 0 || j >= os.length) return os
      const next = os.slice()
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function handleDownload() {
    setError(null)
    setDownloading(true)
    try {
      const text = await fetchWantsExport(slug, kpi)
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}-wants.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(extractErrorMsg(err) ?? t('matching.errors.unexpected'))
    } finally {
      setDownloading(false)
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) file.text().then(setOutput)
  }

  async function handleUpload() {
    setError(null)
    if (!output.trim()) {
      setError(t('matching.run.pasteOutputFirst'))
      return
    }
    try {
      const run = await upload.mutateAsync({ slug, output })
      onUploaded(run.id)
      setOutput('')
      setOpen(false)
    } catch (err) {
      setError(extractErrorMsg(err) ?? t('matching.errors.unexpected'))
    }
  }

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3 space-y-2 w-full sm:w-80">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">
          {t('matching.run.objectivesHeading')}
        </p>
        {objectives.map((o, i) => {
          const label = t(`matching.run.objectives.${o.key}`)
          return (
            <div key={o.key} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={o.checked}
                onChange={() => toggleObjective(i)}
                className="rounded border-ink/30 text-violet-500 focus:ring-violet-500"
              />
              <span className="w-5 text-xs text-violet-600">{i + 1}.</span>
              <span className="flex-1">{label}</span>
              <button
                type="button"
                onClick={() => moveObjective(i, -1)}
                disabled={i === 0}
                aria-label={t('matching.run.moveUp', { label })}
                className="px-1.5 text-violet-600 disabled:opacity-30 hover:text-violet-800"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveObjective(i, 1)}
                disabled={i === objectives.length - 1}
                aria-label={t('matching.run.moveDown', { label })}
                className="px-1.5 text-violet-600 disabled:opacity-30 hover:text-violet-800"
              >
                ↓
              </button>
            </div>
          )
        })}
      </div>
      <button
        onClick={handleDownload}
        disabled={downloading || kpi.length === 0}
        className="w-full rounded-2xl border-2 border-ink bg-violet-400 px-4 py-2 text-sm font-bold text-white shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
      >
        {downloading ? t('matching.run.preparing') : t('matching.run.downloadWants')}
      </button>
      {kpi.length === 0 ? (
        <p className="text-xs text-red-600">{t('matching.run.selectAtLeastOneObjective')}</p>
      ) : (
        <p className="text-xs text-violet-600">
          {t('matching.run.objectivesLabel')} <code className="font-mono">--kpi {kpi.join(',')}</code>
          <br />
          {t('matching.run.objectivesHint')}
        </p>
      )}
      {open ? (
        <div className="space-y-2">
          <textarea
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            placeholder={t('matching.run.pasteOutputPlaceholder')}
            rows={4}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <input
            type="file"
            accept=".txt,text/plain"
            onChange={handleFile}
            className="block w-full text-xs text-moss file:mr-2 file:rounded file:border-0 file:bg-violet-100 file:px-2 file:py-1 file:text-violet-700"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setOpen(false); setError(null) }}
              className="flex-1 rounded-xl border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleUpload}
              disabled={upload.isPending}
              className="flex-1 rounded-xl border-2 border-ink bg-violet-400 px-3 py-1.5 text-xs font-bold text-white shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              {upload.isPending ? t('matching.run.uploading') : t('matching.run.uploadSolution')}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-xl border border-violet-300 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 transition-colors"
        >
          {t('matching.run.uploadSolutionPrompt')}
        </button>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ---- Live run status / log view ----

function LiveRunView({ slug, runId }: { slug: string; runId: number }) {
  const { t } = useTranslation()
  const { data: run } = useMatchRun(slug, runId)

  if (!run) {
    return (
      <div className="rounded-xl border border-ink/15 bg-white p-5 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-1/3 mb-3" />
        <div className="h-24 bg-gray-100 rounded" />
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-ink/15 bg-white p-5 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold text-ink">{t('matching.run.runNumber', { id: run.id })}</span>
        <StatusPill status={run.status} />
        {run.status === 'PENDING' || run.status === 'RUNNING' ? (
          <span className="text-xs text-moss/70 animate-pulse">{t('matching.run.pollingEvery2s')}</span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-moss">
        <div>
          <p className="font-medium text-ink mb-0.5">{t('matching.run.algorithm')}</p>
          <p>{run.algorithm}</p>
        </div>
        <div>
          <p className="font-medium text-ink mb-0.5">{t('matching.run.started')}</p>
          <p>{formatDate(run.started_at)}</p>
        </div>
        <div>
          <p className="font-medium text-ink mb-0.5">{t('matching.run.finished')}</p>
          <p>{formatDate(run.finished_at)}</p>
        </div>
        {run.summary && (
          <div>
            <p className="font-medium text-ink mb-0.5">{t('matching.run.summary')}</p>
            <p>{t('matching.run.cyclesCount', { count: run.summary.cycles })} · {t('matching.run.matched', { count: run.summary.matched_wishes })}</p>
          </div>
        )}
      </div>

      {run.log && (
        <div>
          <p className="text-xs font-semibold text-moss uppercase tracking-wide mb-1.5">{t('matching.run.log')}</p>
          <pre className="rounded-xl bg-gray-950 text-gray-200 text-xs p-3 overflow-x-auto whitespace-pre-wrap max-h-56 font-mono leading-relaxed">
            {run.log}
          </pre>
        </div>
      )}

      {run.status === 'FAILED' && (
        <p className="text-sm text-red-600 font-medium">
          {t('matching.run.failedMessage')}
        </p>
      )}
    </div>
  )
}

// ---- My Trades section ----

function MyTradesSection({
  assignments,
  currentUsername,
}: {
  assignments: TradeAssignment[]
  currentUsername: string
}) {
  const { t } = useTranslation()
  const giveList = assignments.filter((a) => a.giver_username === currentUsername)
  const receiveList = assignments.filter((a) => a.receiver_username === currentUsername)

  return (
    <div className="space-y-6">
      {/* Giving group */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
          {t('matching.trades.giving', { count: giveList.length })}
        </p>
        {giveList.length === 0 ? (
          <p className="text-sm text-moss/70">{t('matching.trades.noGiving')}</p>
        ) : (
          giveList.map((a) => (
            <div
              key={a.id}
              className="rounded-2xl border border-ink/15 bg-white p-4 flex items-start gap-3"
            >
              <div className="shrink-0 w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
                </svg>
              </div>
              <GameThumb src={a.board_game_thumbnail} alt={a.board_game_name} className="h-10 w-10" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-0.5">{t('matching.trades.youGive')}</p>
                <p className="text-sm font-medium text-ink truncate">{a.board_game_name}</p>
                <p className="text-xs text-moss/70 font-mono">{a.listing_code}</p>
                <p className="text-xs text-moss mt-0.5">
                  {t('matching.trades.to')}{' '}
                  <Link
                    to={`/u/${a.receiver_username}`}
                    className="text-indigo-500 hover:underline font-medium"
                  >
                    {a.receiver_username}
                  </Link>
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Receiving group */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
          {t('matching.trades.receiving', { count: receiveList.length })}
        </p>
        {receiveList.length === 0 ? (
          <p className="text-sm text-moss/70">{t('matching.trades.noReceiving')}</p>
        ) : (
          receiveList.map((a) => (
            <div
              key={a.id}
              className="rounded-2xl border border-ink/15 bg-white p-4 flex items-start gap-3"
            >
              <div className="shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                </svg>
              </div>
              <GameThumb src={a.board_game_thumbnail} alt={a.board_game_name} className="h-10 w-10" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-0.5">{t('matching.trades.youReceive')}</p>
                <p className="text-sm font-medium text-ink truncate">{a.board_game_name}</p>
                <p className="text-xs text-moss/70 font-mono">{a.listing_code}</p>
                <p className="text-xs text-moss mt-0.5">
                  {t('matching.trades.from')}{' '}
                  <Link
                    to={`/u/${a.giver_username}`}
                    className="text-indigo-500 hover:underline font-medium"
                  >
                    {a.giver_username}
                  </Link>
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Payments — item-level breakdown + net balance (the "why"). Actionable payments live in the Shipping & Payments tab. */}
      {(() => {
        // Only CASH legs move money; barter is free. cash_amount is null on barter
        // legs (item_value carries the game's ask even there), so filter and sum on
        // cash_amount to keep the net in actual money owed.
        const bought = assignments.filter(
          (a) => a.cash_amount != null && a.receiver_username === currentUsername
        )
        const sold = assignments.filter(
          (a) => a.cash_amount != null && a.giver_username === currentUsername
        )
        if (bought.length === 0 && sold.length === 0) return null

        const boughtTotal = bought.reduce((s, a) => s + Number(a.cash_amount), 0)
        const soldTotal = sold.reduce((s, a) => s + Number(a.cash_amount), 0)
        const net = boughtTotal - soldTotal // > 0 => you owe

        return (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">
              {t('matching.trades.paymentsHeading')}
            </p>

            {bought.map((a) => (
              <div key={`buy-${a.id}`} className="rounded-2xl border border-ink/15 bg-white p-4">
                <p className="text-sm text-ink">
                  {t('matching.trades.youBought')} <span className="font-semibold">{a.board_game_name}</span> {t('matching.trades.forPrice')}{' '}
                  <span className="font-semibold">${a.cash_amount}</span> {t('matching.trades.from')}{' '}
                  <Link to={`/u/${a.giver_username}`} className="font-semibold text-indigo-500 hover:underline">
                    {a.giver_username}
                  </Link>
                </p>
                <p className="text-xs text-moss/70 font-mono">{a.listing_code}</p>
              </div>
            ))}

            {sold.map((a) => (
              <div key={`sell-${a.id}`} className="rounded-2xl border border-ink/15 bg-white p-4">
                <p className="text-sm text-ink">
                  {t('matching.trades.youSold')} <span className="font-semibold">{a.board_game_name}</span> {t('matching.trades.forPrice')}{' '}
                  <span className="font-semibold">${a.cash_amount}</span> {t('matching.trades.to')}{' '}
                  <Link to={`/u/${a.receiver_username}`} className="font-semibold text-indigo-500 hover:underline">
                    {a.receiver_username}
                  </Link>
                </p>
                <p className="text-xs text-moss/70 font-mono">{a.listing_code}</p>
              </div>
            ))}

            {/* Net balance — the "why" */}
            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
              {net > 0 ? (
                <span>{t('matching.trades.netBalancePrefix')} <strong className="text-red-700">{t('matching.money.youOwe', { amount: net.toFixed(2) })}</strong></span>
              ) : net < 0 ? (
                <span>{t('matching.trades.netBalancePrefix')} <strong className="text-emerald-700">{t('matching.money.youAreOwed', { amount: (-net).toFixed(2) })}</strong></span>
              ) : (
                <span>{t('matching.trades.netBalancePrefix')} <strong>{t('matching.money.even')}</strong></span>
              )}
            </div>

          </div>
        )
      })()}
    </div>
  )
}

// ---- Cycle visualization (removed) ----
// The SVG ring diagram assumed clean, per-user-balanced cycles. X-to-Y solutions
// are tangled connected-component flows that don't decompose into rings, so the
// "All Cycles" tab was dropped; result.cycles is now only summarized in Stats.

// ---- Stats section ----

function StatsSection({ result }: { result: import('../../api/matching').MatchResult }) {
  const { t } = useTranslation()
  const stats = result.stats
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {(
        [
          [t('matching.stats.users'), stats.users],
          [t('matching.stats.listings'), stats.listings],
          [t('matching.stats.matched'), stats.matched],
          [t('matching.stats.cycles'), stats.cycles],
        ] as [string, number][]
      ).map(([label, val]) => (
        <div
          key={label}
          className="rounded-xl border border-ink/15 bg-white p-4 text-center shadow-sm"
        >
          <p className="text-2xl font-bold text-indigo-600">{val}</p>
          <p className="text-xs text-moss mt-1">{label}</p>
        </div>
      ))}
    </div>
  )
}

// ---- Unmatched section ----

function UnmatchedSection({ unmatched }: { unmatched: import('../../api/matching').UnmatchedWish[] }) {
  const { t } = useTranslation()
  if (unmatched.length === 0) return null

  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">
        {t('matching.stats.unmatchedHeading', { count: unmatched.length })}
      </p>
      <div className="space-y-1.5">
        {unmatched.map((u) => (
          <div key={u.wish_id} className="flex items-start gap-2 text-xs">
            <span className="text-amber-600 font-mono shrink-0">{t('matching.stats.wishNumber', { id: u.wish_id })}</span>
            <span className="text-amber-700">{u.reason}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Shipping tab ----

const SHIPMENT_STATUS_PILL: Record<Shipment['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  SENT: 'bg-violet-50 text-violet-700 border-violet-200',
  RECEIVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

function ShipmentStatusBadge({ status }: { status: Shipment['status'] }) {
  const { t } = useTranslation()
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SHIPMENT_STATUS_PILL[status]}`}
    >
      {t('matching.shipmentStatus.' + status, { defaultValue: status })}
    </span>
  )
}

function ShippingTab({ slug, readOnly }: { slug: string; readOnly: boolean }) {
  const { t } = useTranslation()
  const { data: shipments = [], isLoading } = useShipments(slug)
  const update = useUpdateShipment(slug)

  const sending = shipments.filter((s) => s.my_role === 'sender')
  const receiving = shipments.filter((s) => s.my_role === 'receiver')

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-20 rounded-2xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    )
  }

  if (shipments.length === 0) {
    return <p className="text-sm text-moss/70">{t('matching.shipping.empty')}</p>
  }

  return (
    <div className="space-y-6">
      {/* Sending */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
          {t('matching.shipping.sendingHeading', { count: sending.length })}
        </p>
        {sending.length === 0 ? (
          <p className="text-sm text-moss/70">{t('matching.nothingToSend')}</p>
        ) : (
          sending.map((s) => (
            <ShipmentSenderCard key={s.id} shipment={s} readOnly={readOnly} onUpdate={update} />
          ))
        )}
      </div>

      {/* Receiving */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
          {t('matching.shipping.receivingHeading', { count: receiving.length })}
        </p>
        {receiving.length === 0 ? (
          <p className="text-sm text-moss/70">{t('matching.nothingToReceive')}</p>
        ) : (
          receiving.map((s) => (
            <ShipmentReceiverCard key={s.id} shipment={s} readOnly={readOnly} onUpdate={update} />
          ))
        )}
      </div>
    </div>
  )
}

function ShippingPaymentsTab({
  slug, readOnly, moneyEnabled,
}: {
  slug: string
  readOnly: boolean
  moneyEnabled: boolean
}) {
  return (
    <div className="space-y-8">
      <ShippingTab slug={slug} readOnly={readOnly} />
      {moneyEnabled && <PaymentsSections slug={slug} readOnly={readOnly} />}
    </div>
  )
}

function OverviewTab({ slug, moneyEnabled }: { slug: string; moneyEnabled: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-3 text-sm font-semibold text-ink">{t('matching.shipping.heading')}</h2>
        <ShippingOverviewTab slug={slug} />
      </div>
      {moneyEnabled && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink">{t('matching.payments.settlementHeading')}</h2>
          <PaymentsOverviewTab slug={slug} />
        </div>
      )}
    </div>
  )
}

function ShipmentSenderCard({
  shipment: s,
  readOnly,
  onUpdate,
}: {
  shipment: Shipment
  readOnly: boolean
  onUpdate: ReturnType<typeof useUpdateShipment>
}) {
  const { t } = useTranslation()
  const [shippingInfo, setShippingInfo] = useState(s.shipping_info)
  const [error, setError] = useState<string | null>(null)

  async function handleMarkSent() {
    setError(null)
    try {
      await onUpdate.mutateAsync({ id: s.id, body: { status: 'SENT', shipping_info: shippingInfo } })
    } catch (err) {
      setError(extractErrorMsg(err) ?? t('matching.errors.unexpected'))
    }
  }

  return (
    <div className="rounded-2xl border border-ink/15 bg-white p-4 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <GameThumb src={s.board_game_thumbnail} alt={s.board_game_name} className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink truncate">{s.board_game_name}</p>
            <p className="text-xs text-moss/70 font-mono">{s.listing_code}</p>
            <p className="text-xs text-moss mt-0.5">
              {t('matching.trades.to')}{' '}
              <Link to={`/u/${s.receiver_username}`} className="text-indigo-500 hover:underline font-medium">
                {s.receiver_username}
              </Link>
            </p>
          </div>
        </div>
        <ShipmentStatusBadge status={s.status} />
      </div>

      {!readOnly && s.status === 'PENDING' && (
        <div className="space-y-2 pt-1">
          <input
            type="text"
            value={shippingInfo}
            onChange={(e) => setShippingInfo(e.target.value)}
            placeholder={t('matching.shipping.trackingPlaceholder')}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleMarkSent}
            disabled={onUpdate.isPending}
            className="rounded-xl border-2 border-ink bg-butter px-3 py-1.5 text-xs font-bold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {onUpdate.isPending ? t('matching.saving') : t('matching.shipping.markSent')}
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}

      {s.status !== 'PENDING' && s.shipping_info && (
        <p className="text-xs text-moss">
          <span className="font-medium">{t('matching.shipping.infoLabel')}</span> {s.shipping_info}
        </p>
      )}
    </div>
  )
}

function ShipmentReceiverCard({
  shipment: s,
  readOnly,
  onUpdate,
}: {
  shipment: Shipment
  readOnly: boolean
  onUpdate: ReturnType<typeof useUpdateShipment>
}) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)

  async function handleMarkReceived() {
    setError(null)
    try {
      await onUpdate.mutateAsync({ id: s.id, body: { status: 'RECEIVED' } })
    } catch (err) {
      setError(extractErrorMsg(err) ?? t('matching.errors.unexpected'))
    }
  }

  return (
    <div className="rounded-2xl border border-ink/15 bg-white p-4 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <GameThumb src={s.board_game_thumbnail} alt={s.board_game_name} className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink truncate">{s.board_game_name}</p>
            <p className="text-xs text-moss/70 font-mono">{s.listing_code}</p>
            <p className="text-xs text-moss mt-0.5">
              {t('matching.trades.from')}{' '}
              <Link to={`/u/${s.giver_username}`} className="text-indigo-500 hover:underline font-medium">
                {s.giver_username}
              </Link>
            </p>
          </div>
        </div>
        <ShipmentStatusBadge status={s.status} />
      </div>

      {s.shipping_info && (
        <p className="text-xs text-moss">
          <span className="font-medium">{t('matching.shipping.infoLabel')}</span> {s.shipping_info}
        </p>
      )}

      {!readOnly && s.status === 'SENT' && (
        <div className="pt-1">
          <button
            onClick={handleMarkReceived}
            disabled={onUpdate.isPending}
            className="rounded-xl border-2 border-ink bg-emerald-400 px-3 py-1.5 text-xs font-bold text-white shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {onUpdate.isPending ? t('matching.saving') : t('matching.shipping.markReceived')}
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}

// ---- Payment cards ----

const PAYMENT_STATUS_PILL: Record<SettlementPayment['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  PAID: 'bg-violet-50 text-violet-700 border-violet-200',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

function PaymentStatusBadge({ status }: { status: SettlementPayment['status'] }) {
  const { t } = useTranslation()
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PAYMENT_STATUS_PILL[status]}`}>
      {t('matching.paymentStatus.' + status, { defaultValue: status })}
    </span>
  )
}

function PaymentPayerCard({
  payment: p, readOnly, onUpdate,
}: {
  payment: SettlementPayment
  readOnly: boolean
  onUpdate: ReturnType<typeof useUpdatePayment>
}) {
  const { t } = useTranslation()
  const [note, setNote] = useState(p.note)
  const [error, setError] = useState<string | null>(null)

  async function handleMarkPaid() {
    setError(null)
    try {
      await onUpdate.mutateAsync({ id: p.id, body: { status: 'PAID', note } })
    } catch (err) {
      setError(extractErrorMsg(err) ?? t('matching.errors.unexpected'))
    }
  }

  return (
    <div className="rounded-2xl border border-ink/15 bg-white p-4 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-sm text-ink">
          {t('matching.payments.pay')}{' '}
          <Link to={`/u/${p.to_username}`} className="font-semibold text-indigo-500 hover:underline">
            {p.to_username}
          </Link>{' '}
          <span className="font-semibold">${p.amount}</span>
        </p>
        <PaymentStatusBadge status={p.status} />
      </div>

      {!readOnly && p.status === 'PENDING' && (
        <div className="space-y-2 pt-1">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('matching.payments.notePlaceholder')}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleMarkPaid}
            disabled={onUpdate.isPending}
            className="rounded-xl border-2 border-ink bg-butter px-3 py-1.5 text-xs font-bold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {onUpdate.isPending ? t('matching.saving') : t('matching.payments.markPaid')}
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}

      {p.status !== 'PENDING' && p.note && (
        <p className="text-xs text-moss"><span className="font-medium">{t('matching.payments.referenceLabel')}</span> {p.note}</p>
      )}
    </div>
  )
}

function PaymentPayeeCard({
  payment: p, readOnly, onUpdate,
}: {
  payment: SettlementPayment
  readOnly: boolean
  onUpdate: ReturnType<typeof useUpdatePayment>
}) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setError(null)
    try {
      await onUpdate.mutateAsync({ id: p.id, body: { status: 'CONFIRMED' } })
    } catch (err) {
      setError(extractErrorMsg(err) ?? t('matching.errors.unexpected'))
    }
  }

  return (
    <div className="rounded-2xl border border-ink/15 bg-white p-4 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-sm text-ink">
          {t('matching.payments.receive')} <span className="font-semibold">${p.amount}</span> {t('matching.trades.from')}{' '}
          <Link to={`/u/${p.from_username}`} className="font-semibold text-indigo-500 hover:underline">
            {p.from_username}
          </Link>
        </p>
        <PaymentStatusBadge status={p.status} />
      </div>

      {p.note && (
        <p className="text-xs text-moss"><span className="font-medium">{t('matching.payments.referenceLabel')}</span> {p.note}</p>
      )}

      {!readOnly && p.status === 'PAID' && (
        <div className="pt-1">
          <button
            onClick={handleConfirm}
            disabled={onUpdate.isPending}
            className="rounded-xl border-2 border-ink bg-emerald-400 px-3 py-1.5 text-xs font-bold text-white shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {onUpdate.isPending ? t('matching.saving') : t('matching.payments.confirmReceived')}
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}

function PaymentsSections({ slug, readOnly }: { slug: string; readOnly: boolean }) {
  const { t } = useTranslation()
  const { data: payments = [], isLoading } = useMyPayments(slug, true)
  const update = useUpdatePayment(slug)
  const paying = payments.filter((p) => p.my_role === 'payer')
  const receiving = payments.filter((p) => p.my_role === 'payee')

  if (isLoading) return <div className="h-16 rounded-2xl bg-gray-100 animate-pulse" />
  if (payments.length === 0) return null

  return (
    <>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">
          {t('matching.payments.toSendHeading', { count: paying.length })}
        </p>
        {paying.length === 0
          ? <p className="text-sm text-moss/70">{t('matching.nothingToPay')}</p>
          : paying.map((p) => <PaymentPayerCard key={p.id} payment={p} readOnly={readOnly} onUpdate={update} />)}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
          {t('matching.payments.toReceiveHeading', { count: receiving.length })}
        </p>
        {receiving.length === 0
          ? <p className="text-sm text-moss/70">{t('matching.nothingToReceive')}</p>
          : receiving.map((p) => <PaymentPayeeCard key={p.id} payment={p} readOnly={readOnly} onUpdate={update} />)}
      </div>
    </>
  )
}

// ---- Run result view ----

function RunResultView({ slug, run, eventStatus, isOrganizer, moneyEnabled }: { slug: string; run: MatchRunDetail; eventStatus: EventStatus; isOrganizer: boolean; moneyEnabled: boolean }) {
  const { t } = useTranslation()
  const isDone = run.status === 'DONE'
  const { data: result, isLoading: resultLoading, isError: resultError } = useMatchResult(slug, run.id, isDone)
  const { data: mineData, isLoading: mineLoading } = useMyAssignments(slug, run.id, isDone)
  const { user } = useAuthStore()
  const currentUsername = user?.username ?? ''

  const showShipping = eventStatus === 'SHIPPING' || eventStatus === 'ARCHIVED'
  const [activeTab, setActiveTab] = useState<'my-trades' | 'stats' | 'shipping-payments' | 'overview'>('my-trades')

  if (!isDone) {
    return <LiveRunView slug={slug} runId={run.id} />
  }

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'my-trades', label: t('matching.tabs.myTrades') },
    { id: 'stats', label: t('matching.tabs.statsUnmatched') },
    ...(showShipping ? [{ id: 'shipping-payments' as const, label: t('matching.tabs.shippingPayments') }] : []),
    ...(showShipping && isOrganizer ? [{ id: 'overview' as const, label: t('matching.tabs.overview') }] : []),
  ]

  return (
    <div className="space-y-4">
      <LiveRunView slug={slug} runId={run.id} />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-ink/15">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-moss hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'my-trades' && (
          <div>
            {mineLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-20 rounded-2xl bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <MyTradesSection
                assignments={mineData?.results ?? []}
                currentUsername={currentUsername}
              />
            )}
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="space-y-4">
            {resultLoading && (
              <div className="h-24 rounded-xl bg-gray-100 animate-pulse" />
            )}
            {resultError && (
              <p className="text-sm text-red-600">{t('matching.run.statsLoadError')}</p>
            )}
            {result && (
              <>
                <StatsSection result={result} />
                <UnmatchedSection unmatched={result.unmatched} />
              </>
            )}
          </div>
        )}

        {activeTab === 'shipping-payments' && (
          <ShippingPaymentsTab
            slug={slug}
            readOnly={eventStatus === 'ARCHIVED'}
            moneyEnabled={moneyEnabled}
          />
        )}

        {activeTab === 'overview' && (
          <OverviewTab slug={slug} moneyEnabled={moneyEnabled} />
        )}
      </div>
    </div>
  )
}

// ---- Main page ----

export default function MatchRunPage() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const { token } = useAuthStore()

  const { data: event, isLoading: eventLoading } = useEvent(slug)
  const { data: runsData, isLoading: runsLoading } = useMatchRuns(slug)

  const runs = runsData?.results ?? []

  // Selected run id — default to latest
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const latestRunId = runs.length > 0 ? runs[0].id : null
  const activeRunId = selectedRunId ?? latestRunId

  const { data: activeRun } = useMatchRun(
    slug,
    activeRunId ?? undefined
  )

  // Visible statuses for the matching section
  const matchingStatuses = ['MATCHING', 'MATCH_REVIEW', 'FINALIZATION', 'SHIPPING', 'ARCHIVED']
  const showMatchingSection = event && matchingStatuses.includes(event.status)
  const canTrigger = event?.is_organizer && event?.status === 'MATCHING'

  function handleTriggered(newId: number) {
    setSelectedRunId(newId)
  }

  if (eventLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-4 animate-pulse">
        <div className="h-8 w-1/3 bg-gray-100 rounded" />
        <div className="h-24 bg-gray-100 rounded-xl" />
        <div className="h-48 bg-gray-100 rounded-xl" />
      </div>
    )
  }

  if (!event) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-8 text-center">
          <p className="text-sm text-red-700">{t('matching.eventNotFound')}</p>
          <BackButton to="/events" className="mt-3">{t('matching.backToEvents')}</BackButton>
        </div>
      </div>
    )
  }

  if (!showMatchingSection) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="rounded-2xl border border-ink/15 bg-gray-50 px-5 py-10 text-center">
          <p className="text-sm text-moss">
            {t('matching.notAvailable')}
          </p>
          <p className="text-xs text-moss/70 mt-1">
            {t('matching.notAvailableHint')}
          </p>
          <BackButton to={`/events/${slug}`} className="mt-4">{t('matching.backToEvent')}</BackButton>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-moss/70">
        <Link to="/events" className="hover:text-indigo-600 transition-colors">{t('matching.breadcrumbEvents')}</Link>
        <span>/</span>
        <Link to={`/events/${slug}`} className="hover:text-indigo-600 transition-colors truncate max-w-xs">
          {event.name}
        </Link>
        <span>/</span>
        <span className="text-moss">{t('matching.title')}</span>
      </div>

      <BackButton to={`/events/${slug}`}>{t('matching.backToEvent')}</BackButton>

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink">{t('matching.title')}</h1>
          <p className="text-sm text-moss mt-0.5">{event.name}</p>
        </div>
        {canTrigger && token && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <XToYSolvePanel slug={slug!} onUploaded={handleTriggered} />
            <TriggerRunButton slug={slug!} onTriggered={handleTriggered} />
          </div>
        )}
        {!canTrigger && event.is_organizer && event.status !== 'MATCHING' && (
          <p className="text-xs text-moss/70">
            {t('matching.advanceHint')}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-6 items-start">
        {/* Run list sidebar */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-moss uppercase tracking-wide mb-1">
            {t('matching.runsHeading')} {runsData && `(${runsData.count})`}
          </p>

          {runsLoading && (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 rounded-2xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          )}

          {!runsLoading && runs.length === 0 && (
            <div className="rounded-2xl border border-dashed border-ink/15 p-4 text-center">
              <p className="text-xs text-moss/70">{t('matching.noRunsYet')}</p>
              {canTrigger && (
                <p className="text-xs text-moss/70 mt-1">
                  {t('matching.noRunsHint')}
                </p>
              )}
            </div>
          )}

          {runs.map((run) => (
            <RunListItem
              key={run.id}
              run={run}
              selected={run.id === activeRunId}
              onSelect={() => setSelectedRunId(run.id)}
            />
          ))}
        </div>

        {/* Run detail pane */}
        <div>
          {activeRunId == null ? (
            <div className="rounded-xl border border-dashed border-ink/15 p-8 text-center">
              <p className="text-sm text-moss/70">{t('matching.selectRunPrompt')}</p>
            </div>
          ) : activeRun ? (
            <RunResultView key={activeRun.id} slug={slug!} run={activeRun} eventStatus={event.status} isOrganizer={!!event.is_organizer} moneyEnabled={!!event.money_enabled} />
          ) : (
            <div className="space-y-3 animate-pulse">
              <div className="h-8 w-1/3 bg-gray-100 rounded" />
              <div className="h-32 bg-gray-100 rounded-xl" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
