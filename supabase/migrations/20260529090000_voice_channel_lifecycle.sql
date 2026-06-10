-- Discord-style voice channel lifecycle.
-- Persistent destinations live in public.channels with kind='voice'.
-- public.voice_rooms remains the ephemeral LiveKit session table and is reused while open/idle.

alter table public.channels
  add column if not exists kind text not null default 'text';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'channels_kind_check'
      and conrelid = 'public.channels'::regclass
  ) then
    alter table public.channels
      add constraint channels_kind_check check (kind in ('text', 'voice'));
  end if;
end $$;

create index if not exists channels_group_kind_position_idx
  on public.channels(group_id, kind, position);

-- Preserve existing data and extend lifecycle state so an inactive persistent voice channel can
-- remain visible while its LiveKit session is idle/reusable instead of permanently deleted.
alter table public.voice_rooms
  drop constraint if exists voice_rooms_status_check;

alter table public.voice_rooms
  add constraint voice_rooms_status_check check (status in ('open', 'idle', 'closed'));

alter table public.voice_rooms
  drop constraint if exists voice_rooms_closed_at_matches_status;

alter table public.voice_rooms
  add constraint voice_rooms_closed_at_matches_status check (
    (status = 'open' and closed_at is null)
    or (status in ('idle', 'closed') and closed_at is not null)
  );

drop index if exists public.voice_rooms_one_open_per_channel_idx;
create unique index if not exists voice_rooms_one_live_per_channel_idx
  on public.voice_rooms(channel_id)
  where status in ('open', 'idle');

-- Occupancy is derived from active participant rows. This view keeps callers from counting stale
-- left rows and documents the definition used by the app helpers.
create or replace view public.voice_room_occupancy as
select
  vr.id as room_id,
  vr.channel_id,
  vr.group_id,
  count(vrp.id) filter (where vrp.left_at is null) as active_participant_count
from public.voice_rooms vr
left join public.voice_room_participants vrp on vrp.room_id = vr.id
group by vr.id, vr.channel_id, vr.group_id;

-- Limit authenticated lifecycle updates to status transitions; room identity fields remain immutable
-- through direct authenticated table grants even when RLS allows accessible members to update rows.
revoke update on public.voice_rooms from authenticated;
grant update (status, closed_at) on public.voice_rooms to authenticated;

-- Replace the manager-only insert policy from 20260529041000. Joining an existing persistent
-- voice channel may need to create a new ephemeral LiveKit session; persistent channel creation
-- itself remains governed by channels management policies.
drop policy if exists "Managers can create voice rooms for accessible channels" on public.voice_rooms;
drop policy if exists "Members can open sessions for accessible voice channels" on public.voice_rooms;
create policy "Members can open sessions for accessible voice channels"
  on public.voice_rooms
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.channels c
      join public.group_members gm on gm.group_id = c.group_id
      where c.id = voice_rooms.channel_id
        and c.group_id = voice_rooms.group_id
        and c.kind = 'voice'
        and gm.user_id = auth.uid()
        and (
          gm.role in ('admin', 'moderator', 'user')
          or (gm.role = 'noob' and (c.name = 'welcome' or c.noob_access = true))
        )
    )
  );

-- Limit direct authenticated updates on voice_rooms to the lifecycle columns used by the
-- authenticated server actions. RLS still scopes which rows are writable below.
revoke update on public.voice_rooms from authenticated;
grant update (status, closed_at) on public.voice_rooms to authenticated;

-- Authenticated lifecycle updates are still scoped to users who can access the channel; this lets
-- server actions reopen idle sessions and mark the last participant's room idle without requiring
-- a service-role key.
drop policy if exists "Members can update lifecycle for accessible voice rooms" on public.voice_rooms;
create policy "Members can update lifecycle for accessible voice rooms"
  on public.voice_rooms
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.channels c
      join public.group_members gm on gm.group_id = c.group_id
      where c.id = voice_rooms.channel_id
        and c.group_id = voice_rooms.group_id
        and c.kind = 'voice'
        and gm.user_id = auth.uid()
        and (
          gm.role in ('admin', 'moderator', 'user')
          or (gm.role = 'noob' and (c.name = 'welcome' or c.noob_access = true))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.channels c
      join public.group_members gm on gm.group_id = c.group_id
      where c.id = voice_rooms.channel_id
        and c.group_id = voice_rooms.group_id
        and c.kind = 'voice'
        and gm.user_id = auth.uid()
        and (
          gm.role in ('admin', 'moderator', 'user')
          or (gm.role = 'noob' and (c.name = 'welcome' or c.noob_access = true))
        )
    )
  );
