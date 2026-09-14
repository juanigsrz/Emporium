import { useState, useMemo, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useModalDismiss } from '../../hooks/useModalDismiss'
import { toast } from '../../store/toast'
import type { TFunction } from 'i18next'
import { useMyCopies, usePatchCopy, useWithdrawCopy, useCreateCopy, COPIES_KEYS } from '../../api/copies'
import type { Copy } from '../../api/copies'
import { useGamesList } from '../../api/games'
import { CopyForm } from './CopyForm'
import type { CopySubmitPayload } from './CopyForm'
import { GameThumb } from '../../components/GameThumb'
import { useMyRatings, useSetRating, ratingMap } from '../../api/ratings'
import { useStartImport, useImportJob } from '../../api/bgg'
import { useMyProfile } from '../../api/profiles'

// ---- Constants ----

const CONDITION_COLOR: Record<string, string> = {
  NEW: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  LIKE_NEW: 'bg-lime-50 text-lime-700 border-lime-200',
  EXCELLENT: 'bg-sky-50 text-sky-700 border-sky-200',
  GOOD: 'bg-blue-50 text-blue-700 border-blue-200',
  FAIR: 'bg-amber-50 text-amber-700 border-amber-200',
  POOR: 'bg-red-50 text-red-700 border-red-200',
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700 border-green-200',
  RESERVED: 'bg-amber-50 text-amber-700 border-amber-200',
  TRADED: 'bg-blue-50 text-blue-700 border-blue-200',
  WITHDRAWN: 'bg-gray-100 text-gray-400 border-gray-200',
}

// ---- Server error parsing ----

function extractCopyError(err: unknown, t: TFunction): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: unknown } }).response
    const data = resp?.data
    if (data && typeof data === 'object') {
      const first = Object.values(data as Record<string, string[]>)[0]
      return Array.isArray(first) ? first[0] : String(first)
    }
    return t('copies.errors.saveFailed')
  }
  return t('copies.errors.networkError')
}

// ---- Edit modal ----

interface EditCopyModalProps {
  copy: Copy
  onClose: () => void
}

function EditCopyModal({ copy, onClose }: EditCopyModalProps) {
  const { t } = useTranslation()
  const patchCopy = usePatchCopy()
  const [serverError, setServerError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useModalDismiss(panelRef, onClose)

  async function handleSubmit(payload: CopySubmitPayload) {
    setServerError(null)
    try {
      await patchCopy.mutateAsync({ id: copy.id, payload })
      toast.success(t('common.toast.saved'))
      onClose()
    } catch (err: unknown) {
      setServerError(extractCopyError(err, t))
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('copies.editModal.ariaLabel')}
    >
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} tabIndex={-1} className="relative w-full sm:max-w-lg bg-cream border-2 border-ink rounded-t-3xl sm:rounded-3xl shadow-card max-h-[92vh] flex flex-col focus:outline-none">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink/10">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">{t('copies.editModal.title')}</h2>
            <p className="text-xs text-moss mt-0.5 font-mono">#{copy.listing_code}</p>
          </div>
          <button onClick={onClose} className="text-moss hover:text-ink hover:bg-sage/40 p-1.5 rounded-xl transition-colors" aria-label={t('copies.close')}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          <CopyForm
            boardGameId={copy.board_game}
            formId="edit-copy-form"
            initial={{
              condition: copy.condition,
              sleeved: copy.sleeved,
              includes_expansions: copy.includes_expansions,
              missing_components: copy.missing_components,
              upgraded_components: copy.upgraded_components,
              component_notes: copy.component_notes,
              owner_notes: copy.owner_notes,
              trade_value_hint: copy.trade_value_hint,
              shipping_constraints: copy.shipping_constraints,
              pickup_available: copy.pickup_available,
              photo_urls: (copy.photo_urls ?? []).map((url) => ({ url })),
              versionId: copy.version,
              versionName: copy.version_name,
            }}
            onSubmit={handleSubmit}
            serverError={serverError}
          />
        </div>

        <div className="flex gap-3 px-5 py-4 border-t-2 border-ink/10">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border-2 border-ink/15 bg-cream px-4 py-2.5 text-sm font-semibold text-moss hover:bg-sage/30 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="edit-copy-form"
            disabled={patchCopy.isPending}
            className="flex-1 rounded-2xl border-2 border-ink bg-butter px-4 py-2.5 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
          >
            {patchCopy.isPending ? t('copies.saving') : t('copies.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Withdraw confirm dialog ----

interface WithdrawDialogProps {
  copy: Copy
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function WithdrawDialog({ copy, onConfirm, onCancel, isPending }: WithdrawDialogProps) {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  useModalDismiss(panelRef, onCancel)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onCancel} aria-hidden="true" />
      <div ref={panelRef} tabIndex={-1} className="relative bg-cream border-2 border-ink rounded-3xl shadow-card w-full max-w-sm p-6 focus:outline-none">
        <h2 className="font-display text-lg font-bold text-ink mb-2">{t('copies.withdraw.title')}</h2>
        <p className="text-sm text-moss mb-1">
          {t('copies.withdraw.body', { code: copy.listing_code })}
        </p>
        <p className="text-xs text-moss/70 mb-5">
          {t('copies.withdraw.hint')}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-2xl border-2 border-ink/15 bg-cream px-4 py-2.5 text-sm font-semibold text-moss hover:bg-sage/30 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 rounded-2xl border-2 border-ink bg-red-300 px-4 py-2.5 text-sm font-bold text-red-950 shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
          >
            {isPending ? t('copies.withdraw.withdrawing') : t('copies.withdraw.action')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Inline rating widget ----

function RatingInput({ bggId, currentRating }: { bggId: number; currentRating?: number }) {
  const { t } = useTranslation()
  const setRating = useSetRating()
  const [draft, setDraft] = useState<string>(currentRating != null ? String(currentRating) : '')

  function handleBlur() {
    const v = parseFloat(draft)
    if (!isNaN(v) && v >= 1 && v <= 10) {
      setRating.mutate({ board_game: bggId, value: v })
    }
  }

  return (
    <label className="flex items-center gap-1 text-xs text-moss">
      {t('copies.rating.label')}
      <input
        type="number"
        min={1}
        max={10}
        step={0.5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        placeholder="—"
        className="w-14 rounded-lg border-2 border-ink/15 bg-cream px-1.5 py-0.5 text-xs focus:border-ink focus:outline-none focus:ring-2 focus:ring-sage"
        aria-label={t('copies.rating.ariaLabel')}
      />
      {setRating.isPending && <span className="text-moss">…</span>}
    </label>
  )
}

// ---- Copy management card ----

function MyCopyCard({ copy, rmap }: { copy: Copy; rmap: Map<number, number> }) {
  const { t } = useTranslation()
  const [editOpen, setEditOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const withdrawCopy = useWithdrawCopy()

  const conditionClass = CONDITION_COLOR[copy.condition] ?? 'bg-gray-50 text-gray-700 border-gray-200'
  const statusClass = STATUS_COLOR[copy.status] ?? 'bg-gray-100 text-gray-400 border-gray-200'
  const isWithdrawn = copy.status === 'WITHDRAWN'
  const isPendingCopy = copy.is_pending === true
  const lockedInEvent = copy.in_active_event

  const missingFields: string[] = []
  if (!copy.language) missingFields.push(t('copies.pending.language'))
  if (!copy.condition) missingFields.push(t('copies.pending.condition'))

  async function handleWithdraw() {
    await withdrawCopy.mutateAsync(copy.id)
    toast.success(t('common.toast.removed'))
    setWithdrawOpen(false)
  }

  return (
    <>
      {editOpen && <EditCopyModal copy={copy} onClose={() => setEditOpen(false)} />}
      {withdrawOpen && (
        <WithdrawDialog
          copy={copy}
          onConfirm={handleWithdraw}
          onCancel={() => setWithdrawOpen(false)}
          isPending={withdrawCopy.isPending}
        />
      )}

      <div className={`flex flex-col rounded-2xl border-2 border-ink/15 bg-cream p-4 shadow-sm ${isWithdrawn ? 'opacity-60' : ''}`}>
        {/* Pending banner */}
        {isPendingCopy && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <svg className="w-3.5 h-3.5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-xs text-amber-800 font-medium truncate">
                {t('copies.pending.completeDetails', { fields: missingFields.join(', ') })}
              </span>
            </div>
            <button
              onClick={() => setEditOpen(true)}
              className="shrink-0 rounded-lg border-2 border-amber-300 bg-cream px-2.5 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
            >
              {t('copies.pending.complete')}
            </button>
          </div>
        )}

        {/* Header: edition thumbnail + title / edition / code / status */}
        <div className="flex gap-3">
          <GameThumb
            src={copy.version_thumbnail || copy.board_game_thumbnail}
            alt={copy.board_game_name}
            className="h-20 w-20"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold text-ink leading-snug line-clamp-2" title={copy.board_game_name}>
                {copy.board_game_name}
              </h3>
              <span className={`shrink-0 text-xs border rounded-full px-2 py-0.5 font-semibold ${statusClass}`}>
                {t('copies.status.' + copy.status, { defaultValue: copy.status })}
              </span>
            </div>
            {copy.version_name && copy.version_name !== 'Unknown' && (
              <p className="mt-0.5 truncate text-xs text-moss" title={copy.version_name}>
                {copy.version_name}
              </p>
            )}
            <span className="mt-1 inline-block font-mono text-xs text-moss/70">#{copy.listing_code}</span>
          </div>
        </div>

        {/* Condition + language + pickup */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className={`text-xs border rounded-full px-2 py-0.5 font-semibold ${conditionClass}`}>
            {t('copies.condition.' + copy.condition, { defaultValue: copy.condition })}
          </span>
          {copy.language && (
            <span className="text-xs border border-ink/15 rounded-full px-2 py-0.5 text-moss">
              {copy.language}
            </span>
          )}
          {copy.pickup_available && (
            <span className="text-xs border border-green-200 rounded-full px-2 py-0.5 text-green-700 bg-green-50">
              {t('copies.pickup')}
            </span>
          )}
        </div>

        {/* Notes */}
        {copy.owner_notes && (
          <p className="text-xs text-moss line-clamp-2 mb-2">{copy.owner_notes}</p>
        )}

        {/* Actions + rating */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {!isWithdrawn && (
            <>
              {lockedInEvent ? (
                <span
                  title={t('copies.lockedInEventTitle')}
                  className="rounded-xl border-2 border-ink/10 px-3 py-1.5 text-xs font-semibold text-moss/50 cursor-not-allowed select-none"
                  aria-disabled="true"
                >
                  {t('copies.lockedInEvent')}
                </span>
              ) : (
                <>
                  <button
                    onClick={() => setEditOpen(true)}
                    className="rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-xs font-semibold text-moss hover:bg-sage/30 transition-colors"
                  >
                    {t('copies.edit')}
                  </button>
                  <button
                    onClick={() => setWithdrawOpen(true)}
                    className="rounded-xl border-2 border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    {t('copies.withdraw.action')}
                  </button>
                </>
              )}
              {isPendingCopy && (
                <span
                  title={t('copies.addToEventTitle')}
                  className="rounded-xl border-2 border-ink/10 px-3 py-1.5 text-xs font-semibold text-moss/50 cursor-not-allowed select-none"
                  aria-disabled="true"
                >
                  {t('copies.addToEvent')}
                </span>
              )}
            </>
          )}
          <div className="ml-auto">
            <RatingInput bggId={copy.board_game} currentRating={rmap.get(copy.board_game)} />
          </div>
        </div>
      </div>
    </>
  )
}

// ---- Page skeleton ----

function CopiesSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-2xl border-2 border-ink/15 bg-cream p-4 animate-pulse space-y-2">
          <div className="flex gap-2">
            <div className="h-5 w-20 bg-gray-200 rounded-full" />
            <div className="h-5 w-14 bg-gray-200 rounded-full" />
          </div>
          <div className="flex gap-1.5">
            <div className="h-4 w-16 bg-gray-200 rounded-full" />
            <div className="h-4 w-12 bg-gray-200 rounded-full" />
          </div>
          <div className="h-3 w-2/3 bg-gray-200 rounded-full" />
        </div>
      ))}
    </div>
  )
}

// ---- BGG Import panel ----

function BggImportPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: profile } = useMyProfile()
  const startImport = useStartImport()
  const [jobId, setJobId] = useState<number | null>(null)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [geeklistId, setGeeklistId] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<Record<string, number> | null>(null)

  const { data: job } = useImportJob(jobId)
  const isRunning = job != null && (job.status === 'PENDING' || job.status === 'RUNNING')

  useEffect(() => {
    if (job?.status === 'DONE' && importResult == null) {
      setImportResult(job.summary)
      setJobId(null)
      qc.invalidateQueries({ queryKey: COPIES_KEYS.mine() })
    }
  }, [job, importResult, qc])

  const hasBggUsername = !!(profile?.bgg_username)

  async function handleOwnedImport() {
    setImportError(null)
    setImportResult(null)
    try {
      const j = await startImport.mutateAsync({
        kind: 'OWNED',
        options: { skip_duplicates: skipDuplicates },
      })
      setJobId(j.id)
    } catch {
      setImportError(t('copies.import.startFailed'))
    }
  }

  async function handleGeeklistImport() {
    const id = geeklistId.trim()
    if (!id) {
      setImportError(t('copies.import.enterGeeklistId'))
      return
    }
    setImportError(null)
    setImportResult(null)
    try {
      const j = await startImport.mutateAsync({
        kind: 'GEEKLIST',
        source_ref: id,
        options: { skip_duplicates: skipDuplicates },
      })
      setJobId(j.id)
    } catch {
      setImportError(t('copies.import.startFailed'))
    }
  }

  return (
    <div className="mb-4 rounded-3xl border-2 border-ink/15 bg-teal-50/60 p-4">
      <h2 className="font-display text-base font-bold text-ink mb-3">{t('copies.import.title')}</h2>

      {/* Skip duplicates checkbox */}
      <label className="flex items-center gap-2 text-xs font-medium text-moss mb-3">
        <input
          type="checkbox"
          checked={skipDuplicates}
          onChange={(e) => setSkipDuplicates(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-2 border-ink/30 accent-teal-600 focus:ring-teal-400"
        />
        {t('copies.import.skipDuplicates')}
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* From your collection */}
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-ink/10 bg-cream/70 p-3">
          <h3 className="text-xs font-bold text-ink">{t('copies.import.fromCollection')}</h3>
          {!hasBggUsername && (
            <p className="text-xs text-amber-600">
              {t('copies.import.usernamePrefix')}{' '}
              <Link to="/profile" className="font-semibold underline hover:text-amber-800">
                {t('copies.import.usernameLinkText')}
              </Link>{' '}
              {t('copies.import.usernameSuffix')}
            </p>
          )}
          <button
            onClick={handleOwnedImport}
            disabled={!hasBggUsername || isRunning || startImport.isPending}
            title={!hasBggUsername ? t('copies.import.usernameRequiredTitle') : undefined}
            className="self-start rounded-2xl border-2 border-ink bg-teal-300 px-3 py-1.5 text-xs font-bold text-teal-950 shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            {isRunning ? t('copies.import.importing') : t('copies.import.importOwned')}
          </button>
        </div>

        {/* From a geeklist */}
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-ink/10 bg-cream/70 p-3">
          <h3 className="text-xs font-bold text-ink">{t('copies.import.fromGeeklist')}</h3>
          <label className="flex flex-col gap-1 text-xs font-medium text-moss">
            {t('copies.import.geeklistIdLabel')}
            <input
              value={geeklistId}
              onChange={(e) => setGeeklistId(e.target.value)}
              placeholder={t('copies.import.geeklistIdPlaceholder')}
              className="w-full rounded-xl border-2 border-ink/15 bg-parchment px-2 py-1.5 text-sm focus:border-ink focus:outline-none focus:ring-2 focus:ring-teal-300"
            />
          </label>
          <button
            onClick={handleGeeklistImport}
            disabled={isRunning || startImport.isPending}
            className="self-start rounded-2xl border-2 border-ink bg-teal-300 px-3 py-1.5 text-xs font-bold text-teal-950 shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            {isRunning ? t('copies.import.importing') : t('copies.import.importFromGeeklist')}
          </button>
        </div>
      </div>

      {isRunning && (
        <p className="mt-2 text-xs text-teal-600 flex items-center gap-1">
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          {t('copies.import.importing')}
        </p>
      )}
      {importResult != null && (
        <p className="mt-2 text-xs text-teal-700">
          {t('copies.import.resultCreated', { count: importResult.created ?? 0 })}
          {importResult.skipped != null ? t('copies.import.resultSkipped', { count: importResult.skipped }) : ''}
          {importResult.pending != null && importResult.pending > 0
            ? t('copies.import.resultPending', { count: importResult.pending })
            : ''}
          .
        </p>
      )}
      {job?.status === 'FAILED' && (
        <p className="mt-2 text-xs text-red-600">{t('copies.import.failed')}</p>
      )}
      {importError && <p className="mt-2 text-xs text-red-600">{importError}</p>}
    </div>
  )
}

// ---- Add copy modal ----

function AddCopyModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<{ bgg_id: number; name: string; thumbnail: string } | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useModalDismiss(panelRef, onClose)

  // Global catalog typeahead: you can own ANY game (offering), so this is the
  // one place the full catalog is still searched — want-lists stay event-scoped.
  const { data } = useGamesList({ search: q.trim(), ordering: 'rank' })
  const results = q.trim().length >= 2 && !picked ? (data?.results ?? []).slice(0, 8) : []
  const create = useCreateCopy()

  async function handleSubmit(payload: CopySubmitPayload) {
    if (!picked) return
    setServerError(null)
    try {
      await create.mutateAsync({ board_game: picked.bgg_id, ...payload })
      toast.success(t('common.toast.added'))
      onClose()
    } catch (err: unknown) {
      setServerError(extractCopyError(err, t))
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('copies.addCopy')}
    >
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} tabIndex={-1} className="relative w-full sm:max-w-lg bg-cream border-2 border-ink rounded-t-3xl sm:rounded-3xl shadow-card max-h-[92vh] flex flex-col focus:outline-none">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink/10">
          <h2 className="font-display text-lg font-bold text-ink">{t('copies.addCopy')}</h2>
          <button onClick={onClose} className="text-moss hover:text-ink hover:bg-sage/40 p-1.5 rounded-xl transition-colors" aria-label={t('copies.close')}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — only scroll-clip once the CopyForm is shown; while searching,
            keep overflow visible so the results dropdown isn't clipped (#2). */}
        <div className={`flex-1 px-5 py-4 ${picked ? 'overflow-y-auto' : ''}`}>
          {!picked ? (
            <div className="relative">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('copies.addModal.searchPlaceholder')}
                className="w-full rounded-xl border-2 border-ink/15 bg-parchment px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-2 focus:ring-sage"
              />
              {results.length > 0 && (
                <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border-2 border-ink/15 bg-cream shadow-card">
                  {results.map((g) => (
                    <li key={g.bgg_id}>
                      <button
                        type="button"
                        onClick={() => setPicked({ bgg_id: g.bgg_id, name: g.name, thumbnail: g.thumbnail })}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-sage/30"
                      >
                        <GameThumb src={g.thumbnail} alt={g.name} className="h-16 w-16" />
                        <span className="flex-1 truncate text-ink">{g.name}</span>
                        <span className="shrink-0 text-xs text-moss/70">{g.year_published ?? ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-2 rounded-xl border-2 border-ink/15 bg-sage/30 px-3 py-2">
                <GameThumb src={picked.thumbnail} alt={picked.name} className="h-24 w-24" />
                <span className="text-sm font-semibold text-ink">{picked.name}</span>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="ml-auto text-xs font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2"
                >
                  {t('copies.addModal.changeGame')}
                </button>
              </div>
              <CopyForm
                boardGameId={picked.bgg_id}
                formId="add-copy-form"
                onSubmit={handleSubmit}
                serverError={serverError}
              />
            </>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t-2 border-ink/10">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border-2 border-ink/15 bg-cream px-4 py-2.5 text-sm font-semibold text-moss hover:bg-sage/30 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="add-copy-form"
            disabled={create.isPending || !picked}
            className="flex-1 rounded-2xl border-2 border-ink bg-butter px-4 py-2.5 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
          >
            {create.isPending ? t('copies.addModal.adding') : t('copies.addModal.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Main page ----

export default function MyCopiesPage() {
  const { t } = useTranslation()
  usePageTitle(t('common.myCopies'))
  const [statusFilter, setStatusFilter] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const { data, isLoading, isError } = useMyCopies()
  const { data: ratingsData = [] } = useMyRatings()
  const rmap = ratingMap(ratingsData)

  const STATUS_OPTIONS = useMemo(() => [
    { value: '', label: t('copies.statusFilter.all') },
    { value: 'ACTIVE', label: t('copies.status.ACTIVE') },
    { value: 'RESERVED', label: t('copies.status.RESERVED') },
    { value: 'TRADED', label: t('copies.status.TRADED') },
    { value: 'WITHDRAWN', label: t('copies.status.WITHDRAWN') },
  ], [t])

  const copies = data ?? []
  const filtered = statusFilter
    ? copies.filter((c) => c.status === statusFilter)
    : copies

  const activeCopies = copies.filter((c) => c.status === 'ACTIVE').length

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-ink tracking-tight">{t('common.myCopies')}</h1>
          {!isLoading && !isError && (
            <p className="text-sm text-moss mt-1">
              {t('copies.list.activeCount', { count: activeCopies })}
              {copies.length !== activeCopies ? t('copies.list.totalSuffix', { total: copies.length }) : ''}
            </p>
          )}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-2xl border-2 border-ink bg-butter px-5 py-2.5 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 self-start"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t('copies.addCopy')}
        </button>
      </div>

      {addOpen && <AddCopyModal onClose={() => setAddOpen(false)} />}

      <BggImportPanel />

      {/* Filter */}
      {!isLoading && copies.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="py-2 pl-2.5 pr-7 text-xs border-2 border-ink/15 rounded-xl bg-cream font-medium text-ink focus:outline-none focus:ring-2 focus:ring-sage"
            aria-label={t('copies.list.filterByStatusAriaLabel')}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {statusFilter && (
            <button
              onClick={() => setStatusFilter('')}
              className="text-xs font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2 px-1"
            >
              {t('copies.list.clear')}
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {isError ? (
        <div className="rounded-3xl border-2 border-red-200 bg-red-50 px-4 py-8 text-center text-sm font-medium text-red-600">
          {t('copies.list.loadError')}
        </div>
      ) : isLoading ? (
        <CopiesSkeleton />
      ) : copies.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-ink/20 px-6 py-12 text-center">
          <svg className="mx-auto w-12 h-12 text-moss/40 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="text-sm font-bold text-ink">{t('copies.list.emptyTitle')}</p>
          <p className="text-xs text-moss mt-1">
            {t('copies.list.emptyBody')}
          </p>
          <button
            onClick={() => setAddOpen(true)}
            className="mt-4 inline-block text-sm font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2"
          >
            {t('copies.addCopy')}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-ink/20 px-6 py-10 text-center">
          <p className="text-sm text-moss">
            {t('copies.list.noStatusMatch', { status: t('copies.status.' + statusFilter, { defaultValue: statusFilter }).toLowerCase() })}
          </p>
          <button
            onClick={() => setStatusFilter('')}
            className="mt-2 text-xs font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2"
          >
            {t('copies.list.clearFilter')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((copy) => (
            <MyCopyCard key={copy.id} copy={copy} rmap={rmap} />
          ))}
        </div>
      )}
    </div>
  )
}
