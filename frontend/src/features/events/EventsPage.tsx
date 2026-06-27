import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useEvents, useCreateEvent } from '../../api/events'
import type { TradeEventListItem } from '../../api/events'
import { useAuthStore } from '../../store/auth'
import { StatusBadge } from './StatusBadge'
import { searchGeocode, type GeocodeSuggestion } from '../../api/profiles'

// ---- Constants ----

const PAGE_SIZE = 24

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMISSIONS_OPEN', label: 'Submissions Open' },
  { value: 'WANTLIST_OPEN', label: 'Want List Open' },
  { value: 'MATCHING', label: 'Matching' },
  { value: 'MATCH_REVIEW', label: 'Match Review' },
  { value: 'FINALIZATION', label: 'Finalization' },
  { value: 'SHIPPING', label: 'Shipping' },
  { value: 'ARCHIVED', label: 'Archived' },
]

// ---- Debounce hook ----

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

// ---- Pagination component (reused pattern from GamesPage) ----

interface PaginationProps {
  page: number
  total: number
  pageSize: number
  onChange: (p: number) => void
}

function Pagination({ page, total, pageSize, onChange }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  const delta = 2
  const pages: (number | 'ellipsis')[] = []
  const left = Math.max(2, page - delta)
  const right = Math.min(totalPages - 1, page + delta)
  pages.push(1)
  if (left > 2) pages.push('ellipsis')
  for (let i = left; i <= right; i++) pages.push(i)
  if (right < totalPages - 1) pages.push('ellipsis')
  if (totalPages > 1) pages.push(totalPages)
  return (
    <nav className="flex items-center justify-center gap-1 mt-8 flex-wrap" aria-label="Pagination">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className="px-3 py-1.5 text-sm font-semibold rounded-2xl border-2 border-ink/15 bg-cream text-moss hover:bg-sage/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous page"
      >
        ‹ Prev
      </button>
      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span key={`ell-${i}`} className="px-2 py-1.5 text-sm font-bold text-moss/60">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={`min-w-[2.25rem] px-2.5 py-1.5 text-sm rounded-2xl border-2 transition-colors ${
              p === page
                ? 'bg-butter border-ink text-ink font-bold shadow-pop-sm'
                : 'border-ink/15 bg-cream text-moss hover:bg-sage/40'
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onChange(page + 1)}
        disabled={page === Math.ceil(total / pageSize)}
        className="px-3 py-1.5 text-sm font-semibold rounded-2xl border-2 border-ink/15 bg-cream text-moss hover:bg-sage/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label="Next page"
      >
        Next ›
      </button>
    </nav>
  )
}

// ---- Event card ----

function EventCard({ event }: { event: TradeEventListItem }) {
  const subDate = event.submissions_open_at
    ? new Date(event.submissions_open_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null
  const closeDate = event.submissions_close_at
    ? new Date(event.submissions_close_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  return (
    <Link
      to={`/events/${event.slug}`}
      className="group flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 rounded-3xl border-2 border-ink bg-cream p-4 shadow-card transition-transform hover:-translate-y-0.5"
    >
      {event.image_url ? (
        <img
          src={event.image_url}
          alt=""
          className="h-24 w-full shrink-0 rounded-2xl object-cover sm:h-24 sm:w-24"
          loading="lazy"
        />
      ) : (
        <div className="hidden h-24 w-24 shrink-0 rounded-2xl bg-parchment sm:block" aria-hidden="true" />
      )}
      {/* Left: title, description, meta */}
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-base font-bold text-ink truncate leading-snug">
          {event.name}
        </h3>
        {event.description && (
          <p className="mt-0.5 text-xs text-moss line-clamp-1">{event.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-moss/70">
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {event.participants_count} participant{event.participants_count !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {event.organizer_username}
          </span>
          {subDate && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {closeDate ? `${subDate} – ${closeDate}` : `Opens ${subDate}`}
            </span>
          )}
          {event.money_enabled && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Money allowed{event.max_money_per_user ? ` (max $${event.max_money_per_user})` : ''}
            </span>
          )}
          {event.require_location && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Location-gated{event.max_distance_km ? ` (${event.max_distance_km} km)` : ''}
              {(event.center_place || (event.center_latitude != null && event.center_longitude != null)) && (
                <span className="text-moss/60">
                  · {event.center_place || `${event.center_latitude}, ${event.center_longitude}`}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Right: status + role badges */}
      <div className="flex sm:flex-col items-start sm:items-end gap-2 shrink-0">
        <StatusBadge status={event.status} />
        {(event.is_organizer || event.is_participant) && (
          <div className="flex gap-1.5">
            {event.is_organizer && (
              <span className="text-xs border border-ink/15 bg-butter/60 text-ink rounded-full px-2.5 py-0.5 font-semibold">
                Organizer
              </span>
            )}
            {event.is_participant && !event.is_organizer && (
              <span className="text-xs border border-ink/15 bg-sage/60 text-ink rounded-full px-2.5 py-0.5 font-semibold">
                Joined
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}

// ---- Event card skeleton ----

function EventCardSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-3xl border-2 border-ink/15 bg-cream p-4 animate-pulse">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-4 w-1/3 bg-gray-200 rounded-full" />
        <div className="h-3 w-2/3 bg-gray-200 rounded-full" />
        <div className="flex gap-3">
          <div className="h-3 w-16 bg-gray-200 rounded-full" />
          <div className="h-3 w-20 bg-gray-200 rounded-full" />
          <div className="h-3 w-24 bg-gray-200 rounded-full" />
        </div>
      </div>
      <div className="h-6 w-20 bg-gray-200 rounded-full shrink-0" />
    </div>
  )
}

// ---- Create event form (zod schema) ----

const createEventSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(200, 'Name too long'),
  description: z.string().max(5000).optional(),
  shipping_rules: z.string().max(2000).optional(),
  regional_restrictions: z.string().max(2000).optional(),
  trade_policies: z.string().max(2000).optional(),
  image_url: z.string().max(500).optional(),
  submissions_open_at: z.string().optional(),
  submissions_close_at: z.string().optional(),
  wantlist_close_at: z.string().optional(),
  money_enabled: z.boolean().optional(),
  max_money_per_user: z.string().optional(),
  require_location: z.boolean().optional(),
  center_latitude: z.string().optional(),
  center_longitude: z.string().optional(),
  max_distance_km: z.string().optional(),
})

type CreateEventFormValues = z.infer<typeof createEventSchema>

interface CreateEventModalProps {
  onClose: () => void
}

function CreateEventModal({ onClose }: CreateEventModalProps) {
  const navigate = useNavigate()
  const createEvent = useCreateEvent()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateEventFormValues>({
    resolver: zodResolver(createEventSchema),
    defaultValues: {
      name: '',
      description: '',
      shipping_rules: '',
      regional_restrictions: '',
      trade_policies: '',
      image_url: '',
      money_enabled: false,
      max_money_per_user: '',
      require_location: false,
      center_latitude: '',
      center_longitude: '',
      max_distance_km: '',
    },
  })
  const moneyEnabled = watch('money_enabled')
  const requireLocation = watch('require_location')
  const imageUrl = watch('image_url')

  const [locationQuery, setLocationQuery] = useState('')
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const skipNextSearch = useRef(false)

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false
      return
    }
    const q = locationQuery.trim()
    if (q.length < 3) {
      setSuggestions([])
      return
    }
    const handle = setTimeout(async () => {
      try {
        const res = await searchGeocode(q)
        setSuggestions(res)
        setShowSuggestions(true)
      } catch {
        setSuggestions([])
      }
    }, 350)
    return () => clearTimeout(handle)
  }, [locationQuery])

  async function onSubmit(values: CreateEventFormValues) {
    setServerError(null)
    try {
      const payload = {
        name: values.name,
        description: values.description || undefined,
        shipping_rules: values.shipping_rules || undefined,
        regional_restrictions: values.regional_restrictions || undefined,
        trade_policies: values.trade_policies || undefined,
        image_url: values.image_url || undefined,
        submissions_open_at: values.submissions_open_at
          ? new Date(values.submissions_open_at).toISOString()
          : undefined,
        submissions_close_at: values.submissions_close_at
          ? new Date(values.submissions_close_at).toISOString()
          : undefined,
        wantlist_close_at: values.wantlist_close_at
          ? new Date(values.wantlist_close_at).toISOString()
          : undefined,
        money_enabled: !!values.money_enabled,
        max_money_per_user: values.money_enabled
          ? (values.max_money_per_user?.trim() || null)
          : null,
        require_location: !!values.require_location,
        center_latitude: values.center_latitude ? parseFloat(values.center_latitude) : null,
        center_longitude: values.center_longitude ? parseFloat(values.center_longitude) : null,
        max_distance_km: values.max_distance_km ? parseFloat(values.max_distance_km) : null,
      }
      const created = await createEvent.mutateAsync(payload)
      onClose()
      navigate(`/events/${created.slug}`)
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const resp = (err as { response?: { data?: unknown } }).response
        const data = resp?.data
        if (data && typeof data === 'object') {
          const first = Object.values(data as Record<string, string[]>)[0]
          setServerError(Array.isArray(first) ? first[0] : String(first))
        } else {
          setServerError('Failed to create event. Please try again.')
        }
      } else {
        setServerError('Network error. Please try again.')
      }
    }
  }

  const inputCls = (hasErr: boolean) =>
    `w-full rounded-xl border-2 bg-parchment px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-2 focus:ring-sage ${
      hasErr ? 'border-red-400' : 'border-ink/15'
    }`

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create trade event"
    >
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full sm:max-w-xl bg-cream border-2 border-ink rounded-t-3xl sm:rounded-3xl shadow-card max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink/10">
          <h2 className="font-display text-lg font-bold text-ink">Create Trade Event</h2>
          <button
            onClick={onClose}
            className="text-moss hover:text-ink hover:bg-sage/40 p-1.5 rounded-xl transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {serverError && (
            <div className="mb-4 rounded-xl bg-red-50 border-2 border-red-200 px-3 py-2 text-sm font-medium text-red-700">
              {serverError}
            </div>
          )}

          <form id="create-event-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">
                Event name <span className="text-red-500">*</span>
              </label>
              <input
                {...register('name')}
                placeholder="e.g. Spring 2026 Math Trade"
                className={inputCls(!!errors.name)}
              />
              {errors.name && (
                <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Description</label>
              <textarea
                {...register('description')}
                rows={3}
                placeholder="Describe your event, rules, or any special notes…"
                className={`${inputCls(false)} resize-none`}
              />
            </div>

            {/* Cover image URL */}
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Cover image URL</label>
              <input
                {...register('image_url')}
                placeholder="https://example.com/cover.jpg"
                className={inputCls(!!errors.image_url)}
              />
              {errors.image_url && (
                <p className="mt-1 text-xs text-red-600">{errors.image_url.message}</p>
              )}
              {imageUrl ? (
                <img src={imageUrl} alt="" className="mt-2 h-24 w-full rounded-xl border-2 border-ink/10 object-cover" />
              ) : null}
            </div>

            {/* Dates */}
            <div className="space-y-3">
              <p className="text-xs font-bold text-moss uppercase tracking-wide">Dates (optional)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-moss mb-1">
                    Submissions open
                  </label>
                  <input
                    type="datetime-local"
                    {...register('submissions_open_at')}
                    className={inputCls(false)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-moss mb-1">
                    Submissions close
                  </label>
                  <input
                    type="datetime-local"
                    {...register('submissions_close_at')}
                    className={inputCls(false)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-moss mb-1">
                    Want list closes
                  </label>
                  <input
                    type="datetime-local"
                    {...register('wantlist_close_at')}
                    className={inputCls(false)}
                  />
                </div>
              </div>
            </div>

            {/* Policies */}
            <div className="space-y-3">
              <p className="text-xs font-bold text-moss uppercase tracking-wide">Policies (optional)</p>
              <div>
                <label className="block text-xs font-semibold text-moss mb-1">Shipping rules</label>
                <textarea
                  {...register('shipping_rules')}
                  rows={2}
                  placeholder="e.g. Domestic shipping only. Buyer pays shipping."
                  className={`${inputCls(false)} resize-none`}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-moss mb-1">
                  Regional restrictions
                </label>
                <textarea
                  {...register('regional_restrictions')}
                  rows={2}
                  placeholder="e.g. Argentina only."
                  className={`${inputCls(false)} resize-none`}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-moss mb-1">Trade policies</label>
                <textarea
                  {...register('trade_policies')}
                  rows={2}
                  placeholder="e.g. No confirmed trades may be retracted."
                  className={`${inputCls(false)} resize-none`}
                />
              </div>
            </div>

            {/* Money trading */}
            <div className="space-y-3">
              <p className="text-xs font-bold text-moss uppercase tracking-wide">Money trading</p>
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  {...register('money_enabled')}
                  className="h-4 w-4 rounded border-2 border-ink/30 accent-indigo-600 focus:ring-sage"
                />
                Allow members to use money in trades
              </label>
              {moneyEnabled && (
                <div>
                  <label className="block text-xs font-semibold text-moss mb-1">
                    Max money per user (leave blank for no cap)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="e.g. 50.00"
                    {...register('max_money_per_user')}
                    className={`${inputCls(false)} sm:max-w-[12rem]`}
                  />
                </div>
              )}
            </div>

            {/* Location gate */}
            <div className="space-y-3">
              <p className="text-xs font-bold text-moss uppercase tracking-wide">Location gate</p>
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  {...register('require_location')}
                  className="h-4 w-4 rounded border-2 border-ink/30 accent-indigo-600 focus:ring-sage"
                />
                Require participants to have a geocoded location
              </label>
              {requireLocation && (
                <div className="space-y-3">
                  <div className="relative">
                    <label className="block text-xs font-semibold text-moss mb-1">Location (optional)</label>
                    <input
                      type="text"
                      autoComplete="off"
                      value={locationQuery}
                      onChange={(e) => setLocationQuery(e.target.value)}
                      onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                      placeholder="Type a place to fill the coordinates…"
                      className={inputCls(false)}
                    />
                    {showSuggestions && suggestions.length > 0 && (
                      <ul className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border-2 border-ink/15 bg-cream shadow-card">
                        {suggestions.map((s) => (
                          <li key={`${s.display_name}-${s.lat}-${s.lon}`}>
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault()
                                skipNextSearch.current = true
                                setValue('center_latitude', String(s.lat), { shouldValidate: false })
                                setValue('center_longitude', String(s.lon), { shouldValidate: false })
                                setLocationQuery(s.display_name)
                                setShowSuggestions(false)
                              }}
                              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-sage/30"
                            >
                              {s.display_name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-xs text-moss/70">Type a place to auto-fill the center coordinates below.</p>
                  </div>
                  <p className="text-xs text-moss/70">
                    Optionally restrict to a geographic radius (leave lat/lng blank to only require location, without radius filtering).
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-moss mb-1">Center latitude</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="e.g. -34.6"
                        {...register('center_latitude')}
                        className={inputCls(false)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-moss mb-1">Center longitude</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="e.g. -58.4"
                        {...register('center_longitude')}
                        className={inputCls(false)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-moss mb-1">
                      Max distance (km, leave blank for no radius limit)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      placeholder="e.g. 500"
                      {...register('max_distance_km')}
                      className={`${inputCls(false)} sm:max-w-[12rem]`}
                    />
                  </div>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t-2 border-ink/10">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border-2 border-ink/15 bg-cream px-4 py-2.5 text-sm font-semibold text-moss hover:bg-sage/30 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="create-event-form"
            disabled={isSubmitting}
            className="flex-1 rounded-2xl border-2 border-ink bg-butter px-4 py-2.5 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
          >
            {isSubmitting ? 'Creating…' : 'Create event'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Main page ----

export default function EventsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { token } = useAuthStore()
  const [createOpen, setCreateOpen] = useState(false)
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '')
  const debouncedSearch = useDebounce(searchInput, 300)
  const statusFilter = searchParams.get('status') ?? ''
  const page = parseInt(searchParams.get('page') ?? '1', 10)

  const prevFilters = useRef({ search: debouncedSearch, status: statusFilter })

  useEffect(() => {
    const prev = prevFilters.current
    const changed = prev.search !== debouncedSearch || prev.status !== statusFilter
    prevFilters.current = { search: debouncedSearch, status: statusFilter }
    setSearchParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (debouncedSearch) next.set('search', debouncedSearch)
        else next.delete('search')
        if (changed) next.delete('page')
        return next
      },
      { replace: true }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, statusFilter])

  function setStatus(value: string) {
    setSearchParams((p) => {
      const next = new URLSearchParams(p)
      if (value) next.set('status', value)
      else next.delete('status')
      next.delete('page')
      return next
    })
  }

  function changePage(p: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (p === 1) next.delete('page')
      else next.set('page', String(p))
      return next
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const queryParams = {
    search: debouncedSearch || undefined,
    status: statusFilter || undefined,
    page,
  }

  const { data, isLoading, isError, isFetching } = useEvents(queryParams)
  const { data: joinedData } = useEvents({ joined: true })
  const joinedEvents = token ? (joinedData?.results ?? []) : []
  const joinedSlugs = new Set(joinedEvents.map((e) => e.slug))
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setSearchInput(e.target.value),
    []
  )

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {createOpen && <CreateEventModal onClose={() => setCreateOpen(false)} />}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-ink tracking-tight">Trade Events</h1>
          {data && !isLoading && (
            <p className="mt-1 text-sm text-moss">
              {data.count.toLocaleString()} event{data.count !== 1 ? 's' : ''}
              {debouncedSearch ? ` matching "${debouncedSearch}"` : ''}
            </p>
          )}
        </div>

        {token ? (
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-2xl border-2 border-ink bg-butter px-5 py-2.5 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 self-start whitespace-nowrap"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Create event
          </button>
        ) : (
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 rounded-2xl border-2 border-ink/20 bg-cream px-5 py-2.5 text-sm font-semibold text-moss hover:bg-sage/40 transition-colors self-start whitespace-nowrap"
          >
            Login to create event
          </Link>
        )}
      </div>

      {/* Filter bar */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
          </span>
          <input
            type="search"
            placeholder="Search events…"
            value={searchInput}
            onChange={handleSearchChange}
            className="w-full pl-9 pr-3 py-2.5 text-sm border-2 border-ink/15 bg-cream rounded-2xl focus:outline-none focus:ring-2 focus:ring-sage focus:border-ink"
          />
          {isFetching && !isLoading && (
            <span className="absolute inset-y-0 right-3 flex items-center">
              <svg className="w-3.5 h-3.5 text-indigo-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </span>
          )}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatus(e.target.value)}
          className="py-2.5 pl-3 pr-8 text-sm border-2 border-ink/15 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sage bg-cream font-medium text-ink"
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      {isError ? (
        <div className="rounded-3xl border-2 border-red-200 bg-red-50 px-5 py-8 text-center">
          <p className="text-sm font-semibold text-red-700">Could not load events.</p>
          <p className="mt-1 text-xs text-red-500">Check your connection or try again later.</p>
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <EventCardSkeleton key={i} />
          ))}
        </div>
      ) : data && data.results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg className="w-12 h-12 text-moss/40 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-base font-semibold text-ink">No events found</p>
          <p className="text-sm text-moss mt-1">
            {debouncedSearch || statusFilter
              ? 'Try adjusting your filters.'
              : 'Be the first to create a trade event!'}
          </p>
        </div>
      ) : (
        <>
          {joinedEvents.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-2 text-sm font-semibold text-ink">Your events</h2>
              <div className="grid grid-cols-1 gap-3">
                {joinedEvents.map((event) => (
                  <EventCard key={event.slug} event={event} />
                ))}
              </div>
            </div>
          )}
          <div
            className={`space-y-3 transition-opacity ${
              isFetching ? 'opacity-60' : 'opacity-100'
            }`}
          >
            {data!.results.filter((e) => !joinedSlugs.has(e.slug)).map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>

          <Pagination
            page={page}
            total={data!.count}
            pageSize={PAGE_SIZE}
            onChange={changePage}
          />
        </>
      )}
    </div>
  )
}
