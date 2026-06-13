import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { EventListing } from './events'

export interface AdminGroup { id: number; name: string; max_give?: number; min_receive?: number }
export interface AdminWish {
  id: number
  active: boolean
  offer_group: number
  offer_group_name: string
  want_group: number
  want_group_name: string
}
export interface AdminSubmissions {
  username: string
  listings: EventListing[]
  offer_groups: AdminGroup[]
  want_groups: AdminGroup[]
  wishes: AdminWish[]
}
export interface KickSummary {
  username: string
  removed_listings: number
  removed_wishes: number
  removed_groups: number
  affected_other_users: number
}

const base = (slug: string) => `/events/${slug}/admin`

export function useAdminSubmissions(slug: string, username: string | null) {
  return useQuery({
    queryKey: ['admin', 'submissions', slug, username],
    queryFn: async () =>
      (await apiClient.get<AdminSubmissions>(`${base(slug)}/submissions/`, {
        params: { user: username },
      })).data,
    enabled: !!slug && !!username,
  })
}

function useInvalidateSubmissions(slug: string) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['admin', 'submissions', slug] })
}

export function useToggleWish(slug: string) {
  const invalidate = useInvalidateSubmissions(slug)
  return useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) =>
      (await apiClient.patch(`${base(slug)}/wishes/${id}/`, { active })).data,
    onSuccess: invalidate,
  })
}

export function useEditOfferBound(slug: string) {
  const invalidate = useInvalidateSubmissions(slug)
  return useMutation({
    mutationFn: async ({ id, max_give }: { id: number; max_give: number }) =>
      (await apiClient.patch(`${base(slug)}/offer-groups/${id}/`, { max_give })).data,
    onSuccess: invalidate,
  })
}

export function useEditWantBound(slug: string) {
  const invalidate = useInvalidateSubmissions(slug)
  return useMutation({
    mutationFn: async ({ id, min_receive }: { id: number; min_receive: number }) =>
      (await apiClient.patch(`${base(slug)}/want-groups/${id}/`, { min_receive })).data,
    onSuccess: invalidate,
  })
}

export function useUnlistCopy(slug: string) {
  const invalidate = useInvalidateSubmissions(slug)
  return useMutation({
    mutationFn: async (listingId: number) => {
      await apiClient.delete(`${base(slug)}/listings/${listingId}/`)
    },
    onSuccess: invalidate,
  })
}

export function useKickUser(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (username: string) =>
      (await apiClient.post<KickSummary>(`${base(slug)}/kick/`, { username })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'submissions', slug] }),
  })
}
