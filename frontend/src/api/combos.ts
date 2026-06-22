import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { PaginatedResponse } from './games'

// ---- Types ----

export interface ComboItemRead {
  id: number
  event_listing: number
  listing_code: string
  board_game_id: number
  board_game_name: string
  board_game_thumbnail: string
}

export interface Combo {
  id: number
  owner: number
  owner_username: string
  name: string
  combo_code: string
  active: boolean
  sell_price: string | null
  items: ComboItemRead[]
  created: string
  updated: string
}

export interface ComboPayload {
  name: string
  sell_price?: string | null
  item_listing_ids: number[]
}

export interface CombosParams {
  board_game?: number | string
  mine?: boolean
  page?: number
  page_size?: number
}

// ---- Query keys ----

export const COMBOS_KEYS = {
  all: ['combos'] as const,
  list: (slug: string, params?: CombosParams) =>
    ['combos', 'list', slug, params ?? {}] as const,
}

// ---- API functions ----

export async function fetchCombos(
  slug: string,
  params: CombosParams = {}
): Promise<PaginatedResponse<Combo>> {
  const p: Record<string, string> = {}
  if (params.board_game != null) p.board_game = String(params.board_game)
  if (params.mine) p.mine = '1'
  if (params.page && params.page > 1) p.page = String(params.page)
  if (params.page_size) p.page_size = String(params.page_size)
  const { data } = await apiClient.get<PaginatedResponse<Combo>>(
    `/events/${slug}/combos/`,
    { params: p }
  )
  return data
}

export async function createCombo(slug: string, payload: ComboPayload): Promise<Combo> {
  const { data } = await apiClient.post<Combo>(`/events/${slug}/combos/`, payload)
  return data
}

export async function patchCombo(
  slug: string,
  id: number,
  payload: Partial<ComboPayload>
): Promise<Combo> {
  const { data } = await apiClient.patch<Combo>(`/events/${slug}/combos/${id}/`, payload)
  return data
}

export async function deleteCombo(slug: string, id: number): Promise<void> {
  await apiClient.delete(`/events/${slug}/combos/${id}/`)
}

// ---- Hooks ----

export function useCombos(slug: string | undefined, params: CombosParams = {}) {
  return useQuery({
    queryKey: COMBOS_KEYS.list(slug ?? '', params),
    queryFn: () => fetchCombos(slug!, params),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function useCreateCombo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, payload }: { slug: string; payload: ComboPayload }) =>
      createCombo(slug, payload),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: ['combos', 'list', slug] })
    },
  })
}

export function usePatchCombo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, id, payload }: { slug: string; id: number; payload: Partial<ComboPayload> }) =>
      patchCombo(slug, id, payload),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: ['combos', 'list', slug] })
    },
  })
}

export function useDeleteCombo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, id }: { slug: string; id: number }) => deleteCombo(slug, id),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: ['combos', 'list', slug] })
    },
  })
}
