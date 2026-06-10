# Spec: Discord-Style Voice Rooms (Temporary + Persistent)

**Status:** Ready for implementation
**Owner:** (handoff to coding swarm)
**Target branch base:** `feat/voice-channel-backend-lifecycle`
**Complexity:** Large (DB + server actions + cleanup infra + realtime UX)

---

## 1. Goal

Add Discord-style voice rooms to SideBar with **two room classes**:

1. **Persistent voice channels** ("Common Room" type) — admin-created, always visible, never auto-removed. When empty they go *idle* (LiveKit session torn down, channel row stays).
2. **Temporary voice chats** — created by regular users on the fly, visible to the whole group, and **fully deleted (DB row + LiveKit room) once the last participant leaves** — including on tab-close / crash.

v1 in-room UX = **core presence + deafen + push-to-talk**. Screen-share, video, and in-room server-side moderation are explicitly **out of scope for v1** (documented fast-follow in §11).

### Permission matrix (authoritative)

| Role | Join voice | Create **temp** voice chat | Create **persistent** voice channel |
|---|---|---|---|
| `noob` | Only `welcome` / `noob_access=true` channels | ❌ | ❌ |
| `user` | ✅ | ✅ | ❌ |
| `moderator` | ✅ | ✅ | ❌ |
| `admin` | ✅ | ✅ | ✅ |

> Persistent creation is **admin-only** by product decision (note: this is stricter than the existing `canManageChannels`, which includes moderators — see §5).

---

## 2. Current state (what already exists — build ON this, do not rewrite)

| Area | File(s) | Notes |
|---|---|---|
| Roles enum | `schema.sql` → `public.member_role` = `('admin','moderator','user','noob')` | |
| Permissions hub | `lib/permissions.ts` → `PERMISSIONS` | All role rules centralize here |
| Persistent voice channels | `channels.kind = 'voice'` (migration `20260529090000_voice_channel_lifecycle.sql`) | `channels` also has `noob_access`, `position`, `group_id`, `name` |
| Ephemeral LiveKit session table | `voice_rooms` (migration `20260526000000_voice_rooms.sql`) | `status ∈ ('open','idle','closed')`; `provider_room_name unique`; one live room per channel |
| Participant tracking | `voice_room_participants` (+ `voice_room_occupancy` view) | `left_at IS NULL` = active; 45s stale heartbeat window |
| Room lib | `lib/voice/rooms.ts` | Lifecycle helpers (see §2.1) |
| Server actions | `app/(app)/voice/actions.ts` | `listVoiceChannels`, `startVoiceRoom`, `getCurrentVoiceRoom`, `joinVoiceChannel`, `mintVoiceToken`, `heartbeatVoiceRoom`, `leaveVoiceRoom` |
| Token minting | `lib/voice/livekit.ts` | `mintLiveKitToken({ providerRoomName, userId })` |
| Provider room naming | `lib/voice/providerRoomName.ts` | `deriveProviderRoomName(id)` |
| Sidebar UI | `components/sidebar/VoiceChannelsSection.tsx` | Join / mute / leave + participant count |
| In-room hook/panel | `components/voice/useVoiceRoomConnection.ts`, `components/voice/VoiceRoomPanel.tsx` | LiveKit connect/mute |
| Tests | `tests/{app,lib,db,components}/voice/*` | Vitest; mirror these |

### 2.1 Existing `lib/voice/rooms.ts` contracts (do not break signatures)

```ts
resolveVoiceChannel(supabase, channelId): Promise<VoiceChannel | null>
resolveVoiceRoom(supabase, roomId): Promise<VoiceRoom | null>
getOpenVoiceRoomForChannel(adminClient, channelId): Promise<VoiceRoom | null>
getLiveVoiceRoomForChannel(adminClient, channelId): Promise<VoiceRoom | null>   // open|idle
createOrReuseVoiceRoom(adminClient, { channelId, groupId, createdBy }): Promise<VoiceRoom | { error }>
getVoiceRoomParticipantCount(adminClient, roomId): Promise<number>
listAccessibleVoiceChannelsWithOccupancy(adminClient, { groupId, role }): Promise<VoiceChannelWithOccupancy[] | { error }>
upsertVoiceParticipant(adminClient, { roomId, userId }): Promise<{ ok:true } | { error }>
touchVoiceParticipant(adminClient, { roomId, userId }): Promise<{ ok:true } | { error }>
markVoiceParticipantLeft(adminClient, { roomId, userId }): Promise<{ ok:true } | { error }>
cleanupStaleVoiceParticipants(adminClient, { roomId?, channelId?, groupId?, staleAfterSeconds? }): Promise<{ ok:true } | { error }>
closeVoiceRoomIfEmpty(adminClient, { roomId }): Promise<{ ok:true; closed:boolean } | { error }>   // ← extension point (§7)
```

---

## 3. Architecture decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Temp room data model | **Reuse `channels` + `is_ephemeral` flag** | Smallest diff; reuses participants/occupancy/tokens/RLS/UI; one lifecycle |
| Empty-temp cleanup trigger | **LiveKit webhooks (primary) + Supabase pg_cron sweep (backstop)** | Near-instant + crash-proof; Pages has no cron, so backstop is pg_cron not CF cron |
| Persistent create permission | **Admin only** | Product requirement |
| v1 UX scope | **Core presence + deafen + push-to-talk** | Highest value on existing LiveKit connection |
| Write path | **Server action gates role → service-role admin client writes** | Mirrors existing pattern; RLS stays SELECT-only — do NOT add authenticated INSERT policies for channels |

---

## 4. Data model changes

### 4.1 Migration A — `supabase/migrations/<ts>_voice_ephemeral_channels.sql`

Append-only, idempotent. Adds the ephemeral flag + creator to `channels`.

```sql
alter table public.channels
  add column if not exists is_ephemeral boolean not null default false;

alter table public.channels
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- Fast lookups for the reaper and the voice list.
create index if not exists channels_ephemeral_voice_idx
  on public.channels(group_id)
  where kind = 'voice' and is_ephemeral = true;
```

**Semantics:**
- `is_ephemeral = false` → persistent (existing behavior; empty → `voice_rooms.status='idle'`).
- `is_ephemeral = true` → temp (empty → **DELETE the channel row**; cascade removes `voice_rooms` + `voice_room_participants`).
- `created_by` is informational/attribution only — deletion is driven by **emptiness**, not ownership.

### 4.2 Migration B — `supabase/migrations/<ts>_voice_reaper_cron.sql`

Backstop sweeper (see §8.2). Security-definer function + pg_cron schedule.

```sql
create extension if not exists pg_cron;

create or replace function public.reap_empty_ephemeral_voice_channels(p_stale_seconds int default 45)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  with empty_temp as (
    select c.id
    from public.channels c
    where c.kind = 'voice'
      and c.is_ephemeral = true
      and not exists (
        select 1
        from public.voice_rooms vr
        join public.voice_room_participants vrp on vrp.room_id = vr.id
        where vr.channel_id = c.id
          and vrp.left_at is null
          and vrp.last_seen_at > now() - make_interval(secs => p_stale_seconds)
      )
      -- grace period so a just-created, not-yet-joined temp channel isn't reaped
      and c.created_at < now() - make_interval(secs => p_stale_seconds)
  )
  delete from public.channels c using empty_temp e where c.id = e.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- run every minute
select cron.schedule('reap-ephemeral-voice', '* * * * *',
  $$select public.reap_empty_ephemeral_voice_channels();$$);
```

> If `pg_cron` is unavailable on the plan, fall back to a single Cloudflare **Worker** (separate from Pages) with a cron trigger calling an authenticated reap endpoint. pg_cron preferred.

---

## 5. Permissions (`lib/permissions.ts`)

Add to `PERMISSIONS` (keep all rules here; UI + server actions both consume them):

```ts
/** Can create an ephemeral (temporary) voice chat. Everyone except noobs. */
canCreateTempVoiceChannel: (role: Role) =>
  (['admin', 'moderator', 'user'] as Role[]).includes(role),

/** Can create a persistent voice channel ("Common Room"). Admin only. */
canCreatePersistentVoiceChannel: (role: Role) => role === 'admin',
```

**Reconcile `canStartVoiceRoom`** (currently admin/mod, used by the `startVoiceRoom` action):
- Its old meaning ("open a session on an existing channel") is now covered by `joinVoiceChannel` (which already create-or-reuses a room).
- **Action:** either delete `canStartVoiceRoom` + the `startVoiceRoom` action if unused by the UI, or repoint it to `canCreatePersistentVoiceChannel`. Audit callers first (`grep -rn "startVoiceRoom\|canStartVoiceRoom"`).

`canAccessChannel` / `canJoinVoiceRoom` / `canManageChannels` — **unchanged**.

---

## 6. Server actions (`app/(app)/voice/actions.ts` + channel actions)

All new actions mirror existing structure: `withAuth(...)`, `gateGroupRole(...)`, generic `denied()` error (`'Cannot join this room.'` or a creation-specific message), lazy `import('@/lib/voice/rooms')`.

### 6.1 New: `createTempVoiceChannel`

```ts
createTempVoiceChannel(groupId: string, name?: string):
  Promise<{ ok: true; room: VoiceRoomSummary } & MintedToken | { error: string }>
```

Flow:
1. `gateGroupRole(supabase, { groupId, userId, predicate: PERMISSIONS.canCreateTempVoiceChannel })`.
2. Resolve display name → default `"{username}'s Room"` (see §10 Open Decisions).
3. Admin-client insert into `channels`: `{ group_id, name, kind:'voice', is_ephemeral:true, created_by:userId, noob_access:false, position: <next> }`.
4. `createOrReuseVoiceRoom(...)` → `upsertVoiceParticipant(...)` → `mintLiveKitToken(...)`.
5. Return same shape as `joinVoiceChannel`.

### 6.2 New: `createPersistentVoiceChannel` (or extend channel-create)

- Prefer extending existing `app/(app)/channels/actions.ts` + `lib/channels/createChannelInternal.ts` to accept `kind:'voice'`.
- Gate **`canCreatePersistentVoiceChannel`** (admin) when `kind==='voice' && !is_ephemeral`.
- `is_ephemeral:false`.

### 6.3 Unchanged actions
`listVoiceChannels`, `getCurrentVoiceRoom`, `joinVoiceChannel`, `mintVoiceToken`, `heartbeatVoiceRoom`, `leaveVoiceRoom` keep working. `listAccessibleVoiceChannelsWithOccupancy` already returns both persistent and ephemeral voice channels (both are `kind='voice'`) — surface `is_ephemeral` in its row type so the UI can label/sort.

---

## 7. Lifecycle: self-destruct on empty

**Single choke point:** extend `closeVoiceRoomIfEmpty` in `lib/voice/rooms.ts` (every exit path — `leaveVoiceRoom`, `cleanupStaleVoiceParticipants`, heartbeat — already funnels here).

New behavior:
```
participantCount = getVoiceRoomParticipantCount(roomId)
if participantCount > 0: return { ok:true, closed:false }

resolve channel for room → is_ephemeral?
  ├─ ephemeral: DELETE channels row where id = channelId        // cascade drops voice_rooms + participants
  │             return { ok:true, closed:true, deleted:true }
  └─ persistent: UPDATE voice_rooms SET status='idle', closed_at=now() WHERE id=roomId AND status='open'
                 return { ok:true, closed:true, deleted:false }
```

- Make the DELETE idempotent / race-safe (guard on still-empty; webhook + cron + leave may all fire).
- Return type extends to include `deleted?: boolean` (additive, non-breaking).

---

## 8. Cleanup infrastructure

### 8.1 LiveKit webhook (primary) — `app/api/voice/livekit-webhook/route.ts`

- Verify signature with LiveKit `WebhookReceiver` using `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`.
- Handle events:
  - `participant_left` → look up `voice_rooms.provider_room_name == event.room.name` → `closeVoiceRoomIfEmpty({ roomId })`.
  - `room_finished` → same, reconcile DB to LiveKit truth.
- **Idempotent**, returns 200 quickly. Writes via admin client (no user session in a webhook).
- Register the public URL in the LiveKit project console.
- **Runtime caveat:** verify `WebhookReceiver` runs under the project's edge/`nodejs_compat` setup early (see Risks). If it can't, host this one route on Node runtime.

### 8.2 pg_cron backstop (secondary)
- Migration B (§4.2). Catches anything webhooks miss (dropped event, LiveKit outage), bounded by the 45s stale window + grace period.

### 8.3 Existing lazy cleanup
- Keep `cleanupStaleVoiceParticipants` calls in `listVoiceChannels`/`join`/etc. as a third safety net.

---

## 9. In-room UX (v1: presence + deafen + PTT)

### 9.1 Token enrichment — `lib/voice/livekit.ts`
- Include display name + avatar URL in the LiveKit token (identity = `userId`; `name` + `metadata` = `{ username, avatarUrl }`) so the client can render participants without an extra round-trip.

### 9.2 `components/voice/useVoiceRoomConnection.ts`
Expose:
- `participants`: `{ identity, name, avatarUrl, isSpeaking, isMuted, isLocal }[]` (from LiveKit room + active-speaker events).
- `muted` / `toggleMute` (exists).
- `deafened` / `toggleDeafen` → disable/enable **all remote audio** locally (also implies mic muted while deafened, Discord-style).
- `pushToTalk`: mode toggle + keybind (default hold `Space` when room focused / a configurable key); mic enabled only while held.

### 9.3 `components/voice/VoiceRoomPanel.tsx` + `components/sidebar/VoiceChannelsSection.tsx`
- Participant list: avatar + name + **live speaking ring** (animated when `isSpeaking`), mute glyph.
- Controls: mute, **deafen**, **push-to-talk** toggle, leave.
- **"+ New voice chat"** affordance (visible to `canCreateTempVoiceChannel`) → calls `createTempVoiceChannel`.
- Admin-only entry to create a **persistent** channel (reuse `CreateChannelModal` with `kind='voice'`).
- Label/sort: persistent channels first, temp chats grouped under a "Temporary" subheading with a transient style.

---

## 10. Open decisions (DEFAULTED — override here if desired)

| # | Question | **Default applied** |
|---|---|---|
| 1 | Temp chat visibility | **Group-wide visible & joinable** (Discord-style; shows in voice list to all members) |
| 2 | Temp chat naming | **Prompt optional**, default `"{username}'s Room"` |
| 3 | Auto-seed "Common Room" | **Yes** — seed one persistent `Common Room` voice channel on group creation (low-risk, Phase 5). Set to **No** to leave persistent creation fully manual. |

---

## 11. Out of scope for v1 (fast-follow)

- Screen share + camera/video tracks (tiled grid).
- In-room server-side moderation (force-mute / disconnect via LiveKit server API).
- Per-user client volume, noise suppression toggle, channel user-limit, drag-to-move, region selection.

---

## 12. Work packages (for parallel agents)

Dependency order: **WP-1 → (WP-2, WP-3, WP-5) → WP-4 → WP-6 → WP-7**. WP-2/WP-3/WP-5 are parallelizable once WP-1 lands. Contracts in §2.1/§5/§6/§7 are the integration seams — honor them exactly so agents don't collide.

| WP | Title | Files | Depends on |
|---|---|---|---|
| **WP-1** | Schema + permissions foundation | Migration A (§4.1); `lib/permissions.ts` (§5) | — |
| **WP-2** | Temp creation action | `app/(app)/voice/actions.ts` (§6.1) | WP-1 |
| **WP-3** | Persistent creation gating | `app/(app)/channels/actions.ts`, `lib/channels/createChannelInternal.ts`, `components/modals/CreateChannelModal.tsx` (§6.2) | WP-1 |
| **WP-4** | Self-destruct lifecycle | `lib/voice/rooms.ts` `closeVoiceRoomIfEmpty` (§7) | WP-1 |
| **WP-5** | Reaper backstop | Migration B (§4.2) | WP-1 |
| **WP-6** | LiveKit webhook | `app/api/voice/livekit-webhook/route.ts` (§8.1); env/config | WP-4 |
| **WP-7** | In-room UX | `lib/voice/livekit.ts`, `components/voice/useVoiceRoomConnection.ts`, `components/voice/VoiceRoomPanel.tsx`, `components/sidebar/VoiceChannelsSection.tsx` (§9) | WP-2, WP-4 |

---

## 13. Testing requirements

Mirror existing suites; TDD (write failing test first). Vitest. Target ≥80% on new logic.

| WP | Tests (mirror) |
|---|---|
| WP-1 | `tests/lib/permissions*` — every role × {temp, persistent}; `tests/db/*` — migration applies, columns/index exist |
| WP-2 | `tests/app/voice/actions.test.ts` — noob denied; user/mod/admin create temp; returns token; participant inserted |
| WP-3 | channel-create tests — only admin creates persistent voice; mod/user denied; noob denied |
| WP-4 | `tests/lib/voice/rooms.test.ts` — ephemeral empty → channel deleted; persistent empty → idle; non-empty → untouched; race idempotency |
| WP-5 | `tests/db/voice-reaper.test.ts` — reaps empty temp past grace; spares occupied + persistent + fresh-unjoined |
| WP-6 | webhook handler unit — valid sig → reap; bad sig → 401; idempotent on repeat |
| WP-7 | `tests/components/voice/*` — participant list renders names/avatars; speaking indicator toggles; deafen disables remote audio; PTT gates mic |

**Manual E2E acceptance:**
1. As `user`: create temp chat → join → leave alone → channel disappears from list within seconds (webhook) and within ≤60s worst case (cron).
2. As `user`: create temp chat → close browser tab → channel disappears within stale window + cron.
3. As `admin`: create persistent "Common Room" → empty it → stays in list (idle), rejoinable.
4. As `noob`: no "+ new voice chat" affordance; direct action call denied.
5. In-room: see other participants + speaking rings; mute, deafen, push-to-talk all function.

---

## 14. Validation commands

```bash
npm test                 # vitest — all voice suites
npm run build            # Next.js build + tsc typecheck
npx supabase db reset    # (or migration test) verify migrations A+B apply cleanly & idempotently
```

---

## 15. Acceptance criteria (definition of done)

- [ ] `noob` cannot create any voice chat (UI hidden + server denied); `user`/`moderator` create temp; only `admin` creates persistent.
- [ ] Temp voice chat is group-visible, joinable, and **fully removed (DB + LiveKit) after the last participant leaves**, including tab-close/crash (webhook primary, cron backstop ≤60s).
- [ ] Persistent "Common Room" survives emptiness (→ idle) and is rejoinable.
- [ ] In-room v1: participant presence (name+avatar), speaking indicators, mute, deafen, push-to-talk.
- [ ] New migrations are append-only & idempotent; RLS remains SELECT-only (writes via gated admin client).
- [ ] All vitest suites + `npm run build` green; ≥80% coverage on new logic.
- [ ] No regression to existing persistent-channel join/leave flow.

---

## 16. Notes / gotchas for implementers

- **Do not** add `authenticated` INSERT/UPDATE policies to `channels` for voice creation — keep the gated **admin-client** write pattern (see `voice_rooms.sql` header comment). Loosening RLS risks letting `user`/`noob` create arbitrary channels.
- `closeVoiceRoomIfEmpty` is called from multiple paths concurrently — the ephemeral DELETE must be **idempotent and re-empty-checked**.
- The reaper grace period (`created_at < now() - stale`) prevents deleting a just-created temp channel before its creator finishes connecting.
- LiveKit `provider_room_name` is the join key between webhook events and `voice_rooms` — never reuse names across rooms (`deriveProviderRoomName(id)` already guarantees uniqueness via the room UUID).
- Surface `is_ephemeral` through `VoiceChannelWithOccupancy` / `VoiceChannelSummary` so the UI can sort/label without an extra query.
