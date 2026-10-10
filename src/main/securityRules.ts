/** What counts as the app's own page (Electron hardening spec §4.2). Pure:
 *  no `electron` import, so the rules are unit-tested; security.ts wires them
 *  into navigation events and the IPC sender check. */

/** Packaged: the file URL of the renderer's index.html. Dev: the dev server origin. */
export type AppEntry = { kind: 'file'; url: string } | { kind: 'dev'; origin: string }

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** The entry page itself (a route `#…` or query `?…` is the same page). */
export function isAppUrl(url: string, entry: AppEntry): boolean {
  const u = parse(url)
  if (!u) return false
  if (entry.kind === 'dev') return u.origin !== 'null' && u.origin === parse(entry.origin)?.origin
  const e = parse(entry.url)
  if (!e || u.protocol !== 'file:' || e.protocol !== 'file:') return false
  return decodeURIComponent(u.pathname) === decodeURIComponent(e.pathname) && u.host === e.host
}

/** IPC is answered only for the main frame (not an iframe) of the app page. */
export function isTrustedSender(sender: { url: string; isMainFrame: boolean }, entry: AppEntry): boolean {
  return sender.isMainFrame && isAppUrl(sender.url, entry)
}

/** The window may navigate only to the app page (reloads, in-app routes). */
export function allowNavigation(target: string, entry: AppEntry): boolean {
  return isAppUrl(target, entry)
}
