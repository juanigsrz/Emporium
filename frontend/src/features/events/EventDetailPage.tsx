import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  useEvent,
  useEventListings,
  useJoinEvent,
  useLeaveEvent,
  useTransitionEvent,
  usePatchEvent,
  useAddEventListing,
  useRemoveEventListing,
  useEventParticipants,
  useSetEventBudget,
  EVENT_STATUSES,
  EVENT_STATUS_LABELS,
  MATCHING_MODE_LABELS,
  MATCHING_MODE_FROZEN_STATUSES,
} from '../../api/events'
import type { TradeEvent, EventListing, EventStatus, MatchingMode } from '../../api/events'
import { useCopies } from '../../api/copies'
import type { Copy } from '../../api/copies'
import { useAuthStore } from '../../store/auth'
import { StatusBadge } from './StatusBadge'
import { STATUS_BADGE_CLASSES } from './eventUtils'

// ---- Lifecycle progress bar ----

function LifecycleProgress({ current }: { current: EventStatus }) {
  const currentIdx = EVENT_STATUSES.indexOf(current)
  return (
    <div className="w-full overflow-x-auto pb-1">
      <div className="flex items-center min-w-max gap-0">
        {EVENT_STATUSES.map((status, idx) => {
          const isPast = idx < currentIdx
          const isCurrent = idx === currentIdx
          const isFuture = idx > currentIdx
          return (
            <div key={status} className="flex items-center">
              {/* Step dot */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-3 h-3 rounded-full border-2 transition-colors ${
                    isCurrent
                      ? 'bg-indigo-600 border-indigo-600'
                      : isPast
                      ? 'bg-indigo-300 border-indigo-300'
                      : 'bg-white border-gray-300'
                  }`}
                />
                <span
                  className={`mt-1 text-xs font-medium whitespace-nowrap px-0.5 ${
                    isCurrent
                      ? 'text-indigo-700'
                      : isPast
                      ? 'text-indigo-400'
                      : isFuture
                      ? 'text-gray-400'
                      : 'text-gray-400'
                  }`}
                  style={{ fontSize: '10px' }}
                >
                  {EVENT_STATUS_LABELS[status]}
                </span>
              </div>
              {/* Connector line (except after last) */}
              {idx < EVENT_STATUSES.length - 1 && (
                <div
                  className={`h-0.5 w-8 mx-0.5 transition-colors ${
                    idx < currentIdx ? 'bg-indigo-300' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- Join / Leave button ----

function JoinLeaveButton({
  event,
  isAuthenticated,
}: {
  event: TradeEvent
  isAuthenticated: boolean
}) {
  const join = useJoinEvent()
  const leave = useLeaveEvent()
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isAuthenticated) {
    return (
      <Link
        to="/login"
        className="rounded-md border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
      >
        Login to join
      </Link>
    )
  }

  // Organizers may also participate (trade) in their own event — they just join
  // like anyone else; this creates an EventParticipation and unlocks the
  // budget / listings / wants sections below.

  // Can only join when submissions open or draft (best-effort; server validates)
  const joinableStatuses: EventStatus[] = ['DRAFT', 'SUBMISSIONS_OPEN', 'WANTLIST_OPEN']
  const canJoin = joinableStatuses.includes(event.status)

  async function handleJoin() {
    setError(null)
    try {
      await join.mutateAsync(event.slug)
    } catch (err: unknown) {
      const msg = extractErrorMsg(err) ?? 'Failed to join. Try again.'
      setError(msg)
    }
  }

  async function handleLeave() {
    setError(null)
    try {
      await leave.mutateAsync(event.slug)
      setConfirmLeave(false)
    } catch (err: unknown) {
      const msg = extractErrorMsg(err) ?? 'Failed to leave. Try again.'
      setError(msg)
      setConfirmLeave(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {event.is_participant ? (
        confirmLeave ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Leave this event?</span>
            <button
              onClick={handleLeave}
              disabled={leave.isPending}
              className="text-xs rounded border border-red-300 px-2.5 py-1 text-red-600 hover:bg-red-50 disabled:opacity-60 transition-colors"
            >
              {leave.isPending ? 'Leaving…' : 'Confirm leave'}
            </button>
            <button
              onClick={() => setConfirmLeave(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-sm text-green-600 font-medium">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              You're participating
            </span>
            <button
              onClick={() => setConfirmLeave(true)}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              Leave
            </button>
          </div>
        )
      ) : canJoin ? (
        <button
          onClick={handleJoin}
          disabled={join.isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 transition-colors shadow-sm"
        >
          {join.isPending ? 'Joining…' : event.is_organizer ? 'Join as trader' : 'Join event'}
        </button>
      ) : (
        <span className="text-sm text-gray-400">Event not open for joining</span>
      )}
    </div>
  )
}

// ---- Organizer: lifecycle transition controls ----

const TRANSITION_LABEL: Partial<Record<EventStatus, string>> = {
  SUBMISSIONS_OPEN: 'Open Submissions',
  WANTLIST_OPEN: 'Open Want Lists',
  MATCHING: 'Start Matching',
  MATCH_REVIEW: 'Open Match Review',
  FINALIZATION: 'Move to Finalization',
  SHIPPING: 'Move to Shipping',
  ARCHIVED: 'Archive Event',
}

function OrganizerLifecycleControls({ event }: { event: TradeEvent }) {
  const transition = useTransitionEvent()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<EventStatus | null>(null)

  if (!event.is_organizer || event.allowed_transitions.length === 0) return null

  async function handleTransition(to: EventStatus) {
    setError(null)
    setPending(to)
    try {
      await transition.mutateAsync({ slug: event.slug, to })
    } catch (err: unknown) {
      const msg = extractErrorMsg(err) ?? `Failed to transition to ${to}.`
      setError(msg)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">
        Organizer — Advance lifecycle
      </p>
      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {event.allowed_transitions.map((to) => (
          <button
            key={to}
            onClick={() => handleTransition(to)}
            disabled={transition.isPending}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
              STATUS_BADGE_CLASSES[to] ?? 'bg-white border-gray-300 text-gray-700'
            } hover:opacity-80`}
          >
            {pending === to && transition.isPending
              ? 'Advancing…'
              : `Advance to ${TRANSITION_LABEL[to] ?? EVENT_STATUS_LABELS[to]}`}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---- Organizer: matching mode selector ----

function MatchingModeCard({ event }: { event: TradeEvent }) {
  const patchEvent = usePatchEvent()
  const [error, setError] = useState<string | null>(null)
  const frozen = MATCHING_MODE_FROZEN_STATUSES.includes(event.status)

  async function handleChange(mode: MatchingMode) {
    if (mode === event.matching_mode) return
    setError(null)
    try {
      await patchEvent.mutateAsync({ slug: event.slug, payload: { matching_mode: mode } })
    } catch (err: unknown) {
      setError(extractErrorMsg(err) ?? 'Failed to update matching mode.')
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Matching mode
      </p>
      <select
        value={event.matching_mode}
        onChange={(e) => handleChange(e.target.value as MatchingMode)}
        disabled={frozen || patchEvent.isPending}
        className="w-full sm:w-auto py-2 pl-3 pr-8 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
        aria-label="Matching mode"
      >
        {(['ONETOONE', 'XTOY'] as MatchingMode[]).map((m) => (
          <option key={m} value={m}>{MATCHING_MODE_LABELS[m]}</option>
        ))}
      </select>
      <p className="text-xs text-gray-400 mt-2">
        {event.matching_mode === 'ONETOONE'
          ? 'Classic 1-to-1 trades, solved by the hosted solver — click Run on the matching page.'
          : 'X-to-Y trades: export wants.txt, run the solver locally, upload the result on the matching page.'}
      </p>
      {frozen && <p className="text-xs text-gray-400 mt-1">Locked — matching has started.</p>}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

// ---- Organizer: edit event form ----

const editEventSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(200),
  description: z.string().max(5000).optional(),
  shipping_rules: z.string().max(2000).optional(),
  regional_restrictions: z.string().max(2000).optional(),
  trade_policies: z.string().max(2000).optional(),
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

type EditEventFormValues = z.infer<typeof editEventSchema>

function toLocalDatetimeValue(isoString: string | null | undefined): string {
  if (!isoString) return ''
  // datetime-local input expects "YYYY-MM-DDTHH:mm"
  return isoString.slice(0, 16)
}

interface EditEventModalProps {
  event: TradeEvent
  onClose: () => void
}

function EditEventModal({ event, onClose }: EditEventModalProps) {
  const patchEvent = usePatchEvent()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EditEventFormValues>({
    resolver: zodResolver(editEventSchema),
    defaultValues: {
      name: event.name,
      description: event.description ?? '',
      shipping_rules: event.shipping_rules ?? '',
      regional_restrictions: event.regional_restrictions ?? '',
      trade_policies: event.trade_policies ?? '',
      submissions_open_at: toLocalDatetimeValue(event.submissions_open_at),
      submissions_close_at: toLocalDatetimeValue(event.submissions_close_at),
      wantlist_close_at: toLocalDatetimeValue(event.wantlist_close_at),
      money_enabled: event.money_enabled,
      max_money_per_user: event.max_money_per_user ?? '',
      require_location: event.require_location,
      center_latitude: event.center_latitude != null ? String(event.center_latitude) : '',
      center_longitude: event.center_longitude != null ? String(event.center_longitude) : '',
      max_distance_km: event.max_distance_km != null ? String(event.max_distance_km) : '',
    },
  })
  const moneyEnabled = watch('money_enabled')
  const requireLocation = watch('require_location')

  async function onSubmit(values: EditEventFormValues) {
    setServerError(null)
    try {
      await patchEvent.mutateAsync({
        slug: event.slug,
        payload: {
          name: values.name,
          description: values.description || undefined,
          shipping_rules: values.shipping_rules || undefined,
          regional_restrictions: values.regional_restrictions || undefined,
          trade_policies: values.trade_policies || undefined,
          submissions_open_at: values.submissions_open_at
            ? new Date(values.submissions_open_at).toISOString()
            : null,
          submissions_close_at: values.submissions_close_at
            ? new Date(values.submissions_close_at).toISOString()
            : null,
          wantlist_close_at: values.wantlist_close_at
            ? new Date(values.wantlist_close_at).toISOString()
            : null,
          money_enabled: !!values.money_enabled,
          max_money_per_user: values.money_enabled
            ? (values.max_money_per_user?.trim() || null)
            : null,
          require_location: !!values.require_location,
          center_latitude: values.center_latitude ? parseFloat(values.center_latitude) : null,
          center_longitude: values.center_longitude ? parseFloat(values.center_longitude) : null,
          max_distance_km: values.max_distance_km ? parseFloat(values.max_distance_km) : null,
        },
      })
      onClose()
    } catch (err: unknown) {
      const msg = extractErrorMsg(err) ?? 'Failed to save. Please try again.'
      setServerError(msg)
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
      aria-label="Edit event"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full sm:max-w-xl bg-white rounded-t-2xl sm:rounded-xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Edit Event</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {serverError && (
            <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {serverError}
            </div>
          )}

          <form id="edit-event-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Event name <span className="text-red-500">*</span>
              </label>
              <input {...register('name')} className={inputCls(!!errors.name)} />
              {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea {...register('description')} rows={3} className={`${inputCls(false)} resize-none`} />
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Dates</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(
                  [
                    ['submissions_open_at', 'Submissions open'],
                    ['submissions_close_at', 'Submissions close'],
                    ['wantlist_close_at', 'Want list closes'],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    <input type="datetime-local" {...register(field)} className={inputCls(false)} />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Policies</p>
              {(
                [
                  ['shipping_rules', 'Shipping rules'],
                  ['regional_restrictions', 'Regional restrictions'],
                  ['trade_policies', 'Trade policies'],
                ] as const
              ).map(([field, label]) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <textarea {...register(field)} rows={2} className={`${inputCls(false)} resize-none`} />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Money trading</p>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  {...register('money_enabled')}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Allow members to use money in trades
              </label>
              {moneyEnabled && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
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

            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Location gate</p>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  {...register('require_location')}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Require participants to have a geocoded location
              </label>
              {requireLocation && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400">
                    Optionally restrict to a geographic radius (leave lat/lng blank to only require location, without radius filtering).
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Center latitude</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="e.g. -34.6"
                        {...register('center_latitude')}
                        className={inputCls(false)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Center longitude</label>
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
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Max distance (km, leave blank for no radius limit)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      placeholder="e.g. 500"
                      {...register('max_distance_km')}
                      className={`${inputCls(!!errors.max_distance_km)} sm:max-w-[12rem]`}
                    />
                    {errors.max_distance_km && (
                      <p className="mt-1 text-xs text-red-600">{errors.max_distance_km.message as string}</p>
                    )}
                  </div>
                </div>
              )}
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
            form="edit-event-form"
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

// ---- Participant money budget ----

function ParticipantBudgetCard({ event, username }: { event: TradeEvent; username: string }) {
  const { data: participantsData } = useEventParticipants(event.slug)
  const setBudget = useSetEventBudget()
  const me = participantsData?.results.find((p) => p.username === username)
  const current = me?.max_spend ?? '0'

  const [value, setValue] = useState<string>('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync once the participant record loads.
  const effective = value !== '' ? value : current

  async function handleSave() {
    setError(null)
    setSaved(false)
    try {
      await setBudget.mutateAsync({ slug: event.slug, maxSpend: effective || '0' })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: unknown) {
      setError(extractErrorMsg(err) ?? 'Failed to save budget.')
    }
  }

  const cap = event.max_money_per_user
  return (
    <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
      <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">
        Your money budget
      </p>
      <p className="text-xs text-emerald-600 mb-2">
        The most you're willing to spend in this event.
        {cap ? ` Cap: ${cap}.` : ' No cap set.'}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">$</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={effective}
          onChange={(e) => setValue(e.target.value)}
          className="w-32 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          onClick={handleSave}
          disabled={setBudget.isPending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 transition-colors"
        >
          {setBudget.isPending ? 'Saving…' : 'Save budget'}
        </button>
        {saved && <span className="text-xs text-emerald-600">Saved ✓</span>}
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

// ---- My event listings section ----

interface AddListingFormProps {
  slug: string
  existingCopyIds: Set<number>
}

function AddListingForm({ slug, existingCopyIds }: AddListingFormProps) {
  const { data: copiesData } = useCopies({ mine: true })
  const addListing = useAddEventListing()
  const [selectedCopyId, setSelectedCopyId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const availableCopies = (copiesData?.results ?? []).filter(
    (c: Copy) => c.status === 'ACTIVE' && !c.is_pending && !existingCopyIds.has(c.id)
  )

  async function handleAdd() {
    if (!selectedCopyId) return
    setError(null)
    try {
      await addListing.mutateAsync({ slug, copyId: Number(selectedCopyId) })
      setSelectedCopyId('')
    } catch (err: unknown) {
      const msg = extractErrorMsg(err) ?? 'Failed to add listing. Try again.'
      setError(msg)
    }
  }

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <select
        value={selectedCopyId}
        onChange={(e) => setSelectedCopyId(e.target.value)}
        className="flex-1 py-2 pl-3 pr-8 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        aria-label="Select copy to add"
      >
        <option value="">Select a copy…</option>
        {availableCopies.map((copy) => (
          <option key={copy.id} value={copy.id}>
            {copy.board_game_name} — {copy.listing_code} ({copy.condition.toLowerCase().replace('_', ' ')})
          </option>
        ))}
      </select>
      <button
        onClick={handleAdd}
        disabled={!selectedCopyId || addListing.isPending}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors shadow-sm whitespace-nowrap"
      >
        {addListing.isPending ? 'Adding…' : 'Add to event'}
      </button>
      {error && <p className="text-xs text-red-600 mt-1 w-full">{error}</p>}
    </div>
  )
}

interface MyListingsSectionProps {
  event: TradeEvent
  username: string
}

function MyListingsSection({ event, username }: MyListingsSectionProps) {
  const { data: listingsData, isLoading } = useEventListings(event.slug, {
    user: username,
    page_size: 100,
  })
  const removeListing = useRemoveEventListing()
  const [removeError, setRemoveError] = useState<string | null>(null)

  const myListings = (listingsData?.results ?? []).filter(
    (l: EventListing) => l.copy_owner_username === username
  )
  const myListingCopyIds = new Set(myListings.map((l) => l.copy_id))

  async function handleRemove(listingId: number) {
    setRemoveError(null)
    try {
      await removeListing.mutateAsync({ slug: event.slug, listingId })
    } catch (err: unknown) {
      const msg = extractErrorMsg(err) ?? 'Failed to remove listing.'
      setRemoveError(msg)
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-4">My Listings in This Event</h3>

      {/* Add form */}
      <div className="mb-4">
        <p className="text-xs text-gray-500 mb-2">Add one of your active copies:</p>
        <AddListingForm slug={event.slug} existingCopyIds={myListingCopyIds} />
      </div>

      {/* Current listings */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-50 rounded animate-pulse" />
          ))}
        </div>
      ) : myListings.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">No copies added yet.</p>
      ) : (
        <div className="space-y-2">
          {removeError && <p className="text-xs text-red-600">{removeError}</p>}
          {myListings.map((listing) => (
            <div
              key={listing.id}
              className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-gray-100">
                  {listing.board_game_thumbnail ? (
                    <img src={listing.board_game_thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-800 truncate block">
                    {listing.board_game_name}
                  </span>
                  <span className="text-xs text-gray-400 font-mono">{listing.listing_code}</span>
                </div>
              </div>
              <button
                onClick={() => handleRemove(listing.id)}
                disabled={removeListing.isPending}
                className="shrink-0 text-xs text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                aria-label="Remove listing"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}


// ---- Deadline row helper ----

function DeadlineRow({ label, isoDate }: { label: string; isoDate: string | null }) {
  if (!isoDate) return null
  const d = new Date(isoDate)
  const formatted = d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const isPast = d < new Date()
  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-xs font-medium ${isPast ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
        {formatted}
      </span>
    </div>
  )
}

// ---- Error message extractor ----

function extractErrorMsg(err: unknown): string | null {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: unknown } }).response
    const data = resp?.data
    if (data && typeof data === 'object') {
      const first = Object.values(data as Record<string, string[]>)[0]
      return Array.isArray(first) ? first[0] : String(first)
    }
  }
  return null
}

// ---- Main page ----

export default function EventDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user, token } = useAuthStore()
  const [editOpen, setEditOpen] = useState(false)

  const { data: event, isLoading, isError } = useEvent(slug)

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-4 animate-pulse">
        <div className="h-8 w-2/3 bg-gray-100 rounded" />
        <div className="h-4 w-1/3 bg-gray-100 rounded" />
        <div className="h-24 bg-gray-100 rounded-xl" />
        <div className="h-48 bg-gray-100 rounded-xl" />
      </div>
    )
  }

  if (isError || !event) {
    return (
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-red-700">Event not found or failed to load.</p>
          <Link to="/events" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
            Back to events
          </Link>
        </div>
      </div>
    )
  }

  const hasAnyDeadlines =
    event.submissions_open_at ||
    event.submissions_close_at ||
    event.wantlist_close_at

  const hasPolicies =
    event.shipping_rules || event.regional_restrictions || event.trade_policies

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-6">
      {editOpen && <EditEventModal event={event} onClose={() => setEditOpen(false)} />}

      {/* Back link */}
      <Link
        to="/events"
        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        All events
      </Link>

      {/* Header card */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-gray-900 leading-tight break-words">{event.name}</h1>
              <StatusBadge status={event.status} />
            </div>
            <p className="text-xs text-gray-400">
              Organized by{' '}
              <Link to={`/u/${event.organizer_username}`} className="text-indigo-500 hover:underline">
                {event.organizer_username}
              </Link>
              {' · '}
              <span>
                {event.participants_count} participant{event.participants_count !== 1 ? 's' : ''}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {event.is_organizer && (
              <button
                onClick={() => setEditOpen(true)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Edit
              </button>
            )}
            <JoinLeaveButton event={event} isAuthenticated={!!token} />
          </div>
        </div>

        {/* Lifecycle progress */}
        <div className="mb-4 pt-2">
          <LifecycleProgress current={event.status} />
        </div>

        {/* Description */}
        {event.description && (
          <p className="text-sm text-gray-600 leading-relaxed mt-4 whitespace-pre-wrap">
            {event.description}
          </p>
        )}
      </div>

      {/* Organizer lifecycle controls */}
      {event.is_organizer && event.allowed_transitions.length > 0 && (
        <OrganizerLifecycleControls event={event} />
      )}

      {/* Organizer matching mode */}
      {event.is_organizer && <MatchingModeCard event={event} />}

      {/* Deadlines + Policies row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Deadlines */}
        {hasAnyDeadlines && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Schedule
            </h3>
            <DeadlineRow label="Submissions open" isoDate={event.submissions_open_at} />
            <DeadlineRow label="Submissions close" isoDate={event.submissions_close_at} />
            <DeadlineRow label="Want list closes" isoDate={event.wantlist_close_at} />
          </div>
        )}

        {/* Policies */}
        {hasPolicies && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Policies
            </h3>
            {event.shipping_rules && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-600 mb-0.5">Shipping rules</p>
                <p className="text-xs text-gray-500 whitespace-pre-wrap">{event.shipping_rules}</p>
              </div>
            )}
            {event.regional_restrictions && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-600 mb-0.5">Regional restrictions</p>
                <p className="text-xs text-gray-500 whitespace-pre-wrap">{event.regional_restrictions}</p>
              </div>
            )}
            {event.trade_policies && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-0.5">Trade policies</p>
                <p className="text-xs text-gray-500 whitespace-pre-wrap">{event.trade_policies}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* My Wants (participant only) — primary; advanced X-to-Y builder secondary */}
      {token && (event.is_participant || event.is_organizer) && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-indigo-800">My Wants</p>
            <p className="text-xs text-indigo-500 mt-0.5">
              For each item you offer, pick the games you'd accept in return.{' '}
              <Link to={`/events/${event.slug}/builder`} className="underline hover:text-indigo-700">
                Advanced X-to-Y builder
              </Link>
            </p>
          </div>
          <Link
            to={`/events/${event.slug}/wants`}
            className="shrink-0 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors shadow-sm"
          >
            Open My Wants
          </Link>
        </div>
      )}

      {/* Money budget (participant only, when money is enabled) */}
      {token && event.money_enabled && event.is_participant && user && (
        <ParticipantBudgetCard event={event} username={user.username} />
      )}

      {/* My listings (participant only) */}
      {token && event.is_participant && user && (
        <MyListingsSection event={event} username={user.username} />
      )}

      {/* Matching section link */}
      {(['MATCHING', 'MATCH_REVIEW', 'FINALIZATION', 'SHIPPING', 'ARCHIVED'] as EventStatus[]).includes(event.status) && (
        <div className="rounded-xl border border-violet-100 bg-violet-50 p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-violet-800">Match Runs</p>
            <p className="text-xs text-violet-500 mt-0.5">
              {event.is_organizer
                ? 'Trigger and review match runs for this event.'
                : 'View your trade assignments and cycle diagrams.'}
            </p>
          </div>
          <Link
            to={`/events/${event.slug}/matches`}
            className="shrink-0 rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 transition-colors shadow-sm"
          >
            {event.is_organizer ? 'Manage Matching' : 'View Results'}
          </Link>
        </div>
      )}

    </div>
  )
}
