-- RLS cutover: enforcement moves from the legacy member_role enum to the
-- has_permission() bitfield engine (20260610091000_roles_engine.sql).
--
-- Semantics preserved:
--   * noob visibility (welcome + noob_access channels only) is reproduced via
--     @everyone VIEW_CHANNELS overwrites — @everyone's seeded base lacks
--     VIEW_CHANNELS, so only channels with an explicit allow are visible to
--     members holding no mapped role.
--   * Member/Moderator/Admin behavior is covered by their seeded role bits,
--     kept in sync with the enum by trg_group_members_sync_roles.
--
-- The enum column itself stays (UI + several actions still read it); it is
-- no longer what RLS enforces.
--
-- Bits used here (see roles engine header):
--   MANAGE_GROUP=2, MANAGE_CHANNELS=8, KICK_MEMBERS=16, CREATE_INVITES=32,
--   MANAGE_MESSAGES=64, VIEW_CHANNELS=128, SEND_MESSAGES=256, CONNECT=16384

-- ────────────────────────────────────────────────────────────
-- 1. NOOB-VISIBILITY OVERWRITES (@everyone VIEW allow)
-- ────────────────────────────────────────────────────────────

create or replace function public.sync_channel_everyone_view_overwrite()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_everyone_role_id uuid;
  v_visible boolean;
begin
  select id into v_everyone_role_id
  from public.roles
  where group_id = new.group_id and is_default
  limit 1;

  if v_everyone_role_id is null then return new; end if;

  v_visible := coalesce(new.noob_access, false) or new.name = 'welcome';

  if v_visible then
    insert into public.channel_overwrites (channel_id, role_id, allow, deny)
    values (new.id, v_everyone_role_id, (1::bigint << 7), 0)
    on conflict (channel_id, role_id) where role_id is not null
    do update set allow = public.channel_overwrites.allow | (1::bigint << 7);
  else
    update public.channel_overwrites
    set allow = allow & ~(1::bigint << 7)
    where channel_id = new.id and role_id = v_everyone_role_id;

    delete from public.channel_overwrites
    where channel_id = new.id
      and role_id = v_everyone_role_id
      and allow = 0
      and deny = 0;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_channels_everyone_view on public.channels;
create trigger trg_channels_everyone_view
  after insert or update of noob_access, name on public.channels
  for each row execute function public.sync_channel_everyone_view_overwrite();

-- One-time backfill for existing channels.
insert into public.channel_overwrites (channel_id, role_id, allow, deny)
select c.id, r.id, (1::bigint << 7), 0
from public.channels c
join public.roles r on r.group_id = c.group_id and r.is_default
where coalesce(c.noob_access, false) or c.name = 'welcome'
on conflict do nothing;

-- ────────────────────────────────────────────────────────────
-- 2. CHANNELS
-- ────────────────────────────────────────────────────────────

drop policy if exists "Members can view channels in their groups" on public.channels;
create policy "Members can view channels in their groups"
  on public.channels for select to authenticated
  using (
    group_id = any(select public.get_user_group_ids())
    and public.has_permission(group_id, id, (1::bigint << 7)) -- VIEW_CHANNELS
  );

drop policy if exists "Admins and moderators can create channels" on public.channels;
create policy "Channel managers can create channels"
  on public.channels for insert to authenticated
  with check (public.has_permission(group_id, null, (1::bigint << 3))); -- MANAGE_CHANNELS

drop policy if exists "Admins and moderators can update channels" on public.channels;
create policy "Channel managers can update channels"
  on public.channels for update to authenticated
  using (public.has_permission(group_id, null, (1::bigint << 3)));

drop policy if exists "Admins and moderators can delete channels" on public.channels;
create policy "Channel managers can delete channels"
  on public.channels for delete to authenticated
  using (public.has_permission(group_id, null, (1::bigint << 3)));

-- ────────────────────────────────────────────────────────────
-- 3. CHANNEL CATEGORIES
-- ────────────────────────────────────────────────────────────

drop policy if exists "Admins and moderators can create categories" on public.channel_categories;
create policy "Channel managers can create categories"
  on public.channel_categories for insert to authenticated
  with check (public.has_permission(group_id, null, (1::bigint << 3)));

drop policy if exists "Admins and moderators can update categories" on public.channel_categories;
create policy "Channel managers can update categories"
  on public.channel_categories for update to authenticated
  using (public.has_permission(group_id, null, (1::bigint << 3)));

drop policy if exists "Admins and moderators can delete categories" on public.channel_categories;
create policy "Channel managers can delete categories"
  on public.channel_categories for delete to authenticated
  using (public.has_permission(group_id, null, (1::bigint << 3)));

-- ────────────────────────────────────────────────────────────
-- 4. MESSAGES
-- ────────────────────────────────────────────────────────────

drop policy if exists "Members can read messages in their channels" on public.messages;
create policy "Members can read messages in their channels"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = messages.channel_id
        and c.group_id = any(select public.get_user_group_ids())
        and public.has_permission(c.group_id, c.id, (1::bigint << 7)) -- VIEW_CHANNELS
    )
  );

drop policy if exists "Members can insert messages as themselves" on public.messages;
create policy "Members can insert messages as themselves"
  on public.messages for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.channels c
      where c.id = messages.channel_id
        and c.group_id = any(select public.get_user_group_ids())
        and public.has_permission(c.group_id, c.id, ((1::bigint << 7) | (1::bigint << 8))) -- VIEW + SEND
    )
  );

-- New capability: MANAGE_MESSAGES moderates any message in visible channels.
drop policy if exists "Message managers can delete messages" on public.messages;
create policy "Message managers can delete messages"
  on public.messages for delete to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = messages.channel_id
        and public.has_permission(c.group_id, c.id, (1::bigint << 6)) -- MANAGE_MESSAGES
    )
  );

-- ────────────────────────────────────────────────────────────
-- 5. MESSAGE REACTIONS
-- ────────────────────────────────────────────────────────────

drop policy if exists "Members can view reactions in their channels" on public.message_reactions;
create policy "Members can view reactions in their channels"
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      join public.channels c on c.id = m.channel_id
      where m.id = message_reactions.message_id
        and c.group_id = any(select public.get_user_group_ids())
        and public.has_permission(c.group_id, c.id, (1::bigint << 7))
    )
  );

drop policy if exists "Members can insert reactions as themselves" on public.message_reactions;
create policy "Members can insert reactions as themselves"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      join public.channels c on c.id = m.channel_id
      where m.id = message_reactions.message_id
        and c.group_id = any(select public.get_user_group_ids())
        and public.has_permission(c.group_id, c.id, ((1::bigint << 7) | (1::bigint << 10))) -- VIEW + ADD_REACTIONS
    )
  );

-- ────────────────────────────────────────────────────────────
-- 6. GROUPS / MEMBERS / INVITES
-- ────────────────────────────────────────────────────────────

drop policy if exists "Owners can update their group" on public.groups;
create policy "Group managers can update their group"
  on public.groups for update to authenticated
  using (
    owner_id = auth.uid()
    or public.has_permission(id, null, (1::bigint << 1)) -- MANAGE_GROUP
  );

-- Kicks: KICK_MEMBERS bit; admins/owner remain unkickable by non-owners.
drop policy if exists "Users can leave groups" on public.group_members;
create policy "Users can leave groups"
  on public.group_members for delete to authenticated
  using (
    user_id = auth.uid()
    or (
      public.has_permission(group_id, null, (1::bigint << 4)) -- KICK_MEMBERS
      and user_id <> auth.uid()
      and role <> 'admin'
      and not exists (
        select 1 from public.groups g
        where g.id = group_members.group_id and g.owner_id = group_members.user_id
      )
    )
  );

drop policy if exists "Admins can read group invites" on public.group_invites;
create policy "Invite managers can read group invites"
  on public.group_invites for select to authenticated
  using (public.has_permission(group_id, null, (1::bigint << 5))); -- CREATE_INVITES

drop policy if exists "Admins can create group invites" on public.group_invites;
create policy "Invite managers can create group invites"
  on public.group_invites for insert to authenticated
  with check (
    public.has_permission(group_id, null, (1::bigint << 5))
    and created_by = auth.uid()
  );

drop policy if exists "Admins can update group invites" on public.group_invites;
create policy "Invite managers can update group invites"
  on public.group_invites for update to authenticated
  using (public.has_permission(group_id, null, (1::bigint << 5)))
  with check (public.has_permission(group_id, null, (1::bigint << 5)));

-- ────────────────────────────────────────────────────────────
-- 7. VOICE ROOMS (CONNECT gate replaces enum joins)
-- ────────────────────────────────────────────────────────────

drop policy if exists "Members can open sessions for accessible voice channels" on public.voice_rooms;
create policy "Members can open sessions for accessible voice channels"
  on public.voice_rooms
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.channels c
      where c.id = voice_rooms.channel_id
        and c.group_id = voice_rooms.group_id
        and c.kind = 'voice'
        and public.has_permission(c.group_id, c.id, (1::bigint << 14)) -- CONNECT
    )
  );

drop policy if exists "Members can update lifecycle for accessible voice rooms" on public.voice_rooms;
create policy "Members can update lifecycle for accessible voice rooms"
  on public.voice_rooms
  for update to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = voice_rooms.channel_id
        and c.group_id = voice_rooms.group_id
        and c.kind = 'voice'
        and public.has_permission(c.group_id, c.id, (1::bigint << 14))
    )
  )
  with check (
    exists (
      select 1 from public.channels c
      where c.id = voice_rooms.channel_id
        and c.group_id = voice_rooms.group_id
        and c.kind = 'voice'
        and public.has_permission(c.group_id, c.id, (1::bigint << 14))
    )
  );
