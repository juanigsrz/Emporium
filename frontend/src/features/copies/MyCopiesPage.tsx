import { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMyCopies, usePatchCopy, useWithdrawCopy, useCreateCopy } from '../../api/copies'
import type { Copy, CopyCondition } from '../../api/copies'
import { useGamesList } from '../../api/games'
import { CONDITION_LABELS } from './constants'
import { useMyRatings, useSetRating, ratingMap } from '../../api/ratings'

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

const SLEEVED_LABELS: Record<string, string> = {
  UNKNOWN: 'Unknown',
  NONE: 'Not sleeved',
  SLEEVED: 'Sleeved',
}

// ---- Zod schema ----

const CONDITION_VALUES = ['NEW', 'LIKE_NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'POOR'] as const
const SLEEVED_VALUES = ['UNKNOWN', 'NONE', 'SLEEVED'] as const

const editSchema = z.object({
  condition: z.enum(CONDITION_VALUES, { error: 'Condition is required' }),
  language: z.string().max(64).optional(),
  edition: z.string().max(120).optional(),
  sleeved: z.enum(SLEEVED_VALUES).optional(),
  includes_expansions: z.string().optional(),
  missing_components: z.string().optional(),
  upgraded_components: z.string().optional(),
  component_notes: z.string().optional(),
  owner_notes: z.string().optional(),
  trade_value_hint: z.string().max(120).optional(),
  shipping_constraints: z.string().optional(),
  pickup_available: z.boolean().optional(),
  photo_urls: z
    .array(z.object({ url: z.string().url('Must be a valid URL').or(z.literal('')) }))
    .optional(),
})

type EditFormValues = z.infer<typeof editSchema>

// ---- Edit modal ----

interface EditCopyModalProps {
  copy: Copy
  onClose: () => void
}

function EditCopyModal({ copy, onClose }: EditCopyModalProps) {
  const patchCopy = usePatchCopy()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      condition: copy.condition,
      language: copy.language ?? '',
      edition: copy.edition ?? '',
      sleeved: copy.sleeved ?? 'UNKNOWN',
      includes_expansions: copy.includes_expansions ?? '',
      missing_components: copy.missing_components ?? '',
      upgraded_components: copy.upgraded_components ?? '',
      component_notes: copy.component_notes ?? '',
      owner_notes: copy.owner_notes ?? '',
      trade_value_hint: copy.trade_value_hint ?? '',
      shipping_constraints: copy.shipping_constraints ?? '',
      pickup_available: copy.pickup_available ?? false,
      photo_urls: (copy.photo_urls ?? []).map((url) => ({ url })),
    },
  })

  const { fields: photoFields, append: appendPhoto, remove: removePhoto } = useFieldArray({
    control,
    name: 'photo_urls',
  })

  async function onSubmit(values: EditFormValues) {
    setServerError(null)
    try {
      await patchCopy.mutateAsync({
        id: copy.id,
        payload: {
          condition: values.condition,
          language: values.language || undefined,
          edition: values.edition || undefined,
          sleeved: values.sleeved,
          includes_expansions: values.includes_expansions || undefined,
          missing_components: values.missing_components || undefined,
          upgraded_components: values.upgraded_components || undefined,
          component_notes: values.component_notes || undefined,
          owner_notes: values.owner_notes || undefined,
          trade_value_hint: values.trade_value_hint || undefined,
          shipping_constraints: values.shipping_constraints || undefined,
          pickup_available: values.pickup_available,
          photo_urls: values.photo_urls
            ?.filter((p) => p.url.trim() !== '')
            .map((p) => p.url.trim()),
        },
      })
      onClose()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const resp = (err as { response?: { data?: unknown } }).response
        const data = resp?.data
        if (data && typeof data === 'object') {
          const first = Object.values(data as Record<string, string[]>)[0]
          setServerError(Array.isArray(first) ? first[0] : String(first))
        } else {
          setServerError('Failed to save. Please try again.')
        }
      } else {
        setServerError('Network error. Please try again.')
      }
    }
  }

  const inputCls = (hasErr: boolean) =>
    `w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
      hasErr ? 'border-red-400' : 'border-gray-300'
    }`

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit copy"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-xl shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Edit copy</h2>
            <p className="text-xs text-gray-400 mt-0.5 font-mono">#{copy.listing_code}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {serverError && (
            <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {serverError}
            </div>
          )}

          <form id="edit-copy-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {/* Condition */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Condition <span className="text-red-500">*</span>
              </label>
              <select {...register('condition')} className={inputCls(!!errors.condition)}>
                <option value="">Select condition…</option>
                {Object.entries(CONDITION_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              {errors.condition && (
                <p className="mt-1 text-xs text-red-600">{errors.condition.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
                <input {...register('language')} placeholder="e.g. English" className={inputCls(false)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Edition</label>
                <input {...register('edition')} placeholder="e.g. 2nd Ed." className={inputCls(false)} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sleeved</label>
              <select {...register('sleeved')} className={inputCls(false)}>
                {Object.entries(SLEEVED_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Includes expansions</label>
              <input {...register('includes_expansions')} placeholder="e.g. Stonemaier Expansions" className={inputCls(false)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Missing components</label>
                <input {...register('missing_components')} placeholder="None" className={inputCls(false)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Upgraded components</label>
                <input {...register('upgraded_components')} placeholder="None" className={inputCls(false)} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Component notes</label>
              <textarea {...register('component_notes')} rows={2} className={`${inputCls(false)} resize-none`} />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner notes</label>
              <textarea {...register('owner_notes')} rows={2} className={`${inputCls(false)} resize-none`} />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Trade value hint</label>
              <input {...register('trade_value_hint')} placeholder="e.g. ~$40 retail" className={inputCls(!!errors.trade_value_hint)} />
              {errors.trade_value_hint && (
                <p className="mt-1 text-xs text-red-600">{errors.trade_value_hint.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Shipping constraints</label>
              <input {...register('shipping_constraints')} placeholder="e.g. Domestic only" className={inputCls(false)} />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="edit_pickup_available"
                type="checkbox"
                {...register('pickup_available')}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="edit_pickup_available" className="text-sm font-medium text-gray-700">
                Pickup available
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Photo URLs</label>
              <div className="space-y-2">
                {photoFields.map((field, idx) => (
                  <div key={field.id} className="flex gap-2">
                    <input
                      {...register(`photo_urls.${idx}.url`)}
                      placeholder="https://…"
                      className={`flex-1 ${inputCls(!!errors.photo_urls?.[idx]?.url)}`}
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(idx)}
                      className="shrink-0 text-gray-400 hover:text-red-500 p-1"
                      aria-label="Remove URL"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => appendPhoto({ url: '' })}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  + Add photo URL
                </button>
              </div>
            </div>
          </form>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="edit-copy-form"
            disabled={isSubmitting}
            className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-60 transition-colors"
          >
            {isSubmitting ? 'Saving…' : 'Save changes'}
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} aria-hidden="true" />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-2">Withdraw copy?</h2>
        <p className="text-sm text-gray-500 mb-1">
          This will mark copy <span className="font-mono font-medium">#{copy.listing_code}</span> as withdrawn.
        </p>
        <p className="text-xs text-gray-400 mb-5">
          The copy will no longer appear in game listings. You can still see it here.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60 transition-colors"
          >
            {isPending ? 'Withdrawing…' : 'Withdraw'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Inline rating widget ----

function RatingInput({ bggId, currentRating }: { bggId: number; currentRating?: number }) {
  const setRating = useSetRating()
  const [draft, setDraft] = useState<string>(currentRating != null ? String(currentRating) : '')

  function handleBlur() {
    const v = parseFloat(draft)
    if (!isNaN(v) && v >= 1 && v <= 10) {
      setRating.mutate({ board_game: bggId, value: v })
    }
  }

  return (
    <label className="flex items-center gap-1 text-xs text-gray-400">
      My rating:
      <input
        type="number"
        min={1}
        max={10}
        step={0.5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        placeholder="—"
        className="w-14 rounded border border-gray-200 px-1.5 py-0.5 text-xs focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
        aria-label="My rating (1–10)"
      />
      {setRating.isPending && <span className="text-indigo-400">…</span>}
    </label>
  )
}

// ---- Copy management card ----

function MyCopyCard({ copy, rmap }: { copy: Copy; rmap: Map<number, number> }) {
  const [editOpen, setEditOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const withdrawCopy = useWithdrawCopy()

  const conditionClass = CONDITION_COLOR[copy.condition] ?? 'bg-gray-50 text-gray-700 border-gray-200'
  const statusClass = STATUS_COLOR[copy.status] ?? 'bg-gray-100 text-gray-400 border-gray-200'
  const isWithdrawn = copy.status === 'WITHDRAWN'

  async function handleWithdraw() {
    await withdrawCopy.mutateAsync(copy.id)
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

      <div className={`p-4 border-b border-gray-100 last:border-0 ${isWithdrawn ? 'opacity-60' : ''}`}>
        {/* Top: listing code + status + game link */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="font-mono text-xs text-gray-400 border border-gray-100 rounded px-1.5 py-0.5">
            #{copy.listing_code}
          </span>
          <span className={`text-xs border rounded px-1.5 py-0.5 font-medium ${statusClass}`}>
            {copy.status.charAt(0) + copy.status.slice(1).toLowerCase()}
          </span>
          <span className="ml-auto max-w-[60%] truncate text-sm font-semibold text-gray-800">
            {copy.board_game_name}
          </span>
        </div>

        {/* Condition + language + edition */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span className={`text-xs border rounded px-1.5 py-0.5 font-medium ${conditionClass}`}>
            {CONDITION_LABELS[copy.condition] ?? copy.condition}
          </span>
          {copy.language && (
            <span className="text-xs border border-gray-200 rounded px-1.5 py-0.5 text-gray-600">
              {copy.language}
            </span>
          )}
          {copy.edition && (
            <span className="text-xs border border-gray-100 rounded px-1.5 py-0.5 text-gray-400">
              {copy.edition}
            </span>
          )}
          {copy.pickup_available && (
            <span className="text-xs border border-green-200 rounded px-1.5 py-0.5 text-green-600 bg-green-50">
              Pickup
            </span>
          )}
        </div>

        {/* Notes */}
        {copy.owner_notes && (
          <p className="text-xs text-gray-500 line-clamp-2 mb-2">{copy.owner_notes}</p>
        )}

        {/* Actions + rating */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {!isWithdrawn && (
            <>
              <button
                onClick={() => setEditOpen(true)}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => setWithdrawOpen(true)}
                className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                Withdraw
              </button>
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
    <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="p-4 animate-pulse space-y-2">
          <div className="flex gap-2">
            <div className="h-5 w-20 bg-gray-100 rounded" />
            <div className="h-5 w-14 bg-gray-100 rounded" />
          </div>
          <div className="flex gap-1.5">
            <div className="h-4 w-16 bg-gray-100 rounded" />
            <div className="h-4 w-12 bg-gray-100 rounded" />
          </div>
          <div className="h-3 w-2/3 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  )
}

// ---- Status filter ----

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'RESERVED', label: 'Reserved' },
  { value: 'TRADED', label: 'Traded' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
]

// ---- Add copy panel ----

const ADD_CONDITION_OPTIONS: CopyCondition[] = ['NEW', 'LIKE_NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'POOR']

function AddCopyPanel({ onDone }: { onDone: () => void }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<{ bgg_id: number; name: string } | null>(null)
  const [condition, setCondition] = useState<CopyCondition>('GOOD')
  const [language, setLanguage] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Global catalog typeahead: you can own ANY game (offering), so this is the
  // one place the full catalog is still searched — want-lists stay event-scoped.
  const { data } = useGamesList({ search: q.trim(), ordering: 'rank' })
  const results = q.trim().length >= 2 && !picked ? (data?.results ?? []).slice(0, 8) : []
  const create = useCreateCopy()

  const submit = () => {
    if (!picked) {
      setError('Pick a game first.')
      return
    }
    setError(null)
    create.mutate(
      { board_game: picked.bgg_id, condition, language: language.trim() || undefined },
      {
        onSuccess: () => {
          setPicked(null)
          setQ('')
          setLanguage('')
        },
        onError: () => setError('Could not add the copy. Please try again.'),
      }
    )
  }

  return (
    <div className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">Add a copy you own</h2>
        <button onClick={onDone} className="text-xs text-gray-400 hover:text-gray-600">
          Close
        </button>
      </div>

      {picked ? (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-indigo-200 bg-white px-3 py-2">
          <span className="text-sm font-medium text-gray-800">{picked.name}</span>
          <button
            onClick={() => setPicked(null)}
            className="ml-auto text-xs text-indigo-500 hover:underline"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="relative mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the catalog for a game you own…"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          />
          {results.length > 0 && (
            <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
              {results.map((g) => (
                <li key={g.bgg_id}>
                  <button
                    type="button"
                    onClick={() => setPicked({ bgg_id: g.bgg_id, name: g.name })}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50"
                  >
                    <span className="truncate text-gray-800">{g.name}</span>
                    <span className="shrink-0 text-xs text-gray-400">{g.year_published ?? ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">
          Condition
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value as CopyCondition)}
            className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-200"
          >
            {ADD_CONDITION_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c] ?? c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Language (optional)
          <input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder="e.g. English"
            className="mt-1 block rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-200"
          />
        </label>
        <button
          onClick={submit}
          disabled={create.isPending || !picked}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {create.isPending ? 'Adding…' : 'Add copy'}
        </button>
      </div>

      {create.isSuccess && !picked && (
        <p className="mt-2 text-xs text-green-600">Copy added. Add another or close.</p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ---- Main page ----

export default function MyCopiesPage() {
  const [statusFilter, setStatusFilter] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const { data, isLoading, isError } = useMyCopies()
  const { data: ratingsData = [] } = useMyRatings()
  const rmap = ratingMap(ratingsData)

  const copies = (data?.results ?? []) as Copy[]
  const filtered = statusFilter
    ? copies.filter((c) => c.status === statusFilter)
    : copies

  const activeCopies = copies.filter((c) => c.status === 'ACTIVE').length

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">My Copies</h1>
          {!isLoading && !isError && (
            <p className="text-sm text-gray-400 mt-1">
              {activeCopies} active{copies.length !== activeCopies ? ` · ${copies.length} total` : ''}
            </p>
          )}
        </div>
        <button
          onClick={() => setAddOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors shadow-sm self-start"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add a copy
        </button>
      </div>

      {addOpen && <AddCopyPanel onDone={() => setAddOpen(false)} />}

      {/* Filter */}
      {!isLoading && copies.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="py-1.5 pl-2.5 pr-7 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {statusFilter && (
            <button
              onClick={() => setStatusFilter('')}
              className="text-xs text-indigo-600 hover:underline px-1"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-600">
          Could not load your copies. Please try again.
        </div>
      ) : isLoading ? (
        <CopiesSkeleton />
      ) : copies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 px-6 py-12 text-center">
          <svg className="mx-auto w-12 h-12 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="text-sm font-medium text-gray-500">No copies yet</p>
          <p className="text-xs text-gray-400 mt-1">
            Add the board games you own so you can list them in trade events.
          </p>
          <button
            onClick={() => setAddOpen(true)}
            className="mt-4 inline-block text-sm text-indigo-600 hover:underline font-medium"
          >
            Add a copy
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 px-6 py-10 text-center">
          <p className="text-sm text-gray-500">No copies with status "{statusFilter.toLowerCase()}".</p>
          <button
            onClick={() => setStatusFilter('')}
            className="mt-2 text-xs text-indigo-600 hover:underline"
          >
            Clear filter
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          {filtered.map((copy) => (
            <MyCopyCard key={copy.id} copy={copy} rmap={rmap} />
          ))}
        </div>
      )}
    </div>
  )
}
