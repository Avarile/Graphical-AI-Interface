# Next.js migration

The page is now a Next.js 15 app (App Router, React 19, TypeScript). This
describes what moved where, what changed behaviourally, and what has not been
run yet.

## Running it

Node is not installed on this machine — nothing below has been executed.

```
# once Node 20+ (LTS) is on PATH:
npm install
npm run dev          # http://localhost:3000
npm run typecheck    # tsc --noEmit — run this first, see "Unverified" below
```

`serve.ps1` is no longer used. `npm run dev` replaces it.

## Where everything went

| Before | After |
| --- | --- |
| `digital-system-core.html` — markup | `app/page.tsx`, `app/layout.tsx`, `components/Hud.tsx` |
| `digital-system-core.html` — `<style>` | `app/globals.css` |
| `digital-system-core.html` — scene code | `lib/scene/core-scene.ts` |
| `digital-system-core.html` — panel code | `components/ModulePanel.tsx`, `ModuleList.tsx`, `module-form/` |
| `digital-system-core.html` — console API | `components/MainframeApp.tsx` |
| `modules-store.js` | `lib/modules-store.ts` |
| `three-d-stage.js` | `lib/scene/stage.ts` |
| `serve.ps1` | `app/api/modules/route.ts` |
| `_ds/` | `public/_ds/` |
| importmap + SRI hashes | `package.json` + lockfile |

`STATUS` was inline in the page; it is `lib/status.ts` now, because the server
needs it too (see below).

## The two decisions worth knowing about

**The scene stayed imperative.** `mount()`, `unmount()` and `replaceModule()`
exist because rebuilding the stack for a single edit is what made every other
strip jump. A declarative renderer diffing a module list into a scene graph
would throw that away and take every strip's spin phase with it. So
`CoreScene` is a class React drives, `runtime[]` (each strip's live rotation,
written 60×/second) never touches React state, and only the panel became
components.

**The form controls are uncontrolled.** React's `onChange` is the DOM's `input`
event — it fires per keystroke. The original bound the native `change` event,
which for a text field fires on blur. Committing per keystroke would re-geometry
the strip on every character, and `0.0` would be refused as out of range on its
way to `0.05`. `ModuleForm` attaches one delegated native `change` listener; the
controls expose `read()` functions instead of holding state. There is a longer
note in `components/module-form/controls.tsx`.

## What the migration bought

`serve.ps1:69-72` said the full schema lived in `modules-store.js` and that
restating it server-side "would only give it somewhere to drift" — so its
PowerShell copy was deliberately shallow, checking only enough that the page
would start.

`app/api/modules/route.ts` imports `verify()` instead. It is the same function
the panel calls before it will save, so the server now enforces the *whole*
schema — ranges, colour formats, tag types, status enum — rather than a
hand-copied subset. `Get-ModuleDocError` and `Test-Number` have no successors
because they no longer have anything to do.

The route also writes through a temp file and renames it, so a crash mid-write
leaves the previous `modules.json` intact instead of a truncated one.

## Behaviour changes

1. **The "Scanner view" checkbox now works.** It was dead markup: `#f-scanner`
   was declared at `digital-system-core.html:458` and no script ever read it, so
   ticking it did nothing. It is wired to `CoreScene.setScannerVisible()`. Revert
   by dropping the `<label className="toggle">` block in `ModulePanel.tsx`.

2. **The stage's "three.js failed to load" panel is gone.** It existed to catch a
   misconfigured import map. three.js is bundled now, so that failure is a build
   error rather than a runtime one.

3. **`#mod-form` is `display: block`, not `display: none`.** The page kept one
   form in the document and toggled its visibility; the form is mounted only
   while a module is picked now.

Everything else is intended to behave identically, including the drawer's
hover/focus close delay, the lock backstop, the skipped-entry save confirmation,
the `beforeunload` guard, the lifecycle animations, and the console API
(`listModules`, `getModule`, `setStatus`, `setField`, `pinPhase`, `saveToFile`,
`reloadModules`).

Two things were carried over unchanged that are arguably bugs, because fixing
them would be a visual change rather than a port:

- `.hud .eyebrow { font-size: 18 }` has no unit, so the browser drops the
  declaration and the heading keeps its default size (`app/globals.css`).
- `.hud h1` is styled but no `<h1>` is rendered.

## Deploying — read this before you push

`PUT /api/modules` writes to the filesystem. **Serverless hosts including Vercel
have a read-only filesystem, so saving will fail in production.** This is not a
bug you can configure away; it is what the platform is.

It degrades gracefully rather than losing work: the route answers `503`, and
`MainframeApp` falls back to `download(modules)` — the same fallback the page
already had for `file://` — so the user gets a `modules.json` to commit by hand.
The status line says so.

If you want saving to work on a deployed instance, the module list has to live
somewhere writable. In rough order of effort: Vercel Blob or S3 (swap the two
`fs` calls in the route), a KV store, or Postgres. Nothing outside
`app/api/modules/route.ts` needs to change — `lib/modules-store.ts` only knows
that it does a `GET` and a `PUT`.

Reading works fine when deployed; `next.config.mjs` names `modules.json` in
`outputFileTracingIncludes` so it is packaged with the route.

## Unverified

**None of this has been run.** There is no Node on this machine, so nothing was
compiled, no types were checked, no page was rendered. Treat the first
`npm run typecheck` as part of the migration rather than a formality — expect to
fix things, most likely around `@types/three` and the React 19 types.

What *was* checked, statically:

- `lib/modules-store.ts` against `modules-store.js`: the `SPEC` block is
  byte-identical (60 lines, empty diff), `isNum()` is identical apart from its
  type annotation, and all 16 validation message strings match exactly. The
  public API is unchanged apart from two added helpers (`isGroup`,
  `groupFields`) that the union type needs. This mattered more than the rest:
  `isNum()` checks the *type* before parsing because `+null`, `+''` and `+[]`
  are all `0` — a bare `Number.isFinite(+v)` reads a cleared field back as a
  legitimate `0` and silently relocates the module.
- Every `@/…` import resolves to a file that exists.
- No references survive to `three/addons/…`, `customElements`, `attachShadow`,
  or the old `stage._scene` / `_ground` / `_camera` private fields.

Worth exercising by hand once it runs: add a module, edit a field on a locked
module, rename to a colliding id, delete (the fade-then-splice path), save,
reload, and `pinPhase` from the console.

## Superseded files

Still present, no longer referenced by anything:

```
digital-system-core.html   modules-store.js   three-d-stage.js   serve.ps1
```

They are untracked in git, so they were left in place rather than deleted —
delete them once the port is confirmed working. `modules.json`, `screenshots/`,
`uploads/` and `.thumbnail` are untouched.
