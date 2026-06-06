import { apiClient } from './client'

export interface Profile {
  username: string
  display_name: string
  bgg_username: string
  bio: string
  location: string
  region: string
  avatar_url: string
  ratings_count?: number
  average_score?: number | null
}

export interface PatchProfilePayload {
  display_name?: string
  bgg_username?: string
  bio?: string
  location?: string
  region?: string
  avatar_url?: string
}

export async function fetchMyProfile(): Promise<Profile> {
  const { data } = await apiClient.get<Profile>('/profiles/me/')
  return data
}

export async function patchMyProfile(payload: PatchProfilePayload): Promise<Profile> {
  const { data } = await apiClient.patch<Profile>('/profiles/me/', payload)
  return data
}

export async function fetchPublicProfile(username: string): Promise<Profile> {
  const { data } = await apiClient.get<Profile>(`/profiles/${username}/`)
  return data
}

// Blocks
export interface UserBlock {
  id: number
  blocker: string
  blocked: string
  created: string
}

export interface CreateBlockPayload {
  blocked: string
}

export async function fetchBlocks(): Promise<UserBlock[]> {
  const { data } = await apiClient.get<UserBlock[] | { results: UserBlock[] }>('/blocks/')
  // Handle both paginated and plain list responses
  if (Array.isArray(data)) return data
  return data.results
}

export async function createBlock(payload: CreateBlockPayload): Promise<UserBlock> {
  const { data } = await apiClient.post<UserBlock>('/blocks/', payload)
  return data
}

export async function deleteBlock(id: number): Promise<void> {
  await apiClient.delete(`/blocks/${id}/`)
}

// Wishlists
export interface WishlistEntry {
  id: number
  board_game_bgg_id: number
  note: string
  created_at?: string
}

export interface CreateWishlistPayload {
  board_game_bgg_id: number
  note?: string
}

export async function fetchWishlists(): Promise<WishlistEntry[]> {
  const { data } = await apiClient.get<WishlistEntry[] | { results: WishlistEntry[] }>('/wishlists/')
  if (Array.isArray(data)) return data
  return data.results
}

export async function createWishlistEntry(payload: CreateWishlistPayload): Promise<WishlistEntry> {
  const { data } = await apiClient.post<WishlistEntry>('/wishlists/', payload)
  return data
}

export async function deleteWishlistEntry(id: number): Promise<void> {
  await apiClient.delete(`/wishlists/${id}/`)
}
