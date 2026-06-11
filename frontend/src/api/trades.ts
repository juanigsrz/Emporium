import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { PaginatedResponse } from './games'

// ---- Types (exact shapes verified from running backend) ----

export interface OfferGroupItem {
  id: number
  event_listing: number
  listing_code: string
  board_game_name: string
  board_game_id: number
}

export interface OfferGroup {
  id: number
  event: number
  user: number
  user_username: string
  name: string
  max_give: number
  rules: Record<string, unknown>
  items: OfferGroupItem[]
  created: string
  updated: string
}

export interface OfferGroupPayload {
  name: string
  max_give: number
  item_listing_ids: number[]
}

export interface WantGroupItem {
  id: number
  target_type: 'BOARD_GAME' | 'LISTING'
  board_game: number | null
  board_game_name: string | null
  /** Canonical bgg id for BOTH types — use to group LISTING items under a game. */
  board_game_id: number | null
  event_listing: number | null
  listing_code: string | null
  resolved_bid?: string | null
  bid_is_override?: boolean
}

export interface WantGroup {
  id: number
  event: number
  user: number
  user_username: string
  name: string
  min_receive: number
  duplicate_protection: boolean
  items: WantGroupItem[]
  created: string
  updated: string
}

export interface WantGroupItemPayload {
  target_type: 'BOARD_GAME' | 'LISTING'
  board_game?: number
  event_listing?: number
}

export interface WantGroupPayload {
  name: string
  min_receive: number
  duplicate_protection?: boolean
  items: WantGroupItemPayload[]
}

export interface WantGroupPatchPayload {
  name?: string
  min_receive?: number
  duplicate_protection?: boolean
  items?: WantGroupItemPayload[]
}

export interface TradeWish {
  id: number
  event: number
  user: number
  user_username: string
  offer_group: number
  offer_group_name: string
  max_give: number
  want_group: number
  want_group_name: string
  min_receive: number
  active: boolean
  created: string
  updated: string
}

export interface WishPayload {
  offer_group: number
  want_group: number
  active: boolean
}

// ---- Query keys ----

export const TRADES_KEYS = {
  offerGroups: (slug: string) => ['trades', 'offer-groups', slug] as const,
  offerGroup: (slug: string, id: number) => ['trades', 'offer-group', slug, id] as const,
  wantGroups: (slug: string) => ['trades', 'want-groups', slug] as const,
  wantGroup: (slug: string, id: number) => ['trades', 'want-group', slug, id] as const,
  wishes: (slug: string) => ['trades', 'wishes', slug] as const,
}

// ---- Offer Groups ----

async function fetchOfferGroups(slug: string): Promise<OfferGroup[]> {
  const { data } = await apiClient.get<PaginatedResponse<OfferGroup>>(`/events/${slug}/offer-groups/`)
  return data.results
}

async function createOfferGroup(slug: string, payload: OfferGroupPayload): Promise<OfferGroup> {
  const { data } = await apiClient.post<OfferGroup>(`/events/${slug}/offer-groups/`, payload)
  return data
}

async function patchOfferGroup(
  slug: string,
  id: number,
  payload: Partial<OfferGroupPayload>
): Promise<OfferGroup> {
  const { data } = await apiClient.patch<OfferGroup>(`/events/${slug}/offer-groups/${id}/`, payload)
  return data
}

async function deleteOfferGroup(slug: string, id: number): Promise<void> {
  await apiClient.delete(`/events/${slug}/offer-groups/${id}/`)
}

// ---- Want Groups ----

async function fetchWantGroups(slug: string): Promise<WantGroup[]> {
  const { data } = await apiClient.get<PaginatedResponse<WantGroup>>(`/events/${slug}/want-groups/`)
  return data.results
}

async function createWantGroup(slug: string, payload: WantGroupPayload): Promise<WantGroup> {
  const { data } = await apiClient.post<WantGroup>(`/events/${slug}/want-groups/`, payload)
  return data
}

async function patchWantGroup(
  slug: string,
  id: number,
  payload: WantGroupPatchPayload
): Promise<WantGroup> {
  const { data } = await apiClient.patch<WantGroup>(`/events/${slug}/want-groups/${id}/`, payload)
  return data
}

async function deleteWantGroup(slug: string, id: number): Promise<void> {
  await apiClient.delete(`/events/${slug}/want-groups/${id}/`)
}

// ---- Wishes ----

async function fetchWishes(slug: string): Promise<TradeWish[]> {
  const { data } = await apiClient.get<PaginatedResponse<TradeWish>>(`/events/${slug}/wishes/`)
  return data.results
}

async function createWish(slug: string, payload: WishPayload): Promise<TradeWish> {
  const { data } = await apiClient.post<TradeWish>(`/events/${slug}/wishes/`, payload)
  return data
}

async function patchWish(slug: string, id: number, active: boolean): Promise<TradeWish> {
  const { data } = await apiClient.patch<TradeWish>(`/events/${slug}/wishes/${id}/`, { active })
  return data
}

async function deleteWish(slug: string, id: number): Promise<void> {
  await apiClient.delete(`/events/${slug}/wishes/${id}/`)
}

// ---- Game Prices ----

export interface GamePrice {
  id: number
  board_game: number
  board_game_name: string
  price: string
  updated: string
}

export async function listGamePrices(slug: string): Promise<GamePrice[]> {
  const { data } = await apiClient.get<GamePrice[]>(`/events/${slug}/game-prices/`)
  return data
}

export async function setGamePrice(slug: string, board_game: number, price: string): Promise<GamePrice> {
  const { data } = await apiClient.put<GamePrice>(`/events/${slug}/game-prices/`, { board_game, price })
  return data
}

export async function deleteGamePrice(slug: string, board_game: number): Promise<void> {
  await apiClient.delete(`/events/${slug}/game-prices/`, { params: { board_game } })
}

// ---- Want Bids ----

export interface WantBidPayload {
  target_type: 'BOARD_GAME' | 'LISTING'
  board_game?: number | null
  event_listing?: number | null
  amount: string
}

export interface WantBid {
  id: number
  target_type: 'BOARD_GAME' | 'LISTING'
  board_game: number | null
  event_listing: number | null
  amount: string
  updated: string
}

export async function setWantBid(slug: string, body: WantBidPayload): Promise<WantBid> {
  const { data } = await apiClient.put<WantBid>(`/events/${slug}/want-bids/`, body)
  return data
}

export async function deleteWantBid(
  slug: string,
  target: { board_game?: number; event_listing?: number }
): Promise<void> {
  await apiClient.delete(`/events/${slug}/want-bids/`, { params: target })
}

// ---- Raw helpers (for sequential orchestration outside React hooks) ----
// Used by MyWantsPage to lazily create the offer/want/wish trio per item and
// batch-PATCH want lists on Save. Same endpoints as the hooks above.

export const createOfferGroupRaw = createOfferGroup
export const createWantGroupRaw = createWantGroup
export const patchWantGroupRaw = patchWantGroup
export const createWishRaw = createWish

export function invalidateTrades(qc: QueryClient, slug: string): void {
  qc.invalidateQueries({ queryKey: TRADES_KEYS.offerGroups(slug) })
  qc.invalidateQueries({ queryKey: TRADES_KEYS.wantGroups(slug) })
  qc.invalidateQueries({ queryKey: TRADES_KEYS.wishes(slug) })
}

// ---- Hooks ----

export function useOfferGroups(slug: string | undefined) {
  return useQuery({
    queryKey: TRADES_KEYS.offerGroups(slug ?? ''),
    queryFn: () => fetchOfferGroups(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function useCreateOfferGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, payload }: { slug: string; payload: OfferGroupPayload }) =>
      createOfferGroup(slug, payload),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: TRADES_KEYS.offerGroups(slug) })
    },
  })
}

export function usePatchOfferGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      slug,
      id,
      payload,
    }: {
      slug: string
      id: number
      payload: Partial<OfferGroupPayload>
    }) => patchOfferGroup(slug, id, payload),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: TRADES_KEYS.offerGroups(slug) })
    },
  })
}

export function useDeleteOfferGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, id }: { slug: string; id: number }) => deleteOfferGroup(slug, id),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: TRADES_KEYS.offerGroups(slug) })
      qc.invalidateQueries({ queryKey: TRADES_KEYS.wishes(slug) })
    },
  })
}

export function useWantGroups(slug: string | undefined) {
  return useQuery({
    queryKey: TRADES_KEYS.wantGroups(slug ?? ''),
    queryFn: () => fetchWantGroups(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function useCreateWantGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, payload }: { slug: string; payload: WantGroupPayload }) =>
      createWantGroup(slug, payload),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: TRADES_KEYS.wantGroups(slug) })
    },
  })
}

export function usePatchWantGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      slug,
      id,
      payload,
    }: {
      slug: string
      id: number
      payload: WantGroupPatchPayload
    }) => patchWantGroup(slug, id, payload),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: TRADES_KEYS.wantGroups(slug) })
    },
  })
}

export function useDeleteWantGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, id }: { slug: string; id: number }) => deleteWantGroup(slug, id),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: TRADES_KEYS.wantGroups(slug) })
      qc.invalidateQueries({ queryKey: TRADES_KEYS.wishes(slug) })
    },
  })
}

export function useWishes(slug: string | undefined) {
  return useQuery({
    queryKey: TRADES_KEYS.wishes(slug ?? ''),
    queryFn: () => fetchWishes(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function useCreateWish() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, payload }: { slug: string; payload: WishPayload }) =>
      createWish(slug, payload),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: TRADES_KEYS.wishes(slug) })
    },
  })
}

export function useToggleWish() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, id, active }: { slug: string; id: number; active: boolean }) =>
      patchWish(slug, id, active),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: TRADES_KEYS.wishes(slug) })
    },
  })
}

export function useDeleteWish() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, id }: { slug: string; id: number }) => deleteWish(slug, id),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: TRADES_KEYS.wishes(slug) })
    },
  })
}
