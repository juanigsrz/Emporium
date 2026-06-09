import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from './client'

export type ImportKind = 'WISHLIST' | 'RATINGS' | 'OWNED' | 'GEEKLIST'

export interface ImportJob {
  id: number
  kind: ImportKind
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'
  summary: Record<string, number>
  result: Record<string, unknown>
  log: string
}

export async function startImport(body: {
  kind: ImportKind
  source_ref?: string
  options?: Record<string, unknown>
}) {
  const { data } = await apiClient.post<ImportJob>('/bgg/imports/', body)
  return data
}

export function useStartImport() {
  return useMutation({ mutationFn: startImport })
}

export function useImportJob(id: number | null) {
  return useQuery({
    queryKey: ['bgg', 'import', id],
    queryFn: async () => (await apiClient.get<ImportJob>(`/bgg/imports/${id}/`)).data,
    enabled: id != null,
    refetchInterval: (query) =>
      ['PENDING', 'RUNNING'].includes(query.state.data?.status ?? '') ? 2000 : false,
  })
}
