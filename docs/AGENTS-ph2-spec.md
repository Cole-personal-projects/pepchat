# Phase 2 — Side Effects & Remaining Action Migration (Technical Spec)

**Date:** 2025-05-17
**Author:** Cline (multi-session)
**Status:** DRAFT — awaiting team review
**Branch:** `pepchat-build-phase-2-side-effects` (to be created after Phase 1 merges)

---

## Executive Summary

Phase 2 introduces a controlled side-effect pipeline (`lib/actions/sideEffects.ts`) so that audit logging, notification fanout, and future telemetry channels fire *reliably* after every mutation action. Every side effect's failure behaviour is typed and explicit — no more swallowed errors.

We also finish migrating the remaining server actions to the `withAuth` wrapper so that **every** public server action goes through the same auth gate. This closes the window where an action can skip auth or permission checks.

### Scope

| Area | Status | What Changes |
|---|---|---|
| Side-effect wrapper | NEW | `lib/actions/sideEffects.ts` — `withSideEffects()` + typed draft interfaces |
| Audit module | UPGRADE | `lib/audit.ts` — failures stop being swallowed |
| Notification module | UPGRADE | `lib/server-notifications.ts` — pluggable into the pipeline |
| `messages/actions.ts` | MIGRATE | Uses `withAuth` for every action |
| `dm/actions.ts` | MIGRATE | Uses `withAuth` for every action |
| Admin actions | MIGRATE | Uses `withAuth` + `gateGroupRole` (where applicable) |
| Tests | ADD | Audit-failure, notification-failure, and migrated-action tests |
| Docs | ADD | `CONTEXT.md` side-effect seam section |

### Out of Scope (deferred to Phase 3/4)

- Realtime subscription extraction (`useRealtimeChannel`)
- Component-embedded query extraction (`useMentionCandidates`, etc.)
- Invite lifecycle module consolidation
- Message prop-drilling reduction via context

---

## Background & Rationale

### The Problem

Every mutation action in SideBar must (in theory) do three things:

1. **Mutate** the primary data (insert message, change role, update channel topic, etc.)
2. **Audit** the change into the `audit_log` table (who did what, when, on which target)
3. **Notify** affected users (mention notifications, DM notifications, report-resolved notifications)

Today this is **hand-rolled per action**. Consequences:

- `logAuditEvent` silently swallows failures (`catch {}` block in `lib/audit.ts`). A silent audit failure means a compliance/regulatory gap — and nothing tells you it happened until a human reviews logs.
- `enqueueMentionNotifications` is wrapped in `try/catch {}` in `messages/actions.ts`. Same problem: notification failures are invisible.
- Adding a new side-effect channel (e.g., Slack integration, telemetry metrics) requires editing 20+ action files.
- No compile-time guarantee that an action that *should* produce an audit row actually calls `logAuditEvent`.
- Some actions (`messages/actions.ts`, `dm/actions.ts`) still create their own Supabase client and call `getUser()` inline — inconsistent with Phase 1's `withAuth` standard.

### The Fix

A typed `withSideEffects` HOF that takes a primary mutation and a declarative list of side-effect drafts. The runner:

1. Executes `primary`
2. If `primary` succeeds, executes each side effect in order
3. Reports failures transparently (configurable per channel: bubble-up vs downgrade-to-warning with typed reason)
4. Never lets a side effect silently disappear

We also finish the `withAuth` migration so the action surface is uniform.

---

## Design Decisions (Recorded)

| Decision | Rationale | Trade-off |
|---|---|---|
| App-layer wrapper (not DB triggers) | Lowest lift, immediate benefit, composable in TypeScript. DB triggers would need Edge Functions or `pg_notify` plumbing. | Slightly weaker guarantee if app crashes between primary and side-effect writes. But Supabase Postgres transactions already cover the primary write; we accept the tiny window. |
| Side-effect failures are *typed* | A new `SideEffectResult` discriminant tells the caller whether audit/notification succeeded, failed-bubble, or failed-downgraded. | Caller must handle the typed result if they care; otherwise it's optional. |
| No transactional grouping across primary + side-effects | Supabase's connection model makes cross-statement transactions awkward. Each side effect is idempotent-friendly. | Audit/notification writes may lag the primary mutation by milliseconds. Acceptable for messaging apps. |
| Migration is incremental | Migrate one action file per PR; each PR ships its own tests. | Slower full migration, but lower per-PR risk and faster integration. |

---

## Detailed Specification

### 1. Side-Effect Wrapper (`lib/actions/sideEffects.ts`)

#### 1.1 Interfaces

```ts
// lib/actions/sideEffects.ts

import type { SupabaseClient } from '@supabase/supabase-js'

export type AuditEventDraft = {
  action: string
  targetType: string | null
  targetId: string | null
  metadata?: Record<string, unknown>
}

export type NotificationDraft = {
  type: 'mention' | 'dm_message' | 'report_resolved' | string
  payload: Record<string, unknown>  // typed per variant below
}

export interface SideEffectsConfig {
  audit?: AuditEventDraft
  notifications?: NotificationDraft[]
  /** Runs after primary succeeds but before side-effects fire. Use to patch in post-hoc IDs. */
  afterCommit?: (primaryResult: T) => Promise<void>
  /** Controls whether failures bubble or are downgraded. Default: downgrade */
  onFailure?: 'bubble' | 'downgrade' | 'silent'
}

export type SideEffectResult =
  | { ok: true }
  | { ok: false; reason: 'audit_failed'; error: unknown }
  | { ok: false; reason: 'notification_failed'; error: unknown }
  | { ok: false; reason: 'unknown_side_effect'; error: unknown }
```

#### 1.2 `withSideEffects` Signature

```ts
/**
 * Runs a primary mutation, then fires each declared side effect.
 *
 * @param supabase - Server-side Supabase client
 * @param primary  - Async function that performs the core mutation.
 *                   The return value is passed through unchanged.
 * @param effects  - Declarative side-effect drafts.
 * @returns The primary return value, wrapped with side-effect diagnostics.
 */
export async function withSideEffects<T>(
  supabase: SupabaseClient,
  primary: () => Promise<T>,
  effects?: SideEffectsConfig,
): Promise<{ data: T; sideEffects: SideEffectResult }>
```

#### 1.3 Implementation Outline

```ts
export async function withSideEffects<T>(
  supabase: SupabaseClient,
  primary: () => Promise<T>,
  effects: SideEffectsConfig = {},
): Promise<{ data: T; sideEffects: SideEffectResult }> {
  const data = await primary()

  // Run afterCommit first so drafts can reference post-hoc IDs
  if (effects.afterCommit) {
    await effects.afterCommit(data)
  }

  const result: SideEffectResult = { ok: true }
  const policy = effects.onFailure ?? 'downgrade'

  // Audit side effect
  if (effects.audit) {
    try {
      await logAuditEvent(supabase, adminId, effects.audit)
    } catch (e) {
      if (policy === 'bubble') throw e
      return { data, sideEffects: { ok: false, reason: 'audit_failed', error: e } }
    }
  }

  // Notification fanout
  if (effects.notifications?.length) {
    for (const draft of effects.notifications) {
      try {
        await dispatchNotification(supabase, draft)
      } catch (e) {
        if (policy === 'bubble') throw e
        return { data, sideEffects: { ok: false, reason: 'notification_failed', error: e } }
      }
    }
  }

  return { data, sideEffects: result }
}
```

> **Note on `adminId`:** The wrapper doesn't know the user ID directly. Two options:
> 1. Pass it through the `AuditEventDraft` (cleaner separation).
> 2. Require `primary` to be called inside `withAuth`, so we read `user.id` from context.
> 
> **Decision:** Option 1 — the wrapper will accept an `actorId` parameter so it's self-contained. This keeps it composable without requiring `withAuth` (though the typical usage will compose them).

#### 1.4 Composition with `withAuth`

The canonical composition is:

```ts
export const sendMessage = withAuth(
  async function sendMessageBody({ supabase, user }, channelId, content, ...) {
    const result = await withSideEffects(
      supabase,
      actorId: user.id,
      async () => {
        /* insert message, return it */
      },
      {
        audit: { action: 'message_sent', targetType: 'message', targetId: null },
        notifications: [{ type: 'mention', payload: { ... } }],
        onFailure: 'downgrade',  // mention notifications failing shouldn't block the send
      },
    )
    return result
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)
```

Because the audit draft doesn't know the post-hoc `message.id` at call time, `withSideEffects` accepts the optional `afterCommit` hook that fires *after* the primary returns but *before* side effects:

```ts
export interface SideEffectsConfig {
  audit?: AuditEventDraft
  notifications?: NotificationDraft[]
  afterCommit?: (primaryResult: T) => Promise<void>
  onFailure?: 'bubble' | 'downgrade' | 'silent'
}
```

This lets the caller mutate the draft based on the primary's return value (e.g., fill in `messageId` for mention notifications).

### 2. Audit Module Upgrade (`lib/audit.ts`)

Current:
```ts
export async function logAuditEvent(supabase, adminId, action, targetType, targetId, metadata = {}) {
  try {
    await supabase.from('audit_log').insert(...)
  } catch {
    // Audit failures should never block the primary moderation or admin action.
  }
}
```

New:
```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuditInsert {
  admin_id: string
  action: string
  target_type: string | null
  target_id: string | null
  metadata: Record<string, unknown>
}

/**
 * Writes an audit row. Throws on failure so callers can decide whether
 * to bubble or downgrade.
 */
export async function logAuditEvent(
  supabase: SupabaseClient,
  adminId: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase
    .from('audit_log')
    .insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId, metadata })

  if (error) {
    console.error('[Audit] Failed to write row', error)
    throw new Error(`Audit log insert failed: ${error.message}`)
  }
}
```

**Rationale:** The wrapper owns the failure policy. The primitive should fail loudly so the wrapper can enforce `onFailure: 'bubble' | 'downgrade'`.

### 3. Notification Module Upgrade (`lib/server-notifications.ts`)

Add a `dispatchNotification` entry point that the side-effect pipeline calls:

```ts
export async function dispatchNotification(
  supabase: SupabaseClient,
  draft: NotificationDraft,
): Promise<void> {
  switch (draft.type) {
    case 'mention':
      return enqueueMentionNotifications(supabase, draft.payload as MentionNotificationInput)
    case 'dm_message':
      return enqueueDirectMessageNotification(supabase, draft.payload as DirectMessageNotificationInput)
    case 'report_resolved':
      /* future: enqueueReportResolutionNotification(...) */
      break
    default:
      console.warn(`[Notifications] Unknown type: ${draft.type}`)
  }
}
```

### 4. Action Migration Plan

#### 4.1 Files to Migrate

| File | Actions | Auth pattern today | Target |
|---|---|---|---|
| `app/(app)/messages/actions.ts` | sendMessage, searchMessages, editMessage, deleteMessage, pinMessage, unpinMessage | Inline `createClient` + `getUser` | `withAuth` |
| `app/(app)/dm/actions.ts` | sendDirectMessage, markDMRead | Inline `createClient` + `getUser` | `withAuth` |
| `app/(app)/members/actions.ts` | changeRole, removeMember | Already uses `withAuth` | Add side-effects |
| `app/(app)/channels/actions.ts` | createChannel, updateChannel, deleteChannel, updateChannelTopic | Already uses `withAuth` | Add side-effects (audit already hand-rolled) |
| `app/(app)/groups/actions.ts` | All group actions | Already uses `withAuth` | Audit calls via wrapper |

#### 4.2 Migration Pattern

For each action:

1. Wrap with `withAuth`
2. Extract primary mutation
3. Declare side effects (audit + notifications)
4. Run through `withSideEffects`
5. Return `{ data, sideEffects }` or adapt to existing return shape
6. Add/updated test covering: success path, audit-failure-downgrade, notification-failure-silent

Example for `sendMessage` in `app/(app)/messages/actions.ts`:

```ts
'use server'

import { withAuth } from '@/lib/actions/withAuth'
import { withSideEffects } from '@/lib/actions/sideEffects'
import { MESSAGE_SELECT } from '@/lib/queries'
import type { MessageWithProfile, Attachment } from '@/lib/types'

export const sendMessage = withAuth(
  async function sendMessageBody(
    { supabase, user },
    channelId: string,
    content: string,
    replyToId?: string | null,
    attachments?: Attachment[],
  ): Promise<{ error: string } | { ok: true; message: MessageWithProfile }> {
    const trimmed = content.trim()
    if (!trimmed && (!attachments || attachments.length === 0))
      return { error: 'Message cannot be empty.' }
    if (trimmed.length > 4000)
      return { error: 'Message too long (max 4000 characters).' }

    const result = await withSideEffects(
      supabase,
      user.id,
      async () => {
        const { data: message, error } = await supabase
          .from('messages')
          .insert({
            channel_id: channelId,
            user_id: user.id,
            content: trimmed,
            reply_to_id: replyToId ?? null,
            attachments: attachments ?? [],
          })
          .select(MESSAGE_SELECT)
          .single()

        if (error || !message)
          return { error: error?.message ?? 'Failed to send message.' }

        return { ok: true, message: message as MessageWithProfile }
      },
      {
        afterCommit: async (primaryResult) => {
          // Notification payloads can now reference primaryResult.message.id
        },
        audit: {
          action: 'message_sent',
          targetType: 'message',
          targetId: null,
          metadata: { channel_id: channelId },
        },
        notifications: [
          {
            type: 'mention',
            payload: {
              senderId: user.id,
              senderName: '',
              messageId: '',
              channelId,
              content: trimmed,
            },
          },
        ],
        onFailure: 'downgrade',
      },
    )

    if ('error' in result.data) return result.data as { error: string }
    return result.data
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)
```

> **Note:** The `afterCommit` hook pattern lets us fill in post-hoc IDs. This is more flexible than requiring all side-effect data at call time.

### 5. Test Plan

#### 5.1 New Tests (per PR)

| Test | What it verifies | File |
|---|---|---|
| `sideEffects-bubble` | `onFailure: 'bubble'` throws on audit failure | `tests/app/sideEffects.test.ts` |
| `sideEffects-downgrade` | `onFailure: 'downgrade'` returns typed error | `tests/app/sideEffects.test.ts` |
| `sideEffects-silent` | `onFailure: 'silent'` swallows with warning log | `tests/app/sideEffects.test.ts` |
| `sideEffects-afterCommit` | `afterCommit` patch works for post-hoc IDs | `tests/app/sideEffects.test.ts` |
| `sendMessage-withSideEffects` | Primary succeeds, notification enqueues, audit writes | `tests/app/messages-actions.test.ts` |
| `audit-throw-on-failure` | New `logAuditEvent` throws on DB error | `tests/app/audit.test.ts` |

#### 5.2 Existing Tests to Update

- `tests/app/message-actions.test.ts` — update mocks to reflect `withAuth` composition
- `tests/app/mentionNotifications.test.ts` — add failure path tests

#### 5.3 Shared Test Helpers

Add to `tests/supabase-mocks.ts`:

```ts
export function mockSupabaseWithAuditFailure(): SupabaseClient
export function mockSupabaseWithNotificationFailure(): SupabaseClient
```

These return partial Supabase mocks that fail only on `audit_log.insert` or `notification_events.insert`, letting us test failure isolation.

---

## Sequencing

### PR 1: Side-Effect Wrapper + Audit Fix (~3 days)

1. Create `lib/actions/sideEffects.ts` with full interface + implementation
2. Upgrade `lib/audit.ts` to throw on failure
3. Add `dispatchNotification` to `lib/server-notifications.ts`
4. Write unit tests for all three `onFailure` modes
5. Add fake Supabase client helpers for audit/notification failure paths
6. Update `CONTEXT.md` side-effect seam section

### PR 2: Migrate `messages/actions.ts` (~2 days)

1. Wrap every action in `withAuth`
2. Add `withSideEffects` for `sendMessage` (audit + mention notifications)
3. Add `withSideEffects` for `editMessage`, `deleteMessage`, `pinMessage` (audit only)
4. Update `tests/app/message-actions.test.ts`
5. Verify build + runtime behavior

### PR 3: Migrate `dm/actions.ts` + `members/actions.ts` side-effects (~2 days)

1. Wrap DM actions in `withAuth`
2. Add side-effects for DM sends (audit + DM notifications)
3. Polish `members/actions.ts` audit calls through the wrapper
4. Update tests
5. Verify build + runtime behavior

### PR 4: Finish remaining action files + docs (~1 day)

1. Migrate any stragglers (admin actions, etc.)
2. Final `CONTEXT.md` side-effect section
3. Cross-link to Phase 1 `withAuth` documentation
4. Self-service checklist for "how to add a new side-effect channel"

**Total estimate:** ~8–10 days across 4 PRs

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Side-effect wrapper adds call depth, confusing Next.js build | Build errors | Test each PR under `next build` incrementally |
| `afterCommit` pattern is leaky abstractions | Hard to reason about | Document the pattern; constrain it to post-hoc ID population only |
| Audit failures bubble and block user actions | Bad UX | Default to `downgrade` for user-facing actions; `bubble` only for admin/moderation actions |
| Migration PRs touch many files | Review fatigue | One action file per PR, each with its own test suite |
| Existing tests break during migration | Regression | Run existing server-action test suite in CI for every PR |

---

## Acceptance Criteria

- [ ] `lib/audit.ts` throws on failure (no silent swallow)
- [ ] `lib/actions/sideEffects.ts` exists, is fully typed, and has unit tests for all `onFailure` modes
- [ ] Every public server action uses `withAuth`
- [ ] Every mutation action that *should* produce audit/notification side effects goes through `withSideEffects`
- [ ] Existing server-action tests still pass (updated for new signatures)
- [ ] `CONTEXT.md` documents the side-effect seam
- [ ] `SELF-SERVICE-QUICK-STARTS.md` includes "how to add a new side-effect channel"

---

## Cross-Cutting Notes (Agent Instructions)

### For Future Agents

1. **The side-effect seam is `lib/actions/sideEffects.ts`.** Every mutation that touches audit or notifications *must* go through `withSideEffects`. Hand-rolling `logAuditEvent` or `enqueue*Notification` calls outside the wrapper is a code smell.

2. **`onFailure` policy is per-action.** User-facing actions (send message, change role) default to `downgrade`. Admin-only actions (report review, ban, delete group) default to `bubble`. This is a design choice, not an accident.

3. **Audit failures are now visible.** If `logAuditEvent` throws and the action's `onFailure` is `bubble`, the action fails. The caller should surface a generic "something went wrong" message, not the raw audit error.

4. **Notification fanout is fire-and-forget by design** for user-facing actions. `onFailure: 'downgrade'` means the user's message goes through even if mention notifications fail. The failure is logged and visible in observability.

5. **The `afterCommit` hook exists for one purpose:** filling in IDs that only exist after the primary mutation completes (e.g., `messageId` for mention notifications). Don't use it for business logic.

---

## Open Questions

1. **Should the side-effect wrapper live in `lib/actions/` or `lib/`**?
   - *Recommendation:* `lib/actions/sideEffects.ts` — keeps it scoped to the server-action pattern.

2. **Should we introduce an `ActionResult<T>` discriminated union** that wraps both primary success/failure and side-effect diagnostics?
   - *Recommendation:* No. `ActionResult` already exists for primary mutations. Side-effect results are optional metadata. Keep them separate to avoid signature explosion.

3. **What about idempotency?** If an action is retryable, `withSideEffects` could fire audit/notification twice.
   - *Recommendation:* Audit rows are idempotent-friendly (insert-or-nothing on composite key). Notification inserts into `notification_events` are safe to duplicate (the consumer deduplicates). No action needed in Phase 2.

4. **Should we add a "dry-run" mode for testing?**
   - *Recommendation:* No. Unit tests with mocked Supabase clients are sufficient.

---

## References

- Phase 1 spec: `docs/AGENTS.md` (Phase 1 section)
- Audit module: `lib/audit.ts`
- Notification module: `lib/server-notifications.ts`
- Server actions: `app/(app)/messages/actions.ts`, `app/(app)/dm/actions.ts`, `app/(app)/members/actions.ts`, `app/(app)/channels/actions.ts`, `app/(app)/groups/actions.ts`
- Test suite: `tests/app/`
- Supabase server client: `lib/supabase/server.ts`
- CONTEXT.md: `CONTEXT.md`
