import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { PaginatedResponse } from './games'

// ---- Event lifecycle states ----

export type EventStatus =
  | 'DRAFT'
  | 'SUBMISSIONS_OPEN'
  | 'WANTLIST_OPEN'
  | 'MATCHING'
  | 'MATCH_REVIEW'
  | 'FINALIZATION'
  | 'SHIPPING'
  | 'ARCHIVED'

export const EVENT_STATUSES: EventStatus[] = [
  'DRAFT',
  'SUBMISSIONS_OPEN',
  'WANTLIST_OPEN',
  'MATCHING',
  'MATCH_REVIEW',
  'FINALIZATION',
  'SHIPPING',
  'ARCHIVED',
]

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: 'Draft',
  SUBMISSIONS_OPEN: 'Submissions Open',
  WANTLIST_OPEN: 'Want List Open',
  MATCHING: 'Matching',
  MATCH_REVIEW: 'Match Review',
  FINALIZATION: 'Finalization',
  SHIPPING: 'Shipping',
  ARCHIVED: 'Archived',
}

// ---- Types ----

export interface TradeEvent {
  id: number
  name: string
  slug: string
  description: string
  organizer: number
  organizer_username: string
  status: EventStatus
  // Money trading (decimal as string, null when no cap)
  money_enabled: boolean
  max_money_per_user: string | null
  // Date fields (only 3 real ones)
  submissions_open_at: string | null
  submissions_close_at: string | null
  wantlist_close_at: string | null
  // Policies
  shipping_rules: string
  regional_restrictions: string
  trade_policies: string
  algorithm_settings: Record<string, unknown>
  // Cover photo + cached reverse-geocoded place name
  image_url: string
  center_place: string
  // Location gate (organizer-writable)
  require_location: boolean
  center_latitude: number | null
  center_longitude: number | null
  max_distance_km: number | null
  // Computed
  allowed_transitions: EventStatus[]
  participants_count: number
  is_organizer: boolean
  is_participant: boolean
  inputs_locked: boolean
  submissions_locked: boolean
  created: string
  updated: string
}

export interface TradeEventListItem {
  id: number
  name: string
  slug: string
  description: string
  organizer: number
  organizer_username: string
  status: EventStatus
  money_enabled: boolean
  max_money_per_user: string | null
  image_url: string
  center_place: string
  require_location: boolean
  center_latitude: number | null
  center_longitude: number | null
  max_distance_km: number | null
  participants_count: number
  submissions_open_at: string | null
  submissions_close_at: string | null
  is_organizer: boolean
  is_participant: boolean
  created: string
}

export interface EventCreatePayload {
  name: string
  description?: string
  shipping_rules?: string
  regional_restrictions?: string
  trade_policies?: string
  submissions_open_at?: string | null
  submissions_close_at?: string | null
  wantlist_close_at?: string | null
  money_enabled?: boolean
  max_money_per_user?: string | null
  image_url?: string
  require_location?: boolean
  center_latitude?: number | null
  center_longitude?: number | null
  max_distance_km?: number | null
}

export type EventPatchPayload = Partial<EventCreatePayload>

export interface EventParticipant {
  user: number
  username: string
  region: string
  shipping_pref: string
  max_spend: string
  created: string
}

export interface EventListing {
  id: number
  listing_code: string
  board_game_name: string
  board_game_thumbnail: string
  board_game_id: number
  copy_id: number
  copy_owner_id: number
  copy_owner_username: string
  copy_condition: string
  copy_language: string
  owner_too_far?: boolean
  active: boolean
  created: string
  resolved_ask?: string | null
  ask_is_override?: boolean
}

export interface EventListingsParams {
  user?: string
  board_game?: number | string
  page?: number
  page_size?: number
}

/** A canonical game with active copies in this event (event-scoped catalog). */
export interface EventGame {
  bgg_id: number
  name: string
  year_published: number | null
  rank: number | null
  average: number | null
  image_url: string
  thumbnail: string
  copies_count: number
}

export interface EventGamesParams {
  search?: string
  ordering?: 'name' | 'rank' | '-copies_count' | 'copies_count'
  page?: number
  page_size?: number
  wishlisted?: boolean
  min_rating?: number
  is_expansion?: boolean
}

export interface EventsListParams {
  status?: string
  organizer?: string
  search?: string
  page?: number
  joined?: boolean
}

// ---- Query keys ----

export const EVENTS_KEYS = {
  all: ['events'] as const,
  list: (params: EventsListParams) => ['events', 'list', params] as const,
  detail: (slug: string) => ['events', 'detail', slug] as const,
  participants: (slug: string) => ['events', 'participants', slug] as const,
  listings: (slug: string, params?: EventListingsParams) =>
    ['events', 'listings', slug, params ?? {}] as const,
  games: (slug: string, params?: EventGamesParams) =>
    ['events', 'games', slug, params ?? {}] as const,
}

// ---- API functions ----

export async function fetchEvents(
  params: EventsListParams = {}
): Promise<PaginatedResponse<TradeEventListItem>> {
  const p: Record<string, string> = {}
  if (params.status) p.status = params.status
  if (params.organizer) p.organizer = params.organizer
  if (params.search) p.search = params.search
  if (params.page && params.page > 1) p.page = String(params.page)
  if (params.joined) p.joined = '1'
  const { data } = await apiClient.get<PaginatedResponse<TradeEventListItem>>('/events/', {
    params: p,
  })
  return data
}

export async function fetchEvent(slug: string): Promise<TradeEvent> {
  const { data } = await apiClient.get<TradeEvent>(`/events/${slug}/`)
  return data
}

export async function createEvent(payload: EventCreatePayload): Promise<TradeEvent> {
  const { data } = await apiClient.post<TradeEvent>('/events/', payload)
  return data
}

export async function patchEvent(slug: string, payload: EventPatchPayload): Promise<TradeEvent> {
  const { data } = await apiClient.patch<TradeEvent>(`/events/${slug}/`, payload)
  return data
}

export async function deleteEvent(slug: string): Promise<void> {
  await apiClient.delete(`/events/${slug}/`)
}

export async function transitionEvent(slug: string, to: EventStatus): Promise<TradeEvent> {
  const { data } = await apiClient.post<TradeEvent>(`/events/${slug}/transition/`, { to })
  return data
}

export async function fetchParticipants(
  slug: string
): Promise<PaginatedResponse<EventParticipant>> {
  const { data } = await apiClient.get<PaginatedResponse<EventParticipant>>(
    `/events/${slug}/participants/`
  )
  return data
}

export async function joinEvent(slug: string): Promise<EventParticipant> {
  const { data } = await apiClient.post<EventParticipant>(`/events/${slug}/join/`)
  return data
}

/** Set/update the user's money budget for the event (re-uses the join endpoint). */
export async function setEventBudget(slug: string, maxSpend: string): Promise<EventParticipant> {
  const { data } = await apiClient.post<EventParticipant>(`/events/${slug}/join/`, {
    max_spend: maxSpend,
  })
  return data
}

export async function leaveEvent(slug: string): Promise<void> {
  await apiClient.delete(`/events/${slug}/leave/`)
}

export async function fetchEventListings(
  slug: string,
  params: EventListingsParams = {}
): Promise<PaginatedResponse<EventListing>> {
  const p: Record<string, string> = {}
  if (params.user) p.user = params.user
  if (params.board_game != null) p.board_game = String(params.board_game)
  if (params.page && params.page > 1) p.page = String(params.page)
  if (params.page_size) p.page_size = String(params.page_size)
  const { data } = await apiClient.get<PaginatedResponse<EventListing>>(
    `/events/${slug}/listings/`,
    { params: p }
  )
  return data
}

export async function fetchEventGames(
  slug: string,
  params: EventGamesParams = {}
): Promise<PaginatedResponse<EventGame>> {
  const p: Record<string, string> = {}
  if (params.search) p.search = params.search
  if (params.ordering) p.ordering = params.ordering
  if (params.page && params.page > 1) p.page = String(params.page)
  if (params.page_size) p.page_size = String(params.page_size)
  if (params.wishlisted != null) p.wishlisted = String(params.wishlisted)
  if (params.min_rating != null) p.min_rating = String(params.min_rating)
  if (params.is_expansion != null) p.is_expansion = String(params.is_expansion)
  const { data } = await apiClient.get<PaginatedResponse<EventGame>>(
    `/events/${slug}/games/`,
    { params: p }
  )
  return data
}

export async function addEventListing(
  slug: string,
  copyId: number
): Promise<EventListing> {
  const { data } = await apiClient.post<EventListing>(`/events/${slug}/listings/`, {
    copy: copyId,
  })
  return data
}

export async function removeEventListing(slug: string, listingId: number): Promise<void> {
  await apiClient.delete(`/events/${slug}/listings/${listingId}/`)
}

export async function setListingSellPrice(
  slug: string,
  listingId: number,
  sell_price: string | null
): Promise<EventListing> {
  const { data } = await apiClient.patch<EventListing>(
    `/events/${slug}/listings/${listingId}/`,
    { sell_price }
  )
  return data
}

// ---- Hooks ----

export function useEvents(params: EventsListParams = {}) {
  return useQuery({
    queryKey: EVENTS_KEYS.list(params),
    queryFn: () => fetchEvents(params),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

export function useEvent(slug: string | undefined) {
  return useQuery({
    queryKey: EVENTS_KEYS.detail(slug ?? ''),
    queryFn: () => fetchEvent(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function useEventParticipants(slug: string | undefined) {
  return useQuery({
    queryKey: EVENTS_KEYS.participants(slug ?? ''),
    queryFn: () => fetchParticipants(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function useEventListings(slug: string | undefined, params: EventListingsParams = {}) {
  return useQuery({
    queryKey: EVENTS_KEYS.listings(slug ?? '', params),
    queryFn: () => fetchEventListings(slug!, params),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function useEventGames(slug: string | undefined, params: EventGamesParams = {}) {
  return useQuery({
    queryKey: EVENTS_KEYS.games(slug ?? '', params),
    queryFn: () => fetchEventGames(slug!, params),
    enabled: !!slug,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

export function useCreateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createEvent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.all })
    },
  })
}

export function usePatchEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, payload }: { slug: string; payload: EventPatchPayload }) =>
      patchEvent(slug, payload),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.detail(updated.slug) })
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.all })
    },
  })
}

export function useTransitionEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, to }: { slug: string; to: EventStatus }) =>
      transitionEvent(slug, to),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.detail(updated.slug) })
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.all })
    },
  })
}

export function useJoinEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: joinEvent,
    onSuccess: (_data, slug) => {
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.detail(slug) })
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.participants(slug) })
    },
  })
}

export function useSetEventBudget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, maxSpend }: { slug: string; maxSpend: string }) =>
      setEventBudget(slug, maxSpend),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.detail(slug) })
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.participants(slug) })
    },
  })
}

export function useLeaveEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: leaveEvent,
    onSuccess: (_data, slug) => {
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.detail(slug) })
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.participants(slug) })
    },
  })
}

export function useAddEventListing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, copyId }: { slug: string; copyId: number }) =>
      addEventListing(slug, copyId),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.listings(slug) })
    },
  })
}

export function useRemoveEventListing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, listingId }: { slug: string; listingId: number }) =>
      removeEventListing(slug, listingId),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: EVENTS_KEYS.listings(slug) })
    },
  })
}
