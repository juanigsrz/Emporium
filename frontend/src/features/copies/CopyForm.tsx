import { useEffect, useMemo } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useGameVersions } from '../../api/games'

const CONDITION_VALUES = ['NEW', 'LIKE_NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'POOR'] as const
const SLEEVED_VALUES = ['UNKNOWN', 'NONE', 'SLEEVED'] as const

// version_sel: "" = untouched (fails required); "UNKNOWN" = explicit Unknown; "<id>" = a real version.
const makeCopyFormSchema = (t: TFunction) =>
  z.object({
    version_sel: z.string().min(1, t('copies.errors.selectEdition')),
    condition: z.enum(CONDITION_VALUES, { error: t('copies.errors.conditionRequired') }),
    sleeved: z.enum(SLEEVED_VALUES).optional(),
    includes_expansions: z.string().optional(),
    missing_components: z.string().optional(),
    upgraded_components: z.string().optional(),
    component_notes: z.string().optional(),
    owner_notes: z.string().optional(),
    trade_value_hint: z.string().max(120, t('copies.errors.tradeHintTooLong')).optional(),
    shipping_constraints: z.string().optional(),
    pickup_available: z.boolean().optional(),
    photo_urls: z
      .array(z.object({ url: z.string().url(t('copies.errors.invalidUrl')).or(z.literal('')) }))
      .optional(),
  })
export type CopyFormValues = z.infer<ReturnType<typeof makeCopyFormSchema>>

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
  const { t } = useTranslation()
  const { data: versions = [], isLoading: versionsLoading } = useGameVersions(boardGameId)
  const copyFormSchema = useMemo(() => makeCopyFormSchema(t), [t])

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
    `w-full rounded-xl border-2 bg-parchment px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-2 focus:ring-sage ${
      hasErr ? 'border-red-400' : 'border-ink/15'
    }`

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-4">
      {serverError && (
        <div className="rounded-xl bg-red-50 border-2 border-red-200 px-3 py-2 text-sm font-medium text-red-700">
          {serverError}
        </div>
      )}

      {/* Version (Edition) — required */}
      <div>
        <label className="block text-sm font-semibold text-ink mb-1">
          {t('copies.form.edition')} <span className="text-red-500">*</span>
        </label>
        <select {...register('version_sel')} className={inputCls(!!errors.version_sel)} disabled={versionsLoading}>
          <option value="" disabled>{versionsLoading ? t('copies.form.loadingEditions') : t('copies.form.selectEdition')}</option>
          <option value="UNKNOWN">{t('copies.form.unknownEdition')}</option>
          {versions.map((v) => (
            <option key={v.id} value={String(v.id)}>
              {v.name}{v.language ? ` (${v.language})` : ''}{v.year_published ? ` ${v.year_published}` : ''}
            </option>
          ))}
        </select>
        {errors.version_sel && <p className="mt-1 text-xs text-red-600">{errors.version_sel.message}</p>}
        <p className="mt-1 text-xs text-moss">{t('copies.form.languagePrefix')} <span className="font-semibold text-ink">{derivedLanguage}</span> {t('copies.form.languageSuffix')}</p>
      </div>

      {/* Condition — required */}
      <div>
        <label className="block text-sm font-semibold text-ink mb-1">
          {t('copies.form.condition')} <span className="text-red-500">*</span>
        </label>
        <select {...register('condition')} className={inputCls(!!errors.condition)}>
          <option value="">{t('copies.form.selectCondition')}</option>
          {CONDITION_VALUES.map((v) => (<option key={v} value={v}>{t('copies.condition.' + v)}</option>))}
        </select>
        {errors.condition && <p className="mt-1 text-xs text-red-600">{errors.condition.message}</p>}
      </div>

      {/* Sleeved */}
      <div>
        <label className="block text-sm font-semibold text-ink mb-1">{t('copies.form.sleeved')}</label>
        <select {...register('sleeved')} className={inputCls(false)}>
          {SLEEVED_VALUES.map((v) => (
            <option key={v} value={v}>{t('copies.sleeved.' + v)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-semibold text-ink mb-1">{t('copies.form.includesExpansions')}</label>
        <input {...register('includes_expansions')} placeholder={t('copies.form.includesExpansionsPlaceholder')} className={inputCls(false)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-semibold text-ink mb-1">{t('copies.form.missingComponents')}</label>
          <input {...register('missing_components')} placeholder={t('copies.form.nonePlaceholder')} className={inputCls(false)} />
        </div>
        <div>
          <label className="block text-sm font-semibold text-ink mb-1">{t('copies.form.upgradedComponents')}</label>
          <input {...register('upgraded_components')} placeholder={t('copies.form.nonePlaceholder')} className={inputCls(false)} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-ink mb-1">{t('copies.form.componentNotes')}</label>
        <textarea {...register('component_notes')} rows={2} className={`${inputCls(false)} resize-none`} />
      </div>

      <div>
        <label className="block text-sm font-semibold text-ink mb-1">{t('copies.form.ownerNotes')}</label>
        <textarea {...register('owner_notes')} rows={2} className={`${inputCls(false)} resize-none`} />
      </div>

      <div>
        <label className="block text-sm font-semibold text-ink mb-1">{t('copies.form.tradeValueHint')}</label>
        <input {...register('trade_value_hint')} placeholder={t('copies.form.tradeValueHintPlaceholder')} className={inputCls(!!errors.trade_value_hint)} />
        {errors.trade_value_hint && (
          <p className="mt-1 text-xs text-red-600">{errors.trade_value_hint.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-semibold text-ink mb-1">{t('copies.form.shippingConstraints')}</label>
        <input {...register('shipping_constraints')} placeholder={t('copies.form.shippingConstraintsPlaceholder')} className={inputCls(false)} />
      </div>

      <div className="flex items-center gap-2">
        <input
          id={`${formId}-pickup`}
          type="checkbox"
          {...register('pickup_available')}
          className="h-4 w-4 rounded border-2 border-ink/30 accent-indigo-600 focus:ring-sage"
        />
        <label htmlFor={`${formId}-pickup`} className="text-sm font-semibold text-ink">
          {t('copies.form.pickupAvailable')}
        </label>
      </div>

      <div>
        <label className="block text-sm font-semibold text-ink mb-1">{t('copies.form.photoUrls')}</label>
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
                className="shrink-0 text-moss hover:text-red-500 p-1"
                aria-label={t('copies.form.removeUrlAriaLabel')}
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
            className="text-xs font-semibold text-ink underline decoration-coral decoration-2 underline-offset-2"
          >
            {t('copies.form.addPhotoUrl')}
          </button>
        </div>
      </div>
    </form>
  )
}
