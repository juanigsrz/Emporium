import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../api/client'

interface HealthResponse {
  status: string
}

async function fetchHealth(): Promise<HealthResponse> {
  const { data } = await apiClient.get<HealthResponse>('/health/')
  return data
}

export default function HomePage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    retry: 1,
  })

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:py-20">
      {/* Hero */}
      <header className="relative">
        <p className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-600">
          <span className="h-px w-8 bg-indigo-300" />
          The trade almanac
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold text-gray-900 sm:text-6xl">
          Trade board games the way the&nbsp;math&nbsp;intends.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-600">
          List the games you own, build a want list, and let the solver weave the
          longest, fairest chains of trades — cardboard for cardboard, no haggling.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <a
            href="/events"
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-colors hover:bg-indigo-700"
          >
            Browse events
          </a>
          {/* Status — slim inline strip (live backend health) */}
          <span className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium shadow-sm">
            {isLoading && (
              <>
                <span className="h-2 w-2 animate-pulse rounded-full bg-gray-300" />
                <span className="text-gray-500">Checking backend…</span>
              </>
            )}
            {isError && (
              <>
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <span className="text-red-600">
                  Backend unreachable — {error instanceof Error ? error.message : 'unknown error'}
                </span>
              </>
            )}
            {data && (
              <>
                <span
                  className={`h-2 w-2 rounded-full ${
                    data.status === 'ok' ? 'bg-green-500' : 'bg-yellow-500'
                  }`}
                />
                <span className={data.status === 'ok' ? 'text-green-700' : 'text-yellow-700'}>
                  Backend: {data.status}
                </span>
              </>
            )}
          </span>
        </div>
      </header>

      {/* Feature cards */}
      <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FeatureCard
          index="01"
          title="Trade Events"
          description="Join an event, list your copies, and build your want list."
          href="/events"
        />
        <FeatureCard
          index="02"
          title="My Copies"
          description="Add the board games you own, ready to list in trade events."
          href="/my-copies"
        />
      </div>
    </div>
  )
}

function FeatureCard({
  index,
  title,
  description,
  href,
}: {
  index: string
  title: string
  description: string
  href: string
}) {
  return (
    <a
      href={href}
      className="group relative block overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
    >
      <span className="pointer-events-none absolute right-4 top-3 font-display text-3xl font-semibold text-gray-200 transition-colors group-hover:text-indigo-200">
        {index}
      </span>
      <h3 className="mb-1 font-display text-lg font-semibold text-gray-900 transition-colors group-hover:text-indigo-700">
        {title}
      </h3>
      <p className="max-w-xs text-sm leading-relaxed text-gray-500">{description}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600">
        Open
        <svg className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </a>
  )
}
