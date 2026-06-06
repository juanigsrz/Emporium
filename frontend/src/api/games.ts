import { useQuery } from '@tanstack/react-query'
import { apiClient } from './client'
import type { Copy } from './copies'
export type { Copy }

// ---- Types ----

export interface GameListItem {
  bgg_id: number
  name: string
  year_published: number | null
  rank: number | null
  bayes_average: number | null
  average: number | null
  users_rated: number | null
  is_expansion: boolean
  image_url: string
  copies_count: number
}

/**
 * GameDetail — fields actually returned by GET /api/games/{bgg_id}/
 * BUG-F2-01 fix: removed description, play_time, weight, min_age (not returned by backend).
 * Added bayes_average, min_playtime, max_playtime, metadata, created, updated,
 * and category_ranks which are returned. designers/publishers/mechanics/categories
 * come from metadata and may be null/empty.
 */
export interface GameDetail extends GameListItem {
  min_players: number | null
  max_players: number | null
  min_playtime: number | null
  max_playtime: number | null
  designers: string[] | null
  publishers: string[] | null
  mechanics: string[] | null
  categories: string[] | null
  category_ranks: Record<string, number | null>
  metadata: Record<string, unknown>
  created: string
  updated: string
}

export interface PaginatedResponse<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

// ---- Query params ----

export interface GamesListParams {
  search?: string
  is_expansion?: boolean
  ordering?: string
  page?: number
}

export interface CopiesParams {
  condition?: string
  language?: string
}

// ---- API fetch functions ----

export async function fetchGamesList(
  params: GamesListParams
): Promise<PaginatedResponse<GameListItem>> {
  const searchParams: Record<string, string> = {}
  if (params.search) searchParams.search = params.search
  if (params.is_expansion !== undefined)
    searchParams.is_expansion = String(params.is_expansion)
  if (params.ordering) searchParams.ordering = params.ordering
  if (params.page && params.page > 1) searchParams.page = String(params.page)

  const { data } = await apiClient.get<PaginatedResponse<GameListItem>>('/games/', {
    params: searchParams,
  })
  return data
}

export async function fetchGameDetail(bggId: number | string): Promise<GameDetail> {
  const { data } = await apiClient.get<GameDetail>(`/games/${bggId}/`)
  return data
}

export async function fetchGameCopies(
  bggId: number | string,
  params: CopiesParams = {}
): Promise<PaginatedResponse<Copy>> {
  const searchParams: Record<string, string> = {}
  if (params.condition) searchParams.condition = params.condition
  if (params.language) searchParams.language = params.language

  const { data } = await apiClient.get<PaginatedResponse<Copy>>(
    `/games/${bggId}/copies/`,
    { params: searchParams }
  )
  return data
}

// ---- TanStack Query hooks ----

export const GAMES_KEYS = {
  all: ['games'] as const,
  list: (params: GamesListParams) => ['games', 'list', params] as const,
  detail: (bggId: number | string) => ['games', 'detail', String(bggId)] as const,
  copies: (bggId: number | string, params: CopiesParams) =>
    ['games', 'copies', String(bggId), params] as const,
}

export function useGamesList(params: GamesListParams) {
  return useQuery({
    queryKey: GAMES_KEYS.list(params),
    queryFn: () => fetchGamesList(params),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

export function useGameDetail(bggId: number | string | undefined) {
  return useQuery({
    queryKey: GAMES_KEYS.detail(bggId ?? ''),
    queryFn: () => fetchGameDetail(bggId!),
    enabled: bggId != null,
    staleTime: 60_000,
  })
}

export function useGameCopies(
  bggId: number | string | undefined,
  params: CopiesParams = {}
) {
  return useQuery({
    queryKey: GAMES_KEYS.copies(bggId ?? '', params),
    queryFn: () => fetchGameCopies(bggId!, params),
    enabled: bggId != null,
    staleTime: 30_000,
  })
}
