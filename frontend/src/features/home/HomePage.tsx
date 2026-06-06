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
    <div className="max-w-3xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome to MathTrade</h1>
      <p className="text-gray-500 mb-8 text-lg">
        A modern board-game math-trade platform. List your games, build want lists,
        and let the algorithm find the best trade cycles.
      </p>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          System Status
        </h2>

        {isLoading && (
          <div className="flex items-center gap-2 text-gray-500">
            <span className="inline-block w-3 h-3 rounded-full bg-gray-300 animate-pulse" />
            <span className="text-sm">Checking backend…</span>
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full bg-red-500" />
            <span className="text-sm font-medium text-red-600">
              Backend unreachable —{' '}
              {error instanceof Error ? error.message : 'unknown error'}
            </span>
          </div>
        )}

        {data && (
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-3 h-3 rounded-full ${
                data.status === 'ok' ? 'bg-green-500' : 'bg-yellow-500'
              }`}
            />
            <span
              className={`text-sm font-medium ${
                data.status === 'ok' ? 'text-green-700' : 'text-yellow-700'
              }`}
            >
              Backend: {data.status}
            </span>
          </div>
        )}
      </div>

      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FeatureCard
          title="Trade Events"
          description="Join an event, list your copies, and build your want list."
          href="/events"
        />
        <FeatureCard
          title="My Copies"
          description="Add the board games you own, ready to list in trade events."
          href="/my-copies"
        />
      </div>
    </div>
  )
}

function FeatureCard({
  title,
  description,
  href,
}: {
  title: string
  description: string
  href: string
}) {
  return (
    <a
      href={href}
      className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all group"
    >
      <h3 className="font-semibold text-gray-900 group-hover:text-indigo-700 transition-colors mb-1">
        {title}
      </h3>
      <p className="text-sm text-gray-500">{description}</p>
    </a>
  )
}
