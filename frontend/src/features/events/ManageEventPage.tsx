import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePageTitle } from '../../hooks/usePageTitle'
import BackButton from '../../components/BackButton'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useEvent, useEventParticipants } from '../../api/events'
import {
  useAdminSubmissions, useToggleWish, useEditOfferBound, useEditWantBound,
  useUnlistCopy, useKickUser,
} from '../../api/eventAdmin'
import type { KickSummary } from '../../api/eventAdmin'

export default function ManageEventPage() {
  const { t } = useTranslation()
  const { slug = '' } = useParams<{ slug: string }>()
  const { data: event, isLoading } = useEvent(slug)
  usePageTitle(event?.name ? `${t('events.manageEvent.title')} · ${event.name}` : t('events.manageEvent.title'))
  const { data: participants } = useEventParticipants(slug)
  const [selected, setSelected] = useState<string | null>(null)
  const [kickResult, setKickResult] = useState<KickSummary | null>(null)
  const [confirmKick, setConfirmKick] = useState(false)

  const subs = useAdminSubmissions(slug, selected)
  const toggleWish = useToggleWish(slug)
  const editOffer = useEditOfferBound(slug)
  const editWant = useEditWantBound(slug)
  const unlist = useUnlistCopy(slug)
  const kick = useKickUser(slug)

  if (isLoading) return <p className="p-6 text-sm text-moss">{t('common.loading')}</p>
  if (!event) return <p className="p-6 text-sm text-moss">{t('events.manageEvent.notFound')}</p>
  if (!event.is_organizer) {
    return (
      <div className="mx-auto max-w-7xl p-6">
        <p className="text-sm text-red-600">{t('events.manageEvent.notOrganizer')}</p>
        <BackButton to={`/events/${slug}`}>{t('events.back')}</BackButton>
      </div>
    )
  }

  async function doKick() {
    if (!selected) return
    try {
      const res = await kick.mutateAsync(selected)
      setKickResult(res)
      setConfirmKick(false)
      setSelected(null)
    } catch {
      // Failure is surfaced via kick.isError below; keep the dialog open.
    }
  }

  const rows = participants ?? []

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <Link to={`/events/${slug}`} className="text-xs font-medium text-moss hover:text-ink">← {event.name}</Link>
      <h1 className="text-2xl font-bold text-ink">{t('events.manageEvent.title')}</h1>

      {kickResult && (
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('events.manageEvent.kickResultPrefix')} <strong>{kickResult.username}</strong>
          {t('events.manageEvent.kickResultDetail', {
            listings: kickResult.removed_listings,
            wishes: kickResult.removed_wishes,
            groups: kickResult.removed_groups,
            others: kickResult.affected_other_users,
          })}
        </div>
      )}

      {/* Participant picker */}
      <div>
        <label className="block text-xs font-semibold text-moss mb-1">{t('events.manageEvent.participant')}</label>
        <select
          value={selected ?? ''}
          onChange={(e) => { setSelected(e.target.value || null); setKickResult(null) }}
          className="w-full rounded-xl border-2 border-ink/15 bg-cream px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-sage"
        >
          <option value="">{t('events.manageEvent.selectParticipant')}</option>
          {rows.map((p) => (
            <option key={p.username} value={p.username}>{p.username}</option>
          ))}
        </select>
      </div>

      {selected && subs.data && (
        <div className="space-y-4">
          {/* Listings */}
          <section className="rounded-3xl border-2 border-ink bg-cream p-4 shadow-card">
            <h2 className="mb-2 font-display text-sm font-bold text-ink">{t('events.manageEvent.listings')}</h2>
            {subs.data.listings.length === 0 ? (
              <p className="text-xs text-moss">{t('events.manageEvent.noListings')}</p>
            ) : subs.data.listings.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 border-b border-ink/5 py-1.5 last:border-0">
                <span className="truncate text-sm text-ink">{l.board_game_name} <span className="font-mono text-xs text-moss/70">{l.listing_code}</span></span>
                <button
                  onClick={() => unlist.mutate(l.id)}
                  disabled={unlist.isPending && unlist.variables === l.id}
                  className="shrink-0 text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  {t('events.manageEvent.unlist')}
                </button>
              </div>
            ))}
          </section>

          {/* Offer groups (X) */}
          <section className="rounded-3xl border-2 border-ink bg-cream p-4 shadow-card">
            <h2 className="mb-2 font-display text-sm font-bold text-ink">{t('events.manageEvent.offerGroups')}</h2>
            {subs.data.offer_groups.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate text-sm text-ink">{g.name}</span>
                <input
                  type="number" min={1} defaultValue={g.max_give}
                  onBlur={(e) => editOffer.mutate({ id: g.id, max_give: Number(e.target.value) })}
                  className="w-16 rounded-lg border-2 border-ink/15 bg-parchment px-1.5 py-0.5 text-sm"
                />
              </div>
            ))}
          </section>

          {/* Want groups (Y) */}
          <section className="rounded-3xl border-2 border-ink bg-cream p-4 shadow-card">
            <h2 className="mb-2 font-display text-sm font-bold text-ink">{t('events.manageEvent.wantGroups')}</h2>
            {subs.data.want_groups.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate text-sm text-ink">{g.name}</span>
                <input
                  type="number" min={1} defaultValue={g.min_receive}
                  onBlur={(e) => editWant.mutate({ id: g.id, min_receive: Number(e.target.value) })}
                  className="w-16 rounded-lg border-2 border-ink/15 bg-parchment px-1.5 py-0.5 text-sm"
                />
              </div>
            ))}
          </section>

          {/* Wishes */}
          <section className="rounded-3xl border-2 border-ink bg-cream p-4 shadow-card">
            <h2 className="mb-2 font-display text-sm font-bold text-ink">{t('events.manageEvent.wishes')}</h2>
            {subs.data.wishes.map((w) => (
              <label key={w.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="truncate text-ink">{w.offer_group_name} → {w.want_group_name}</span>
                <span className="flex items-center gap-1.5 text-xs text-moss">
                  {t('events.manageEvent.active')}
                  <input
                    type="checkbox" checked={w.active}
                    onChange={(e) => toggleWish.mutate({ id: w.id, active: e.target.checked })}
                    className="h-4 w-4 rounded border-2 border-ink/30 accent-indigo-600"
                  />
                </span>
              </label>
            ))}
          </section>

          {/* Kick */}
          <section className="rounded-3xl border-2 border-red-200 bg-red-50 p-4">
            <h2 className="mb-1 font-display text-sm font-bold text-red-700">{t('events.manageEvent.removeFromEvent')}</h2>
            <p className="mb-3 text-xs text-red-600">
              {t('events.manageEvent.removeDescription', { username: subs.data.username })}
            </p>
            <button
              onClick={() => setConfirmKick(true)}
              className="rounded-2xl border-2 border-ink bg-red-300 px-3 py-1.5 text-xs font-bold text-red-950 shadow-pop-sm transition-transform hover:-translate-y-0.5"
            >
              {t('events.manageEvent.kickButton', { username: subs.data.username })}
            </button>
          </section>

          <Link to={`/events/${slug}/matches`} className="block text-sm font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2">
            {t('events.manageEvent.rerunSolver')}
          </Link>
        </div>
      )}

      {confirmKick && selected && (
        <ConfirmDialog
          title={t('events.manageEvent.kickConfirmTitle', { username: selected })}
          body={
            <>
              {t('events.manageEvent.kickConfirmBody', {
                listings: subs.data?.listings.length ?? 0,
                wishes: subs.data?.wishes.length ?? 0,
              })}
              {kick.isError && (
                <p className="mt-3 text-xs text-red-600">{t('events.manageEvent.kickFailed')}</p>
              )}
            </>
          }
          confirmLabel={kick.isPending ? t('events.removing') : t('events.manageEvent.confirmKick')}
          onConfirm={doKick}
          onCancel={() => setConfirmKick(false)}
          destructive
          pending={kick.isPending}
        />
      )}
    </div>
  )
}
