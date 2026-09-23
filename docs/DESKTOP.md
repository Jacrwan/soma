# Soma for Mac — what it takes

Goal: an app that behaves like VS Code or Apple Music. Installed, in the
Dock, its own window, real menus and shortcuts, usable without a connection,
and not obviously a web page in a frame.

## What "a real app" actually means here

VS Code is Electron: TypeScript and HTML running in bundled Chromium. The
technology is not what makes it feel native. These are:

- **It ships its own copy.** No blank window when the network is slow.
- **Native chrome.** Its own menu bar, ⌘, ⌘W, ⌘Q, Preferences, window state
  remembered between launches.
- **It is signed.** No Gatekeeper warning on first open.
- **It updates itself** without the user visiting a website.

A window pointed at somastudy.app has none of these. We are not building that.

## Shape

**Electron**, bundling the built SPA. Same choice VS Code made, and the one
with a working notarization and auto-update path (`electron-builder`).
Tauri is smaller — a 6 MB installer against ~100 MB — but adds a Rust
toolchain to maintain and a fiddlier signing story. Revisit if size matters
more than it does today.

The renderer loads the local build. Supabase, the Vercel API routes and
Stripe are reached over the network exactly as they are in the browser, so
there is one codebase and no second backend.

## Prerequisite that cannot be worked around

**An Apple Developer Program membership, $99/year.** Without it macOS refuses
to open the app normally: the user sees "Soma cannot be opened because the
developer cannot be verified" and has to right-click → Open, or approve it in
System Settings. For a paid product that is not acceptable.

It gives:
- A **Developer ID Application** certificate, to sign the app.
- Notarization — Apple scans the build and issues a ticket stapled to the
  `.dmg`, which is what stops the warning.

Nothing else on this page can be finished without it.

## Work, in order

1. **Shell.** `electron/main.ts` (window, menus, lifecycle) and a preload
   script. `contextIsolation: true`, `nodeIntegration: false`; the renderer
   is web code and gets no Node.
2. **Routing.** The app uses `react-router`'s browser history. Under
   `file://` that breaks, so either serve the bundle from a tiny internal
   handler or switch the desktop build to hash history. Decide before
   packaging; it affects every deep link.
3. **Auth.** Supabase sessions live in `localStorage`, which persists per
   Electron `userData` directory — fine. Google Calendar OAuth returns to a
   `https://` callback, so the desktop app must register a custom scheme
   (`soma://`) and hand the code back, or open the system browser and catch
   the return. This is the fiddliest part.
4. **Payments.** Stripe checkout opens in the system browser, never in-app.
   App Store rules do not apply — we are not shipping there — but an embedded
   card form in an Electron window is a bad idea regardless.
5. **Offline.** Decide what works with no connection. The plan and timer are
   already mirrored to `localStorage`; Canvas sync and AI are not and should
   fail clearly rather than hang.
6. **Signing and notarization.** `electron-builder` with
   `CSC_LINK` / `CSC_KEY_PASSWORD` and an app-specific password or API key
   for `notarytool`. Runs on a Mac; secrets never enter the repo.
7. **Updates.** `electron-updater` against a static feed. A GitHub release or
   a Vercel-hosted `latest-mac.yml` both work.
8. **Icon and identity.** `.icns` at every required size, bundle id
   (`app.somastudy.desktop`), category, copyright.

## Version

`package.json` `version` is the single source: the web build stamps it into
`__APP_VERSION__` (bug reports carry it) and the desktop build uses the same
number. Bump it there and nowhere else.

## Not decided yet

- Whether the window remembers per-page state or always opens on the
  dashboard.
- Whether the menu bar gets Soma-specific items (Start focus, New block) or
  only the standard set.
- Windows. Nothing here is Mac-only except signing, but nobody has asked.
