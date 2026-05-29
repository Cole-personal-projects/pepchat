-- Allow server actions to perform voice-room writes with the authenticated user client.
-- The application still gates start/join/leave before writing; these RLS policies mirror
-- that authorization in the database so runtime voice no longer depends on a service-role key.

alter table public.voice_rooms enable row level security;
alter table public.voice_room_participants enable row level security;

drop policy if exists "Managers can create voice rooms for accessible channels" on public.voice_rooms;
create policy "Managers can create voice rooms for accessible channels"
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
        and gm.user_id = auth.uid()
        and gm.role in ('admin', 'moderator')
        and (
          gm.role in ('admin', 'moderator', 'user')
          or (gm.role = 'noob' and (c.name = 'welcome' or c.noob_access = true))
        )
    )
  );

drop policy if exists "Members can join accessible voice rooms" on public.voice_room_participants;
create policy "Members can join accessible voice rooms"
  on public.voice_room_participants
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.voice_rooms vr
      join public.channels c on c.id = vr.channel_id
      join public.group_members gm on gm.group_id = vr.group_id
      where vr.id = voice_room_participants.room_id
        and vr.status = 'open'
        and gm.user_id = auth.uid()
        and (
          gm.role in ('admin', 'moderator', 'user')
          or (gm.role = 'noob' and (c.name = 'welcome' or c.noob_access = true))
        )
    )
  );

drop policy if exists "Members can update their active voice participation" on public.voice_room_participants;
create policy "Members can update their active voice participation"
  on public.voice_room_participants
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.voice_rooms vr
      join public.channels c on c.id = vr.channel_id
      join public.group_members gm on gm.group_id = vr.group_id
      where vr.id = voice_room_participants.room_id
        and gm.user_id = auth.uid()
        and (
          gm.role in ('admin', 'moderator', 'user')
          or (gm.role = 'noob' and (c.name = 'welcome' or c.noob_access = true))
        )
    )
  )
  with check (user_id = auth.uid());
