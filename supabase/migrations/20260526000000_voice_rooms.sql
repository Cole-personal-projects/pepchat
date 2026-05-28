-- Voice Rooms + Token Boundary
-- Server actions perform all writes through the service-role admin client after authz gates.
-- Browser/user-scoped clients are intentionally granted SELECT only through RLS policies below.

create table if not exists public.voice_rooms (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'livekit' check (provider in ('livekit')),
  provider_room_name text not null unique,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint voice_rooms_closed_at_matches_status check (
    (status = 'open' and closed_at is null)
    or (status = 'closed' and closed_at is not null)
  )
);

create unique index if not exists voice_rooms_one_open_per_channel_idx
  on public.voice_rooms(channel_id)
  where status = 'open';

create index if not exists voice_rooms_group_id_idx on public.voice_rooms(group_id);
create index if not exists voice_rooms_channel_id_idx on public.voice_rooms(channel_id);
create index if not exists voice_rooms_status_idx on public.voice_rooms(status);

create table if not exists public.voice_room_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.voice_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz
);

create unique index if not exists voice_room_participants_one_active_per_user_idx
  on public.voice_room_participants(room_id, user_id)
  where left_at is null;

create index if not exists voice_room_participants_room_user_idx
  on public.voice_room_participants(room_id, user_id);
create index if not exists voice_room_participants_user_id_idx
  on public.voice_room_participants(user_id);

alter table public.voice_rooms enable row level security;
alter table public.voice_room_participants enable row level security;

-- Authorized channel members may observe voice room metadata only for channels they can access.
drop policy if exists "Members can read accessible voice rooms" on public.voice_rooms;
create policy "Members can read accessible voice rooms"
  on public.voice_rooms
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.group_members gm
      join public.channels c on c.id = voice_rooms.channel_id
      where gm.group_id = voice_rooms.group_id
        and gm.user_id = auth.uid()
        and (
          gm.role in ('admin', 'moderator', 'user')
          or (gm.role = 'noob' and (c.name = 'welcome' or c.noob_access = true))
        )
    )
  );

-- Participants are visible only through rooms the caller can already select.
drop policy if exists "Members can read participants in accessible voice rooms" on public.voice_room_participants;
create policy "Members can read participants in accessible voice rooms"
  on public.voice_room_participants
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.voice_rooms vr
      where vr.id = voice_room_participants.room_id
    )
  );

-- Intentionally no INSERT/UPDATE/DELETE policies for anon/authenticated roles.
-- The service-role admin client bypasses RLS for post-gate server-action writes.
