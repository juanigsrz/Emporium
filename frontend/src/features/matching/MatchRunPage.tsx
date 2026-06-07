import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useEvent } from '../../api/events'
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
import type { MatchRunListItem, MatchRunDetail, Cycle, TradeAssignment } from '../../api/matching'

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

function extractErrorMsg(err: unknown): string {
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
  return 'An unexpected error occurred.'
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
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_PILL[status]}`}
    >
      {status === 'RUNNING' && (
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-violet-500 animate-pulse" />
      )}
      {status}
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
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
        selected
          ? 'border-indigo-300 bg-indigo-50'
          : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-400">#{run.id}</span>
          <StatusPill status={run.status} />
          <span className="text-xs text-gray-400">{run.algorithm}</span>
        </div>
        <span className="text-xs text-gray-400">{formatDate(run.created)}</span>
      </div>
      {run.summary && run.status === 'DONE' && (
        <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
          <span>{run.summary.cycles} cycle{run.summary.cycles !== 1 ? 's' : ''}</span>
          <span>{run.summary.matched_wishes} matched</span>
          <span>{run.summary.unmatched} unmatched</span>
        </div>
      )}
    </button>
  )
}

// ---- Trigger button (organizer only, MATCHING state only) ----

function TriggerRunButton({ slug, onTriggered }: { slug: string; onTriggered: (id: number) => void }) {
  const trigger = useTriggerMatchRun()
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setError(null)
    try {
      const run = await trigger.mutateAsync(slug)
      onTriggered(run.id)
    } catch (err) {
      setError(extractErrorMsg(err))
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={trigger.isPending}
        className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60 transition-colors shadow-sm"
      >
        {trigger.isPending ? 'Triggering…' : 'Run matching'}
      </button>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ---- X-to-Y solve panel (organizer, MATCHING) — export wants + upload solution ----

function XToYSolvePanel({ slug, onUploaded }: { slug: string; onUploaded: (id: number) => void }) {
  const upload = useUploadSolution()
  const [output, setOutput] = useState('')
  const [open, setOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDownload() {
    setError(null)
    setDownloading(true)
    try {
      const text = await fetchWantsExport(slug)
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}-wants.txt`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(extractErrorMsg(err))
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
      setError('Paste or load the solver output first.')
      return
    }
    try {
      const run = await upload.mutateAsync({ slug, output })
      onUploaded(run.id)
      setOutput('')
      setOpen(false)
    } catch (err) {
      setError(extractErrorMsg(err))
    }
  }

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-2 w-full sm:w-80">
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="w-full rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60 transition-colors shadow-sm"
      >
        {downloading ? 'Preparing…' : 'Download wants.txt'}
      </button>
      <p className="text-xs text-violet-600">
        Run the solver locally (Gurobi), then upload its output.
      </p>
      {open ? (
        <div className="space-y-2">
          <textarea
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            placeholder="Paste solver output…"
            rows={4}
            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <input
            type="file"
            accept=".txt,text/plain"
            onChange={handleFile}
            className="block w-full text-xs text-gray-500 file:mr-2 file:rounded file:border-0 file:bg-violet-100 file:px-2 file:py-1 file:text-violet-700"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setOpen(false); setError(null) }}
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={upload.isPending}
              className="flex-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-60 transition-colors"
            >
              {upload.isPending ? 'Uploading…' : 'Upload solution'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-md border border-violet-300 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 transition-colors"
        >
          Upload solution…
        </button>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ---- Live run status / log view ----

function LiveRunView({ slug, runId }: { slug: string; runId: number }) {
  const { data: run } = useMatchRun(slug, runId)

  if (!run) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-1/3 mb-3" />
        <div className="h-24 bg-gray-100 rounded" />
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold text-gray-800">Run #{run.id}</span>
        <StatusPill status={run.status} />
        {run.status === 'PENDING' || run.status === 'RUNNING' ? (
          <span className="text-xs text-gray-400 animate-pulse">Polling every 2s…</span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-gray-500">
        <div>
          <p className="font-medium text-gray-700 mb-0.5">Algorithm</p>
          <p>{run.algorithm}</p>
        </div>
        <div>
          <p className="font-medium text-gray-700 mb-0.5">Started</p>
          <p>{formatDate(run.started_at)}</p>
        </div>
        <div>
          <p className="font-medium text-gray-700 mb-0.5">Finished</p>
          <p>{formatDate(run.finished_at)}</p>
        </div>
        {run.summary && (
          <div>
            <p className="font-medium text-gray-700 mb-0.5">Summary</p>
            <p>{run.summary.cycles} cycles · {run.summary.matched_wishes} matched</p>
          </div>
        )}
      </div>

      {run.log && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Log</p>
          <pre className="rounded-md bg-gray-950 text-gray-200 text-xs p-3 overflow-x-auto whitespace-pre-wrap max-h-56 font-mono leading-relaxed">
            {run.log}
          </pre>
        </div>
      )}

      {run.status === 'FAILED' && (
        <p className="text-sm text-red-600 font-medium">
          This run failed. Check the log above for details.
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
  const giveList = assignments.filter((a) => a.giver_username === currentUsername)
  const receiveList = assignments.filter((a) => a.receiver_username === currentUsername)

  return (
    <div className="space-y-6">
      {/* Giving group */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
          Giving ({giveList.length})
        </p>
        {giveList.length === 0 ? (
          <p className="text-sm text-gray-400">You are not giving anything in this run.</p>
        ) : (
          giveList.map((a) => (
            <div
              key={a.id}
              className="rounded-lg border border-gray-200 bg-white p-4 flex items-start gap-3"
            >
              <div className="shrink-0 w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-0.5">You give</p>
                <p className="text-sm font-medium text-gray-900 truncate">{a.board_game_name}</p>
                <p className="text-xs text-gray-400 font-mono">{a.listing_code}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  to{' '}
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
          Receiving ({receiveList.length})
        </p>
        {receiveList.length === 0 ? (
          <p className="text-sm text-gray-400">You are not receiving anything in this run.</p>
        ) : (
          receiveList.map((a) => (
            <div
              key={a.id}
              className="rounded-lg border border-gray-200 bg-white p-4 flex items-start gap-3"
            >
              <div className="shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-0.5">You receive</p>
                <p className="text-sm font-medium text-gray-900 truncate">{a.board_game_name}</p>
                <p className="text-xs text-gray-400 font-mono">{a.listing_code}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  from{' '}
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
    </div>
  )
}

// ---- Cycle visualization ----

/**
 * Renders a single trade cycle as an SVG ring diagram.
 * Nodes = users, directed arrows = listing moving from_user -> to_user.
 * On narrow screens (<= 480px effective width), falls back to a stacked list.
 */
function CycleDiagram({ cycle }: { cycle: Cycle }) {
  const n = cycle.steps.length
  if (n === 0) return null

  // Stacked (mobile) fallback rendered for all sizes < a threshold;
  // SVG ring for wider. We use a CSS media-query via className and render both,
  // toggling visibility, so no JS window.innerWidth needed.

  const nodes = cycle.steps.map((s) => s.from_user)
  const radius = Math.max(70, Math.min(120, 30 * n))
  const cx = radius + 40
  const cy = radius + 40
  const svgSize = (radius + 40) * 2

  // Compute positions on a circle
  const positions = nodes.map((_, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    }
  })

  const nodeR = 22

  return (
    <div>
      {/* SVG diagram — hidden on very narrow screens */}
      <div className="hidden xs:block overflow-x-auto">
        <svg
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          className="mx-auto"
          aria-label={`Trade cycle with ${n} steps`}
        >
          <defs>
            <marker
              id={`arrow-${cycle.id}`}
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L8,3 z" className="fill-indigo-400" />
            </marker>
          </defs>

          {/* Edges */}
          {cycle.steps.map((step, i) => {
            const from = positions[i]
            const to = positions[(i + 1) % n]
            // Shorten line so it doesn't overlap node circles
            const dx = to.x - from.x
            const dy = to.y - from.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            const ux = dx / dist
            const uy = dy / dist
            const x1 = from.x + ux * nodeR
            const y1 = from.y + uy * nodeR
            const x2 = to.x - ux * (nodeR + 8)
            const y2 = to.y - uy * (nodeR + 8)
            // Label midpoint
            const mx = (x1 + x2) / 2
            const my = (y1 + y2) / 2

            return (
              <g key={i}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  className="stroke-indigo-400"
                  strokeWidth={1.5}
                  markerEnd={`url(#arrow-${cycle.id})`}
                />
                {/* Game label on edge */}
                <text
                  x={mx}
                  y={my - 6}
                  textAnchor="middle"
                  className="fill-gray-600"
                  fontSize={9}
                  fontFamily="ui-monospace, monospace"
                >
                  {step.board_game.length > 14
                    ? step.board_game.slice(0, 13) + '…'
                    : step.board_game}
                </text>
                <text
                  x={mx}
                  y={my + 6}
                  textAnchor="middle"
                  className="fill-gray-400"
                  fontSize={8}
                  fontFamily="ui-monospace, monospace"
                >
                  {step.listing_code}
                </text>
              </g>
            )
          })}

          {/* Nodes */}
          {nodes.map((username, i) => {
            const pos = positions[i]
            const short = username.length > 8 ? username.slice(0, 7) + '…' : username
            return (
              <g key={i}>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={nodeR}
                  className="fill-indigo-600"
                />
                <text
                  x={pos.x}
                  y={pos.y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-white"
                  fontSize={9}
                  fontWeight="600"
                  fontFamily="ui-sans-serif, sans-serif"
                >
                  {short}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Stacked list — shown on xs screens, hidden on wider (overrides above) */}
      <div className="xs:hidden space-y-2">
        {cycle.steps.map((step, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs flex items-center justify-center font-bold">
              {i + 1}
            </span>
            <div className="min-w-0">
              <span className="font-medium text-gray-800">{step.from_user}</span>
              <span className="text-gray-400 mx-1">gives</span>
              <span className="text-indigo-700 font-medium">{step.board_game}</span>
              <span className="text-gray-400 text-xs ml-1 font-mono">({step.listing_code})</span>
              <span className="text-gray-400 mx-1">to</span>
              <span className="font-medium text-gray-800">{step.to_user}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Always show step list as supplementary detail */}
      <div className="mt-4 space-y-1">
        {cycle.steps.map((step, i) => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-1 text-xs text-gray-600 border-b border-gray-50 last:border-0 py-1"
          >
            <span className="font-semibold text-gray-800">{step.from_user}</span>
            <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
            <span className="font-mono text-indigo-700">{step.listing_code}</span>
            <span className="text-gray-500">"{step.board_game}"</span>
            <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
            <span className="font-semibold text-gray-800">{step.to_user}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CyclesSection({ cycles }: { cycles: Cycle[] }) {
  if (cycles.length === 0) {
    return <p className="text-sm text-gray-400">No cycles in this run.</p>
  }

  return (
    <div className="space-y-4">
      {cycles.map((cycle) => (
        <div
          key={cycle.id}
          className="rounded-xl border border-indigo-100 bg-white p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-semibold text-gray-800">Cycle #{cycle.id}</span>
            <span className="rounded-full bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 font-medium">
              {cycle.length} step{cycle.length !== 1 ? 's' : ''}
            </span>
          </div>
          <CycleDiagram cycle={cycle} />
        </div>
      ))}
    </div>
  )
}

// ---- Stats section ----

function StatsSection({ result }: { result: import('../../api/matching').MatchResult }) {
  const stats = result.stats
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {(
        [
          ['Users', stats.users],
          ['Listings', stats.listings],
          ['Matched', stats.matched],
          ['Cycles', stats.cycles],
        ] as [string, number][]
      ).map(([label, val]) => (
        <div
          key={label}
          className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm"
        >
          <p className="text-2xl font-bold text-indigo-600">{val}</p>
          <p className="text-xs text-gray-500 mt-1">{label}</p>
        </div>
      ))}
    </div>
  )
}

// ---- Unmatched section ----

function UnmatchedSection({ unmatched }: { unmatched: import('../../api/matching').UnmatchedWish[] }) {
  if (unmatched.length === 0) return null

  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">
        Unmatched wishes ({unmatched.length})
      </p>
      <div className="space-y-1.5">
        {unmatched.map((u) => (
          <div key={u.wish_id} className="flex items-start gap-2 text-xs">
            <span className="text-amber-600 font-mono shrink-0">Wish #{u.wish_id}</span>
            <span className="text-amber-700">{u.reason}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Run result view ----

function RunResultView({ slug, run }: { slug: string; run: MatchRunDetail }) {
  const isDone = run.status === 'DONE'
  const { data: result, isLoading: resultLoading, isError: resultError } = useMatchResult(slug, run.id, isDone)
  const { data: mineData, isLoading: mineLoading } = useMyAssignments(slug, run.id, isDone)
  const { user } = useAuthStore()
  const currentUsername = user?.username ?? ''

  const [activeTab, setActiveTab] = useState<'my-trades' | 'cycles' | 'stats'>('my-trades')

  if (!isDone) {
    return <LiveRunView slug={slug} runId={run.id} />
  }

  const tabs = [
    { id: 'my-trades' as const, label: 'My Trades' },
    { id: 'cycles' as const, label: 'All Cycles' },
    { id: 'stats' as const, label: 'Stats & Unmatched' },
  ]

  return (
    <div className="space-y-4">
      <LiveRunView slug={slug} runId={run.id} />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
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
                  <div key={i} className="h-20 rounded-lg bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <MyTradesSection assignments={mineData?.results ?? []} currentUsername={currentUsername} />
            )}
          </div>
        )}

        {activeTab === 'cycles' && (
          <div>
            {resultLoading && (
              <div className="space-y-4">
                {[1, 2].map((i) => (
                  <div key={i} className="h-40 rounded-xl bg-gray-100 animate-pulse" />
                ))}
              </div>
            )}
            {resultError && (
              <p className="text-sm text-red-600">
                Failed to load result data. The run may still be processing.
              </p>
            )}
            {result && <CyclesSection cycles={result.cycles} />}
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="space-y-4">
            {resultLoading && (
              <div className="h-24 rounded-xl bg-gray-100 animate-pulse" />
            )}
            {resultError && (
              <p className="text-sm text-red-600">Failed to load stats.</p>
            )}
            {result && (
              <>
                <StatsSection result={result} />
                <UnmatchedSection unmatched={result.unmatched} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Main page ----

export default function MatchRunPage() {
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
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-4 animate-pulse">
        <div className="h-8 w-1/3 bg-gray-100 rounded" />
        <div className="h-24 bg-gray-100 rounded-xl" />
        <div className="h-48 bg-gray-100 rounded-xl" />
      </div>
    )
  }

  if (!event) {
    return (
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-8 text-center">
          <p className="text-sm text-red-700">Event not found.</p>
          <Link to="/events" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
            Back to events
          </Link>
        </div>
      </div>
    )
  }

  if (!showMatchingSection) {
    return (
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-10 text-center">
          <p className="text-sm text-gray-600">
            Matching is not yet available for this event.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            The event must be in MATCHING state or later.
          </p>
          <Link
            to={`/events/${slug}`}
            className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
          >
            Back to event
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link to="/events" className="hover:text-indigo-600 transition-colors">Events</Link>
        <span>/</span>
        <Link to={`/events/${slug}`} className="hover:text-indigo-600 transition-colors truncate max-w-xs">
          {event.name}
        </Link>
        <span>/</span>
        <span className="text-gray-600">Matching</span>
      </div>

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Matching</h1>
          <p className="text-sm text-gray-500 mt-0.5">{event.name}</p>
        </div>
        {canTrigger && token && (
          event.matching_mode === 'XTOY' ? (
            <XToYSolvePanel slug={slug!} onUploaded={handleTriggered} />
          ) : (
            <TriggerRunButton slug={slug!} onTriggered={handleTriggered} />
          )
        )}
        {!canTrigger && event.is_organizer && event.status !== 'MATCHING' && (
          <p className="text-xs text-gray-400">
            Advance event to MATCHING state to run the matcher.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-6 items-start">
        {/* Run list sidebar */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Runs {runsData && `(${runsData.count})`}
          </p>

          {runsLoading && (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 rounded-lg bg-gray-100 animate-pulse" />
              ))}
            </div>
          )}

          {!runsLoading && runs.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center">
              <p className="text-xs text-gray-400">No runs yet.</p>
              {canTrigger && (
                <p className="text-xs text-gray-400 mt-1">
                  Use the action above to create the first run.
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
            <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-400">Select a run to view details.</p>
            </div>
          ) : activeRun ? (
            <RunResultView slug={slug!} run={activeRun} />
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
