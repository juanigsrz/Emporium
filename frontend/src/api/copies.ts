import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { PaginatedResponse } from './games'

// ---- Types ----

export type CopyCondition = 'NEW' | 'LIKE_NEW' | 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR'
export type CopySleeved = 'UNKNOWN' | 'NONE' | 'SLEEVED'
export type CopyStatus = 'ACTIVE' | 'RESERVED' | 'TRADED' | 'WITHDRAWN'

export interface Copy {
  id: number
  listing_code: string
  owner: number
  owner_username: string
  board_game: number
  board_game_name: string
  condition: CopyCondition
  language: string
  edition: string
  sleeved: CopySleeved
  includes_expansions: string
  missing_components: string
  upgraded_components: string
  component_notes: string
  owner_notes: string
  trade_value_hint: string
  shipping_constraints: string
  pickup_available: boolean
  photo_urls: string[]
  status: CopyStatus
  created: string
  updated: string
}

export interface CopyCreatePayload {
  board_game: number
  condition: CopyCondition
  language?: string
  edition?: string
  sleeved?: CopySleeved
  includes_expansions?: string
  missing_components?: string
  upgraded_components?: string
  component_notes?: string
  owner_notes?: string
  trade_value_hint?: string
  shipping_constraints?: string
  pickup_available?: boolean
  photo_urls?: string[]
}

export type CopyPatchPayload = Partial<CopyCreatePayload> & { status?: CopyStatus }

export interface CopiesListParams {
  owner?: string
  board_game?: number | string
  status?: CopyStatus
  mine?: boolean
  page?: number
}

// ---- Query keys ----

export const COPIES_KEYS = {
  all: ['copies'] as const,
  list: (params: CopiesListParams) => ['copies', 'list', params] as const,
  detail: (id: number | string) => ['copies', 'detail', String(id)] as const,
  mine: () => ['copies', 'list', { mine: true }] as const,
}

// ---- API functions ----

export async function fetchCopies(
  params: CopiesListParams = {}
): Promise<PaginatedResponse<Copy>> {
  const p: Record<string, string> = {}
  if (params.owner) p.owner = params.owner
  if (params.board_game != null) p.board_game = String(params.board_game)
  if (params.status) p.status = params.status
  if (params.mine) p.mine = 'true'
  if (params.page && params.page > 1) p.page = String(params.page)

  const { data } = await apiClient.get<PaginatedResponse<Copy>>('/copies/', { params: p })
  return data
}

export async function fetchCopy(id: number | string): Promise<Copy> {
  const { data } = await apiClient.get<Copy>(`/copies/${id}/`)
  return data
}

export async function createCopy(payload: CopyCreatePayload): Promise<Copy> {
  const { data } = await apiClient.post<Copy>('/copies/', payload)
  return data
}

export async function patchCopy(id: number | string, payload: CopyPatchPayload): Promise<Copy> {
  const { data } = await apiClient.patch<Copy>(`/copies/${id}/`, payload)
  return data
}

export async function deleteCopy(id: number | string): Promise<void> {
  await apiClient.delete(`/copies/${id}/`)
}

// ---- Hooks ----

export function useCopies(params: CopiesListParams = {}) {
  return useQuery({
    queryKey: COPIES_KEYS.list(params),
    queryFn: () => fetchCopies(params),
    staleTime: 30_000,
  })
}

export function useCopy(id: number | string | undefined) {
  return useQuery({
    queryKey: COPIES_KEYS.detail(id ?? ''),
    queryFn: () => fetchCopy(id!),
    enabled: id != null,
    staleTime: 30_000,
  })
}

export function useMyCopies() {
  return useQuery({
    queryKey: COPIES_KEYS.mine(),
    queryFn: () => fetchCopies({ mine: true }),
    staleTime: 30_000,
  })
}

export function useCreateCopy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createCopy,
    onSuccess: (created) => {
      // Invalidate game copies sub-route and game detail (copies_count)
      qc.invalidateQueries({ queryKey: ['games', 'copies', String(created.board_game)] })
      qc.invalidateQueries({ queryKey: ['games', 'detail', String(created.board_game)] })
      // Also invalidate mine list
      qc.invalidateQueries({ queryKey: COPIES_KEYS.mine() })
      qc.invalidateQueries({ queryKey: COPIES_KEYS.all })
    },
  })
}

export function usePatchCopy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number | string; payload: CopyPatchPayload }) =>
      patchCopy(id, payload),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: COPIES_KEYS.detail(updated.id) })
      qc.invalidateQueries({ queryKey: COPIES_KEYS.mine() })
      qc.invalidateQueries({ queryKey: ['games', 'copies', String(updated.board_game)] })
      qc.invalidateQueries({ queryKey: ['games', 'detail', String(updated.board_game)] })
    },
  })
}

export function useWithdrawCopy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number | string) => patchCopy(id, { status: 'WITHDRAWN' }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: COPIES_KEYS.mine() })
      qc.invalidateQueries({ queryKey: ['games', 'copies', String(updated.board_game)] })
      qc.invalidateQueries({ queryKey: ['games', 'detail', String(updated.board_game)] })
    },
  })
}
