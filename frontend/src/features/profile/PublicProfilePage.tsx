import { useQuery } from '@tanstack/react-query'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { fetchPublicProfile } from '../../api/profiles'

export default function PublicProfilePage() {
  const { username } = useParams<{ username: string }>()
  const navigate = useNavigate()

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['profile', username],
    queryFn: () => fetchPublicProfile(username!),
    enabled: Boolean(username),
  })

  if (isLoading) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <p className="text-moss text-sm">Loading profile…</p>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <p className="text-red-600 text-sm">
          {error ? 'User not found or an error occurred.' : 'Profile unavailable.'}
        </p>
        <Link to="/" className="mt-4 inline-block text-sm font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2">
          ← Back to home
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      {/* Avatar + header */}
      <div className="flex items-center gap-4 mb-6 rounded-3xl border-2 border-ink bg-cream p-5 shadow-card">
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt={`${profile.username} avatar`}
            className="w-16 h-16 rounded-2xl object-cover border-2 border-ink"
          />
        ) : (
          <div className="w-16 h-16 rounded-2xl bg-sage flex items-center justify-center text-2xl font-bold text-ink border-2 border-ink">
            {profile.username.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-ink">
            {profile.display_name || profile.username}
          </h1>
          <p className="text-sm text-moss">@{profile.username}</p>
        </div>
      </div>

      {/* Details */}
      <dl className="space-y-3">
        {profile.bgg_username && (
          <div>
            <dt className="text-xs font-bold text-moss uppercase tracking-wide">BGG Username</dt>
            <dd className="mt-0.5 text-sm text-ink">{profile.bgg_username}</dd>
          </div>
        )}
        {profile.bio && (
          <div>
            <dt className="text-xs font-bold text-moss uppercase tracking-wide">Bio</dt>
            <dd className="mt-0.5 text-sm text-ink whitespace-pre-line">{profile.bio}</dd>
          </div>
        )}
        {profile.location && (
          <div>
            <dt className="text-xs font-bold text-moss uppercase tracking-wide">Location</dt>
            <dd className="mt-0.5 text-sm text-ink">{profile.location}</dd>
          </div>
        )}
        {profile.region && (
          <div>
            <dt className="text-xs font-bold text-moss uppercase tracking-wide">Region</dt>
            <dd className="mt-0.5 text-sm text-ink">{profile.region}</dd>
          </div>
        )}
      </dl>

      {/* Ratings summary */}
      {(profile.ratings_count !== undefined && profile.ratings_count !== null) && (
        <div className="mt-6 p-5 rounded-3xl bg-butter/30 border-2 border-ink/15">
          <h2 className="font-display text-sm font-bold text-ink mb-2">Trade Ratings</h2>
          <div className="flex gap-6">
            <div>
              <p className="text-2xl font-bold text-ink">{profile.ratings_count}</p>
              <p className="text-xs text-moss">Total ratings</p>
            </div>
            {profile.average_score !== null && profile.average_score !== undefined && (
              <div>
                <p className="text-2xl font-bold text-ink">
                  {profile.average_score.toFixed(1)}
                </p>
                <p className="text-xs text-moss">Average</p>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        onClick={() => navigate(-1)}
        className="mt-6 inline-block text-sm font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2"
      >
        ← Back
      </button>
    </div>
  )
}
