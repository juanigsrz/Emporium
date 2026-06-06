import { Fragment, useMemo, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'

import { useEvent, useEventListings, useEventGames } from '../../api/events'
import type { EventListing } from '../../api/events'
import { useAuthStore } from '../../store/auth'

import {
  useOfferGroups,
  useWantGroups,
  useWishes,
  createOfferGroupRaw,
  createWantGroupRaw,
  createWishRaw,
  patchWantGroupRaw,
  invalidateTrades,
} from '../../api/trades'
import type { OfferGroup, WantGroup, WantGroupItemPayload } from '../../api/trades'
import { useQueryClient } from '@tanstack/react-query'

// ============================================================
// Model: a "want target" is one row in the matrix.
//   key  =  "G:<bggId>"  (any copy of a game)  |  "L:<listingId>" (specific copy)
// Each of my EventListings (a "my item") maps to a single-listing
// OfferGroup(max_give=1) → TradeWish → WantGroup(min_receive=1). The WantGroup's
// items are that listing's want list. Toggling a cell adds/removes a target from
// that listing's WantGroup. All persisted via the existing X-to-Y endpoints.
// ============================================================

interface Target {
  key: string
  type: 'BOARD_GAME' | 'LISTING'
  boardGameId?: number
  listingId?: number
  label: string
}

function gameTargetKey(bggId: number): string {
  return `G:${bggId}`
}
function listingTargetKey(listingId: number): string {
  return `L:${listingId}`
}

function cellKey(listingId: number, targetKey: string): string {
  return `${listingId}::${targetKey}`
}

// ---- Derive page model from the loaded trade objects ----

interface PageModel {
  /** For each of my listings, the want-group that holds its 1-to-1 want list (if any). */
  wantGroupByListing: Map<number, WantGroup>
  offerGroupByListing: Map<number, OfferGroup>
  /** listingId -> set of target keys currently in its want list (server truth). */
  baseMatrix: Map<number, Set<string>>
  /** All want targets referenced by any of my lists, keyed for dedupe. */
  baseTargets: Map<string, Target>
}

function buildModel(
  myListings: EventListing[],
  offerGroups: OfferGroup[],
  wantGroups: WantGroup[],
  wishes: { offer_group: number; want_group: number }[]
): PageModel {
  const wantGroupById = new Map(wantGroups.map((wg) => [wg.id, wg]))
  const wantGroupIdByOffer = new Map(wishes.map((w) => [w.offer_group, w.want_group]))

  // Pick the single-listing, X=1 offer group for each of my listings.
  const offerGroupByListing = new Map<number, OfferGroup>()
  for (const og of offerGroups) {
    if (og.max_give === 1 && og.items.length === 1) {
      const lid = og.items[0].event_listing
      if (!offerGroupByListing.has(lid)) offerGroupByListing.set(lid, og)
    }
  }

  const wantGroupByListing = new Map<number, WantGroup>()
  const baseMatrix = new Map<number, Set<string>>()
  const baseTargets = new Map<string, Target>()

  for (const listing of myListings) {
    const og = offerGroupByListing.get(listing.id)
    const set = new Set<string>()
    if (og) {
      const wgId = wantGroupIdByOffer.get(og.id)
      const wg = wgId != null ? wantGroupById.get(wgId) : undefined
      if (wg) {
        wantGroupByListing.set(listing.id, wg)
        for (const item of wg.items) {
          if (item.target_type === 'BOARD_GAME' && item.board_game != null) {
            const key = gameTargetKey(item.board_game)
            set.add(key)
            if (!baseTargets.has(key)) {
              baseTargets.set(key, {
                key,
                type: 'BOARD_GAME',
                boardGameId: item.board_game,
                label: item.board_game_name ?? `Game ${item.board_game}`,
              })
            }
          } else if (item.target_type === 'LISTING' && item.event_listing != null) {
            const key = listingTargetKey(item.event_listing)
            set.add(key)
            if (!baseTargets.has(key)) {
              baseTargets.set(key, {
                key,
                type: 'LISTING',
                listingId: item.event_listing,
                label: item.listing_code ?? `Listing ${item.event_listing}`,
              })
            }
          }
        }
      }
    }
    baseMatrix.set(listing.id, set)
  }

  return { wantGroupByListing, offerGroupByListing, baseMatrix, baseTargets }
}

// ============================================================
// Game search (adds "any copy of game" targets)
// ============================================================

interface GameSearchProps {
  slug: string
  onPick: (target: Target) => void
  placeholder?: string
}

// Event-scoped catalog search: only games that have copies in THIS event are
// tradeable, so we browse /events/{slug}/games/ — never the global 177k catalog.
function GameSearch({ slug, onPick, placeholder }: GameSearchProps) {
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const { data, isFetching } = useEventGames(slug, { search: q.trim() })
  const show = focused || q.trim().length >= 1
  const results = show ? (data?.results ?? []).slice(0, 10) : []

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder ?? 'Search games available in this event…'}
        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
      />
      {results.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {results.map((g) => (
            <li key={g.bgg_id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick({
                    key: gameTargetKey(g.bgg_id),
                    type: 'BOARD_GAME',
                    boardGameId: g.bgg_id,
                    label: g.name,
                  })
                  setQ('')
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50"
              >
                <span className="truncate text-gray-800">{g.name}</span>
                <span className="shrink-0 text-xs font-medium text-indigo-500">
                  {g.copies_count} cop{g.copies_count === 1 ? 'y' : 'ies'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {show && !isFetching && results.length === 0 && (
        <p className="mt-1 text-xs text-gray-400">No matching games with copies in this event.</p>
      )}
    </div>
  )
}

// Concrete copies behind a canonical-game want: a BOARD_GAME want resolves to
// these specific listings. Own copies are excluded (you won't receive your own).
function GameCopies({ slug, bggId, username }: { slug: string; bggId: number; username?: string }) {
  const { data, isLoading } = useEventListings(slug, { board_game: bggId })
  const all = data?.results ?? []
  const others = all.filter((l) => l.copy_owner_username !== username)
  const ownCount = all.length - others.length

  if (isLoading) return <p className="px-3 py-2 text-xs text-gray-400">Loading copies…</p>

  return (
    <div className="px-3 py-2">
      {others.length === 0 ? (
        <p className="text-xs text-gray-400">No copies from other traders in this event yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {others.map((l) => (
            <li
              key={l.id}
              className="inline-flex items-center gap-1.5 rounded border border-gray-200 bg-white px-2 py-1 text-xs"
            >
              <span className="font-mono text-gray-500">{l.listing_code}</span>
              <span className="text-gray-300">·</span>
              <span className="text-gray-700">{l.copy_owner_username}</span>
            </li>
          ))}
        </ul>
      )}
      {ownCount > 0 && (
        <p className="mt-1 text-[11px] text-gray-400">
          ({ownCount} more {ownCount === 1 ? 'is' : 'are'} your own copy — excluded)
        </p>
      )}
    </div>
  )
}

// ============================================================
// Staged-edit controller (shared by visual + grid)
// ============================================================

interface Editor {
  /** Targets shown in the UI = base targets + session-added ones. */
  targets: Target[]
  isOn: (listingId: number, targetKey: string) => boolean
  toggle: (listingId: number, targetKey: string, next?: boolean) => void
  addTarget: (t: Target) => void
  dirtyCount: number
  changedListingIds: Set<number>
  reset: () => void
}

function useEditor(model: PageModel): {
  editor: Editor
  changes: Map<string, boolean>
  sessionTargets: Map<string, Target>
} {
  const [changes, setChanges] = useState<Map<string, boolean>>(new Map())
  const [sessionTargets, setSessionTargets] = useState<Map<string, Target>>(new Map())

  const targets = useMemo(() => {
    const merged = new Map<string, Target>(model.baseTargets)
    for (const [k, t] of sessionTargets) if (!merged.has(k)) merged.set(k, t)
    return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [model.baseTargets, sessionTargets])

  const isOn = useCallback(
    (listingId: number, targetKey: string) => {
      const ck = cellKey(listingId, targetKey)
      if (changes.has(ck)) return changes.get(ck)!
      return model.baseMatrix.get(listingId)?.has(targetKey) ?? false
    },
    [changes, model.baseMatrix]
  )

  const toggle = useCallback(
    (listingId: number, targetKey: string, next?: boolean) => {
      setChanges((prev) => {
        const m = new Map(prev)
        const ck = cellKey(listingId, targetKey)
        const base = model.baseMatrix.get(listingId)?.has(targetKey) ?? false
        const desired = next ?? !(m.has(ck) ? m.get(ck)! : base)
        if (desired === base) m.delete(ck)
        else m.set(ck, desired)
        return m
      })
    },
    [model.baseMatrix]
  )

  const addTarget = useCallback((t: Target) => {
    setSessionTargets((prev) => {
      if (prev.has(t.key)) return prev
      const m = new Map(prev)
      m.set(t.key, t)
      return m
    })
  }, [])

  const reset = useCallback(() => {
    setChanges(new Map())
    setSessionTargets(new Map())
  }, [])

  const changedListingIds = useMemo(() => {
    const s = new Set<number>()
    for (const ck of changes.keys()) s.add(Number(ck.split('::')[0]))
    return s
  }, [changes])

  return {
    editor: {
      targets,
      isOn,
      toggle,
      addTarget,
      dirtyCount: changes.size,
      changedListingIds,
      reset,
    },
    changes,
    sessionTargets,
  }
}

// ============================================================
// Visual mode — one card per "my item", chips for its wants
// ============================================================

interface VisualModeProps {
  slug: string
  myListings: EventListing[]
  editor: Editor
}

function VisualMode({ slug, myListings, editor }: VisualModeProps) {
  const [addingFor, setAddingFor] = useState<number | null>(null)

  if (myListings.length === 0) return null

  return (
    <div className="space-y-3">
      {myListings.map((listing) => {
        const myWants = editor.targets.filter((t) => editor.isOn(listing.id, t.key))
        return (
          <div key={listing.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">
                  {listing.board_game_name}
                </p>
                <p className="font-mono text-xs text-gray-400">{listing.listing_code}</p>
              </div>
              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                wants {myWants.length}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {myWants.map((t) => (
                <span
                  key={t.key}
                  className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700"
                >
                  {t.type === 'LISTING' && (
                    <span className="font-mono text-purple-400">copy</span>
                  )}
                  <span className="max-w-[12rem] truncate">{t.label}</span>
                  <button
                    type="button"
                    onClick={() => editor.toggle(listing.id, t.key, false)}
                    className="text-purple-400 hover:text-purple-700"
                    aria-label={`Remove ${t.label}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              {myWants.length === 0 && (
                <span className="text-xs text-gray-400">No wants yet — add the games you'd accept.</span>
              )}
            </div>

            {addingFor === listing.id ? (
              <div className="mt-3">
                <GameSearch
                  slug={slug}
                  placeholder={`Add a game ${listing.listing_code} would accept…`}
                  onPick={(t) => {
                    editor.addTarget(t)
                    editor.toggle(listing.id, t.key, true)
                  }}
                />
                {/* existing targets quick-add */}
                {editor.targets.filter((t) => !editor.isOn(listing.id, t.key)).length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1 text-xs text-gray-400">Or reuse a want from another item:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {editor.targets
                        .filter((t) => !editor.isOn(listing.id, t.key))
                        .slice(0, 12)
                        .map((t) => (
                          <button
                            key={t.key}
                            type="button"
                            onClick={() => editor.toggle(listing.id, t.key, true)}
                            className="rounded-full border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-purple-300 hover:text-purple-700"
                          >
                            + {t.label}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setAddingFor(null)}
                  className="mt-2 text-xs text-gray-400 hover:text-gray-600"
                >
                  Done
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingFor(listing.id)}
                className="mt-3 rounded-md border border-dashed border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-400 hover:border-purple-300 hover:text-purple-500"
              >
                + Add want
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ============================================================
// Grid mode — rows = want targets, cols = my items, cells = toggle
// ============================================================

interface GridModeProps {
  slug: string
  myListings: EventListing[]
  editor: Editor
  username?: string
}

function GridMode({ slug, myListings, editor, username }: GridModeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const s = new Set(prev)
      if (s.has(key)) s.delete(key)
      else s.add(key)
      return s
    })

  if (editor.targets.length === 0) {
    return (
      <div className="rounded-md bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">
        No want targets yet. Add one above, then check the items that would accept it.
      </div>
    )
  }

  const colCount = myListings.length + 1

  return (
    <div className="overflow-auto rounded-xl border border-gray-200 bg-white" style={{ maxHeight: '70vh' }}>
      <table className="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 border-b border-r border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-500">
              Want \ My item
            </th>
            {myListings.map((l) => (
              <th
                key={l.id}
                className="sticky top-0 z-20 border-b border-r border-gray-200 bg-gray-50 px-1 py-2 align-bottom"
              >
                <div className="mx-auto h-28 w-8">
                  <div className="flex h-full -rotate-180 items-center justify-center [writing-mode:vertical-rl]">
                    <span className="truncate text-xs font-medium text-gray-600" title={l.board_game_name}>
                      {l.board_game_name}
                    </span>
                  </div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {editor.targets.map((t) => {
            const isOpen = expanded.has(t.key)
            return (
              <Fragment key={t.key}>
                <tr className="group">
                  <th className="sticky left-0 z-10 border-b border-r border-gray-200 bg-white px-3 py-2 text-left font-normal group-hover:bg-indigo-50/40">
                    <span className="flex items-center gap-1.5">
                      {t.type === 'BOARD_GAME' ? (
                        <button
                          type="button"
                          onClick={() => toggleExpand(t.key)}
                          className="shrink-0 text-gray-400 hover:text-indigo-600"
                          title="Show the concrete copies this want resolves to"
                          aria-expanded={isOpen}
                        >
                          <svg
                            className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      ) : (
                        <span className="rounded bg-gray-100 px-1 font-mono text-[10px] text-gray-400">copy</span>
                      )}
                      <span className="max-w-[14rem] truncate text-gray-700" title={t.label}>
                        {t.label}
                      </span>
                    </span>
                  </th>
                  {myListings.map((l) => {
                    const on = editor.isOn(l.id, t.key)
                    return (
                      <td
                        key={l.id}
                        className="border-b border-r border-gray-200 p-0 text-center group-hover:bg-indigo-50/40"
                      >
                        <button
                          type="button"
                          onClick={() => editor.toggle(l.id, t.key)}
                          className={`m-1 h-5 w-5 rounded border ${
                            on
                              ? 'border-indigo-600 bg-indigo-600 text-white'
                              : 'border-gray-300 bg-white text-transparent hover:border-indigo-400'
                          }`}
                          title={`${t.label}  ↕  ${l.board_game_name}`}
                          aria-pressed={on}
                        >
                          <svg className="mx-auto h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                      </td>
                    )
                  })}
                </tr>
                {isOpen && t.type === 'BOARD_GAME' && t.boardGameId != null && (
                  <tr>
                    <td colSpan={colCount} className="sticky left-0 border-b border-gray-200 bg-indigo-50/30">
                      <div className="text-xs">
                        <span className="px-3 py-1 font-medium text-gray-500">
                          Copies you'd be matched to receive:
                        </span>
                        <GameCopies slug={slug} bggId={t.boardGameId} username={username} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ============================================================
// Save: persist staged changes per changed listing
// ============================================================

async function persistChanges(
  slug: string,
  model: PageModel,
  editor: Editor,
  myListings: EventListing[]
): Promise<void> {
  const listingById = new Map(myListings.map((l) => [l.id, l]))

  for (const listingId of editor.changedListingIds) {
    const listing = listingById.get(listingId)
    if (!listing) continue

    // Desired target set for this listing (apply staged changes over base).
    const desired = editor.targets.filter((t) => editor.isOn(listingId, t.key))
    const items: WantGroupItemPayload[] = desired.map((t, i) => ({
      target_type: t.type,
      ...(t.type === 'BOARD_GAME'
        ? { board_game: t.boardGameId! }
        : { event_listing: t.listingId! }),
      tier: 1,
      rank: i,
    }))

    let wg = model.wantGroupByListing.get(listingId)

    if (!wg) {
      // No 1-to-1 trio yet → create offer group + want group + wish.
      let og = model.offerGroupByListing.get(listingId)
      if (!og) {
        og = await createOfferGroupRaw(slug, {
          name: listing.listing_code,
          max_give: 1,
          item_listing_ids: [listingId],
        })
      }
      wg = await createWantGroupRaw(slug, {
        name: `Wants for ${listing.listing_code}`,
        min_receive: 1,
        items,
      })
      await createWishRaw(slug, { offer_group: og.id, want_group: wg.id, active: true })
    } else {
      await patchWantGroupRaw(slug, wg.id, { items })
    }
  }
}

// ============================================================
// MAIN PAGE
// ============================================================

type ViewMode = 'visual' | 'grid'

export default function MyWantsPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const { data: event, isLoading: eventLoading, isError: eventError } = useEvent(slug)
  const { data: listingsData } = useEventListings(slug, { user: user?.username })
  const { data: offerGroups = [] } = useOfferGroups(slug)
  const { data: wantGroups = [] } = useWantGroups(slug)
  const { data: wishes = [] } = useWishes(slug)

  const myListings = useMemo(() => listingsData?.results ?? [], [listingsData])

  const model = useMemo(
    () => buildModel(myListings, offerGroups, wantGroups, wishes),
    [myListings, offerGroups, wantGroups, wishes]
  )

  const { editor } = useEditor(model)

  const [view, setView] = useState<ViewMode>('visual')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!slug) return
    setSaving(true)
    setSaveError(null)
    try {
      await persistChanges(slug, model, editor, myListings)
      invalidateTrades(qc, slug)
      editor.reset()
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Failed to save. Please try again.'
      )
    } finally {
      setSaving(false)
    }
  }, [slug, model, editor, myListings, qc])

  if (eventLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8 sm:px-6 animate-pulse">
        <div className="h-8 w-2/3 rounded bg-gray-100" />
        <div className="h-64 rounded-xl bg-gray-100" />
      </div>
    )
  }

  if (eventError || !event) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-red-700">Event not found or failed to load.</p>
          <Link to="/events" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
            Back to events
          </Link>
        </div>
      </div>
    )
  }

  if (!event.is_participant && !event.is_organizer) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-yellow-700">
            You must join this event before building your want list.
          </p>
          <Link to={`/events/${slug}`} className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
            Go to event page to join
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
      <Link
        to={`/events/${slug}`}
        className="inline-flex items-center gap-1 text-xs text-gray-400 transition-colors hover:text-indigo-600"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to {event.name}
      </Link>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">My Wants</h1>
            <p className="mt-1 text-sm text-gray-500">
              {event.name}
              <span className="mx-2 text-gray-300">·</span>
              For each item you offer, pick the games you'd accept in return.
            </p>
          </div>
          <Link
            to={`/events/${slug}/builder`}
            className="text-xs text-gray-400 underline hover:text-indigo-600"
          >
            Advanced (X-to-Y) builder
          </Link>
        </div>
      </div>

      {myListings.length === 0 ? (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-3 text-sm text-yellow-700">
          You have no items in this event yet.{' '}
          <Link to={`/events/${slug}`} className="font-medium underline">
            Add copies from the event page
          </Link>{' '}
          first.
        </div>
      ) : (
        <>
          {/* Mode tabs */}
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
              {(['visual', 'grid'] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setView(m)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                    view === m ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400">
              {myListings.length} item{myListings.length !== 1 ? 's' : ''} · {editor.targets.length} want
              {editor.targets.length !== 1 ? 's' : ''}
            </p>
          </div>

          {view === 'grid' && (
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="mb-2 text-xs font-medium text-gray-500">Add a want target (row):</p>
              <GameSearch slug={slug!} onPick={(t) => editor.addTarget(t)} />
            </div>
          )}

          {view === 'visual' ? (
            <VisualMode slug={slug!} myListings={myListings} editor={editor} />
          ) : (
            <GridMode slug={slug!} myListings={myListings} editor={editor} username={user?.username} />
          )}
        </>
      )}

      {/* Sticky save bar */}
      {editor.dirtyCount > 0 && (
        <div className="sticky bottom-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full border border-gray-300 bg-white px-5 py-2.5 shadow-lg">
          <span className="text-sm text-gray-600">
            {editor.dirtyCount} unsaved change{editor.dirtyCount !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => editor.reset()}
              disabled={saving}
              className="rounded-full px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-full bg-indigo-600 px-5 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
      {saveError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {saveError}
        </div>
      )}
    </div>
  )
}
