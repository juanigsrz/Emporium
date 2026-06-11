import { useEffect, useMemo } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CONDITION_LABELS } from './constants'
import { useGameVersions } from '../../api/games'

const CONDITION_VALUES = ['NEW', 'LIKE_NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'POOR'] as const
const SLEEVED_VALUES = ['UNKNOWN', 'NONE', 'SLEEVED'] as const
const SLEEVED_LABELS: Record<string, string> = {
  UNKNOWN: 'Unknown', NONE: 'Not sleeved', SLEEVED: 'Sleeved',
}

// version_sel: "" = untouched (fails required); "UNKNOWN" = explicit Unknown; "<id>" = a real version.
export const copyFormSchema = z.object({
  version_sel: z.string().min(1, 'Select an edition'),
  condition: z.enum(CONDITION_VALUES, { error: 'Condition is required' }),
  sleeved: z.enum(SLEEVED_VALUES).optional(),
  includes_expansions: z.string().optional(),
  missing_components: z.string().optional(),
  upgraded_components: z.string().optional(),
  component_notes: z.string().optional(),
  owner_notes: z.string().optional(),
  trade_value_hint: z.string().max(120).optional(),
  shipping_constraints: z.string().optional(),
  pickup_available: z.boolean().optional(),
  photo_urls: z
    .array(z.object({ url: z.string().url('Must be a valid URL').or(z.literal('')) }))
    .optional(),
})
export type CopyFormValues = z.infer<typeof copyFormSchema>

export interface CopySubmitPayload {
  version: number | null
  condition: (typeof CONDITION_VALUES)[number]
  sleeved?: (typeof SLEEVED_VALUES)[number]
  includes_expansions?: string
  missing_components?: string
  upgraded_components?: string
  component_notes?: string
  owner_notes?: string
  trade_value_hint?: string
  shipping_constraints?: string
  pickup_available?: boolean
  photo_urls?: string[]
}

export interface CopyFormProps {
  boardGameId: number
  formId: string
  initial?: Partial<CopyFormValues> & { versionId?: number | null; versionName?: string }
  onSubmit: (payload: CopySubmitPayload) => Promise<void>
  serverError: string | null
}

export function CopyForm({ boardGameId, formId, initial, onSubmit, serverError }: CopyFormProps) {
  const { data: versions = [], isLoading: versionsLoading } = useGameVersions(boardGameId)

  const {
    register, handleSubmit, control, watch, setValue,
    formState: { errors },
  } = useForm<CopyFormValues>({
    resolver: zodResolver(copyFormSchema),
    defaultValues: {
      version_sel: '',
      condition: initial?.condition ?? 'GOOD',
      sleeved: initial?.sleeved ?? 'UNKNOWN',
      includes_expansions: initial?.includes_expansions ?? '',
      missing_components: initial?.missing_components ?? '',
      upgraded_components: initial?.upgraded_components ?? '',
      component_notes: initial?.component_notes ?? '',
      owner_notes: initial?.owner_notes ?? '',
      trade_value_hint: initial?.trade_value_hint ?? '',
      shipping_constraints: initial?.shipping_constraints ?? '',
      pickup_available: initial?.pickup_available ?? false,
      photo_urls: initial?.photo_urls ?? [],
    },
  })

  const { fields: photoFields, append: appendPhoto, remove: removePhoto } = useFieldArray({
    control, name: 'photo_urls',
  })

  // Seed the version selector once the version list has loaded (Edit only).
  useEffect(() => {
    if (versionsLoading) return
    let sel = ''
    if (initial?.versionId != null && versions.some((v) => v.id === initial.versionId)) {
      sel = String(initial.versionId)
    } else if (initial && (initial.versionName === 'Unknown' || initial.versionId != null)) {
      // copy exists but its version is the Unknown fallback (excluded from the list)
      sel = 'UNKNOWN'
    }
    if (sel) setValue('version_sel', sel, { shouldValidate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionsLoading])

  const versionSel = watch('version_sel')
  const derivedLanguage = useMemo(() => {
    if (versionSel === '' || versionSel === 'UNKNOWN') return 'Unknown'
    const v = versions.find((vv) => String(vv.id) === versionSel)
    return v?.language || 'Unknown'
  }, [versionSel, versions])

  const submit = handleSubmit(async (values) => {
    await onSubmit({
      version: values.version_sel === 'UNKNOWN' ? null : Number(values.version_sel),
      condition: values.condition,
      sleeved: values.sleeved,
      includes_expansions: values.includes_expansions || undefined,
      missing_components: values.missing_components || undefined,
      upgraded_components: values.upgraded_components || undefined,
      component_notes: values.component_notes || undefined,
      owner_notes: values.owner_notes || undefined,
      trade_value_hint: values.trade_value_hint || undefined,
      shipping_constraints: values.shipping_constraints || undefined,
      pickup_available: values.pickup_available,
      photo_urls: values.photo_urls?.filter((p) => p.url.trim() !== '').map((p) => p.url.trim()),
    })
  })

  const inputCls = (hasErr: boolean) =>
    `w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
      hasErr ? 'border-red-400' : 'border-gray-300'
    }`

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-4">
      {serverError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {serverError}
        </div>
      )}

      {/* Version (Edition) — required */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Edition <span className="text-red-500">*</span>
        </label>
        <select {...register('version_sel')} className={inputCls(!!errors.version_sel)} disabled={versionsLoading}>
          <option value="" disabled>{versionsLoading ? 'Loading editions…' : 'Select an edition…'}</option>
          <option value="UNKNOWN">Unknown / Not specified</option>
          {versions.map((v) => (
            <option key={v.id} value={String(v.id)}>
              {v.name}{v.language ? ` (${v.language})` : ''}{v.year_published ? ` ${v.year_published}` : ''}
            </option>
          ))}
        </select>
        {errors.version_sel && <p className="mt-1 text-xs text-red-600">{errors.version_sel.message}</p>}
        <p className="mt-1 text-xs text-gray-400">Language: <span className="font-medium text-gray-600">{derivedLanguage}</span> (from edition)</p>
      </div>

      {/* Condition — required */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Condition <span className="text-red-500">*</span>
        </label>
        <select {...register('condition')} className={inputCls(!!errors.condition)}>
          <option value="">Select condition…</option>
          {Object.entries(CONDITION_LABELS).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
        </select>
        {errors.condition && <p className="mt-1 text-xs text-red-600">{errors.condition.message}</p>}
      </div>

      {/* Sleeved */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Sleeved</label>
        <select {...register('sleeved')} className={inputCls(false)}>
          {Object.entries(SLEEVED_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Includes expansions</label>
        <input {...register('includes_expansions')} placeholder="e.g. Stonemaier Expansions" className={inputCls(false)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Missing components</label>
          <input {...register('missing_components')} placeholder="None" className={inputCls(false)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Upgraded components</label>
          <input {...register('upgraded_components')} placeholder="None" className={inputCls(false)} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Component notes</label>
        <textarea {...register('component_notes')} rows={2} className={`${inputCls(false)} resize-none`} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Owner notes</label>
        <textarea {...register('owner_notes')} rows={2} className={`${inputCls(false)} resize-none`} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Trade value hint</label>
        <input {...register('trade_value_hint')} placeholder="e.g. ~$40 retail" className={inputCls(!!errors.trade_value_hint)} />
        {errors.trade_value_hint && (
          <p className="mt-1 text-xs text-red-600">{errors.trade_value_hint.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Shipping constraints</label>
        <input {...register('shipping_constraints')} placeholder="e.g. Domestic only" className={inputCls(false)} />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="edit_pickup_available"
          type="checkbox"
          {...register('pickup_available')}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label htmlFor="edit_pickup_available" className="text-sm font-medium text-gray-700">
          Pickup available
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Photo URLs</label>
        <div className="space-y-2">
          {photoFields.map((field, idx) => (
            <div key={field.id} className="flex gap-2">
              <input
                {...register(`photo_urls.${idx}.url`)}
                placeholder="https://…"
                className={`flex-1 ${inputCls(!!errors.photo_urls?.[idx]?.url)}`}
              />
              <button
                type="button"
                onClick={() => removePhoto(idx)}
                className="shrink-0 text-gray-400 hover:text-red-500 p-1"
                aria-label="Remove URL"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => appendPhoto({ url: '' })}
            className="text-xs text-indigo-600 hover:underline"
          >
            + Add photo URL
          </button>
        </div>
      </div>
    </form>
  )
}
