import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { PaginatedResponse } from './games'

export type CapKind = 'TAKE' | 'GIVE'

export interface CapItem {
  id: number
  event_listing: number | null
  listing_code: string | null
  board_game_name: string | null
  combo: number | null
  combo_code: string | null
  combo_name: string | null
}

export interface Cap {
  id: number
  kind: CapKind
  n: number
  items: CapItem[]
  created: string
}

export interface CapPayload {
  kind: CapKind
  n: number
  item_listing_ids: number[]
  item_combo_ids: number[]
}

export const CAPS_KEYS = {
  all: ['caps'] as const,
  list: (slug: string) => ['caps', 'list', slug] as const,
}

export async function fetchCaps(slug: string): Promise<PaginatedResponse<Cap>> {
  const { data } = await apiClient.get<PaginatedResponse<Cap>>(`/events/${slug}/caps/`)
  return data
}

export async function createCap(slug: string, payload: CapPayload): Promise<Cap> {
  const { data } = await apiClient.post<Cap>(`/events/${slug}/caps/`, payload)
  return data
}

export async function patchCap(slug: string, id: number, payload: Partial<CapPayload>): Promise<Cap> {
  const { data } = await apiClient.patch<Cap>(`/events/${slug}/caps/${id}/`, payload)
  return data
}

export async function deleteCap(slug: string, id: number): Promise<void> {
  await apiClient.delete(`/events/${slug}/caps/${id}/`)
}

export function useCaps(slug: string | undefined) {
  return useQuery({
    queryKey: CAPS_KEYS.list(slug ?? ''),
    queryFn: () => fetchCaps(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function useCreateCap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, payload }: { slug: string; payload: CapPayload }) => createCap(slug, payload),
    onSuccess: (_d, { slug }) => qc.invalidateQueries({ queryKey: CAPS_KEYS.list(slug) }),
  })
}

export function usePatchCap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, id, payload }: { slug: string; id: number; payload: Partial<CapPayload> }) =>
      patchCap(slug, id, payload),
    onSuccess: (_d, { slug }) => qc.invalidateQueries({ queryKey: CAPS_KEYS.list(slug) }),
  })
}

export function useDeleteCap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, id }: { slug: string; id: number }) => deleteCap(slug, id),
    onSuccess: (_d, { slug }) => qc.invalidateQueries({ queryKey: CAPS_KEYS.list(slug) }),
  })
}
