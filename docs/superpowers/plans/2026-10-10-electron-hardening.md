# Electron Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Neither a crafted import file nor a tampered copy of the app can run code: sandboxed renderer, no navigation or new windows, no permissions, IPC only from the app's own page, strict CSP in the packaged app, Electron fuses.

**Architecture:** Pure URL rules and the strict CSP live in Electron-free modules (unit-tested); a small main-process module wires them into Electron's events and the IPC wrapper; a Vite plugin swaps in the strict CSP at build time; electron-builder writes the fuses. A new smoke step opens the real window offscreen and attacks it.

**Tech Stack:** Electron 43, electron-vite 5, electron-builder 26 (`electronFuses`), `@electron/fuses` 1.8 (read-back), `resedit` (Windows resource read), vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-electron-hardening-design.md` (approved 2026-10-10).

## Global Constraints

- Branch `v2`, local commits; push only when the user asks. Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never stage `.preview/vite.config.ts`, the Huawei `.txt` files, `.claude/`, `.superpowers/`.
- Gate per commit: `npm run typecheck`, `npx vitest run`, `npm run smoke`; then `cp .superpowers/app_state.original.json app_state.json` and delete `/tmp/qos-smoke-*`, `/tmp/qos-userdata-*`.
- Strict CSP, verbatim: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`
- Rejected-call message, verbatim: `Untrusted sender`.
- Fuses: `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `onlyLoadAppFromAsar: true`, `enableEmbeddedAsarIntegrityValidation: true` (Windows only if Task 4's check passes).
- Dev mode and `npm run preview:web` keep today's CSP from `src/renderer/index.html`.

## Review Focus

1. **Export downloads** (`<a download href="blob:…">`) must still download under the navigation guard. Test in Task 2 (smoke: a blob download fires `will-download`).
2. **A file dropped outside the import drop zone** must not navigate the window to `file:///…/data.csv`. Test in Task 1 (`allowNavigation` rejects another `file://` path) and Task 2 (smoke: navigating to another `file://` URL leaves the page).
3. **The report-to-PDF window** (main process loads a `data:` page into a sandboxed window) must still load with the guards active. Test in Task 2 (smoke: a sandboxed window loads a `data:` page from the main process).
4. **In-app routes and reloads** (same `index.html` with a `#hash` or `?query`) must not be blocked. Test in Task 1 (`isAppUrl` accepts them).
5. **An untrusted caller gets an error, not a hang**, and normal calls keep working after it. Test in Task 3 (smoke: the untrusted call rejects with `Untrusted sender`, then an app-page call succeeds).

---

### Task 1: Pure rules and the strict CSP

**Files:**
- Create: `src/main/securityRules.ts` (no `electron` import), `shared/csp.ts`
- Test: `tests/security/securityRules.test.ts`, `tests/security/csp.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/main/securityRules.ts
  export type AppEntry = { kind: 'file'; url: string } | { kind: 'dev'; origin: string }
  export function isAppUrl(url: string, entry: AppEntry): boolean
  export function isTrustedSender(sender: { url: string; isMainFrame: boolean }, entry: AppEntry): boolean
  export function allowNavigation(target: string, entry: AppEntry): boolean
  // shared/csp.ts
  export const STRICT_CSP: string            // the Global Constraints string
  export function applyStrictCsp(html: string): string   // replaces the CSP meta content; throws if no CSP meta
  ```

- [ ] **Step 1: Failing tests.**
  - `isAppUrl` with `entry = { kind: 'file', url: 'file:///opt/QoS/resources/app.asar/out/renderer/index.html' }`. True for the entry itself and for `…/index.html#/overview` and `…/index.html?x=1` (Review Focus 4). False for:
    - `…/renderer/other.html`
    - `…/renderer/index.html.evil`
    - `file:///home/u/data.csv` (Review Focus 2)
    - `https://example.com`
    - `data:text/html,x`, `blob:file:///abc`, `about:blank`
    - a non-URL string
  - `isAppUrl` with `entry = { kind: 'dev', origin: 'http://localhost:5173' }`. True for `http://localhost:5173/` and `http://localhost:5173/src/x.tsx`. False for `http://localhost:5174/`, `http://localhost.evil.com:5173/` and `https://localhost:5173/`.
  - `isTrustedSender`: true only when `isMainFrame` is true and `isAppUrl` is true. An app URL with `isMainFrame: false` is false.
  - `allowNavigation` agrees with `isAppUrl` for every case above.
  - `STRICT_CSP` equals the verbatim string. Its `script-src` directive contains neither `'unsafe-inline'` nor `'unsafe-eval'`, and it contains `connect-src 'none'` and `default-src 'none'`.
  - `applyStrictCsp`: given today's `src/renderer/index.html` (read from disk), the result's CSP meta content equals `STRICT_CSP` and the rest of the file is unchanged. Given HTML without a CSP meta, it throws.
- [ ] **Step 2: Run** `npx vitest run tests/security` → FAIL (modules missing).
- [ ] **Step 3: Implement.** Parse with `new URL()` (an invalid URL → false). File entries compare `protocol + pathname` (decoded) exactly, ignoring `search`/`hash`. Dev entries compare `origin`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Gate and commit** — `feat(security): URL rules and the strict CSP`.

### Task 2: Sandbox, navigation/window guard, permissions, CSP at build

**Files:**
- Create: `src/main/security.ts`, `src/main/window.ts`, `src/main/smokeSecurity.ts`
- Modify: `src/main/index.ts` (use `createMainWindow`, call `applySecurity` before it), `electron.vite.config.ts` (renderer plugin `{ name: 'strict-csp', apply: 'build', transformIndexHtml: applyStrictCsp }`), `src/main/smoke.ts` (call `runSecuritySmoke()` before the `SMOKE_OK` line; add `securityGuards: true` to the result object)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  // src/main/security.ts
  export function appEntry(): AppEntry          // dev: origin of ELECTRON_RENDERER_URL; else file URL of join(__dirname, '../renderer/index.html')
  export function applySecurity(): void         // idempotent: web-contents-created guards + session permission handlers
  export function assertTrustedSender(e: Electron.IpcMainInvokeEvent, channel: string): void  // throws Error('Untrusted sender')
  // src/main/window.ts
  export function createMainWindow(opts?: { show?: boolean; offscreen?: boolean }): BrowserWindow  // sandbox: true, contextIsolation: true, nodeIntegration: false, same preload; loads appEntry()
  // src/main/smokeSecurity.ts
  export async function runSecuritySmoke(): Promise<void>   // throws with a named check on failure
  ```

- [ ] **Step 1: Failing smoke checks** in `runSecuritySmoke()`. Call `applySecurity()`, then open `createMainWindow({ show: false, offscreen: true })` and wait for `did-finish-load`. Each check throws with its name:
  - `webContents.getLastWebPreferences().sandbox === true`
  - in the page, `window.open('https://example.com')` returns `null`
  - `location.href = 'https://example.com'`, then 1 s later `webContents.getURL()` is still the app page; same for `file:///etc/hostname` (Review Focus 2)
  - in the page, `Notification.requestPermission()` resolves `'denied'`
  - the CSP meta content equals `STRICT_CSP`, and `[...document.scripts].every((s) => s.src)` is true
  - in the page, append `<script>window.__inl = 1</script>`; after 200 ms, `window.__inl` is `undefined`
  - in the page, click an `<a download="t.txt">` whose `href` is a blob URL; `session.defaultSession` sees `will-download` within 2 s (cancel the item) (Review Focus 1)
  - a second window `new BrowserWindow({ show: false, webPreferences: { sandbox: true, offscreen: true } })` loads `data:text/html,<p>r</p>` from the main process and fires `did-finish-load` (Review Focus 3)

  Close both windows at the end.
- [ ] **Step 2: Run** `npm run smoke` → `SMOKE_FAILED`. The first check that fails is `sandbox` (today's window is `sandbox: false`), or the module is missing.
- [ ] **Step 3: Implement** `security.ts`, `window.ts`, the Vite plugin, and the `index.ts` / `smoke.ts` wiring. Guards per spec §4.1:
  - `setWindowOpenHandler` → `{ action: 'deny' }`
  - `will-navigate` / `will-redirect` → `preventDefault()` unless `allowNavigation`, logging the target
  - `will-attach-webview` → `preventDefault()`
  - `setPermissionRequestHandler((_wc, _p, cb) => cb(false))`
  - `setPermissionCheckHandler(() => false)`
- [ ] **Step 4: Run** `npm run smoke` → `Smoke test completed successfully` with `securityGuards: true`.
- [ ] **Step 5: Browser-preview sweep** (dev CSP). `npm run preview:web`; visit every sidebar screen in the 2G, 3G and 4G demo workspaces; expect no console errors, the same as the 10/10/2026 sweep.
- [ ] **Step 6: Gate and commit** — `feat(security): sandboxed window, no navigation or new windows, no permissions, strict CSP in builds`.

### Task 3: IPC sender check

**Files:**
- Modify: `src/main/ipc.ts`, `src/main/smokeSecurity.ts`, `src/main/smoke.ts`
- Test: `tests/security/ipcWrapper.test.ts`

**Interfaces:**
- Consumes: `assertTrustedSender` (Task 2).
- Produces: in `ipc.ts`, a local `handle(channel: string, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown): void` that calls `assertTrustedSender(e, channel)` before `fn`. It is the only place `ipcMain.handle` is called.

- [ ] **Step 1: Failing tests.**
  - Unit (source scan): `src/main/ipc.ts` contains exactly one `ipcMain.handle(` (inside `handle`), and no other file under `src/main` calls `ipcMain.handle(` or `ipcMain.on(`.
  - Smoke, in `runSecuritySmoke()`: call `registerIpc(() => win)` first, if not already registered in this process.
    - From the app window, `window.api.appState.get()` resolves to an object with `recentWorkspaces`.
    - A third window loads the same preload (`sandbox: true`) on `data:text/html,<p>x</p>`. From it, `window.api.appState.get()` rejects with a message containing `Untrusted sender`.
    - The app window's call succeeds again afterwards (Review Focus 5).
- [ ] **Step 2: Run** the unit test and `npm run smoke` → FAIL (74 direct `ipcMain.handle` calls; the untrusted call resolves).
- [ ] **Step 3: Implement.** Replace every `ipcMain.handle(` in `ipc.ts` with `handle(`. `assertTrustedSender` uses `e.senderFrame`: a missing frame is untrusted; a main frame means `e.senderFrame === e.sender.mainFrame`. It logs `[security] rejected <channel> from <url>`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Gate and commit** — `feat(security): IPC answers only the app's own page`.

### Task 4: Fuses

**Files:**
- Modify: `package.json` (`build.electronFuses`), `scripts/check-package-layout.cjs` (fuse read-back)
- Create: `scripts/check-win-integrity.cjs`

**Interfaces:**
- Produces:
  - `checkFuses(binaryPath: string, expected: Record<string, boolean>): string[]` in `scripts/check-package-layout.cjs`. It uses `@electron/fuses` `getCurrentFuseWire` and returns the mismatches. `smoke-packaged.cjs` fails on any mismatch.
  - `scripts/check-win-integrity.cjs <win-unpacked dir>`. It exits 0 when the exe's `INTEGRITY`/`ELECTRONASAR` resource (read with `resedit`) lists `resources\app.asar` with a SHA-256 equal to the hash of `resources/app.asar`'s header (`@electron/asar` `getRawHeader(...).headerString`). Otherwise it exits 1 and says why.

- [ ] **Step 1: Failing checks.**
  - Wire `checkFuses` into `smoke-packaged.cjs` with the Global Constraints values.
  - Run `npm run verify:packaged` → fails, because the fuses are at Electron's defaults (`runAsNode` on).
- [ ] **Step 2: Windows integrity decision.**
  - Run `npm run dist:portable`, then `node scripts/check-win-integrity.cjs release/win-unpacked`.
  - **Exit 0:** the fuse is on for all platforms.
  - **Exit 1:** set `enableEmbeddedAsarIntegrityValidation` off for Windows only (`build.win` override if electron-builder supports per-platform fuses, else off everywhere) and record the reason in the ledger. It then belongs to the code-signing work.
- [ ] **Step 3: Implement** `build.electronFuses` per Global Constraints (and Step 2's result).
- [ ] **Step 4: Run** `npm run verify:packaged` → the packaged smoke passes with no fuse mismatches. Then `npm run dist:portable` and `check-win-integrity` → exit 0 (if the fuse is on for Windows). Then confirm `getCurrentFuseWire` on `release/win-unpacked/*.exe` matches.
- [ ] **Step 5: Gate and commit** — `build(security): Electron fuses`.

### Task 5: Docs

- [ ] README: a "Security" subsection under "Workspaces and data safety". It covers the sandboxed window, no navigation or outside content, IPC limited to the app page, the strict CSP in builds, and the fuses (with the Windows integrity status from Task 4). Set the spec's Status to Implemented. Gate, then commit `docs(security): what the app locks down`.

---

## Spec coverage

| Spec | Task |
|---|---|
| §4.1 sandbox, windows, navigation, webview, permissions | 2 |
| §4.1 IPC sender check | 3 |
| §4.2 pure rules | 1 |
| §4.3 CSP | 1 (constant, plugin function), 2 (plugin wired, smoke) |
| §4.4 fuses | 4 |
| §5 README | 5 |
| §6 tests 1–6 | 1 (1), 2 (2, 3, 6), 3 (2), 4 (4, 5) |
