-- Polls: a message attachment carrying a question + options; votes are
-- single-choice per user and changeable until the poll is closed.

create table if not exists public.polls (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid references public.groups(id) on delete cascade not null,
  channel_id  uuid references public.channels(id) on delete cascade not null,
  message_id  uuid references public.messages(id) on delete cascade,
  creator_id  uuid references public.profiles(id) on delete cascade not null,
  question    text not null check (char_length(question) between 1 and 300),
  -- [{ id: 'opt-1', label: 'Pizza' }, ...] — 2 to 6 options, enforced app-side.
  options     jsonb not null,
  closed_at   timestamptz,
  created_at  timestamptz default now() not null
);

create index if not exists idx_polls_channel on public.polls(channel_id);

create table if not exists public.poll_votes (
  id         uuid primary key default gen_random_uuid(),
  poll_id    uuid references public.polls(id) on delete cascade not null,
  option_id  text not null,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  unique(poll_id, user_id)
);

create index if not exists idx_poll_votes_poll on public.poll_votes(poll_id);

alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists "Members can view polls" on public.polls;
create policy "Members can view polls"
  on public.polls for select to authenticated
  using (group_id = any(select public.get_user_group_ids()));

drop policy if exists "Members can create polls" on public.polls;
create policy "Members can create polls"
  on public.polls for insert to authenticated
  with check (
    creator_id = auth.uid()
    and group_id = any(select public.get_user_group_ids())
  );

-- Closing (and message_id backfill) is the creator's or a group admin's call.
drop policy if exists "Creators and admins can update polls" on public.polls;
create policy "Creators and admins can update polls"
  on public.polls for update to authenticated
  using (creator_id = auth.uid() or public.is_group_admin(group_id))
  with check (creator_id = auth.uid() or public.is_group_admin(group_id));

drop policy if exists "Members can view poll votes" on public.poll_votes;
create policy "Members can view poll votes"
  on public.poll_votes for select to authenticated
  using (
    exists (
      select 1 from public.polls
      where polls.id = poll_votes.poll_id
        and polls.group_id = any(select public.get_user_group_ids())
    )
  );

drop policy if exists "Members can cast their own votes" on public.poll_votes;
create policy "Members can cast their own votes"
  on public.poll_votes for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.polls
      where polls.id = poll_votes.poll_id
        and polls.group_id = any(select public.get_user_group_ids())
        and polls.closed_at is null
    )
  );

drop policy if exists "Voters can change their vote" on public.poll_votes;
create policy "Voters can change their vote"
  on public.poll_votes for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Voters can retract their vote" on public.poll_votes;
create policy "Voters can retract their vote"
  on public.poll_votes for delete to authenticated
  using (user_id = auth.uid());

-- Live tallies in open clients.
do $$
begin
  alter publication supabase_realtime add table public.polls;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.poll_votes;
exception when duplicate_object then null;
end $$;
