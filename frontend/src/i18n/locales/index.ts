import en from './en.json'
import es from './es.json'

export const resources = {
  en: { translation: en },
  es: { translation: es },
} as const

export const languages: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'en', label: '🇺🇸 en' },
  { code: 'es', label: '🇪🇸 es' },
]
