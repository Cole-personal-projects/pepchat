# Invite-Only Auth Lockdown

## Problem

SideBar currently lets anyone visit `/signup`, create a Supabase Auth user with email/password, complete `/setup-profile`, and then enter the authenticated app. Group invites are enforced only when joining a group; they are not a prerequisite for account creation or app entry.

The app must be invite-only: random users must not be able to complete signup/login/profile setup and reach `/channels`, `/groups`, DMs, settings, or admin routes. A valid invite created by a group admin/owner must be required before a new user can create a usable SideBar account and enter the app.

Current relevant state:

- Auth actions live in `app/(auth)/actions.ts`.
- Auth UI lives in `app/(auth)/login/page.tsx`, `app/(auth)/signup/page.tsx`, and `app/(auth)/setup-profile/page.tsx`.
- `middleware.ts` already redirects unauthenticated protected routes to `/login?next=...` and redirects authenticated users without profiles to `/setup-profile?next=...`.
- `/join/[code]` currently lives at `app/(app)/join/[code]/page.tsx`, so it is wrapped by `app/(app)/layout.tsx`. That layout redirects anonymous users to `/login` and authenticated users without profiles to `/setup-profile` before the join page can render.
- Managed group invites live in `group_invites` / `group_invite_uses` with expiration, usage limits, revoke state, creator metadata, and RLS. Legacy `groups.invite_code` still exists.
- `supabase.auth.signUp` can create an `auth.users` row before SideBar creates a `profiles` row.
- `schema.sql` currently has a `profiles` insert RLS policy named `Users can insert their own profile` (`with check (id = auth.uid())`). That policy is incompatible with invite-only account entry because any raw Supabase Auth user can insert `profiles(id = auth.uid())` through authenticated client APIs and bypass the app-level setup action.

## Non-goals

- Do not build a standalone global invite system unrelated to groups.
- Do not resume or depend on the archived Phase 4 invite lifecycle chain.
- Do not redesign Supabase Auth email confirmation or password reset flows beyond preserving safe invite return paths.
- Do not remove existing managed group invite management UI unless a field becomes obsolete.
- Do not grant invite creation to moderators for account entry. The request says admin/owner; keep account-entry invites admin/owner-only.
- Do not make legacy `groups.invite_code` a valid source for new account creation.
- Do not rely only on client-side checks or hidden fields.
- Do not expose service-role Supabase credentials to the browser.

## User experience / behavior

1. Invite link entry
   - `/join/[code]` is the canonical invite entry point for both anonymous and authenticated users.
   - Anonymous visitor with a valid managed invite sees invite-aware auth copy and can continue to login or signup with the invite preserved.
   - Anonymous visitor with an invalid, expired, maxed-out, or revoked managed invite sees a closed-state message: `This invite is no longer valid. Ask an admin for a fresh link.`
   - Anonymous visitor with only a legacy `groups.invite_code` does not get account signup. Show: `This invite link is no longer accepted for new accounts. Ask an admin for a fresh invite.`

2. Signup
   - `/signup` without a valid managed invite is closed. It must not show a working account creation form.
   - `/signup?invite=<code>` or `/signup?next=/join/<code>` validates the managed invite server-side before showing or submitting a signup form.
   - The signup form keeps the invite code in a hidden field, but the server action treats that value as untrusted and revalidates it.
   - On successful signup, the user is sent through the existing email confirmation/check-email experience and ultimately to profile setup with the invite still recoverable server-side.
   - Existing duplicate-email fake-success handling remains: do not create or reveal invite claims for existing accounts.

3. Login
   - Existing users with profiles can log in normally and do not need a fresh invite.
   - A user who has an Auth session but no SideBar profile can proceed only if there is a valid pending account-invite claim for their Auth user.
   - If a profile-less Auth user logs in without a pending valid invite claim, sign them out or keep them on login with: `An invite is required to finish account setup.` Do not redirect them into `/setup-profile`.

4. Profile setup and first app entry
   - `/setup-profile` is reachable only for authenticated users who do not have a profile and do have a valid pending account-invite claim.
   - Submitting setup creates the profile and consumes the invite in one server-side transaction/RPC.
   - After setup succeeds, the user is a `noob` member of the invited group and redirects to `/groups/<groupId>` or the invite-preserved safe `next` path.
   - If the invite expires, is revoked, or reaches its usage limit between signup and profile setup, setup fails closed and asks the user for a fresh invite.

5. Existing in-app group joining
   - Existing profiled users may continue to use managed group invites to join additional groups.
   - Existing profiled users may continue to use legacy `groups.invite_code` only if the implementation intentionally preserves current compatibility. Legacy codes must not bootstrap new accounts.

## Technical approach

### 1. Treat `auth.users` as not sufficient for SideBar membership

Use a layered guardrail:

- Server-side signup validation must reject calls without a valid managed invite before calling `supabase.auth.signUp`.
- Profile creation must require a pending invite claim tied to the authenticated `auth.users.id`.
- Middleware must treat `user && !profile && !validInviteClaim` as not allowed to enter auth setup or protected app routes.
- Production rollout should disable or otherwise monitor public Supabase Auth signup where possible, but the app must still be safe if a raw Supabase Auth user exists. Such a user cannot create a SideBar profile or reach the app without a valid claim.

This accepts that a direct Supabase Auth API call may still create an `auth.users` row if project-level public signup remains enabled. That row is not a usable SideBar account until it has a validated invite claim and profile.

### 2. Add an account invite claim model

Add a migration for a server-owned pending claim table. Suggested shape:

```sql
create type public.account_invite_claim_status as enum ('pending_profile', 'consumed', 'revoked');

create table public.account_invite_claims (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.group_invites(id) on delete restrict,
  group_id uuid not null references public.groups(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  status public.account_invite_claim_status not null default 'pending_profile',
  claimed_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index idx_account_invite_claims_pending_user
  on public.account_invite_claims(auth_user_id)
  where status = 'pending_profile';

create unique index account_invite_claims_one_pending_per_user
  on public.account_invite_claims(auth_user_id)
  where status = 'pending_profile';

alter table public.account_invite_claims enable row level security;

revoke all on table public.account_invite_claims from anon, authenticated;
revoke all on table public.account_invite_claims from public;
```

Notes:

- Keep this table server/service-role owned. Enable RLS and do not add broad client-visible policies.
- `anon` and `authenticated` must have no direct `insert`, `update`, or `delete` privilege on `account_invite_claims`.
- Prefer no direct `select` privilege/policy for `anon` or `authenticated`. If a UI needs claim context, expose only narrowly scoped/sanitized data through a server route or SECURITY DEFINER RPC that checks `auth.uid() = auth_user_id`; do not let clients enumerate claim rows.
- Claim creation/revocation/consumption must happen only through service-role server code or SECURITY DEFINER database functions. Browser clients must never write this table directly.
- It references `auth.users`, not `profiles`, because claims are created before profile setup.
- Keep one pending claim per Auth user for first account entry by using the partial unique index above. If a user retries with another valid invite before profile setup, use revoke-and-insert: in one database transaction, lock existing pending claims for that `auth_user_id`, mark them `revoked`, then insert the new `pending_profile` claim. Do not add `unique(auth_user_id)` across all statuses, because that prevents retaining consumed/revoked claim history.
- Do not store raw invite URLs; store IDs and normalized code-derived references.

### 3. Add atomic invite completion

Do not implement first-account invite consumption as separate unguarded client or server calls. Add a single database transaction boundary, preferably a SECURITY DEFINER Postgres RPC/database function, that performs these steps atomically. A server helper may wrap this RPC, but it must not independently perform profile insert, membership insert, invite-use insert, invite counter update, or claim update as separate Supabase client calls.

The RPC should set a safe `search_path`, validate its caller, and use `auth.uid()` or an explicit server-validated user ID. It must:

1. Load and lock the pending `account_invite_claims` row for `auth.uid()` / current Auth user with `status = 'pending_profile'`.
2. Lock the matching `group_invites` row for update.
3. Recheck security invariants at consumption time:
   - `revoked_at is null`
   - `expires_at is null or expires_at > now()`
   - `max_uses is null or uses_count < max_uses`
   - claim status is still `pending_profile`
4. Insert `profiles(id, username)`.
5. Insert `group_members(group_id, user_id, role = 'noob')`.
6. Insert `group_invite_uses(invite_id, group_id, user_id)` after the profile exists.
7. Increment `group_invites.uses_count`.
8. Mark claim `consumed` with `consumed_at = now()`.
9. Return the joined `group_id`.

This closes the race where two users could pass `inviteIsUsable` against the same one-use invite and both increment later. Existing `consumeInvite` may remain for profiled users, but the implementation should consider moving it to the same RPC-style atomic path as follow-up if tests expose over-use risk.

### 4. Replace direct `profiles` insert access with RPC-only first-account setup

The database must enforce the invite-only account gate even when a user bypasses SideBar app actions and uses Supabase client APIs directly.

Add a migration that removes the existing direct authenticated insert path for profiles:

```sql
drop policy if exists "Users can insert their own profile" on public.profiles;
revoke insert on table public.profiles from anon, authenticated;
```

Do not replace it with another broad authenticated `profiles` insert policy, including a policy that checks only `id = auth.uid()` or only checks for a pending claim. First profile creation must happen only inside the server-owned atomic invite-completion RPC/service-role transaction that validates and consumes a pending `account_invite_claims` row.

The preferred shape is:

- keep `profiles` RLS enabled;
- keep authenticated `select` and own-profile `update` behavior if still needed by existing app features;
- remove direct `insert` privilege/policy from `anon` and `authenticated`;
- implement the completion RPC as `security definer`, owned by a role that can insert into `public.profiles`, with a safe `search_path` and explicit validation that the effective user is the Auth user whose pending claim is being consumed;
- grant only `execute` on the completion RPC to the role/call path that performs setup; do not grant browser clients generic service-role credentials or direct table insert rights;
- mirror the policy removal and final policy set in `schema.sql` so fresh projects are not left with the bypass.

Regression coverage must prove direct authenticated-client insertion fails outside the RPC. At minimum, a profile-less Auth user with no pending claim must not be able to insert `profiles(id = auth.uid())`. Prefer also proving that even a user with a pending claim cannot direct-insert a profile; the claim is usable only through the atomic completion RPC.

### 5. Invite resolution rules

Create or extend invite helpers in `lib/invites` so call sites can request one of two modes:

- `mode: 'account_signup'`
  - Managed `group_invites` only.
  - Requires usable invite.
  - Requires `created_by` user to still be an admin of the group or `groups.owner_id`. If the creator lost rights, fail closed or require a fresh invite.
  - Rejects legacy `groups.invite_code`.
- `mode: 'group_join'`
  - Existing profiled-user behavior; may keep managed plus legacy compatibility.

Use `inviteLookupClient(supabase)` / service-role-backed lookup server-side where RLS would hide rows from anonymous users. Never resolve account invites from the browser.

### 6. Route and action changes

- `middleware.ts`
  - Add `/join` to the unauthenticated allow-list so invite links can render a public invite-aware landing/auth choice instead of immediately redirecting to login.
  - Middleware allow-listing is not sufficient while `/join/[code]` remains inside `app/(app)`, because `app/(app)/layout.tsx` will still redirect before the page renders. The route must be moved out of the authenticated `(app)` route group or otherwise exempted before `AppLayout` runs.
  - Preserve safe `next` paths as today, but update `safeRedirectPath` to also reject backslashes consistently with `app/(auth)/actions.ts`.
  - For `user && !profile`:
    - allow `/setup-profile` only if `userHasPendingInviteClaim(user.id)` returns true;
    - redirect/profile-gate all other protected routes to `/setup-profile?next=...` only when a pending claim exists;
    - otherwise redirect to `/login?invite_required=1` after signing out or to a closed auth page that cannot complete setup.
  - Authenticated users with profiles visiting `/login` or `/signup` keep current safe-next redirect behavior.

- `app/join/[code]/page.tsx` or another route location outside `app/(app)`
  - Move the public invite landing out of the authenticated app route group. Do not leave account-entry join handling under `app/(app)/layout.tsx` unless that layout gets an explicit pre-redirect exemption for `/join`, which is riskier than moving the route.
  - Resolve the invite before requiring auth.
  - Anonymous + valid managed invite: render auth choices or redirect to `/signup?invite=<code>&next=/join/<code>` depending on the desired minimal UI. Keep login link as `/login?invite=<code>&next=/join/<code>` for existing accounts.
  - Authenticated + no profile + valid pending/claimable invite: continue to setup profile.
  - Authenticated + profile: consume as existing group join flow.
  - Invalid/unusable legacy-for-new-account conditions render closed invite messages without leaking whether a private group exists beyond generic invite status.

- `app/(auth)/signup/page.tsx`
  - Read `invite` from query string or derive it from `next=/join/<code>`.
  - Without a server-validated valid invite, render invite-only closed state and link to login; do not render the signup form.
  - Include a hidden `invite` input when rendering the signup form.
  - Update copy from `Join SideBar today` to invite-only copy such as `Create your account with this invite`.

- `app/(auth)/actions.ts::signup`
  - Require `invite` form field.
  - Normalize and server-validate managed invite in account-signup mode before `supabase.auth.signUp`.
  - Call `signUp` only after invite validation passes.
  - After successful non-duplicate signup, create or replace the pending `account_invite_claims` row for `data.user.id` using service-role/server-only code.
  - Ensure email confirmation redirect preserves enough state to route back to `/setup-profile` after confirmation. Prefer server-side claim lookup by user ID over putting trusted invite state in query strings.

- `app/auth/callback/route.ts`
  - After `exchangeCodeForSession`, check whether the user already has a profile.
  - If no profile and a pending invite claim exists, redirect to `/setup-profile` with safe `next` if present.
  - If no profile and no pending claim, redirect to `/login?invite_required=1` and do not fall through to `/`.

- `app/(auth)/actions.ts::login`
  - After sign-in, if no profile, require pending claim before redirecting to setup.
  - If no claim, sign out and return invite-required error.

- `app/(auth)/setup-profile/page.tsx` and `setupProfile`
  - Page should rely on middleware/server checks; optionally render invite/group context if available.
  - Action must call the atomic completion path instead of directly inserting `profiles`.
  - Remove direct unauthenticated/profile insert path that only checks username.
  - Do not compensate for the removed direct `profiles` insert policy by creating profiles with a normal authenticated Supabase client insert. Use only the validated completion RPC/service-role transaction.

- `app/(app)/groups/actions.ts`
  - Existing profiled-user `joinGroup` can stay, but ensure account-signup invite validation is not routed through legacy fallback.
  - Keep `regenerateGroupInvite`, `listGroupInvites`, and `revokeGroupInvite` admin/owner-only for account-entry-capable invites. Current `PERMISSIONS.canManageGroup` is admin-only and is safer than `canGenerateInvite` moderator access.

### 7. Admin/owner invite creation

- Existing group settings invite creation can remain the source of account-capable managed invites if it is gated to group admin/owner.
- If the UI currently implies moderators can create invites, align copy and permissions for account-entry invites: only admins/owners can create links that bootstrap accounts.
- Audit events for invite regeneration/revocation should remain. Add audit metadata if needed to distinguish account-entry invite usage from ordinary profiled group joins.

### 8. Legacy invite compatibility decision

- Managed `group_invites.code` is authoritative for new account signup.
- Legacy `groups.invite_code` is not valid for new account signup because it has no creator, expiration, max-use, revoke, or usage-history guarantees.
- Existing profiled users may still use legacy codes to join groups for backward compatibility unless the engineer chooses to deprecate it in a separate spec.
- When a legacy code is entered by an anonymous visitor, fail closed and ask for a fresh admin invite.

## Data/security notes

- Security invariant: an Auth session alone is not enough to enter the app. A user needs a `profiles` row, and profile creation requires a valid pending invite claim.
- Security invariant: `/channels`, `/groups`, `/dm`, `/settings`, and `/admin` remain inaccessible to users without a profile.
- Security invariant: `/setup-profile` cannot create a profile unless invite completion succeeds at the database/server layer.
- Security invariant: direct authenticated Supabase clients cannot insert their own `profiles` row. The existing `Users can insert their own profile` policy must be dropped/replaced with RPC-only profile creation for first account setup.
- Security invariant: invite usability is rechecked at consumption time, not just when the signup page is rendered.
- Security invariant: one-use/max-use invites cannot be over-consumed under concurrent signup/profile submissions.
- Security invariant: revoked/expired invites cannot be used to create a profile even if the Auth user signed up before revocation/expiration.
- Security invariant: account-entry invites must be created by a current group admin/owner; moderator-created or legacy codes do not bootstrap new accounts.
- Keep service-role operations in server-only modules. Do not import service-role helpers into client components.
- Avoid detailed public errors that reveal private group names for invalid invite codes. It is acceptable to show group context only after a valid invite is resolved.
- Consider cleanup for stale `pending_profile` claims if email confirmation is never completed. A scheduled cleanup or migration note is enough for this PR; do not block app security on cleanup.

## Change Manifest

- `specs/invite-only-auth-lockdown.md` — this implementation spec.
- `migrations/<new>-account-invite-claims.sql` — add `account_invite_claim_status`, `account_invite_claims`, partial unique pending-claim index, explicit RLS/privilege revokes, claim creation/revocation function if used, the atomic invite/profile completion RPC/database function, and the `profiles` RLS/privilege migration that drops `Users can insert their own profile` and removes direct `anon`/`authenticated` profile insert access.
- `schema.sql` — mirror the new table/RPC and final `profiles` policy set for fresh Supabase projects; do not keep the direct authenticated self-insert profile policy.
- `lib/invites/index.ts` — add account-signup-only invite resolution, current-admin/owner validation, and reusable pending-claim helpers or types.
- `lib/invites/lookupClient.ts` or a new server-only helper — keep anonymous/server invite lookup service-role-backed without exposing credentials.
- `app/(auth)/actions.ts` — require invite validation before signup; create pending claims; gate login/profile setup for profile-less users; complete profile via atomic invite consumption.
- `app/(auth)/signup/page.tsx` — render invite-only closed state unless a valid invite is present; preserve invite in form submission.
- `app/(auth)/login/page.tsx` — preserve `invite` alongside safe `next` and show invite-required errors.
- `app/(auth)/setup-profile/page.tsx` — preserve safe next behavior and optionally show invite context; rely on server gating.
- `app/auth/callback/route.ts` — route post-confirmation profile-less users only to setup when a pending claim exists.
- `app/(app)/join/[code]/page.tsx` -> `app/join/[code]/page.tsx` (or equivalent outside `(app)`) — move invite landing out from under `AppLayout`, resolve before auth, branch anonymous/profile-less/profiled behavior, and reject legacy codes for new accounts.
- `middleware.ts` — add public join handling, pending-claim checks for profile-less sessions, and stricter safe-next validation.
- `app/(app)/groups/actions.ts` — keep existing profiled group join behavior but ensure account bootstrap uses managed invites only; verify invite management remains admin/owner-only.
- `tests/middleware.test.ts` — add invite-only gate coverage for public join, profile-less users with/without pending claims, and safe next handling.
- `tests/app/auth-actions.test.ts` or equivalent new file — cover signup/login/setupProfile invite requirements and failures.
- `tests/lib/invites.test.ts` — cover account-signup invite resolution, legacy rejection, creator-rights validation, revoked/expired/maxed invite rejection, and atomic max-use behavior.
- `tests/app/join-page.test.tsx` or equivalent — cover anonymous valid/invalid/legacy invite behavior and profiled-user join compatibility.
- `tests/db/profiles-rls.test.ts`, SQL migration test, or equivalent Supabase integration coverage — prove a profile-less authenticated user cannot insert `profiles(id = auth.uid())` directly through authenticated client APIs, and that profile creation succeeds only through the atomic invite-completion RPC with a valid pending claim.

## Success Criteria

- `/signup` without a valid managed invite does not render a working signup form and cannot call `signUp` successfully through the app action.
- Signup action revalidates the invite server-side before creating a Supabase Auth user.
- A direct/profile-less Auth user without a pending invite claim cannot complete `/setup-profile` and cannot reach `/channels`, `/groups`, `/dm`, `/settings`, or `/admin`.
- A user with a valid managed invite can sign up, confirm email, set a username, get a `profiles` row, join the invited group as `noob`, and land inside the app.
- Invite expiration, revocation, and max-use limits are enforced both before signup and again during profile completion.
- A one-use invite cannot admit two new accounts under concurrent profile setup attempts.
- Invites created by non-admin/non-owner users cannot bootstrap accounts.
- Legacy `groups.invite_code` values cannot bootstrap new accounts.
- Existing profiled users can still log in without a new invite.
- Existing profiled users can still join groups via the intentionally supported group invite flow.
- Safe `next` handling preserves `/join/<code>` and app-local paths while rejecting external URLs, protocol-relative URLs, and backslash paths.
- Service-role invite lookup/claim writes are server-only.
- `account_invite_claims` has RLS enabled, no direct anon/authenticated DML privileges, and no broad client-visible select policy.
- The existing `profiles` insert policy `Users can insert their own profile` is removed from both migration state and `schema.sql`; `anon`/`authenticated` have no direct `profiles` insert path.
- A raw/profile-less Supabase Auth user without a pending invite claim cannot insert `profiles(id = auth.uid())` directly through an authenticated Supabase client, so middleware/AppLayout cannot be bypassed by manufacturing a profile row outside the setup action.
- A pending invite claim alone does not grant direct client-side `profiles` insert rights; first profile creation succeeds only through the atomic invite-completion RPC/service-role path.
- First-account invite completion is one database transaction/RPC; no implementation path performs the completion steps as independent non-transactional Supabase calls.
- Pending account claims use a partial unique index for one pending claim per Auth user, with revoke-and-insert retry behavior for a different invite before setup.
- Anonymous `/join/<code>` rendering is not blocked by `app/(app)/layout.tsx` / `AppLayout`.
- Tests cover middleware, auth actions, invite helpers/RPC behavior, and join route behavior.

## Test Plan

Targeted unit/integration tests:

- `npm test -- tests/middleware.test.ts`
  - unauthenticated `/join/valid-code` is allowed to render join landing instead of redirecting to login;
  - unauthenticated protected app route still redirects to `/login?next=...`;
  - authenticated no-profile user with pending claim redirects to `/setup-profile?next=...`;
  - authenticated no-profile user without pending claim cannot enter protected routes or setup;
  - unsafe `next` values are ignored, including `//evil.example` and paths containing backslashes.

- `npm test -- tests/app/auth-actions.test.ts` (new or nearest existing auth action test file)
  - `signup` without invite returns invite-required error and does not call `signUp`;
  - `signup` with invalid/revoked/expired/maxed invite returns closed error and does not call `signUp`;
  - `signup` with valid managed invite calls `signUp` and creates a pending claim for `data.user.id`;
  - duplicate-email fake-success does not create an invite claim;
  - `login` for existing profiled user redirects to safe next;
  - `login` for no-profile user with pending claim redirects to setup;
  - `login` for no-profile user without claim signs out/returns invite-required error;
  - `setupProfile` without pending claim fails closed;
  - `setupProfile` with pending claim calls atomic completion and redirects to invited group/safe next.

- `npm test -- tests/lib/invites.test.ts`
  - account-signup mode resolves valid managed invites;
  - account-signup mode rejects legacy codes;
  - account-signup mode rejects revoked, expired, and maxed invites;
  - account-signup mode rejects invites whose creator is no longer admin/owner;
  - group-join mode retains intended existing compatibility;
  - concurrent one-use completion admits only one profile/member and records one use.

- `npm test -- tests/db/profiles-rls.test.ts`, `supabase test db`, or the nearest existing SQL/RLS integration test command
  - after signing in as a real Auth user with no `profiles` row and no pending `account_invite_claims` row, `supabase.from('profiles').insert({ id: auth.uid(), username: 'bypass' })` fails with a permission/RLS error;
  - creating a pending claim does not make direct authenticated-client profile insertion succeed;
  - calling the atomic invite-completion RPC with a valid pending claim creates the profile/member/use rows and consumes the claim;
  - after the migration/schema refresh, no policy equivalent to `Users can insert their own profile` remains on `public.profiles`.

- `npm test -- tests/app/join-page.test.tsx` or route-level equivalent
  - `/join/[code]` is outside the authenticated `app/(app)` route group, or an equivalent test proves anonymous requests are not redirected by `app/(app)/layout.tsx` before the join page runs;
  - anonymous valid managed invite shows/redirects to invite-aware auth;
  - anonymous invalid invite shows generic invalid/fresh-link copy;
  - anonymous legacy invite rejects new account bootstrap;
  - authenticated profiled user still consumes a valid invite and reaches group route;
  - authenticated no-profile user without claim cannot consume group invite as an app member.

Manual verification after targeted tests:

1. Visit `/signup` directly: no usable signup form.
2. Visit `/join/<valid-managed-code>` in a clean browser: signup/login path preserves invite.
3. Complete signup + email confirmation + setup profile: user lands in invited group as `noob`.
4. Reuse a one-use invite in a second clean browser: second user is blocked before profile/app entry.
5. Revoke an invite after signup but before setup: setup fails closed.
6. Existing profiled account login still lands in `/channels` or safe `next`.

If targeted tests pass, run broader checks:

- `npm run test`
- `npm run lint`
- `npm run build`

## Open Questions

- Should production Supabase Auth public signup be disabled as part of rollout, or is app-level invite/profile gating acceptable for this release? The spec is safe either way, but disabling public signup reduces stray `auth.users` rows.
- Should existing legacy `groups.invite_code` support for already-profiled users be deprecated in the same PR, or kept for compatibility as specified here?
- Should invite landing show group name/context for valid anonymous invites, or keep copy generic until after login/signup to minimize private group disclosure?
- What retention policy should apply to stale `pending_profile` account invite claims when users never confirm email or finish setup?
