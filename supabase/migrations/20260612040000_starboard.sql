-- Starboard: when a message collects enough ⭐ reactions it gets reposted
-- once into the group's configured highlights channel.

alter table public.groups
  add column if not exists starboard_channel_id uuid references public.channels(id) on delete set null;

alter table public.groups
  add column if not exists starboard_threshold int not null default 3;

alter table public.groups
  drop constraint if exists groups_starboard_threshold_range;
alter table public.groups
  add constraint groups_starboard_threshold_range
  check (starboard_threshold between 1 and 50);

-- One starboard entry per source message — the unique constraint is the
-- dedupe: concurrent reaction adds race to insert and exactly one wins.
create table if not exists public.starboard_entries (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid references public.groups(id) on delete cascade not null,
  message_id            uuid references public.messages(id) on delete cascade not null unique,
  starboard_message_id  uuid references public.messages(id) on delete set null,
  star_count            int not null default 0,
  created_at            timestamptz default now() not null
);

create index if not exists idx_starboard_entries_group on public.starboard_entries(group_id);

alter table public.starboard_entries enable row level security;

drop policy if exists "Members can view starboard entries" on public.starboard_entries;
create policy "Members can view starboard entries"
  on public.starboard_entries for select to authenticated
  using (group_id = any(select public.get_user_group_ids()));

drop policy if exists "Members can insert starboard entries" on public.starboard_entries;
create policy "Members can insert starboard entries"
  on public.starboard_entries for insert to authenticated
  with check (group_id = any(select public.get_user_group_ids()));

drop policy if exists "Members can update starboard entries" on public.starboard_entries;
create policy "Members can update starboard entries"
  on public.starboard_entries for update to authenticated
  using (group_id = any(select public.get_user_group_ids()))
  with check (group_id = any(select public.get_user_group_ids()));
