import { Suspense } from 'react'
import { Outlet, ScrollRestoration } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import NavBar from './components/NavBar'
import Toaster from './components/Toaster'

/** Lightweight page-load fallback shown while a lazily-loaded route chunk
 *  downloads. Opacity-only so it doesn't jump the layout on resolve. */
function PageFallback() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16" aria-hidden="true">
      <div className="space-y-4 opacity-60">
        <div className="h-9 w-2/3 animate-pulse rounded-full bg-gray-200" />
        <div className="h-4 w-1/3 animate-pulse rounded-full bg-gray-200" />
        <div className="mt-8 h-40 animate-pulse rounded-3xl bg-gray-200" />
      </div>
    </div>
  )
}

export default function App() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen flex flex-col">
      <ScrollRestoration />
      <NavBar />
      <main className="flex-1">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
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
      <Toaster />
    </div>
  )
}
