-- Discord-style roles & permission engine.
--
-- Custom named roles per group with permission bitfields, stackable member
-- role assignments, and per-channel allow/deny overwrites. Resolution follows
-- Discord's algorithm: base = OR of @everyone + member roles; Administrator
-- (or group ownership) bypasses everything; channel overwrites apply
-- @everyone first, then role overwrites (deny OR'd, allow OR'd), then the
-- member-specific overwrite.
--
-- Pre-cutover the legacy member_role enum stays authoritative for existing
-- RLS policies. Triggers keep this new system in sync with the enum so new
-- features can run on has_permission() from day one. Phase 4 flips legacy
-- policies over and drops the enum dependence.
--
-- Permission bits (machine-readable; tests assert TS mirror matches):
-- PERMISSION_BIT ADMINISTRATOR = 1 << 0
-- PERMISSION_BIT MANAGE_GROUP = 1 << 1
-- PERMISSION_BIT MANAGE_ROLES = 1 << 2
-- PERMISSION_BIT MANAGE_CHANNELS = 1 << 3
-- PERMISSION_BIT KICK_MEMBERS = 1 << 4
-- PERMISSION_BIT CREATE_INVITES = 1 << 5
-- PERMISSION_BIT MANAGE_MESSAGES = 1 << 6
-- PERMISSION_BIT VIEW_CHANNELS = 1 << 7
-- PERMISSION_BIT SEND_MESSAGES = 1 << 8
-- PERMISSION_BIT ATTACH_FILES = 1 << 9
-- PERMISSION_BIT ADD_REACTIONS = 1 << 10
-- PERMISSION_BIT MENTION_EVERYONE = 1 << 11
-- PERMISSION_BIT PIN_MESSAGES = 1 << 12
-- PERMISSION_BIT MANAGE_THREADS = 1 << 13
-- PERMISSION_BIT CONNECT = 1 << 14
-- PERMISSION_BIT SPEAK = 1 << 15
-- PERMISSION_BIT MUTE_MEMBERS = 1 << 16
-- PERMISSION_BIT DEAFEN_MEMBERS = 1 << 17
-- PERMISSION_BIT MOVE_MEMBERS = 1 << 18
-- PERMISSION_BIT CREATE_VOICE_ROOMS = 1 << 19
-- PERMISSION_BIT MANAGE_EVENTS = 1 << 20
-- PERMISSION_BIT CREATE_EVENTS = 1 << 21
-- PERMISSION_BIT MANAGE_ONBOARDING = 1 << 22

-- ────────────────────────────────────────────────────────────
-- 1. TABLES
-- ────────────────────────────────────────────────────────────

create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid references public.groups(id) on delete cascade not null,
  name        text not null,
  color       text,
  hoist       boolean not null default false,
  mentionable boolean not null default false,
  position    int not null default 0,
  permissions bigint not null default 0,
  is_default  boolean not null default false,
  created_at  timestamptz default now() not null
);

-- Exactly one @everyone role per group.
create unique index if not exists roles_one_default_per_group
  on public.roles(group_id) where is_default;

create index if not exists idx_roles_group_position on public.roles(group_id, position desc);

create table if not exists public.member_roles (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null,
  user_id    uuid not null,
  role_id    uuid references public.roles(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  unique(role_id, user_id),
  -- Kicking a member removes their role assignments automatically.
  foreign key (group_id, user_id) references public.group_members(group_id, user_id) on delete cascade
);

create index if not exists idx_member_roles_group_user on public.member_roles(group_id, user_id);
create index if not exists idx_member_roles_role on public.member_roles(role_id);

create table if not exists public.channel_overwrites (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid references public.channels(id) on delete cascade not null,
  role_id    uuid references public.roles(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  allow      bigint not null default 0,
  deny       bigint not null default 0,
  created_at timestamptz default now() not null,
  constraint channel_overwrites_single_target check (
    (role_id is not null and user_id is null)
    or (role_id is null and user_id is not null)
  )
);

create unique index if not exists channel_overwrites_role_unique
  on public.channel_overwrites(channel_id, role_id) where role_id is not null;
create unique index if not exists channel_overwrites_user_unique
  on public.channel_overwrites(channel_id, user_id) where user_id is not null;
create index if not exists idx_channel_overwrites_channel on public.channel_overwrites(channel_id);

alter table public.roles              enable row level security;
alter table public.member_roles       enable row level security;
alter table public.channel_overwrites enable row level security;

-- ────────────────────────────────────────────────────────────
-- 2. RESOLUTION FUNCTIONS (security definer: bypass RLS, no recursion)
-- ────────────────────────────────────────────────────────────

-- Base group-level permission bits for a user: OR of @everyone + assigned
-- roles. Group owner always resolves to ADMINISTRATOR. Non-members get 0.
create or replace function public.resolve_group_permissions(p_group_id uuid, p_user_id uuid default auth.uid())
returns bigint language plpgsql security definer stable
set search_path = public as $$
declare
  v_owner uuid;
  v_base bigint := 0;
begin
  if p_user_id is null or p_group_id is null then return 0; end if;

  select owner_id into v_owner from public.groups where id = p_group_id;
  if v_owner is null then return 0; end if;
  if v_owner = p_user_id then return 1; end if; -- ADMINISTRATOR

  if not exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = p_user_id
  ) then
    return 0;
  end if;

  select coalesce(bit_or(r.permissions), 0) into v_base
  from public.roles r
  where r.group_id = p_group_id
    and (
      r.is_default
      or exists (
        select 1 from public.member_roles mr
        where mr.role_id = r.id and mr.user_id = p_user_id
      )
    );

  return v_base;
end;
$$;

-- Effective permission bits for a user in a channel, after overwrites.
-- Administrator (bit 0) short-circuits to all bits set (-1).
create or replace function public.resolve_channel_permissions(p_channel_id uuid, p_user_id uuid default auth.uid())
returns bigint language plpgsql security definer stable
set search_path = public as $$
declare
  v_group_id uuid;
  v_perms bigint;
  v_allow bigint := 0;
  v_deny bigint := 0;
begin
  if p_user_id is null or p_channel_id is null then return 0; end if;

  select group_id into v_group_id from public.channels where id = p_channel_id;
  if v_group_id is null then return 0; end if;

  v_perms := public.resolve_group_permissions(v_group_id, p_user_id);
  if (v_perms & 1) = 1 then return -1; end if;
  if v_perms = 0 and not exists (
    select 1 from public.group_members
    where group_id = v_group_id and user_id = p_user_id
  ) then
    return 0;
  end if;

  -- @everyone overwrite
  select coalesce(bit_or(o.allow), 0), coalesce(bit_or(o.deny), 0) into v_allow, v_deny
  from public.channel_overwrites o
  join public.roles r on r.id = o.role_id
  where o.channel_id = p_channel_id and r.is_default;
  v_perms := (v_perms & ~v_deny) | v_allow;

  -- Role overwrites for the member's assigned roles (deny OR'd, allow OR'd,
  -- allow applied after deny).
  select coalesce(bit_or(o.allow), 0), coalesce(bit_or(o.deny), 0) into v_allow, v_deny
  from public.channel_overwrites o
  join public.roles r on r.id = o.role_id and not r.is_default
  join public.member_roles mr on mr.role_id = r.id and mr.user_id = p_user_id
  where o.channel_id = p_channel_id;
  v_perms := (v_perms & ~v_deny) | v_allow;

  -- Member-specific overwrite wins last.
  select coalesce(bit_or(o.allow), 0), coalesce(bit_or(o.deny), 0) into v_allow, v_deny
  from public.channel_overwrites o
  where o.channel_id = p_channel_id and o.user_id = p_user_id;
  v_perms := (v_perms & ~v_deny) | v_allow;

  return v_perms;
end;
$$;

-- Single entry point used by RLS policies and server actions.
-- Pass p_channel_id = null for group-scoped checks.
create or replace function public.has_permission(
  p_group_id uuid,
  p_channel_id uuid,
  p_bit bigint,
  p_user_id uuid default auth.uid()
)
returns boolean language plpgsql security definer stable
set search_path = public as $$
declare
  v_perms bigint;
begin
  if p_user_id is null or p_bit is null then return false; end if;

  if p_channel_id is not null then
    v_perms := public.resolve_channel_permissions(p_channel_id, p_user_id);
    return (v_perms & p_bit) = p_bit;
  end if;

  v_perms := public.resolve_group_permissions(p_group_id, p_user_id);
  if (v_perms & 1) = 1 then return true; end if;
  return (v_perms & p_bit) = p_bit;
end;
$$;

revoke all on function public.resolve_group_permissions(uuid, uuid) from public;
revoke all on function public.resolve_channel_permissions(uuid, uuid) from public;
revoke all on function public.has_permission(uuid, uuid, bigint, uuid) from public;
grant execute on function public.resolve_group_permissions(uuid, uuid) to authenticated;
grant execute on function public.resolve_channel_permissions(uuid, uuid) to authenticated;
grant execute on function public.has_permission(uuid, uuid, bigint, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────
-- 3. DEFAULT ROLE SEEDING + ENUM SYNC
-- ────────────────────────────────────────────────────────────

-- Seeds @everyone / Member / Moderator / Admin for a group. Idempotent.
-- Bit math mirrors the PERMISSION_BIT table in this file's header.
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
  v_member bigint;
  v_moderator bigint;
begin
  if exists (select 1 from public.roles where group_id = p_group_id and is_default) then
    return;
  end if;

  v_member := v_everyone
    | (1::bigint << 7)   -- VIEW_CHANNELS
    | (1::bigint << 19)  -- CREATE_VOICE_ROOMS
    | (1::bigint << 21); -- CREATE_EVENTS

  v_moderator := v_member
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

  insert into public.roles (group_id, name, position, permissions, is_default)
  values (p_group_id, '@everyone', 0, v_everyone, true);

  insert into public.roles (group_id, name, color, hoist, mentionable, position, permissions)
  values
    (p_group_id, 'Member', null, false, true, 1, v_member),
    (p_group_id, 'Moderator', '#3ba55d', true, true, 2, v_moderator),
    (p_group_id, 'Admin', '#5865f2', true, true, 3, (1::bigint << 0));
end;
$$;

revoke all on function public.seed_default_roles(uuid) from public;

-- New groups get default roles automatically.
create or replace function public.handle_group_created_seed_roles()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  perform public.seed_default_roles(new.id);
  return new;
end;
$$;

drop trigger if exists trg_groups_seed_default_roles on public.groups;
create trigger trg_groups_seed_default_roles
  after insert on public.groups
  for each row execute function public.handle_group_created_seed_roles();

-- Until the Phase 4 cutover the legacy enum remains the source of truth.
-- Mirror enum assignments into member_roles so has_permission() agrees with
-- the legacy gates.
create or replace function public.sync_member_roles_from_enum()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_role_name text;
  v_role_id uuid;
begin
  perform public.seed_default_roles(new.group_id);

  v_role_name := case new.role::text
    when 'admin' then 'Admin'
    when 'moderator' then 'Moderator'
    when 'user' then 'Member'
    else null
  end;

  -- Clear previous enum-mapped assignments (custom roles are untouched).
  delete from public.member_roles mr
  using public.roles r
  where mr.role_id = r.id
    and mr.group_id = new.group_id
    and mr.user_id = new.user_id
    and not r.is_default
    and r.name in ('Admin', 'Moderator', 'Member');

  if v_role_name is not null then
    select id into v_role_id
    from public.roles
    where group_id = new.group_id and name = v_role_name and not is_default
    limit 1;

    if v_role_id is not null then
      insert into public.member_roles (group_id, user_id, role_id)
      values (new.group_id, new.user_id, v_role_id)
      on conflict (role_id, user_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_group_members_sync_roles on public.group_members;
create trigger trg_group_members_sync_roles
  after insert or update of role on public.group_members
  for each row execute function public.sync_member_roles_from_enum();

-- One-time seed + backfill for existing data.
do $$
declare
  g record;
begin
  for g in select id from public.groups loop
    perform public.seed_default_roles(g.id);
  end loop;
end;
$$;

insert into public.member_roles (group_id, user_id, role_id)
select gm.group_id, gm.user_id, r.id
from public.group_members gm
join public.roles r
  on r.group_id = gm.group_id
  and not r.is_default
  and r.name = case gm.role::text
    when 'admin' then 'Admin'
    when 'moderator' then 'Moderator'
    when 'user' then 'Member'
  end
on conflict (role_id, user_id) do nothing;

-- ────────────────────────────────────────────────────────────
-- 4. POLICIES
-- ────────────────────────────────────────────────────────────

create policy "Members can view roles in their groups"
  on public.roles for select to authenticated
  using (group_id = any(select public.get_user_group_ids()));

create policy "Role managers can create roles"
  on public.roles for insert to authenticated
  with check (public.has_permission(group_id, null, (1::bigint << 2)));

create policy "Role managers can update roles"
  on public.roles for update to authenticated
  using (public.has_permission(group_id, null, (1::bigint << 2)))
  with check (public.has_permission(group_id, null, (1::bigint << 2)));

create policy "Role managers can delete non-default roles"
  on public.roles for delete to authenticated
  using (
    not is_default
    and public.has_permission(group_id, null, (1::bigint << 2))
  );

create policy "Members can view member roles in their groups"
  on public.member_roles for select to authenticated
  using (group_id = any(select public.get_user_group_ids()));

create policy "Role managers can assign member roles"
  on public.member_roles for insert to authenticated
  with check (public.has_permission(group_id, null, (1::bigint << 2)));

create policy "Role managers can remove member roles"
  on public.member_roles for delete to authenticated
  using (public.has_permission(group_id, null, (1::bigint << 2)));

create policy "Members can view overwrites for visible channels"
  on public.channel_overwrites for select to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_overwrites.channel_id
        and c.group_id = any(select public.get_user_group_ids())
    )
  );

create policy "Channel managers can create overwrites"
  on public.channel_overwrites for insert to authenticated
  with check (
    exists (
      select 1 from public.channels c
      where c.id = channel_overwrites.channel_id
        and public.has_permission(c.group_id, null, (1::bigint << 3))
    )
  );

create policy "Channel managers can update overwrites"
  on public.channel_overwrites for update to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_overwrites.channel_id
        and public.has_permission(c.group_id, null, (1::bigint << 3))
    )
  );

create policy "Channel managers can delete overwrites"
  on public.channel_overwrites for delete to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_overwrites.channel_id
        and public.has_permission(c.group_id, null, (1::bigint << 3))
    )
  );

-- ────────────────────────────────────────────────────────────
-- 5. REALTIME
-- ────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.roles;
alter publication supabase_realtime add table public.member_roles;
