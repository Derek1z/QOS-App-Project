# Electron Hardening Design

**Date**: 2026-10-10
**Status**: Implemented (2026-10-10)
**Scope**: renderer sandbox, navigation and new-window guard, permission denial, IPC sender check, strict Content Security Policy for the packaged app, Electron fuses (Phase 2 of the remediation plan)

---

## 1. Goal

The portable exe is shared with colleagues, who import files from network systems and email (decided 2026-10-10). Neither a crafted import file nor a tampered copy of the app should be able to run code on their machines. The app's features stay as they are.

## 2. What happens today

| Area | Today | Where |
|---|---|---|
| Context isolation / Node integration | `contextIsolation: true`, `nodeIntegration: false` | `src/main/index.ts` `createWindow` |
| Renderer sandbox | `sandbox: false` on the main window (the report-to-PDF window is already sandboxed) | `src/main/index.ts`, `src/main/services/reportingService.ts` |
| New windows / navigation | no `setWindowOpenHandler`, no `will-navigate` guard | — |
| Permissions | Electron default (granted) | — |
| IPC | 74 `ipcMain.handle` channels, no sender check | `src/main/ipc.ts` |
| CSP | one static meta tag shared by dev and the packaged app: `script-src 'self' 'unsafe-inline'`, `connect-src 'self' ws://localhost:*` | `src/renderer/index.html` |
| Fuses | none set | `package.json` `build` |

Facts that shape the design (checked 2026-10-10):
- The preload is one CommonJS bundle that only loads `electron` (`contextBridge`, `ipcRenderer`, `webUtils`), which a sandboxed preload supports.
- The app opens no outside URLs, loads no remote scripts or fonts, and uses no clipboard, notification, media, location or fullscreen API.
- The built `index.html` has one external module script and no inline script; the CSS uses only `data:` images.
- The production bundle creates no web workers and fetches nothing over the network; it uses `blob:` URLs only to download exports.
- Nothing uses `ELECTRON_RUN_AS_NODE` or `NODE_OPTIONS`.
- The smoke test drives the backend headlessly and never opens the app window.
- The Windows build has `signAndEditExecutable: false`, so whether electron-builder embeds the archive-integrity record in the exe is unverified.

## 3. Decisions (2026-10-10)

| Topic | Decision |
|---|---|
| Who runs the app | Shared with colleagues; import files come from network systems and email |
| Scope | The core four (sandbox, navigation/new-window guard, strict CSP, permission denial), the IPC sender check, Electron fuses. Code signing is later (needs a certificate) |
| Approach | Harden in place, still loading from `file://` (approach A). A custom `app://` protocol (approach B) is a possible later step once Windows is verified |

## 4. Behaviour

### 4.1 Runtime guards — `src/main/security.ts`
Applied once at startup, before the first window opens.

| Guard | Rule |
|---|---|
| Sandbox | The main window gets `sandbox: true`. The preload API is unchanged. |
| New windows | `setWindowOpenHandler` returns `deny` for every web contents (`app.on('web-contents-created')`), including the report-to-PDF window. |
| Navigation | `will-navigate` and `will-redirect` are prevented unless the target is the app's own entry page (§4.2). Blocked attempts are logged with the target URL. |
| `<webview>` | `will-attach-webview` is prevented. |
| Permissions | `session.defaultSession.setPermissionRequestHandler` answers `false` and `setPermissionCheckHandler` returns `false` for every permission. A future feature that needs one adds it explicitly. |
| IPC sender check | Every channel in `ipc.ts` is registered through one wrapper. A request is handled only when its sender frame is a main frame (no parent) whose URL is the app's own page (§4.2); otherwise the call rejects with `Untrusted sender` and the channel and URL are logged. |

Not affected: downloads from the page (`<a download href="blob:…">` exports) are downloads, not navigations. The report window's `data:` page is loaded by the main process, so the navigation guard does not apply to it.

### 4.2 The app's own page (pure functions)
URL decisions live in pure functions so they are testable without Electron:
- `appEntry`: packaged → the `file://` URL of `out/renderer/index.html` (inside `app.asar` when packaged); dev → the origin of `ELECTRON_RENDERER_URL`.
- `isAppUrl(url, appEntry)`: packaged → same file path as the entry (query and hash ignored); dev → same origin. Lookalikes are rejected: another file in the same folder, a path that merely starts with the entry path, `http(s)` to another host, `data:`, `blob:`, `about:blank`.
- `isTrustedSender({ url, isMainFrame }, appEntry)`: `isMainFrame && isAppUrl(url, appEntry)`.
- `allowNavigation(target, appEntry)`: `isAppUrl(target, appEntry)`.

### 4.3 Content Security Policy
Set per build by a Vite plugin (`apply: 'build'`) that replaces the `content` of the CSP meta tag in `index.html`:
- Packaged app (strict), exported as one constant so tests read the same string:
  `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`
- Dev mode and the browser preview (`npm run preview:web`): today's relaxed policy, which hot reload needs.

`style-src 'unsafe-inline'` stays because React `style` props and the chart library set inline styles; styles cannot run code.

### 4.4 Fuses
Set in `package.json` → `build.electronFuses`, written into the binary by electron-builder:

| Fuse | Value |
|---|---|
| `runAsNode` | `false` |
| `enableNodeOptionsEnvironmentVariable` | `false` |
| `enableNodeCliInspectArguments` | `false` |
| `onlyLoadAppFromAsar` | `true` |
| `enableEmbeddedAsarIntegrityValidation` | `true` for Linux; for Windows only if §6 item 5 confirms the integrity record is embedded in the exe, otherwise `false` with the reason in the plan ledger (it then belongs to the code-signing work) |

Implementation notes (2026-10-10): the Windows record was confirmed, so the fuse is on everywhere; Electron enforces it on Windows and macOS only (on Linux it has no effect). The check covers `app.asar` only, so `asarUnpack` keeps only native binaries (`*.node`, `*.so`, `*.dll`) outside the archive. Without code signing, whoever can rewrite the exe can also rewrite its fuses and integrity record.

## 5. Consumers

| Where | Change |
|---|---|
| `src/main/security.ts` (new) | §4.1 wiring, §4.2 pure functions |
| `src/main/index.ts` | `sandbox: true`; apply the guards before `createWindow`; `createWindow` callable from smoke |
| `src/main/ipc.ts` | register every channel through the sender-checked wrapper |
| `electron.vite.config.ts` | strict-CSP plugin on the renderer build |
| `src/renderer/index.html` | unchanged dev CSP (the build replaces it) |
| `package.json` | `build.electronFuses` |
| `src/main/smoke.ts` | window-level checks (§6 item 2) |
| `scripts/smoke-packaged.cjs` or `scripts/check-package-layout.cjs` | read fuses back from the packaged binary |
| `README.md` | a short security note |

## 6. Testing
Written before the code.

1. Unit (vitest): `isAppUrl`, `isTrustedSender`, `allowNavigation` for packaged and dev entries, including every lookalike in §4.2; the strict CSP constant has no `'unsafe-inline'` or `'unsafe-eval'` in `script-src`, has `connect-src 'none'` and `default-src 'none'`.
2. Smoke (real Electron): open the real main window offscreen from the built page and check that the window is sandboxed; `window.open` returns no window; navigating to `https://example.com` leaves the URL on the app page; a permission request (`Notification.requestPermission()`) resolves `denied`; an injected inline `<script>` does not run; the page's CSP meta equals the strict constant; an `api` call from the app page succeeds; the same call from a second window that loads the preload on a `data:` page rejects with `Untrusted sender`.
3. Build check: the built `out/renderer/index.html` carries the strict CSP and no inline script.
4. Packaged (Linux, `npm run verify:packaged`): the fuses read back from the binary equal §4.4, and the packaged app still passes its smoke.
5. Windows exe: check whether the archive-integrity record is embedded in `release/win-unpacked/*.exe`; it decides the Windows value of `enableEmbeddedAsarIntegrityValidation`.
6. Regression: `typecheck && vitest && smoke` for every commit (with `app_state.json` restored afterwards), and a browser-preview sweep of every screen (dev CSP).

## 7. Out of scope
- Serving the app from a custom `app://` protocol (approach B).
- Code signing.
- Verifying the Windows exe on Windows (on hold with the user).
