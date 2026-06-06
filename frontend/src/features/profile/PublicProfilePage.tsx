import { useQuery } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { fetchPublicProfile } from '../../api/profiles'

export default function PublicProfilePage() {
  const { username } = useParams<{ username: string }>()

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['profile', username],
    queryFn: () => fetchPublicProfile(username!),
    enabled: Boolean(username),
  })

  if (isLoading) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <p className="text-gray-500 text-sm">Loading profile…</p>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <p className="text-red-600 text-sm">
          {error ? 'User not found or an error occurred.' : 'Profile unavailable.'}
        </p>
        <Link to="/" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          ← Back to home
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      {/* Avatar + header */}
      <div className="flex items-center gap-4 mb-6">
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt={`${profile.username} avatar`}
            className="w-16 h-16 rounded-full object-cover border border-gray-200"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center text-2xl font-bold text-indigo-600 border border-indigo-200">
            {profile.username.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {profile.display_name || profile.username}
          </h1>
          <p className="text-sm text-gray-500">@{profile.username}</p>
        </div>
      </div>

      {/* Details */}
      <dl className="space-y-3">
        {profile.bgg_username && (
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">BGG Username</dt>
            <dd className="mt-0.5 text-sm text-gray-800">{profile.bgg_username}</dd>
          </div>
        )}
        {profile.bio && (
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Bio</dt>
            <dd className="mt-0.5 text-sm text-gray-800 whitespace-pre-line">{profile.bio}</dd>
          </div>
        )}
        {profile.location && (
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Location</dt>
            <dd className="mt-0.5 text-sm text-gray-800">{profile.location}</dd>
          </div>
        )}
        {profile.region && (
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Region</dt>
            <dd className="mt-0.5 text-sm text-gray-800">{profile.region}</dd>
          </div>
        )}
      </dl>

      {/* Ratings summary */}
      {(profile.ratings_count !== undefined && profile.ratings_count !== null) && (
        <div className="mt-6 p-4 rounded-lg bg-indigo-50 border border-indigo-100">
          <h2 className="text-sm font-semibold text-indigo-800 mb-2">Trade Ratings</h2>
          <div className="flex gap-6">
            <div>
              <p className="text-2xl font-bold text-indigo-700">{profile.ratings_count}</p>
              <p className="text-xs text-indigo-600">Total ratings</p>
            </div>
            {profile.average_score !== null && profile.average_score !== undefined && (
              <div>
                <p className="text-2xl font-bold text-indigo-700">
                  {profile.average_score.toFixed(1)}
                </p>
                <p className="text-xs text-indigo-600">Average</p>
              </div>
            )}
          </div>
        </div>
      )}

      <Link to="/" className="mt-6 inline-block text-sm text-indigo-600 hover:underline">
        ← Back
      </Link>
    </div>
  )
}
