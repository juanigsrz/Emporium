import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { PaginatedResponse } from './games'

export interface SettlementPayment {
  id: number
  status: 'PENDING' | 'PAID' | 'CONFIRMED'
  amount: string
  note: string
  from_username: string
  to_username: string
  my_role: 'payer' | 'payee' | null
  paid_at: string | null
  confirmed_at: string | null
}

export interface PaymentsSummary {
  counts: Partial<Record<SettlementPayment['status'], number>>
  users: {
    username: string
    owe_total: number
    owe_paid: number
    due_total: number
    due_confirmed: number
  }[]
}

const PAYMENTS_KEYS = {
  list: (slug: string) => ['payments', slug] as const,
}

async function fetchMyPayments(slug: string): Promise<SettlementPayment[]> {
  const { data } = await apiClient.get<SettlementPayment[]>(`/events/${slug}/payments/`)
  return data
}

async function fetchPaymentsOverview(
  slug: string, page: number, status: string,
): Promise<PaginatedResponse<SettlementPayment>> {
  const { data } = await apiClient.get<PaginatedResponse<SettlementPayment>>(
    `/events/${slug}/payments/overview/`,
    { params: { page, status: status || undefined } },
  )
  return data
}

async function fetchPaymentsSummary(slug: string): Promise<PaymentsSummary> {
  const { data } = await apiClient.get<PaymentsSummary>(
    `/events/${slug}/payments/overview/summary/`,
  )
  return data
}

async function updatePayment(
  slug: string, id: number, body: { status: 'PAID' | 'CONFIRMED'; note?: string },
): Promise<SettlementPayment> {
  const { data } = await apiClient.patch<SettlementPayment>(
    `/events/${slug}/payments/${id}/`, body,
  )
  return data
}

export function useMyPayments(slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: PAYMENTS_KEYS.list(slug ?? ''),
    queryFn: () => fetchMyPayments(slug!),
    enabled: !!slug && enabled,
    staleTime: 30_000,
  })
}

export function usePaymentsOverview(
  slug: string | undefined, page: number, status: string, enabled: boolean,
) {
  return useQuery({
    queryKey: ['payments', 'overview', slug ?? '', page, status],
    queryFn: () => fetchPaymentsOverview(slug!, page, status),
    enabled: !!slug && enabled,
    staleTime: 30_000,
  })
}

export function usePaymentsSummary(slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['payments', 'summary', slug ?? ''],
    queryFn: () => fetchPaymentsSummary(slug!),
    enabled: !!slug && enabled,
    staleTime: 30_000,
  })
}

export function useUpdatePayment(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: { status: 'PAID' | 'CONFIRMED'; note?: string } }) =>
      updatePayment(slug, id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PAYMENTS_KEYS.list(slug) })
    },
  })
}
