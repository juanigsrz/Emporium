import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'

export interface GameRating { id: number; board_game: number; board_game_name: string; value: string }

export async function fetchMyRatings(): Promise<GameRating[]> {
  const { data } = await apiClient.get('/game-ratings/')
  return Array.isArray(data) ? data : data.results
}

export function useMyRatings() {
  return useQuery({ queryKey: ['ratings', 'mine'], queryFn: fetchMyRatings, staleTime: 60_000 })
}

/** Map bgg_id -> numeric rating for O(1) lookup. */
export function ratingMap(ratings: GameRating[] = []) {
  return new Map(ratings.map((r) => [r.board_game, Number(r.value)]))
}

export function useSetRating() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { board_game: number; value: number }) =>
      (await apiClient.post('/game-ratings/', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ratings', 'mine'] }),
  })
}
