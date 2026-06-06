import type { EventStatus } from '../../api/events'

export const STATUS_BADGE_CLASSES: Record<EventStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-600 border-gray-200',
  SUBMISSIONS_OPEN: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  WANTLIST_OPEN: 'bg-sky-50 text-sky-700 border-sky-200',
  MATCHING: 'bg-violet-50 text-violet-700 border-violet-200',
  MATCH_REVIEW: 'bg-blue-50 text-blue-700 border-blue-200',
  FINALIZATION: 'bg-amber-50 text-amber-700 border-amber-200',
  SHIPPING: 'bg-orange-50 text-orange-700 border-orange-200',
  ARCHIVED: 'bg-gray-100 text-gray-400 border-gray-200',
}
