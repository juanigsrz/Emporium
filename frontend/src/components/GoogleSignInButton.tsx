import { useEffect, useRef } from 'react'
import { googleLoginApi, fetchCurrentUser } from '../api/auth'
import { useAuthStore } from '../store/auth'

type Props = {
  onSuccess: () => void
  onError: (message: string) => void
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

export default function GoogleSignInButton({ onSuccess, onError }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const setSession = useAuthStore((s) => s.setSession)

  useEffect(() => {
    if (!CLIENT_ID) return
    let cancelled = false

    async function handleCredential(resp: { credential: string }) {
      try {
        const { key } = await googleLoginApi(resp.credential)
        useAuthStore.setState({ token: key })
        const user = await fetchCurrentUser()
        setSession(key, user)
        onSuccess()
      } catch {
        onError('Google sign-in failed. Please try again.')
      }
    }

    // The GIS script loads async; poll until window.google is ready.
    const timer = setInterval(() => {
      if (cancelled || !window.google?.accounts?.id || !ref.current) return
      clearInterval(timer)
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID!,
        callback: handleCredential,
      })
      window.google.accounts.id.renderButton(ref.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
      })
    }, 100)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!CLIENT_ID) return null
  return <div ref={ref} className="flex justify-center" />
}
