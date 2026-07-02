import { useTranslation } from 'react-i18next'
import { languages } from '../i18n/locales'

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  return (
    <select
      aria-label={t('nav.language')}
      value={i18n.resolvedLanguage}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      className="rounded-2xl border-2 border-transparent bg-transparent px-2 py-1.5 text-sm font-semibold text-moss transition-colors hover:border-ink/30 hover:bg-sage/40 focus:border-ink focus:outline-none"
    >
      {languages.map((l) => (
        <option key={l.code} value={l.code}>{l.label}</option>
      ))}
    </select>
  )
}
