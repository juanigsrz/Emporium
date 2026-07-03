import { Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import NavBar from './components/NavBar'

export default function App() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="mt-10 border-t-2 border-ink/10 bg-cream/60 py-6 text-center text-xs text-moss">
        <span className="font-display text-sm font-bold tracking-tight text-ink">Emporium</span>
        <span className="mx-2 text-moss/40">·</span>
        {t('common.tagline')}
        <span className="mx-2 text-moss/40">·</span>
        &copy; {new Date().getFullYear()}
        <span className="mx-2 text-moss/40">·</span>
        <a
          href="https://boardgamegeek.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block align-middle"
        >
          <img
            src="/powered-by-bgg.jpg"
            alt="Powered by BGG"
            className="h-6 w-auto mix-blend-multiply"
          />
        </a>
      </footer>
    </div>
  )
}
