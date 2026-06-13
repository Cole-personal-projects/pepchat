-- Fix: the RLS cutover derived every member's permissions from the seeded
-- Member/Moderator/Admin starter roles (kept in sync with the membership
-- enum). 20260612010000 removed those tier-mirror roles as duplicates,
-- which silently stripped permissions from every non-owner member —
-- including channel visibility (VIEW_CHANNELS lived on the seeded Member
-- role, not on @everyone).
--
-- The bridge: resolve_group_permissions now derives a permission floor
-- directly from group_members.role — the membership level IS the
-- permission system, matching what the role-management UI says. Custom
-- roles (and @everyone) can only add bits on top.

create or replace function public.resolve_group_permissions(p_group_id uuid, p_user_id uuid default auth.uid())
returns bigint language plpgsql security definer stable
set search_path = public as $$
declare
  v_owner uuid;
  v_enum public.member_role;
  v_base bigint := 0;
  v_everyone constant bigint :=
    (1::bigint << 8)    -- SEND_MESSAGES
    | (1::bigint << 9)  -- ATTACH_FILES
    | (1::bigint << 10) -- ADD_REACTIONS
    | (1::bigint << 14) -- CONNECT
    | (1::bigint << 15); -- SPEAK
  v_member constant bigint := v_everyone
    | (1::bigint << 7)   -- VIEW_CHANNELS
    | (1::bigint << 19)  -- CREATE_VOICE_ROOMS
    | (1::bigint << 21); -- CREATE_EVENTS
  v_moderator constant bigint := v_member
    | (1::bigint << 3)   -- MANAGE_CHANNELS
    | (1::bigint << 4)   -- KICK_MEMBERS
    | (1::bigint << 5)   -- CREATE_INVITES
    | (1::bigint << 6)   -- MANAGE_MESSAGES
    | (1::bigint << 11)  -- MENTION_EVERYONE
    | (1::bigint << 12)  -- PIN_MESSAGES
    | (1::bigint << 13)  -- MANAGE_THREADS
    | (1::bigint << 16)  -- MUTE_MEMBERS
    | (1::bigint << 17)  -- DEAFEN_MEMBERS
    | (1::bigint << 18)  -- MOVE_MEMBERS
    | (1::bigint << 20); -- MANAGE_EVENTS
begin
  if p_user_id is null or p_group_id is null then return 0; end if;

  select owner_id into v_owner from public.groups where id = p_group_id;
  if v_owner is null then return 0; end if;
  if v_owner = p_user_id then return 1; end if; -- ADMINISTRATOR

  select role into v_enum
  from public.group_members
  where group_id = p_group_id and user_id = p_user_id;

  if v_enum is null then return 0; end if;

  -- Membership level sets the floor. Noobs get no group-wide grants here:
  -- their visibility flows from @everyone channel overwrites (welcome +
  -- noob_access channels), and @everyone's base bits are added below.
  v_base := case v_enum
    when 'admin' then 1 -- ADMINISTRATOR
    when 'moderator' then v_moderator
    when 'user' then v_member
    else 0
  end;
  if (v_base & 1) = 1 then return 1; end if;

  -- Custom roles + @everyone add on top of the floor.
  return v_base | coalesce((
    select bit_or(r.permissions)
    from public.roles r
    where r.group_id = p_group_id
      and (
        r.is_default
        or exists (
          select 1 from public.member_roles mr
          where mr.role_id = r.id and mr.user_id = p_user_id
        )
      )
  ), 0);
end;
$$;
