import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  useEvent,
  useEvents,
  useEventListings,
  useJoinEvent,
  useLeaveEvent,
  useTransitionEvent,
  usePatchEvent,
  useAddEventListing,
  useRemoveEventListing,
  useEventParticipants,
  useSetEventBudget,
  setListingSellPrice,
  EVENTS_KEYS,
  EVENT_STATUSES,
  EVENT_STATUS_LABELS,
} from '../../api/events'
import type { TradeEvent, EventListing, EventStatus } from '../../api/events'
import { importTrades } from '../../api/trades'
import { useCombos, useCreateCombo, usePatchCombo, useDeleteCombo } from '../../api/combos'
import type { Combo } from '../../api/combos'
import { useCopies } from '../../api/copies'
import type { Copy } from '../../api/copies'
import { useMyRatings, ratingMap } from '../../api/ratings'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useAuthStore } from '../../store/auth'
import BackButton from '../../components/BackButton'
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
                  className={`w-3.5 h-3.5 rounded-full border-2 transition-colors ${
                    isCurrent
                      ? 'bg-coral border-ink'
                      : isPast
                      ? 'bg-sage border-ink/40'
                      : 'bg-cream border-ink/25'
                  }`}
                />
                <span
                  className={`mt-1 text-xs whitespace-nowrap px-0.5 ${
                    isCurrent
                      ? 'text-ink font-bold'
                      : isPast
                      ? 'text-moss font-semibold'
                      : isFuture
                      ? 'text-moss/50'
                      : 'text-moss/50'
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
                    idx < currentIdx ? 'bg-sage' : 'bg-ink/15'
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
        className="rounded-2xl border-2 border-ink/20 bg-cream px-4 py-2 text-sm font-semibold text-moss hover:bg-sage/40 transition-colors"
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

  // Leaving is only allowed before matching begins (server enforces too).
  const lockedStatuses: EventStatus[] = ['MATCHING', 'MATCH_REVIEW', 'FINALIZATION', 'SHIPPING', 'ARCHIVED']
  const canLeave = !lockedStatuses.includes(event.status)

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
            <span className="text-xs text-moss">
              Leave this event? This removes all your copies, want lists, and wishes from it.
            </span>
            <button
              onClick={handleLeave}
              disabled={leave.isPending}
              className="text-xs rounded-xl border-2 border-red-300 px-2.5 py-1 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 transition-colors"
            >
              {leave.isPending ? 'Leaving…' : 'Confirm leave'}
            </button>
            <button
              onClick={() => setConfirmLeave(false)}
              className="text-xs font-medium text-moss hover:text-ink"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-sm text-green-600 font-semibold">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              You're participating
            </span>
            {canLeave && (
              <button
                onClick={() => setConfirmLeave(true)}
                className="rounded-xl border-2 border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
              >
                Leave
              </button>
            )}
          </div>
        )
      ) : canJoin ? (
        <button
          onClick={handleJoin}
          disabled={join.isPending}
          className="rounded-2xl border-2 border-ink bg-butter px-5 py-2 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
        >
          {join.isPending ? 'Joining…' : event.is_organizer ? 'Join as trader' : 'Join event'}
        </button>
      ) : (
        <span className="text-sm text-moss/70">Event not open for joining</span>
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
  const [confirmTo, setConfirmTo] = useState<EventStatus | null>(null)

  if (!event.is_organizer || event.allowed_transitions.length === 0) return null

  async function handleTransition(to: EventStatus) {
    setError(null)
    setPending(to)
    setConfirmTo(null)
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
    <div className="rounded-3xl border-2 border-ink/15 bg-sage/25 p-4">
      {confirmTo && (
        <TransitionConfirmDialog
          from={event.status}
          to={confirmTo}
          isPending={transition.isPending}
          onConfirm={() => handleTransition(confirmTo)}
          onCancel={() => setConfirmTo(null)}
        />
      )}
      <p className="text-xs font-bold text-moss uppercase tracking-wide mb-3">
        Organizer — Advance lifecycle
      </p>
      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {event.allowed_transitions.map((to) => (
          <button
            key={to}
            onClick={() => setConfirmTo(to)}
            disabled={transition.isPending}
            className={`rounded-2xl border-2 px-3 py-1.5 text-xs font-bold transition-transform hover:-translate-y-0.5 disabled:opacity-60 ${
              STATUS_BADGE_CLASSES[to] ?? 'bg-cream border-ink/20 text-moss'
            }`}
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

function TransitionConfirmDialog({
  from,
  to,
  isPending,
  onConfirm,
  onCancel,
}: {
  from: EventStatus
  to: EventStatus
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onCancel} aria-hidden="true" />
      <div className="relative w-full sm:max-w-sm bg-cream border-2 border-ink rounded-3xl shadow-card p-5">
        <h3 className="font-display text-lg font-bold text-ink mb-2">Advance event status?</h3>
        <p className="text-sm text-moss mb-1">
          Move this event from{' '}
          <span className="font-semibold text-ink">{EVENT_STATUS_LABELS[from]}</span> to{' '}
          <span className="font-semibold text-ink">{EVENT_STATUS_LABELS[to]}</span>?
        </p>
        <p className="text-xs text-moss/70 mb-4">
          All participants see the new phase immediately, and it may lock submissions or want lists.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="flex-1 rounded-2xl border-2 border-ink/15 bg-cream px-4 py-2.5 text-sm font-semibold text-moss hover:bg-sage/30 disabled:opacity-60 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 rounded-2xl border-2 border-ink bg-butter px-4 py-2.5 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
          >
            {isPending ? 'Advancing…' : 'Confirm'}
          </button>
        </div>
      </div>
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
      image_url: event.image_url ?? '',
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
  const imageUrl = watch('image_url')

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
          image_url: values.image_url ?? '',
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
    `w-full rounded-xl border-2 bg-parchment px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-2 focus:ring-sage ${
      hasErr ? 'border-red-400' : 'border-ink/15'
    }`

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit event"
    >
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full sm:max-w-xl bg-cream border-2 border-ink rounded-t-3xl sm:rounded-3xl shadow-card max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink/10">
          <h2 className="font-display text-lg font-bold text-ink">Edit Event</h2>
          <button onClick={onClose} className="text-moss hover:text-ink hover:bg-sage/40 p-1.5 rounded-xl transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {serverError && (
            <div className="mb-4 rounded-xl bg-red-50 border-2 border-red-200 px-3 py-2 text-sm font-medium text-red-700">
              {serverError}
            </div>
          )}

          <form id="edit-event-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">
                Event name <span className="text-red-500">*</span>
              </label>
              <input {...register('name')} className={inputCls(!!errors.name)} />
              {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Description</label>
              <textarea {...register('description')} rows={3} className={`${inputCls(false)} resize-none`} />
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

            <div className="space-y-3">
              <p className="text-xs font-bold text-moss uppercase tracking-wide">Dates</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(
                  [
                    ['submissions_open_at', 'Submissions open'],
                    ['submissions_close_at', 'Submissions close'],
                    ['wantlist_close_at', 'Want list closes'],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field}>
                    <label className="block text-xs font-semibold text-moss mb-1">{label}</label>
                    <input type="datetime-local" {...register(field)} className={inputCls(false)} />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-bold text-moss uppercase tracking-wide">Policies</p>
              {(
                [
                  ['shipping_rules', 'Shipping rules'],
                  ['regional_restrictions', 'Regional restrictions'],
                  ['trade_policies', 'Trade policies'],
                ] as const
              ).map(([field, label]) => (
                <div key={field}>
                  <label className="block text-xs font-semibold text-moss mb-1">{label}</label>
                  <textarea {...register(field)} rows={2} className={`${inputCls(false)} resize-none`} />
                </div>
              ))}
            </div>

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
                  <p className="text-xs text-gray-400">
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
            form="edit-event-form"
            disabled={isSubmitting}
            className="flex-1 rounded-2xl border-2 border-ink bg-butter px-4 py-2.5 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
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
    <div className="rounded-3xl border-2 border-ink/15 bg-emerald-50 p-4">
      <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-2">
        Your money budget
      </p>
      <p className="text-xs text-emerald-600 mb-2">
        The most you're willing to spend in this event.
        {cap ? ` Cap: ${cap}.` : ' No cap set.'}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-moss">$</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={effective}
          onChange={(e) => setValue(e.target.value)}
          className="w-32 rounded-xl border-2 border-ink/15 bg-parchment px-2.5 py-1.5 text-sm focus:border-ink focus:outline-none focus:ring-2 focus:ring-emerald-400"
        />
        <button
          onClick={handleSave}
          disabled={setBudget.isPending}
          className="rounded-2xl border-2 border-ink bg-emerald-300 px-3 py-1.5 text-xs font-bold text-emerald-950 shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {setBudget.isPending ? 'Saving…' : 'Save budget'}
        </button>
        {saved && <span className="text-xs font-semibold text-emerald-600">Saved ✓</span>}
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
        className="flex-1 py-2.5 pl-3 pr-8 text-sm border-2 border-ink/15 rounded-xl bg-parchment text-ink focus:outline-none focus:border-ink focus:ring-2 focus:ring-sage"
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
        className="rounded-2xl border-2 border-ink bg-butter px-4 py-2 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 whitespace-nowrap"
      >
        {addListing.isPending ? 'Adding…' : 'Add to event'}
      </button>
      {error && <p className="text-xs text-red-600 mt-1 w-full">{error}</p>}
    </div>
  )
}

function MyListingCard({
  event,
  listing,
  myRating,
  onRemove,
  removePending,
  locked,
}: {
  event: TradeEvent
  listing: EventListing
  myRating?: number
  onRemove: (listingId: number) => void
  removePending: boolean
  locked: boolean
}) {
  const qc = useQueryClient()
  const savedValue = listing.ask_is_override ? (listing.resolved_ask ?? '') : ''
  const [draft, setDraft] = useState(savedValue)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const dirty = draft.trim() !== savedValue

  async function handleSave() {
    setErr(null)
    const trimmed = draft.trim()
    if (trimmed !== '' && Number(trimmed) <= 0) {
      setErr('Price must be greater than $0.')
      return
    }
    setSaving(true)
    try {
      const v = draft.trim()
      const updated = await setListingSellPrice(event.slug, listing.id, v === '' ? null : v)
      setDraft(updated.ask_is_override ? (updated.resolved_ask ?? '') : '')
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.listings(event.slug) })
    } catch (e: unknown) {
      setErr(extractErrorMsg(e) ?? 'Failed to save price.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border-2 border-ink/10 bg-parchment p-3">
      {confirmRemove && (
        <ConfirmDialog
          title="Remove listing?"
          body={
            <>
              This removes <span className="font-semibold text-ink">{listing.board_game_name}</span>{' '}
              (<span className="font-mono">{listing.listing_code}</span>) from the event.
            </>
          }
          confirmLabel={removePending ? 'Removing…' : 'Remove'}
          destructive
          pending={removePending}
          onConfirm={() => {
            onRemove(listing.id)
            setConfirmRemove(false)
          }}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-ink/10 bg-cream">
          {listing.board_game_thumbnail ? (
            <img src={listing.board_game_thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{listing.board_game_name}</span>
          <span className="font-mono text-xs text-moss/70">{listing.listing_code}</span>
        </div>
        {!locked && (
          <button
            onClick={() => setConfirmRemove(true)}
            disabled={removePending}
            className="shrink-0 rounded-xl border-2 border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
            aria-label="Remove listing"
          >
            Remove
          </button>
        )}
      </div>

      {/* Detail chips */}
      <div className="flex flex-wrap gap-1.5 text-xs">
        {listing.copy_condition && (
          <span className="rounded-full border border-ink/15 px-2 py-0.5 text-moss">{listing.copy_condition}</span>
        )}
        {listing.copy_language && (
          <span className="rounded-full border border-ink/15 px-2 py-0.5 text-moss">{listing.copy_language}</span>
        )}
        <span className="rounded-full border border-ink/15 px-2 py-0.5 text-moss">
          Rating {myRating != null ? myRating : '—'}
        </span>
      </div>

      {/* Minimum ask + Save (money only) */}
      {event.money_enabled && (
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-moss/60">Min. ask</label>
            <div className="flex items-center gap-1">
              <span className="text-xs text-moss/60">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  listing.resolved_ask && !listing.ask_is_override
                    ? `default ${listing.resolved_ask}`
                    : 'price'
                }
                className="no-spinner w-20 rounded-lg border-2 border-ink/15 bg-cream px-2 py-1 text-xs text-ink placeholder-moss/40 focus:outline-none focus:ring-2 focus:ring-sage"
              />
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="rounded-lg border-2 border-ink bg-butter px-3 py-1 text-xs font-bold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
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
  const { data: ratings = [] } = useMyRatings()
  const myRatings = ratingMap(ratings)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const myListings = (listingsData?.results ?? []).filter(
    (l: EventListing) => l.copy_owner_username === username
  )
  const myListingCopyIds = new Set(myListings.map((l) => l.copy_id))
  const locked = event.submissions_locked

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
    <section className="rounded-3xl border-2 border-ink bg-cream p-5 shadow-card">
      <h3 className="font-display text-base font-bold text-ink mb-4">My Listings in This Event</h3>

      {event.money_enabled && (
        <p className="mb-3 rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The <strong>Min. ask</strong> is the lowest price you're willing to sell each game for, 
          you won't be matched below it. Leave it blank to not put it up for sale.
        </p>
      )}

      {/* Add form */}
      {locked ? (
        <p className="mb-4 rounded-xl border-2 border-ink/10 bg-parchment px-3 py-2 text-xs text-moss">
          Listings are locked — want-lists have opened, so copies can no longer be added or removed.
        </p>
      ) : (
        <div className="mb-4">
          <p className="text-xs text-moss mb-2">Add one of your active copies:</p>
          <AddListingForm slug={event.slug} existingCopyIds={myListingCopyIds} />
        </div>
      )}

      {/* Current listings */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl border-2 border-ink/10 bg-parchment animate-pulse" />
          ))}
        </div>
      ) : myListings.length === 0 ? (
        <p className="text-xs text-moss py-2">No copies added yet.</p>
      ) : (
        <div className="space-y-2">
          {removeError && <p className="text-xs text-red-600">{removeError}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {myListings.map((listing) => (
              <MyListingCard
                key={listing.id}
                event={event}
                listing={listing}
                myRating={myRatings.get(listing.board_game_id)}
                onRemove={handleRemove}
                removePending={removeListing.isPending}
                locked={locked}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}


// ---- My Combos section ----

interface MyCombosSectionProps {
  event: TradeEvent
  username: string
}

function MyCombosSection({ event, username }: MyCombosSectionProps) {
  const { data: listingsData } = useEventListings(event.slug, {
    user: username,
    page_size: 100,
  })
  const { data: combosData, isLoading } = useCombos(event.slug, { mine: true })
  const deleteCombo = useDeleteCombo()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Combo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const myListings = (listingsData?.results ?? []).filter(
    (l: EventListing) => l.copy_owner_username === username
  )
  const combos = combosData?.results ?? []
  const locked = event.submissions_locked

  const usedListingIds = new Set<number>()
  for (const c of combos) for (const it of c.items) usedListingIds.add(it.event_listing)

  async function handleDelete(id: number) {
    setError(null)
    try {
      await deleteCombo.mutateAsync({ slug: event.slug, id })
    } catch (err: unknown) {
      setError(extractErrorMsg(err) ?? 'Failed to delete combo.')
    }
  }

  return (
    <section className="rounded-3xl border-2 border-ink bg-cream p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-ink">My Combos in This Event</h3>
        {!locked && !showForm && !editing && myListings.length >= 2 && (
          <button
            onClick={() => { setEditing(null); setShowForm(true) }}
            className="rounded-full border-2 border-ink bg-butter px-3 py-1 text-xs font-semibold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5"
          >
            + New combo
          </button>
        )}
      </div>

      <p className="mb-3 text-xs text-moss/80">
        Bundle two or more of your listings to trade together (e.g. a base game + its
        expansion). Each listing can be in at most one combo.
      </p>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {(showForm || editing) && !locked && (
        <ComboForm
          key={editing?.id ?? 'new'}
          slug={event.slug}
          moneyEnabled={event.money_enabled}
          myListings={myListings}
          usedListingIds={usedListingIds}
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}

      {isLoading ? (
        <p className="py-2 text-xs text-moss">Loading…</p>
      ) : combos.length === 0 ? (
        <p className="py-2 text-xs text-moss">No combos yet.</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {combos.map((c) => (
            <ComboCard
              key={c.id}
              combo={c}
              locked={locked}
              onEdit={() => { setEditing(c); setShowForm(false) }}
              onDelete={() => handleDelete(c.id)}
              deletePending={deleteCombo.isPending}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ComboCard({ combo, locked, onEdit, onDelete, deletePending }: {
  combo: Combo
  locked: boolean
  onEdit: () => void
  onDelete: () => void
  deletePending: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="rounded-2xl border-2 border-ink/15 bg-parchment p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">{combo.name}</span>
          <span className="font-mono text-xs text-moss/70">{combo.combo_code}</span>
        </div>
        {!locked && (
          <div className="flex shrink-0 gap-1">
            <button
              onClick={onEdit}
              aria-label={`Edit combo ${combo.name}`}
              className="rounded-full border border-ink/20 px-2 py-0.5 text-xs text-moss"
            >
              Edit
            </button>
            <button
              onClick={() => setConfirming(true)}
              aria-label={`Remove combo ${combo.name}`}
              className="rounded-full border border-red-300 px-2 py-0.5 text-xs text-red-600"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {combo.items.map((it) => (
          <span
            key={it.id}
            className="flex items-center gap-1 rounded-full border border-ink/15 bg-cream px-2 py-0.5 text-xs text-moss"
          >
            {it.board_game_thumbnail && (
              <img src={it.board_game_thumbnail} alt="" className="h-8 w-8 rounded object-cover" loading="lazy" />
            )}
            <span className="max-w-[8rem] truncate">{it.board_game_name}</span>
          </span>
        ))}
      </div>

      <p className="mt-2 text-xs text-moss/80">
        {combo.sell_price ? `Bundle price $${combo.sell_price}` : 'Barter only'}
      </p>

      {confirming && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-2 py-1.5">
          <span className="text-xs text-red-700">Remove this combo?</span>
          <button
            onClick={onDelete}
            disabled={deletePending}
            className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-cream disabled:opacity-50"
          >
            {deletePending ? '…' : 'Confirm'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-full border border-ink/20 px-2 py-0.5 text-xs text-moss"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function ComboForm({ slug, moneyEnabled, myListings, usedListingIds, editing, onClose }: {
  slug: string
  moneyEnabled: boolean
  myListings: EventListing[]
  usedListingIds: Set<number>
  editing: Combo | null
  onClose: () => void
}) {
  const createCombo = useCreateCombo()
  const patchCombo = usePatchCombo()
  const editingMemberIds = new Set<number>(
    editing ? editing.items.map((it) => it.event_listing) : []
  )
  const [name, setName] = useState(editing?.name ?? '')
  const [sellPrice, setSellPrice] = useState(editing?.sell_price ?? '')
  const [selected, setSelected] = useState<Set<number>>(new Set(editingMemberIds))
  const [error, setError] = useState<string | null>(null)
  const saving = createCombo.isPending || patchCombo.isPending

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSave() {
    setError(null)
    if (selected.size < 2) {
      setError('Pick at least 2 listings.')
      return
    }
    const payload = {
      name: name.trim(),
      item_listing_ids: Array.from(selected),
      sell_price: moneyEnabled && sellPrice.trim() ? sellPrice.trim() : null,
    }
    try {
      if (editing) await patchCombo.mutateAsync({ slug, id: editing.id, payload })
      else await createCombo.mutateAsync({ slug, payload })
      onClose()
    } catch (err: unknown) {
      setError(extractErrorMsg(err) ?? 'Failed to save combo.')
    }
  }

  return (
    <div className="mb-3 rounded-2xl border-2 border-ink/15 bg-parchment p-3">
      <p className="mb-2 text-xs font-semibold text-ink">{editing ? 'Edit combo' : 'New combo'}</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Combo name (e.g. Wingspan + Europe)"
        className="mb-2 w-full rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-sm"
      />
      {moneyEnabled && (
        <input
          value={sellPrice ?? ''}
          onChange={(e) => setSellPrice(e.target.value)}
          placeholder="Bundle price (optional)"
          inputMode="decimal"
          className="mb-2 w-full rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-sm"
        />
      )}
      <p className="mb-1 text-xs text-moss">
        Pick at least 2 of your listings ({selected.size} selected):
      </p>
      <div className="mb-2 max-h-48 space-y-1 overflow-y-auto">
        {myListings.map((l) => {
          const inOtherCombo = usedListingIds.has(l.id) && !editingMemberIds.has(l.id)
          return (
            <label
              key={l.id}
              className={`flex items-center gap-2 rounded-xl border px-2 py-1 text-xs ${
                inOtherCombo ? 'cursor-not-allowed border-ink/10 opacity-40' : 'cursor-pointer border-ink/15'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(l.id)}
                disabled={inOtherCombo}
                onChange={() => toggle(l.id)}
              />
              {l.board_game_thumbnail && (
                <img src={l.board_game_thumbnail} alt="" className="h-8 w-8 rounded object-cover" loading="lazy" />
              )}
              <span className="truncate">{l.board_game_name}</span>
              <span className="ml-auto font-mono text-moss/60">{l.listing_code}</span>
            </label>
          )
        })}
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || selected.size < 2 || name.trim() === ''}
          className="rounded-full border-2 border-ink bg-butter px-3 py-1 text-xs font-semibold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
        >
          {saving ? 'Saving…' : editing ? 'Save' : 'Create combo'}
        </button>
        <button
          onClick={onClose}
          className="rounded-full border-2 border-ink/20 px-3 py-1 text-xs text-moss"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---- Import from a previous event ----

function ImportTradesSection({ event }: { event: TradeEvent; username: string }) {
  const qc = useQueryClient()
  const { data: eventsData } = useEvents({})
  const [fromSlug, setFromSlug] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (event.inputs_locked) return null

  const others = (eventsData?.results ?? []).filter(
    (e) => e.is_participant && e.slug !== event.slug
  )
  if (others.length === 0) return null

  async function handleImport() {
    if (!fromSlug) return
    setBusy(true); setMsg(null); setErr(null)
    try {
      const s = await importTrades(event.slug, fromSlug)
      setMsg(`Imported ${s.prices} price${s.prices !== 1 ? 's' : ''} and ${s.want_groups} want group${s.want_groups !== 1 ? 's' : ''}.`)
      qc.invalidateQueries({ queryKey: ['trades', 'want-groups', event.slug] })
      qc.invalidateQueries({ queryKey: ['trades', 'game-prices', event.slug] })
    } catch (e: unknown) {
      setErr(extractErrorMsg(e) ?? 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-3xl border-2 border-ink bg-cream p-5 shadow-card">
      <h3 className="font-display text-base font-bold text-ink mb-2">Import from a previous event</h3>
      <p className="mb-3 text-xs text-moss/80">
        Copy your per-game prices and your wants (matched by game) from another
        event you joined. Best-effort — copies that are gone are skipped.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={fromSlug}
          onChange={(e) => setFromSlug(e.target.value)}
          className="rounded-xl border-2 border-ink/15 bg-parchment px-3 py-1.5 text-sm"
        >
          <option value="">Choose an event…</option>
          {others.map((e) => (
            <option key={e.slug} value={e.slug}>{e.name}</option>
          ))}
        </select>
        <button
          onClick={handleImport}
          disabled={!fromSlug || busy}
          className="rounded-full border-2 border-ink bg-butter px-3 py-1.5 text-xs font-semibold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-green-700">{msg}</p>}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
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
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-ink/5 last:border-0">
      <span className="text-xs text-moss">{label}</span>
      <span className={`text-xs font-semibold ${isPast ? 'text-moss/50 line-through' : 'text-ink'}`}>
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
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-4 animate-pulse">
        <div className="h-8 w-2/3 bg-gray-200 rounded-full" />
        <div className="h-4 w-1/3 bg-gray-200 rounded-full" />
        <div className="h-24 bg-gray-200 rounded-3xl" />
        <div className="h-48 bg-gray-200 rounded-3xl" />
      </div>
    )
  }

  if (isError || !event) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="rounded-3xl border-2 border-red-200 bg-red-50 px-5 py-8 text-center">
          <p className="text-sm font-semibold text-red-700">Event not found or failed to load.</p>
          <BackButton to="/events" className="mt-3">Back to events</BackButton>
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
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-6">
      {editOpen && <EditEventModal event={event} onClose={() => setEditOpen(false)} />}

      {/* Back link */}
      <BackButton to="/events">All events</BackButton>

      {/* Header card */}
      <div className="rounded-3xl border-2 border-ink bg-cream p-5 sm:p-6 shadow-card">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-ink leading-tight break-words">{event.name}</h1>
              <StatusBadge status={event.status} />
            </div>
            <p className="text-xs text-moss">
              Organized by{' '}
              <Link to={`/u/${event.organizer_username}`} className="font-semibold text-ink hover:underline">
                {event.organizer_username}
              </Link>
              {' · '}
              <span>
                {event.participants_count} participant{event.participants_count !== 1 ? 's' : ''}
              </span>
            </p>
            {/* Key trade settings — surfaced so every member is aware */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                {event.money_enabled
                  ? `💵 Money trades${event.max_money_per_user ? ` · cap $${event.max_money_per_user}` : ''}`
                  : '🔄 Items-only (no money)'}
              </span>
              {event.require_location && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200">
                  📍 Location required
                  {event.max_distance_km ? ` · within ${event.max_distance_km} km` : ''}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {event.is_organizer && (
              <Link
                to={`/events/${event.slug}/manage`}
                className="rounded-2xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-xs font-semibold text-moss hover:bg-sage/30 transition-colors"
              >
                Manage
              </Link>
            )}
            {event.is_organizer && (
              <button
                onClick={() => setEditOpen(true)}
                className="rounded-2xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-xs font-semibold text-moss hover:bg-sage/30 transition-colors"
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
          <p className="text-sm text-moss leading-relaxed mt-4 whitespace-pre-wrap">
            {event.description}
          </p>
        )}
      </div>

      {/* Organizer lifecycle controls */}
      {event.is_organizer && event.allowed_transitions.length > 0 && (
        <OrganizerLifecycleControls event={event} />
      )}

      {/* Deadlines + Policies row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Deadlines */}
        {hasAnyDeadlines && (
          <div className="rounded-3xl border-2 border-ink/15 bg-cream p-4">
            <h3 className="text-xs font-bold text-moss uppercase tracking-wide mb-3">
              Schedule
            </h3>
            <DeadlineRow label="Submissions open" isoDate={event.submissions_open_at} />
            <DeadlineRow label="Submissions close" isoDate={event.submissions_close_at} />
            <DeadlineRow label="Want list closes" isoDate={event.wantlist_close_at} />
          </div>
        )}

        {/* Policies */}
        {hasPolicies && (
          <div className="rounded-3xl border-2 border-ink/15 bg-cream p-4">
            <h3 className="text-xs font-bold text-moss uppercase tracking-wide mb-3">
              Policies
            </h3>
            {event.shipping_rules && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-ink mb-0.5">Shipping rules</p>
                <p className="text-xs text-moss whitespace-pre-wrap">{event.shipping_rules}</p>
              </div>
            )}
            {event.regional_restrictions && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-ink mb-0.5">Regional restrictions</p>
                <p className="text-xs text-moss whitespace-pre-wrap">{event.regional_restrictions}</p>
              </div>
            )}
            {event.trade_policies && (
              <div>
                <p className="text-xs font-semibold text-ink mb-0.5">Trade policies</p>
                <p className="text-xs text-moss whitespace-pre-wrap">{event.trade_policies}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* My Wants (participant only) — primary; advanced X-to-Y builder secondary */}
      {token && (event.is_participant || event.is_organizer) && (
        <div className="rounded-3xl border-2 border-ink/15 bg-sage/30 p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-ink">My Wants</p>
            <p className="text-xs text-moss mt-0.5">
              For each item you offer, pick the games you'd accept in return.{/*
              <Link to={`/events/${event.slug}/builder`} className="font-semibold underline decoration-coral decoration-2 underline-offset-2 hover:text-ink">
                Advanced X-to-Y builder
              </Link>
              */}
            </p>
          </div>
          <Link
            to={`/events/${event.slug}/wants`}
            className="shrink-0 rounded-2xl border-2 border-ink bg-butter px-4 py-2 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0"
          >
            Open My Wants
          </Link>
        </div>
      )}


      {/* Matching section link */}
      {(['MATCHING', 'MATCH_REVIEW', 'FINALIZATION', 'SHIPPING', 'ARCHIVED'] as EventStatus[]).includes(event.status) && (
        <div className="rounded-3xl border-2 border-ink/15 bg-violet-100/60 p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-violet-900">Match Runs</p>
            <p className="text-xs text-violet-600 mt-0.5">
              {event.is_organizer
                ? 'Trigger and review match runs for this event.'
                : 'View your trade assignments and cycle diagrams.'}
            </p>
          </div>
          <Link
            to={`/events/${event.slug}/matches`}
            className="shrink-0 rounded-2xl border-2 border-ink bg-violet-300 px-4 py-2 text-sm font-bold text-violet-950 shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0"
          >
            {event.is_organizer ? 'Manage Matching' : 'View Results'}
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
      {token && event.is_participant && user && (
        <MyCombosSection event={event} username={user.username} />
      )}
      {token && event.is_participant && user && (
        <ImportTradesSection event={event} username={user.username} />
      )}


    </div>
  )
}
