-- Discord clone foundations: friendships + rich user status.
-- Friendships power the friends list and unlock DMs between friends.
-- user_status powers robust presence (online/idle/dnd/invisible) and
-- custom statuses (emoji + text + optional expiry).

-- ────────────────────────────────────────────────────────────
-- 1. FRIENDSHIPS
-- ────────────────────────────────────────────────────────────

create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid references public.profiles(id) on delete cascade not null,
  addressee_id uuid references public.profiles(id) on delete cascade not null,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  -- Set when status = 'blocked'; records which side initiated the block.
  blocked_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz default now() not null,
  responded_at timestamptz,
  constraint friendships_no_self check (requester_id <> addressee_id)
);

-- One row per pair regardless of direction.
create unique index if not exists friendships_pair_unique
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index if not exists idx_friendships_requester on public.friendships(requester_id, status);
create index if not exists idx_friendships_addressee on public.friendships(addressee_id, status);

alter table public.friendships enable row level security;

create policy "Users can view their own friendships"
  on public.friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "Users can send friend requests as themselves"
  on public.friendships for insert to authenticated
  with check (
    requester_id = auth.uid()
    and (
      (status = 'pending' and blocked_by is null)
      or (status = 'blocked' and blocked_by = auth.uid())
    )
  );

-- Fine-grained transitions (accept, block, unblock) are enforced by server
-- actions; RLS scopes writes to the two participants.
create policy "Participants can update their friendships"
  on public.friendships for update to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid())
  with check (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "Participants can remove their friendships"
  on public.friendships for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- True when the two users are accepted friends. Used by profile/status/DM
-- policies in later phases.
create or replace function public.users_are_friends(p_other_user_id uuid)
returns boolean language sql security definer stable
set search_path = public, auth as $$
  select auth.uid() is not null
    and p_other_user_id is not null
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = p_other_user_id)
          or (f.requester_id = p_other_user_id and f.addressee_id = auth.uid())
        )
    )
$$;

revoke all on function public.users_are_friends(uuid) from public;
grant execute on function public.users_are_friends(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────
-- 2. USER STATUS (presence mode + custom status)
-- ────────────────────────────────────────────────────────────

create table if not exists public.user_status (
  user_id           uuid references public.profiles(id) on delete cascade primary key,
  presence          text not null default 'online' check (presence in ('online', 'idle', 'dnd', 'invisible')),
  status_emoji      text,
  status_text       text check (status_text is null or char_length(status_text) <= 128),
  status_expires_at timestamptz,
  updated_at        timestamptz default now() not null
);

alter table public.user_status enable row level security;

create policy "Users can view status of visible users"
  on public.user_status for select to authenticated
  using (
    user_id = auth.uid()
    or public.users_share_group(user_id)
    or public.users_are_friends(user_id)
  );

create policy "Users can insert their own status"
  on public.user_status for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own status"
  on public.user_status for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete their own status"
  on public.user_status for delete to authenticated
  using (user_id = auth.uid());

-- Friends can see each other's profiles (extends the share-a-group rule).
drop policy if exists "Profiled users can read visible profiles" on public.profiles;
create policy "Profiled users can read visible profiles"
  on public.profiles for select to authenticated
  using (
    public.user_has_profile()
    and (
      id = auth.uid()
      or public.users_share_group(id)
      or public.users_are_friends(id)
    )
  );

-- ────────────────────────────────────────────────────────────
-- 3. REALTIME
-- ────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.friendships;
alter publication supabase_realtime add table public.user_status;
