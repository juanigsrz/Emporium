import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { resources } from './locales'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage'],
    },
  })

// Keep <html lang> in sync so assistive tech pronounces the active language.
function syncHtmlLang(lng: string) {
  document.documentElement.lang = lng.split('-')[0]
}
syncHtmlLang(i18n.resolvedLanguage ?? 'en')
i18n.on('languageChanged', syncHtmlLang)

export default i18n
