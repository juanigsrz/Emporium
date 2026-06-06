import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { registerApi, fetchCurrentUser } from '../../api/auth'
import { useAuthStore } from '../../store/auth'

const schema = z
  .object({
    username: z.string().min(1, 'Username is required').max(150, 'Max 150 characters'),
    email: z.string().min(1, 'Email is required').email('Enter a valid email'),
    password1: z.string().min(8, 'Password must be at least 8 characters'),
    password2: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password1 === d.password2, {
    path: ['password2'],
    message: 'Passwords do not match',
  })

type FormValues = z.infer<typeof schema>

type FieldKey = 'username' | 'email' | 'password1' | 'password2'

export default function RegisterPage() {
  const navigate = useNavigate()
  const setSession = useAuthStore((s) => s.setSession)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    try {
      const { key } = await registerApi(values)
      useAuthStore.setState({ token: key })
      const user = await fetchCurrentUser()
      setSession(key, user)
      navigate('/', { replace: true })
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const resp = (err as { response?: { data?: Record<string, string[]> } }).response
        const data = resp?.data ?? {}
        const fields: FieldKey[] = ['username', 'email', 'password1', 'password2']
        let handled = false
        for (const f of fields) {
          if (data[f]) {
            setError(f, { message: data[f][0] })
            handled = true
          }
        }
        if (!handled) {
          const msg =
            (data as { non_field_errors?: string[] }).non_field_errors?.[0] ??
            'Registration failed. Please check your details.'
          setServerError(msg)
        }
      } else {
        setServerError('Network error. Please try again.')
      }
    }
  }

  const fields: { name: FieldKey; label: string; type: string; autoComplete: string }[] = [
    { name: 'username', label: 'Username', type: 'text', autoComplete: 'username' },
    { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
    { name: 'password1', label: 'Password', type: 'password', autoComplete: 'new-password' },
    { name: 'password2', label: 'Confirm password', type: 'password', autoComplete: 'new-password' },
  ]

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Create account</h1>
        <p className="text-sm text-gray-500 mb-6">
          Already have an account?{' '}
          <Link to="/login" className="text-indigo-600 hover:underline font-medium">
            Sign in
          </Link>
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {serverError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {serverError}
            </div>
          )}

          {fields.map(({ name, label, type, autoComplete }) => (
            <div key={name}>
              <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">
                {label}
              </label>
              <input
                id={name}
                type={type}
                autoComplete={autoComplete}
                {...register(name)}
                className={`w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  errors[name] ? 'border-red-400' : 'border-gray-300'
                }`}
              />
              {errors[name] && (
                <p className="mt-1 text-xs text-red-600">{errors[name]?.message}</p>
              )}
            </div>
          ))}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-60 transition-colors"
          >
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
