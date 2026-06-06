import { useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useGamesList } from '../../api/games'
import GameCard, { GameCardSkeleton } from '../../components/GameCard'

// ---- Constants ----

const PAGE_SIZE = 24

const ORDERING_OPTIONS = [
  { value: 'rank', label: 'Rank' },
  { value: '-users_rated', label: 'Most rated' },
  { value: 'name', label: 'Name A–Z' },
  { value: '-name', label: 'Name Z–A' },
]

// ---- Debounce hook ----

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

// ---- Pagination component ----

interface PaginationProps {
  page: number
  total: number
  pageSize: number
  onChange: (p: number) => void
}

function Pagination({ page, total, pageSize, onChange }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  // Build page window: show 5 pages around current
  const delta = 2
  const pages: (number | 'ellipsis')[] = []
  const left = Math.max(2, page - delta)
  const right = Math.min(totalPages - 1, page + delta)

  pages.push(1)
  if (left > 2) pages.push('ellipsis')
  for (let i = left; i <= right; i++) pages.push(i)
  if (right < totalPages - 1) pages.push('ellipsis')
  if (totalPages > 1) pages.push(totalPages)

  return (
    <nav className="flex items-center justify-center gap-1 mt-8 flex-wrap" aria-label="Pagination">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className="px-2.5 py-1.5 text-sm rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous page"
      >
        ‹ Prev
      </button>

      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span key={`ell-${i}`} className="px-2 py-1.5 text-sm text-gray-400">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={`min-w-[2rem] px-2.5 py-1.5 text-sm rounded border transition-colors ${
              p === page
                ? 'bg-indigo-600 border-indigo-600 text-white font-semibold'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {p}
          </button>
        )
      )}

      <button
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        className="px-2.5 py-1.5 text-sm rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label="Next page"
      >
        Next ›
      </button>
    </nav>
  )
}

// ---- Main page ----

export default function GamesPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Controlled filter state — synced to URL params
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '')
  const debouncedSearch = useDebounce(searchInput, 300)

  const isExpansion = searchParams.get('is_expansion')
  const ordering = searchParams.get('ordering') ?? 'rank'
  const page = parseInt(searchParams.get('page') ?? '1', 10)

  // Track whether a param change should reset page to 1
  const prevFilters = useRef({ search: debouncedSearch, is_expansion: isExpansion, ordering })

  // Sync debounced search to URL; reset page on filter change
  useEffect(() => {
    const prev = prevFilters.current
    const filtersChanged =
      prev.search !== debouncedSearch ||
      prev.is_expansion !== isExpansion ||
      prev.ordering !== ordering

    prevFilters.current = { search: debouncedSearch, is_expansion: isExpansion, ordering }

    setSearchParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (debouncedSearch) {
          next.set('search', debouncedSearch)
        } else {
          next.delete('search')
        }
        if (filtersChanged) next.delete('page')
        return next
      },
      { replace: true }
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, isExpansion, ordering])

  function setOrdering(value: string) {
    setSearchParams((p) => {
      const next = new URLSearchParams(p)
      next.set('ordering', value)
      next.delete('page')
      return next
    })
  }

  function toggleExpansion() {
    setSearchParams((p) => {
      const next = new URLSearchParams(p)
      if (isExpansion === 'true') {
        next.delete('is_expansion')
      } else {
        next.set('is_expansion', 'true')
      }
      next.delete('page')
      return next
    })
  }

  function changePage(p: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (p === 1) {
        next.delete('page')
      } else {
        next.set('page', String(p))
      }
      return next
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const queryParams = {
    search: debouncedSearch || undefined,
    is_expansion: isExpansion === 'true' ? true : undefined,
    ordering,
    page,
  }

  const { data, isLoading, isError, isFetching } = useGamesList(queryParams)

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setSearchInput(e.target.value),
    []
  )

  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Browse Games</h1>
        {data && (
          <p className="mt-0.5 text-sm text-gray-500">
            {data.count.toLocaleString()} game{data.count !== 1 ? 's' : ''}
            {debouncedSearch ? ` matching "${debouncedSearch}"` : ''}
          </p>
        )}
      </div>

      {/* Filter bar */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
          </span>
          <input
            type="search"
            placeholder="Search games…"
            value={searchInput}
            onChange={handleSearchChange}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {isFetching && !isLoading && (
            <span className="absolute inset-y-0 right-3 flex items-center">
              <svg className="w-3.5 h-3.5 text-indigo-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </span>
          )}
        </div>

        {/* Ordering */}
        <select
          value={ordering}
          onChange={(e) => setOrdering(e.target.value)}
          className="py-2 pl-3 pr-8 text-sm border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          aria-label="Sort order"
        >
          {ORDERING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {/* Expansions toggle */}
        <button
          onClick={toggleExpansion}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
            isExpansion === 'true'
              ? 'bg-violet-600 border-violet-600 text-white'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
          aria-pressed={isExpansion === 'true'}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
          </svg>
          Expansions
        </button>
      </div>

      {/* Content */}
      {isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-red-700">Could not load games.</p>
          <p className="mt-1 text-xs text-red-500">Check your connection or try again later.</p>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 20 }).map((_, i) => (
            <GameCardSkeleton key={i} />
          ))}
        </div>
      ) : data && data.results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-base font-medium text-gray-600">No games found</p>
          <p className="text-sm text-gray-400 mt-1">
            {debouncedSearch
              ? `No results for "${debouncedSearch}". Try a different search.`
              : 'No games match the current filters.'}
          </p>
        </div>
      ) : (
        <>
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 transition-opacity ${
              isFetching ? 'opacity-60' : 'opacity-100'
            }`}
          >
            {data!.results.map((game) => (
              <GameCard key={game.bgg_id} game={game} />
            ))}
          </div>

          {/* Pagination */}
          <Pagination
            page={page}
            total={data!.count}
            pageSize={PAGE_SIZE}
            onChange={changePage}
          />

          {/* Page summary */}
          {totalPages > 1 && (
            <p className="mt-3 text-center text-xs text-gray-400">
              Page {page} of {totalPages}
            </p>
          )}
        </>
      )}
    </div>
  )
}
