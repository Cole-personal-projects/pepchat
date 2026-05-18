# SideBar — Architecture Deepening Opportunities (Agent Handoff)

> **Source:** `/improve-codebase-architecture` run against `C:\Users\colebienek\pepchat`
> **Date:** 2026-05-13
> **Repo state at audit:** `main @ 4f3bd07` ("Fix message search header bleed")
> **Auditor model:** Claude Opus 4.7
> **Status:** Ready for agent handoff — proposals are scoped, but interfaces marked *draft* are intentionally provisional and meant to be sharpened in a grilling pass before implementation.

---

## How to use this document

You are picking this up as an agent. Read in this order:

1. **Architectural vocabulary** — every proposal uses these terms precisely. Don't drift into "service / boundary / component."
2. **Domain glossary (provisional)** — there is no `CONTEXT.md` in this repo yet. The terms below are the language we'll use; if you implement an opportunity that introduces a new noun, add it to a real `CONTEXT.md` in the same commit.
3. **Findings** — twelve numbered opportunities, ranked by severity. Each has a self-contained brief: files, problem, draft interface, benefits, deletion-test verdict, risks, and a suggested next step.
4. **Sequencing** — recommended order. Earlier items unblock later ones.
5. **Open questions** — what you should ask the product/engineering lead before doing the load-bearing refactors.

**Do not implement findings 1–12 sequentially without confirming priority.** The user invoked the skill in non-interactive mode; the grilling loop was skipped. Treat each finding as a *candidate* and confirm scope before writing code.

---

## Architectural vocabulary

- **Module** — anything with an interface and an implementation (function, class, hook, server action, package).
- **Interface** — everything a caller must know to use it: types, invariants, error modes, ordering, config. *Not just the signature.*
- **Depth** — leverage at the interface. Deep = a lot of behaviour behind a small interface. Shallow = interface nearly as complex as the implementation.
- **Seam** — a place where behaviour can be altered without editing in place. A seam exists if there is an interface that two or more concrete things satisfy.
- **Adapter** — a concrete thing satisfying an interface at a seam. *One adapter = hypothetical seam. Two adapters = real seam.*
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.
- **Deletion test** — imagine deleting the module. If complexity vanishes, it was a pass-through (shallow). If complexity reappears across N callers, it was earning its keep (deep).

---

## Domain glossary (provisional — promote to `CONTEXT.md`)

| Term | Meaning |
|---|---|
| **Group** | A "server" in Discord parlance — top-level community with members, channels, an owner, invite codes, and audit history. Modeled by `groups` table. |
| **Channel** | A text room scoped to one Group. Has a `noob_access` flag controlling whether the noob role can read it. Modeled by `channels`. |
| **Membership** | A `(user, group)` tuple with a role. Modeled by `group_members`. Role is one of `admin \| moderator \| user \| noob`. |
| **Direct Message** (DM) | 1:1 conversation outside any Group. Stored in `direct_messages` + `dm_conversations`. |
| **Message** | A post in a Channel. Has optional attachments, reactions, replies, pins, edit history. |
| **Managed Invite** | An invite record with expiration, usage cap, revoke state, creator metadata, and usage history. Distinct from the legacy bearer-token invite code on the Group itself. |
| **Audit Event** | A row written to the audit log for lifecycle-relevant moderator/admin actions. |
| **Notification Event** | A row in the notification queue for mentions, DMs, and other addressable events. Includes delivery state (`pushed_at`, `push_error`). |
| **Presence** | Live status (`online \| away \| dnd`) + typing indicator. Driven by Supabase Realtime presence. |
| **Report** | A user-submitted moderation flag against a Message, with lifecycle states and moderator notes. |

If you introduce nouns like `Subscription`, `Gatekeeper`, or `SideEffect` (likely while implementing items 1, 3, or 5 below), add them here in the same commit.

---

## Findings

Severity scale: **5** = pervasive cross-cutting friction. **1** = nit. Each finding is independently actionable.

---

### Finding 1 — Realtime subscription wiring is duplicated across five hooks

**Severity:** 4
**Files:**
- `lib/hooks/useMessages.ts` (lines ~49–66 — channel + cleanup)
- `lib/hooks/usePresence.ts` (lines ~65–98)
- `lib/hooks/useChannels.ts`
- `lib/hooks/useGroups.ts`
- `lib/hooks/useDMs.ts`

**Problem.** Every realtime-aware hook reimplements the same Supabase pattern: name a channel, register `.on(...)` handlers, call `.subscribe()`, return a cleanup that calls `supabase.removeChannel(sub)`. Each hook invents its own channel-naming convention (`messages-${channelId}`, `presence-${channelId}`), payload casting (`payload.message as MessageWithProfile`), and subscription-status handling. Tests pass per hook because each mocks `createClient`, so integration concerns — double-subscription on remount, dropped reconnects, channel-name collisions, cleanup ordering — never surface.

**Draft interface (proposed deep module).**

```ts
// lib/realtime/useRealtimeChannel.ts
type ChannelConfig<P> = {
  topic: string;                          // e.g. `messages:${channelId}`
  events: Array<{
    event: 'INSERT' | 'UPDATE' | 'DELETE' | 'broadcast';
    table?: string;
    filter?: string;
    handler: (payload: P) => void;
  }>;
  presence?: PresenceConfig;              // optional, for hooks that need presence state
  onStatus?: (status: ChannelStatus) => void;
};

function useRealtimeChannel<P>(config: ChannelConfig<P>): { status: ChannelStatus };
```

Everything else (reconnect on visibility change, dedupe on remount, idempotent cleanup, typed payload narrowing) lives behind that seam.

**Benefits.**
- *Locality.* Reconnection logic and cleanup ordering bugs land in one file with one set of tests.
- *Leverage.* Hooks shrink to declarative configs. Mention autocomplete (currently in `MessageInput`) can adopt the same primitive.
- *Test surface.* The seam becomes the test surface. You can write subscription-lifecycle tests once (subscribe → message → unmount → re-subscribe → no leak) and trust them everywhere.

**Deletion test.** If you delete the five hooks' subscription scaffolding, complexity reappears in five places. The proposed `useRealtimeChannel` would be deep — a small interface (one config object) hiding presence state, reconnect, status, cleanup ordering, typing of payloads.

**Risks.**
- A premature abstraction here is worse than the status quo. Confirm the second adapter is real (presence + messages both need presence-state callbacks) before generalising. *One adapter = hypothetical seam.*
- Supabase's realtime SDK has subtle behaviours around channel reuse and presence sync — replicate behaviour exactly before extracting.

**Suggested next step.** Spike the abstraction against `useMessages` and `usePresence` only. If the config object stays under ~10 fields and both call sites simplify, expand to the other three hooks. If the config explodes, abandon and document why.

---

### Finding 2 — Role enforcement is split between `lib/permissions.ts` (UI) and inline checks (server actions)

**Severity:** 3
**Files:**
- `lib/permissions.ts` (44 call sites, all in `components/`)
- `app/(app)/members/actions.ts` (lines 22–31 — inline `callerMembership?.role !== 'admin'`)
- `app/(app)/groups/actions.ts` (line ~30 — same pattern)
- `app/(app)/channels/actions.ts`
- `app/admin/actions.ts`

**Problem.** `PERMISSIONS.ts` looks like the central RBAC module but it is **UI-only**. Server actions re-fetch the caller's row from `group_members` and inline the role comparison. When a rule changes — say, "moderators can now delete channels" — you must update `PERMISSIONS.canManageChannel`, then hunt down the corresponding server action and update its inline `if` block. RLS provides the ultimate gate, but the app-layer enforcement is two parallel systems.

**Draft interface (proposed deep module).**

```ts
// lib/permissions/gate.ts — server-callable, shares predicates with PERMISSIONS
export async function gateGroupRole(
  supabase: SupabaseClient,
  groupId: string,
  predicate: (membership: GroupMember) => boolean,
): Promise<GroupMember>;   // throws/returns ActionError if denied

// Usage in a server action:
const membership = await gateGroupRole(supabase, groupId, PERMISSIONS.canManageChannel);
```

Predicates in `lib/permissions.ts` become the shared source of truth; both UI and server actions consume them. The gate handles the auth-check + membership-fetch + predicate-evaluation in one place.

**Benefits.**
- *Locality.* "Who can do X" lives in one predicate, consumed two ways. A rule change is a one-line edit.
- *Leverage.* Server actions shrink — the first 10 lines of boilerplate collapse to one call.
- *Test surface.* Predicates are pure functions, already well-tested. The gate is one integration test, not 20.

**Deletion test.** Delete `PERMISSIONS.ts` today and the UI re-implements role checks inline. So it earns its keep on the UI side already. The proposal *deepens* it by giving server actions a way to share the same predicates.

**Risks.**
- Server actions sometimes need the membership row for other reasons (e.g., audit metadata). The gate must return it, not just a boolean.
- Don't bake `getUser()` into the gate — keep it composable with the auth-gate proposal below (Finding 3).

**Suggested next step.** Start with `gateGroupRole` and migrate `members/actions.ts` first (highest churn, clearest payoff). Then `groups/actions.ts`, then `channels/actions.ts`.

---

### Finding 3 — Every server action reimplements the same auth gate

**Severity:** 2 (related to Finding 2 — implement together)
**Files:** All files in `app/(app)/**/actions.ts`.

**Problem.** Every action opens with:
```ts
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return { error: 'unauthenticated' };
```
This is structurally repetitive (Next.js doesn't ship server-action middleware), but the inconsistency in error shape and the cost of "remembering to do this" make it a small but real risk.

**Draft interface (proposed deep module).**

```ts
// lib/actions/withAuth.ts
type ActionResult<T> = { data: T } | { error: ActionError };

export function withAuth<Args extends unknown[], T>(
  body: (ctx: { supabase: SupabaseClient; user: User }, ...args: Args) => Promise<ActionResult<T>>,
): (...args: Args) => Promise<ActionResult<T>>;
```

Composed with `gateGroupRole` from Finding 2:

```ts
export const updateChannelTopic = withAuth(async ({ supabase, user }, channelId, topic) => {
  const groupId = await groupIdForChannel(supabase, channelId);
  const membership = await gateGroupRole(supabase, groupId, PERMISSIONS.canManageChannel);
  // ... action body
});
```

**Benefits.**
- *Locality.* Auth error shape, unauthenticated logging, and client construction live in one place.
- *Leverage.* Action bodies focus on business logic.

**Deletion test.** Removing the wrapper just re-inlines the same 4 lines into every action. Modest depth — the gain is uniformity, not algorithmic complexity.

**Risks.** Wrapping every action in a HOF can confuse Next.js's "use server" inference. Test the build under `next build` before adopting broadly.

**Suggested next step.** Sequence after Finding 2; the two should land in the same series of PRs.

---

### Finding 4 — Component-embedded query logic in `MessageInput`, `MembersPanel`, `DMConversationView`

**Severity:** 2
**Files:**
- `components/chat/MessageInput.tsx` (lines 6, 73–80 — mention candidate query against `group_members`)
- `components/sidebar/MembersPanel.tsx` (direct `group_members` query)
- `components/dm/DMConversationView.tsx` (queries `dm_conversations`, `profiles`)

**Problem.** These components instantiate a Supabase browser client and call `.from(...).select(...)` inside `useEffect`. The query is *feature logic* (e.g., "candidates for @-mention autocomplete in this channel"), not a primitive UI behaviour. It can't be tested without mocking Supabase from inside the component, and it can't be reused (e.g., if mention autocomplete eventually needs to include cross-channel members).

**Draft interface.** Extract one hook per concern, owned by the feature domain:

```ts
// lib/hooks/useMentionCandidates.ts
function useMentionCandidates(groupId: string): { candidates: Member[]; loading: boolean };

// lib/hooks/useMembersList.ts
function useMembersList(groupId: string, filter?: MemberFilter): { members: Member[]; ... };
```

Each hook owns its query string, realtime subscription (via the `useRealtimeChannel` from Finding 1), and caching.

**Benefits.**
- *Locality.* Query shape + realtime invalidation co-located.
- *Test surface.* Hook tests can mock the Supabase client once and validate the data contract.
- *Reusability.* Mention candidates can be reused in DM compose, channel topic edit, etc.

**Deletion test.** Delete the inline `useEffect` queries and the calling components break — but the logic *should* live in a hook, not in the component. Depth is modest but real (each hook hides query + realtime + cache).

**Risks.** Don't over-extract. If a component has one inline query used nowhere else and there's no realtime concern, leaving it is fine.

**Suggested next step.** Start with `useMentionCandidates` because it's the one with the clearest second caller on the horizon.

---

### Finding 5 — Audit + notification side effects are repeated, not wrapped

**Severity:** 3
**Files:**
- `lib/audit.ts` (26 lines, swallows failures silently)
- `lib/server-notifications.ts` (152 lines)
- `app/(app)/members/actions.ts` (line ~67 — `logAuditEvent` after role change)
- `app/(app)/messages/actions.ts` (lines 47–55 — `enqueueMentionNotifications` after send)
- `app/admin/actions.ts` (audit after report review)
- ~20 other action call sites.

**Problem.** Every action that mutates state is supposed to (1) perform the mutation, (2) write an audit row if applicable, (3) enqueue notifications if applicable. Right now this is hand-rolled per action, with no compile-time check, no transactional grouping, and silent failure handling in `logAuditEvent`. Forget to call audit and nothing complains until a regulator does.

**Draft interface (proposed deep module).**

```ts
// lib/actions/sideEffects.ts
export async function withSideEffects<T>(
  supabase: SupabaseClient,
  primary: () => Promise<T>,
  effects: {
    audit?: AuditEventDraft;
    notifications?: NotificationDraft[];
  },
): Promise<T>;
```

The wrapper runs `primary` inside a controlled scope, then enqueues effects. Failures in audit/notifications bubble (or are explicitly downgraded with a typed reason), not silently caught.

Alternative: a *post-commit hook list* on a Postgres transaction (using `pg_notify` or a Supabase Edge Function trigger) so audit/notification rows are written by the database itself, not the app. Heavier lift, but stronger guarantee.

**Benefits.**
- *Locality.* "What side effects fire on X" is declarative at each action's edge.
- *Leverage.* New side-effect channels (Slack notifications, metrics) plug in without editing 20 actions.
- *Reliability.* Audit failures stop silently passing.

**Deletion test.** Remove the wrapper and the same `logAuditEvent(...)` + `enqueue*Notification(...)` calls scatter to every action — exactly what we have today. Real depth.

**Risks.**
- Don't make the wrapper too clever. If it tries to do transactions across audit + primary + notifications, you'll fight Supabase's connection model.
- Consider whether the database is the better seam (DB-driven audit triggers) before committing to an app-layer wrapper.

**Suggested next step.** Before designing, *interview the user about reliability expectations*. If "missed audit row" is a P0, the database is the right seam. If it's P3, the app-layer wrapper is fine.

---

### Finding 6 — `Invite` lifecycle is fragmented across migrations, page components, and group actions

**Severity:** 2
**Files:**
- `migrations/group-invite-management.sql`
- `app/(app)/join/[code]/page.tsx`
- `app/(app)/groups/actions.ts` (`regenerateInvite`, `revokeInvite`, `validateInvite`)
- (Legacy bearer-token logic still exists alongside the managed-invite system)

**Problem.** The Invite domain has lifecycle, validation, attribution, and audit concerns, but it has no module. To understand "what happens when a user clicks a join link," you must read a page component, two server actions, a migration file, and an RLS policy. Tests cover individual actions but not the end-to-end lifecycle.

**Draft interface (proposed deep module).**

```ts
// lib/invites/index.ts
export type Invite = ManagedInvite | LegacyInvite;     // discriminated union

export async function resolveInvite(supabase, code): Promise<Invite | InviteError>;
export async function consumeInvite(supabase, invite, user): Promise<Membership>;
export async function regenerateInvite(supabase, groupId, opts): Promise<ManagedInvite>;
export async function revokeInvite(supabase, inviteId): Promise<void>;
```

Server actions and the `/join/[code]` page become thin adapters over this module.

**Benefits.**
- *Locality.* One file documents the entire invite lifecycle.
- *Test surface.* End-to-end invite scenarios become integration tests against the module, not coordinated multi-file tests.
- *Future work.* Adds a natural place to put rate limiting (called out as a security gap in `PROJECT_STATE_LOCAL.md`).

**Deletion test.** The lifecycle exists; it's just smeared. Centralising concentrates it without changing behaviour.

**Risks.** Don't migrate the SQL migration files — those are immutable history. Just consolidate the application-layer code that talks to those tables.

**Suggested next step.** This is a good candidate for after the auth/permission/side-effects work (Findings 2, 3, 5) lands, because the invite module will *want* to use those primitives.

---

### Finding 7 — Message component prop drilling (Message: 18 props, MessageList: 27 props)

**Severity:** 2
**Files:**
- `components/chat/Message.tsx` (props interface lines 18–49)
- `components/chat/MessageList.tsx` (props interface lines 21–56)

**Problem.** `Message` accepts 18 explicit props, most of which are callback handlers (`onStartEdit`, `onCancelEdit`, `onEditContentChange`, `onSubmitEdit`, `onDelete`, `onOpenProfile`, `onPickerToggle`, `onPickerClose`, `onEmojiSelect`, `onReact`, `onReply`, `onJumpToMessage`, `onOpenActions`, `onOpenContextMenu`, `onPin`, `onToggleSaved`). MessageList has 27, many forwarding callback factories to Message. The component is technically a leaf but its interface is huge — to use it elsewhere (e.g., in a search result preview, in a pinned-message panel), you have to thread or stub all 18 callbacks.

**Draft interface.** Move user-action callbacks behind a context or a single `useMessageActions(messageId)` hook:

```ts
// components/chat/MessageActionsContext.tsx
const MessageActions = createContext<{
  edit, delete, react, reply, pin, toggleSaved, openProfile, openContextMenu, ...
}>();

// Message.tsx
const actions = useMessageActions();   // no callback props
```

`Message` shrinks to data + presentation props. Action wiring lives at the orchestrator level once.

**Benefits.**
- *Reusability.* `Message` becomes safe to render in non-channel contexts (search preview, mention link target, pinned-message tray).
- *Locality.* All "what can a user do with a message" lives in one provider.

**Deletion test.** Today the 27-callback factory is the seam. It works but is shallow — the orchestrator must spell out every action explicitly. The proposed seam (context) is deeper.

**Risks.** Context propagation can mask which orchestrator owns which actions. Be explicit: each provider name should communicate scope (e.g., `ChannelMessageActionsProvider` vs `SearchResultMessageActionsProvider`).

**Suggested next step.** Lower priority than 1, 2, 3, 5. Pick this up if/when a second consumer for `Message` (search preview, mention deep-link) appears.

---

### Finding 8 — `middleware.ts` re-implements `createServerClient` inline

**Severity:** 2
**Files:**
- `middleware.ts` (lines 7–26)
- `lib/supabase/server.ts` (the canonical factory)

**Problem.** Three call sites for `createBrowserClient`/`createServerClient` — clean overall — but the middleware redefines its own cookie handler instead of importing `lib/supabase/server.ts`. Two slightly different cookie-handling implementations now exist. If Supabase changes auth cookie semantics (it has, recently), you must remember to update both.

**Draft interface.** Add a middleware-specific factory in `lib/supabase/`:

```ts
// lib/supabase/middleware.ts
export function createMiddlewareClient(req: NextRequest): { supabase: SupabaseClient; res: NextResponse };
```

`middleware.ts` then has zero `createServerClient` references; it just calls the factory.

**Benefits.** Single source of truth for auth cookie wiring. Trivial change.

**Deletion test.** Middleware would still need to call something. Move the duplication into a named module so future-you finds it.

**Risks.** None — this is straightforward cleanup.

**Suggested next step.** Quick win. Could land in a single small PR before the heavier refactors.

---

### Finding 9 — `DM_SELECT` defined locally in `dm/actions.ts`, parallel to `MESSAGE_SELECT` in `lib/queries.ts`

**Severity:** 2
**Files:**
- `lib/queries.ts` (`MESSAGE_SELECT`)
- `app/(app)/dm/actions.ts` (line 7, local `DM_SELECT`)

**Problem.** Both define multi-line PostgREST select strings that fetch profiles, attachments, metadata. The DM one is local; the channel-message one is shared. If a profile shape changes, both must be updated; right now only one is in the shared module.

**Draft interface.** Expand `lib/queries.ts` to host both — `MESSAGE_SELECT`, `DM_SELECT`, and any future ones — and consider whether the profile-join fragment can be DRY'd out.

**Benefits.** Minor. Locality.

**Deletion test.** Pure consolidation. Doesn't change behaviour.

**Suggested next step.** Quick win, can ride alongside Finding 8.

---

### Finding 10 — Multiple `Message`-shaped types (`Message`, `MessageWithProfile`, `MessageSearchResult`, `DirectMessageWithProfile`)

**Severity:** 1
**Files:** `lib/types.ts` (lines 100–132 and elsewhere)

**Problem.** Type fragmentation: each shape encodes a different invariant (`profiles` optional vs guaranteed, `channels` optional, etc.). Today's design is *defensible* — it makes invariants explicit at the type level. Listed here so a future reader doesn't propose "collapse them all to one type with optional fields"; that would be a regression.

**Draft interface.** No change recommended. Document the discrimination strategy in `CONTEXT.md` once that file exists.

**Suggested next step.** Skip unless you find a concrete bug stemming from the multiple shapes.

---

### Finding 11 — Notification preferences are fetched per-recipient, no caching

**Severity:** 1
**Files:** `lib/server-notifications.ts` (lines 54–80)

**Problem.** `mentionPreferenceMap` and `allowsDMNotifications` each issue a fresh query against `notification_preferences`. A burst of 10 mentions in one message triggers 10 queries.

**Draft interface.** Pass a `NotificationPreferenceLoader` (memoised per request) through the notification pipeline.

**Suggested next step.** Performance nit. Defer until you see it in observability.

---

### Finding 12 — Test coverage gaps: integration + realtime lifecycle

**Severity:** 2
**Files:** `tests/` directory.

**Problem.** Server-action tests are dense (3700+ lines, good). Hook tests exist but mock the realtime channel, so subscription lifecycle bugs hide. No component-integration tests for `MessageList + Message + useMessages`. No tests for `MessageInput` autocomplete (currently inline-query logic from Finding 4).

**Suggested next step.** *Don't* write coverage for coverage's sake. Add integration tests **as part of** the refactors above:
- Finding 1's `useRealtimeChannel` seam ships with subscribe/message/cleanup/re-subscribe tests.
- Finding 5's side-effects wrapper ships with audit-failure and notification-enqueue tests.
- Finding 6's invite module ships with end-to-end lifecycle tests.

---

## Cleanup items (not architecture — but adjacent)

These are noted in `PROJECT_STATE_LOCAL.md` already; including for completeness.

| File | Status | Action |
|---|---|---|
| `ChatView.jsx` (root) | Dead — superseded by `components/chat/*.tsx` | Delete |
| `DMView.jsx` (root) | Dead — superseded by `components/dm/*.tsx` | Delete |
| `ChannelsSidebar.jsx` (root) | Dead — superseded by `components/sidebar/ChannelsSidebar.tsx` | Delete |
| `GroupsSidebar.jsx` (root) | Dead | Delete |
| `Modals.jsx` (root) | Dead | Delete |
| `PresencePanel.jsx` (root) | Dead | Delete |
| `ProfileCard.jsx` (root) | Dead | Delete |
| `data.js` (root) | Prototype stub data | Delete |
| `SideBar Prototype.html` (root) | Initial HTML mock | Move to `docs/history/` or delete |
| `admin-dashboard-prompt.md` | Prompt scratch | Move to `docs/prompts/` |
| `group-avatar-prompt.md` | Prompt scratch | Move to `docs/prompts/` |
| `PEPCHAT_HELP_SYSTEM_DRAFT.md` | Help system draft (largely shipped) | Move to `docs/` or delete |

**None of these are referenced by live code.** Confirm with `git grep` before deletion. This is "before-the-refactor housekeeping" — it removes noise that confuses future agents (and humans) about which files are authoritative.

---

## Cross-cutting themes

Looking across all findings, three patterns dominate:

1. **Side-effect smearing.** Auth, role checks, audit writes, notification enqueues, and realtime subscriptions are all "things every action / every hook must remember to do." None is wrapped. The refactor that pays the highest dividend is centralising these (Findings 1, 2, 3, 5).
2. **Domain modules missing for "things that have a lifecycle."** Invites, notifications, and messages all have multi-step lifecycles whose code is scattered across actions/components/migrations. Pulling each into a single `lib/<domain>/` module would not change behaviour but would make the lifecycle legible.
3. **Component-embedded queries.** A handful of components reach into Supabase directly for what is really feature logic. Pulling these into hooks (Finding 4) clarifies the data contract.

The codebase is **healthy underneath**. RLS is solid, types are mostly clean, the permission predicates are unit-tested. The friction is at the integration seams, not the foundations.

---

## Recommended sequencing

**Phase 0 — Cleanup (1 PR, low risk):**
- Delete root-level dead JSX files.
- Move prompts/drafts to `docs/`.
- Finding 8 (middleware Supabase factory).
- Finding 9 (consolidate `DM_SELECT` into `lib/queries.ts`).
- Create `CONTEXT.md` and seed with the glossary above.

**Phase 1 — Server-side primitives (2–3 PRs):**
- Finding 3 (`withAuth` wrapper).
- Finding 2 (`gateGroupRole` + predicate sharing with `lib/permissions.ts`).
- Migrate `members/actions.ts`, then `groups/actions.ts`, then `channels/actions.ts` to use both.

**Phase 2 — Side-effects clarity (1–2 PRs):**
- Finding 5. Before writing code, **ask the user** whether app-layer wrapping or DB-trigger-based audit is the right seam (see Open Questions).
- Migrate one action's audit + notifications to the new pattern. Validate. Then migrate the rest.

**Phase 3 — Realtime + component hygiene (2–3 PRs):**
- Finding 1 (`useRealtimeChannel`). Spike against two hooks first; abandon if the abstraction explodes.
- Finding 4 (extract component-embedded queries to hooks).

**Phase 4 — Domain consolidation (optional, depends on roadmap):**
- Finding 6 (invite module). Most valuable when paired with the rate-limiting / abuse-controls work flagged in `PROJECT_STATE_LOCAL.md`.

**Defer / skip:** Findings 7, 10, 11. Reopen when a concrete second caller / bug / perf signal appears.

---

## Open questions for the user (ask before Phase 2)

1. **Audit reliability.** Is a missed audit row P0 (regulator-visible, compliance concern) or P3 (nice-to-have observability)? This determines whether Finding 5 lands in the app layer or the database trigger layer. *Strong recommendation: ask before designing.*
2. **Action-shape conventions.** All server actions today return `{ data } | { error }`. Is that a hard contract you want preserved, or is throwing acceptable? The `withAuth` wrapper design depends on this.
3. **Hook abstraction appetite.** Some teams prefer hooks-as-thin-wrappers and put logic in vanilla functions. Confirm before extracting `useRealtimeChannel` that the team wants subscription lifecycle inside a hook rather than a class/function.
4. **Invite consolidation timing.** Is the legacy bearer-token invite path being deprecated, or kept for backward compat indefinitely? Affects whether Finding 6 collapses both into a discriminated union or treats legacy invites as a deprecated alias.
5. **CONTEXT.md and ADR conventions.** This handoff proposes seeding `CONTEXT.md` and `docs/adr/`. Confirm the user wants those artifacts adopted; some teams treat them as overhead.

---

## What this handoff does *not* cover

- **No security review.** RLS policies were not deeply audited; `PROJECT_STATE_LOCAL.md` already enumerates security gaps. Findings here are architectural, not security-specific.
- **No performance profiling.** The two performance-shaped findings (Finding 11, parts of Finding 1) are inferred from code reading, not measured. Validate before optimising.
- **No build/deploy concerns.** Cloudflare Pages config and `wrangler.toml` were not reviewed.
- **No `supabase/` migrations review.** SQL files were scanned for context; not audited for migration safety.
- **No UI/UX critique.** Visual design, mobile polish, accessibility, and copy were out of scope.

---

## Provenance

- **Audit method:** `/improve-codebase-architecture` skill (deepening-opportunities pattern).
- **Exploration agent:** Explore subagent with broad walk across `lib/`, `app/(app)/`, `components/`, `middleware.ts`, `migrations/`, `tests/`.
- **Domain inputs:** `README.md`, `PROJECT_STATE_LOCAL.md`, `package.json`. No `CONTEXT.md` or `docs/adr/` existed at audit time.
- **Severity scale:** 1 (nit) → 5 (pervasive).
- **Deletion test applied:** to every shallow-suspect module before proposing change.

End of handoff.
