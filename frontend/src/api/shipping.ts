import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { PaginatedResponse } from './games'

export interface Shipment {
  id: number
  status: 'PENDING' | 'SENT' | 'RECEIVED'
  shipping_info: string
  listing_code: string
  board_game_name: string
  board_game_thumbnail: string
  giver_username: string
  receiver_username: string
  my_role: 'sender' | 'receiver' | null
  sent_at: string | null
  received_at: string | null
}

export interface ShippingSummary {
  counts: Partial<Record<Shipment['status'], number>>
  traders: {
    username: string
    out_total: number
    out_sent: number
    in_total: number
    in_received: number
  }[]
}

const SHIPPING_KEYS = {
  list: (slug: string) => ['shipping', slug] as const,
}

async function fetchShipments(slug: string): Promise<Shipment[]> {
  const { data } = await apiClient.get<Shipment[]>(`/events/${slug}/shipping/`)
  return data
}

async function fetchShippingOverview(
  slug: string, page: number, status: string,
): Promise<PaginatedResponse<Shipment>> {
  const { data } = await apiClient.get<PaginatedResponse<Shipment>>(
    `/events/${slug}/shipping/overview/`,
    { params: { page, status: status || undefined } },
  )
  return data
}

async function fetchShippingSummary(slug: string): Promise<ShippingSummary> {
  const { data } = await apiClient.get<ShippingSummary>(
    `/events/${slug}/shipping/overview/summary/`,
  )
  return data
}

async function updateShipment(
  slug: string,
  id: number,
  body: { status: 'SENT' | 'RECEIVED'; shipping_info?: string }
): Promise<Shipment> {
  const { data } = await apiClient.patch<Shipment>(`/events/${slug}/shipping/${id}/`, body)
  return data
}

export function useShipments(slug: string | undefined) {
  return useQuery({
    queryKey: SHIPPING_KEYS.list(slug ?? ''),
    queryFn: () => fetchShipments(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function useShippingOverview(
  slug: string | undefined, page: number, status: string, enabled: boolean,
) {
  return useQuery({
    queryKey: ['shipping', 'overview', slug ?? '', page, status],
    queryFn: () => fetchShippingOverview(slug!, page, status),
    enabled: !!slug && enabled,
    staleTime: 30_000,
  })
}

export function useShippingSummary(slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['shipping', 'summary', slug ?? ''],
    queryFn: () => fetchShippingSummary(slug!),
    enabled: !!slug && enabled,
    staleTime: 30_000,
  })
}

export function useUpdateShipment(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number
      body: { status: 'SENT' | 'RECEIVED'; shipping_info?: string }
    }) => updateShipment(slug, id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SHIPPING_KEYS.list(slug) })
    },
  })
}
