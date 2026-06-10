import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'

export interface Shipment {
  id: number
  status: 'PENDING' | 'SENT' | 'RECEIVED'
  shipping_info: string
  listing_code: string
  board_game_name: string
  giver_username: string
  receiver_username: string
  my_role: 'sender' | 'receiver' | null
  sent_at: string | null
  received_at: string | null
}

const SHIPPING_KEYS = {
  list: (slug: string) => ['shipping', slug] as const,
}

async function fetchShipments(slug: string): Promise<Shipment[]> {
  const { data } = await apiClient.get<Shipment[]>(`/events/${slug}/shipping/`)
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
