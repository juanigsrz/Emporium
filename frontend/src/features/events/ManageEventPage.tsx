import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEvent, useEventParticipants } from '../../api/events'
import {
  useAdminSubmissions, useToggleWish, useEditOfferBound, useEditWantBound,
  useUnlistCopy, useKickUser,
} from '../../api/eventAdmin'
import type { KickSummary } from '../../api/eventAdmin'

export default function ManageEventPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { data: event, isLoading } = useEvent(slug)
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

  if (isLoading) return <p className="p-6 text-sm text-moss">Loading…</p>
  if (!event) return <p className="p-6 text-sm text-moss">Event not found.</p>
  if (!event.is_organizer) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-red-600">Only the organizer can manage this event.</p>
        <Link to={`/events/${slug}`} className="text-sm font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2">← Back</Link>
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

  const rows = participants?.results ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <Link to={`/events/${slug}`} className="text-xs font-medium text-moss hover:text-ink">← {event.name}</Link>
      <h1 className="text-2xl font-bold text-ink">Manage event</h1>

      {kickResult && (
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Removed <strong>{kickResult.username}</strong>: {kickResult.removed_listings} listings,
          {' '}{kickResult.removed_wishes} wishes, {kickResult.removed_groups} groups.
          {' '}{kickResult.affected_other_users} other user(s) had references removed. Re-run the solver to refresh matches.
        </div>
      )}

      {/* Participant picker */}
      <div>
        <label className="block text-xs font-semibold text-moss mb-1">Participant</label>
        <select
          value={selected ?? ''}
          onChange={(e) => { setSelected(e.target.value || null); setKickResult(null) }}
          className="w-full rounded-xl border-2 border-ink/15 bg-cream px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-sage"
        >
          <option value="">Select a participant…</option>
          {rows.map((p) => (
            <option key={p.username} value={p.username}>{p.username}</option>
          ))}
        </select>
      </div>

      {selected && subs.data && (
        <div className="space-y-4">
          {/* Listings */}
          <section className="rounded-3xl border-2 border-ink bg-cream p-4 shadow-card">
            <h2 className="mb-2 font-display text-sm font-bold text-ink">Listings</h2>
            {subs.data.listings.length === 0 ? (
              <p className="text-xs text-moss">No listings.</p>
            ) : subs.data.listings.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 border-b border-ink/5 py-1.5 last:border-0">
                <span className="truncate text-sm text-ink">{l.board_game_name} <span className="font-mono text-xs text-moss/70">{l.listing_code}</span></span>
                <button
                  onClick={() => unlist.mutate(l.id)}
                  disabled={unlist.isPending && unlist.variables === l.id}
                  className="shrink-0 text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  Unlist
                </button>
              </div>
            ))}
          </section>

          {/* Offer groups (X) */}
          <section className="rounded-3xl border-2 border-ink bg-cream p-4 shadow-card">
            <h2 className="mb-2 font-display text-sm font-bold text-ink">Offer groups — give up to X</h2>
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
            <h2 className="mb-2 font-display text-sm font-bold text-ink">Want groups — receive at least Y</h2>
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
            <h2 className="mb-2 font-display text-sm font-bold text-ink">Wishes</h2>
            {subs.data.wishes.map((w) => (
              <label key={w.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="truncate text-ink">{w.offer_group_name} → {w.want_group_name}</span>
                <span className="flex items-center gap-1.5 text-xs text-moss">
                  Active
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
            <h2 className="mb-1 font-display text-sm font-bold text-red-700">Remove from event</h2>
            <p className="mb-3 text-xs text-red-600">
              Deletes {subs.data.username}'s listings, groups, wishes and bids from this event.
              Their copies are kept. References from other users are cleaned up automatically.
            </p>
            <button
              onClick={() => setConfirmKick(true)}
              className="rounded-2xl border-2 border-ink bg-red-300 px-3 py-1.5 text-xs font-bold text-red-950 shadow-pop-sm transition-transform hover:-translate-y-0.5"
            >
              Kick {subs.data.username}
            </button>
          </section>

          <Link to={`/events/${slug}/matches`} className="block text-sm font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2">
            → Re-run the solver
          </Link>
        </div>
      )}

      {confirmKick && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setConfirmKick(false)} aria-hidden="true" />
          <div className="relative w-full sm:max-w-sm rounded-3xl border-2 border-ink bg-cream p-5 shadow-card">
            <h3 className="mb-2 font-display text-lg font-bold text-ink">Kick {selected}?</h3>
            <p className="mb-4 text-sm text-moss">
              This removes {subs.data?.listings.length ?? 0} listings and {subs.data?.wishes.length ?? 0} wishes
              from this event. Their copies are preserved. This cannot be undone here.
            </p>
            {kick.isError && (
              <p className="mb-3 text-xs text-red-600">Failed to remove user. Please try again.</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setConfirmKick(false)} disabled={kick.isPending}
                className="flex-1 rounded-2xl border-2 border-ink/15 bg-cream px-4 py-2.5 text-sm font-semibold text-moss hover:bg-sage/30">
                Cancel
              </button>
              <button onClick={doKick} disabled={kick.isPending}
                className="flex-1 rounded-2xl border-2 border-ink bg-red-300 px-4 py-2.5 text-sm font-bold text-red-950 shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60">
                {kick.isPending ? 'Removing…' : 'Confirm kick'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
