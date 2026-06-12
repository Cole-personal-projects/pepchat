-- Fix: the group_members UPDATE policy made every role change involving the
-- admin tier silently impossible — even for the group owner.
--
--   using (... and role <> 'admin')        → admin rows were invisible to
--     UPDATE, so demoting an admin matched zero rows and reported success.
--   with check (... and role <> 'admin')   → granting admin was forbidden
--     for everyone, contradicting the app rule "only the owner grants admin".
--
-- The app layer (assignRole) already enforces the real matrix: the owner
-- manages the admin tier, admins manage moderator/user/noob, nobody edits
-- their own row or the owner's row. The policy now mirrors that.

create or replace function public.is_group_owner(gid uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.groups
    where id = gid and owner_id = auth.uid()
  )
$$;

drop policy if exists "Admins can update member roles" on public.group_members;
create policy "Admins can update member roles"
  on public.group_members for update to authenticated
  using (
    user_id <> auth.uid()
    and (
      public.is_group_owner(group_id)
      or (public.is_group_admin(group_id) and role <> 'admin')
    )
  )
  with check (
    public.is_group_owner(group_id)
    or (public.is_group_admin(group_id) and role <> 'admin')
  );

-- De-dupe: seed_default_roles created starter custom roles literally named
-- Admin / Moderator / Member, mirroring the membership-level tiers in the
-- role management sheet and reading as duplicates. Custom roles are
-- cosmetic tags (mentions, colors); the membership level is the permission
-- system. New groups now seed only @everyone.
create or replace function public.seed_default_roles(p_group_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare
  v_everyone bigint :=
    (1::bigint << 8)   -- SEND_MESSAGES
    | (1::bigint << 9)  -- ATTACH_FILES
    | (1::bigint << 10) -- ADD_REACTIONS
    | (1::bigint << 14) -- CONNECT
    | (1::bigint << 15); -- SPEAK
begin
  if exists (select 1 from public.roles where group_id = p_group_id and is_default) then
    return;
  end if;

  insert into public.roles (group_id, name, position, permissions, is_default)
  values (p_group_id, '@everyone', 0, v_everyone, true);
end;
$$;

revoke all on function public.seed_default_roles(uuid) from public;

-- Remove the tier-mirror starter roles from existing groups — but only
-- where they are genuinely unused (never assigned to a member, not
-- referenced by a channel overwrite). Assigned ones survive so nobody
-- loses a tag they handed out on purpose.
delete from public.roles r
where r.is_default = false
  and r.name in ('Admin', 'Moderator', 'Member')
  and not exists (select 1 from public.member_roles mr where mr.role_id = r.id)
  and not exists (select 1 from public.channel_overwrites co where co.role_id = r.id);
