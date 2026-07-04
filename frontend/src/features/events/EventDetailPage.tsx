import { useState, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useModalDismiss } from '../../hooks/useModalDismiss'
import { toast } from '../../store/toast'
import type { TFunction } from 'i18next'
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
  eventStatusLabel,
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
  const { t } = useTranslation()
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
                  {eventStatusLabel(t, status)}
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
  const { t } = useTranslation()
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
        {t('events.loginToJoin')}
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
      const msg = extractErrorMsg(err) ?? t('events.joinFailed')
      setError(msg)
    }
  }

  async function handleLeave() {
    setError(null)
    try {
      await leave.mutateAsync(event.slug)
      setConfirmLeave(false)
    } catch (err: unknown) {
      const msg = extractErrorMsg(err) ?? t('events.leaveFailed')
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
              {t('events.leaveConfirmText')}
            </span>
            <button
              onClick={handleLeave}
              disabled={leave.isPending}
              className="text-xs rounded-xl border-2 border-red-300 px-2.5 py-1 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 transition-colors"
            >
              {leave.isPending ? t('events.leaving') : t('events.confirmLeave')}
            </button>
            <button
              onClick={() => setConfirmLeave(false)}
              className="text-xs font-medium text-moss hover:text-ink"
            >
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-sm text-green-600 font-semibold">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {t('events.participating')}
            </span>
            {canLeave && (
              <button
                onClick={() => setConfirmLeave(true)}
                className="rounded-xl border-2 border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
              >
                {t('events.leave')}
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
          {join.isPending ? t('events.joining') : event.is_organizer ? t('events.joinAsTrader') : t('events.joinEvent')}
        </button>
      ) : (
        <span className="text-sm text-moss/70">{t('events.notOpenForJoining')}</span>
      )}
    </div>
  )
}

// ---- Organizer: lifecycle transition controls ----

/** Human-readable, translated label for the button that advances an event to a given status. */
function transitionLabel(t: TFunction, status: EventStatus): string {
  return t(`events.transition.${status}`, { defaultValue: eventStatusLabel(t, status) })
}

function OrganizerLifecycleControls({ event }: { event: TradeEvent }) {
  const { t } = useTranslation()
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
      const msg = extractErrorMsg(err) ?? t('events.transitionFailed', { status: eventStatusLabel(t, to) })
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
        {t('events.organizerAdvanceLifecycle')}
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
              ? t('events.advancing')
              : t('events.advanceTo', { label: transitionLabel(t, to) })}
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
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  useModalDismiss(panelRef, onCancel)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onCancel} aria-hidden="true" />
      <div ref={panelRef} tabIndex={-1} className="relative w-full sm:max-w-sm bg-cream border-2 border-ink rounded-3xl shadow-card p-5 focus:outline-none">
        <h3 className="font-display text-lg font-bold text-ink mb-2">{t('events.transitionConfirm.title')}</h3>
        <p className="text-sm text-moss mb-1">
          {t('events.transitionConfirm.moveFromPrefix')}{' '}
          <span className="font-semibold text-ink">{eventStatusLabel(t, from)}</span>{' '}
          {t('events.transitionConfirm.toConnector')}{' '}
          <span className="font-semibold text-ink">{eventStatusLabel(t, to)}</span>?
        </p>
        <p className="text-xs text-moss/70 mb-4">
          {t('events.transitionConfirm.warning')}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="flex-1 rounded-2xl border-2 border-ink/15 bg-cream px-4 py-2.5 text-sm font-semibold text-moss hover:bg-sage/30 disabled:opacity-60 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 rounded-2xl border-2 border-ink bg-butter px-4 py-2.5 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
          >
            {isPending ? t('events.advancing') : t('events.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Organizer: edit event form ----

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
  const { t } = useTranslation()
  const patchEvent = usePatchEvent()
  const [serverError, setServerError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useModalDismiss(panelRef, onClose)

  const editEventSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(3, t('events.errors.nameMin')).max(200),
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
      }),
    [t]
  )

  type EditEventFormValues = z.infer<typeof editEventSchema>

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
      toast.success(t('common.toast.saved'))
      onClose()
    } catch (err: unknown) {
      const msg = extractErrorMsg(err) ?? t('events.saveFailed')
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
      aria-label={t('events.editModal.ariaLabel')}
    >
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} tabIndex={-1} className="relative w-full sm:max-w-xl bg-cream border-2 border-ink rounded-t-3xl sm:rounded-3xl shadow-card max-h-[92vh] flex flex-col focus:outline-none">
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink/10">
          <h2 className="font-display text-lg font-bold text-ink">{t('events.editModal.title')}</h2>
          <button onClick={onClose} className="text-moss hover:text-ink hover:bg-sage/40 p-1.5 rounded-xl transition-colors" aria-label={t('events.close')}>
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
                {t('events.form.name')} <span className="text-red-500">*</span>
              </label>
              <input {...register('name')} className={inputCls(!!errors.name)} />
              {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-semibold text-ink mb-1">{t('events.form.description')}</label>
              <textarea {...register('description')} rows={3} className={`${inputCls(false)} resize-none`} />
            </div>

            {/* Cover image URL */}
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">{t('events.form.imageUrl')}</label>
              <input
                {...register('image_url')}
                placeholder={t('events.form.imageUrlPlaceholder')}
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
              <p className="text-xs font-bold text-moss uppercase tracking-wide">{t('events.form.dates')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(
                  [
                    ['submissions_open_at', t('events.form.submissionsOpen')],
                    ['submissions_close_at', t('events.form.submissionsClose')],
                    ['wantlist_close_at', t('events.form.wantlistCloses')],
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
              <p className="text-xs font-bold text-moss uppercase tracking-wide">{t('events.form.policies')}</p>
              {(
                [
                  ['shipping_rules', t('events.form.shippingRules')],
                  ['regional_restrictions', t('events.form.regionalRestrictions')],
                  ['trade_policies', t('events.form.tradePolicies')],
                ] as const
              ).map(([field, label]) => (
                <div key={field}>
                  <label className="block text-xs font-semibold text-moss mb-1">{label}</label>
                  <textarea {...register(field)} rows={2} className={`${inputCls(false)} resize-none`} />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-bold text-moss uppercase tracking-wide">{t('events.form.moneyTrading')}</p>
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  {...register('money_enabled')}
                  className="h-4 w-4 rounded border-2 border-ink/30 accent-indigo-600 focus:ring-sage"
                />
                {t('events.form.allowMoney')}
              </label>
              {moneyEnabled && (
                <div>
                  <label className="block text-xs font-semibold text-moss mb-1">
                    {t('events.form.maxMoneyLabel')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={t('events.form.maxMoneyPlaceholder')}
                    {...register('max_money_per_user')}
                    className={`${inputCls(false)} sm:max-w-[12rem]`}
                  />
                </div>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-bold text-moss uppercase tracking-wide">{t('events.form.locationGate')}</p>
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  {...register('require_location')}
                  className="h-4 w-4 rounded border-2 border-ink/30 accent-indigo-600 focus:ring-sage"
                />
                {t('events.form.requireLocation')}
              </label>
              {requireLocation && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400">
                    {t('events.form.radiusHint')}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-moss mb-1">{t('events.form.centerLatitude')}</label>
                      <input
                        type="number"
                        step="any"
                        placeholder={t('events.form.centerLatitudePlaceholder')}
                        {...register('center_latitude')}
                        className={inputCls(false)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-moss mb-1">{t('events.form.centerLongitude')}</label>
                      <input
                        type="number"
                        step="any"
                        placeholder={t('events.form.centerLongitudePlaceholder')}
                        {...register('center_longitude')}
                        className={inputCls(false)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-moss mb-1">
                      {t('events.form.maxDistance')}
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      placeholder={t('events.form.maxDistancePlaceholder')}
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
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="edit-event-form"
            disabled={isSubmitting}
            className="flex-1 rounded-2xl border-2 border-ink bg-butter px-4 py-2.5 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
          >
            {isSubmitting ? t('events.saving') : t('events.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Participant money budget ----

function ParticipantBudgetCard({ event, username }: { event: TradeEvent; username: string }) {
  const { t } = useTranslation()
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
      setError(extractErrorMsg(err) ?? t('events.budget.saveFailed'))
    }
  }

  const cap = event.max_money_per_user
  return (
    <div className="rounded-3xl border-2 border-ink/15 bg-emerald-50 p-4">
      <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-2">
        {t('events.budget.title')}
      </p>
      <p className="text-xs text-emerald-600 mb-2">
        {t('events.budget.description')}
        {cap ? t('events.budget.cap', { cap }) : t('events.budget.noCap')}
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
          {setBudget.isPending ? t('events.saving') : t('events.budget.save')}
        </button>
        {saved && <span className="text-xs font-semibold text-emerald-600">{t('events.budget.saved')}</span>}
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
  const { t } = useTranslation()
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
      const msg = extractErrorMsg(err) ?? t('events.listings.addFailed')
      setError(msg)
    }
  }

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <select
        value={selectedCopyId}
        onChange={(e) => setSelectedCopyId(e.target.value)}
        className="flex-1 py-2.5 pl-3 pr-8 text-sm border-2 border-ink/15 rounded-xl bg-parchment text-ink focus:outline-none focus:border-ink focus:ring-2 focus:ring-sage"
        aria-label={t('events.listings.selectAriaLabel')}
      >
        <option value="">{t('events.listings.selectPlaceholder')}</option>
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
        {addListing.isPending ? t('events.listings.adding') : t('events.listings.addToEvent')}
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
  const { t } = useTranslation()
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
      setErr(t('events.listings.priceMustBePositive'))
      return
    }
    setSaving(true)
    try {
      const v = draft.trim()
      const updated = await setListingSellPrice(event.slug, listing.id, v === '' ? null : v)
      setDraft(updated.ask_is_override ? (updated.resolved_ask ?? '') : '')
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.listings(event.slug) })
    } catch (e: unknown) {
      setErr(extractErrorMsg(e) ?? t('events.listings.savePriceFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border-2 border-ink/10 bg-parchment p-3">
      {confirmRemove && (
        <ConfirmDialog
          title={t('events.listings.removeTitle')}
          body={
            <>
              {t('events.listings.removePrefix')} <span className="font-semibold text-ink">{listing.board_game_name}</span>{' '}
              (<span className="font-mono">{listing.listing_code}</span>) {t('events.listings.removeSuffix')}
            </>
          }
          confirmLabel={removePending ? t('events.removing') : t('events.remove')}
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
            aria-label={t('events.listings.removeAriaLabel')}
          >
            {t('events.remove')}
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
          {t('events.listings.rating', { rating: myRating != null ? myRating : '—' })}
        </span>
      </div>

      {/* Minimum ask + Save (money only) */}
      {event.money_enabled && (
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-moss/60">{t('events.listings.minAsk')}</label>
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
                    ? t('events.listings.defaultAsk', { ask: listing.resolved_ask })
                    : t('events.listings.pricePlaceholder')
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
            {saving ? t('events.saving') : t('common.save')}
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
  const { t } = useTranslation()
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
      const msg = extractErrorMsg(err) ?? t('events.listings.removeFailed')
      setRemoveError(msg)
    }
  }

  return (
    <section className="rounded-3xl border-2 border-ink bg-cream p-5 shadow-card">
      <h3 className="font-display text-base font-bold text-ink mb-4">{t('events.listings.sectionTitle')}</h3>

      {event.money_enabled && (
        <p className="mb-3 rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('events.listings.minAskHintPrefix')} <strong>{t('events.listings.minAsk')}</strong>{' '}
          {t('events.listings.minAskHintSuffix')}
        </p>
      )}

      {/* Add form */}
      {locked ? (
        <p className="mb-4 rounded-xl border-2 border-ink/10 bg-parchment px-3 py-2 text-xs text-moss">
          {t('events.listings.locked')}
        </p>
      ) : (
        <div className="mb-4">
          <p className="text-xs text-moss mb-2">{t('events.listings.addHint')}</p>
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
        <p className="text-xs text-moss py-2">{t('events.listings.empty')}</p>
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
  const { t } = useTranslation()
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
      setError(extractErrorMsg(err) ?? t('events.combos.deleteFailed'))
    }
  }

  return (
    <section className="rounded-3xl border-2 border-ink bg-cream p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-ink">{t('events.combos.sectionTitle')}</h3>
        {!locked && !showForm && !editing && myListings.length >= 2 && (
          <button
            onClick={() => { setEditing(null); setShowForm(true) }}
            className="rounded-full border-2 border-ink bg-butter px-3 py-1 text-xs font-semibold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5"
          >
            {t('events.combos.newComboButton')}
          </button>
        )}
      </div>

      <p className="mb-3 text-xs text-moss/80">
        {t('events.combos.description')}
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
        <p className="py-2 text-xs text-moss">{t('common.loading')}</p>
      ) : combos.length === 0 ? (
        <p className="py-2 text-xs text-moss">{t('events.combos.empty')}</p>
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
  const { t } = useTranslation()
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
              aria-label={t('events.combos.editAriaLabel', { name: combo.name })}
              className="rounded-full border border-ink/20 px-2 py-0.5 text-xs text-moss"
            >
              {t('events.edit')}
            </button>
            <button
              onClick={() => setConfirming(true)}
              aria-label={t('events.combos.removeAriaLabel', { name: combo.name })}
              className="rounded-full border border-red-300 px-2 py-0.5 text-xs text-red-600"
            >
              {t('events.remove')}
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
        {combo.sell_price ? t('events.combos.bundlePrice', { price: combo.sell_price }) : t('events.combos.barterOnly')}
      </p>

      {confirming && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-2 py-1.5">
          <span className="text-xs text-red-700">{t('events.combos.removeConfirm')}</span>
          <button
            onClick={onDelete}
            disabled={deletePending}
            className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-cream disabled:opacity-50"
          >
            {deletePending ? '…' : t('events.confirm')}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-full border border-ink/20 px-2 py-0.5 text-xs text-moss"
          >
            {t('common.cancel')}
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
  const { t } = useTranslation()
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
      setError(t('events.combos.errors.pickAtLeastTwo'))
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
      setError(extractErrorMsg(err) ?? t('events.combos.saveFailed'))
    }
  }

  return (
    <div className="mb-3 rounded-2xl border-2 border-ink/15 bg-parchment p-3">
      <p className="mb-2 text-xs font-semibold text-ink">{editing ? t('events.combos.editComboTitle') : t('events.combos.newComboTitle')}</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('events.combos.namePlaceholder')}
        className="mb-2 w-full rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-sm"
      />
      {moneyEnabled && (
        <input
          value={sellPrice ?? ''}
          onChange={(e) => setSellPrice(e.target.value)}
          placeholder={t('events.combos.bundlePricePlaceholder')}
          inputMode="decimal"
          className="mb-2 w-full rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-sm"
        />
      )}
      <p className="mb-1 text-xs text-moss">
        {t('events.combos.pickHint', { count: selected.size })}
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
          {saving ? t('events.saving') : editing ? t('common.save') : t('events.combos.create')}
        </button>
        <button
          onClick={onClose}
          className="rounded-full border-2 border-ink/20 px-3 py-1 text-xs text-moss"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}

// ---- Import from a previous event ----

function ImportTradesSection({ event }: { event: TradeEvent; username: string }) {
  const { t } = useTranslation()
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
      setMsg(
        t('events.import.success', {
          pricesPhrase: t('events.import.pricesCount', { count: s.prices }),
          wantGroupsPhrase: t('events.import.wantGroupsCount', { count: s.want_groups }),
        })
      )
      qc.invalidateQueries({ queryKey: ['trades', 'want-groups', event.slug] })
      qc.invalidateQueries({ queryKey: ['trades', 'game-prices', event.slug] })
    } catch (e: unknown) {
      setErr(extractErrorMsg(e) ?? t('events.import.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-3xl border-2 border-ink bg-cream p-5 shadow-card">
      <h3 className="font-display text-base font-bold text-ink mb-2">{t('events.import.title')}</h3>
      <p className="mb-3 text-xs text-moss/80">
        {t('events.import.description')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={fromSlug}
          onChange={(e) => setFromSlug(e.target.value)}
          className="rounded-xl border-2 border-ink/15 bg-parchment px-3 py-1.5 text-sm"
        >
          <option value="">{t('events.import.choosePlaceholder')}</option>
          {others.map((e) => (
            <option key={e.slug} value={e.slug}>{e.name}</option>
          ))}
        </select>
        <button
          onClick={handleImport}
          disabled={!fromSlug || busy}
          className="rounded-full border-2 border-ink bg-butter px-3 py-1.5 text-xs font-semibold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
        >
          {busy ? t('events.import.importing') : t('events.import.button')}
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
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const { user, token } = useAuthStore()
  const [editOpen, setEditOpen] = useState(false)

  const { data: event, isLoading, isError } = useEvent(slug)
  usePageTitle(event?.name)

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
          <p className="text-sm font-semibold text-red-700">{t('events.notFoundError')}</p>
          <BackButton to="/events" className="mt-3">{t('events.backToEvents')}</BackButton>
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
      <BackButton to="/events">{t('events.allEvents')}</BackButton>

      {/* Header card */}
      <div className="rounded-3xl border-2 border-ink bg-cream p-5 sm:p-6 shadow-card">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-ink leading-tight break-words">{event.name}</h1>
              <StatusBadge status={event.status} />
            </div>
            <p className="text-xs text-moss">
              {t('events.organizedBy')}{' '}
              <Link to={`/u/${event.organizer_username}`} className="font-semibold text-ink hover:underline">
                {event.organizer_username}
              </Link>
              {' · '}
              <span>
                {t('events.participantsCount', { count: event.participants_count })}
              </span>
            </p>
            {/* Key trade settings — surfaced so every member is aware */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                {event.money_enabled
                  ? t('events.moneyTradesBadge') + (event.max_money_per_user ? t('events.moneyTradesCap', { cap: event.max_money_per_user }) : '')
                  : t('events.itemsOnlyBadge')}
              </span>
              {event.require_location && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200">
                  {t('events.locationRequiredBadge')}
                  {event.max_distance_km ? t('events.locationWithinKm', { km: event.max_distance_km }) : ''}
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
                {t('events.manage')}
              </Link>
            )}
            {event.is_organizer && (
              <button
                onClick={() => setEditOpen(true)}
                className="rounded-2xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-xs font-semibold text-moss hover:bg-sage/30 transition-colors"
              >
                {t('events.edit')}
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
              {t('events.schedule')}
            </h3>
            <DeadlineRow label={t('events.form.submissionsOpen')} isoDate={event.submissions_open_at} />
            <DeadlineRow label={t('events.form.submissionsClose')} isoDate={event.submissions_close_at} />
            <DeadlineRow label={t('events.form.wantlistCloses')} isoDate={event.wantlist_close_at} />
          </div>
        )}

        {/* Policies */}
        {hasPolicies && (
          <div className="rounded-3xl border-2 border-ink/15 bg-cream p-4">
            <h3 className="text-xs font-bold text-moss uppercase tracking-wide mb-3">
              {t('events.form.policies')}
            </h3>
            {event.shipping_rules && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-ink mb-0.5">{t('events.form.shippingRules')}</p>
                <p className="text-xs text-moss whitespace-pre-wrap">{event.shipping_rules}</p>
              </div>
            )}
            {event.regional_restrictions && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-ink mb-0.5">{t('events.form.regionalRestrictions')}</p>
                <p className="text-xs text-moss whitespace-pre-wrap">{event.regional_restrictions}</p>
              </div>
            )}
            {event.trade_policies && (
              <div>
                <p className="text-xs font-semibold text-ink mb-0.5">{t('events.form.tradePolicies')}</p>
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
            <p className="text-sm font-bold text-ink">{t('events.myWants.title')}</p>
            <p className="text-xs text-moss mt-0.5">
              {t('events.myWants.description')}{/*
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
            {t('events.myWants.open')}
          </Link>
        </div>
      )}


      {/* Matching section link */}
      {(['MATCHING', 'MATCH_REVIEW', 'FINALIZATION', 'SHIPPING', 'ARCHIVED'] as EventStatus[]).includes(event.status) && (
        <div className="rounded-3xl border-2 border-ink/15 bg-violet-100/60 p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-violet-900">{t('events.matchRuns.title')}</p>
            <p className="text-xs text-violet-600 mt-0.5">
              {event.is_organizer
                ? t('events.matchRuns.organizerDescription')
                : t('events.matchRuns.participantDescription')}
            </p>
          </div>
          <Link
            to={`/events/${event.slug}/matches`}
            className="shrink-0 rounded-2xl border-2 border-ink bg-violet-300 px-4 py-2 text-sm font-bold text-violet-950 shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0"
          >
            {event.is_organizer ? t('events.matchRuns.manage') : t('events.matchRuns.viewResults')}
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
