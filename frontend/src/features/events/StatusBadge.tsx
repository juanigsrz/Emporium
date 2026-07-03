import { useTranslation } from 'react-i18next'
import type { EventStatus } from '../../api/events'
import { eventStatusLabel } from '../../api/events'
import { STATUS_BADGE_CLASSES } from './eventUtils'

export function StatusBadge({ status }: { status: EventStatus }) {
  const { t } = useTranslation()
  return (
    <span
      className={`inline-flex items-center text-xs font-semibold border rounded-full px-2.5 py-0.5 ${
        STATUS_BADGE_CLASSES[status] ?? 'bg-gray-100 text-gray-500 border-gray-200'
      }`}
    >
      {eventStatusLabel(t, status)}
    </span>
  )
}
