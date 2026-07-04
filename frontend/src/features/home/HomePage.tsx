import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'

export default function HomePage() {
  const { t } = useTranslation()
  usePageTitle(null)

  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:py-20">
      {/* Hero */}
      <header className="relative">
        <h1 className="max-w-3xl text-4xl font-bold text-ink sm:text-6xl">
          {t('home.heroTitle')}
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-moss">
          {t('home.heroSubtitle')}
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            to="/events"
            className="rounded-2xl border-2 border-ink bg-butter px-6 py-3 text-sm font-bold text-ink shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0"
          >
            {t('home.browseEvents')}
          </Link>
        </div>
      </header>

      {/* Feature cards */}
      <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FeatureCard
          index="01"
          emoji="🎲"
          tint="bg-butter/70"
          title={t('home.tradeEventsTitle')}
          description={t('home.tradeEventsDescription')}
          href="/events"
        />
        <FeatureCard
          index="02"
          emoji="📦"
          tint="bg-sage/70"
          title={t('common.myCopies')}
          description={t('home.myCopiesDescription')}
          href="/my-copies"
        />
      </div>
    </div>
  )
}

function FeatureCard({
  index,
  emoji,
  tint,
  title,
  description,
  href,
}: {
  index: string
  emoji: string
  tint: string
  title: string
  description: string
  href: string
}) {
  const { t } = useTranslation()

  return (
    <Link
      to={href}
      className="group relative block overflow-hidden rounded-3xl border-2 border-ink bg-cream p-2 shadow-card transition-transform hover:-translate-y-1.5"
    >
      <div className={`relative flex h-24 items-center rounded-[1.1rem] border-2 border-ink/15 ${tint} px-5`}>
        <span className="text-5xl">{emoji}</span>
        <span className="pointer-events-none absolute right-4 top-2 font-display text-3xl font-bold text-ink/20">
          {index}
        </span>
      </div>
      <div className="px-4 pb-3 pt-4">
        <h3 className="mb-1 font-display text-xl font-bold text-ink">
          {title}
        </h3>
        <p className="max-w-xs text-sm leading-relaxed text-moss">{description}</p>
        <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-ink">
          {t('home.open')}
          <svg className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </div>
    </Link>
  )
}
