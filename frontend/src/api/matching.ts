import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { PaginatedResponse } from './games'

// ---- Types (shapes verified from API_CONTRACT.md + running backend) ----

export type MatchRunStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'

export interface MatchRunSummary {
  matched_wishes: number
  cycles: number
  unmatched: number
}

/** Shape returned by GET /api/events/{slug}/matches/ (list) */
export interface MatchRunListItem {
  id: number
  event: number
  status: MatchRunStatus
  algorithm: string
  started_at: string | null
  finished_at: string | null
  summary: MatchRunSummary | null
  created: string
  updated: string
}

/** Shape returned by GET /api/events/{slug}/matches/{id}/ (detail) */
export interface MatchRunDetail extends MatchRunListItem {
  log: string
}

// ---- Result JSON schema (from DATA_MODEL.md §Result JSON schema) ----

export interface CycleStep {
  listing_code: string
  board_game: string
  from_user: string
  to_user: string
  wish_id: number
  cash_amount: string | null
}

export interface Cycle {
  id: number
  length: number
  steps: CycleStep[]
}

export interface UnmatchedWish {
  wish_id: number
  reason: string
}

export interface MatchStats {
  users: number
  listings: number
  matched: number
  cycles: number
}

export interface SettlementTransfer {
  from_user: string
  to_user: string
  amount: string
}

export interface MatchResult {
  algorithm: string
  generated_at: string
  cycles: Cycle[]
  unmatched: UnmatchedWish[]
  stats: MatchStats
  settlement?: SettlementTransfer[]
}

/** Shape returned by GET .../matches/{id}/mine/ (paginated) */
export interface TradeAssignment {
  id: number
  match_run: number
  cycle_id: number
  event_listing: number
  listing_code: string
  board_game_name: string
  board_game_thumbnail: string
  giver: number
  giver_username: string
  receiver: number
  receiver_username: string
  wish: number | null
  cash_amount: string | null
  item_value: string | null
  created: string
}

// ---- Query keys ----

export const MATCHING_KEYS = {
  runs: (slug: string) => ['matching', 'runs', slug] as const,
  run: (slug: string, id: number) => ['matching', 'run', slug, id] as const,
  result: (slug: string, id: number) => ['matching', 'result', slug, id] as const,
  mine: (slug: string, id: number) => ['matching', 'mine', slug, id] as const,
}

// ---- API functions ----

async function fetchMatchRuns(slug: string): Promise<PaginatedResponse<MatchRunListItem>> {
  const { data } = await apiClient.get<PaginatedResponse<MatchRunListItem>>(
    `/events/${slug}/matches/`
  )
  return data
}

async function fetchMatchRun(slug: string, id: number): Promise<MatchRunDetail> {
  const { data } = await apiClient.get<MatchRunDetail>(`/events/${slug}/matches/${id}/`)
  return data
}

async function triggerMatchRun(slug: string): Promise<MatchRunListItem> {
  const { data } = await apiClient.post<MatchRunListItem>(`/events/${slug}/matches/`)
  return data
}

async function fetchMatchResult(slug: string, id: number): Promise<MatchResult> {
  const { data } = await apiClient.get<MatchResult>(`/events/${slug}/matches/${id}/result/`)
  return data
}

async function fetchMyAssignments(slug: string, id: number): Promise<PaginatedResponse<TradeAssignment>> {
  const { data } = await apiClient.get<PaginatedResponse<TradeAssignment>>(
    `/events/${slug}/matches/${id}/mine/?page_size=100`
  )
  return data
}

/** GET the gurobi solver wants file (text) for the event. Organizer-only.
 *  `kpi` is the selected objectives in priority order; when it contains
 *  'distance' the backend appends user location lines. */
export async function fetchWantsExport(slug: string, kpi: string[] = []): Promise<string> {
  const { data } = await apiClient.get<string>(`/events/${slug}/wants-export/`, {
    responseType: 'text',
    params: kpi.length ? { kpi: kpi.join(',') } : undefined,
  })
  return data
}

export interface MatchUploadResponse {
  id: number
  status: MatchRunStatus
  summary: MatchRunSummary
}

/** POST raw solver stdout; backend parses it into a DONE run. Organizer-only. */
async function uploadSolution(slug: string, output: string): Promise<MatchUploadResponse> {
  const { data } = await apiClient.post<MatchUploadResponse>(
    `/events/${slug}/matches/upload/`,
    output,
    { headers: { 'Content-Type': 'text/plain' } }
  )
  return data
}

// ---- Hooks ----

const ACTIVE_STATUSES: MatchRunStatus[] = ['PENDING', 'RUNNING']

export function useMatchRuns(slug: string | undefined) {
  return useQuery({
    queryKey: MATCHING_KEYS.runs(slug ?? ''),
    queryFn: () => fetchMatchRuns(slug!),
    enabled: !!slug,
    staleTime: 15_000,
  })
}

export function useMatchRun(slug: string | undefined, id: number | undefined) {
  return useQuery({
    queryKey: MATCHING_KEYS.run(slug ?? '', id ?? 0),
    queryFn: () => fetchMatchRun(slug!, id!),
    enabled: !!slug && id != null,
    staleTime: 5_000,
    // Poll every 2s while status is PENDING or RUNNING; stops automatically when DONE/FAILED
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && ACTIVE_STATUSES.includes(status) ? 2_000 : false
    },
  })
}

export function useMatchResult(slug: string | undefined, id: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: MATCHING_KEYS.result(slug ?? '', id ?? 0),
    queryFn: () => fetchMatchResult(slug!, id!),
    enabled: !!slug && id != null && enabled,
    staleTime: 60_000,
  })
}

export function useMyAssignments(slug: string | undefined, id: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: MATCHING_KEYS.mine(slug ?? '', id ?? 0),
    queryFn: () => fetchMyAssignments(slug!, id!),
    enabled: !!slug && id != null && enabled,
    staleTime: 60_000,
  })
}

export function useTriggerMatchRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => triggerMatchRun(slug),
    onSuccess: (_data, slug) => {
      qc.invalidateQueries({ queryKey: MATCHING_KEYS.runs(slug) })
    },
  })
}

export function useUploadSolution() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, output }: { slug: string; output: string }) =>
      uploadSolution(slug, output),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: MATCHING_KEYS.runs(slug) })
    },
  })
}
