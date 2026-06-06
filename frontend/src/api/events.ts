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
  // Date fields (only 3 real ones)
  submissions_open_at: string | null
  submissions_close_at: string | null
  wantlist_close_at: string | null
  // Policies
  shipping_rules: string
  regional_restrictions: string
  trade_policies: string
  algorithm_settings: Record<string, unknown>
  // Computed
  allowed_transitions: EventStatus[]
  participants_count: number
  is_organizer: boolean
  is_participant: boolean
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
}

export type EventPatchPayload = Partial<EventCreatePayload>

export interface EventParticipant {
  user: number
  username: string
  region: string
  shipping_pref: string
  created: string
}

export interface EventListing {
  id: number
  listing_code: string
  board_game_name: string
  board_game_id: number
  copy_id: number
  copy_owner_id: number
  copy_owner_username: string
  active: boolean
  created: string
}

export interface EventListingsParams {
  user?: string
  board_game?: number | string
  page?: number
}

export interface EventsListParams {
  status?: string
  organizer?: string
  search?: string
  page?: number
}

// ---- Query keys ----

export const EVENTS_KEYS = {
  all: ['events'] as const,
  list: (params: EventsListParams) => ['events', 'list', params] as const,
  detail: (slug: string) => ['events', 'detail', slug] as const,
  participants: (slug: string) => ['events', 'participants', slug] as const,
  listings: (slug: string, params?: EventListingsParams) =>
    ['events', 'listings', slug, params ?? {}] as const,
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
  const { data } = await apiClient.get<PaginatedResponse<EventListing>>(
    `/events/${slug}/listings/`,
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
