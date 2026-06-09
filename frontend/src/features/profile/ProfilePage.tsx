import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState, useEffect } from 'react'
import {
  fetchMyProfile,
  patchMyProfile,
  fetchBlocks,
  createBlock,
  deleteBlock,
  fetchWishlists,
  createWishlistEntry,
  deleteWishlistEntry,
  type PatchProfilePayload,
} from '../../api/profiles'

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

        {textFields.map(({ name, label, multiline }) => (
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
        ))}

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

// ---- Page ----
export default function ProfilePage() {
  const [tab, setTab] = useState<'profile' | 'blocks' | 'wishlist'>('profile')

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'blocks', label: 'Blocked Users' },
    { key: 'wishlist', label: 'Wishlist' },
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
    </div>
  )
}
