/** KPI Targets tab validation (modules/TargetsModal.tsx, fix wave 2026-09-30
 *  item 4). A non-empty target/warning/critical field that does not parse as
 *  a finite number ("97,5" -> NaN) must stop the save with a message naming
 *  the KPI and the field, instead of silently sending NaN to the main
 *  process or bouncing off a raw SQL error. */

export interface EditedTargetFields {
  target: string
  warningThreshold: string
  criticalThreshold: string
}

const FIELD_LABELS: Array<[keyof EditedTargetFields, string]> = [
  ['target', 'Target'],
  ['warningThreshold', 'Warning Threshold'],
  ['criticalThreshold', 'Critical Threshold']
]

/** First invalid field for `label`, or null when every non-empty field is a
 *  finite number. */
export function targetInputProblem(label: string, edited: EditedTargetFields): string | null {
  for (const [key, fieldLabel] of FIELD_LABELS) {
    const raw = edited[key].trim()
    if (raw !== '' && !Number.isFinite(Number(raw))) {
      return `${label}: ${fieldLabel} "${edited[key]}" is not a number`
    }
  }
  return null
}
