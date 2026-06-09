import { Fragment, useMemo, useState, useCallback, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'

import { useEvent, useEventListings, useEventGames } from '../../api/events'
import type { EventListing } from '../../api/events'
import { useCopy } from '../../api/copies'
import { useAuthStore } from '../../store/auth'
import { useMyRatings, ratingMap, useSetRating, useDeleteRating } from '../../api/ratings'

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
  /** Canonical game this target belongs to — LISTING targets group under it. */
  gameId: number
  gameName: string
}

// A canonical-game row in the want views: one game, its optional "any copy"
// target plus any specific-copy (LISTING) targets. Collapses the duplicate rows.
interface GameGroup {
  gameId: number
  gameName: string
  anyTarget?: Target           // BOARD_GAME (any copy)
  copyTargets: Target[]        // specific LISTING selections
}

function groupTargetsByGame(targets: Target[]): GameGroup[] {
  const byGame = new Map<number, GameGroup>()
  for (const t of targets) {
    let g = byGame.get(t.gameId)
    if (!g) {
      g = { gameId: t.gameId, gameName: t.gameName, copyTargets: [] }
      byGame.set(t.gameId, g)
    }
    if (t.type === 'BOARD_GAME') g.anyTarget = t
    else g.copyTargets.push(t)
  }
  return Array.from(byGame.values()).sort((a, b) => a.gameName.localeCompare(b.gameName))
}

function groupKeys(g: GameGroup): string[] {
  const keys = g.copyTargets.map((t) => t.key)
  if (g.anyTarget) keys.push(g.anyTarget.key)
  return keys
}

function groupIsOn(editor: Editor, listingId: number, g: GameGroup): boolean {
  return groupKeys(g).some((k) => editor.isOn(listingId, k))
}

// Aggregate toggle: on→clear every target of this game; off→want "any copy"
// (or re-enable the previously-picked specific copies if that's all there is).
function toggleGroup(editor: Editor, listingId: number, g: GameGroup): void {
  if (groupIsOn(editor, listingId, g)) {
    groupKeys(g).forEach((k) => editor.toggle(listingId, k, false))
  } else if (g.anyTarget) {
    editor.toggle(listingId, g.anyTarget.key, true)
  } else {
    g.copyTargets.forEach((t) => editor.toggle(listingId, t.key, true))
  }
}

function groupBadge(g: GameGroup): string {
  if (g.anyTarget) return 'any copy'
  const n = g.copyTargets.length
  return `${n} cop${n === 1 ? 'y' : 'ies'}`
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
  /** Canonical gameId -> existing buy-price (money_amount as string), server truth. */
  baseMoneyByGame: Map<number, string>
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
  const baseMoneyByGame = new Map<number, string>()

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
            if (item.money_amount != null && !baseMoneyByGame.has(item.board_game)) {
              baseMoneyByGame.set(item.board_game, item.money_amount)
            }
            if (!baseTargets.has(key)) {
              baseTargets.set(key, {
                key,
                type: 'BOARD_GAME',
                boardGameId: item.board_game,
                label: item.board_game_name ?? `Game ${item.board_game}`,
                gameId: item.board_game,
                gameName: item.board_game_name ?? `Game ${item.board_game}`,
              })
            }
          } else if (item.target_type === 'LISTING' && item.event_listing != null) {
            const key = listingTargetKey(item.event_listing)
            set.add(key)
            const lgid = item.board_game_id ?? -item.event_listing
            if (item.money_amount != null && !baseMoneyByGame.has(lgid)) {
              baseMoneyByGame.set(lgid, item.money_amount)
            }
            if (!baseTargets.has(key)) {
              baseTargets.set(key, {
                key,
                type: 'LISTING',
                listingId: item.event_listing,
                label: item.listing_code ?? `Listing ${item.event_listing}`,
                // board_game_id is the canonical game of the listing's copy →
                // lets specific-copy wants fold under their game row.
                gameId: item.board_game_id ?? -item.event_listing,
                gameName: item.board_game_name ?? `Listing ${item.event_listing}`,
              })
            }
          }
        }
      }
    }
    baseMatrix.set(listing.id, set)
  }

  return { wantGroupByListing, offerGroupByListing, baseMatrix, baseTargets, baseMoneyByGame }
}

// ============================================================
// Game browse — paginated card grid of the games available in THIS event.
// Expand a card to see the concrete copies it resolves to; "Want" toggles a
// BOARD_GAME target on for ALL my items, then the inline "Offering N/M" panel
// (or the grid) refines which of my offered items go toward that want.
// Replaces the old typeahead search; only event-scoped games, never the
// global 177k catalog.
// ============================================================

const BROWSE_PAGE_SIZE = 24

interface GameBrowseProps {
  slug: string
  editor: Editor
  myListings: EventListing[]
  username?: string
  customWantGroups: WantGroup[]
  moneyEnabled: boolean
}

interface GameCardControlsProps {
  slug: string
  bggId: number
  wanted: boolean
  moneyEnabled: boolean
  priceValue: string
  onPriceChange: (value: string) => void
  customWantGroups: WantGroup[]
}

function GameCardControls({
  slug,
  bggId,
  wanted,
  moneyEnabled,
  priceValue,
  onPriceChange,
  customWantGroups,
}: GameCardControlsProps) {
  const qc = useQueryClient()
  const { data: ratings = [] } = useMyRatings()
  const setRating = useSetRating()
  const delRating = useDeleteRating()
  const rating = ratings.find((r) => r.board_game === bggId)

  const [ratingInput, setRatingInput] = useState<string>(rating ? String(Number(rating.value)) : '')
  const [groupSel, setGroupSel] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [groupMsg, setGroupMsg] = useState<string | null>(null)

  useEffect(() => {
    setRatingInput(rating ? String(Number(rating.value)) : '')
  }, [rating])

  function commitRating() {
    const raw = ratingInput.trim()
    if (raw === '') {
      if (rating) delRating.mutate(rating.id)
      return
    }
    const v = Number(raw)
    if (!Number.isNaN(v) && v >= 1 && v <= 10) setRating.mutate({ board_game: bggId, value: v })
  }

  async function addToExisting(groupId: number) {
    setGroupMsg(null)
    const group = customWantGroups.find((g) => g.id === groupId)
    if (!group) return
    if (group.items.some((i) => i.target_type === 'BOARD_GAME' && i.board_game === bggId)) {
      setGroupMsg('Already in that group.')
      return
    }
    const items: WantGroupItemPayload[] = [
      ...group.items.map((i) => ({
        target_type: i.target_type,
        ...(i.target_type === 'BOARD_GAME'
          ? { board_game: i.board_game! }
          : { event_listing: i.event_listing! }),
        money_amount: i.money_amount != null ? Number(i.money_amount) : null,
      })),
      { target_type: 'BOARD_GAME', board_game: bggId, money_amount: null },
    ]
    try {
      await patchWantGroupRaw(slug, group.id, { items })
      invalidateTrades(qc, slug)
      setGroupMsg('Added.')
    } catch {
      setGroupMsg('Could not add.')
    }
  }

  async function createAndAdd() {
    const name = newName.trim()
    if (!name) return
    setGroupMsg(null)
    try {
      await createWantGroupRaw(slug, {
        name,
        min_receive: 1,
        items: [{ target_type: 'BOARD_GAME', board_game: bggId, money_amount: null }],
      })
      invalidateTrades(qc, slug)
      setShowNew(false)
      setNewName('')
      setGroupMsg('Group created.')
    } catch {
      setGroupMsg('Could not create group.')
    }
  }

  return (
    <div className="space-y-2 border-b border-gray-100 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-gray-500">My rating</span>
        <input
          type="number"
          min={1}
          max={10}
          step={0.5}
          value={ratingInput}
          onChange={(e) => setRatingInput(e.target.value)}
          onBlur={commitRating}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          placeholder="—"
          className="w-16 rounded border border-gray-300 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        {rating && (
          <button
            type="button"
            onClick={() => {
              setRatingInput('')
              delRating.mutate(rating.id)
            }}
            className="text-gray-300 hover:text-red-500"
            aria-label="Clear rating"
          >
            ×
          </button>
        )}
        {(setRating.isSuccess || delRating.isSuccess) && <span className="text-green-600">✓</span>}
      </div>

      {moneyEnabled && (
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Pay up to $</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={priceValue}
            disabled={!wanted}
            onChange={(e) => onPriceChange(e.target.value)}
            placeholder={wanted ? '0' : 'want it first'}
            title={wanted ? "Most money you'll pay to receive this game" : 'Select a copy / want this game to set a price'}
            className="w-24 rounded border border-gray-300 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-gray-500">Add to group</span>
        <select
          value={groupSel}
          onChange={(e) => {
            const val = e.target.value
            setGroupSel('')
            if (val === '__new__') {
              setShowNew(true)
            } else if (val) {
              addToExisting(Number(val))
            }
          }}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-400"
        >
          <option value="">Choose…</option>
          {customWantGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="__new__">+ New group…</option>
        </select>
        {groupMsg && <span className="text-gray-400">{groupMsg}</span>}
      </div>

      {showNew && (
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New group name"
            className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
          <button
            type="button"
            onClick={createAndAdd}
            className="rounded bg-purple-600 px-2 py-0.5 font-medium text-white hover:bg-purple-500"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setShowNew(false)
              setNewName('')
            }}
            className="text-gray-400 hover:text-gray-600"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function GameBrowse({ slug, editor, myListings, username, customWantGroups, moneyEnabled }: GameBrowseProps) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [ordering, setOrdering] = useState<'-copies_count' | 'name'>('-copies_count')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [offerOpen, setOfferOpen] = useState<number | null>(null)

  // Filter bar state
  const [wishlisted, setWishlisted] = useState(false)
  const [minRating, setMinRating] = useState<number | ''>('')
  const [isExpansion, setIsExpansion] = useState<boolean | undefined>(undefined)

  // Game groups keyed by canonical id — drives the per-card "which of my items
  // offer for this want" panel (same model the grid uses, surfaced inline here).
  const groupByGame = useMemo(() => {
    const m = new Map<number, GameGroup>()
    for (const grp of groupTargetsByGame(editor.targets)) m.set(grp.gameId, grp)
    return m
  }, [editor.targets])

  const { data, isFetching } = useEventGames(slug, {
    search: q.trim(),
    ordering,
    page,
    page_size: BROWSE_PAGE_SIZE,
    wishlisted: wishlisted || undefined,
    min_rating: minRating !== '' ? minRating : undefined,
    is_expansion: isExpansion,
  })
  const games = data?.results ?? []
  const count = data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(count / BROWSE_PAGE_SIZE))

  const isWanted = useCallback(
    (bggId: number) => {
      const key = gameTargetKey(bggId)
      return myListings.some((l) => editor.isOn(l.id, key))
    },
    [editor, myListings]
  )

  function toggleWant(g: { bgg_id: number; name: string }) {
    const key = gameTargetKey(g.bgg_id)
    const next = !isWanted(g.bgg_id)
    editor.addTarget({
      key, type: 'BOARD_GAME', boardGameId: g.bgg_id, label: g.name,
      gameId: g.bgg_id, gameName: g.name,
    })
    myListings.forEach((l) => editor.toggle(l.id, key, next))
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1) }}
          placeholder="Search games available in this event…"
          className="min-w-[12rem] flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
        />
        <select
          value={ordering}
          onChange={(e) => { setOrdering(e.target.value as '-copies_count' | 'name'); setPage(1) }}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-600"
          aria-label="Order games"
        >
          <option value="-copies_count">Most available</option>
          <option value="name">A–Z</option>
        </select>
      </div>

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
        <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-indigo-300 has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50 has-[:checked]:text-indigo-700">
          <input
            type="checkbox"
            checked={wishlisted}
            onChange={(e) => { setWishlisted(e.target.checked); setPage(1) }}
            className="h-3 w-3 rounded border-gray-300 text-indigo-600"
          />
          In my BGG wishlist
        </label>

        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          <span>Min rating</span>
          <input
            type="number"
            min={1}
            max={10}
            step={0.5}
            value={minRating}
            onChange={(e) => { setMinRating(e.target.value === '' ? '' : Number(e.target.value)); setPage(1) }}
            placeholder="—"
            className="w-14 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          />
        </label>

        <select
          value={isExpansion == null ? '' : String(isExpansion)}
          onChange={(e) => {
            setIsExpansion(e.target.value === '' ? undefined : e.target.value === 'true')
            setPage(1)
          }}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600"
          aria-label="Expansion filter"
        >
          <option value="">Base games + expansions</option>
          <option value="false">Base games only</option>
          <option value="true">Expansions only</option>
        </select>

      </div>

      {games.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-gray-400">
          {isFetching ? 'Loading games…' : 'No games with copies match.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {games.map((g) => {
            const wanted = isWanted(g.bgg_id)
            const open = expanded === g.bgg_id
            return (
              <div
                key={g.bgg_id}
                className={`flex flex-col overflow-hidden rounded-lg border ${
                  wanted ? 'border-purple-300 ring-1 ring-purple-200' : 'border-gray-200'
                }`}
              >
                <div className="flex gap-2 p-2">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-gray-100">
                    {g.image_url ? (
                      <img src={g.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-gray-800" title={g.name}>
                      {g.name}
                    </p>
                    {g.year_published ? (
                      <p className="text-[11px] text-gray-400">{g.year_published}</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : g.bgg_id)}
                      className="mt-0.5 text-[11px] font-medium text-indigo-500 hover:text-indigo-700"
                      aria-expanded={open}
                    >
                      {g.copies_count} cop{g.copies_count === 1 ? 'y' : 'ies'} {open ? '▲' : '▼'}
                    </button>
                  </div>
                </div>
                {open && (
                  <div className="border-t border-gray-100 bg-gray-50/60">
                    {(() => {
                      const group = groupByGame.get(g.bgg_id)
                      const wantedForControls = group
                        ? myListings.some((l) => groupIsOn(editor, l.id, group))
                        : false
                      return (
                        <GameCardControls
                          slug={slug}
                          bggId={g.bgg_id}
                          wanted={wantedForControls}
                          moneyEnabled={moneyEnabled}
                          priceValue={editor.priceForGame(g.bgg_id)}
                          onPriceChange={(v) => editor.setMoney(g.bgg_id, v)}
                          customWantGroups={customWantGroups}
                        />
                      )
                    })()}
                    <GameCopies
                      slug={slug}
                      bggId={g.bgg_id}
                      username={username}
                      editor={editor}
                      myListings={myListings}
                      selectable
                    />
                  </div>
                )}
                {(() => {
                  const group = groupByGame.get(g.bgg_id)
                  if (!group || myListings.length < 2) return null
                  const offeringCount = myListings.filter((l) => groupIsOn(editor, l.id, group)).length
                  if (offeringCount === 0) return null
                  const panelOpen = offerOpen === g.bgg_id
                  return (
                    <div className="border-t border-gray-100 bg-indigo-50/40">
                      <button
                        type="button"
                        onClick={() => setOfferOpen(panelOpen ? null : g.bgg_id)}
                        className="w-full px-2 py-1 text-left text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                        aria-expanded={panelOpen}
                        title="Pick which of your offered items you'd give for this game"
                      >
                        Offering {offeringCount}/{myListings.length} of your items {panelOpen ? '▲' : '▾'}
                      </button>
                      {panelOpen && (
                        <ul className="max-h-40 space-y-0.5 overflow-y-auto px-2 pb-2">
                          {myListings.map((l) => {
                            const on = groupIsOn(editor, l.id, group)
                            return (
                              <li key={l.id}>
                                <label className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-white">
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() => toggleGroup(editor, l.id, group)}
                                    className="h-3 w-3 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                  />
                                  <span className="truncate text-gray-700" title={l.board_game_name}>
                                    {l.board_game_name}
                                  </span>
                                  <span className="ml-auto shrink-0 font-mono text-gray-400">{l.listing_code}</span>
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )
                })()}
                <button
                  type="button"
                  onClick={() => toggleWant(g)}
                  title="Want any copy of this game (or expand to pick specific copies)"
                  className={`mt-auto border-t px-2 py-1.5 text-xs font-semibold transition-colors ${
                    wanted
                      ? 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100'
                      : 'border-gray-100 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600'
                  }`}
                >
                  {wanted ? 'Any copy ✓' : '+ Want any copy'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {count > BROWSE_PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-gray-500">
          <span>{count} games</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              className="rounded border border-gray-200 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
            >
              Prev
            </button>
            <span>Page {page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isFetching}
              className="rounded border border-gray-200 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const CONDITION_LABEL: Record<string, string> = {
  NEW: 'New',
  LIKE_NEW: 'Like New',
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Poor',
}

// Concrete copies behind a canonical-game want. Own copies are excluded (you
// won't receive your own). When `selectable`, each copy is an individual want
// toggle (a LISTING target on for all my items) — so you can want some copies of
// a game but not others (different language / missing pieces). Clicking a copy
// opens its full details.
interface GameCopiesProps {
  slug: string
  bggId: number
  username?: string
  editor?: Editor
  myListings?: EventListing[]
  selectable?: boolean
}

function GameCopies({ slug, bggId, username, editor, myListings, selectable }: GameCopiesProps) {
  const { data, isLoading } = useEventListings(slug, { board_game: bggId })
  const [detailCopyId, setDetailCopyId] = useState<number | null>(null)
  const all = data?.results ?? []
  const others = all.filter((l) => l.copy_owner_username !== username)
  const ownCount = all.length - others.length

  const canSelect = !!(selectable && editor && myListings && myListings.length > 0)
  const isCopyWanted = (listingId: number) =>
    !!editor && !!myListings && myListings.some((ml) => editor.isOn(ml.id, listingTargetKey(listingId)))

  function toggleCopy(l: EventListing) {
    if (!editor || !myListings || l.owner_too_far) return
    const key = listingTargetKey(l.id)
    const next = !isCopyWanted(l.id)
    editor.addTarget({
      key, type: 'LISTING', listingId: l.id, label: l.listing_code,
      gameId: l.board_game_id, gameName: l.board_game_name,
    })
    myListings.forEach((ml) => editor.toggle(ml.id, key, next))
  }

  if (isLoading) return <p className="px-3 py-2 text-xs text-gray-400">Loading copies…</p>

  return (
    <div className="px-3 py-2">
      {others.length === 0 ? (
        <p className="text-xs text-gray-400">No copies from other traders in this event yet.</p>
      ) : (
        <>
          {canSelect && (
            <p className="mb-1 text-[11px] font-medium text-gray-400">
              Pick the specific copies you'd accept:
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {others.map((l) => {
              const tooFar = !!l.owner_too_far
              const wanted = canSelect && !tooFar && isCopyWanted(l.id)
              const meta = [l.copy_language, CONDITION_LABEL[l.copy_condition] || l.copy_condition]
                .filter(Boolean)
                .join(' · ')
              return (
                <li
                  key={l.id}
                  className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
                    tooFar
                      ? 'border-gray-100 bg-gray-50 opacity-50'
                      : wanted
                      ? 'border-purple-300 bg-purple-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  {canSelect && (
                    <input
                      type="checkbox"
                      checked={wanted}
                      disabled={tooFar}
                      onChange={() => toggleCopy(l)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-purple-600 focus:ring-purple-500 disabled:cursor-not-allowed"
                      aria-label={`Want copy ${l.listing_code}`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => !tooFar && setDetailCopyId(l.copy_id)}
                    disabled={tooFar}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:underline disabled:cursor-default disabled:no-underline"
                    title={tooFar ? 'Owner is too far away' : 'View copy details'}
                  >
                    <span className="font-mono text-gray-500">{l.listing_code}</span>
                    <span className="text-gray-300">·</span>
                    <span className="shrink-0 text-gray-700">{l.copy_owner_username}</span>
                    {meta && (
                      <>
                        <span className="text-gray-300">·</span>
                        <span className="truncate text-gray-400">{meta}</span>
                      </>
                    )}
                    {tooFar && (
                      <span className="ml-auto shrink-0 rounded bg-orange-100 px-1 py-0.5 text-[10px] font-medium text-orange-600">
                        too far
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {ownCount > 0 && (
        <p className="mt-1 text-[11px] text-gray-400">
          ({ownCount} more {ownCount === 1 ? 'is' : 'are'} your own copy — excluded)
        </p>
      )}
      {detailCopyId != null && (
        <CopyDetailModal copyId={detailCopyId} onClose={() => setDetailCopyId(null)} />
      )}
    </div>
  )
}

// Full copy detail popup — lazily fetches GET /copies/{id}/ (readable by any
// authenticated user) so the wisher can inspect language/condition/missing
// pieces/notes/photos before committing to a specific copy.
function CopyDetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-2 py-1.5">
      <span className="w-28 shrink-0 text-[11px] font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <span className="whitespace-pre-wrap text-sm text-gray-700">{value}</span>
    </div>
  )
}

function CopyDetailModal({ copyId, onClose }: { copyId: number; onClose: () => void }) {
  const { data: copy, isLoading } = useCopy(copyId)
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Copy details"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-gray-900">
              {copy ? copy.board_game_name : 'Copy details'}
            </h3>
            {copy && (
              <p className="font-mono text-xs text-gray-400">
                {copy.listing_code} · {copy.owner_username}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isLoading || !copy ? (
          <p className="py-6 text-center text-sm text-gray-400">Loading…</p>
        ) : (
          <div className="divide-y divide-gray-50">
            <CopyDetailRow label="Condition" value={CONDITION_LABEL[copy.condition] || copy.condition} />
            <CopyDetailRow label="Language" value={copy.language} />
            <CopyDetailRow label="Edition" value={copy.edition} />
            <CopyDetailRow label="Sleeved" value={copy.sleeved !== 'UNKNOWN' ? copy.sleeved : ''} />
            <CopyDetailRow label="Includes" value={copy.includes_expansions} />
            <CopyDetailRow label="Missing" value={copy.missing_components} />
            <CopyDetailRow label="Upgraded" value={copy.upgraded_components} />
            <CopyDetailRow label="Component notes" value={copy.component_notes} />
            <CopyDetailRow label="Owner notes" value={copy.owner_notes} />
            <CopyDetailRow label="Status" value={copy.status !== 'ACTIVE' ? copy.status : ''} />
            {copy.photo_urls?.length > 0 && (
              <div className="py-2">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  Photos
                </p>
                <div className="flex flex-wrap gap-2">
                  {copy.photo_urls.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="block h-20 w-20 overflow-hidden rounded border border-gray-200"
                    >
                      <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
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
  /** Current buy-price (string; '' = none) for a canonical game. */
  priceForGame: (gameId: number) => string
  /** Stage a buy-price change for a canonical game. */
  setMoney: (gameId: number, value: string) => void
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
  const [moneyByGame, setMoneyByGame] = useState<Map<number, string>>(new Map())

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

  const priceForGame = useCallback(
    (gameId: number): string => {
      if (moneyByGame.has(gameId)) return moneyByGame.get(gameId)!
      return model.baseMoneyByGame.get(gameId) ?? ''
    },
    [moneyByGame, model.baseMoneyByGame]
  )

  const setMoney = useCallback(
    (gameId: number, value: string) => {
      setMoneyByGame((prev) => {
        const m = new Map(prev)
        const base = model.baseMoneyByGame.get(gameId) ?? ''
        if (value === base) m.delete(gameId)
        else m.set(gameId, value)
        return m
      })
    },
    [model.baseMoneyByGame]
  )

  const reset = useCallback(() => {
    setChanges(new Map())
    setSessionTargets(new Map())
    setMoneyByGame(new Map())
  }, [])

  const changedListingIds = useMemo(() => {
    const s = new Set<number>()
    for (const ck of changes.keys()) s.add(Number(ck.split('::')[0]))
    if (moneyByGame.size > 0) {
      const affectedKeys = new Set<string>()
      for (const t of targets) {
        if (moneyByGame.has(t.gameId)) affectedKeys.add(t.key)
      }
      for (const [listingId] of model.baseMatrix) {
        for (const k of affectedKeys) {
          if (isOn(listingId, k)) {
            s.add(listingId)
            break
          }
        }
      }
    }
    return s
  }, [changes, moneyByGame, targets, model.baseMatrix, isOn])

  return {
    editor: {
      targets,
      isOn,
      toggle,
      addTarget,
      priceForGame,
      setMoney,
      dirtyCount: changes.size + moneyByGame.size,
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
  myListings: EventListing[]
  editor: Editor
}

function VisualMode({ myListings, editor }: VisualModeProps) {
  const [addingFor, setAddingFor] = useState<number | null>(null)

  if (myListings.length === 0) return null

  return (
    <div className="space-y-3">
      {myListings.map((listing) => {
        const groups = groupTargetsByGame(editor.targets)
        const myWants = groups.filter((g) => groupIsOn(editor, listing.id, g))
        const addable = groups.filter((g) => !groupIsOn(editor, listing.id, g))
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
              {myWants.map((g) => {
                const specific = !g.anyTarget && g.copyTargets.length > 0
                return (
                  <span
                    key={g.gameId}
                    className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700"
                  >
                    <span className="max-w-[12rem] truncate">{g.gameName}</span>
                    <span className={specific ? 'text-blue-500' : 'text-purple-400'}>
                      ({groupBadge(g)})
                    </span>
                    <button
                      type="button"
                      onClick={() => groupKeys(g).forEach((k) => editor.toggle(listing.id, k, false))}
                      className="text-purple-400 hover:text-purple-700"
                      aria-label={`Remove ${g.gameName}`}
                    >
                      ×
                    </button>
                  </span>
                )
              })}
              {myWants.length === 0 && (
                <span className="text-xs text-gray-400">No wants yet — add the games you'd accept.</span>
              )}
            </div>

            {addingFor === listing.id ? (
              <div className="mt-3">
                {addable.length > 0 ? (
                  <>
                    <p className="mb-1 text-xs text-gray-400">Add a want this item would accept:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {addable.slice(0, 24).map((g) => (
                        <button
                          key={g.gameId}
                          type="button"
                          onClick={() => toggleGroup(editor, listing.id, g)}
                          className="rounded-full border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-purple-300 hover:text-purple-700"
                        >
                          + {g.gameName}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-gray-400">
                    Every want is already on this item — use “Browse games” above to add more.
                  </p>
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
  ratings: Map<number, number>
}

function GridMode({ slug, myListings, editor, username, ratings }: GridModeProps) {
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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-xs"
          onClick={() => {
            for (const g of groupTargetsByGame(editor.targets)) {
              const wantRating = ratings.get(g.gameId)
              if (wantRating == null) continue
              for (const l of myListings) {
                const ownRating = ratings.get(l.board_game_id)
                if (ownRating == null) continue
                if (ownRating <= wantRating && !groupIsOn(editor, l.id, g)) toggleGroup(editor, l.id, g)
              }
            }
          }}
        >
          Auto-tick by rating (give &le;-rated for &ge;-rated)
        </button>
      </div>
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
          {groupTargetsByGame(editor.targets).map((g) => {
            const gkey = String(g.gameId)
            const isOpen = expanded.has(gkey)
            const specific = !g.anyTarget && g.copyTargets.length > 0
            return (
              <Fragment key={gkey}>
                <tr className="group">
                  <th className="sticky left-0 z-10 border-b border-r border-gray-200 bg-white px-3 py-2 text-left font-normal group-hover:bg-indigo-50/40">
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleExpand(gkey)}
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
                      <span className="max-w-[12rem] truncate text-gray-700" title={g.gameName}>
                        {g.gameName}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          specific ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
                        }`}
                      >
                        {groupBadge(g)}
                      </span>
                    </span>
                  </th>
                  {myListings.map((l) => {
                    const on = groupIsOn(editor, l.id, g)
                    return (
                      <td
                        key={l.id}
                        className="border-b border-r border-gray-200 p-0 text-center group-hover:bg-indigo-50/40"
                      >
                        <button
                          type="button"
                          onClick={() => toggleGroup(editor, l.id, g)}
                          className={`m-1 h-5 w-5 rounded border ${
                            on
                              ? 'border-indigo-600 bg-indigo-600 text-white'
                              : 'border-gray-300 bg-white text-transparent hover:border-indigo-400'
                          }`}
                          title={`${g.gameName}  ↕  ${l.board_game_name}`}
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
                {isOpen && (
                  <tr>
                    <td colSpan={colCount} className="sticky left-0 border-b border-gray-200 bg-indigo-50/30">
                      <div className="text-xs">
                        <span className="px-3 py-1 font-medium text-gray-500">
                          {specific
                            ? 'Specific copies you selected (refine in “Browse games” above):'
                            : "Copies you'd be matched to receive:"}
                        </span>
                        <GameCopies slug={slug} bggId={g.gameId} username={username} />
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
  myListings: EventListing[],
  moneyEnabled: boolean
): Promise<void> {
  const listingById = new Map(myListings.map((l) => [l.id, l]))

  for (const listingId of editor.changedListingIds) {
    const listing = listingById.get(listingId)
    if (!listing) continue

    // Desired target set for this listing (apply staged changes over base).
    const desired = editor.targets.filter((t) => editor.isOn(listingId, t.key))
    const items: WantGroupItemPayload[] = desired.map((t) => {
      const item: WantGroupItemPayload = {
        target_type: t.type,
        ...(t.type === 'BOARD_GAME'
          ? { board_game: t.boardGameId! }
          : { event_listing: t.listingId! }),
      }
      if (moneyEnabled) {
        const raw = editor.priceForGame(t.gameId).trim()
        item.money_amount = raw === '' ? null : Number(raw)
      }
      return item
    })

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
        // Normal want builder always protects against duplicate game awards;
        // the advanced X-to-Y builder leaves this off.
        duplicate_protection: true,
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

type ViewMode = 'almanac' | 'visual' | 'grid'

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

  const customWantGroups = useMemo(() => {
    const autoIds = new Set([...model.wantGroupByListing.values()].map((wg) => wg.id))
    return wantGroups.filter((wg) => !autoIds.has(wg.id))
  }, [wantGroups, model.wantGroupByListing])

  const { editor } = useEditor(model)
  const wantGameCount = useMemo(
    () => new Set(editor.targets.map((t) => t.gameId)).size,
    [editor.targets]
  )

  const { data: ratingsData = [] } = useMyRatings()
  const rmap = useMemo(() => ratingMap(ratingsData), [ratingsData])

  const [view, setView] = useState<ViewMode>('almanac')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!slug) return
    setSaving(true)
    setSaveError(null)
    try {
      await persistChanges(slug, model, editor, myListings, event?.money_enabled ?? false)
      invalidateTrades(qc, slug)
      editor.reset()
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Failed to save. Please try again.'
      )
    } finally {
      setSaving(false)
    }
  }, [slug, model, editor, myListings, qc, event?.money_enabled])

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
              {(['almanac', 'visual', 'grid'] as ViewMode[]).map((m) => (
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
              {myListings.length} item{myListings.length !== 1 ? 's' : ''} · {wantGameCount} game
              {wantGameCount !== 1 ? 's' : ''} wanted
            </p>
          </div>

          {view === 'almanac' && (
            <GameBrowse
              slug={slug!}
              editor={editor}
              myListings={myListings}
              username={user?.username}
              customWantGroups={customWantGroups}
              moneyEnabled={event.money_enabled}
            />
          )}
          {view === 'visual' && <VisualMode myListings={myListings} editor={editor} />}
          {view === 'grid' && (
            <GridMode slug={slug!} myListings={myListings} editor={editor} username={user?.username} ratings={rmap} />
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
