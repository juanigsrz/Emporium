import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'

import { useEvent, useEventListings, useEventGames } from '../../api/events'
import type { EventListing, EventGame } from '../../api/events'
import { useAuthStore } from '../../store/auth'
import { GameThumb } from '../../components/GameThumb'
import BackButton from '../../components/BackButton'

import {
  useOfferGroups,
  useCreateOfferGroup,
  usePatchOfferGroup,
  useDeleteOfferGroup,
  useWantGroups,
  useCreateWantGroup,
  usePatchWantGroup,
  useDeleteWantGroup,
  useWishes,
  useCreateWish,
  useToggleWish,
  useDeleteWish,
  setWantBid,
  deleteWantBid,
} from '../../api/trades'
import type {
  OfferGroup,
  OfferGroupItem,
  WantGroup,
  WantGroupItem,
  WantGroupItemPayload,
  TradeWish,
} from '../../api/trades'
import { useCombos } from '../../api/combos'
import type { Combo } from '../../api/combos'

// ---- Helpers ----

function extractErrorMsg(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: unknown } }).response
    const data = resp?.data
    if (data && typeof data === 'object') {
      const first = Object.values(data as Record<string, unknown>)[0]
      if (Array.isArray(first)) return String(first[0])
      if (typeof first === 'string') return first
    }
    if (typeof data === 'string') return data
  }
  if (err instanceof Error) return err.message
  return 'An error occurred. Please try again.'
}

// ============================================================
// OFFER GROUPS PANEL
// ============================================================

interface OfferGroupsPanelProps {
  slug: string
  myListings: EventListing[]
  moneyEnabled: boolean
  locked?: boolean
}

function OfferGroupsPanel({ slug, myListings, moneyEnabled, locked }: OfferGroupsPanelProps) {
  const { data: groups = [], isLoading } = useOfferGroups(slug)
  const createGroup = useCreateOfferGroup()
  const patchGroup = usePatchOfferGroup()
  const deleteGroup = useDeleteOfferGroup()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {groups.length === 0 && !showForm && (
        <p className="text-xs text-moss/70 py-2">No offer groups yet. Create one to specify what you're offering.</p>
      )}

      {groups.map((group) =>
        editingId === group.id ? (
          <OfferGroupForm
            key={group.id}
            slug={slug}
            myListings={myListings}
            moneyEnabled={moneyEnabled}
            existing={group}
            onSave={async (payload) => {
              setError(null)
              try {
                await patchGroup.mutateAsync({ slug, id: group.id, payload })
                setEditingId(null)
              } catch (e) {
                setError(extractErrorMsg(e))
              }
            }}
            onCancel={() => setEditingId(null)}
            isSaving={patchGroup.isPending}
          />
        ) : (
          <OfferGroupCard
            key={group.id}
            group={group}
            onEdit={() => setEditingId(group.id)}
            onDelete={async () => {
              setError(null)
              try {
                await deleteGroup.mutateAsync({ slug, id: group.id })
              } catch (e) {
                setError(extractErrorMsg(e))
              }
            }}
            isDeleting={deleteGroup.isPending}
            locked={locked}
          />
        )
      )}

      {showForm && (
        <OfferGroupForm
          slug={slug}
          myListings={myListings}
          moneyEnabled={moneyEnabled}
          onSave={async (payload) => {
            setError(null)
            try {
              await createGroup.mutateAsync({ slug, payload })
              setShowForm(false)
            } catch (e) {
              setError(extractErrorMsg(e))
            }
          }}
          onCancel={() => setShowForm(false)}
          isSaving={createGroup.isPending}
        />
      )}

      {!showForm && !locked && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full rounded-2xl border-2 border-dashed border-ink/15 py-3 text-xs font-medium text-moss/70 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
        >
          + New offer group
        </button>
      )}
    </div>
  )
}

interface OfferGroupCardProps {
  group: OfferGroup
  onEdit: () => void
  onDelete: () => void
  isDeleting: boolean
  locked?: boolean
}

function OfferGroupCard({ group, onEdit, onDelete, isDeleting, locked }: OfferGroupCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <div className="rounded-2xl border border-ink/15 bg-white p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="text-sm font-semibold text-ink">{group.name}</span>
          <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
            Give up to {group.max_give}
          </span>
        </div>
        {!locked && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={onEdit}
              className="text-xs text-moss/70 hover:text-indigo-600 transition-colors px-1.5 py-0.5 rounded"
            >
              Edit
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-1">
                <button
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 px-1.5 py-0.5 rounded"
                >
                  {isDeleting ? 'Deleting…' : 'Confirm'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-moss/70 hover:text-moss px-1.5 py-0.5 rounded"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-moss/70 hover:text-red-500 transition-colors px-1.5 py-0.5 rounded"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
      {group.items.length === 0 ? (
        <p className="text-xs text-moss/70 italic">No listings in this group.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {group.items.map((item) =>
            item.combo != null ? (
              <span
                key={item.id}
                className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
              >
                🎁 {item.combo_name}
                <span className="font-mono text-amber-700/70">{item.combo_code}</span>
              </span>
            ) : (
              <span
                key={item.id}
                className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-ink"
              >
                <GameThumb src={item.board_game_thumbnail} alt={item.board_game_name ?? ''} className="h-6 w-6" />
                <span className="font-mono text-moss/70">{item.listing_code}</span>
                {item.board_game_name}
              </span>
            )
          )}
        </div>
      )}
    </div>
  )
}

interface OfferGroupFormProps {
  slug: string
  myListings: EventListing[]
  moneyEnabled: boolean
  existing?: OfferGroup
  onSave: (payload: {
    name: string
    max_give: number
    item_listing_ids: number[]
    item_combo_ids: number[]
  }) => Promise<void>
  onCancel: () => void
  isSaving: boolean
}

function OfferGroupForm({ slug, myListings, moneyEnabled, existing, onSave, onCancel, isSaving }: OfferGroupFormProps) {
  const { data: combosData } = useCombos(slug, { mine: true })
  const myCombos = combosData?.results ?? []
  const [name, setName] = useState(existing?.name ?? '')
  const [maxGive, setMaxGive] = useState(String(existing?.max_give ?? 1))
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    new Set(
      (existing?.items ?? [])
        .filter((i) => i.event_listing != null)
        .map((i) => i.event_listing as number)
    )
  )
  const [selectedComboIds, setSelectedComboIds] = useState<Set<number>>(
    new Set(
      (existing?.items ?? [])
        .filter((i) => i.combo != null)
        .map((i) => i.combo as number)
    )
  )
  const [formError, setFormError] = useState<string | null>(null)

  function toggleListing(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleCombo(id: number) {
    setSelectedComboIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!name.trim()) { setFormError('Name is required.'); return }
    const mg = parseInt(maxGive, 10)
    if (isNaN(mg) || mg < 1) { setFormError('Max give must be at least 1.'); return }
    const totalSelected = selectedIds.size + selectedComboIds.size
    if (totalSelected === 0) { setFormError('Select at least one listing or combo.'); return }
    if (mg > totalSelected) { setFormError(`Max give (${mg}) cannot exceed the number of selected items (${totalSelected}).`); return }

    await onSave({
      name: name.trim(),
      max_give: mg,
      item_listing_ids: Array.from(selectedIds),
      item_combo_ids: Array.from(selectedComboIds),
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-indigo-200 bg-indigo-50 p-3 space-y-3"
    >
      {formError && (
        <p className="text-xs text-red-600">{formError}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Group name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. My heavy games"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1">
            Max give (X) — give up to this many
          </label>
          <input
            type="number"
            min={1}
            max={myListings.length || 1}
            value={maxGive}
            onChange={(e) => setMaxGive(e.target.value)}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-ink mb-1.5">
          Select listings to offer ({selectedIds.size} selected)
        </p>
        {myListings.length === 0 ? (
          <p className="text-xs text-moss/70 italic">
            No listings in this event. Add copies first.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto">
            {myListings.map((listing) => (
              <label
                key={listing.id}
                className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 cursor-pointer transition-colors text-sm ${
                  selectedIds.has(listing.id)
                    ? 'border-indigo-400 bg-white text-indigo-800'
                    : 'border-ink/15 bg-white text-ink hover:border-indigo-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(listing.id)}
                  onChange={() => toggleListing(listing.id)}
                  className="h-3.5 w-3.5 rounded border-ink/20 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-medium">{listing.board_game_name}</span>
                <span className="font-mono text-xs text-moss/70">{listing.listing_code}</span>
                {moneyEnabled && selectedIds.has(listing.id) && (
                  <span className="ml-auto text-xs text-moss/70 italic">
                    Sell price set in My Listings / Almanac
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      {myCombos.length > 0 && (
        <div>
          <p className="text-xs font-medium text-ink mb-1.5">
            Or offer a combo ({selectedComboIds.size} selected)
          </p>
          <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto">
            {myCombos.map((c: Combo) => (
              <label
                key={c.id}
                className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 cursor-pointer transition-colors text-sm ${
                  selectedComboIds.has(c.id)
                    ? 'border-indigo-400 bg-white text-indigo-800'
                    : 'border-ink/15 bg-white text-ink hover:border-indigo-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedComboIds.has(c.id)}
                  onChange={() => toggleCombo(c.id)}
                  className="h-3.5 w-3.5 rounded border-ink/20 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-medium">{c.name}</span>
                <span className="font-mono text-xs text-moss/70">{c.combo_code}</span>
                <span className="ml-auto text-xs text-moss/60">{c.items.length} items</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="flex-1 rounded-xl border-2 border-ink bg-butter px-3 py-1.5 text-xs font-bold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {isSaving ? 'Saving…' : existing ? 'Save changes' : 'Create group'}
        </button>
      </div>
    </form>
  )
}

// ============================================================
// WANT GROUPS PANEL
// ============================================================

interface WantGroupsPanelProps {
  slug: string
  username: string
  moneyEnabled: boolean
  locked?: boolean
}

// A "draft item" used in the local editor before persisting
interface DraftWantItem {
  // Unique local key for DnD (not the backend id)
  localId: string
  board_game_name: string | null
  event_listing: number
  listing_code: string | null
  bid: string  // '' = none
}

function makeDraftKey(item: WantGroupItem | DraftWantItem): string {
  return `listing-${item.event_listing}`
}

function WantGroupsPanel({ slug, username, moneyEnabled, locked }: WantGroupsPanelProps) {
  const { data: groups = [], isLoading } = useWantGroups(slug)
  const createGroup = useCreateWantGroup()
  const patchGroup = usePatchWantGroup()
  const deleteGroup = useDeleteWantGroup()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {groups.length === 0 && !showForm && (
        <p className="text-xs text-moss/70 py-2">No want groups yet. Create one by adding games you'd like to receive.</p>
      )}

      {groups.map((group) =>
        editingId === group.id ? (
          <WantGroupEditor
            key={group.id}
            slug={slug}
            group={group}
            username={username}
            moneyEnabled={moneyEnabled}
            onClose={() => setEditingId(null)}
          />
        ) : (
          <WantGroupCard
            key={group.id}
            group={group}
            onEdit={() => setEditingId(group.id)}
            onDelete={async () => {
              setError(null)
              try {
                await deleteGroup.mutateAsync({ slug, id: group.id })
              } catch (e) {
                setError(extractErrorMsg(e))
              }
            }}
            isDeleting={deleteGroup.isPending}
            onToggleDuplicateProtection={async (value) => {
              setError(null)
              try {
                await patchGroup.mutateAsync({ slug, id: group.id, payload: { duplicate_protection: value } })
              } catch (e) {
                setError(extractErrorMsg(e))
              }
            }}
            locked={locked}
          />
        )
      )}

      {showForm && (
        <WantGroupEditor
          slug={slug}
          username={username}
          moneyEnabled={moneyEnabled}
          onClose={async (created) => {
            if (created) {
              try {
                await createGroup.mutateAsync({ slug, payload: created })
              } catch (e) {
                setError(extractErrorMsg(e))
                return
              }
            }
            setShowForm(false)
          }}
          isCreating
        />
      )}

      {!showForm && editingId === null && !locked && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full rounded-2xl border-2 border-dashed border-ink/15 py-3 text-xs font-medium text-moss/70 hover:border-purple-300 hover:text-purple-500 transition-colors"
        >
          + New want group
        </button>
      )}
    </div>
  )
}

interface WantGroupCardProps {
  group: WantGroup
  onEdit: () => void
  onDelete: () => void
  isDeleting: boolean
  onToggleDuplicateProtection: (value: boolean) => void
  locked?: boolean
}

function WantGroupCard({ group, onEdit, onDelete, isDeleting, onToggleDuplicateProtection, locked }: WantGroupCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="rounded-2xl border border-ink/15 bg-white p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="text-sm font-semibold text-ink">{group.name}</span>
          <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
            Receive at least {group.min_receive}
          </span>
        </div>
        {!locked && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={onEdit}
              className="text-xs text-moss/70 hover:text-indigo-600 transition-colors px-1.5 py-0.5 rounded"
            >
              Edit
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-1">
                <button
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 px-1.5 py-0.5 rounded"
                >
                  {isDeleting ? 'Deleting…' : 'Confirm'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-moss/70 hover:text-moss px-1.5 py-0.5 rounded"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-moss/70 hover:text-red-500 transition-colors px-1.5 py-0.5 rounded"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-moss mb-2">
        <input
          type="checkbox"
          checked={group.duplicate_protection}
          onChange={(e) => onToggleDuplicateProtection(e.target.checked)}
          disabled={locked}
          className="h-3.5 w-3.5 rounded border-ink/20 text-purple-600 focus:ring-purple-500 disabled:cursor-not-allowed"
        />
        Duplication-protected (never award more than one copy of the same game)
      </label>

      {group.items.length === 0 ? (
        <p className="text-xs text-moss/70 italic">No targets yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {group.items.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs bg-blue-50 text-blue-700"
            >
              <GameThumb src={item.board_game_thumbnail} alt={item.board_game_name ?? ''} className="h-6 w-6" />
              <span className="font-mono text-moss/70">{item.listing_code}</span>
              {item.board_game_name}
              {item.resolved_bid != null && (
                <span className="rounded bg-emerald-100 px-1 font-semibold text-emerald-700">
                  pay ≤${item.resolved_bid}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// The add/remove editor for a want group

interface WantGroupEditorProps {
  slug: string
  group?: WantGroup
  username: string
  moneyEnabled: boolean
  onClose: (
    created?: { name: string; min_receive: number; duplicate_protection: boolean; items: WantGroupItemPayload[] }
  ) => void
  isCreating?: boolean
}

// Sub-component: per-game copy picker (extracted so useEventListings is called unconditionally within it)
interface GameCopyPickerProps {
  slug: string
  game: EventGame
  username: string
  existingItemIds: Set<string>
  onCommit: (listings: EventListing[]) => void
  onCancel: () => void
}

function GameCopyPicker({ slug, game, username, existingItemIds, onCommit, onCancel }: GameCopyPickerProps) {
  const { data: listingsData } = useEventListings(slug, { board_game: game.bgg_id })
  const otherCopies = (listingsData?.results ?? []).filter(
    (l) => l.copy_owner_username !== username
  )

  const [anyCopy, setAnyCopy] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())

  function toggleListing(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const hasSelection = anyCopy || checkedIds.size > 0

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50 p-3 space-y-2">
      <p className="text-xs font-semibold text-purple-700">
        {game.name}
        {game.year_published && <span className="ml-1 font-normal text-moss">({game.year_published})</span>}
        {' '}— choose what to add:
      </p>
      <label className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 cursor-pointer text-sm transition-colors ${
        anyCopy
          ? 'border-purple-400 bg-white text-purple-800'
          : 'border-ink/15 bg-white text-ink hover:border-purple-200'
      }`}>
        <input
          type="checkbox"
          checked={anyCopy}
          onChange={(e) => setAnyCopy(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-ink/20 text-purple-600 focus:ring-purple-500 disabled:cursor-not-allowed"
        />
        <span className="font-medium">Any copy</span>
        <span className="text-xs text-purple-500 ml-1">(accept every trader's copy)</span>
      </label>
      {otherCopies.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-moss">Or specific copies from other traders:</p>
          {otherCopies.map((listing) => {
            const key = `listing-${listing.id}`
            const alreadyAdded = existingItemIds.has(key)
            return (
              <label
                key={listing.id}
                className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 cursor-pointer text-sm transition-colors ${
                  alreadyAdded
                    ? 'border-ink/15 bg-white text-moss/40 cursor-not-allowed'
                    : checkedIds.has(listing.id)
                    ? 'border-blue-400 bg-white text-blue-800'
                    : 'border-ink/15 bg-white text-ink hover:border-blue-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checkedIds.has(listing.id)}
                  disabled={alreadyAdded}
                  onChange={() => toggleListing(listing.id)}
                  className="h-3.5 w-3.5 rounded border-ink/20 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                />
                <span className="font-medium">{listing.board_game_name}</span>
                <span className="font-mono text-xs text-moss/70">{listing.listing_code}</span>
                {listing.copy_condition && (
                  <span className="text-xs text-moss/70">{listing.copy_condition}</span>
                )}
                {alreadyAdded && <span className="ml-auto text-xs text-moss/70">already added</span>}
              </label>
            )
          })}
        </div>
      )}
      {otherCopies.length === 0 && listingsData && (
        <p className="text-xs text-moss/70 italic">No copies from other traders in this event.</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onCommit(anyCopy ? otherCopies : otherCopies.filter((l) => checkedIds.has(l.id)))}
          disabled={!hasSelection}
          className="flex-1 rounded-xl border-2 border-ink bg-purple-400 px-3 py-1.5 text-xs font-bold text-white shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          Add to want group
        </button>
      </div>
    </div>
  )
}

function WantGroupEditor({ slug, group, username, moneyEnabled, onClose, isCreating }: WantGroupEditorProps) {
  const patchGroup = usePatchWantGroup()

  const [name, setName] = useState(group?.name ?? '')
  const [minReceive, setMinReceive] = useState(String(group?.min_receive ?? 1))
  const [dupProtect, setDupProtect] = useState(group?.duplicate_protection ?? false)
  const [items, setItems] = useState<DraftWantItem[]>(() =>
    (group?.items ?? [])
      .filter((i) => i.event_listing != null)
      .map((i) => ({
        localId: makeDraftKey(i),
        board_game_name: i.board_game_name,
        event_listing: i.event_listing as number,
        listing_code: i.listing_code,
        bid: i.bid_is_override ? (i.resolved_bid ?? '') : '',
      }))
  )
  const [gameSearch, setGameSearch] = useState('')
  const [activeGame, setActiveGame] = useState<EventGame | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [duplicateWarn, setDuplicateWarn] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Search event-scoped games (only games with copies in this event)
  const { data: gameResults } = useEventGames(slug, {
    search: gameSearch.length >= 2 ? gameSearch : undefined,
    page_size: 8,
  })

  const existingItemIds = new Set(items.map((i) => i.localId))

  function handlePickerCommit(listings: EventListing[]) {
    setItems((prev) => {
      const have = new Set(prev.map((i) => i.localId))
      const additions: DraftWantItem[] = []
      for (const listing of listings) {
        const localId = `listing-${listing.id}`
        if (have.has(localId)) continue
        have.add(localId)
        additions.push({
          localId,
          board_game_name: listing.board_game_name,
          event_listing: listing.id,
          listing_code: listing.listing_code,
          bid: '',
        })
      }
      return [...prev, ...additions]
    })
    setActiveGame(null)
    setGameSearch('')
  }

  function removeItem(localId: string) {
    setItems((prev) => prev.filter((i) => i.localId !== localId))
  }

  function setMoney(localId: string, amount: string) {
    setItems((prev) => prev.map((i) => (i.localId === localId ? { ...i, bid: amount } : i)))
  }

  function buildPayloadItems(): WantGroupItemPayload[] {
    return items.map((item) => ({ event_listing: item.event_listing }))
  }

  // Persist per-listing buy bids as WantBid overrides (decoupled from the want item).
  async function saveWantBids() {
    if (!moneyEnabled) return
    for (const item of items) {
      const trimmed = item.bid.trim()
      if (trimmed === '') {
        await deleteWantBid(slug, { event_listing: item.event_listing })
      } else {
        await setWantBid(slug, { event_listing: item.event_listing, amount: trimmed })
      }
    }
  }

  async function handleSave() {
    setFormError(null)
    if (!name.trim()) { setFormError('Name is required.'); return }
    const mr = parseInt(minReceive, 10)
    if (isNaN(mr) || mr < 1) { setFormError('Min receive must be at least 1.'); return }
    if (items.length === 0) { setFormError('Add at least one want target.'); return }
    if (mr > items.length) { setFormError(`Min receive (${mr}) cannot exceed total targets (${items.length}).`); return }

    setIsSaving(true)
    try {
      const payloadItems = buildPayloadItems()
      // Persist the want group FIRST (primary action).
      if (isCreating) {
        // Signal to parent to create
        onClose({ name: name.trim(), min_receive: mr, duplicate_protection: dupProtect, items: payloadItems })
      } else if (group) {
        await patchGroup.mutateAsync({
          slug,
          id: group.id,
          payload: { name: name.trim(), min_receive: mr, duplicate_protection: dupProtect, items: payloadItems },
        })
        onClose()
      }
      // Persist bids as a SECONDARY step — its failure must not abort the group save.
      try {
        await saveWantBids()
      } catch (e) {
        setDuplicateWarn(`Group saved, but money bids could not be updated: ${extractErrorMsg(e)}`)
      }
    } catch (e) {
      setFormError(extractErrorMsg(e))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-purple-200 bg-purple-50 p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Group name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="e.g. Strategy games I want"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1">
            Min receive (Y) — receive at least this many
          </label>
          <input
            type="number"
            min={1}
            value={minReceive}
            onChange={(e) => setMinReceive(e.target.value)}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-moss">
        <input
          type="checkbox"
          checked={dupProtect}
          onChange={(e) => setDupProtect(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-ink/20 text-purple-600 focus:ring-purple-500"
        />
        Protect against duplicates
        <span className="text-moss/70">(don't receive more than one copy of the same game)</span>
      </label>

      {(formError || duplicateWarn) && (
        <div className={`rounded-xl px-3 py-2 text-xs ${formError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-yellow-50 border border-yellow-200 text-yellow-700'}`}>
          {formError || duplicateWarn}
        </div>
      )}

      {/* Targets list */}
      <div>
        <p className="text-xs font-medium text-moss mb-2">
          Games you'd like to receive ({items.length})
        </p>
        <div className="space-y-1.5 min-h-[40px]">
          {items.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-purple-200 py-4 text-center text-xs text-moss/70">
              Search below to add games you want
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.localId}
                className="rounded-xl border border-ink/15 bg-white px-3 py-2 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="text-sm text-ink font-medium truncate block">
                    {item.board_game_name}
                  </span>
                  <span className="text-xs text-blue-600 font-mono">{item.listing_code}</span>
                </div>
                {moneyEnabled && (
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-xs text-moss/70">pay ≤$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.bid}
                      onChange={(e) => setMoney(item.localId, e.target.value)}
                      placeholder="0"
                      title="Most money you'll pay to receive this game (needs a seller who accepts money)"
                      className="w-20 rounded-xl border border-ink/20 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeItem(item.localId)}
                  className="shrink-0 text-xs text-moss/40 hover:text-red-500 transition-colors"
                  aria-label="Remove target"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add game target via event-scoped search */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-ink">Search game in this event:</p>
        <input
          value={gameSearch}
          onChange={(e) => { setGameSearch(e.target.value); setActiveGame(null) }}
          placeholder="Type a game name…"
          className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        {!activeGame && gameSearch.length >= 2 && gameResults && gameResults.results.length > 0 && (
          <div className="rounded-xl border border-ink/15 bg-white divide-y divide-gray-50 max-h-40 overflow-y-auto shadow-sm">
            {gameResults.results.map((game) => (
              <button
                key={game.bgg_id}
                type="button"
                onClick={() => setActiveGame(game)}
                className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-purple-50 text-ink"
              >
                <span className="font-medium">{game.name}</span>
                {game.year_published && (
                  <span className="ml-1 text-xs text-moss/70">({game.year_published})</span>
                )}
                <span className="ml-2 text-xs text-moss/70">{game.copies_count} {game.copies_count === 1 ? 'copy' : 'copies'}</span>
              </button>
            ))}
          </div>
        )}
        {!activeGame && gameSearch.length >= 2 && gameResults?.results.length === 0 && (
          <p className="text-xs text-moss/70">No games found in this event.</p>
        )}
        {activeGame && (
          <GameCopyPicker
            key={activeGame.bgg_id}
            slug={slug}
            game={activeGame}
            username={username}
            existingItemIds={existingItemIds}
            onCommit={(listings) => handlePickerCommit(listings)}
            onCancel={() => { setActiveGame(null); setGameSearch('') }}
          />
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => onClose()}
          className="flex-1 rounded-xl border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 rounded-xl border-2 border-ink bg-purple-400 px-3 py-1.5 text-xs font-bold text-white shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {isSaving ? 'Saving…' : group ? 'Save changes' : 'Create group'}
        </button>
      </div>
    </div>
  )
}

// ============================================================
// WISHES PANEL
// ============================================================

interface WishesPanelProps {
  slug: string
  offerGroups: OfferGroup[]
  wantGroups: WantGroup[]
  locked?: boolean
}

function WishesPanel({ slug, offerGroups, wantGroups, locked }: WishesPanelProps) {
  const { data: wishes = [], isLoading } = useWishes(slug)
  const createWish = useCreateWish()
  const toggleWish = useToggleWish()
  const deleteWish = useDeleteWish()

  const [showForm, setShowForm] = useState(false)
  const [selectedOG, setSelectedOG] = useState<string>('')
  const [selectedWG, setSelectedWG] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    setError(null)
    if (!selectedOG || !selectedWG) {
      setError('Select both an offer group and a want group.')
      return
    }
    const ogId = parseInt(selectedOG, 10)
    const wgId = parseInt(selectedWG, 10)
    // Check duplicate
    if (wishes.some((w) => w.offer_group === ogId && w.want_group === wgId)) {
      setError('This offer → want combination already exists.')
      return
    }
    try {
      await createWish.mutateAsync({ slug, payload: { offer_group: ogId, want_group: wgId, active: true } })
      setShowForm(false)
      setSelectedOG('')
      setSelectedWG('')
    } catch (e) {
      setError(extractErrorMsg(e))
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {wishes.length === 0 && !showForm && (
        <p className="text-xs text-moss/70 py-2">
          No wishes yet. Link an offer group to a want group to express a trade preference.
        </p>
      )}

      {wishes.map((wish) => (
        <WishCard
          key={wish.id}
          wish={wish}
          offerItems={offerGroups.find((g) => g.id === wish.offer_group)?.items ?? []}
          wantItems={wantGroups.find((g) => g.id === wish.want_group)?.items ?? []}
          onToggle={async () => {
            setError(null)
            try {
              await toggleWish.mutateAsync({ slug, id: wish.id, active: !wish.active })
            } catch (e) {
              setError(extractErrorMsg(e))
            }
          }}
          onDelete={async () => {
            setError(null)
            try {
              await deleteWish.mutateAsync({ slug, id: wish.id })
            } catch (e) {
              setError(extractErrorMsg(e))
            }
          }}
          isToggling={toggleWish.isPending}
          isDeleting={deleteWish.isPending}
          locked={locked}
        />
      ))}

      {showForm ? (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-3 space-y-3">
          <p className="text-xs font-semibold text-green-700">New wish — link an offer to a want</p>

          <div className="grid grid-cols-1 gap-2">
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Offer group (what you give)</label>
              {offerGroups.length === 0 ? (
                <p className="text-xs text-moss/70 italic">Create an offer group first.</p>
              ) : (
                <select
                  value={selectedOG}
                  onChange={(e) => setSelectedOG(e.target.value)}
                  className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Select offer group…</option>
                  {offerGroups.map((og) => (
                    <option key={og.id} value={og.id}>
                      {og.name} (give up to {og.max_give})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Want group (what you receive)</label>
              {wantGroups.length === 0 ? (
                <p className="text-xs text-moss/70 italic">Create a want group first.</p>
              ) : (
                <select
                  value={selectedWG}
                  onChange={(e) => setSelectedWG(e.target.value)}
                  className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Select want group…</option>
                  {wantGroups.map((wg) => (
                    <option key={wg.id} value={wg.id}>
                      {wg.name} (receive at least {wg.min_receive})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {selectedOG && selectedWG && (() => {
            const og = offerGroups.find((g) => g.id === parseInt(selectedOG, 10))
            const wg = wantGroups.find((g) => g.id === parseInt(selectedWG, 10))
            if (!og || !wg) return null
            return (
              <div className="rounded-xl bg-white border border-green-200 px-3 py-2 text-xs">
                <span className="font-semibold text-indigo-700">{og.name}</span>
                <span className="mx-1.5 font-mono text-green-600">
                  {og.max_give}:{wg.min_receive}
                </span>
                <span className="font-semibold text-purple-700">{wg.name}</span>
                <span className="ml-2 text-moss/70">
                  — give up to {og.max_give}, receive at least {wg.min_receive}
                </span>
              </div>
            )
          })()}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null); setSelectedOG(''); setSelectedWG('') }}
              className="flex-1 rounded-xl border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={createWish.isPending || offerGroups.length === 0 || wantGroups.length === 0}
              className="flex-1 rounded-xl border-2 border-ink bg-green-400 px-3 py-1.5 text-xs font-bold text-white shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              {createWish.isPending ? 'Creating…' : 'Create wish'}
            </button>
          </div>
        </div>
      ) : !locked ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full rounded-2xl border-2 border-dashed border-ink/15 py-3 text-xs font-medium text-moss/70 hover:border-green-300 hover:text-green-500 transition-colors"
        >
          + New wish
        </button>
      ) : null}
    </div>
  )
}

interface WishCardProps {
  wish: TradeWish
  offerItems: OfferGroupItem[]
  wantItems: WantGroupItem[]
  onToggle: () => void
  onDelete: () => void
  isToggling: boolean
  isDeleting: boolean
  locked?: boolean
}

function WishCard({ wish, offerItems, wantItems, onToggle, onDelete, isToggling, isDeleting, locked }: WishCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div
      className={`rounded-2xl border p-3 transition-colors ${
        wish.active ? 'border-green-200 bg-white' : 'border-ink/15 bg-gray-50 opacity-70'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* X:Y summary */}
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="text-sm font-semibold text-indigo-700 truncate">
              {wish.offer_group_name}
            </span>
            <span className="shrink-0 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 font-mono text-xs font-bold text-green-700">
              {wish.max_give}:{wish.min_receive}
            </span>
            <span className="text-sm font-semibold text-purple-700 truncate">
              {wish.want_group_name}
            </span>
          </div>
          <p className="text-xs text-moss/70">
            Give up to <strong>{wish.max_give}</strong> → Receive at least <strong>{wish.min_receive}</strong>
          </p>

          {(offerItems.length > 0 || wantItems.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {offerItems.map((item) =>
                item.combo != null ? (
                  <span key={item.id} className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800" title={item.combo_name ?? 'combo'}>
                    🎁 {item.combo_code}
                  </span>
                ) : (
                  <GameThumb key={item.id} src={item.board_game_thumbnail} alt={item.board_game_name ?? ''} className="h-7 w-7" />
                )
              )}
              <svg className="h-4 w-4 shrink-0 text-moss/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label="trades for">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {wantItems.map((item) =>
                item.combo != null ? (
                  <span key={item.id} className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800" title={item.combo_name ?? 'combo'}>
                    🎁 {item.combo_code}
                  </span>
                ) : (
                  <GameThumb key={item.id} src={item.board_game_thumbnail} alt={item.board_game_name ?? ''} className="h-7 w-7" />
                )
              )}
            </div>
          )}
        </div>

        {!locked && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onToggle}
              disabled={isToggling}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                wish.active
                  ? 'text-moss hover:text-ink bg-gray-100 hover:bg-gray-200'
                  : 'text-green-600 hover:text-green-800 bg-green-50 hover:bg-green-100'
              }`}
              title={wish.active ? 'Deactivate wish' : 'Activate wish'}
            >
              {wish.active ? 'Pause' : 'Activate'}
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-1">
                <button
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 px-1.5 py-0.5 rounded"
                >
                  {isDeleting ? 'Deleting…' : 'Confirm'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-moss/70 hover:text-moss px-1.5 py-0.5 rounded"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-moss/70 hover:text-red-500 transition-colors px-1.5 py-0.5 rounded"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {!wish.active && (
        <span className="mt-1.5 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-moss/70">
          Paused
        </span>
      )}
    </div>
  )
}

// ============================================================
// MAIN PAGE
// ============================================================

type BuilderTab = 'offers' | 'wants' | 'wishes'

export default function WantListBuilderPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user } = useAuthStore()

  const { data: event, isLoading: eventLoading, isError: eventError } = useEvent(slug)
  const { data: listingsData } = useEventListings(slug, { user: user?.username })
  const { data: offerGroupsData = [] } = useOfferGroups(slug)
  const { data: wantGroupsData = [] } = useWantGroups(slug)

  const [activeTab, setActiveTab] = useState<BuilderTab>('offers')

  const myListings = listingsData?.results ?? []

  if (eventLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-4 animate-pulse">
        <div className="h-8 w-2/3 bg-gray-100 rounded" />
        <div className="h-4 w-1/3 bg-gray-100 rounded" />
        <div className="h-64 bg-gray-100 rounded-xl" />
      </div>
    )
  }

  if (eventError || !event) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-red-700">Event not found or failed to load.</p>
          <BackButton to="/events" className="mt-3">Back to events</BackButton>
        </div>
      </div>
    )
  }

  if (!event.is_participant && !event.is_organizer) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-yellow-700">
            You must join this event before building your want list.
          </p>
          <Link
            to={`/events/${slug}`}
            className="mt-3 inline-block text-sm text-indigo-600 hover:underline"
          >
            Go to event page to join
          </Link>
        </div>
      </div>
    )
  }

  const tabs: { id: BuilderTab; label: string; count?: number }[] = [
    { id: 'offers', label: 'Offer Groups', count: offerGroupsData.length },
    { id: 'wants', label: 'Want Groups', count: wantGroupsData.length },
    { id: 'wishes', label: 'Wishes' },
  ]

  const locked = event.inputs_locked

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-6">
      {/* Back link */}
      <BackButton to={`/events/${slug}`}>Back to {event.name}</BackButton>

      {/* Header */}
      <div className="rounded-xl border border-ink/15 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-ink">Want List Builder</h1>
        <p className="text-sm text-moss mt-1">
          {event.name}
          <span className="mx-2 text-moss/40">·</span>
          Build offer groups, want groups, and link them into wishes
        </p>

        {/* X:Y explained */}
        <div className="mt-3 rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2.5 text-xs text-moss">
          <strong className="text-indigo-700">How it works:</strong> An{' '}
          <span className="font-semibold text-indigo-600">Offer Group</span> is a set of your listings
          with a max-give (X).{' '}
          A <span className="font-semibold text-purple-600">Want Group</span> is a list of
          games/listings you want, with a min-receive (Y).{' '}
          A <span className="font-semibold text-green-600">Wish</span> links them:{' '}
          "Give up to X → Receive at least Y."
          {event.money_enabled && (
            <>
              {' '}
              <span className="font-semibold text-emerald-700">Money:</span> set the most
              you'll <em>pay</em> for a wanted game here. Your sell price is set in My
              Listings / Almanac. A money trade happens only when a buyer's max ≥ a seller's min.
            </>
          )}
        </div>
      </div>

      {locked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This event is locked for matching — want lists can no longer be edited.
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-ink/15 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-moss hover:text-ink hover:border-ink/20'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${
                  activeTab === tab.id ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-moss'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="min-h-[300px]">
        {activeTab === 'offers' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">
                Offer Groups
              </h2>
              <p className="text-xs text-moss/70">
                {myListings.length} listing{myListings.length !== 1 ? 's' : ''} in this event
              </p>
            </div>
            {myListings.length === 0 && (
              <div className="rounded-xl bg-yellow-50 border border-yellow-200 px-3 py-2.5 text-xs text-yellow-700">
                You have no listings in this event yet.{' '}
                <Link to={`/events/${slug}`} className="underline font-medium">
                  Add copies from the event page.
                </Link>
              </div>
            )}
            <OfferGroupsPanel slug={slug!} myListings={myListings} moneyEnabled={event.money_enabled} locked={locked} />
          </div>
        )}

        {activeTab === 'wants' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">
                Want Groups
              </h2>
              <p className="text-xs text-moss/70">
                Games you'd like to receive
              </p>
            </div>
            <WantGroupsPanel slug={slug!} username={user?.username ?? ''} moneyEnabled={event.money_enabled} locked={locked} />
          </div>
        )}

        {activeTab === 'wishes' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">
                Wishes — X:Y links
              </h2>
              <p className="text-xs text-moss/70">
                {offerGroupsData.length} offer · {wantGroupsData.length} want
              </p>
            </div>
            {(offerGroupsData.length === 0 || wantGroupsData.length === 0) && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 px-3 py-2.5 text-xs text-blue-700">
                Create at least one offer group and one want group first.
              </div>
            )}
            <WishesPanel slug={slug!} offerGroups={offerGroupsData} wantGroups={wantGroupsData} locked={locked} />
          </div>
        )}
      </div>
    </div>
  )
}
