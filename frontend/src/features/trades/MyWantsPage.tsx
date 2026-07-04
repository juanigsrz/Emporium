import { Fragment, useMemo, useState, useCallback, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePageTitle } from '../../hooks/usePageTitle'
import type { TFunction } from 'i18next'

import { useEvent, useEventListings, useEventGames, fetchEventListings } from '../../api/events'
import type { EventListing } from '../../api/events'
import { useCombos } from '../../api/combos'
import type { Combo } from '../../api/combos'
import { useAuthStore } from '../../store/auth'
import { useMyRatings, ratingMap, useSetRating, useDeleteRating } from '../../api/ratings'
import ConfirmDialog from '../../components/ConfirmDialog'
import { CopyDetailModal } from '../../components/CopyDetailModal'

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
  /** Effective bid for a wished combo (resolved_bid), for read-only display. */
  bid?: string | null
}

// A canonical-game row in the want views: one game and its specific-copy
// (listing) targets. Collapses the duplicate per-copy rows under one game.
interface GameGroup {
  gameId: number
  gameName: string
  thumbnail?: string | null    // canonical game thumbnail (Visual view)
  copyTargets: Target[]        // specific listing selections
  /** Combo target keys whose bundle includes this game (Grid view). A game
   *  wanted ONLY inside a bundle has no copyTargets but non-empty comboKeys. */
  comboKeys?: string[]
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
  return g.copyTargets.map((t) => t.key).concat(g.comboKeys ?? [])
}

function groupIsOn(editor: Editor, listingId: number, g: GameGroup): boolean {
  return groupKeys(g).some((k) => editor.isOn(listingId, k))
}

// Aggregate toggle: on→clear every copy/bundle of this game; off→select them all.
function toggleGroup(editor: Editor, listingId: number, g: GameGroup): void {
  const on = groupIsOn(editor, listingId, g)
  groupKeys(g).forEach((k) => editor.toggle(listingId, k, !on))
}

function groupBadge(t: TFunction, g: GameGroup): string {
  const n = g.copyTargets.length
  if (n === 0 && (g.comboKeys?.length ?? 0) > 0) return t('trades.grid.viaBundleBadge')
  return t('trades.copiesCount', { count: n })
}

// Grid rows = canonical-game groups from real game/listing targets, plus a row
// for each member game of any WISHED combo (so the combo is reachable in its
// dropdown). Combos never get their own row.
function buildGridRows(editor: Editor, combos: Combo[], columns: OfferColumn[]): GameGroup[] {
  const gameGroups = groupTargetsByGame(
    editor.targets.filter((t) => t.comboId == null && t.gameId < COMBO_GAME_OFFSET)
  )
  const byGame = new Map<number, GameGroup>(
    gameGroups.map((g) => [g.gameId, { ...g, comboKeys: [] as string[] }])
  )
  for (const c of combos) {
    if (!columns.some((col) => editor.isOn(col.id, comboTargetKey(c.id)))) continue
    const key = comboTargetKey(c.id)
    for (const it of c.items) {
      let g = byGame.get(it.board_game_id)
      if (!g) {
        g = {
          gameId: it.board_game_id,
          gameName: it.board_game_name,
          thumbnail: it.board_game_thumbnail,
          copyTargets: [],
          comboKeys: [],
        }
        byGame.set(it.board_game_id, g)
      }
      if (!g.comboKeys!.includes(key)) g.comboKeys!.push(key)
    }
  }
  return Array.from(byGame.values()).sort((a, b) => a.gameName.localeCompare(b.gameName))
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

// ---- Offer columns: an offered item is either a listing I own or one of MY
// combos. The grid/catalog matrix keys columns by a number; combo columns are
// shifted by COMBO_COL_OFFSET so they never collide with a listing id. (This is
// the column-space twin of COMBO_GAME_OFFSET, which lives in the row/game space.)

const COMBO_COL_OFFSET = 2_000_000_000

function comboColId(comboId: number): number {
  return COMBO_COL_OFFSET + comboId
}

interface OfferColumn {
  id: number                   // matrix key: listing.id OR comboColId(combo.id)
  isCombo: boolean
  name: string                 // board_game_name | combo.name
  code: string                 // listing_code   | combo_code
  thumbnail?: string | null
  listingId?: number           // when !isCombo
  comboId?: number             // when isCombo
  resolvedAsk?: string | null  // listings only (Grid money header)
  boardGameId?: number         // listings only (rating auto-tick / per-game price)
}

function listingColumn(l: EventListing): OfferColumn {
  return {
    id: l.id,
    isCombo: false,
    name: l.board_game_name,
    code: l.listing_code,
    thumbnail: l.board_game_thumbnail,
    listingId: l.id,
    resolvedAsk: l.resolved_ask,
    boardGameId: l.board_game_id,
  }
}

function comboColumn(c: Combo): OfferColumn {
  return {
    id: comboColId(c.id),
    isCombo: true,
    name: c.name,
    code: c.combo_code,
    thumbnail: c.items[0]?.board_game_thumbnail ?? null,
    comboId: c.id,
  }
}

// ---- Derive page model from the loaded trade objects ----

interface PageModel {
  /** For each offer column, the want-group that holds its 1-to-1 want list (if any). */
  wantGroupByCol: Map<number, WantGroup>
  offerGroupByCol: Map<number, OfferGroup>
  /** column id -> set of target keys currently in its want list (server truth). */
  baseMatrix: Map<number, Set<string>>
  /** All want targets referenced by any of my lists, keyed for dedupe. */
  baseTargets: Map<string, Target>
  /** Canonical gameId (bgg id) -> per-game price (UserGamePrice.price), server truth. */
  baseMoneyByGame: Map<number, string>
}

function buildModel(
  columns: OfferColumn[],
  offerGroups: OfferGroup[],
  wantGroups: WantGroup[],
  wishes: { offer_group: number; want_group: number }[],
  gamePrices: GamePrice[],
): PageModel {
  const wantGroupById = new Map(wantGroups.map((wg) => [wg.id, wg]))
  const wantGroupIdByOffer = new Map(wishes.map((w) => [w.offer_group, w.want_group]))

  // Pick the single-item, X=1 offer group for each offer column (listing or combo).
  const offerGroupByCol = new Map<number, OfferGroup>()
  for (const og of offerGroups) {
    if (og.max_give === 1 && og.items.length === 1) {
      const it = og.items[0]
      const colId = it.event_listing ?? (it.combo != null ? comboColId(it.combo) : null)
      if (colId == null) continue
      if (!offerGroupByCol.has(colId)) offerGroupByCol.set(colId, og)
    }
  }

  const wantGroupByCol = new Map<number, WantGroup>()
  const baseMatrix = new Map<number, Set<string>>()
  const baseTargets = new Map<string, Target>()
  // Per-game price comes from UserGamePrice rows (keyed by bgg id), not want items.
  const baseMoneyByGame = new Map<number, string>(
    gamePrices.map((gp) => [gp.board_game, gp.price])
  )

  for (const col of columns) {
    const og = offerGroupByCol.get(col.id)
    const set = new Set<string>()
    if (og) {
      const wgId = wantGroupIdByOffer.get(og.id)
      const wg = wgId != null ? wantGroupById.get(wgId) : undefined
      if (wg) {
        wantGroupByCol.set(col.id, wg)
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
                bid: item.resolved_bid ?? null,
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
    baseMatrix.set(col.id, set)
  }

  return { wantGroupByCol, offerGroupByCol, baseMatrix, baseTargets, baseMoneyByGame }
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
  columns: OfferColumn[]
  username?: string
  customWantGroups: WantGroup[]
  moneyEnabled: boolean
  combos: Combo[]
}

interface RatingPriceRowProps {
  bggId: number
  moneyEnabled: boolean
  priceValue: string
  onPriceChange: (value: string) => void
}

/** Always-visible rating + per-game price shown on the face of a browse card. */
function RatingPriceRow({ bggId, moneyEnabled, priceValue, onPriceChange }: RatingPriceRowProps) {
  const { t } = useTranslation()
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
    const timer = setTimeout(commitRating, 600)
    return () => clearTimeout(timer)
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
        <span className="text-moss">{t('trades.rating.myRatingLabel')}</span>
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
            aria-label={t('trades.rating.clearRatingAriaLabel')}
          >
            ×
          </button>
        )}
        {(setRating.isSuccess || delRating.isSuccess) && <span className="text-green-600">✓</span>}
      </div>

      {moneyEnabled && (
        <div className="flex items-center gap-1.5">
          <span className="text-moss">{t('trades.rating.biddingPriceLabel')}</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={priceValue}
            onChange={(e) => onPriceChange(e.target.value)}
            placeholder="—"
            title={t('trades.rating.priceTitle')}
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
  const { t } = useTranslation()
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
      setGroupMsg(t('trades.errors.couldNotAdd'))
      return
    }
    const existing = new Set(group.items.map((i) => i.event_listing))
    const toAdd = listingIds.filter((id) => !existing.has(id))
    if (toAdd.length === 0) {
      setGroupMsg(listingIds.length ? t('trades.wantGroupControls.alreadyInGroup') : t('trades.wantGroupControls.noCopiesToAdd'))
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
      setGroupMsg(t('trades.wantGroupControls.added'))
    } catch {
      setGroupMsg(t('trades.errors.couldNotAdd'))
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
      setGroupMsg(t('trades.errors.couldNotCreateGroup'))
      return
    }
    if (listingIds.length === 0) {
      setGroupMsg(t('trades.wantGroupControls.noCopiesToAdd'))
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
      setGroupMsg(t('trades.wantGroupControls.groupCreated'))
    } catch {
      setGroupMsg(t('trades.errors.couldNotCreateGroup'))
    }
  }

  return (
    <div className="space-y-2 border-b border-ink/10 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-moss">{t('trades.wantGroupControls.addToGroupLabel')}</span>
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
          <option value="">{t('trades.wantGroupControls.choosePlaceholder')}</option>
          {customWantGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="__new__">{t('trades.wantGroupControls.newGroupOption')}</option>
        </select>
        {groupMsg && <span className="text-moss/70">{groupMsg}</span>}
      </div>

      {showNew && (
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('trades.wantGroupControls.newGroupNamePlaceholder')}
            className="flex-1 rounded border border-ink/20 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
          <button
            type="button"
            onClick={createAndAdd}
            className="rounded bg-purple-600 px-2 py-0.5 font-medium text-white hover:bg-purple-500"
          >
            {t('trades.create')}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowNew(false)
              setNewName('')
            }}
            className="text-moss/70 hover:text-moss"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}
    </div>
  )
}

function GameBrowse({ slug, editor, columns, username, customWantGroups, moneyEnabled, combos }: GameBrowseProps) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [ordering, setOrdering] = useState<'-copies_count' | 'name'>('-copies_count')
  const [expanded, setExpanded] = useState<number | null>(null)

  // Per-expanded-game selection, kept independent so the two checklists in the
  // dropdown don't yank each other around: `offerItems` = which of my items I'm
  // giving, `wantKeys` = which copies/combos I'd accept. The saved offers are
  // their cross-product, applied additively as either side is toggled.
  const [offerItems, setOfferItems] = useState<Set<number>>(new Set())
  const [wantKeys, setWantKeys] = useState<Set<string>>(new Set())

  // Filter bar state
  const [wishlisted, setWishlisted] = useState(false)
  const [minRating, setMinRating] = useState<number | ''>('')
  const [isExpansion, setIsExpansion] = useState<boolean | undefined>(undefined)
  const [yearFrom, setYearFrom] = useState<number | ''>('')
  const [yearTo, setYearTo] = useState<number | ''>('')
  const [rankMax, setRankMax] = useState<number | ''>('')
  const [minWeight, setMinWeight] = useState<number | ''>('')
  const [maxWeight, setMaxWeight] = useState<number | ''>('')

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
    year_from: yearFrom !== '' ? yearFrom : undefined,
    year_to: yearTo !== '' ? yearTo : undefined,
    rank_max: rankMax !== '' ? rankMax : undefined,
    min_weight: minWeight !== '' ? minWeight : undefined,
    max_weight: maxWeight !== '' ? maxWeight : undefined,
  })
  const games = data?.results ?? []
  const count = data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(count / BROWSE_PAGE_SIZE))

  const isWanted = useCallback(
    (bggId: number) => {
      const group = groupByGame.get(bggId)
      return group ? columns.some((col) => groupIsOn(editor, col.id, group)) : false
    },
    [editor, columns, groupByGame]
  )

  async function toggleWant(g: { bgg_id: number; name: string }) {
    const group = groupByGame.get(g.bgg_id)
    if (group && columns.some((col) => groupIsOn(editor, col.id, group))) {
      // Already wanted — clear every target for this game.
      columns.forEach((col) => groupKeys(group).forEach((k) => editor.toggle(col.id, k, false)))
      return
    }
    // Stage every other-owned, in-range copy as an accepted target, but offer NO
    // items yet — the user consciously ticks which of their items offer it in the
    // dropdown (auto-opened below).
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
        editor.addTarget({
          key: listingTargetKey(c.id), listingId: c.id, label: c.listing_code,
          gameId: c.board_game_id, gameName: c.board_game_name, thumbnail: c.board_game_thumbnail,
        })
      })
    setExpanded(g.bgg_id)
  }

  // Seed the two selections from saved/staged state whenever a different game is
  // opened: a copy/combo already referenced by any of my lists counts as wanted,
  // and any item that offers one counts as offering. Read-only — opening a card
  // changes nothing until the user clicks.
  useEffect(() => {
    if (expanded == null) return
    const keys = new Set<string>()
    for (const target of editor.targets) {
      if (target.comboId == null && target.gameId === expanded) keys.add(target.key)
    }
    for (const c of combos) {
      if (c.items.some((it) => it.board_game_id === expanded) &&
          editor.targets.some((t) => t.comboId === c.id)) {
        keys.add(comboTargetKey(c.id))
      }
    }
    const items = new Set<number>()
    for (const col of columns) {
      if (Array.from(keys).some((k) => editor.isOn(col.id, k))) items.add(col.id)
    }
    setWantKeys(keys)
    setOfferItems(items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  // Toggle one of my items in/out of the offering set, additively re-applying it
  // across the currently-wanted copies. Never touches `wantKeys`.
  function toggleOfferItem(col: OfferColumn) {
    const adding = !offerItems.has(col.id)
    setOfferItems((prev) => {
      const next = new Set(prev)
      if (adding) next.add(col.id)
      else next.delete(col.id)
      return next
    })
    wantKeys.forEach((key) => editor.toggle(col.id, key, adding))
  }

  // Toggle one copy/combo in/out of the wanted set, offered by every item already
  // in the offering set (or none yet — picking the copy first is allowed).
  function toggleWantKey(target: Target) {
    const adding = !wantKeys.has(target.key)
    setWantKeys((prev) => {
      const next = new Set(prev)
      if (adding) next.add(target.key)
      else next.delete(target.key)
      return next
    })
    editor.addTarget(target)
    offerItems.forEach((lid) => editor.toggle(lid, target.key, adding))
  }

  return (
    <div className="rounded-xl border border-ink/15 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1) }}
          placeholder={t('trades.browse.searchPlaceholder')}
          className="min-w-[12rem] flex-1 rounded-xl border border-ink/20 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
        />
        <select
          value={ordering}
          onChange={(e) => { setOrdering(e.target.value as '-copies_count' | 'name'); setPage(1) }}
          className="rounded-xl border border-ink/20 px-2 py-1.5 text-sm text-moss"
          aria-label={t('trades.browse.orderAriaLabel')}
        >
          <option value="-copies_count">{t('trades.browse.mostAvailableOption')}</option>
          <option value="name">{t('trades.browse.aToZOption')}</option>
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
          {t('trades.browse.inWishlistLabel')}
        </label>

        <label className="flex items-center gap-1.5 text-xs text-moss">
          <span>{t('trades.browse.minRatingLabel')}</span>
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
          aria-label={t('trades.browse.expansionFilterAriaLabel')}
        >
          <option value="">{t('trades.browse.baseAndExpansionsOption')}</option>
          <option value="false">{t('trades.browse.baseOnlyOption')}</option>
          <option value="true">{t('trades.browse.expansionsOnlyOption')}</option>
        </select>

        <label className="flex items-center gap-1.5 text-xs text-moss">
          <span>{t('trades.browse.yearLabel')}</span>
          <input
            type="number"
            value={yearFrom}
            onChange={(e) => { setYearFrom(e.target.value === '' ? '' : Number(e.target.value)); setPage(1) }}
            placeholder={t('trades.browse.fromPlaceholder')}
            aria-label={t('trades.browse.yearFromAria')}
            className="no-spinner w-16 rounded-xl border border-ink/20 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          />
          <span>–</span>
          <input
            type="number"
            value={yearTo}
            onChange={(e) => { setYearTo(e.target.value === '' ? '' : Number(e.target.value)); setPage(1) }}
            placeholder={t('trades.browse.toPlaceholder')}
            aria-label={t('trades.browse.yearToAria')}
            className="no-spinner w-16 rounded-xl border border-ink/20 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs text-moss">
          <span>{t('trades.browse.rankMaxLabel')}</span>
          <input
            type="number"
            min={1}
            value={rankMax}
            onChange={(e) => { setRankMax(e.target.value === '' ? '' : Number(e.target.value)); setPage(1) }}
            placeholder="—"
            aria-label={t('trades.browse.rankMaxLabel')}
            className="no-spinner w-16 rounded-xl border border-ink/20 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs text-moss">
          <span>{t('trades.browse.complexityLabel')}</span>
          <input
            type="number"
            min={1}
            max={5}
            step={0.1}
            value={minWeight}
            onChange={(e) => { setMinWeight(e.target.value === '' ? '' : Number(e.target.value)); setPage(1) }}
            placeholder={t('trades.browse.fromPlaceholder')}
            aria-label={t('trades.browse.complexityMinAria')}
            className="no-spinner w-14 rounded-xl border border-ink/20 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          />
          <span>–</span>
          <input
            type="number"
            min={1}
            max={5}
            step={0.1}
            value={maxWeight}
            onChange={(e) => { setMaxWeight(e.target.value === '' ? '' : Number(e.target.value)); setPage(1) }}
            placeholder={t('trades.browse.toPlaceholder')}
            aria-label={t('trades.browse.complexityMaxAria')}
            className="no-spinner w-14 rounded-xl border border-ink/20 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          />
        </label>

      </div>

      {totalPages > 1 && (
        <div className="mb-2 flex items-center justify-end gap-2 text-xs">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-xl border border-ink/20 px-2 py-1 disabled:opacity-40"
          >
            {t('trades.prev')}
          </button>
          <span className="text-moss">{t('trades.browse.pageLabel')}</span>
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
            aria-label={t('trades.browse.jumpToPageAriaLabel')}
          />
          <span className="text-moss">{t('trades.browse.ofTotalPages', { total: totalPages })}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-xl border border-ink/20 px-2 py-1 disabled:opacity-40"
          >
            {t('trades.next')}
          </button>
        </div>
      )}
      {games.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-moss/70">
          {isFetching ? t('trades.browse.loadingGames') : t('trades.browse.noGamesMatch')}
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
                  wanted ? 'border-purple-400 ring-2 ring-purple-300' : 'border-ink/20'
                }`}
              >
                <div className="flex gap-2 p-2">
                  <div className="h-32 w-32 shrink-0 overflow-hidden rounded bg-gray-100">
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
                      {/* {g.copies_count} cop{g.copies_count === 1 ? 'y' : 'ies'} {open ? '▲' : '▼'} */}
                      {t('trades.browse.expandLabel')} {open ? '▲' : '▼'}
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
                    {/* Which of my items offer this game (empty by default) */}
                    <div className="border-b border-ink/10 px-3 py-2">
                      <p className="mb-1 text-[11px] font-medium text-moss/70">
                        {t('trades.browse.yourItemsOfferLabel')}
                      </p>
                      <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                        {columns.map((col) => {
                          const on = offerItems.has(col.id)
                          return (
                            <li key={col.id}>
                              <label className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-white">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() => toggleOfferItem(col)}
                                  className="h-3 w-3 shrink-0 rounded border-ink/20 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="truncate text-ink" title={col.name}>
                                  {col.isCombo ? `🎁 ${col.name}` : col.name}
                                </span>
                                <span className={`ml-auto shrink-0 font-mono ${col.isCombo ? 'text-amber-600' : 'text-moss/70'}`}>{col.code}</span>
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                    <GameCopies
                      slug={slug}
                      bggId={g.bgg_id}
                      username={username}
                      editor={editor}
                      columns={columns}
                      selectable
                      combos={combos}
                      moneyEnabled={moneyEnabled}
                      selectedKeys={wantKeys}
                      onToggleTarget={toggleWantKey}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => toggleWant(g)}
                  title={t('trades.browse.wantAnyCopyTitle')}
                  className={`mt-auto border-t px-2 py-1.5 text-xs font-semibold transition-colors ${
                    wanted
                      ? 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100'
                      : 'border-ink/10 text-moss hover:bg-indigo-50 hover:text-indigo-600'
                  }`}
                >
                  {wanted ? t('trades.browse.wantedBadge') : t('trades.browse.wantAnyCopyButton')}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {count > BROWSE_PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-moss">
          <span>{t('trades.gamesCount', { count })}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              className="rounded border border-ink/15 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
            >
              {t('trades.prev')}
            </button>
            <span>{t('trades.browse.pageOfTotal', { page, total: totalPages })}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isFetching}
              className="rounded border border-ink/15 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
            >
              {t('trades.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
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
  columns?: OfferColumn[]
  selectable?: boolean
  combos?: Combo[]
  moneyEnabled?: boolean
  // Controlled selection (catalog dropdown): when provided, copy/combo selection
  // is owned by the parent's want-set instead of derived from the offer matrix,
  // so a copy can be picked before any of my items is chosen.
  selectedKeys?: Set<string>
  onToggleTarget?: (t: Target) => void
}

function GameCopies({ slug, bggId, username, editor, columns, selectable, combos, moneyEnabled, selectedKeys, onToggleTarget }: GameCopiesProps) {
  const { t } = useTranslation()
  const { data, isLoading } = useEventListings(slug, { board_game: bggId, page_size: 200 })
  const [detailCopyId, setDetailCopyId] = useState<number | null>(null)
  const all = data?.results ?? []
  const others = all.filter((l) => l.copy_owner_username !== username)
  const ownCount = all.length - others.length

  const controlled = !!(selectable && onToggleTarget && selectedKeys)
  const canSelect = controlled || !!(selectable && editor && columns && columns.length > 0)
  const isCopyWanted = (listingId: number) =>
    controlled
      ? selectedKeys!.has(listingTargetKey(listingId))
      : !!editor && !!columns &&
        columns.some((col) => editor.isOn(col.id, listingTargetKey(listingId)))

  function toggleCopy(l: EventListing) {
    if (l.owner_too_far) return
    if (controlled) {
      onToggleTarget!({
        key: listingTargetKey(l.id), listingId: l.id, label: l.listing_code,
        gameId: l.board_game_id, gameName: l.board_game_name, thumbnail: l.board_game_thumbnail,
      })
      return
    }
    if (!editor || !columns) return
    const next = !isCopyWanted(l.id)
    // Act only on the columns already offering this game; if none offer it yet,
    // clicking a copy stages it but assigns no item (tick an item above first).
    const group = groupTargetsByGame(editor!.targets).find((g) => g.gameId === bggId)
    const acting = group ? columns.filter((col) => groupIsOn(editor!, col.id, group)) : []

    const key = listingTargetKey(l.id)
    editor.addTarget({
      key, listingId: l.id, label: l.listing_code,
      gameId: l.board_game_id, gameName: l.board_game_name, thumbnail: l.board_game_thumbnail,
    })
    acting.forEach((col) => editor!.toggle(col.id, key, next))
  }

  const comboRows = (combos ?? []).filter(
    (c) => c.owner_username !== username && c.items.some((it) => it.board_game_id === bggId)
  )

  const isComboWanted = (comboId: number) =>
    controlled
      ? selectedKeys!.has(comboTargetKey(comboId))
      : !!editor && !!columns &&
        columns.some((col) => editor.isOn(col.id, comboTargetKey(comboId)))

  function maxMemberBid(c: Combo): string | null {
    if (!editor) return null
    const vals = c.items
      .map((it) => Number(editor.priceForGame(it.board_game_id)))
      .filter((v) => Number.isFinite(v) && v > 0)
    return vals.length ? Math.max(...vals).toFixed(2) : null
  }

  function effBidFor(c: Combo): string | null {
    const wished = editor?.targets.find((target) => target.comboId === c.id)
    return wished?.bid ?? maxMemberBid(c)
  }

  function toggleCombo(c: Combo) {
    if (controlled) {
      onToggleTarget!({
        key: comboTargetKey(c.id), listingId: 0, comboId: c.id, label: c.combo_code,
        gameId: COMBO_GAME_OFFSET + c.id, gameName: `🎁 ${c.name}`,
        thumbnail: c.items[0]?.board_game_thumbnail ?? null,
      })
      return
    }
    if (!editor || !columns) return
    const next = !isComboWanted(c.id)
    const group = groupTargetsByGame(editor.targets).find((g) => g.gameId === bggId)
    const acting = group ? columns.filter((col) => groupIsOn(editor, col.id, group)) : []
    const key = comboTargetKey(c.id)
    editor.addTarget({
      key, listingId: 0, comboId: c.id, label: c.combo_code,
      gameId: COMBO_GAME_OFFSET + c.id, gameName: `🎁 ${c.name}`,
      thumbnail: c.items[0]?.board_game_thumbnail ?? null,
    })
    acting.forEach((col) => editor.toggle(col.id, key, next))
  }

  if (isLoading) return <p className="px-3 py-2 text-xs text-moss/70">{t('trades.gameCopies.loadingCopies')}</p>

  return (
    <div className="px-3 py-2">
      {others.length === 0 ? (
        <p className="text-xs text-moss/70">{t('trades.gameCopies.noOtherCopiesYet')}</p>
      ) : (
        <>
          {canSelect && (
            <p className="mb-1 text-[11px] font-medium text-moss/70">
              {t('trades.gameCopies.pickSpecificCopies')}
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {others.map((l) => {
              const tooFar = !!l.owner_too_far
              const wanted = canSelect && !tooFar && isCopyWanted(l.id)
              const meta = [l.copy_language, t(`trades.conditionLabel.${l.copy_condition}`, { defaultValue: l.copy_condition })]
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
                      aria-label={t('trades.gameCopies.wantCopyAriaLabel', { code: l.listing_code })}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => !tooFar && setDetailCopyId(l.copy_id)}
                    disabled={tooFar}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:underline disabled:cursor-default disabled:no-underline"
                    title={tooFar ? t('trades.gameCopies.ownerTooFarTitle') : t('trades.gameCopies.viewCopyDetailsTitle')}
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
                        {t('trades.gameCopies.tooFarBadge')}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {canSelect && comboRows.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[11px] font-medium text-amber-700/80">
            {t('trades.gameCopies.combosIncludingGame')}
          </p>
          <ul className="flex flex-col gap-1">
            {comboRows.map((c) => {
              const wanted = isComboWanted(c.id)
              const eff = effBidFor(c)
              return (
                <li
                  key={`combo-${c.id}`}
                  className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
                    wanted ? 'border-amber-300 bg-amber-50' : 'border-ink/15 bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={wanted}
                    onChange={() => toggleCombo(c)}
                    className="h-3.5 w-3.5 shrink-0 rounded border-ink/20 text-amber-600 focus:ring-amber-500"
                    aria-label={t('trades.gameCopies.wantComboAriaLabel', { code: c.combo_code })}
                  />
                  <span className="flex shrink-0 -space-x-1">
                    {c.items.map((it) =>
                      it.board_game_thumbnail ? (
                        <img
                          key={it.id}
                          src={it.board_game_thumbnail}
                          alt=""
                          title={it.board_game_name}
                          className="h-6 w-6 rounded border border-amber-300 object-cover"
                          loading="lazy"
                        />
                      ) : null
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink" title={c.name}>
                    🎁 {c.name}
                  </span>
                  {moneyEnabled && (
                    <span className="shrink-0 font-mono text-amber-700/80">
                      {eff != null ? `$${eff}` : t('trades.barter')}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {ownCount > 0 && (
        <p className="mt-1 text-[11px] text-moss/70">
          {t('trades.gameCopies.ownCopiesExcluded', { count: ownCount })}
        </p>
      )}
      {detailCopyId != null && (
        <CopyDetailModal copyId={detailCopyId} onClose={() => setDetailCopyId(null)} />
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
  columns: OfferColumn[]
  editor: Editor
  combos: Combo[]
}

function VisualMode({ columns, editor, combos }: VisualModeProps) {
  const { t } = useTranslation()
  if (columns.length === 0) return null
  const comboById = new Map(combos.map((c) => [c.id, c]))

  return (
    <div className="space-y-3">
      {columns.map((col) => {
        const groups = groupTargetsByGame(editor.targets)
        const myWants = groups.filter((g) => groupIsOn(editor, col.id, g))
        // The offered item: a combo renders its member thumbnails as a cluster,
        // a listing renders its single game thumbnail.
        const offeredCombo = col.isCombo ? comboById.get(col.comboId!) : undefined
        return (
          <div key={col.id} className="rounded-xl border border-ink/15 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {col.isCombo ? `🎁 ${col.name}` : col.name}
                </p>
                <p className={`font-mono text-xs ${col.isCombo ? 'text-amber-600' : 'text-moss/70'}`}>{col.code}</p>
              </div>
              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                {t('trades.wantsCount', { count: myWants.length })}
              </span>
            </div>

            {/* Give → receive: offered item, then the wanted games as big thumbnails (× to remove). */}
            <div className="flex items-start gap-3 overflow-x-auto">
              <div className="flex shrink-0 flex-col items-center gap-1">
                {offeredCombo ? (
                  <div className="flex h-32 w-32 flex-wrap content-center items-center justify-center gap-1 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50/50 p-1">
                    {offeredCombo.items.map((it) => (
                      <GameThumb key={it.id} src={it.board_game_thumbnail} alt={it.board_game_name} className="h-14 w-14" />
                    ))}
                  </div>
                ) : (
                  <GameThumb
                    src={col.thumbnail}
                    alt={col.name ?? ''}
                    className="h-32 w-32"
                  />
                )}
                <span className="w-32 truncate text-center text-xs text-ink" title={col.name}>
                  {col.isCombo ? `🎁 ${col.name}` : col.name}
                </span>
              </div>
              <svg className="mt-12 h-5 w-5 shrink-0 text-moss/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label={t('trades.tradesForAriaLabel')}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {myWants.length > 0 ? (
                <div className="flex flex-wrap items-start gap-3">
                  {myWants.map((g) => {
                    const combo = g.gameId >= COMBO_GAME_OFFSET
                      ? comboById.get(g.gameId - COMBO_GAME_OFFSET)
                      : undefined
                    return (
                      <div key={g.gameId} className="relative flex w-32 shrink-0 flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={() => groupKeys(g).forEach((k) => editor.toggle(col.id, k, false))}
                          aria-label={t('trades.visualMode.removeAriaLabel', { name: g.gameName })}
                          title={t('trades.visualMode.removeAriaLabel', { name: g.gameName })}
                          className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-ink bg-white text-xs font-bold text-red-600 shadow-sm hover:bg-red-50"
                        >
                          ×
                        </button>
                        {combo ? (
                          <div className="flex h-32 w-32 flex-wrap content-center items-center justify-center gap-1 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50/50 p-1">
                            {combo.items.map((it) => (
                              <GameThumb key={it.id} src={it.board_game_thumbnail} alt={it.board_game_name} className="h-14 w-14" />
                            ))}
                          </div>
                        ) : (
                          <GameThumb src={g.thumbnail} alt={g.gameName ?? ''} className="h-32 w-32" />
                        )}
                        <span className="w-32 truncate text-center text-xs text-ink" title={g.gameName}>
                          {g.gameName}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <span className="mt-12 text-xs text-moss/70">{t('trades.visualMode.noWantsYet')}</span>
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
  columns: OfferColumn[]
  editor: Editor
  username?: string
  ratings: Map<number, number>
  moneyEnabled: boolean
  combos: Combo[]
}

function GridMode({ slug, columns, editor, username, ratings, moneyEnabled, combos }: GridModeProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const s = new Set(prev)
      if (s.has(key)) s.delete(key)
      else s.add(key)
      return s
    })

  const rows = buildGridRows(editor, combos, columns)

  if (editor.targets.length === 0) {
    return (
      <div className="rounded-xl bg-gray-50 px-3 py-6 text-center text-sm text-moss/70">
        {t('trades.grid.noTargetsYet')}
      </div>
    )
  }

  const colCount = columns.length + 1

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-xs font-semibold text-moss hover:bg-sage/30 transition-colors"
          onClick={() => {
            for (const g of rows) {
              const wantRating = ratings.get(g.gameId)
              if (wantRating == null) continue
              for (const col of columns) {
                // Combos are bundles with no single game rating — skip them.
                if (col.isCombo || col.boardGameId == null) continue
                const ownRating = ratings.get(col.boardGameId)
                if (ownRating == null) continue
                // Only auto-tick specific copies; never spread bundle (combo) wishes.
                if (ownRating <= wantRating && !groupIsOn(editor, col.id, g)) {
                  g.copyTargets.forEach((tgt) => editor.toggle(col.id, tgt.key, true))
                }
              }
            }
          }}
        >
          {t('trades.grid.autoTickButton')}
        </button>
      </div>
    <div className="overflow-auto rounded-xl border border-ink/15 bg-white" style={{ maxHeight: '70vh' }}>
      <table className="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 border-b border-r border-ink/15 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-moss">
              {t('trades.grid.wantVsMyItemHeader')}
            </th>
            {columns.map((col) => (
              <th
                key={col.id}
                className="sticky top-0 z-20 border-b border-r border-ink/15 bg-gray-50 px-1 py-2 align-bottom"
              >
                {moneyEnabled && !col.isCombo && col.resolvedAsk != null && (
                  <div className="mb-1 text-center text-[10px] font-semibold text-emerald-700">
                    ${Number(col.resolvedAsk).toFixed(2)}
                  </div>
                )}
                <div className="mx-auto h-28 w-8">
                  <div className="flex h-full -rotate-180 items-center justify-center [writing-mode:vertical-rl]">
                    <span className={`truncate text-xs font-medium ${col.isCombo ? 'text-amber-700' : 'text-moss'}`} title={col.name}>
                      {col.isCombo ? `🎁 ${col.name}` : col.name}
                    </span>
                  </div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => {
            const gkey = String(g.gameId)
            const isOpen = expanded.has(gkey)
            const specific = g.copyTargets.length > 0
            return (
              <Fragment key={gkey}>
                <tr className="group">
                  <th className="sticky left-0 z-10 border-b border-r border-ink/15 bg-white px-3 py-2 text-left font-normal group-hover:bg-indigo-50/40">
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleExpand(gkey)}
                        className="shrink-0 text-moss/70 hover:text-indigo-600"
                        title={t('trades.grid.showCopiesTitle')}
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
                        {groupBadge(t, g)}
                      </span>
                    </span>
                    {moneyEnabled && g.gameId >= 0 && g.gameId < COMBO_GAME_OFFSET && (
                      <div className="mt-1 flex items-center gap-1 text-xs">
                        <span className="text-moss">{t('trades.rating.biddingPriceLabel')}</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={editor.priceForGame(g.gameId)}
                          onChange={(e) => editor.setMoney(g.gameId, e.target.value)}
                          placeholder={t('trades.pricePlaceholder')}
                          className="no-spinner w-20 rounded border border-ink/20 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                        />
                      </div>
                    )}
                  </th>
                  {columns.map((col) => {
                    const on = groupIsOn(editor, col.id, g)
                    // Bundle-sourced tick: this game is wanted here only via a combo.
                    const comboOn = (g.comboKeys ?? []).some((k) => editor.isOn(col.id, k))
                    return (
                      <td
                        key={col.id}
                        className="border-b border-r border-ink/15 p-0 text-center group-hover:bg-indigo-50/40"
                      >
                        <button
                          type="button"
                          onClick={() => toggleGroup(editor, col.id, g)}
                          className={`m-1 h-5 w-5 rounded border ${
                            on
                              ? comboOn
                                ? 'border-amber-500 bg-amber-100 text-amber-700'
                                : 'border-ink bg-butter text-ink'
                              : 'border-ink/20 bg-white text-transparent hover:border-indigo-400'
                          }`}
                          title={
                            comboOn
                              ? t('trades.grid.cellComboTitle', { gameName: g.gameName, colName: col.name })
                              : t('trades.grid.cellTitle', { gameName: g.gameName, colName: col.name })
                          }
                          aria-pressed={on}
                        >
                          {comboOn ? (
                            <span className="text-[11px] leading-none">🎁</span>
                          ) : (
                            <svg className="mx-auto h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
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
                            ? t('trades.grid.specificCopiesLabel')
                            : t('trades.grid.matchedCopiesLabel')}
                        </span>
                        <GameCopies slug={slug} bggId={g.gameId} username={username} editor={editor} columns={columns} selectable combos={combos} moneyEnabled={moneyEnabled} />
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
  columns: OfferColumn[],
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

  const colById = new Map(columns.map((c) => [c.id, c]))

  for (const colId of editor.changedListingIds) {
    const col = colById.get(colId)
    if (!col) continue

    // Desired target set for this column (apply staged changes over base).
    const desired = editor.targets.filter((t) => editor.isOn(colId, t.key))
    const items: WantGroupItemPayload[] = desired.map((t) =>
      t.comboId != null ? { combo: t.comboId } : { event_listing: t.listingId }
    )

    let wg = model.wantGroupByCol.get(colId)

    if (!wg) {
      // No 1-to-1 trio yet → create offer group + want group + wish. The offer
      // group holds this single column: my listing, or my combo (given as a unit).
      let og = model.offerGroupByCol.get(colId)
      if (!og) {
        og = await createOfferGroupRaw(slug, {
          name: col.code,
          max_give: 1,
          item_listing_ids: col.isCombo ? [] : [col.listingId!],
          ...(col.isCombo ? { item_combo_ids: [col.comboId!] } : {}),
        })
      }
      wg = await createWantGroupRaw(slug, {
        name: `Wants for ${col.code}`,
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

type ViewMode = 'catalog' | 'visual' | 'grid'

export default function MyWantsPage() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const [confirmAdvanced, setConfirmAdvanced] = useState(false)
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const { data: event, isLoading: eventLoading, isError: eventError } = useEvent(slug)
  usePageTitle(event?.name ? `${t('trades.myWants.pageTitle')} · ${event.name}` : t('trades.myWants.pageTitle'))
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

  // Offered items = my listings + my own combos (each a grid/catalog column).
  const columns = useMemo<OfferColumn[]>(() => {
    const myCombos = combos.filter((c) => c.owner_username === user?.username)
    return [...myListings.map(listingColumn), ...myCombos.map(comboColumn)]
  }, [myListings, combos, user?.username])

  const model = useMemo(
    () => buildModel(columns, offerGroups, wantGroups, wishes, gamePrices),
    [columns, offerGroups, wantGroups, wishes, gamePrices]
  )

  const customWantGroups = useMemo(() => {
    const autoIds = new Set([...model.wantGroupByCol.values()].map((wg) => wg.id))
    return wantGroups.filter((wg) => !autoIds.has(wg.id))
  }, [wantGroups, model.wantGroupByCol])

  const { editor } = useEditor(model)
  const wantGameCount = useMemo(
    () => new Set(editor.targets.map((target) => target.gameId)).size,
    [editor.targets]
  )

  const { data: ratingsData = [] } = useMyRatings()
  const rmap = useMemo(() => ratingMap(ratingsData), [ratingsData])

  const [view, setView] = useState<ViewMode>('catalog')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!slug) return
    setSaveError(null)
    for (const [, value] of editor.changedGamePrices) {
      const raw = (value ?? '').trim()
      if (raw !== '' && Number(raw) <= 0) {
        setSaveError(t('trades.errors.priceMustBePositive'))
        return
      }
    }
    setSaving(true)
    try {
      await persistChanges(slug, model, editor, columns, event?.money_enabled ?? false)
      // Wait for the refetched server truth to land BEFORE clearing local staged
      // changes, otherwise the UI briefly falls back to stale cache (the flash).
      await Promise.all([
        invalidateTrades(qc, slug),
        qc.invalidateQueries({ queryKey: ['trades', 'game-prices', slug] }),
      ])
      editor.reset()
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t('trades.errors.saveFailed')
      )
    } finally {
      setSaving(false)
    }
  }, [slug, model, editor, columns, qc, event?.money_enabled, t])

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
          <p className="text-sm font-medium text-red-700">{t('trades.notFoundError')}</p>
          <BackButton to="/events" className="mt-3">{t('trades.backToEvents')}</BackButton>
        </div>
      </div>
    )
  }

  if (!event.is_participant && !event.is_organizer) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-yellow-700">
            {t('trades.mustJoinToBuild')}
          </p>
          <Link to={`/events/${slug}`} className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
            {t('trades.goToEventToJoin')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-8 sm:px-6">
      {confirmAdvanced && (
        <ConfirmDialog
          title={t('trades.myWants.confirmAdvancedTitle')}
          body={t('trades.myWants.confirmAdvancedBody')}
          confirmLabel={t('trades.myWants.confirmAdvancedButton')}
          onConfirm={() => {
            setConfirmAdvanced(false)
            navigate(`/events/${slug}/builder`)
          }}
          onCancel={() => setConfirmAdvanced(false)}
        />
      )}
      <BackButton to={`/events/${slug}`}>{t('trades.backToEvent', { name: event.name })}</BackButton>

      <div className="rounded-xl border border-ink/15 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">{t('trades.myWants.pageTitle')}</h1>
            <p className="mt-1 text-sm text-moss">
              {event.name}
              <span className="mx-2 text-moss/40">·</span>
              {t('trades.myWants.pageSubtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmAdvanced(true)}
            className="rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-xs font-semibold text-moss hover:bg-sage/30 transition-colors"
          >
            {t('trades.myWants.advancedBuilderButton')}
          </button>
        </div>
      </div>

      {event.inputs_locked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('trades.lockedBanner')}
        </div>
      )}

      {myListings.length === 0 ? (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-3 text-sm text-yellow-700">
          {t('trades.myWants.noItemsPrefix')}{' '}
          <Link to={`/events/${slug}`} className="font-medium underline">
            {t('trades.myWants.addCopiesLinkShort')}
          </Link>{' '}
          {t('trades.myWants.noItemsSuffix')}
        </div>
      ) : (
        <>
          {/* Mode tabs */}
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex rounded-2xl border border-ink/15 bg-white p-0.5">
              {(['catalog', 'visual', 'grid'] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setView(m)}
                  className={`rounded-xl px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                    view === m ? 'bg-butter text-ink shadow-pop-sm' : 'text-moss hover:text-ink'
                  }`}
                >
                  {t(`trades.myWants.viewMode.${m}`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-moss/70">
              {t('trades.itemsCount', { count: myListings.length })} · {t('trades.gamesWantedCount', { count: wantGameCount })}
            </p>
          </div>

          <div className={event.inputs_locked ? 'pointer-events-none opacity-60' : undefined}>
            {view === 'catalog' && (
              <GameBrowse
                slug={slug!}
                editor={editor}
                columns={columns}
                username={user?.username}
                customWantGroups={customWantGroups}
                moneyEnabled={event.money_enabled}
                combos={combos}
              />
            )}
            {view === 'visual' && <VisualMode columns={columns} editor={editor} combos={combos} />}
            {view === 'grid' && (
              <GridMode slug={slug!} columns={columns} editor={editor} username={user?.username} ratings={rmap} moneyEnabled={event.money_enabled} combos={combos} />
            )}
          </div>
        </>
      )}

      {/* Sticky save bar */}
      {editor.dirtyCount > 0 && !event.inputs_locked && (
        <div className="sticky bottom-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full border border-ink/20 bg-white px-5 py-2.5 shadow-lg">
          <span className="text-sm text-moss">
            {t('trades.unsavedChangesCount', { count: editor.dirtyCount })}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => editor.reset()}
              disabled={saving}
              className="rounded-full px-3 py-1.5 text-sm text-moss hover:text-ink disabled:opacity-50"
            >
              {t('trades.discard')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-full border-2 border-ink bg-butter px-5 py-1.5 text-sm font-bold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              {saving ? t('trades.saving') : t('common.save')}
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
