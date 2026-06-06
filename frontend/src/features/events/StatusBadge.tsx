import type { EventStatus } from '../../api/events'
import { EVENT_STATUS_LABELS } from '../../api/events'
import { STATUS_BADGE_CLASSES } from './eventUtils'

export function StatusBadge({ status }: { status: EventStatus }) {
  return (
    <span
      className={`inline-flex items-center text-xs font-medium border rounded px-1.5 py-0.5 ${
        STATUS_BADGE_CLASSES[status] ?? 'bg-gray-100 text-gray-500 border-gray-200'
      }`}
    >
      {EVENT_STATUS_LABELS[status] ?? status}
    </span>
  )
}
