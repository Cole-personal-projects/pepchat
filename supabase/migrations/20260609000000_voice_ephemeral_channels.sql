alter table public.channels
  add column if not exists channel_kind text not null default 'text';

alter table public.channels
  add constraint channels_channel_kind_check
  check (channel_kind in ('text', 'persistent_voice', 'ephemeral_voice'))
  not valid;

alter table public.channels
  validate constraint channels_channel_kind_check;

alter table public.channels
  add column if not exists is_ephemeral boolean not null default false;

alter table public.channels
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

update public.channels
set channel_kind = 'ephemeral_voice'
where is_ephemeral = true;

update public.channels c
set channel_kind = 'persistent_voice'
where c.is_ephemeral = false
  and exists (
    select 1
    from public.voice_rooms vr
    where vr.channel_id = c.id
  );

-- Fast lookups for the reaper and the ephemeral voice list.
create index if not exists channels_ephemeral_voice_idx
  on public.channels(group_id)
  where channel_kind = 'ephemeral_voice';

drop policy if exists "Admins and moderators can create channels" on public.channels;
create policy "Admins and moderators can create channels"
  on public.channels for insert to authenticated
  with check (
    public.can_manage_channels(group_id)
    and (
      channel_kind = 'text'
      or (channel_kind = 'persistent_voice' and public.is_group_admin(group_id))
      or (channel_kind = 'ephemeral_voice' and public.is_group_admin(group_id) and created_by = auth.uid())
    )
  );

drop policy if exists "Admins and moderators can update channels" on public.channels;
create policy "Admins and moderators can update channels"
  on public.channels for update to authenticated
  using (public.can_manage_channels(group_id))
  with check (
    public.can_manage_channels(group_id)
    and (
      channel_kind = 'text'
      or (channel_kind = 'persistent_voice' and public.is_group_admin(group_id))
      or (channel_kind = 'ephemeral_voice' and public.is_group_admin(group_id) and created_by = auth.uid())
    )
  );

drop policy if exists "Admins and moderators can delete channels" on public.channels;
create policy "Admins and moderators can delete channels"
  on public.channels for delete to authenticated
  using (
    public.can_manage_channels(group_id)
    and (
      channel_kind = 'text'
      or (channel_kind = 'persistent_voice' and public.is_group_admin(group_id))
      or (channel_kind = 'ephemeral_voice' and public.is_group_admin(group_id))
    )
  );
