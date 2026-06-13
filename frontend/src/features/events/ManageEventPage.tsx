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

  if (isLoading) return <p className="p-6 text-sm text-gray-400">Loading…</p>
  if (!event) return <p className="p-6 text-sm text-gray-400">Event not found.</p>
  if (!event.is_organizer) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-red-600">Only the organizer can manage this event.</p>
        <Link to={`/events/${slug}`} className="text-sm text-indigo-600 hover:underline">← Back</Link>
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
      <Link to={`/events/${slug}`} className="text-xs text-gray-400 hover:text-indigo-600">← {event.name}</Link>
      <h1 className="text-xl font-bold text-gray-900">Manage event</h1>

      {kickResult && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Removed <strong>{kickResult.username}</strong>: {kickResult.removed_listings} listings,
          {' '}{kickResult.removed_wishes} wishes, {kickResult.removed_groups} groups.
          {' '}{kickResult.affected_other_users} other user(s) had references removed. Re-run the solver to refresh matches.
        </div>
      )}

      {/* Participant picker */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Participant</label>
        <select
          value={selected ?? ''}
          onChange={(e) => { setSelected(e.target.value || null); setKickResult(null) }}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
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
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Listings</h2>
            {subs.data.listings.length === 0 ? (
              <p className="text-xs text-gray-400">No listings.</p>
            ) : subs.data.listings.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 border-b border-gray-50 py-1.5 last:border-0">
                <span className="truncate text-sm text-gray-700">{l.board_game_name} <span className="font-mono text-xs text-gray-400">{l.listing_code}</span></span>
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
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Offer groups — give up to X</h2>
            {subs.data.offer_groups.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate text-sm text-gray-700">{g.name}</span>
                <input
                  type="number" min={1} defaultValue={g.max_give}
                  onBlur={(e) => editOffer.mutate({ id: g.id, max_give: Number(e.target.value) })}
                  className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-sm"
                />
              </div>
            ))}
          </section>

          {/* Want groups (Y) */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Want groups — receive at least Y</h2>
            {subs.data.want_groups.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate text-sm text-gray-700">{g.name}</span>
                <input
                  type="number" min={1} defaultValue={g.min_receive}
                  onBlur={(e) => editWant.mutate({ id: g.id, min_receive: Number(e.target.value) })}
                  className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-sm"
                />
              </div>
            ))}
          </section>

          {/* Wishes */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Wishes</h2>
            {subs.data.wishes.map((w) => (
              <label key={w.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="truncate text-gray-700">{w.offer_group_name} → {w.want_group_name}</span>
                <span className="flex items-center gap-1.5 text-xs text-gray-500">
                  Active
                  <input
                    type="checkbox" checked={w.active}
                    onChange={(e) => toggleWish.mutate({ id: w.id, active: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                  />
                </span>
              </label>
            ))}
          </section>

          {/* Kick */}
          <section className="rounded-xl border border-red-200 bg-red-50 p-4">
            <h2 className="mb-1 text-sm font-semibold text-red-700">Remove from event</h2>
            <p className="mb-3 text-xs text-red-600">
              Deletes {subs.data.username}'s listings, groups, wishes and bids from this event.
              Their copies are kept. References from other users are cleaned up automatically.
            </p>
            <button
              onClick={() => setConfirmKick(true)}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
            >
              Kick {subs.data.username}
            </button>
          </section>

          <Link to={`/events/${slug}/matches`} className="block text-sm text-indigo-600 hover:underline">
            → Re-run the solver
          </Link>
        </div>
      )}

      {confirmKick && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmKick(false)} aria-hidden="true" />
          <div className="relative w-full sm:max-w-sm rounded-xl bg-white p-5 shadow-2xl">
            <h3 className="mb-2 text-base font-semibold text-gray-900">Kick {selected}?</h3>
            <p className="mb-4 text-sm text-gray-600">
              This removes {subs.data?.listings.length ?? 0} listings and {subs.data?.wishes.length ?? 0} wishes
              from this event. Their copies are preserved. This cannot be undone here.
            </p>
            {kick.isError && (
              <p className="mb-3 text-xs text-red-600">Failed to remove user. Please try again.</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setConfirmKick(false)} disabled={kick.isPending}
                className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={doKick} disabled={kick.isPending}
                className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60">
                {kick.isPending ? 'Removing…' : 'Confirm kick'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
