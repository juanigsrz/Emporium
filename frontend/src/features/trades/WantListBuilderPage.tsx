import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePageTitle } from '../../hooks/usePageTitle'
import type { TFunction } from 'i18next'

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
  listGamePrices,
  setGamePrice,
  deleteGamePrice,
} from '../../api/trades'
import type {
  OfferGroup,
  OfferGroupItem,
  WantGroup,
  WantGroupItem,
  WantGroupItemPayload,
  TradeWish,
  GamePrice,
} from '../../api/trades'
import { useCombos } from '../../api/combos'
import type { Combo } from '../../api/combos'
import { useCaps, useCreateCap, usePatchCap, useDeleteCap } from '../../api/caps'
import type { Cap, CapKind } from '../../api/caps'

// ---- Helpers ----

function extractErrorMsg(t: TFunction, err: unknown): string {
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
  return t('trades.errors.generic')
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
  const { t } = useTranslation()
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
        <p className="text-xs text-moss/70 py-2">{t('trades.offerGroups.empty')}</p>
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
                setError(extractErrorMsg(t, e))
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
                setError(extractErrorMsg(t, e))
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
              setError(extractErrorMsg(t, e))
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
          {t('trades.offerGroups.newButton')}
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
  const { t } = useTranslation()
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <div className="rounded-2xl border border-ink/15 bg-white p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="text-sm font-semibold text-ink">{group.name}</span>
          <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
            {t('trades.offerGroups.giveUpTo', { max: group.max_give })}
          </span>
        </div>
        {!locked && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={onEdit}
              className="text-xs text-moss/70 hover:text-indigo-600 transition-colors px-1.5 py-0.5 rounded"
            >
              {t('trades.edit')}
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-1">
                <button
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 px-1.5 py-0.5 rounded"
                >
                  {isDeleting ? t('trades.deleting') : t('trades.confirm')}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-moss/70 hover:text-moss px-1.5 py-0.5 rounded"
                >
                  {t('common.cancel')}
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-moss/70 hover:text-red-500 transition-colors px-1.5 py-0.5 rounded"
              >
                {t('common.delete')}
              </button>
            )}
          </div>
        )}
      </div>
      {group.items.length === 0 ? (
        <p className="text-xs text-moss/70 italic">{t('trades.offerGroups.noListingsInGroup')}</p>
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
  const { t } = useTranslation()
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
    if (!name.trim()) { setFormError(t('trades.errors.nameRequired')); return }
    const mg = parseInt(maxGive, 10)
    if (isNaN(mg) || mg < 1) { setFormError(t('trades.errors.maxGiveMin')); return }
    const totalSelected = selectedIds.size + selectedComboIds.size
    if (totalSelected === 0) { setFormError(t('trades.errors.selectAtLeastOne')); return }
    if (mg > totalSelected) { setFormError(t('trades.errors.maxGiveExceeds', { max: mg, total: totalSelected })); return }

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
          <label className="block text-xs font-medium text-ink mb-1">{t('trades.groupNameLabel')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder={t('trades.offerGroups.namePlaceholder')}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1">
            {t('trades.offerGroups.maxGiveLabel')}
          </label>
          <input
            type="number"
            min={1}
            max={(myListings.length + myCombos.length) || 1}
            value={maxGive}
            onChange={(e) => setMaxGive(e.target.value)}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-ink mb-1.5">
          {t('trades.offerGroups.selectListings', { count: selectedIds.size })}
        </p>
        {myListings.length === 0 ? (
          <p className="text-xs text-moss/70 italic">
            {t('trades.offerGroups.noListingsInEvent')}
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
                    {t('trades.offerGroups.sellPriceHint')}
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
            {t('trades.offerGroups.orOfferCombo', { count: selectedComboIds.size })}
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
                <span className="ml-auto text-xs text-moss/60">{t('trades.offerGroups.comboItemsCount', { count: c.items.length })}</span>
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
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="flex-1 rounded-xl border-2 border-ink bg-butter px-3 py-1.5 text-xs font-bold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {isSaving ? t('trades.saving') : existing ? t('trades.saveChanges') : t('trades.createGroup')}
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
  event_listing: number | null
  listing_code: string | null
  combo: number | null
  combo_code: string | null
  combo_name: string | null
  bid: string  // '' = none
}

function makeDraftKey(item: WantGroupItem | DraftWantItem): string {
  return item.combo != null ? `combo-${item.combo}` : `listing-${item.event_listing}`
}

function WantGroupsPanel({ slug, username, moneyEnabled, locked }: WantGroupsPanelProps) {
  const { t } = useTranslation()
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
        <p className="text-xs text-moss/70 py-2">{t('trades.wantGroups.empty')}</p>
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
                setError(extractErrorMsg(t, e))
              }
            }}
            isDeleting={deleteGroup.isPending}
            onToggleDuplicateProtection={async (value) => {
              setError(null)
              try {
                await patchGroup.mutateAsync({ slug, id: group.id, payload: { duplicate_protection: value } })
              } catch (e) {
                setError(extractErrorMsg(t, e))
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
                setError(extractErrorMsg(t, e))
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
          {t('trades.wantGroups.newButton')}
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
  const { t } = useTranslation()
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="rounded-2xl border border-ink/15 bg-white p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="text-sm font-semibold text-ink">{group.name}</span>
          <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
            {t('trades.wantGroups.receiveAny', { min: group.min_receive })}
          </span>
        </div>
        {!locked && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={onEdit}
              className="text-xs text-moss/70 hover:text-indigo-600 transition-colors px-1.5 py-0.5 rounded"
            >
              {t('trades.edit')}
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-1">
                <button
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 px-1.5 py-0.5 rounded"
                >
                  {isDeleting ? t('trades.deleting') : t('trades.confirm')}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-moss/70 hover:text-moss px-1.5 py-0.5 rounded"
                >
                  {t('common.cancel')}
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-moss/70 hover:text-red-500 transition-colors px-1.5 py-0.5 rounded"
              >
                {t('common.delete')}
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
        {t('trades.wantGroups.dupProtectLabel')}
      </label>

      {group.items.length === 0 ? (
        <p className="text-xs text-moss/70 italic">{t('trades.wantGroups.noTargets')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {group.items.map((item) =>
            item.combo != null ? (
              <span
                key={item.id}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs bg-amber-100 text-amber-800"
              >
                🎁 {item.combo_name}
                <span className="font-mono text-amber-700/70">{item.combo_code}</span>
              </span>
            ) : (
              <span
                key={item.id}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs bg-blue-50 text-blue-700"
              >
                <GameThumb src={item.board_game_thumbnail} alt={item.board_game_name ?? ''} className="h-6 w-6" />
                <span className="font-mono text-moss/70">{item.listing_code}</span>
                {item.board_game_name}
                {item.resolved_bid != null && (
                  <span className="rounded bg-emerald-100 px-1 font-semibold text-emerald-700">
                    {t('trades.payUpToAmount', { amount: item.resolved_bid })}
                  </span>
                )}
              </span>
            )
          )}
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
  const { t } = useTranslation()
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
        {' '}{t('trades.gameCopyPicker.chooseWhatToAddSuffix')}
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
        <span className="font-medium">{t('trades.gameCopyPicker.anyCopy')}</span>
        <span className="text-xs text-purple-500 ml-1">{t('trades.gameCopyPicker.anyCopyHint')}</span>
      </label>
      {otherCopies.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-moss">{t('trades.gameCopyPicker.orSpecificCopies')}</p>
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
                {alreadyAdded && <span className="ml-auto text-xs text-moss/70">{t('trades.gameCopyPicker.alreadyAdded')}</span>}
              </label>
            )
          })}
        </div>
      )}
      {otherCopies.length === 0 && listingsData && (
        <p className="text-xs text-moss/70 italic">{t('trades.gameCopyPicker.noOtherCopies')}</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50 transition-colors"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => onCommit(anyCopy ? otherCopies : otherCopies.filter((l) => checkedIds.has(l.id)))}
          disabled={!hasSelection}
          className="flex-1 rounded-xl border-2 border-ink bg-purple-400 px-3 py-1.5 text-xs font-bold text-white shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {t('trades.gameCopyPicker.addToWantGroup')}
        </button>
      </div>
    </div>
  )
}

function WantGroupEditor({ slug, group, username, moneyEnabled, onClose, isCreating }: WantGroupEditorProps) {
  const { t } = useTranslation()
  const patchGroup = usePatchWantGroup()

  const [name, setName] = useState(group?.name ?? '')
  const [minReceive, setMinReceive] = useState(String(group?.min_receive ?? 1))
  const [dupProtect, setDupProtect] = useState(group?.duplicate_protection ?? false)
  const [items, setItems] = useState<DraftWantItem[]>(() =>
    (group?.items ?? []).map((i) => ({
      localId: makeDraftKey(i),
      board_game_name: i.board_game_name,
      event_listing: i.event_listing,
      listing_code: i.listing_code,
      combo: i.combo,
      combo_code: i.combo_code,
      combo_name: i.combo_name,
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
          combo: null,
          combo_code: null,
          combo_name: null,
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
    return items.map((item) =>
      item.combo != null ? { combo: item.combo } : { event_listing: item.event_listing as number }
    )
  }

  // Persist per-listing buy bids as WantBid overrides (decoupled from the want item).
  async function saveWantBids() {
    if (!moneyEnabled) return
    for (const item of items) {
      if (item.combo != null) continue
      const listingId = item.event_listing as number
      const trimmed = item.bid.trim()
      if (trimmed === '') {
        await deleteWantBid(slug, { event_listing: listingId })
      } else {
        await setWantBid(slug, { event_listing: listingId, amount: trimmed })
      }
    }
  }

  async function handleSave() {
    setFormError(null)
    if (!name.trim()) { setFormError(t('trades.errors.nameRequired')); return }
    const mr = parseInt(minReceive, 10)
    if (isNaN(mr) || mr < 1) { setFormError(t('trades.errors.minReceiveMin')); return }
    if (items.length === 0) { setFormError(t('trades.errors.addAtLeastOneTarget')); return }
    if (mr > items.length) { setFormError(t('trades.errors.minReceiveExceeds', { min: mr, total: items.length })); return }

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
        setDuplicateWarn(t('trades.wantGroups.bidsUpdateFailed', { error: extractErrorMsg(t, e) }))
      }
    } catch (e) {
      setFormError(extractErrorMsg(t, e))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-purple-200 bg-purple-50 p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink mb-1">{t('trades.groupNameLabel')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder={t('trades.wantGroups.namePlaceholder')}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1">
            {t('trades.wantGroups.minReceiveLabel')}
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
        {t('trades.wantGroups.protectAgainstDuplicates')}
        <span className="text-moss/70">{t('trades.wantGroups.protectAgainstDuplicatesHint')}</span>
      </label>

      {(formError || duplicateWarn) && (
        <div className={`rounded-xl px-3 py-2 text-xs ${formError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-yellow-50 border border-yellow-200 text-yellow-700'}`}>
          {formError || duplicateWarn}
        </div>
      )}

      {/* Targets list */}
      <div>
        <p className="text-xs font-medium text-moss mb-2">
          {t('trades.wantGroups.targetsHeading', { count: items.length })}
        </p>
        <div className="space-y-1.5 min-h-[40px]">
          {items.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-purple-200 py-4 text-center text-xs text-moss/70">
              {t('trades.wantGroups.searchBelowHint')}
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.localId}
                className="rounded-xl border border-ink/15 bg-white px-3 py-2 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  {item.combo != null ? (
                    <>
                      <span className="text-sm text-ink font-medium truncate block">
                        🎁 {item.combo_name}
                      </span>
                      <span className="text-xs text-amber-600 font-mono">{item.combo_code}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm text-ink font-medium truncate block">
                        {item.board_game_name}
                      </span>
                      <span className="text-xs text-blue-600 font-mono">{item.listing_code}</span>
                    </>
                  )}
                </div>
                {moneyEnabled && item.combo == null && (
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-xs text-moss/70">{t('trades.payUpToLabel')}</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.bid}
                      onChange={(e) => setMoney(item.localId, e.target.value)}
                      placeholder="0"
                      title={t('trades.wantGroups.bidInputTitle')}
                      className="w-20 rounded-xl border border-ink/20 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeItem(item.localId)}
                  className="shrink-0 text-xs text-moss/40 hover:text-red-500 transition-colors"
                  aria-label={t('trades.wantGroups.removeTargetAriaLabel')}
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
        <p className="text-xs font-medium text-ink">{t('trades.wantGroups.searchGameLabel')}</p>
        <input
          value={gameSearch}
          onChange={(e) => { setGameSearch(e.target.value); setActiveGame(null) }}
          placeholder={t('trades.wantGroups.searchGamePlaceholder')}
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
                <span className="ml-2 text-xs text-moss/70">{t('trades.copiesCount', { count: game.copies_count })}</span>
              </button>
            ))}
          </div>
        )}
        {!activeGame && gameSearch.length >= 2 && gameResults?.results.length === 0 && (
          <p className="text-xs text-moss/70">{t('trades.wantGroups.noGamesFound')}</p>
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
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 rounded-xl border-2 border-ink bg-purple-400 px-3 py-1.5 text-xs font-bold text-white shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {isSaving ? t('trades.saving') : group ? t('trades.saveChanges') : t('trades.createGroup')}
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
  const { t } = useTranslation()
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
      setError(t('trades.errors.selectBothGroups'))
      return
    }
    const ogId = parseInt(selectedOG, 10)
    const wgId = parseInt(selectedWG, 10)
    // Check duplicate
    if (wishes.some((w) => w.offer_group === ogId && w.want_group === wgId)) {
      setError(t('trades.errors.wishAlreadyExists'))
      return
    }
    try {
      await createWish.mutateAsync({ slug, payload: { offer_group: ogId, want_group: wgId, active: true } })
      setShowForm(false)
      setSelectedOG('')
      setSelectedWG('')
    } catch (e) {
      setError(extractErrorMsg(t, e))
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
          {t('trades.wishes.empty')}
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
              setError(extractErrorMsg(t, e))
            }
          }}
          onDelete={async () => {
            setError(null)
            try {
              await deleteWish.mutateAsync({ slug, id: wish.id })
            } catch (e) {
              setError(extractErrorMsg(t, e))
            }
          }}
          isToggling={toggleWish.isPending}
          isDeleting={deleteWish.isPending}
          locked={locked}
        />
      ))}

      {showForm ? (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-3 space-y-3">
          <p className="text-xs font-semibold text-green-700">{t('trades.wishes.newWishHeading')}</p>

          <div className="grid grid-cols-1 gap-2">
            <div>
              <label className="block text-xs font-medium text-ink mb-1">{t('trades.wishes.offerGroupLabel')}</label>
              {offerGroups.length === 0 ? (
                <p className="text-xs text-moss/70 italic">{t('trades.wishes.createOfferGroupFirst')}</p>
              ) : (
                <select
                  value={selectedOG}
                  onChange={(e) => setSelectedOG(e.target.value)}
                  className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">{t('trades.wishes.selectOfferGroupPlaceholder')}</option>
                  {offerGroups.map((og) => (
                    <option key={og.id} value={og.id}>
                      {t('trades.wishes.offerGroupOption', { name: og.name, max: og.max_give })}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">{t('trades.wishes.wantGroupLabel')}</label>
              {wantGroups.length === 0 ? (
                <p className="text-xs text-moss/70 italic">{t('trades.wishes.createWantGroupFirst')}</p>
              ) : (
                <select
                  value={selectedWG}
                  onChange={(e) => setSelectedWG(e.target.value)}
                  className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">{t('trades.wishes.selectWantGroupPlaceholder')}</option>
                  {wantGroups.map((wg) => (
                    <option key={wg.id} value={wg.id}>
                      {t('trades.wishes.wantGroupOption', { name: wg.name, min: wg.min_receive })}
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
                  {t('trades.wishes.summarySuffix', { max: og.max_give, min: wg.min_receive })}
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
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={createWish.isPending || offerGroups.length === 0 || wantGroups.length === 0}
              className="flex-1 rounded-xl border-2 border-ink bg-green-400 px-3 py-1.5 text-xs font-bold text-white shadow-pop-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              {createWish.isPending ? t('trades.wishes.creating') : t('trades.wishes.createWish')}
            </button>
          </div>
        </div>
      ) : !locked ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full rounded-2xl border-2 border-dashed border-ink/15 py-3 text-xs font-medium text-moss/70 hover:border-green-300 hover:text-green-500 transition-colors"
        >
          {t('trades.wishes.newWishButton')}
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
  const { t } = useTranslation()
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
            {t('trades.wishes.giveAnyPrefix')} <strong>{wish.max_give}</strong> {t('trades.wishes.itemsArrowReceiveAny')} <strong>{wish.min_receive}</strong> {t('trades.wishes.itemsSuffix')}
          </p>

          {(offerItems.length > 0 || wantItems.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {offerItems.map((item) =>
                item.combo != null ? (
                  <span key={item.id} className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800" title={item.combo_name ?? t('trades.comboFallback')}>
                    🎁 {item.combo_code}
                  </span>
                ) : (
                  <GameThumb key={item.id} src={item.board_game_thumbnail} alt={item.board_game_name ?? ''} className="h-7 w-7" />
                )
              )}
              <svg className="h-4 w-4 shrink-0 text-moss/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label={t('trades.tradesForAriaLabel')}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {wantItems.map((item) =>
                item.combo != null ? (
                  <span key={item.id} className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800" title={item.combo_name ?? t('trades.comboFallback')}>
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
              title={wish.active ? t('trades.wishes.deactivateTitle') : t('trades.wishes.activateTitle')}
            >
              {wish.active ? t('trades.wishes.pause') : t('trades.wishes.activate')}
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-1">
                <button
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 px-1.5 py-0.5 rounded"
                >
                  {isDeleting ? t('trades.deleting') : t('trades.confirm')}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-moss/70 hover:text-moss px-1.5 py-0.5 rounded"
                >
                  {t('common.cancel')}
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-moss/70 hover:text-red-500 transition-colors px-1.5 py-0.5 rounded"
              >
                {t('common.delete')}
              </button>
            )}
          </div>
        )}
      </div>

      {!wish.active && (
        <span className="mt-1.5 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-moss/70">
          {t('trades.wishes.paused')}
        </span>
      )}
    </div>
  )
}

// ============================================================
// CAPS PANEL — user-defined takecap / givecap
// ============================================================

interface CapsPanelProps {
  slug: string
  username: string
  locked?: boolean
}

function CapsPanel({ slug, username, locked }: CapsPanelProps) {
  const { t } = useTranslation()
  const { data: capsData, isLoading } = useCaps(slug)
  const deleteCap = useDeleteCap()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Cap | null>(null)
  const [error, setError] = useState<string | null>(null)

  const caps = capsData?.results ?? []

  async function handleDelete(id: number) {
    setError(null)
    try {
      await deleteCap.mutateAsync({ slug, id })
    } catch (e) {
      setError(extractErrorMsg(t, e))
    }
  }

  if (isLoading) {
    return <div className="h-16 rounded-2xl bg-gray-100 animate-pulse" />
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-moss/70">
        {t('trades.caps.descPrefix')} (<strong>{t('trades.caps.takeWord')}</strong>) {t('trades.caps.descMid')}
        {' '}(<strong>{t('trades.caps.giveWord')}</strong>) {t('trades.caps.descSuffix')}
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {(showForm || editing) && !locked && (
        <CapForm
          key={editing?.id ?? 'new'}
          slug={slug}
          username={username}
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}

      {caps.length === 0 && !showForm && !editing && (
        <p className="text-xs text-moss/70 py-2">{t('trades.caps.empty')}</p>
      )}

      {caps.map((cap) => (
        <CapCard
          key={cap.id}
          cap={cap}
          locked={locked}
          onEdit={() => { setEditing(cap); setShowForm(false) }}
          onDelete={() => handleDelete(cap.id)}
          isDeleting={deleteCap.isPending}
        />
      ))}

      {!locked && !showForm && !editing && (
        <button
          onClick={() => { setEditing(null); setShowForm(true) }}
          className="w-full rounded-2xl border-2 border-dashed border-ink/15 py-3 text-xs font-medium text-moss/70 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
        >
          {t('trades.caps.newButton')}
        </button>
      )}
    </div>
  )
}

function CapCard({ cap, locked, onEdit, onDelete, isDeleting }: {
  cap: Cap
  locked?: boolean
  onEdit: () => void
  onDelete: () => void
  isDeleting: boolean
}) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState(false)
  const verb = t(`trades.capVerb.${cap.kind}`)
  return (
    <div className="rounded-2xl border border-ink/15 bg-white p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
          {t('trades.caps.atMost', { verb, n: cap.n })}
        </span>
        {!locked && (
          <div className="flex gap-1 shrink-0">
            <button onClick={onEdit} className="text-xs text-moss/70 hover:text-indigo-600 px-1.5 py-0.5 rounded">{t('trades.edit')}</button>
            {confirm ? (
              <span className="flex items-center gap-1">
                <button onClick={onDelete} disabled={isDeleting} className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 px-1.5 py-0.5 rounded">
                  {isDeleting ? t('trades.deleting') : t('trades.confirm')}
                </button>
                <button onClick={() => setConfirm(false)} className="text-xs text-moss/70 hover:text-moss px-1.5 py-0.5 rounded">{t('common.cancel')}</button>
              </span>
            ) : (
              <button onClick={() => setConfirm(true)} className="text-xs text-moss/70 hover:text-red-500 px-1.5 py-0.5 rounded">{t('common.delete')}</button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cap.items.map((it) =>
          it.combo != null ? (
            <span key={it.id} className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              🎁 {it.combo_name} <span className="font-mono text-amber-700/70">{it.combo_code}</span>
            </span>
          ) : (
            <span key={it.id} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-ink">
              <span className="font-mono text-moss/70">{it.listing_code}</span>
              {it.board_game_name}
            </span>
          )
        )}
      </div>
    </div>
  )
}

function CapForm({ slug, username, editing, onClose }: {
  slug: string
  username: string
  editing: Cap | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const createCap = useCreateCap()
  const patchCap = usePatchCap()
  const { data: listingsData } = useEventListings(slug, { page_size: 200 })
  const { data: combosData } = useCombos(slug)
  const allListings = listingsData?.results ?? []
  const allCombos = combosData?.results ?? []

  const [kind, setKind] = useState<CapKind>(editing?.kind ?? 'TAKE')
  const [n, setN] = useState(String(editing?.n ?? 1))
  const [listingIds, setListingIds] = useState<Set<number>>(
    new Set((editing?.items ?? []).filter((i) => i.event_listing != null).map((i) => i.event_listing as number))
  )
  const [comboIds, setComboIds] = useState<Set<number>>(
    new Set((editing?.items ?? []).filter((i) => i.combo != null).map((i) => i.combo as number))
  )
  const [error, setError] = useState<string | null>(null)
  const saving = createCap.isPending || patchCap.isPending

  // GIVE: only your own items can be capped. TAKE: any item.
  const listings = kind === 'GIVE'
    ? allListings.filter((l) => l.copy_owner_username === username)
    : allListings
  const combos = kind === 'GIVE'
    ? allCombos.filter((c) => c.owner_username === username)
    : allCombos

  function toggle(set: Set<number>, setter: (s: Set<number>) => void, id: number) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    setter(next)
  }

  async function handleSave() {
    setError(null)
    const nn = parseInt(n, 10)
    if (isNaN(nn) || nn < 1) { setError(t('trades.errors.nMin')); return }
    if (listingIds.size + comboIds.size === 0) { setError(t('trades.errors.pickAtLeastOneItem')); return }
    const payload = {
      kind, n: nn,
      item_listing_ids: Array.from(listingIds),
      item_combo_ids: Array.from(comboIds),
    }
    try {
      if (editing) await patchCap.mutateAsync({ slug, id: editing.id, payload })
      else await createCap.mutateAsync({ slug, payload })
      onClose()
    } catch (e) {
      setError(extractErrorMsg(t, e))
    }
  }

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-3 space-y-3">
      <p className="text-xs font-semibold text-indigo-700">{editing ? t('trades.caps.editHeading') : t('trades.caps.newHeading')}</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink mb-1">{t('trades.caps.kindLabel')}</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as CapKind)}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="TAKE">{t('trades.caps.kindTakeOption')}</option>
            <option value="GIVE">{t('trades.caps.kindGiveOption')}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1">{t('trades.caps.nLabel')}</label>
          <input
            type="number" min={1} value={n}
            onChange={(e) => setN(e.target.value)}
            className="w-full rounded-xl border border-ink/20 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-ink mb-1.5">
          {t('trades.caps.itemsHeading', { count: listingIds.size + comboIds.size })}
          {kind === 'GIVE' && <span className="ml-1 text-moss/60">{t('trades.caps.ownItemsOnlyHint')}</span>}
        </p>
        <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto">
          {listings.map((l: EventListing) => (
            <label key={`l-${l.id}`} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 cursor-pointer text-sm ${
              listingIds.has(l.id) ? 'border-indigo-400 bg-white text-indigo-800' : 'border-ink/15 bg-white text-ink hover:border-indigo-200'
            }`}>
              <input type="checkbox" checked={listingIds.has(l.id)} onChange={() => toggle(listingIds, setListingIds, l.id)} />
              <span className="font-medium">{l.board_game_name}</span>
              <span className="font-mono text-xs text-moss/70">{l.listing_code}</span>
            </label>
          ))}
          {combos.map((c) => (
            <label key={`c-${c.id}`} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 cursor-pointer text-sm ${
              comboIds.has(c.id) ? 'border-amber-400 bg-white text-amber-800' : 'border-ink/15 bg-white text-ink hover:border-amber-200'
            }`}>
              <input type="checkbox" checked={comboIds.has(c.id)} onChange={() => toggle(comboIds, setComboIds, c.id)} />
              <span className="font-medium">🎁 {c.name}</span>
              <span className="font-mono text-xs text-moss/70">{c.combo_code}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving} className="rounded-xl border-2 border-ink bg-indigo-400 px-3 py-1.5 text-xs font-bold text-white shadow-pop-sm disabled:opacity-60">
          {saving ? t('trades.saving') : editing ? t('common.save') : t('trades.caps.createButton')}
        </button>
        <button onClick={onClose} className="rounded-xl border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50">{t('common.cancel')}</button>
      </div>
    </div>
  )
}

// ============================================================
// PRICES PANEL — per-copy bid overrides (+ per-game defaults)
// ============================================================

interface PricesPanelProps {
  slug: string
  username: string
  locked?: boolean
}

function PricesPanel({ slug, locked }: PricesPanelProps) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: wantGroups = [] } = useWantGroups(slug)
  const { data: gamePrices = [] } = useQuery({
    queryKey: ['trades', 'game-prices', slug],
    queryFn: () => listGamePrices(slug),
    staleTime: 30_000,
  })

  // Unique wanted listing targets (a copy may appear in several want groups).
  const byListing = new Map<number, WantGroupItem>()
  for (const wg of wantGroups) {
    for (const it of wg.items) {
      if (it.event_listing != null && !byListing.has(it.event_listing)) {
        byListing.set(it.event_listing, it)
      }
    }
  }
  const wantedCopies = Array.from(byListing.values())

  return (
    <div className="space-y-5">
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        {t('trades.prices.descPrefix')} <strong>{t('trades.prices.bidWord')}</strong> {t('trades.prices.descSuffix')}
      </p>

      <div>
        <h3 className="text-sm font-semibold text-ink mb-2">{t('trades.prices.perCopyBidsHeading')}</h3>
        {wantedCopies.length === 0 ? (
          <p className="text-xs text-moss/70">{t('trades.prices.noWantedCopies')}</p>
        ) : (
          <div className="space-y-1.5">
            {wantedCopies.map((it) => (
              <CopyBidRow key={it.event_listing as number} slug={slug} item={it} locked={locked} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink mb-2">{t('trades.prices.perGameDefaultsHeading')}</h3>
        {gamePrices.length === 0 ? (
          <p className="text-xs text-moss/70">{t('trades.prices.noGamePrices')}</p>
        ) : (
          <div className="space-y-1.5">
            {gamePrices.map((gp: GamePrice) => (
              <GamePriceRow key={gp.id} slug={slug} gp={gp} locked={locked} onChanged={() => qc.invalidateQueries({ queryKey: ['trades', 'game-prices', slug] })} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CopyBidRow({ slug, item, locked }: { slug: string; item: WantGroupItem; locked?: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const isOverride = item.bid_is_override === true
  const [value, setValue] = useState(isOverride ? (item.resolved_bid ?? '') : '')
  const [busy, setBusy] = useState(false)
  const elId = item.event_listing as number

  async function commit() {
    setBusy(true)
    try {
      const v = value.trim()
      if (v === '') await deleteWantBid(slug, { event_listing: elId })
      else await setWantBid(slug, { event_listing: elId, amount: v })
      qc.invalidateQueries({ queryKey: ['trades', 'want-groups', slug] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-ink/15 bg-white px-3 py-2">
      <div className="min-w-0">
        <span className="block truncate text-sm text-ink">{item.board_game_name}</span>
        <span className="font-mono text-xs text-moss/70">{item.listing_code}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-xs text-moss/70">{t('trades.bidUpToLabel')}</span>
        <input
          type="number" min={0} step="0.01" disabled={locked || busy}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          placeholder={!isOverride && item.resolved_bid ? item.resolved_bid : t('trades.defaultPlaceholder')}
          title={t('trades.prices.copyBidTitle')}
          className="no-spinner w-24 rounded border border-ink/20 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400 disabled:opacity-50"
        />
      </div>
    </div>
  )
}

function GamePriceRow({ slug, gp, locked, onChanged }: { slug: string; gp: GamePrice; locked?: boolean; onChanged: () => void }) {
  const [value, setValue] = useState(gp.price)
  const [busy, setBusy] = useState(false)

  async function commit() {
    setBusy(true)
    try {
      const v = value.trim()
      if (v === '') await deleteGamePrice(slug, gp.board_game)
      else await setGamePrice(slug, gp.board_game, v)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-ink/15 bg-white px-3 py-2">
      <span className="truncate text-sm text-ink">{gp.board_game_name}</span>
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-xs text-moss/70">$</span>
        <input
          type="number" min="0.01" step="0.01" disabled={locked || busy}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          className="no-spinner w-24 rounded border border-ink/20 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400 disabled:opacity-50"
        />
      </div>
    </div>
  )
}

// ============================================================
// MAIN PAGE
// ============================================================

type BuilderTab = 'offers' | 'wants' | 'wishes' | 'caps' | 'prices'

export default function WantListBuilderPage() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const { user } = useAuthStore()

  const { data: event, isLoading: eventLoading, isError: eventError } = useEvent(slug)
  usePageTitle(event?.name ? `${t('trades.builder.title')} · ${event.name}` : t('trades.builder.title'))
  const { data: listingsData } = useEventListings(slug, { user: user?.username, page_size: 100 })
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
          <p className="text-sm font-medium text-red-700">{t('trades.notFoundError')}</p>
          <BackButton to="/events" className="mt-3">{t('trades.backToEvents')}</BackButton>
        </div>
      </div>
    )
  }

  if (!event.is_participant && !event.is_organizer) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-yellow-700">
            {t('trades.mustJoinToBuild')}
          </p>
          <Link
            to={`/events/${slug}`}
            className="mt-3 inline-block text-sm text-indigo-600 hover:underline"
          >
            {t('trades.goToEventToJoin')}
          </Link>
        </div>
      </div>
    )
  }

  const tabs: { id: BuilderTab; label: string; count?: number }[] = [
    { id: 'offers', label: t('trades.builder.tabs.offers'), count: offerGroupsData.length },
    { id: 'wants', label: t('trades.builder.tabs.wants'), count: wantGroupsData.length },
    { id: 'wishes', label: t('trades.builder.tabs.wishes') },
    { id: 'caps', label: t('trades.builder.tabs.caps') },
    ...(event.money_enabled ? [{ id: 'prices' as BuilderTab, label: t('trades.builder.tabs.prices') }] : []),
  ]

  const locked = event.inputs_locked

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-6">
      {/* Back link */}
      <BackButton to={`/events/${slug}`}>{t('trades.backToEvent', { name: event.name })}</BackButton>

      {/* Header */}
      <div className="rounded-xl border border-ink/15 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-ink">{t('trades.builder.title')}</h1>
        <p className="text-sm text-moss mt-1">
          {event.name}
          <span className="mx-2 text-moss/40">·</span>
          {t('trades.builder.subtitle')}
        </p>

        {/* X:Y explained */}
        <div className="mt-3 rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2.5 text-xs text-moss">
          <strong className="text-indigo-700">{t('trades.builder.howItWorksLabel')}</strong> {t('trades.builder.offerGroupSentence1')}{' '}
          <span className="font-semibold text-indigo-600">{t('trades.builder.offerGroupTerm')}</span>{' '}
          {t('trades.builder.offerGroupSentence2')}{' '}
          {t('trades.builder.wantGroupSentence1')} <span className="font-semibold text-purple-600">{t('trades.builder.wantGroupTerm')}</span>{' '}
          {t('trades.builder.wantGroupSentence2')}{' '}
          {t('trades.builder.wishSentence1')} <span className="font-semibold text-green-600">{t('trades.builder.wishTerm')}</span>{' '}
          {t('trades.builder.wishSentence2')}{' '}
          {t('trades.builder.example')}
          {event.money_enabled && (
            <>
              {' '}
              <span className="font-semibold text-emerald-700">{t('trades.builder.moneyTerm')}</span>{' '}
              {t('trades.builder.moneySentence1')} <em>{t('trades.builder.payWord')}</em>{' '}
              {t('trades.builder.moneySentence2')}
            </>
          )}
        </div>
      </div>

      {locked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('trades.lockedBanner')}
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
                {t('trades.builder.tabs.offers')}
              </h2>
              <p className="text-xs text-moss/70">
                {t('trades.listingsInEventCount', { count: myListings.length })}
              </p>
            </div>
            {myListings.length === 0 && (
              <div className="rounded-xl bg-yellow-50 border border-yellow-200 px-3 py-2.5 text-xs text-yellow-700">
                {t('trades.builder.noListingsPrefix')}{' '}
                <Link to={`/events/${slug}`} className="underline font-medium">
                  {t('trades.builder.addCopiesLink')}
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
                {t('trades.builder.tabs.wants')}
              </h2>
              <p className="text-xs text-moss/70">
                {t('trades.builder.wantsSubtitle')}
              </p>
            </div>
            <WantGroupsPanel slug={slug!} username={user?.username ?? ''} moneyEnabled={event.money_enabled} locked={locked} />
          </div>
        )}

        {activeTab === 'wishes' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">
                {t('trades.builder.wishesTabHeading')}
              </h2>
              <p className="text-xs text-moss/70">
                {t('trades.builder.offerWantSummary', { offerCount: offerGroupsData.length, wantCount: wantGroupsData.length })}
              </p>
            </div>
            {(offerGroupsData.length === 0 || wantGroupsData.length === 0) && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 px-3 py-2.5 text-xs text-blue-700">
                {t('trades.builder.createGroupsFirstHint')}
              </div>
            )}
            <WishesPanel slug={slug!} offerGroups={offerGroupsData} wantGroups={wantGroupsData} locked={locked} />
          </div>
        )}

        {activeTab === 'caps' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">{t('trades.builder.capsTabHeading')}</h2>
              <p className="text-xs text-moss/70">{t('trades.builder.capsTabSubtitle')}</p>
            </div>
            <CapsPanel slug={slug!} username={user?.username ?? ''} locked={locked} />
          </div>
        )}

        {activeTab === 'prices' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">{t('trades.builder.pricesTabHeading')}</h2>
              <p className="text-xs text-moss/70">{t('trades.builder.pricesTabSubtitle')}</p>
            </div>
            <PricesPanel slug={slug!} username={user?.username ?? ''} locked={locked} />
          </div>
        )}
      </div>
    </div>
  )
}
