# Phase 0 Architecture Patch

## Problem

`ARCHITECTURE-IMPROVEMENTS.md` identifies low-risk cleanup that should land before deeper refactors:

- The repo has no committed domain glossary (`CONTEXT.md`), so future architecture work can drift on terms such as Group, Channel, Membership, and Direct Message.
- Root-level local prototype/scratch artifacts are still present in this workspace and can confuse agents, even though they are ignored by git.
- `middleware.ts` owns inline Supabase middleware cookie wiring instead of a named middleware factory seam.
- `app/(app)/dm/actions.ts` owns a local `DM_SELECT` string while channel message select strings already live in `lib/queries.ts`.

This spec is one small PR plus local workspace cleanup. It must not implement heavier architecture findings from later phases.

## Non-goals

- Do not change auth, profile setup, login/signup redirect behavior, invite return paths, or cookie semantics.
- Do not change Supabase environment variable names.
- Do not change direct-message query fields, notification behavior, conversation preview behavior, edit/delete/read behavior, or action return shapes.
- Do not introduce the Phase 1 auth wrapper, permission gate, side-effect wrapper, realtime abstraction, invite module, or component-query hook extractions.
- Do not audit RLS policies or migrations.
- Do not add dependencies.
- Do not treat ignored root artifacts as authoritative app code.

## User Experience / Behavior

- End users should see no behavior change.
- Auth middleware still:
  - refreshes the Supabase session before redirect logic;
  - redirects unauthenticated protected-route visitors to `/login?next=<current path>`;
  - redirects authenticated login/signup visitors to a safe `next` path or `/channels`;
  - redirects authenticated users without profiles to `/setup-profile?next=<current path>`;
  - preserves safe query strings on `next` paths;
  - rejects external or protocol-relative `next` paths.
- Direct messages still send, edit, delete, mark read, update conversation previews, and enqueue DM notifications the same way.
- Maintainers get a committed `CONTEXT.md` with the architecture glossary and a clearer shared-query / Supabase-factory layout.

## Technical Approach

1. Add `CONTEXT.md` seeded from `ARCHITECTURE-IMPROVEMENTS.md` lines 37-52.
   - Include the current glossary terms exactly enough to preserve meaning: Group, Channel, Membership, Direct Message, Message, Managed Invite, Audit Event, Notification Event, Presence, Report.
   - Add a short maintenance note: future architecture PRs that introduce durable domain nouns must update `CONTEXT.md` in the same PR.
   - Do not copy all findings into `CONTEXT.md`; keep it a glossary, not a roadmap.

2. Clean or classify root-level local artifacts without broadening the PR.
   - Repo inspection found these candidate files present at the repo root in this workspace:
     - `ChatView.jsx` — 417 lines.
     - `DMView.jsx` — 305 lines.
     - `ChannelsSidebar.jsx` — 157 lines.
     - `GroupsSidebar.jsx` — 178 lines.
     - `Modals.jsx` — 223 lines.
     - `PresencePanel.jsx` — 151 lines.
     - `ProfileCard.jsx` — 470 lines.
     - `data.js` — 123 lines.
     - `SideBar Prototype.html` — 596 lines.
     - `admin-dashboard-prompt.md` — 340 lines.
     - `group-avatar-prompt.md` — 220 lines.
     - `PEPCHAT_HELP_SYSTEM_DRAFT.md` — 607 lines.
   - These files are ignored/untracked in this workspace, so deleting or moving their root copies will not appear as git deletions in the PR.
   - Keep cleanup local-only for this PR: delete or move ignored root artifacts out of the repo workspace after confirming the working tree has no intentional edits inside them.
   - Do not preserve prompt/history docs under committed `docs/` paths in this PR. If a human wants archival docs later, handle that as a separate docs-only follow-up after reviewing the contents for secrets, misleading implementation instructions, or obsolete product promises.
   - Note the local workspace cleanup in the PR description, but do not include ignored artifact deletion as expected git-tracked changes.

3. Introduce a middleware Supabase factory seam for Finding 8.
   - Add `lib/supabase/middleware.ts`.
   - Export a narrow factory such as:
     - `createMiddlewareClient(request: NextRequest): { supabase: SupabaseClient; response: NextResponse }`
     - If preserving response rebinding requires a getter, prefer an explicit shape such as `{ supabase, getResponse }` over mutating exports.
   - Move only the middleware-specific `createServerClient(...)` cookie adapter into the factory.
   - Preserve current behavior where `setAll`:
     - writes cookies into `request.cookies`;
     - recreates `NextResponse.next({ request })` after request cookie mutation;
     - writes each returned cookie to the response with its Supabase-provided options.
   - Update `middleware.ts` to import the factory and remove direct `createServerClient` usage.
   - Keep `userHasProfile` local unless moving it improves types without broadening scope.
   - Avoid importing `lib/supabase/server.ts`; that factory is for Server Components / Server Actions and uses `next/headers` cookies, not `NextRequest` / `NextResponse`.

4. Move `DM_SELECT` into `lib/queries.ts` for Finding 9.
   - Add `export const DM_SELECT = '<current select string>'` next to `MESSAGE_SELECT`.
   - Update `app/(app)/dm/actions.ts` to import `DM_SELECT` from `@/lib/queries`.
   - Delete the local `const DM_SELECT = ...` in `app/(app)/dm/actions.ts`.
   - Do not DRY shared profile fragments in this PR unless the change is mechanical and does not alter either select string. Prefer exact move only.

5. Tests/checks should target the changed seams.
   - Middleware tests already mock `@supabase/ssr` in `tests/middleware.test.ts`; update them if the mock boundary moves from `middleware.ts` to `lib/supabase/middleware.ts`.
   - Add factory-level middleware coverage that captures the `createServerClient` cookie adapter and proves `setAll` preserves the existing semantics: mutate `request.cookies`, recreate `NextResponse.next({ request })` after that mutation, and set each returned cookie with its Supabase-provided options on the response returned by the factory.
   - DM action tests in `tests/app/dm-actions.test.ts` exercise send/edit/delete preview and notification behavior; add or update an assertion that the send path still calls `.select(DM_SELECT)` if practical with the existing builder mock.
   - Use package scripts from `package.json`: `npm test`, `npm run build`, and `npm run lint` is currently configured as `next lint`.

## Data / Security Notes

- No database schema or RLS changes.
- No new cookies or auth providers.
- The middleware seam is security-sensitive because cookie refresh and redirect behavior protects authenticated routes. Preserve exact cookie get/set semantics and safe redirect validation.
- `DM_SELECT` can expose profile fields. Moving it must not add or remove selected columns.
- Root prompt/prototype artifacts may contain stale design notes. For this PR, delete or move them out of the repo workspace instead of committing them under `docs/`; any later archival PR must first review them for secrets, misleading implementation instructions, or obsolete product promises.

## Change Manifest

Expected implementation PR files:

- `CONTEXT.md` — new committed domain glossary seeded from the architecture handoff.
- `lib/supabase/middleware.ts` — new middleware-specific Supabase client factory for `NextRequest` / `NextResponse` cookie handling.
- `middleware.ts` — replace inline `createServerClient` wiring with the new factory while preserving redirect/profile behavior.
- `lib/queries.ts` — export `DM_SELECT` beside `MESSAGE_SELECT`.
- `app/(app)/dm/actions.ts` — import shared `DM_SELECT` and remove the local constant.
- `tests/middleware.test.ts` — update/extend tests for the factory seam and existing redirect behavior if mocks need adjustment.
- `tests/app/dm-actions.test.ts` — update/extend DM action test coverage for the shared select string if practical.

Local-only cleanup, not expected to appear as git deletions because files are ignored/untracked:

- `ChatView.jsx`
- `DMView.jsx`
- `ChannelsSidebar.jsx`
- `GroupsSidebar.jsx`
- `Modals.jsx`
- `PresencePanel.jsx`
- `ProfileCard.jsx`
- `data.js`
- root prompt/history docs, deleted or moved out of the repo workspace only after local review

## Evidence From Repo Inspection

Initial repo state for this spec run:

- CWD: `/mnt/c/Users/colebienek/pepchat`.
- Branch: `chore/repo-hygiene-artifact-ignores`.
- Initial `git status --short --branch` showed:
  - `## chore/repo-hygiene-artifact-ignores...origin/chore/repo-hygiene-artifact-ignores`
  - ` M README.md`
  - `?? ARCHITECTURE-IMPROVEMENTS.md`
  - `?? app/(auth)/check-email/`
  - `?? app/auth/confirm/`
- `specs/` already exists with `specs/notification-navigation-fallback.md`.
- No `CONTEXT.md` exists.

Root artifact evidence:

| Root artifact | Present locally | Git-tracked exact filename refs, excluding `.gitignore` | Existing authoritative replacement / disposition |
|---|---:|---|---|
| `ChatView.jsx` | yes, 417 lines | none | Delete local root prototype; current chat UI is under `components/chat/*.tsx`. |
| `DMView.jsx` | yes, 305 lines | none | Delete local root prototype; current DM UI/actions are under `components/dm/`, `app/(app)/dm/`, and related hooks. |
| `ChannelsSidebar.jsx` | yes, 157 lines | none | Delete local root prototype; authoritative file is `components/sidebar/ChannelsSidebar.tsx` with tests in `tests/components/ChannelsSidebar*.test.tsx`. |
| `GroupsSidebar.jsx` | yes, 178 lines | none | Delete local root prototype; authoritative file is `components/sidebar/GroupsSidebar.tsx` with tests in `tests/components/GroupsSidebar*.test.tsx`. |
| `Modals.jsx` | yes, 223 lines | none | Delete local root prototype; modal code is componentized elsewhere. |
| `PresencePanel.jsx` | yes, 151 lines | none | Delete local root prototype; authoritative file is `components/chat/PresencePanel.tsx` with tests in `tests/components/PresencePanel.test.tsx`. |
| `ProfileCard.jsx` | yes, 470 lines | none | Delete local root prototype; authoritative file is `components/profile/ProfileCard.tsx` with tests in `tests/components/ProfileCard.test.tsx`. |
| `data.js` | yes, 123 lines | no meaningful exact root-file refs; `.gitignore` explicitly ignores `/data.js` | Delete local root stub data. |
| `SideBar Prototype.html` | yes, 596 lines | none outside `.gitignore` | Delete or move out of the repo workspace for this PR; archival docs require a separate human-requested docs-only PR. |
| `admin-dashboard-prompt.md` | yes, 340 lines | none outside `.gitignore` | Delete or move out of the repo workspace for this PR; archival docs require a separate human-requested docs-only PR. |
| `group-avatar-prompt.md` | yes, 220 lines | none outside `.gitignore` | Delete or move out of the repo workspace for this PR; archival docs require a separate human-requested docs-only PR. |
| `PEPCHAT_HELP_SYSTEM_DRAFT.md` | yes, 607 lines | none outside `.gitignore` | Delete or move out of the repo workspace for this PR; archival docs require a separate human-requested docs-only PR. |

Additional evidence:

- `.gitignore` already ignores root `/*.jsx`, `/PEPCHAT_HELP_SYSTEM_DRAFT.md`, `/admin-dashboard-prompt.md`, `/group-avatar-prompt.md`, `/SideBar Prototype.html`, and `/data.js`.
- `git status --short -- <candidate files>` is empty because these root candidates are ignored/untracked.
- `git grep -n "createServerClient" -- '*.ts' '*.tsx'` found direct usage only in `lib/supabase/server.ts`, `middleware.ts`, and `tests/middleware.test.ts`.
- `middleware.ts` currently imports `createServerClient` directly and defines request/response cookie `getAll` / `setAll` inline at lines 7-26.
- `lib/supabase/server.ts` is the Server Component / Server Action factory using `next/headers` cookies; it is not suitable for middleware request/response cookies.
- `lib/queries.ts` currently exports only `MESSAGE_SELECT`.
- `app/(app)/dm/actions.ts` currently defines local `DM_SELECT` at line 7 and uses it in `sendDM(...).select(DM_SELECT)`.
- `MESSAGE_SELECT` is imported by `app/(app)/channels/[channelId]/page.tsx`, `app/(app)/messages/actions.ts`, and `lib/hooks/useMessages.ts`.

## Success Criteria

- `CONTEXT.md` exists and contains the seeded glossary terms from `ARCHITECTURE-IMPROVEMENTS.md`.
- Root-level prototype/scratch artifact handling is explicit:
  - dead root JSX prototypes and `data.js` are removed from the local workspace or documented as intentionally preserved outside git;
  - root prompt/history docs are deleted or moved out of the repo workspace, not committed under `docs/` in this PR;
  - no ignored root artifact is referenced by live app code.
- `middleware.ts` no longer imports or calls `createServerClient` directly.
- `lib/supabase/middleware.ts` owns middleware-specific Supabase cookie wiring.
- Middleware factory tests cover Supabase cookie `setAll` semantics, including request-cookie mutation, response rebinding, and response-cookie options.
- Existing middleware redirect/profile behavior remains covered by tests and unchanged.
- `lib/queries.ts` exports `DM_SELECT` and `MESSAGE_SELECT`.
- `app/(app)/dm/actions.ts` imports `DM_SELECT` from `@/lib/queries` and has no local `DM_SELECT` constant.
- The `DM_SELECT` string is unchanged byte-for-byte except for moving files.
- DM send/edit/delete/read behavior remains covered by existing tests; send still selects the same sender profile fields.
- No later-phase architecture primitives are introduced.
- No app dependencies are added.

## Test Plan

Run before implementation if the workspace is already set up:

- `git status --short --branch`
- `git grep -n --fixed-strings -- '<candidate filename>' -- ':!.gitignore'` for each root cleanup candidate before deleting or relocating it.

Run after implementation:

- `npm test -- tests/middleware.test.ts`
- `npm test -- tests/app/dm-actions.test.ts`
- `npm test -- tests/app/message-actions.test.ts` if `lib/queries.ts` changes affect shared message select imports.
- `npm test -- tests/hooks/useMessages.test.ts` if present; otherwise run `npm test -- tests/hooks` if time allows because `MESSAGE_SELECT` remains in the shared queries module.
- `npm run build` to verify Next.js middleware/module boundaries and path aliases.
- `npm run lint` if `next lint` is available in this Next 14 setup; if the script fails because `next lint` is unavailable/deprecated in the local install, record that exact failure instead of treating it as an app failure.
- Final `git status --short --branch`.

## Rollback Notes

- Revert `middleware.ts` to the previous inline `createServerClient` implementation and delete `lib/supabase/middleware.ts` if auth cookies or redirects regress.
- Move `DM_SELECT` back into `app/(app)/dm/actions.ts` and remove it from `lib/queries.ts` if shared-query import boundaries cause build issues.
- Revert `CONTEXT.md` if the team rejects repo-level glossary docs.
- If a human later wants to preserve any prompt/history docs, create a separate docs-only PR after reviewing contents; do not restore ignored root copies by default.
- Local deletion of ignored root artifacts can be undone from any personal backup only if needed; because they are ignored/untracked, git cannot restore them.

## Open Questions

- None for the implementation PR. Archiving ignored prompt/history artifacts is explicitly out of scope for Phase 0 and should be handled separately only if a human requests it.
