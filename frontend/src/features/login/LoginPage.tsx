import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { loginApi, fetchCurrentUser } from '../../api/auth'
import { useAuthStore } from '../../store/auth'

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})

type FormValues = z.infer<typeof schema>

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const setSession = useAuthStore((s) => s.setSession)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/'

  async function onSubmit(values: FormValues) {
    setServerError(null)
    try {
      const { key } = await loginApi(values)
      // Temporarily set token so fetchCurrentUser request is authenticated
      useAuthStore.setState({ token: key })
      const user = await fetchCurrentUser()
      setSession(key, user)
      navigate(from, { replace: true })
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const resp = (err as { response?: { data?: Record<string, string[]> } }).response
        const data = resp?.data ?? {}
        let handled = false
        if (data.username) { setError('username', { message: data.username[0] }); handled = true }
        if (data.password) { setError('password', { message: data.password[0] }); handled = true }
        if (!handled) {
          const msg = (data as { non_field_errors?: string[] }).non_field_errors?.[0]
            ?? 'Invalid credentials. Please try again.'
          setServerError(msg)
        }
      } else {
        setServerError('Network error. Please try again.')
      }
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border-2 border-ink bg-cream p-7 shadow-card">
        <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border-2 border-ink bg-butter text-2xl">🎲</span>
        <h1 className="mb-1 text-2xl font-bold text-ink">Sign in</h1>
        <p className="mb-6 text-sm text-moss">
          Don&apos;t have an account?{' '}
          <Link to="/register" className="font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2 hover:decoration-butter">
            Register
          </Link>
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {serverError && (
            <div className="rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {serverError}
            </div>
          )}

          <div>
            <label htmlFor="username" className="mb-1 block text-sm font-semibold text-ink">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              {...register('username')}
              className={`w-full rounded-xl border-2 bg-parchment px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-2 focus:ring-sage ${
                errors.username ? 'border-red-400' : 'border-ink/15'
              }`}
            />
            {errors.username && (
              <p className="mt-1 text-xs font-medium text-red-600">{errors.username.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-semibold text-ink">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
              className={`w-full rounded-xl border-2 bg-parchment px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-2 focus:ring-sage ${
                errors.password ? 'border-red-400' : 'border-ink/15'
              }`}
            />
            {errors.password && (
              <p className="mt-1 text-xs font-medium text-red-600">{errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-2xl border-2 border-ink bg-butter px-4 py-2.5 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
