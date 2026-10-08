import type { Technology } from '../../../shared/api'

/** What a 2G/3G/4G button does (spec §4.2). A workspace's technology is
 *  fixed, so choosing another technology means another workspace. */
export type SwitchPlan =
  | { kind: 'none' }
  | { kind: 'open'; path: string }
  | { kind: 'offerCreate'; technology: Technology }

/** `found` is the most recent existing workspace of `target` other than the
 *  open one (workspace.findRecent). */
export function planTechSwitch(
  target: Technology,
  current: { technology: Technology; path: string } | null,
  found: string | null
): SwitchPlan {
  if (current && current.technology === target) return { kind: 'none' }
  if (found) return { kind: 'open', path: found }
  return { kind: 'offerCreate', technology: target }
}
