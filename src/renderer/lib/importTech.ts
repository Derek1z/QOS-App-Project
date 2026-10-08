import type { Technology } from '../../../shared/api'

/** A file of another technology is stopped before import (spec §4.5). No
 *  block when detection is unsure (null) or the user chose "Import anyway"
 *  for that file. */
export function importTechBlock(
  detected: Technology | null | undefined,
  workspaceTech: Technology,
  overridden: boolean
): { blocked: boolean; message: string | null } {
  if (!detected || detected === workspaceTech || overridden) return { blocked: false, message: null }
  return { blocked: true, message: `This file looks like ${detected}; this is a ${workspaceTech} workspace.` }
}
