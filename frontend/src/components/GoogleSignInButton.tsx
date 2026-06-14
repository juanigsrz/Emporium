import { useEffect, useRef, useState } from 'react'
import { googleLoginApi, fetchCurrentUser } from '../api/auth'
import { useAuthStore } from '../store/auth'

type Props = {
  onSuccess: () => void
  onError: (message: string) => void
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

type TokenClient = { requestAccessToken: () => void }

export default function GoogleSignInButton({ onSuccess, onError }: Props) {
  const clientRef = useRef<TokenClient | null>(null)
  const [ready, setReady] = useState(false)
  const setSession = useAuthStore((s) => s.setSession)

  useEffect(() => {
    if (!CLIENT_ID) return
    let cancelled = false

    async function handleToken(resp: { access_token?: string; error?: string }) {
      if (!resp.access_token) {
        onError('Google sign-in was cancelled or failed.')
        return
      }
      try {
        const { key } = await googleLoginApi(resp.access_token)
        useAuthStore.setState({ token: key })
        const user = await fetchCurrentUser()
        setSession(key, user)
        onSuccess()
      } catch {
        onError('Google sign-in failed. Please try again.')
      }
    }

    // The GIS script loads async; poll until window.google.accounts.oauth2 is ready.
    const timer = setInterval(() => {
      if (cancelled || !window.google?.accounts?.oauth2) return
      clearInterval(timer)
      clientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID!,
        scope: 'openid email profile',
        callback: handleToken,
      })
      setReady(true)
    }, 100)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!CLIENT_ID) return null

  return (
    <button
      type="button"
      disabled={!ready}
      onClick={() => clientRef.current?.requestAccessToken()}
      className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-ink/20 bg-cream px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-sage/30 disabled:opacity-50"
    >
      <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      Sign in with Google
    </button>
  )
}
