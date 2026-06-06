import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useGameDetail, useGameCopies, GAMES_KEYS } from '../../api/games'
import { useCreateCopy } from '../../api/copies'
import type { Copy } from '../../api/copies'
import { useAuthStore } from '../../store/auth'
import { useQueryClient } from '@tanstack/react-query'
import { CONDITION_LABELS } from '../copies/constants'

const CONDITION_COLOR: Record<string, string> = {
  NEW: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  LIKE_NEW: 'bg-lime-50 text-lime-700 border-lime-200',
  EXCELLENT: 'bg-sky-50 text-sky-700 border-sky-200',
  GOOD: 'bg-blue-50 text-blue-700 border-blue-200',
  FAIR: 'bg-amber-50 text-amber-700 border-amber-200',
  POOR: 'bg-red-50 text-red-700 border-red-200',
}

const SLEEVED_LABELS: Record<string, string> = {
  UNKNOWN: 'Unknown',
  NONE: 'Not sleeved',
  SLEEVED: 'Sleeved',
}

const CONDITION_OPTIONS = [
  { value: '', label: 'All conditions' },
  { value: 'NEW', label: 'New' },
  { value: 'LIKE_NEW', label: 'Like New' },
  { value: 'EXCELLENT', label: 'Excellent' },
  { value: 'GOOD', label: 'Good' },
  { value: 'FAIR', label: 'Fair' },
  { value: 'POOR', label: 'Poor' },
]

const LANGUAGE_OPTIONS = [
  { value: '', label: 'All languages' },
  { value: 'English', label: 'English' },
  { value: 'Spanish', label: 'Spanish' },
  { value: 'German', label: 'German' },
  { value: 'French', label: 'French' },
  { value: 'Portuguese', label: 'Portuguese' },
  { value: 'Italian', label: 'Italian' },
]

// ---- Zod schema for Add Copy form ----

const CONDITION_VALUES = ['NEW', 'LIKE_NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'POOR'] as const
const SLEEVED_VALUES = ['UNKNOWN', 'NONE', 'SLEEVED'] as const

const copySchema = z.object({
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
  photo_urls: z.array(z.object({ url: z.string().url('Must be a valid URL').or(z.literal('')) })).optional(),
})

type CopyFormValues = z.infer<typeof copySchema>

// ---- Helpers ----

function Rating({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-400">—</span>
  const color =
    value >= 8
      ? 'text-amber-600'
      : value >= 7
      ? 'text-lime-700'
      : value >= 6
      ? 'text-sky-700'
      : 'text-gray-500'
  return <span className={`font-bold ${color}`}>{value.toFixed(2)}</span>
}

function InfoBadge({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex flex-col items-center px-4 py-3 bg-gray-50 rounded-lg border border-gray-100 text-center min-w-[80px]">
      <span className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-0.5">{label}</span>
      <span className="text-sm font-semibold text-gray-800 tabular-nums">
        {value ?? '—'}
      </span>
    </div>
  )
}

function TagList({ label, items }: { label: string; items: string[] | null }) {
  const hasItems = items && items.length > 0
  return (
    <div>
      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">{label}</dt>
      <dd>
        {hasItems ? (
          <div className="flex flex-wrap gap-1.5">
            {items.map((item) => (
              <span
                key={item}
                className="inline-block rounded bg-indigo-50 border border-indigo-100 text-indigo-700 px-2 py-0.5 text-xs"
              >
                {item}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-sm text-gray-400">—</span>
        )}
      </dd>
    </div>
  )
}

// ---- Copy card component ----

function CopyCard({ copy }: { copy: Copy }) {
  const conditionClass =
    CONDITION_COLOR[copy.condition] ?? 'bg-gray-50 text-gray-700 border-gray-200'
  const conditionLabel = CONDITION_LABELS[copy.condition] ?? copy.condition

  return (
    <div className="p-4 border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors">
      {/* Top row: owner + condition */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="shrink-0 w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 uppercase">
            {copy.owner_username?.charAt(0) ?? '?'}
          </div>
          <Link
            to={`/u/${copy.owner_username}`}
            className="text-sm font-medium text-indigo-600 hover:underline truncate"
            onClick={(e) => e.stopPropagation()}
          >
            {copy.owner_username}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <span className={`text-xs border rounded px-1.5 py-0.5 font-medium ${conditionClass}`}>
            {conditionLabel}
          </span>
          {copy.language && (
            <span className="text-xs border border-gray-200 rounded px-1.5 py-0.5 text-gray-600">
              {copy.language}
            </span>
          )}
          {copy.edition && (
            <span className="text-xs text-gray-400 border border-gray-100 rounded px-1.5 py-0.5">
              {copy.edition}
            </span>
          )}
          {copy.sleeved && copy.sleeved !== 'UNKNOWN' && (
            <span className="text-xs border border-gray-100 rounded px-1.5 py-0.5 text-gray-500">
              {SLEEVED_LABELS[copy.sleeved]}
            </span>
          )}
        </div>
      </div>

      {/* Notes row */}
      {(copy.owner_notes || copy.component_notes || copy.trade_value_hint) && (
        <div className="mt-1.5 space-y-0.5 pl-9">
          {copy.owner_notes && (
            <p className="text-xs text-gray-600 line-clamp-2">{copy.owner_notes}</p>
          )}
          {copy.trade_value_hint && (
            <p className="text-xs text-gray-400">Value hint: {copy.trade_value_hint}</p>
          )}
        </div>
      )}

      {/* Photo strip */}
      {copy.photo_urls && copy.photo_urls.length > 0 && (
        <div className="mt-2 pl-9 flex gap-2 overflow-x-auto">
          {copy.photo_urls.slice(0, 4).map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
              <img
                src={url}
                alt={`Photo ${i + 1}`}
                className="w-14 h-14 object-cover rounded border border-gray-200 shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </a>
          ))}
        </div>
      )}

      {/* Footer: listing code + pickup */}
      <div className="mt-2 pl-9 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-gray-300 border border-gray-100 rounded px-1.5 py-0.5">
          #{copy.listing_code}
        </span>
        {copy.pickup_available && (
          <span className="text-[10px] text-green-600 border border-green-200 rounded px-1.5 py-0.5 bg-green-50">
            Pickup available
          </span>
        )}
        {copy.includes_expansions && (
          <span className="text-[10px] text-indigo-600 border border-indigo-100 rounded px-1.5 py-0.5 bg-indigo-50">
            Incl. expansions
          </span>
        )}
      </div>
    </div>
  )
}

// ---- Add Copy Modal ----

interface AddCopyModalProps {
  bggId: number
  gameName: string
  onClose: () => void
}

function AddCopyModal({ bggId, gameName, onClose }: AddCopyModalProps) {
  const qc = useQueryClient()
  const createCopy = useCreateCopy()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CopyFormValues>({
    resolver: zodResolver(copySchema),
    defaultValues: {
      condition: undefined,
      language: '',
      edition: '',
      sleeved: 'UNKNOWN',
      includes_expansions: '',
      missing_components: '',
      upgraded_components: '',
      component_notes: '',
      owner_notes: '',
      trade_value_hint: '',
      shipping_constraints: '',
      pickup_available: false,
      photo_urls: [],
    },
  })

  const { fields: photoFields, append: appendPhoto, remove: removePhoto } = useFieldArray({
    control,
    name: 'photo_urls',
  })

  async function onSubmit(values: CopyFormValues) {
    setServerError(null)
    try {
      await createCopy.mutateAsync({
        board_game: bggId,
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
      })
      // Invalidate game copies queries
      qc.invalidateQueries({ queryKey: GAMES_KEYS.copies(bggId, {}) })
      onClose()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const resp = (err as { response?: { data?: unknown } }).response
        const data = resp?.data
        if (data && typeof data === 'object') {
          const first = Object.values(data as Record<string, string[]>)[0]
          setServerError(Array.isArray(first) ? first[0] : String(first))
        } else {
          setServerError('Failed to add copy. Please try again.')
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
      aria-label="Add copy"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet / modal */}
      <div className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-xl shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Add my copy</h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[240px]">{gameName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable form */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {serverError && (
            <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {serverError}
            </div>
          )}

          <form id="add-copy-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {/* Condition */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Condition <span className="text-red-500">*</span>
              </label>
              <select
                {...register('condition')}
                className={inputCls(!!errors.condition)}
              >
                <option value="">Select condition…</option>
                {Object.entries(CONDITION_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              {errors.condition && (
                <p className="mt-1 text-xs text-red-600">{errors.condition.message}</p>
              )}
            </div>

            {/* Language + Edition */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
                <input
                  {...register('language')}
                  placeholder="e.g. English"
                  className={inputCls(!!errors.language)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Edition</label>
                <input
                  {...register('edition')}
                  placeholder="e.g. 2nd Ed."
                  className={inputCls(!!errors.edition)}
                />
              </div>
            </div>

            {/* Sleeved */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sleeved</label>
              <select {...register('sleeved')} className={inputCls(false)}>
                {Object.entries(SLEEVED_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            {/* Includes expansions */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Includes expansions</label>
              <input
                {...register('includes_expansions')}
                placeholder="e.g. Stonemaier Expansions"
                className={inputCls(false)}
              />
            </div>

            {/* Missing / upgraded components */}
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

            {/* Component notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Component notes</label>
              <textarea
                {...register('component_notes')}
                rows={2}
                placeholder="Any notes about the components…"
                className={`${inputCls(false)} resize-none`}
              />
            </div>

            {/* Owner notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner notes</label>
              <textarea
                {...register('owner_notes')}
                rows={2}
                placeholder="Anything you want traders to know…"
                className={`${inputCls(false)} resize-none`}
              />
            </div>

            {/* Trade value hint */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Trade value hint</label>
              <input
                {...register('trade_value_hint')}
                placeholder="e.g. ~$40 retail"
                className={inputCls(!!errors.trade_value_hint)}
              />
              {errors.trade_value_hint && (
                <p className="mt-1 text-xs text-red-600">{errors.trade_value_hint.message}</p>
              )}
            </div>

            {/* Shipping constraints */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Shipping constraints</label>
              <input
                {...register('shipping_constraints')}
                placeholder="e.g. Domestic only"
                className={inputCls(false)}
              />
            </div>

            {/* Pickup available */}
            <div className="flex items-center gap-2">
              <input
                id="pickup_available"
                type="checkbox"
                {...register('pickup_available')}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="pickup_available" className="text-sm font-medium text-gray-700">
                Pickup available
              </label>
            </div>

            {/* Photo URLs */}
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
                    {errors.photo_urls?.[idx]?.url && (
                      <p className="mt-1 text-xs text-red-600">{errors.photo_urls[idx]?.url?.message}</p>
                    )}
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

        {/* Footer */}
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
            form="add-copy-form"
            disabled={isSubmitting}
            className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-60 transition-colors"
          >
            {isSubmitting ? 'Adding…' : 'Add copy'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Copies section ----

function CopiesSection({ bggId, bggIdNum, gameName }: { bggId: string; bggIdNum: number; gameName: string }) {
  const [condition, setCondition] = useState('')
  const [language, setLanguage] = useState('')
  const [showModal, setShowModal] = useState(false)

  const token = useAuthStore((s) => s.token)
  const navigate = useNavigate()

  const { data, isLoading, isError } = useGameCopies(bggId, {
    condition: condition || undefined,
    language: language || undefined,
  })

  const copies = (data?.results ?? []) as unknown as Copy[]
  const hasFilters = condition !== '' || language !== ''

  function handleAddCopy() {
    if (!token) {
      navigate('/login')
      return
    }
    setShowModal(true)
  }

  return (
    <>
      {showModal && (
        <AddCopyModal
          bggId={bggIdNum}
          gameName={gameName}
          onClose={() => setShowModal(false)}
        />
      )}

      <section>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Copies listed
            {data && data.count > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-400">
                ({data.count})
              </span>
            )}
          </h2>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filters */}
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="py-1.5 pl-2.5 pr-7 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
              aria-label="Filter by condition"
            >
              {CONDITION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="py-1.5 pl-2.5 pr-7 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
              aria-label="Filter by language"
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {hasFilters && (
              <button
                onClick={() => { setCondition(''); setLanguage('') }}
                className="text-xs text-indigo-600 hover:underline px-1"
              >
                Clear
              </button>
            )}

            {/* Add copy button */}
            <button
              onClick={handleAddCopy}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {token ? 'Add my copy' : 'Log in to add copy'}
            </button>
          </div>
        </div>

        {isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-5 text-center text-sm text-red-600">
            Could not load copies. Please try again.
          </div>
        ) : isLoading ? (
          <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 px-4 py-3 flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-gray-100 animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-24" />
                  <div className="h-2.5 bg-gray-100 rounded animate-pulse w-40" />
                </div>
                <div className="h-5 w-16 bg-gray-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : copies.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 px-6 py-10 text-center">
            <svg className="mx-auto w-10 h-10 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="text-sm font-medium text-gray-500">No copies listed yet</p>
            <p className="text-xs text-gray-400 mt-1">
              {hasFilters
                ? 'No copies match the selected filters.'
                : 'Be the first to list a copy of this game.'}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            {copies.map((copy) => (
              <CopyCard key={copy.id} copy={copy} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

// ---- Image placeholder ----

function GameDetailImage({ name, imageUrl }: { name: string; imageUrl: string }) {
  const [imgError, setImgError] = useState(false)

  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  if (!imageUrl || imgError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-50 to-slate-100 rounded-xl">
        <span className="text-4xl font-bold text-indigo-200 select-none">{initials || '?'}</span>
      </div>
    )
  }

  return (
    <img
      src={imageUrl}
      alt={name}
      className="w-full h-full object-contain rounded-xl"
      onError={() => setImgError(true)}
    />
  )
}

// ---- Page header skeleton ----

function HeaderSkeleton() {
  return (
    <div className="flex flex-col sm:flex-row gap-6 mb-8 animate-pulse">
      <div className="shrink-0 w-full sm:w-48 h-48 bg-gray-100 rounded-xl" />
      <div className="flex-1 space-y-3 py-2">
        <div className="h-8 bg-gray-100 rounded w-3/4" />
        <div className="h-4 bg-gray-100 rounded w-1/3" />
        <div className="flex gap-3 mt-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="w-20 h-14 bg-gray-100 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- Main page ----

export default function GameDetailPage() {
  const { bggId } = useParams<{ bggId: string }>()
  const { data: game, isLoading, isError } = useGameDetail(bggId)

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
      {/* Back link */}
      <Link
        to="/games"
        className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline mb-6"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Games
      </Link>

      {isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-10 text-center">
          <p className="text-base font-medium text-red-700">Game not found</p>
          <p className="mt-1 text-sm text-red-500">
            This game may not exist or the server is unavailable.
          </p>
          <Link to="/games" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
            Browse all games
          </Link>
        </div>
      ) : isLoading ? (
        <>
          <HeaderSkeleton />
          <div className="space-y-4">
            <div className="h-4 bg-gray-100 rounded animate-pulse w-full" />
            <div className="h-4 bg-gray-100 rounded animate-pulse w-5/6" />
            <div className="h-4 bg-gray-100 rounded animate-pulse w-4/6" />
          </div>
        </>
      ) : game ? (
        <>
          {/* ---- Header ---- */}
          <div className="flex flex-col sm:flex-row gap-6 mb-8">
            {/* Image */}
            <div className="shrink-0 w-full sm:w-48 h-48">
              <GameDetailImage name={game.name} imageUrl={game.image_url} />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-start gap-2 mb-1">
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight leading-tight">
                  {game.name}
                </h1>
                {game.is_expansion && (
                  <span className="inline-block mt-1 rounded bg-violet-100 text-violet-700 text-xs font-semibold px-2 py-0.5 border border-violet-200">
                    Expansion
                  </span>
                )}
              </div>

              {game.year_published && (
                <p className="text-sm text-gray-400 mb-4">{game.year_published}</p>
              )}

              {/* Stats badges */}
              <div className="flex flex-wrap gap-2 mb-5">
                <InfoBadge label="Rank" value={game.rank != null ? `#${game.rank}` : null} />
                <InfoBadge
                  label="Rating"
                  value={game.average != null ? game.average.toFixed(2) : null}
                />
                <InfoBadge
                  label="Ratings"
                  value={
                    game.users_rated != null
                      ? game.users_rated.toLocaleString()
                      : null
                  }
                />
                {(game.min_players != null || game.max_players != null) && (
                  <InfoBadge
                    label="Players"
                    value={
                      game.min_players != null && game.max_players != null
                        ? game.min_players === game.max_players
                          ? game.min_players
                          : `${game.min_players}–${game.max_players}`
                        : (game.min_players ?? game.max_players)
                    }
                  />
                )}
                {(game.min_playtime != null || game.max_playtime != null) && (
                  <InfoBadge
                    label="Time"
                    value={
                      game.min_playtime != null && game.max_playtime != null
                        ? game.min_playtime === game.max_playtime
                          ? `${game.min_playtime}m`
                          : `${game.min_playtime}–${game.max_playtime}m`
                        : `${game.min_playtime ?? game.max_playtime}m`
                    }
                  />
                )}
                {game.copies_count > 0 && (
                  <InfoBadge label="Copies" value={game.copies_count} />
                )}
              </div>

              {/* Rating display */}
              {game.average != null && (
                <p className="text-sm text-gray-500">
                  Average rating:{' '}
                  <Rating value={game.average} />
                </p>
              )}
            </div>
          </div>

          {/* ---- Details grid ---- */}
          <div className="mb-8 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
            <dl className="space-y-4">
              <TagList label="Designers" items={game.designers} />
              <TagList label="Publishers" items={game.publishers} />
            </dl>
            <dl className="space-y-4">
              <TagList label="Mechanics" items={game.mechanics} />
              <TagList label="Categories" items={game.categories} />
            </dl>
          </div>

          <hr className="border-gray-100 mb-8" />

          {/* ---- Copies ---- */}
          <CopiesSection
            bggId={String(bggId)}
            bggIdNum={game.bgg_id}
            gameName={game.name}
          />
        </>
      ) : null}
    </div>
  )
}
