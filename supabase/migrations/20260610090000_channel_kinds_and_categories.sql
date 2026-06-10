-- Discord clone foundations: channel kinds + channel categories.
-- channels.kind exists in production via 20260529090000 (text | voice).
-- This migration extends kind with 'forum' and introduces collapsible
-- sidebar categories that channels can be grouped under.

-- Safety for fresh databases recreated from schema.sql (which predates kind).
alter table public.channels
  add column if not exists kind text not null default 'text';

alter table public.channels
  drop constraint if exists channels_kind_check;

alter table public.channels
  add constraint channels_kind_check check (kind in ('text', 'voice', 'forum'));

create index if not exists channels_group_kind_position_idx
  on public.channels(group_id, kind, position);

-- ────────────────────────────────────────────────────────────
-- Channel categories
-- ────────────────────────────────────────────────────────────

create table if not exists public.channel_categories (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid references public.groups(id) on delete cascade not null,
  name       text not null,
  position   int not null default 0,
  created_at timestamptz default now() not null
);

alter table public.channels
  add column if not exists category_id uuid references public.channel_categories(id) on delete set null;

create index if not exists idx_channel_categories_group on public.channel_categories(group_id, position);
create index if not exists idx_channels_category on public.channels(category_id, position);

alter table public.channel_categories enable row level security;

-- Pre-cutover these policies reuse the legacy enum helpers so behavior matches
-- the channels table. Phase 4 flips them to has_permission().
create policy "Members can view categories in their groups"
  on public.channel_categories for select to authenticated
  using (group_id = any(select public.get_user_group_ids()));

create policy "Admins and moderators can create categories"
  on public.channel_categories for insert to authenticated
  with check (public.can_manage_channels(group_id));

create policy "Admins and moderators can update categories"
  on public.channel_categories for update to authenticated
  using (public.can_manage_channels(group_id));

create policy "Admins and moderators can delete categories"
  on public.channel_categories for delete to authenticated
  using (public.can_manage_channels(group_id));
