import { Fragment, useMemo, useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Link, useNavigate } from 'react-router-dom'

import { useEvent, useEventListings, useEventGames, fetchEventListings } from '../../api/events'
import type { EventListing } from '../../api/events'
import { useCombos } from '../../api/combos'
import type { Combo } from '../../api/combos'
import { useCopy } from '../../api/copies'
import { useAuthStore } from '../../store/auth'
import { useMyRatings, ratingMap, useSetRating, useDeleteRating } from '../../api/ratings'
import ConfirmDialog from '../../components/ConfirmDialog'

import {
  useOfferGroups,
  useWantGroups,
  useWishes,
  createOfferGroupRaw,
  createWantGroupRaw,
  createWishRaw,
  patchWantGroupRaw,
  invalidateTrades,
  listGamePrices,
  setGamePrice,
  deleteGamePrice,
} from '../../api/trades'
import type { OfferGroup, WantGroup, WantGroupItemPayload, GamePrice } from '../../api/trades'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GameThumb } from '../../components/GameThumb'
import BackButton from '../../components/BackButton'

// ============================================================
// Model: a "want target" is one row in the matrix.
//   key  =  "L:<listingId>" (a specific copy)
// Each of my EventListings (a "my item") maps to a single-listing
// OfferGroup(max_give=1) → TradeWish → WantGroup(min_receive=1). The WantGroup's
// items are that listing's want list. Toggling a cell adds/removes a target from
// that listing's WantGroup. All persisted via the existing X-to-Y endpoints.
// ============================================================

interface Target {
  key: string
  listingId: number
  label: string
  /** Canonical game this target belongs to — listings group under it. */
  gameId: number
  gameName: string
  /** Thumbnail of the canonical game (for the Visual view's receive cluster). */
  thumbnail?: string | null
  /** Set when this target is a Combo (not a listing). */
  comboId?: number
}

// A canonical-game row in the want views: one game and its specific-copy
// (listing) targets. Collapses the duplicate per-copy rows under one game.
interface GameGroup {
  gameId: number
  gameName: string
  thumbnail?: string | null    // canonical game thumbnail (Visual view)
  copyTargets: Target[]        // specific listing selections
}

function groupTargetsByGame(targets: Target[]): GameGroup[] {
  const byGame = new Map<number, GameGroup>()
  for (const t of targets) {
    let g = byGame.get(t.gameId)
    if (!g) {
      g = { gameId: t.gameId, gameName: t.gameName, thumbnail: t.thumbnail, copyTargets: [] }
      byGame.set(t.gameId, g)
    }
    g.copyTargets.push(t)
  }
  return Array.from(byGame.values()).sort((a, b) => a.gameName.localeCompare(b.gameName))
}

function groupKeys(g: GameGroup): string[] {
  return g.copyTargets.map((t) => t.key)
}

function groupIsOn(editor: Editor, listingId: number, g: GameGroup): boolean {
  return groupKeys(g).some((k) => editor.isOn(listingId, k))
}

// Aggregate toggle: on→clear every copy of this game; off→select all its copies.
function toggleGroup(editor: Editor, listingId: number, g: GameGroup): void {
  const on = groupIsOn(editor, listingId, g)
  g.copyTargets.forEach((t) => editor.toggle(listingId, t.key, !on))
}

function groupBadge(g: GameGroup): string {
  const n = g.copyTargets.length
  return `${n} cop${n === 1 ? 'y' : 'ies'}`
}

function listingTargetKey(listingId: number): string {
  return `L:${listingId}`
}

// Combo targets render as their own one-row group, keyed off a synthetic gameId
// well above any real bgg id so they never collide with a game group.
const COMBO_GAME_OFFSET = 1_000_000_000

function comboTargetKey(comboId: number): string {
  return `K:${comboId}`
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
  /** Canonical gameId (bgg id) -> per-game price (UserGamePrice.price), server truth. */
  baseMoneyByGame: Map<number, string>
}

function buildModel(
  myListings: EventListing[],
  offerGroups: OfferGroup[],
  wantGroups: WantGroup[],
  wishes: { offer_group: number; want_group: number }[],
  gamePrices: GamePrice[],
  combos: Combo[],
  username: string | undefined
): PageModel {
  const wantGroupById = new Map(wantGroups.map((wg) => [wg.id, wg]))
  const wantGroupIdByOffer = new Map(wishes.map((w) => [w.offer_group, w.want_group]))

  // Pick the single-listing, X=1 offer group for each of my listings.
  const offerGroupByListing = new Map<number, OfferGroup>()
  for (const og of offerGroups) {
    if (og.max_give === 1 && og.items.length === 1) {
      const lid = og.items[0].event_listing
      if (lid == null) continue  // combo offer item: not a per-listing trio
      if (!offerGroupByListing.has(lid)) offerGroupByListing.set(lid, og)
    }
  }

  const wantGroupByListing = new Map<number, WantGroup>()
  const baseMatrix = new Map<number, Set<string>>()
  const baseTargets = new Map<string, Target>()
  // Per-game price comes from UserGamePrice rows (keyed by bgg id), not want items.
  const baseMoneyByGame = new Map<number, string>(
    gamePrices.map((gp) => [gp.board_game, gp.price])
  )

  for (const listing of myListings) {
    const og = offerGroupByListing.get(listing.id)
    const set = new Set<string>()
    if (og) {
      const wgId = wantGroupIdByOffer.get(og.id)
      const wg = wgId != null ? wantGroupById.get(wgId) : undefined
      if (wg) {
        wantGroupByListing.set(listing.id, wg)
        for (const item of wg.items) {
          if (item.combo != null) {
            const key = comboTargetKey(item.combo)
            set.add(key)
            if (!baseTargets.has(key)) {
              baseTargets.set(key, {
                key,
                listingId: 0,
                comboId: item.combo,
                label: item.combo_code ?? `Combo ${item.combo}`,
                gameId: COMBO_GAME_OFFSET + item.combo,
                gameName: `🎁 ${item.combo_name ?? 'Combo'}`,
                thumbnail: null,
              })
            }
            continue
          }
          if (item.event_listing == null) continue
          const key = listingTargetKey(item.event_listing)
          set.add(key)
          if (!baseTargets.has(key)) {
            baseTargets.set(key, {
              key,
              listingId: item.event_listing,
              label: item.listing_code ?? `Listing ${item.event_listing}`,
              // board_game_id is the canonical game of the listing's copy →
              // lets specific-copy wants fold under their game row.
              gameId: item.board_game_id ?? -item.event_listing,
              gameName: item.board_game_name ?? `Listing ${item.event_listing}`,
              thumbnail: item.board_game_thumbnail,
            })
          }
        }
      }
    }
    baseMatrix.set(listing.id, set)
  }

  // Surface every active combo (not the user's own) as a wantable target row,
  // even if not yet wanted. Its own one-row group (synthetic gameId) renders in
  // the visual/grid views; baseMatrix above already marks the wanted ones.
  for (const c of combos) {
    if (c.owner_username === username) continue
    const key = comboTargetKey(c.id)
    if (!baseTargets.has(key)) {
      baseTargets.set(key, {
        key,
        listingId: 0,
        comboId: c.id,
        label: c.combo_code,
        gameId: COMBO_GAME_OFFSET + c.id,
        gameName: `🎁 ${c.name}`,
        thumbnail: c.items[0]?.board_game_thumbnail ?? null,
      })
    }
  }

  return { wantGroupByListing, offerGroupByListing, baseMatrix, baseTargets, baseMoneyByGame }
}

// ============================================================
// Game browse — paginated card grid of the games available in THIS event.
// Expand a card to see the concrete copies it resolves to; "Want" selects every
// copy of that game for ALL my items, then the inline "Offering N/M" panel
// (or the grid) refines which of my offered items go toward that want.
// Replaces the old typeahead search; only event-scoped games, never the
// global 177k catalog.
// ============================================================

const BROWSE_PAGE_SIZE = 12

interface GameBrowseProps {
  slug: string
  editor: Editor
  myListings: EventListing[]
  username?: string
  customWantGroups: WantGroup[]
  moneyEnabled: boolean
}

interface RatingPriceRowProps {
  bggId: number
  moneyEnabled: boolean
  priceValue: string
  onPriceChange: (value: string) => void
}

/** Always-visible rating + per-game price shown on the face of a browse card. */
function RatingPriceRow({ bggId, moneyEnabled, priceValue, onPriceChange }: RatingPriceRowProps) {
  const { data: ratings = [] } = useMyRatings()
  const setRating = useSetRating()
  const delRating = useDeleteRating()
  const rating = ratings.find((r) => r.board_game === bggId)

  const [ratingInput, setRatingInput] = useState<string>(rating ? String(Number(rating.value)) : '')

  useEffect(() => {
    setRatingInput(rating ? String(Number(rating.value)) : '')
  }, [rating])

  // Browser step-arrow clicks fire onChange but never blur, so an onBlur-only
  // save misses them. Debounce a commit on any value change (fast typing keeps
  // resetting the timer, so multi-digit entry still commits the final value).
  useEffect(() => {
    const persisted = rating ? String(Number(rating.value)) : ''
    if (ratingInput === persisted) return
    const t = setTimeout(commitRating, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratingInput])

  function commitRating() {
    const raw = ratingInput.trim()
    if (raw === '') {
      if (rating) delRating.mutate(rating.id)
      return
    }
    const v = Number(raw)
    if (!Number.isNaN(v) && v >= 1 && v <= 10) {
      setRating.mutate({ board_game: bggId, value: v })
    } else {
      // Out-of-range / invalid input — revert to the persisted value so the
      // field never displays a value that wasn't saved.
      setRatingInput(rating ? String(Number(rating.value)) : '')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="text-moss">My rating</span>
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
          className="no-spinner w-14 rounded border border-ink/20 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        {rating && (
          <button
            type="button"
            onClick={() => {
              setRatingInput('')
              delRating.mutate(rating.id)
            }}
            className="text-moss/40 hover:text-red-500"
            aria-label="Clear rating"
          >
            ×
          </button>
        )}
        {(setRating.isSuccess || delRating.isSuccess) && <span className="text-green-600">✓</span>}
      </div>

      {moneyEnabled && (
        <div className="flex items-center gap-1.5">
          <span className="text-moss">Price $</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={priceValue}
            onChange={(e) => onPriceChange(e.target.value)}
            placeholder="—"
            title="One price for every copy of this game: the default ask for copies you own and your bid if you want it"
            className="no-spinner w-20 rounded border border-ink/20 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
          />
        </div>
      )}
    </div>
  )
}

interface WantGroupControlsProps {
  slug: string
  bggId: number
  username?: string
  customWantGroups: WantGroup[]
}

function WantGroupControls({ slug, bggId, username, customWantGroups }: WantGroupControlsProps) {
  const qc = useQueryClient()
  const [groupSel, setGroupSel] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [groupMsg, setGroupMsg] = useState<string | null>(null)

  // "Want this game" → every other-owned, in-range listing of it.
  async function targetListingIds(): Promise<number[]> {
    const res = await fetchEventListings(slug, { board_game: bggId, page_size: 200 })
    return res.results
      .filter((c) => c.copy_owner_username !== username && !c.owner_too_far)
      .map((c) => c.id)
  }

  async function addToExisting(groupId: number) {
    setGroupMsg(null)
    const group = customWantGroups.find((g) => g.id === groupId)
    if (!group) return
    let listingIds: number[]
    try {
      listingIds = await targetListingIds()
    } catch {
      setGroupMsg('Could not add.')
      return
    }
    const existing = new Set(group.items.map((i) => i.event_listing))
    const toAdd = listingIds.filter((id) => !existing.has(id))
    if (toAdd.length === 0) {
      setGroupMsg(listingIds.length ? 'Already in that group.' : 'No copies to add.')
      return
    }
    const items: WantGroupItemPayload[] = [
      ...group.items.map((i) =>
        i.combo != null ? { combo: i.combo } : { event_listing: i.event_listing as number }
      ),
      ...toAdd.map((id) => ({ event_listing: id })),
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
    let listingIds: number[]
    try {
      listingIds = await targetListingIds()
    } catch {
      setGroupMsg('Could not create group.')
      return
    }
    if (listingIds.length === 0) {
      setGroupMsg('No copies to add.')
      return
    }
    try {
      await createWantGroupRaw(slug, {
        name,
        min_receive: 1,
        items: listingIds.map((id) => ({ event_listing: id })),
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
    <div className="space-y-2 border-b border-ink/10 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-moss">Add to group</span>
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
          className="rounded border border-ink/20 px-1.5 py-0.5 text-moss focus:outline-none focus:ring-1 focus:ring-purple-400"
        >
          <option value="">Choose…</option>
          {customWantGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="__new__">+ New group…</option>
        </select>
        {groupMsg && <span className="text-moss/70">{groupMsg}</span>}
      </div>

      {showNew && (
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New group name"
            className="flex-1 rounded border border-ink/20 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-purple-400"
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
            className="text-moss/70 hover:text-moss"
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
      const group = groupByGame.get(bggId)
      return group ? myListings.some((l) => groupIsOn(editor, l.id, group)) : false
    },
    [editor, myListings, groupByGame]
  )

  async function toggleWant(g: { bgg_id: number; name: string }) {
    const group = groupByGame.get(g.bgg_id)
    if (group && myListings.some((l) => groupIsOn(editor, l.id, group))) {
      // Already wanted (any/specific) — clear every target for this game.
      myListings.forEach((l) => groupKeys(group).forEach((k) => editor.toggle(l.id, k, false)))
      return
    }
    // "Want any copy" = select every current copy explicitly, so the per-copy
    // checkboxes all light up and it persists as concrete copies.
    let copies: EventListing[]
    try {
      const res = await fetchEventListings(slug, { board_game: g.bgg_id, page_size: 200 })
      copies = res.results
    } catch {
      return
    }
    copies
      .filter((c) => c.copy_owner_username !== username && !c.owner_too_far)
      .forEach((c) => {
        const key = listingTargetKey(c.id)
        editor.addTarget({
          key, listingId: c.id, label: c.listing_code,
          gameId: c.board_game_id, gameName: c.board_game_name, thumbnail: c.board_game_thumbnail,
        })
        myListings.forEach((l) => editor.toggle(l.id, key, true))
      })
  }

  return (
    <div className="rounded-xl border border-ink/15 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1) }}
          placeholder="Search games available in this event…"
          className="min-w-[12rem] flex-1 rounded-xl border border-ink/20 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
        />
        <select
          value={ordering}
          onChange={(e) => { setOrdering(e.target.value as '-copies_count' | 'name'); setPage(1) }}
          className="rounded-xl border border-ink/20 px-2 py-1.5 text-sm text-moss"
          aria-label="Order games"
        >
          <option value="-copies_count">Most available</option>
          <option value="name">A–Z</option>
        </select>
      </div>

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-2">
        <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-ink/15 px-2 py-1 text-xs text-moss hover:border-indigo-300 has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50 has-[:checked]:text-indigo-700">
          <input
            type="checkbox"
            checked={wishlisted}
            onChange={(e) => { setWishlisted(e.target.checked); setPage(1) }}
            className="h-3 w-3 rounded border-ink/20 text-indigo-600"
          />
          In my BGG wishlist
        </label>

        <label className="flex items-center gap-1.5 text-xs text-moss">
          <span>Min rating</span>
          <input
            type="number"
            min={1}
            max={10}
            step={0.5}
            value={minRating}
            onChange={(e) => { setMinRating(e.target.value === '' ? '' : Number(e.target.value)); setPage(1) }}
            placeholder="—"
            className="no-spinner w-14 rounded-xl border border-ink/20 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          />
        </label>

        <select
          value={isExpansion == null ? '' : String(isExpansion)}
          onChange={(e) => {
            setIsExpansion(e.target.value === '' ? undefined : e.target.value === 'true')
            setPage(1)
          }}
          className="rounded-xl border border-ink/20 px-2 py-1 text-xs text-moss"
          aria-label="Expansion filter"
        >
          <option value="">Base games + expansions</option>
          <option value="false">Base games only</option>
          <option value="true">Expansions only</option>
        </select>

      </div>

      {totalPages > 1 && (
        <div className="mb-2 flex items-center justify-end gap-2 text-xs">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-xl border border-ink/20 px-2 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-moss">Page</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={page}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (v >= 1 && v <= totalPages) setPage(v)
            }}
            className="no-spinner w-14 rounded border border-ink/20 px-1.5 py-0.5 text-center"
            aria-label="Jump to page"
          />
          <span className="text-moss">/ {totalPages}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-xl border border-ink/20 px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
      {games.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-moss/70">
          {isFetching ? 'Loading games…' : 'No games with copies match.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((g) => {
            const wanted = isWanted(g.bgg_id)
            const open = expanded === g.bgg_id
            return (
              <div
                key={g.bgg_id}
                className={`flex flex-col overflow-hidden rounded-2xl border ${
                  wanted ? 'border-purple-300 ring-1 ring-purple-200' : 'border-ink/15'
                }`}
              >
                <div className="flex gap-2 p-2">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-gray-100">
                    {(g.thumbnail || g.image_url) ? (
                      <img src={g.thumbnail || g.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-ink" title={g.name}>
                      {g.name}
                    </p>
                    {g.year_published ? (
                      <p className="text-[11px] text-moss/70">{g.year_published}</p>
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
                <div className="border-t border-ink/10 px-2 py-1.5">
                  <RatingPriceRow
                    bggId={g.bgg_id}
                    moneyEnabled={moneyEnabled}
                    priceValue={editor.priceForGame(g.bgg_id)}
                    onPriceChange={(v) => editor.setMoney(g.bgg_id, v)}
                  />
                </div>
                {open && (
                  <div className="border-t border-ink/10 bg-gray-50/60">
                    <WantGroupControls
                      slug={slug}
                      bggId={g.bgg_id}
                      username={username}
                      customWantGroups={customWantGroups}
                    />
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
                    <div className="border-t border-ink/10 bg-indigo-50/40">
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
                                    className="h-3 w-3 shrink-0 rounded border-ink/20 text-indigo-600 focus:ring-indigo-500"
                                  />
                                  <span className="truncate text-ink" title={l.board_game_name}>
                                    {l.board_game_name}
                                  </span>
                                  <span className="ml-auto shrink-0 font-mono text-moss/70">{l.listing_code}</span>
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
                      : 'border-ink/10 text-moss hover:bg-indigo-50 hover:text-indigo-600'
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
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-moss">
          <span>{count} games</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              className="rounded border border-ink/15 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
            >
              Prev
            </button>
            <span>Page {page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isFetching}
              className="rounded border border-ink/15 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
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
  const { data, isLoading } = useEventListings(slug, { board_game: bggId, page_size: 200 })
  const [detailCopyId, setDetailCopyId] = useState<number | null>(null)
  const all = data?.results ?? []
  const others = all.filter((l) => l.copy_owner_username !== username)
  const ownCount = all.length - others.length

  const canSelect = !!(selectable && editor && myListings && myListings.length > 0)
  const isCopyWanted = (listingId: number) =>
    !!editor && !!myListings &&
    myListings.some((ml) => editor.isOn(ml.id, listingTargetKey(listingId)))

  function toggleCopy(l: EventListing) {
    if (!editor || !myListings || l.owner_too_far) return
    const next = !isCopyWanted(l.id)
    // Act on the items already offering this game (preserve per-item refinement);
    // if none offer it yet, this is a fresh want → apply to all my items.
    const group = groupTargetsByGame(editor!.targets).find((g) => g.gameId === bggId)
    const offering = group ? myListings.filter((ml) => groupIsOn(editor!, ml.id, group)) : []
    const acting = offering.length ? offering : myListings

    const key = listingTargetKey(l.id)
    editor.addTarget({
      key, listingId: l.id, label: l.listing_code,
      gameId: l.board_game_id, gameName: l.board_game_name, thumbnail: l.board_game_thumbnail,
    })
    acting.forEach((ml) => editor!.toggle(ml.id, key, next))
  }

  if (isLoading) return <p className="px-3 py-2 text-xs text-moss/70">Loading copies…</p>

  return (
    <div className="px-3 py-2">
      {others.length === 0 ? (
        <p className="text-xs text-moss/70">No copies from other traders in this event yet.</p>
      ) : (
        <>
          {canSelect && (
            <p className="mb-1 text-[11px] font-medium text-moss/70">
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
                      ? 'border-ink/10 bg-gray-50 opacity-50'
                      : wanted
                      ? 'border-purple-300 bg-purple-50'
                      : 'border-ink/15 bg-white'
                  }`}
                >
                  {canSelect && (
                    <input
                      type="checkbox"
                      checked={wanted}
                      disabled={tooFar}
                      onChange={() => toggleCopy(l)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-ink/20 text-purple-600 focus:ring-purple-500 disabled:cursor-not-allowed"
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
                    <span className="font-mono text-moss">{l.listing_code}</span>
                    <span className="text-moss/40">·</span>
                    <span className="shrink-0 text-ink">{l.copy_owner_username}</span>
                    {meta && (
                      <>
                        <span className="text-moss/40">·</span>
                        <span className="truncate text-moss/70">{meta}</span>
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
        <p className="mt-1 text-[11px] text-moss/70">
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
      <span className="w-28 shrink-0 text-[11px] font-medium uppercase tracking-wide text-moss/70">
        {label}
      </span>
      <span className="whitespace-pre-wrap text-sm text-ink">{value}</span>
    </div>
  )
}

function CopyDetailModal({ copyId, onClose }: { copyId: number; onClose: () => void }) {
  const { data: copy, isLoading } = useCopy(copyId)
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Copy details"
    >
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 min-w-0">
            <GameThumb src={copy?.board_game_thumbnail} alt={copy?.board_game_name ?? ''} className="h-12 w-12" />
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-ink">
                {copy ? copy.board_game_name : 'Copy details'}
              </h3>
              {copy && (
                <p className="font-mono text-xs text-moss/70">
                  {copy.listing_code} · {copy.owner_username}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-moss/70 hover:text-moss"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isLoading || !copy ? (
          <p className="py-6 text-center text-sm text-moss/70">Loading…</p>
        ) : (
          <div className="divide-y divide-gray-50">
            <CopyDetailRow label="Condition" value={CONDITION_LABEL[copy.condition] || copy.condition} />
            <CopyDetailRow label="Language" value={copy.language} />
            <CopyDetailRow label="Edition" value={copy.version_name && copy.version_name !== 'Unknown' ? copy.version_name : ''} />
            <CopyDetailRow label="Sleeved" value={copy.sleeved !== 'UNKNOWN' ? copy.sleeved : ''} />
            <CopyDetailRow label="Includes" value={copy.includes_expansions} />
            <CopyDetailRow label="Missing" value={copy.missing_components} />
            <CopyDetailRow label="Upgraded" value={copy.upgraded_components} />
            <CopyDetailRow label="Component notes" value={copy.component_notes} />
            <CopyDetailRow label="Owner notes" value={copy.owner_notes} />
            <CopyDetailRow label="Trade value" value={copy.trade_value_hint} />
            <CopyDetailRow label="Shipping" value={copy.shipping_constraints} />
            <CopyDetailRow label="Pickup" value={copy.pickup_available ? 'Available' : ''} />
            <CopyDetailRow label="Status" value={copy.status !== 'ACTIVE' ? copy.status : ''} />
            {copy.photo_urls?.length > 0 && (
              <div className="py-2">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-moss/70">
                  Photos
                </p>
                <div className="flex flex-wrap gap-2">
                  {copy.photo_urls.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="block h-20 w-20 overflow-hidden rounded border border-ink/15"
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
    </div>,
    document.body,
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
  /** Current per-game price (string; '' = none) for a canonical game. */
  priceForGame: (gameId: number) => string
  /** Stage a per-game price change for a canonical game. */
  setMoney: (gameId: number, value: string) => void
  /** Staged per-game price edits (gameId -> value), to persist on Save. */
  changedGamePrices: Map<number, string>
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
    return s
  }, [changes])

  return {
    editor: {
      targets,
      isOn,
      toggle,
      addTarget,
      priceForGame,
      setMoney,
      changedGamePrices: moneyByGame,
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
  if (myListings.length === 0) return null

  return (
    <div className="space-y-3">
      {myListings.map((listing) => {
        const groups = groupTargetsByGame(editor.targets)
        const myWants = groups.filter((g) => groupIsOn(editor, listing.id, g))
        return (
          <div key={listing.id} className="rounded-xl border border-ink/15 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{listing.board_game_name}</p>
                <p className="font-mono text-xs text-moss/70">{listing.listing_code}</p>
              </div>
              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                wants {myWants.length}
              </span>
            </div>

            {/* Give → receive: offered copy, then the wanted games as big thumbnails (× to remove). */}
            <div className="flex items-center gap-3 overflow-x-auto">
              <GameThumb
                src={listing.board_game_thumbnail}
                alt={listing.board_game_name ?? ''}
                className="h-16 w-16 shrink-0"
              />
              <svg className="h-5 w-5 shrink-0 text-moss/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label="trades for">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {myWants.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {myWants.map((g) => (
                    <div key={g.gameId} className="relative shrink-0">
                      <GameThumb src={g.thumbnail} alt={g.gameName ?? ''} className="h-16 w-16" />
                      <button
                        type="button"
                        onClick={() => groupKeys(g).forEach((k) => editor.toggle(listing.id, k, false))}
                        aria-label={`Remove ${g.gameName}`}
                        title={`Remove ${g.gameName}`}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-ink bg-white text-xs font-bold text-red-600 shadow-sm hover:bg-red-50"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-moss/70">No wants yet — add games in the Almanac view.</span>
              )}
            </div>
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
  moneyEnabled: boolean
}

function GridMode({ slug, myListings, editor, username, ratings, moneyEnabled }: GridModeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const s = new Set(prev)
      if (s.has(key)) s.delete(key)
      else s.add(key)
      return s
    })

  const { data: listingsData } = useEventListings(slug, { page_size: 500 })
  const askByListing = useMemo(() => {
    const m = new Map<number, number>()
    for (const el of listingsData?.results ?? []) {
      if (el.resolved_ask != null && el.resolved_ask !== '') m.set(el.id, Number(el.resolved_ask))
    }
    return m
  }, [listingsData])

  if (editor.targets.length === 0) {
    return (
      <div className="rounded-xl bg-gray-50 px-3 py-6 text-center text-sm text-moss/70">
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
          className="rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-xs font-semibold text-moss hover:bg-sage/30 transition-colors"
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
    <div className="overflow-auto rounded-xl border border-ink/15 bg-white" style={{ maxHeight: '70vh' }}>
      <table className="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 border-b border-r border-ink/15 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-moss">
              Want \ My item
            </th>
            {myListings.map((l) => (
              <th
                key={l.id}
                className="sticky top-0 z-20 border-b border-r border-ink/15 bg-gray-50 px-1 py-2 align-bottom"
              >
                <div className="mx-auto h-28 w-8">
                  <div className="flex h-full -rotate-180 items-center justify-center [writing-mode:vertical-rl]">
                    <span className="truncate text-xs font-medium text-moss" title={l.board_game_name}>
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
            const specific = g.copyTargets.length > 0
            const askValues = g.copyTargets
              .map((t) => askByListing.get(t.listingId))
              .filter((v): v is number => v != null)
            const minAsk = askValues.length ? Math.min(...askValues) : null
            return (
              <Fragment key={gkey}>
                <tr className="group">
                  <th className="sticky left-0 z-10 border-b border-r border-ink/15 bg-white px-3 py-2 text-left font-normal group-hover:bg-indigo-50/40">
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleExpand(gkey)}
                        className="shrink-0 text-moss/70 hover:text-indigo-600"
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
                      <span className="max-w-[12rem] truncate text-ink" title={g.gameName}>
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
                    {moneyEnabled && g.gameId >= 0 && g.gameId < COMBO_GAME_OFFSET && (
                      <div className="mt-1 flex items-center gap-1 text-xs">
                        <span className="text-moss">$</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={editor.priceForGame(g.gameId)}
                          onChange={(e) => editor.setMoney(g.gameId, e.target.value)}
                          placeholder="price"
                          className="no-spinner w-20 rounded border border-ink/20 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                        />
                      </div>
                    )}
                    {moneyEnabled && g.gameId >= 0 && g.gameId < COMBO_GAME_OFFSET && (
                      <div className="mt-0.5 text-xs text-moss/70">
                        ask: {minAsk != null ? `$${minAsk.toFixed(2)}` : '—'}
                      </div>
                    )}
                  </th>
                  {myListings.map((l) => {
                    const on = groupIsOn(editor, l.id, g)
                    return (
                      <td
                        key={l.id}
                        className="border-b border-r border-ink/15 p-0 text-center group-hover:bg-indigo-50/40"
                      >
                        <button
                          type="button"
                          onClick={() => toggleGroup(editor, l.id, g)}
                          className={`m-1 h-5 w-5 rounded border ${
                            on
                              ? 'border-ink bg-butter text-ink'
                              : 'border-ink/20 bg-white text-transparent hover:border-indigo-400'
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
                    <td colSpan={colCount} className="sticky left-0 border-b border-ink/15 bg-indigo-50/30">
                      <div className="text-xs">
                        <span className="px-3 py-1 font-medium text-moss">
                          {specific
                            ? 'Specific copies you selected (refine in "Browse games" above):'
                            : "Copies you'd be matched to receive:"}
                        </span>
                        <GameCopies slug={slug} bggId={g.gameId} username={username} editor={editor} myListings={myListings} selectable />
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
  // Per-game prices live on UserGamePrice (one per (user, event, game)) — they
  // default both the sell ask on copies you own and your bid on wants. Persist
  // each staged price independently of the want lists.
  if (moneyEnabled) {
    for (const [gameId, value] of editor.changedGamePrices) {
      // Per-game prices are keyed by bgg id; LISTING-only targets use a negative
      // synthetic id and combos use a >= COMBO_GAME_OFFSET id — neither is priceable.
      if (gameId < 0 || gameId >= COMBO_GAME_OFFSET) continue
      const raw = (value ?? '').trim()
      if (raw === '') {
        await deleteGamePrice(slug, gameId)
      } else {
        await setGamePrice(slug, gameId, raw)
      }
    }
  }

  const listingById = new Map(myListings.map((l) => [l.id, l]))

  for (const listingId of editor.changedListingIds) {
    const listing = listingById.get(listingId)
    if (!listing) continue

    // Desired target set for this listing (apply staged changes over base).
    const desired = editor.targets.filter((t) => editor.isOn(listingId, t.key))
    const items: WantGroupItemPayload[] = desired.map((t) =>
      t.comboId != null ? { combo: t.comboId } : { event_listing: t.listingId }
    )

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
  const navigate = useNavigate()
  const [confirmAdvanced, setConfirmAdvanced] = useState(false)
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const { data: event, isLoading: eventLoading, isError: eventError } = useEvent(slug)
  const { data: listingsData } = useEventListings(slug, { user: user?.username })
  const { data: offerGroups = [] } = useOfferGroups(slug)
  const { data: wantGroups = [] } = useWantGroups(slug)
  const { data: wishes = [] } = useWishes(slug)
  const { data: combosData } = useCombos(slug)
  const combos = useMemo(() => combosData?.results ?? [], [combosData])
  // Per-game prices (UserGamePrice) — the source of truth for each game's price.
  const { data: gamePrices = [] } = useQuery({
    queryKey: ['trades', 'game-prices', slug ?? ''],
    queryFn: () => listGamePrices(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  })

  const myListings = useMemo(() => listingsData?.results ?? [], [listingsData])

  const model = useMemo(
    () => buildModel(myListings, offerGroups, wantGroups, wishes, gamePrices, combos, user?.username),
    [myListings, offerGroups, wantGroups, wishes, gamePrices, combos, user?.username]
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
    setSaveError(null)
    for (const [, value] of editor.changedGamePrices) {
      const raw = (value ?? '').trim()
      if (raw !== '' && Number(raw) <= 0) {
        setSaveError('Price must be greater than $0.')
        return
      }
    }
    setSaving(true)
    try {
      await persistChanges(slug, model, editor, myListings, event?.money_enabled ?? false)
      invalidateTrades(qc, slug)
      qc.invalidateQueries({ queryKey: ['trades', 'game-prices', slug] })
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
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-8 sm:px-6 animate-pulse">
        <div className="h-8 w-2/3 rounded bg-gray-100" />
        <div className="h-64 rounded-xl bg-gray-100" />
      </div>
    )
  }

  if (eventError || !event) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-red-700">Event not found or failed to load.</p>
          <BackButton to="/events" className="mt-3">Back to events</BackButton>
        </div>
      </div>
    )
  }

  if (!event.is_participant && !event.is_organizer) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 px-5 py-8 text-center">
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
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-8 sm:px-6">
      {confirmAdvanced && (
        <ConfirmDialog
          title="Open advanced builder?"
          body="The advanced X-to-Y builder is a manual editor for power users. Your current wants are saved; you can come back any time."
          confirmLabel="Open builder"
          onConfirm={() => {
            setConfirmAdvanced(false)
            navigate(`/events/${slug}/builder`)
          }}
          onCancel={() => setConfirmAdvanced(false)}
        />
      )}
      <BackButton to={`/events/${slug}`}>Back to {event.name}</BackButton>

      <div className="rounded-xl border border-ink/15 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">My Wants</h1>
            <p className="mt-1 text-sm text-moss">
              {event.name}
              <span className="mx-2 text-moss/40">·</span>
              For each item you offer, pick the games you'd accept in return.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmAdvanced(true)}
            className="rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-xs font-semibold text-moss hover:bg-sage/30 transition-colors"
          >
            Advanced (X-to-Y) builder
          </button>
        </div>
      </div>

      {event.inputs_locked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This event is locked for matching — want lists can no longer be edited.
        </div>
      )}

      {myListings.length === 0 ? (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-3 text-sm text-yellow-700">
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
            <div className="inline-flex rounded-2xl border border-ink/15 bg-white p-0.5">
              {(['almanac', 'visual', 'grid'] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setView(m)}
                  className={`rounded-xl px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                    view === m ? 'bg-butter text-ink shadow-pop-sm' : 'text-moss hover:text-ink'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="text-xs text-moss/70">
              {myListings.length} item{myListings.length !== 1 ? 's' : ''} · {wantGameCount} game
              {wantGameCount !== 1 ? 's' : ''} wanted
            </p>
          </div>

          <div className={event.inputs_locked ? 'pointer-events-none opacity-60' : undefined}>
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
              <GridMode slug={slug!} myListings={myListings} editor={editor} username={user?.username} ratings={rmap} moneyEnabled={event.money_enabled} />
            )}
          </div>
        </>
      )}

      {/* Sticky save bar */}
      {editor.dirtyCount > 0 && !event.inputs_locked && (
        <div className="sticky bottom-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full border border-ink/20 bg-white px-5 py-2.5 shadow-lg">
          <span className="text-sm text-moss">
            {editor.dirtyCount} unsaved change{editor.dirtyCount !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => editor.reset()}
              disabled={saving}
              className="rounded-full px-3 py-1.5 text-sm text-moss hover:text-ink disabled:opacity-50"
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-full border-2 border-ink bg-butter px-5 py-1.5 text-sm font-bold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
      {saveError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {saveError}
        </div>
      )}
    </div>
  )
}
