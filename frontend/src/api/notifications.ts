import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { PaginatedResponse } from './games'

export interface Notification {
  id: number
  kind: string
  message: string
  read: boolean
  event: number | null
  event_slug: string | null
  created: string
}

export const NOTIFICATION_KEYS = {
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
}

async function fetchNotifications(): Promise<PaginatedResponse<Notification>> {
  const { data } = await apiClient.get<PaginatedResponse<Notification>>('/notifications/')
  return data
}

async function fetchUnreadCount(): Promise<number> {
  const { data } = await apiClient.get<PaginatedResponse<Notification>>('/notifications/', {
    params: { unread: 1 },
  })
  return data.count
}

const POLL_MS = 45_000

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: NOTIFICATION_KEYS.list,
    queryFn: fetchNotifications,
    enabled,
    refetchInterval: POLL_MS,
  })
}

export function useUnreadCount(enabled: boolean) {
  return useQuery({
    queryKey: NOTIFICATION_KEYS.unread,
    queryFn: fetchUnreadCount,
    enabled,
    refetchInterval: POLL_MS,
  })
}

function useInvalidateNotifications() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.list })
    qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.unread })
  }
}

export function useMarkRead() {
  const invalidate = useInvalidateNotifications()
  return useMutation({
    mutationFn: (id: number) => apiClient.post(`/notifications/${id}/read/`),
    onSuccess: invalidate,
  })
}

export function useMarkAllRead() {
  const invalidate = useInvalidateNotifications()
  return useMutation({
    mutationFn: () => apiClient.post('/notifications/read-all/'),
    onSuccess: invalidate,
  })
}
