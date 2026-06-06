import { Link } from 'react-router-dom'
import type { GameListItem } from '../api/games'

// ---- Helpers ----

function RatingBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-gray-400">—</span>

  const color =
    value >= 8
      ? 'bg-amber-100 text-amber-800 border-amber-300'
      : value >= 7
      ? 'bg-lime-100 text-lime-800 border-lime-300'
      : value >= 6
      ? 'bg-sky-100 text-sky-800 border-sky-300'
      : 'bg-gray-100 text-gray-600 border-gray-300'

  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-semibold tabular-nums ${color}`}
    >
      {value.toFixed(1)}
    </span>
  )
}

function GameImagePlaceholder({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-50 to-slate-100">
      <span className="text-2xl font-bold text-indigo-200 select-none tracking-tight">
        {initials || '?'}
      </span>
    </div>
  )
}

// ---- Main card ----

interface GameCardProps {
  game: GameListItem
}

export default function GameCard({ game }: GameCardProps) {
  return (
    <Link
      to={`/games/${game.bgg_id}`}
      className="group flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm hover:shadow-md hover:border-indigo-300 transition-all duration-200"
    >
      {/* Image area */}
      <div className="relative h-36 bg-gray-50 overflow-hidden shrink-0">
        {game.image_url ? (
          <img
            src={game.image_url}
            alt={game.name}
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
            loading="lazy"
            onError={(e) => {
              // Fall back to placeholder on broken image
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
              const parent = (e.currentTarget as HTMLImageElement).parentElement
              if (parent) {
                const ph = parent.querySelector('.img-placeholder')
                if (ph) (ph as HTMLElement).style.display = 'flex'
              }
            }}
          />
        ) : null}
        <div
          className="img-placeholder w-full h-full absolute inset-0"
          style={{ display: game.image_url ? 'none' : 'flex' }}
        >
          <GameImagePlaceholder name={game.name} />
        </div>

        {/* Expansion badge */}
        {game.is_expansion && (
          <span className="absolute top-1.5 left-1.5 bg-violet-600 text-white text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded">
            Exp
          </span>
        )}

        {/* Copies badge */}
        {game.copies_count > 0 && (
          <span className="absolute top-1.5 right-1.5 bg-emerald-600 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
            {game.copies_count} {game.copies_count === 1 ? 'copy' : 'copies'}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col flex-1 p-3 gap-1.5 min-w-0">
        {/* Name */}
        <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 group-hover:text-indigo-700 transition-colors">
          {game.name}
        </h3>

        {/* Year + Rank row */}
        <div className="flex items-center justify-between gap-1 mt-auto pt-1">
          <span className="text-xs text-gray-400">
            {game.year_published ?? '—'}
          </span>
          <div className="flex items-center gap-1.5">
            {game.rank != null && (
              <span className="text-xs text-gray-500">#{game.rank}</span>
            )}
            <RatingBadge value={game.average} />
          </div>
        </div>
      </div>
    </Link>
  )
}

// ---- Skeleton card ----

export function GameCardSkeleton() {
  return (
    <div className="flex flex-col bg-white border border-gray-100 rounded-lg overflow-hidden shadow-sm">
      <div className="h-36 bg-gray-100 animate-pulse" />
      <div className="p-3 space-y-2">
        <div className="h-3.5 bg-gray-100 rounded animate-pulse w-4/5" />
        <div className="h-3 bg-gray-100 rounded animate-pulse w-3/5" />
        <div className="flex justify-between mt-2">
          <div className="h-3 bg-gray-100 rounded animate-pulse w-10" />
          <div className="h-4 bg-gray-100 rounded animate-pulse w-10" />
        </div>
      </div>
    </div>
  )
}
