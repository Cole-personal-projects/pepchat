-- ============================================================
-- SideBar schema
-- Run on a fresh Supabase project to fully recreate the DB.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ENUM TYPES
-- ────────────────────────────────────────────────────────────

do $$
begin
  create type public.member_role as enum ('admin', 'moderator', 'user', 'noob');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.account_invite_claim_status as enum ('pending_profile', 'consumed', 'revoked');
exception
  when duplicate_object then null;
end
$$;

-- ────────────────────────────────────────────────────────────
-- 2. TABLES
-- ────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id             uuid references auth.users(id) on delete cascade primary key,
  username       text unique not null,
  avatar_url     text,
  display_name   text,
  bio            text,
  location       text,
  website        text,
  username_color text not null default '#ffffff',
  banner_color   text not null default '#5865f2',
  badge          text,
  pronouns       text,
  member_since   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_at     timestamptz default now() not null
);

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  icon_url    text,
  owner_id    uuid references public.profiles(id) on delete cascade not null,
  invite_code text unique default substr(md5(random()::text), 0, 9) not null,
  is_public   boolean not null default false,
  created_at  timestamptz default now() not null
);

create table if not exists public.group_members (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid references public.groups(id) on delete cascade not null,
  user_id   uuid references public.profiles(id) on delete cascade not null,
  role      public.member_role not null default 'noob',
  joined_at timestamptz default now() not null,
  unique(group_id, user_id)
);

create table if not exists public.group_invites (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid references public.groups(id) on delete cascade not null,
  code       text unique not null,
  created_by uuid references public.profiles(id) on delete set null,
  max_uses   int check (max_uses is null or max_uses > 0),
  uses_count int not null default 0 check (uses_count >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now() not null
);

create table if not exists public.group_invite_uses (
  id         uuid primary key default gen_random_uuid(),
  invite_id  uuid references public.group_invites(id) on delete cascade not null,
  group_id   uuid references public.groups(id) on delete cascade not null,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  used_at    timestamptz default now() not null
);

create table if not exists public.account_invite_claims (
  id           uuid primary key default gen_random_uuid(),
  invite_id    uuid references public.group_invites(id) on delete restrict not null,
  group_id     uuid references public.groups(id) on delete cascade not null,
  auth_user_id uuid references auth.users(id) on delete cascade not null,
  email        text not null,
  status       public.account_invite_claim_status not null default 'pending_profile',
  claimed_at   timestamptz default now() not null,
  consumed_at  timestamptz
);

create table if not exists public.channels (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid references public.groups(id) on delete cascade not null,
  name        text not null,
  description text,
  noob_access boolean not null default false,
  position    int not null default 0,
  created_at  timestamptz default now() not null
);

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid references public.channels(id) on delete cascade not null,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  content     text not null,
  reply_to_id uuid references public.messages(id) on delete set null,
  attachments jsonb default '[]'::jsonb, -- array of {type:'image',...} or {type:'gif',...} objects
  edited_at   timestamptz,
  created_at  timestamptz default now() not null
);

create table if not exists public.message_reactions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages(id) on delete cascade not null,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  emoji      text not null,
  created_at timestamptz default now() not null,
  unique(message_id, user_id, emoji)
);

create table if not exists public.dm_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid references public.profiles(id) on delete cascade not null,
  user_b          uuid references public.profiles(id) on delete cascade not null,
  last_message    text,
  last_message_at timestamptz,
  created_at      timestamptz default now() not null,
  constraint unique_pair unique (user_a, user_b),
  constraint no_self_dm check (user_a != user_b)
);

create table if not exists public.direct_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.dm_conversations(id) on delete cascade,
  sender_id       uuid references public.profiles(id) on delete cascade not null,
  recipient_id    uuid references public.profiles(id) on delete cascade not null,
  content         text not null,
  attachments     jsonb default '[]'::jsonb,
  edited_at       timestamptz,
  read_at         timestamptz,
  created_at      timestamptz default now() not null
);

create table if not exists public.channel_read_state (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.profiles(id) on delete cascade not null,
  channel_id   uuid references public.channels(id) on delete cascade not null,
  last_read_at timestamptz not null default now(),
  unique(user_id, channel_id)
);

create table if not exists public.notification_preferences (
  user_id        uuid references public.profiles(id) on delete cascade primary key,
  dm_messages    boolean not null default true,
  mentions       boolean not null default true,
  group_messages boolean not null default false,
  created_at     timestamptz default now() not null,
  updated_at     timestamptz default now() not null
);

create table if not exists public.notification_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete cascade not null,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists public.notification_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.profiles(id) on delete cascade not null,
  actor_id        uuid references public.profiles(id) on delete set null,
  type            text not null check (type in ('dm_message', 'mention', 'group_message')),
  source_table    text not null,
  source_id       uuid not null,
  conversation_id uuid references public.dm_conversations(id) on delete cascade,
  channel_id      uuid references public.channels(id) on delete cascade,
  title           text not null,
  body            text,
  url             text,
  read_at         timestamptz,
  pushed_at       timestamptz,
  push_error      text,
  created_at      timestamptz default now() not null,
  unique(user_id, type, source_id)
);

-- ────────────────────────────────────────────────────────────
-- 2. ENABLE RLS
-- ────────────────────────────────────────────────────────────

alter table public.profiles            enable row level security;
alter table public.groups              enable row level security;
alter table public.group_members       enable row level security;
alter table public.group_invites       enable row level security;
alter table public.group_invite_uses   enable row level security;
alter table public.account_invite_claims enable row level security;
alter table public.channels            enable row level security;
alter table public.messages            enable row level security;
alter table public.message_reactions   enable row level security;
alter table public.direct_messages     enable row level security;
alter table public.channel_read_state  enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_subscriptions enable row level security;
alter table public.notification_events enable row level security;

-- ────────────────────────────────────────────────────────────
-- 3. SECURITY DEFINER HELPERS
-- Bypass RLS inside policy checks to avoid infinite recursion
-- when policies on group_members sub-query group_members.
-- ────────────────────────────────────────────────────────────

create or replace function public.get_user_group_ids()
returns setof uuid language sql security definer stable
set search_path = public as $$
  select group_id from public.group_members where user_id = auth.uid()
$$;

-- Returns current user's role in a group (NULL if not a member).
create or replace function public.get_user_role_in_group(gid uuid)
returns public.member_role language sql security definer stable
set search_path = public as $$
  select role from public.group_members
  where group_id = gid and user_id = auth.uid()
  limit 1
$$;

-- True if the current user is the admin of a group.
create or replace function public.is_group_admin(gid uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid() and role = 'admin'
  )
$$;

-- True if the current user can manage channels (admin or moderator).
create or replace function public.can_manage_channels(gid uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
      and role in ('admin', 'moderator')
  )
$$;

-- True if the current user has a usable pending first-account invite claim.
create or replace function public.user_has_pending_account_invite_claim(p_auth_user_id uuid default auth.uid())
returns boolean language plpgsql security definer stable
set search_path = public, auth as $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_auth_user_id is null then
    p_auth_user_id := v_user_id;
  end if;
  if v_user_id is null or p_auth_user_id <> v_user_id then
    return false;
  end if;
  return exists (
    select 1
    from public.account_invite_claims c
    join public.group_invites i on i.id = c.invite_id
    where c.auth_user_id = p_auth_user_id
      and c.status = 'pending_profile'
      and i.revoked_at is null
      and (i.expires_at is null or i.expires_at > now())
      and (i.max_uses is null or i.uses_count < i.max_uses)
  );
end;
$$;

create or replace function public.user_has_profile(p_auth_user_id uuid default auth.uid())
returns boolean language sql security definer stable
set search_path = public, auth as $$
  select p_auth_user_id is not null
    and auth.uid() is not null
    and p_auth_user_id = auth.uid()
    and exists (
      select 1
      from public.profiles p
      where p.id = p_auth_user_id
    )
$$;

create or replace function public.users_share_group(p_other_user_id uuid)
returns boolean language sql security definer stable
set search_path = public, auth as $$
  select auth.uid() is not null
    and p_other_user_id is not null
    and exists (
      select 1
      from public.group_members mine
      join public.group_members theirs on theirs.group_id = mine.group_id
      where mine.user_id = auth.uid()
        and theirs.user_id = p_other_user_id
    )
$$;

create or replace function public.create_or_replace_account_invite_claim(
  p_invite_code text,
  p_auth_user_id uuid,
  p_email text
)
returns setof public.account_invite_claims
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_invite public.group_invites%rowtype;
  v_group_owner uuid;
  v_creator_role public.member_role;
  v_claim public.account_invite_claims%rowtype;
begin
  select * into v_invite from public.group_invites where code = trim(p_invite_code) for update;
  if not found then raise exception 'Invite not found.'; end if;
  if v_invite.revoked_at is not null
    or (v_invite.expires_at is not null and v_invite.expires_at <= now())
    or (v_invite.max_uses is not null and v_invite.uses_count >= v_invite.max_uses)
  then
    raise exception 'This invite is no longer valid. Ask an admin for a fresh link.';
  end if;
  select owner_id into v_group_owner from public.groups where id = v_invite.group_id;
  select role into v_creator_role from public.group_members where group_id = v_invite.group_id and user_id = v_invite.created_by limit 1;
  if v_invite.created_by is null or (v_invite.created_by <> v_group_owner and coalesce(v_creator_role::text, '') <> 'admin') then
    raise exception 'This invite is no longer valid. Ask an admin for a fresh link.';
  end if;
  update public.account_invite_claims set status = 'revoked' where auth_user_id = p_auth_user_id and status = 'pending_profile';
  insert into public.account_invite_claims(invite_id, group_id, auth_user_id, email)
  values (v_invite.id, v_invite.group_id, p_auth_user_id, lower(trim(p_email))) returning * into v_claim;
  return next v_claim;
end;
$$;

create or replace function public.complete_account_invite_profile(p_username text)
returns table(group_id uuid)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_user_id uuid := auth.uid();
  v_claim public.account_invite_claims%rowtype;
  v_invite public.group_invites%rowtype;
begin
  if v_user_id is null then raise exception 'Not authenticated.'; end if;
  select * into v_claim from public.account_invite_claims
  where auth_user_id = v_user_id and status = 'pending_profile'
  order by claimed_at desc limit 1 for update;
  if not found then raise exception 'An invite is required to finish account setup.'; end if;
  select * into v_invite from public.group_invites where id = v_claim.invite_id for update;
  if not found or v_invite.revoked_at is not null
    or (v_invite.expires_at is not null and v_invite.expires_at <= now())
    or (v_invite.max_uses is not null and v_invite.uses_count >= v_invite.max_uses)
  then
    raise exception 'This invite is no longer valid. Ask an admin for a fresh link.';
  end if;
  insert into public.profiles(id, username) values (v_user_id, trim(p_username));
  insert into public.group_members(group_id, user_id, role) values (v_claim.group_id, v_user_id, 'noob') on conflict (group_id, user_id) do nothing;
  insert into public.group_invite_uses(invite_id, group_id, user_id) values (v_invite.id, v_claim.group_id, v_user_id);
  update public.group_invites set uses_count = uses_count + 1 where id = v_invite.id;
  update public.account_invite_claims set status = 'consumed', consumed_at = now() where id = v_claim.id;
  group_id := v_claim.group_id;
  return next;
end;
$$;

create or replace function public.consume_managed_group_invite(p_invite_code text)
returns table(group_id uuid, joined boolean)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_user_id uuid := auth.uid();
  v_invite public.group_invites%rowtype;
  v_existing uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated.'; end if;
  select * into v_invite from public.group_invites where code = trim(p_invite_code) for update;
  if not found or v_invite.revoked_at is not null
    or (v_invite.expires_at is not null and v_invite.expires_at <= now())
    or (v_invite.max_uses is not null and v_invite.uses_count >= v_invite.max_uses)
  then
    raise exception 'This invite is no longer valid. Ask an admin for a fresh link.';
  end if;
  select id into v_existing from public.group_members where group_id = v_invite.group_id and user_id = v_user_id limit 1;
  if v_existing is not null then
    group_id := v_invite.group_id;
    joined := false;
    return next;
    return;
  end if;
  insert into public.group_members(group_id, user_id, role) values (v_invite.group_id, v_user_id, 'noob');
  insert into public.group_invite_uses(invite_id, group_id, user_id) values (v_invite.id, v_invite.group_id, v_user_id);
  update public.group_invites set uses_count = uses_count + 1 where id = v_invite.id;
  group_id := v_invite.group_id;
  joined := true;
  return next;
end;
$$;

create or replace function public.consume_legacy_group_invite(p_invite_code text)
returns table(group_id uuid, joined boolean)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_user_id uuid := auth.uid();
  v_group_id uuid;
  v_existing uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated.'; end if;
  select id into v_group_id from public.groups where invite_code = trim(p_invite_code);
  if v_group_id is null then raise exception 'Invalid invite code.'; end if;
  select id into v_existing from public.group_members where group_id = v_group_id and user_id = v_user_id limit 1;
  if v_existing is not null then
    group_id := v_group_id;
    joined := false;
    return next;
    return;
  end if;
  insert into public.group_members(group_id, user_id, role) values (v_group_id, v_user_id, 'noob');
  group_id := v_group_id;
  joined := true;
  return next;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 4. POLICIES — profiles
-- ────────────────────────────────────────────────────────────

create policy "Profiled users can read visible profiles"
  on public.profiles for select to authenticated
  using (
    public.user_has_profile()
    and (
      id = auth.uid()
      or public.users_share_group(id)
    )
  );


create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 5. POLICIES — groups
-- ────────────────────────────────────────────────────────────

create policy "Profiled users can read visible groups"
  on public.groups for select to authenticated
  using (
    public.user_has_profile()
    and (
      is_public = true
      or owner_id = auth.uid()
      or id = any(select public.get_user_group_ids())
    )
  );

create policy "Authenticated users can create groups"
  on public.groups for insert to authenticated
  with check (owner_id = auth.uid());

create policy "Owners can update their group"
  on public.groups for update to authenticated
  using (owner_id = auth.uid());

create policy "Owners can delete their group"
  on public.groups for delete to authenticated
  using (owner_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 6. POLICIES — group_members
-- ────────────────────────────────────────────────────────────

create policy "Members can view membership of their groups"
  on public.group_members for select to authenticated
  using (group_id = any(select public.get_user_group_ids()));

create policy "Group owners can insert their admin membership"
  on public.group_members for insert to authenticated
  with check (
    user_id = auth.uid()
    and role = 'admin'
    and exists (
      select 1 from public.groups
      where groups.id = group_members.group_id
        and groups.owner_id = auth.uid()
    )
  );

create policy "Authenticated users can join public groups"
  on public.group_members for insert to authenticated
  with check (
    public.user_has_profile()
    and user_id = auth.uid()
    and role = 'noob'
    and exists (
      select 1 from public.groups
      where groups.id = group_members.group_id
        and groups.is_public = true
    )
  );

-- ────────────────────────────────────────────────────────────
-- 6A. POLICIES — group_invites
-- ────────────────────────────────────────────────────────────

create policy "Admins can read group invites"
  on public.group_invites for select to authenticated
  using (public.is_group_admin(group_id));

create policy "Admins can create group invites"
  on public.group_invites for insert to authenticated
  with check (
    public.is_group_admin(group_id)
    and created_by = auth.uid()
  );

create policy "Admins can update group invites"
  on public.group_invites for update to authenticated
  using (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));

-- ────────────────────────────────────────────────────────────
-- 6B. POLICIES — group_invite_uses
-- ────────────────────────────────────────────────────────────

create policy "Members can read invite usage for their groups"
  on public.group_invite_uses for select to authenticated
  using (
    group_id = any(select public.get_user_group_ids())
    or public.is_group_admin(group_id)
  );

create policy "Authenticated users can record their invite usage"
  on public.group_invite_uses for insert to authenticated
  with check (user_id = auth.uid());

-- Admins can update roles; cannot change their own role or another admin's role
create policy "Admins can update member roles"
  on public.group_members for update to authenticated
  using (
    public.is_group_admin(group_id)
    and user_id <> auth.uid()
    and role <> 'admin'
  )
  with check (
    public.is_group_admin(group_id)
    and role <> 'admin'
  );

-- Users can leave; admins can kick non-admins; moderators can kick user/noob
create policy "Users can leave groups"
  on public.group_members for delete to authenticated
  using (
    user_id = auth.uid()
    or (
      public.is_group_admin(group_id)
      and user_id <> auth.uid()
      and role <> 'admin'
    )
    or (
      public.get_user_role_in_group(group_id) = 'moderator'
      and user_id <> auth.uid()
      and role in ('user', 'noob')
    )
  );

-- ────────────────────────────────────────────────────────────
-- 7. POLICIES — channels
-- ────────────────────────────────────────────────────────────

-- noobs only see explicitly allowed channels; all other roles see everything
create policy "Members can view channels in their groups"
  on public.channels for select to authenticated
  using (
    group_id = any(select public.get_user_group_ids())
    and (
      public.get_user_role_in_group(group_id) != 'noob'
      or noob_access = true
      or name = 'welcome'
    )
  );

create policy "Admins and moderators can create channels"
  on public.channels for insert to authenticated
  with check (public.can_manage_channels(group_id));

create policy "Admins and moderators can update channels"
  on public.channels for update to authenticated
  using (public.can_manage_channels(group_id));

create policy "Admins and moderators can delete channels"
  on public.channels for delete to authenticated
  using (public.can_manage_channels(group_id));

-- ────────────────────────────────────────────────────────────
-- 8. POLICIES — messages
-- ────────────────────────────────────────────────────────────

create policy "Members can read messages in their channels"
  on public.messages for select to authenticated
  using (
    channel_id in (
      select id from public.channels
      where group_id = any(select public.get_user_group_ids())
      and (
        public.get_user_role_in_group(group_id) <> 'noob'
        or noob_access = true
        or name = 'welcome'
      )
    )
  );

create policy "Members can insert messages as themselves"
  on public.messages for insert to authenticated
  with check (
    user_id = auth.uid()
    and channel_id in (
      select id from public.channels
      where group_id = any(select public.get_user_group_ids())
      and (
        public.get_user_role_in_group(group_id) <> 'noob'
        or noob_access = true
        or name = 'welcome'
      )
    )
  );

create policy "Users can update their own messages"
  on public.messages for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete their own messages"
  on public.messages for delete to authenticated
  using (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 9. POLICIES — message_reactions
-- ────────────────────────────────────────────────────────────

-- Any group member can read reactions on messages they can see
create policy "Members can view reactions in their channels"
  on public.message_reactions for select to authenticated
  using (
    message_id in (
      select m.id from public.messages m
      join public.channels c on c.id = m.channel_id
      where c.group_id = any(select public.get_user_group_ids())
      and (
        public.get_user_role_in_group(c.group_id) <> 'noob'
        or c.noob_access = true
        or c.name = 'welcome'
      )
    )
  );

-- Users can add reactions as themselves (noob: visible channels only)
create policy "Members can insert reactions as themselves"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and message_id in (
      select m.id from public.messages m
      join public.channels c on c.id = m.channel_id
      where c.group_id = any(select public.get_user_group_ids())
      and (
        public.get_user_role_in_group(c.group_id) <> 'noob'
        or c.noob_access = true
        or c.name = 'welcome'
      )
    )
  );

-- Users can remove their own reactions
create policy "Members can delete their own reactions"
  on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 10. POLICIES — direct_messages
-- ────────────────────────────────────────────────────────────

create policy "Users can view their own DMs"
  on public.direct_messages for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

create policy "Users can send DMs as themselves"
  on public.direct_messages for insert to authenticated
  with check (sender_id = auth.uid());

create policy "Recipients can mark DMs as read"
  on public.direct_messages for update to authenticated
  using (recipient_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 10. INDEXES
-- ────────────────────────────────────────────────────────────

create index if not exists idx_group_members_user    on public.group_members(user_id);
create index if not exists idx_group_members_group   on public.group_members(group_id);
create index if not exists idx_channels_group        on public.channels(group_id, position);
create index if not exists idx_messages_channel_time on public.messages(channel_id, created_at desc);
create index if not exists idx_messages_reply_to     on public.messages(reply_to_id);
create index if not exists idx_dm_sender             on public.direct_messages(sender_id, created_at desc);
create index if not exists idx_dm_recipient          on public.direct_messages(recipient_id, created_at desc);
create index if not exists idx_groups_invite_code    on public.groups(invite_code);
create index if not exists idx_group_invites_group_created on public.group_invites(group_id, created_at desc);
create index if not exists idx_group_invites_active_code   on public.group_invites(code) where revoked_at is null;
create index if not exists idx_group_invite_uses_invite    on public.group_invite_uses(invite_id, used_at desc);
create index if not exists idx_account_invite_claims_pending_user on public.account_invite_claims(auth_user_id) where status = 'pending_profile';
create unique index if not exists account_invite_claims_one_pending_per_user on public.account_invite_claims(auth_user_id) where status = 'pending_profile';
create index if not exists idx_reactions_message         on public.message_reactions(message_id);
create index if not exists idx_read_state_user_channel   on public.channel_read_state(user_id, channel_id);
create index if not exists idx_notification_subscriptions_user on public.notification_subscriptions(user_id);
create index if not exists idx_notification_events_user_time on public.notification_events(user_id, created_at desc);
create index if not exists idx_notification_events_unpushed on public.notification_events(created_at) where pushed_at is null;

-- ────────────────────────────────────────────────────────────
-- 11. POLICIES — channel_read_state
-- ────────────────────────────────────────────────────────────

create policy "Users can view their own read states"
  on public.channel_read_state for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert their own read states"
  on public.channel_read_state for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own read states"
  on public.channel_read_state for update to authenticated
  using (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 12. POLICIES — notification_preferences
-- ────────────────────────────────────────────────────────────

create policy "Users can view their own notification preferences"
  on public.notification_preferences for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert their own notification preferences"
  on public.notification_preferences for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own notification preferences"
  on public.notification_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 13. POLICIES — notification_subscriptions
-- ────────────────────────────────────────────────────────────

create policy "Users can view their own notification subscriptions"
  on public.notification_subscriptions for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert their own notification subscriptions"
  on public.notification_subscriptions for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own notification subscriptions"
  on public.notification_subscriptions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete their own notification subscriptions"
  on public.notification_subscriptions for delete to authenticated
  using (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 14. POLICIES — notification_events
-- ────────────────────────────────────────────────────────────

create policy "Users can view their own notification events"
  on public.notification_events for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert notification events they authored"
  on public.notification_events for insert to authenticated
  with check (actor_id = auth.uid());

create policy "Users can update their own notification events"
  on public.notification_events for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete their own notification events"
  on public.notification_events for delete to authenticated
  using (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 15. REALTIME
-- ────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.direct_messages;
alter publication supabase_realtime add table public.group_members;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.channel_read_state;
alter publication supabase_realtime add table public.notification_events;


-- Invite-only account gate privilege hardening
revoke all on table public.account_invite_claims from anon, authenticated;
revoke all on table public.account_invite_claims from public;
revoke insert on table public.profiles from anon, authenticated;
revoke all on function public.user_has_pending_account_invite_claim(uuid) from public;
revoke all on function public.user_has_profile(uuid) from public;
revoke all on function public.users_share_group(uuid) from public;
revoke all on function public.create_or_replace_account_invite_claim(text, uuid, text) from public;
revoke all on function public.complete_account_invite_profile(text) from public;
revoke all on function public.consume_managed_group_invite(text) from public;
revoke all on function public.consume_legacy_group_invite(text) from public;
grant execute on function public.user_has_pending_account_invite_claim(uuid) to authenticated;
grant execute on function public.user_has_profile(uuid) to authenticated;
grant execute on function public.users_share_group(uuid) to authenticated;
grant execute on function public.complete_account_invite_profile(text) to authenticated;
grant execute on function public.consume_managed_group_invite(text) to authenticated;
grant execute on function public.consume_legacy_group_invite(text) to authenticated;
grant execute on function public.create_or_replace_account_invite_claim(text, uuid, text) to service_role;
