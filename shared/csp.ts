/** The packaged app's Content Security Policy (Electron hardening spec §4.3):
 *  no inline, eval or remote scripts, and no connections — the page talks to
 *  the app only through IPC. Inline styles stay allowed (React style props and
 *  the charts set them; styles cannot run code). Dev mode and the browser
 *  preview keep the relaxed policy in src/renderer/index.html, which hot
 *  reload needs; the renderer build swaps this one in (electron.vite.config.ts). */
export const STRICT_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'"
].join('; ')

const CSP_META = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/

/** Replace the CSP meta tag's policy with STRICT_CSP. Throws when the page has
 *  no such tag, so a build never ships without a policy. */
export function applyStrictCsp(html: string): string {
  if (!CSP_META.test(html)) throw new Error('index.html has no Content-Security-Policy meta tag')
  return html.replace(CSP_META, `$1${STRICT_CSP}$2`)
}
