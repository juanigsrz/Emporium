import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState, useEffect, useRef } from 'react'
import {
  fetchMyProfile,
  patchMyProfile,
  fetchBlocks,
  createBlock,
  deleteBlock,
  fetchWishlists,
  createWishlistEntry,
  deleteWishlistEntry,
  useMyProfile,
  type PatchProfilePayload,
  searchGeocode,
  type GeocodeSuggestion,
} from '../../api/profiles'
import { useStartImport, useImportJob, type ImportKind } from '../../api/bgg'
import { useMyRatings } from '../../api/ratings'

// ---- Shared BGG import button (used by Wishlist + Ratings tabs) ----
function BggImportButton({
  kind,
  label,
  onDone,
}: {
  kind: ImportKind
  label: string
  onDone: () => void
}) {
  const { data: profile } = useMyProfile()
  const start = useStartImport()
  const [jobId, setJobId] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const job = useImportJob(jobId)
  const running = ['PENDING', 'RUNNING'].includes(job.data?.status ?? '')

  useEffect(() => {
    if (job.data?.status === 'DONE') {
      const matched = job.data.summary?.matched ?? 0
      const skipped = job.data.summary?.skipped ?? 0
      setMsg(`Done — ${matched} matched, ${skipped} skipped.`)
      setJobId(null)
      onDone()
    } else if (job.data?.status === 'FAILED') {
      setMsg('Failed. Check your BGG username and try again.')
      setJobId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.data?.status])

  if (!profile?.bgg_username) {
    return (
      <span className="text-xs text-gray-400">
        Set your BoardGameGeek username in the Profile tab to enable.
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          setMsg(null)
          start.mutateAsync({ kind }).then((j) => setJobId(j.id))
        }}
        disabled={running || start.isPending}
        className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
      >
        {running ? 'Working…' : label}
      </button>
      {msg && <span className="text-xs text-green-600">{msg}</span>}
    </div>
  )
}

const profileSchema = z.object({
  display_name: z.string().max(100, 'Max 100 characters').optional().or(z.literal('')),
  bgg_username: z.string().max(100, 'Max 100 characters').optional().or(z.literal('')),
  bio: z.string().max(500, 'Max 500 characters').optional().or(z.literal('')),
  location: z.string().max(100, 'Max 100 characters').optional().or(z.literal('')),
  region: z.string().max(100, 'Max 100 characters').optional().or(z.literal('')),
  avatar_url: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  max_trade_distance_km: z.string().optional(),
})

type ProfileFormValues = z.infer<typeof profileSchema>

// ---- Profile Edit Section ----
function ProfileEdit() {
  const qc = useQueryClient()
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['profile', 'me'],
    queryFn: fetchMyProfile,
  })

  const mutation = useMutation({
    mutationFn: (payload: PatchProfilePayload) => patchMyProfile(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile', 'me'] })
      setSaveMsg('Profile saved.')
      setTimeout(() => setSaveMsg(null), 3000)
    },
  })

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      display_name: '',
      bgg_username: '',
      bio: '',
      location: '',
      region: '',
      avatar_url: '',
    },
  })

  const locationValue = watch('location')
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const skipNextSearch = useRef(false)

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false
      return
    }
    const q = (locationValue ?? '').trim()
    if (q.length < 3) {
      setSuggestions([])
      return
    }
    const handle = setTimeout(async () => {
      try {
        const res = await searchGeocode(q)
        setSuggestions(res)
        setShowSuggestions(true)
      } catch {
        setSuggestions([])
      }
    }, 350)
    return () => clearTimeout(handle)
  }, [locationValue])

  useEffect(() => {
    if (profile) {
      reset({
        display_name: profile.display_name ?? '',
        bgg_username: profile.bgg_username ?? '',
        bio: profile.bio ?? '',
        location: profile.location ?? '',
        region: profile.region ?? '',
        avatar_url: profile.avatar_url ?? '',
        max_trade_distance_km: profile.max_trade_distance_km != null
          ? String(profile.max_trade_distance_km)
          : '',
      })
    }
  }, [profile, reset])

  if (isLoading) return <p className="text-sm text-gray-500">Loading profile…</p>
  if (error) return <p className="text-sm text-red-600">Failed to load profile.</p>

  const onSubmit = (values: ProfileFormValues) => {
    const distRaw = values.max_trade_distance_km
    const dist = distRaw && distRaw.trim() !== '' ? parseInt(distRaw, 10) : null
    mutation.mutate({
      display_name: values.display_name,
      bgg_username: values.bgg_username,
      bio: values.bio,
      location: values.location,
      region: values.region,
      avatar_url: values.avatar_url,
      max_trade_distance_km: dist,
    })
  }

  const textFields: { name: keyof ProfileFormValues; label: string; multiline?: boolean }[] = [
    { name: 'display_name', label: 'Display name' },
    { name: 'bgg_username', label: 'BoardGameGeek username' },
    { name: 'bio', label: 'Bio', multiline: true },
    { name: 'location', label: 'Location' },
    { name: 'region', label: 'Region' },
    { name: 'avatar_url', label: 'Avatar URL' },
  ]

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Edit Profile</h2>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-w-lg">
        {mutation.isError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            Failed to save profile. Please try again.
          </div>
        )}
        {saveMsg && (
          <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
            {saveMsg}
          </div>
        )}

        {textFields.map(({ name, label, multiline }) => {
          if (name === 'location') {
            return (
              <div key={name} className="relative">
                <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">
                  {label}
                </label>
                <input
                  id="location"
                  type="text"
                  autoComplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="location-suggestions"
                  aria-expanded={showSuggestions && suggestions.length > 0}
                  {...register('location')}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  className={`w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    errors.location ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul
                    id="location-suggestions"
                    role="listbox"
                    className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg"
                  >
                    {suggestions.map((s) => (
                      <li key={`${s.display_name}-${s.lat}-${s.lon}`} role="option" aria-selected={false}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            skipNextSearch.current = true
                            setValue('location', s.display_name, { shouldDirty: true })
                            setShowSuggestions(false)
                          }}
                          className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-indigo-50"
                        >
                          {s.display_name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {errors.location && (
                  <p className="mt-1 text-xs text-red-600">{errors.location?.message}</p>
                )}
              </div>
            )
          }
          return (
            <div key={name}>
              <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">
                {label}
              </label>
              {multiline ? (
                <textarea
                  id={name}
                  rows={3}
                  {...register(name)}
                  className={`w-full rounded-md border px-3 py-2 text-sm shadow-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    errors[name] ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
              ) : (
                <input
                  id={name}
                  type="text"
                  {...register(name)}
                  className={`w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    errors[name] ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
              )}
              {errors[name] && (
                <p className="mt-1 text-xs text-red-600">{errors[name]?.message}</p>
              )}
            </div>
          )
        })}

        {/* Geocoded coordinates (read-only feedback) */}
        <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-500">
          {profile?.latitude != null && profile?.longitude != null ? (
            <span>
              Geocoded: {profile.latitude.toFixed(4)}, {profile.longitude.toFixed(4)}
            </span>
          ) : (
            <span>Location not geocoded yet — save a location to resolve coordinates.</span>
          )}
        </div>

        {/* Trade distance limit */}
        <div>
          <label htmlFor="max_trade_distance_km" className="block text-sm font-medium text-gray-700 mb-1">
            Forbid trades farther than (km)
          </label>
          <input
            id="max_trade_distance_km"
            type="number"
            min={1}
            step={1}
            placeholder="Leave blank for no limit"
            {...register('max_trade_distance_km')}
            className="w-full sm:max-w-[12rem] rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <button
          type="submit"
          disabled={mutation.isPending || !isDirty}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-60 transition-colors"
        >
          {mutation.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </section>
  )
}

// ---- Blocks Section ----
function BlocksSection() {
  const qc = useQueryClient()
  const [blockInput, setBlockInput] = useState('')
  const [blockError, setBlockError] = useState<string | null>(null)

  const { data: blocks, isLoading } = useQuery({
    queryKey: ['blocks'],
    queryFn: fetchBlocks,
  })

  const addMutation = useMutation({
    mutationFn: () => createBlock({ blocked: blockInput.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocks'] })
      setBlockInput('')
      setBlockError(null)
    },
    onError: () => {
      setBlockError('Could not block user. Check the username and try again.')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (id: number) => deleteBlock(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blocks'] }),
  })

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-800 mb-3">Blocked Users</h2>

      <div className="flex gap-2 mb-4 max-w-sm">
        <input
          type="text"
          placeholder="Username to block"
          value={blockInput}
          onChange={(e) => setBlockInput(e.target.value)}
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={() => {
            if (!blockInput.trim()) return
            setBlockError(null)
            addMutation.mutate()
          }}
          disabled={addMutation.isPending || !blockInput.trim()}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60 transition-colors"
        >
          Block
        </button>
      </div>

      {blockError && (
        <p className="mb-3 text-sm text-red-600">{blockError}</p>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !blocks || blocks.length === 0 ? (
        <p className="text-sm text-gray-400">No blocked users.</p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md max-w-sm">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-3 py-2">
              <span className="text-sm text-gray-800">{b.blocked}</span>
              <button
                onClick={() => removeMutation.mutate(b.id)}
                disabled={removeMutation.isPending}
                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-60"
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---- Wishlist Section ----
function WishlistSection() {
  const qc = useQueryClient()
  const [bggId, setBggId] = useState('')
  const [note, setNote] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const { data: entries, isLoading } = useQuery({
    queryKey: ['wishlists'],
    queryFn: fetchWishlists,
  })

  const addMutation = useMutation({
    mutationFn: () =>
      createWishlistEntry({ board_game_bgg_id: parseInt(bggId, 10), note: note || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wishlists'] })
      setBggId('')
      setNote('')
      setAddError(null)
    },
    onError: () => {
      setAddError('Could not add to wishlist. Check the BGG ID and try again.')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (id: number) => deleteWishlistEntry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wishlists'] }),
  })

  const handleAdd = () => {
    const parsed = parseInt(bggId, 10)
    if (!bggId.trim() || isNaN(parsed) || parsed <= 0) {
      setAddError('Enter a valid BGG ID (positive integer).')
      return
    }
    setAddError(null)
    addMutation.mutate()
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-800 mb-3">Wishlist</h2>

      <div className="mb-4">
        <BggImportButton
          kind="WISHLIST"
          label="Sync BGG wishlist"
          onDone={() => qc.invalidateQueries({ queryKey: ['wishlists'] })}
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-4 max-w-lg">
        <input
          type="number"
          placeholder="BGG ID"
          value={bggId}
          min={1}
          onChange={(e) => setBggId(e.target.value)}
          className="w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <input
          type="text"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="flex-1 min-w-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={handleAdd}
          disabled={addMutation.isPending || !bggId.trim()}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60 transition-colors"
        >
          Add
        </button>
      </div>

      {addError && <p className="mb-3 text-sm text-red-600">{addError}</p>}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !entries || entries.length === 0 ? (
        <p className="text-sm text-gray-400">Your wishlist is empty.</p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md max-w-lg">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between px-3 py-2 gap-2">
              <div className="min-w-0">
                <span className="text-sm font-medium text-gray-800">BGG #{e.board_game_bgg_id}</span>
                {e.note && <span className="ml-2 text-xs text-gray-500 truncate">{e.note}</span>}
              </div>
              <button
                onClick={() => removeMutation.mutate(e.id)}
                disabled={removeMutation.isPending}
                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-60 shrink-0"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---- Ratings Section (review-only) ----
function RatingsSection() {
  const qc = useQueryClient()
  const { data: ratings = [], isLoading } = useMyRatings()
  const [filter, setFilter] = useState('')

  const shown = ratings
    .filter((r) => r.board_game_name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => a.board_game_name.localeCompare(b.board_game_name))

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-800 mb-3">Game Ratings</h2>

      <div className="mb-4">
        <BggImportButton
          kind="RATINGS"
          label="Import ratings from BGG"
          onDone={() => qc.invalidateQueries({ queryKey: ['ratings', 'mine'] })}
        />
      </div>

      <input
        type="text"
        placeholder="Filter your rated games…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full max-w-sm mb-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-gray-400">
          {ratings.length === 0
            ? 'No ratings yet. Import from BGG or rate games in the want builder.'
            : 'No matches.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md max-w-sm">
          {shown.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-3 py-2 gap-2">
              <span className="text-sm text-gray-800 truncate">{r.board_game_name}</span>
              <span className="text-sm font-semibold text-indigo-600">{Number(r.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---- Page ----
export default function ProfilePage() {
  const [tab, setTab] = useState<'profile' | 'blocks' | 'wishlist' | 'ratings'>('profile')

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'blocks', label: 'Blocked Users' },
    { key: 'wishlist', label: 'Wishlist' },
    { key: 'ratings', label: 'Ratings' },
  ]

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Account</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab === key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && <ProfileEdit />}
      {tab === 'blocks' && <BlocksSection />}
      {tab === 'wishlist' && <WishlistSection />}
      {tab === 'ratings' && <RatingsSection />}
    </div>
  )
}
