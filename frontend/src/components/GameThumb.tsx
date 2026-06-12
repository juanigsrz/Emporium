interface GameThumbProps {
  src?: string | null
  alt?: string
  className?: string
}

/** Game cover thumbnail with a neutral placeholder when no src is available. */
export function GameThumb({ src, alt = '', className = 'h-10 w-10' }: GameThumbProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={`${className} shrink-0 rounded object-cover border border-gray-100 bg-gray-50`}
      />
    )
  }
  return (
    <div
      className={`${className} shrink-0 rounded border border-gray-100 bg-gray-50 flex items-center justify-center text-gray-300`}
      aria-hidden="true"
    >
      <svg className="h-1/2 w-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v14H4zM4 15l4-4 3 3 5-5 4 4" />
      </svg>
    </div>
  )
}
