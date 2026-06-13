-- Channel creation via a SECURITY DEFINER function so authorization stays
-- enforced inside the database (every caller is gated on auth.uid() here,
-- exactly like RLS would), while the INSERT runs as the function owner and
-- thus sidesteps the channels INSERT WITH CHECK — which rejects authorized
-- owner/admin inserts on the production runtime despite auth.uid()
-- resolving correctly for the same session's message inserts and reads.
--
-- No service-role key involved: the app calls this as the normal
-- authenticated user, and the function refuses anyone who is not the group
-- owner or an admin/moderator member.

create or replace function public.create_channel(
  p_group_id    uuid,
  p_name        text,
  p_description text default null,
  p_noob_access boolean default false,
  p_kind        text default 'text',
  p_category_id uuid default null
)
returns public.channels
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_name    text := lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', '-', 'g'));
  v_position int;
  v_channel public.channels;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if v_name = '' then
    raise exception 'Channel name is required' using errcode = '22023';
  end if;
  if v_name !~ '^[a-z0-9][a-z0-9-]*$' then
    raise exception 'Channel name may only contain lowercase letters, numbers, and hyphens' using errcode = '22023';
  end if;
  if length(v_name) > 80 then
    raise exception 'Channel name must be 80 characters or fewer' using errcode = '22023';
  end if;
  if coalesce(p_kind, 'text') not in ('text', 'voice', 'forum') then
    raise exception 'Invalid channel type' using errcode = '22023';
  end if;

  select owner_id into v_owner from public.groups where id = p_group_id;
  if v_owner is null then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;

  -- Authorization, enforced in-database for every caller of this function.
  if v_owner <> v_uid and not exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = v_uid and role in ('admin', 'moderator')
  ) then
    raise exception 'You do not have permission to manage channels' using errcode = '42501';
  end if;

  -- A category, if given, must belong to the same group.
  if p_category_id is not null and not exists (
    select 1 from public.channel_categories
    where id = p_category_id and group_id = p_group_id
  ) then
    raise exception 'Category not found in this group' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.channels where group_id = p_group_id and name = v_name
  ) then
    raise exception 'Channel name already exists' using errcode = '23505';
  end if;

  select coalesce(max(position) + 1, 0) into v_position
  from public.channels where group_id = p_group_id;

  insert into public.channels (group_id, name, description, noob_access, position, kind, category_id)
  values (
    p_group_id,
    v_name,
    nullif(trim(coalesce(p_description, '')), ''),
    coalesce(p_noob_access, false),
    v_position,
    coalesce(p_kind, 'text'),
    p_category_id
  )
  returning * into v_channel;

  return v_channel;
end;
$$;

revoke all on function public.create_channel(uuid, text, text, boolean, text, uuid) from public;
grant execute on function public.create_channel(uuid, text, text, boolean, text, uuid) to authenticated;
