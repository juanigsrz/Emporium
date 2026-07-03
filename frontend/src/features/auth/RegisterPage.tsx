import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { registerApi, fetchCurrentUser } from '../../api/auth'
import { useAuthStore } from '../../store/auth'
import GoogleSignInButton from '../../components/GoogleSignInButton'

type FieldKey = 'username' | 'email' | 'password1' | 'password2'

export default function RegisterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setSession = useAuthStore((s) => s.setSession)
  const [serverError, setServerError] = useState<string | null>(null)

  const schema = useMemo(() => z
    .object({
      username: z.string().min(1, t('auth.errors.usernameRequired')).max(150, t('auth.errors.usernameMax')),
      email: z.string().min(1, t('auth.errors.emailRequired')).email(t('auth.errors.emailInvalid')),
      password1: z.string().min(8, t('auth.errors.password1Min')),
      password2: z.string().min(1, t('auth.errors.password2Required')),
    })
    .refine((d) => d.password1 === d.password2, {
      path: ['password2'],
      message: t('auth.errors.passwordMismatch'),
    }), [t])

  type FormValues = z.infer<typeof schema>

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
            t('auth.errors.registrationFailed')
          setServerError(msg)
        }
      } else {
        setServerError(t('auth.errors.networkError'))
      }
    }
  }

  const fields: { name: FieldKey; label: string; type: string; autoComplete: string }[] = [
    { name: 'username', label: t('auth.usernameLabel'), type: 'text', autoComplete: 'username' },
    { name: 'email', label: t('auth.emailLabel'), type: 'email', autoComplete: 'email' },
    { name: 'password1', label: t('auth.passwordLabel'), type: 'password', autoComplete: 'new-password' },
    { name: 'password2', label: t('auth.confirmPasswordLabel'), type: 'password', autoComplete: 'new-password' },
  ]

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border-2 border-ink bg-cream p-7 shadow-card">
        <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border-2 border-ink bg-sage text-2xl">🎟️</span>
        <h1 className="mb-1 text-2xl font-bold text-ink">{t('auth.title')}</h1>
        <p className="mb-6 text-sm text-moss">
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className="font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2 hover:decoration-butter">
            {t('auth.signIn')}
          </Link>
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {serverError && (
            <div className="rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {serverError}
            </div>
          )}

          {fields.map(({ name, label, type, autoComplete }) => (
            <div key={name}>
              <label htmlFor={name} className="mb-1 block text-sm font-semibold text-ink">
                {label}
              </label>
              <input
                id={name}
                type={type}
                autoComplete={autoComplete}
                {...register(name)}
                className={`w-full rounded-xl border-2 bg-parchment px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-2 focus:ring-sage ${
                  errors[name] ? 'border-red-400' : 'border-ink/15'
                }`}
              />
              {errors[name] && (
                <p className="mt-1 text-xs font-medium text-red-600">{errors[name]?.message}</p>
              )}
            </div>
          ))}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-2xl border-2 border-ink bg-butter px-4 py-2.5 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
          >
            {isSubmitting ? t('auth.submitting') : t('auth.submit')}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-moss/60">
          <span className="h-px flex-1 bg-ink/10" />
          {t('auth.or')}
          <span className="h-px flex-1 bg-ink/10" />
        </div>
        <GoogleSignInButton
          onSuccess={() => navigate('/', { replace: true })}
          onError={setServerError}
        />
      </div>
    </div>
  )
}
