import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useCopy } from '../api/copies'
import { GameThumb } from './GameThumb'

// Full copy detail popup — lazily fetches GET /copies/{id}/ (readable by any
// authenticated user) so the viewer can inspect language/condition/missing
// pieces/notes/photos before committing to a specific copy.
function CopyDetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-2 py-1.5">
      <span className="w-28 shrink-0 text-[11px] font-medium uppercase tracking-wide text-moss/70">
        {label}
      </span>
      <span className="whitespace-pre-wrap text-sm text-ink">{value}</span>
    </div>
  )
}

export function CopyDetailModal({ copyId, onClose }: { copyId: number; onClose: () => void }) {
  const { t } = useTranslation()
  const { data: copy, isLoading } = useCopy(copyId)
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('trades.copyDetail.dialogAriaLabel')}
    >
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 min-w-0">
            <GameThumb src={copy?.board_game_thumbnail} alt={copy?.board_game_name ?? ''} className="h-32 w-32" />
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-ink">
                {copy ? copy.board_game_name : t('trades.copyDetail.defaultTitle')}
              </h3>
              {copy && (
                <p className="font-mono text-xs text-moss/70">
                  {copy.listing_code} · {copy.owner_username}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-moss/70 hover:text-moss"
            aria-label={t('trades.closeAriaLabel')}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isLoading || !copy ? (
          <p className="py-6 text-center text-sm text-moss/70">{t('common.loading')}</p>
        ) : (
          <div className="divide-y divide-gray-50">
            <CopyDetailRow label={t('trades.copyDetail.condition')} value={t(`trades.conditionLabel.${copy.condition}`, { defaultValue: copy.condition })} />
            <CopyDetailRow label={t('trades.copyDetail.language')} value={copy.language} />
            <CopyDetailRow label={t('trades.copyDetail.edition')} value={copy.version_name && copy.version_name !== 'Unknown' ? copy.version_name : ''} />
            <CopyDetailRow label={t('trades.copyDetail.sleeved')} value={copy.sleeved !== 'UNKNOWN' ? copy.sleeved : ''} />
            <CopyDetailRow label={t('trades.copyDetail.includes')} value={copy.includes_expansions} />
            <CopyDetailRow label={t('trades.copyDetail.missing')} value={copy.missing_components} />
            <CopyDetailRow label={t('trades.copyDetail.upgraded')} value={copy.upgraded_components} />
            <CopyDetailRow label={t('trades.copyDetail.componentNotes')} value={copy.component_notes} />
            <CopyDetailRow label={t('trades.copyDetail.ownerNotes')} value={copy.owner_notes} />
            <CopyDetailRow label={t('trades.copyDetail.tradeValue')} value={copy.trade_value_hint} />
            <CopyDetailRow label={t('trades.copyDetail.shipping')} value={copy.shipping_constraints} />
            <CopyDetailRow label={t('trades.copyDetail.pickup')} value={copy.pickup_available ? t('trades.copyDetail.available') : ''} />
            <CopyDetailRow label={t('trades.copyDetail.status')} value={copy.status !== 'ACTIVE' ? copy.status : ''} />
            {copy.photo_urls?.length > 0 && (
              <div className="py-2">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-moss/70">
                  {t('trades.copyDetail.photos')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {copy.photo_urls.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="block h-20 w-20 overflow-hidden rounded border border-ink/15"
                    >
                      <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
