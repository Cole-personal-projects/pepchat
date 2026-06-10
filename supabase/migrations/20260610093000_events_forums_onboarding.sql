-- Discord clone foundations: scheduled events, forum tags, server onboarding.
-- These new feature tables run on the has_permission() engine from day one
-- (bits documented in 20260610091000_roles_engine.sql).

-- ────────────────────────────────────────────────────────────
-- 1. SCHEDULED EVENTS
-- ────────────────────────────────────────────────────────────

create table if not exists public.scheduled_events (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid references public.groups(id) on delete cascade not null,
  channel_id  uuid references public.channels(id) on delete set null,
  name        text not null,
  description text,
  cover_url   text,
  location    text,
  start_at    timestamptz not null,
  end_at      timestamptz,
  status      text not null default 'scheduled' check (status in ('scheduled', 'active', 'completed', 'canceled')),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz default now() not null,
  constraint scheduled_events_time_order check (end_at is null or end_at > start_at)
);

create index if not exists idx_scheduled_events_group_start on public.scheduled_events(group_id, start_at);

create table if not exists public.event_rsvps (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid references public.scheduled_events(id) on delete cascade not null,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  status     text not null default 'going' check (status in ('interested', 'going', 'declined')),
  created_at timestamptz default now() not null,
  unique(event_id, user_id)
);

create index if not exists idx_event_rsvps_event on public.event_rsvps(event_id);

alter table public.scheduled_events enable row level security;
alter table public.event_rsvps      enable row level security;

create policy "Members can view events in their groups"
  on public.scheduled_events for select to authenticated
  using (group_id = any(select public.get_user_group_ids()));

create policy "Event creators can create events"
  on public.scheduled_events for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.has_permission(group_id, null, (1::bigint << 21)) -- CREATE_EVENTS
  );

create policy "Event managers can update events"
  on public.scheduled_events for update to authenticated
  using (
    created_by = auth.uid()
    or public.has_permission(group_id, null, (1::bigint << 20)) -- MANAGE_EVENTS
  );

create policy "Event managers can delete events"
  on public.scheduled_events for delete to authenticated
  using (
    created_by = auth.uid()
    or public.has_permission(group_id, null, (1::bigint << 20)) -- MANAGE_EVENTS
  );

create policy "Members can view RSVPs for visible events"
  on public.event_rsvps for select to authenticated
  using (
    exists (
      select 1 from public.scheduled_events e
      where e.id = event_rsvps.event_id
        and e.group_id = any(select public.get_user_group_ids())
    )
  );

create policy "Members can RSVP as themselves"
  on public.event_rsvps for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.scheduled_events e
      where e.id = event_rsvps.event_id
        and e.group_id = any(select public.get_user_group_ids())
    )
  );

create policy "Members can update their own RSVPs"
  on public.event_rsvps for update to authenticated
  using (user_id = auth.uid());

create policy "Members can delete their own RSVPs"
  on public.event_rsvps for delete to authenticated
  using (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 2. FORUM TAGS
-- ────────────────────────────────────────────────────────────

create table if not exists public.forum_tags (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid references public.channels(id) on delete cascade not null,
  name       text not null,
  emoji      text,
  position   int not null default 0,
  created_at timestamptz default now() not null,
  unique(channel_id, name)
);

create index if not exists idx_forum_tags_channel on public.forum_tags(channel_id, position);

-- Tags applied to forum posts (a post is a thread root message).
create table if not exists public.forum_post_tags (
  id              uuid primary key default gen_random_uuid(),
  tag_id          uuid references public.forum_tags(id) on delete cascade not null,
  root_message_id uuid references public.messages(id) on delete cascade not null,
  created_at      timestamptz default now() not null,
  unique(tag_id, root_message_id)
);

create index if not exists idx_forum_post_tags_message on public.forum_post_tags(root_message_id);

alter table public.forum_tags      enable row level security;
alter table public.forum_post_tags enable row level security;

create policy "Members can view forum tags"
  on public.forum_tags for select to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = forum_tags.channel_id
        and c.group_id = any(select public.get_user_group_ids())
    )
  );

create policy "Channel managers can manage forum tags"
  on public.forum_tags for insert to authenticated
  with check (
    exists (
      select 1 from public.channels c
      where c.id = forum_tags.channel_id
        and public.has_permission(c.group_id, null, (1::bigint << 3)) -- MANAGE_CHANNELS
    )
  );

create policy "Channel managers can update forum tags"
  on public.forum_tags for update to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = forum_tags.channel_id
        and public.has_permission(c.group_id, null, (1::bigint << 3))
    )
  );

create policy "Channel managers can delete forum tags"
  on public.forum_tags for delete to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = forum_tags.channel_id
        and public.has_permission(c.group_id, null, (1::bigint << 3))
    )
  );

create policy "Members can view forum post tags"
  on public.forum_post_tags for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      join public.channels c on c.id = m.channel_id
      where m.id = forum_post_tags.root_message_id
        and c.group_id = any(select public.get_user_group_ids())
    )
  );

create policy "Post authors and managers can tag posts"
  on public.forum_post_tags for insert to authenticated
  with check (
    exists (
      select 1 from public.messages m
      join public.channels c on c.id = m.channel_id
      where m.id = forum_post_tags.root_message_id
        and (
          m.user_id = auth.uid()
          or public.has_permission(c.group_id, null, (1::bigint << 6)) -- MANAGE_MESSAGES
        )
    )
  );

create policy "Post authors and managers can untag posts"
  on public.forum_post_tags for delete to authenticated
  using (
    exists (
      select 1 from public.messages m
      join public.channels c on c.id = m.channel_id
      where m.id = forum_post_tags.root_message_id
        and (
          m.user_id = auth.uid()
          or public.has_permission(c.group_id, null, (1::bigint << 6))
        )
    )
  );

-- ────────────────────────────────────────────────────────────
-- 3. SERVER ONBOARDING
-- ────────────────────────────────────────────────────────────

create table if not exists public.group_onboarding (
  group_id   uuid references public.groups(id) on delete cascade primary key,
  enabled    boolean not null default false,
  rules_text text,
  updated_at timestamptz default now() not null
);

create table if not exists public.onboarding_questions (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid references public.groups(id) on delete cascade not null,
  question     text not null,
  multi_select boolean not null default false,
  position     int not null default 0,
  created_at   timestamptz default now() not null
);

create table if not exists public.onboarding_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid references public.onboarding_questions(id) on delete cascade not null,
  label       text not null,
  emoji       text,
  position    int not null default 0,
  created_at  timestamptz default now() not null
);

create table if not exists public.onboarding_option_roles (
  id        uuid primary key default gen_random_uuid(),
  option_id uuid references public.onboarding_options(id) on delete cascade not null,
  role_id   uuid references public.roles(id) on delete cascade not null,
  unique(option_id, role_id)
);

create table if not exists public.member_onboarding (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid references public.groups(id) on delete cascade not null,
  user_id           uuid references public.profiles(id) on delete cascade not null,
  rules_accepted_at timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz default now() not null,
  unique(group_id, user_id)
);

create table if not exists public.member_onboarding_responses (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid references public.groups(id) on delete cascade not null,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  option_id  uuid references public.onboarding_options(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  unique(user_id, option_id)
);

create index if not exists idx_onboarding_questions_group on public.onboarding_questions(group_id, position);
create index if not exists idx_onboarding_options_question on public.onboarding_options(question_id, position);
create index if not exists idx_member_onboarding_group_user on public.member_onboarding(group_id, user_id);
create index if not exists idx_member_onboarding_responses_user on public.member_onboarding_responses(group_id, user_id);

alter table public.group_onboarding             enable row level security;
alter table public.onboarding_questions         enable row level security;
alter table public.onboarding_options           enable row level security;
alter table public.onboarding_option_roles      enable row level security;
alter table public.member_onboarding            enable row level security;
alter table public.member_onboarding_responses  enable row level security;

-- MANAGE_ONBOARDING (1 << 22) or MANAGE_GROUP (1 << 1) manages config;
-- members read.

create policy "Members can view onboarding config"
  on public.group_onboarding for select to authenticated
  using (group_id = any(select public.get_user_group_ids()));

create policy "Onboarding managers can insert config"
  on public.group_onboarding for insert to authenticated
  with check (public.has_permission(group_id, null, (1::bigint << 22)) or public.has_permission(group_id, null, (1::bigint << 1)));

create policy "Onboarding managers can update config"
  on public.group_onboarding for update to authenticated
  using (public.has_permission(group_id, null, (1::bigint << 22)) or public.has_permission(group_id, null, (1::bigint << 1)));

create policy "Onboarding managers can delete config"
  on public.group_onboarding for delete to authenticated
  using (public.has_permission(group_id, null, (1::bigint << 22)) or public.has_permission(group_id, null, (1::bigint << 1)));

create policy "Members can view onboarding questions"
  on public.onboarding_questions for select to authenticated
  using (group_id = any(select public.get_user_group_ids()));

create policy "Onboarding managers can insert questions"
  on public.onboarding_questions for insert to authenticated
  with check (public.has_permission(group_id, null, (1::bigint << 22)) or public.has_permission(group_id, null, (1::bigint << 1)));

create policy "Onboarding managers can update questions"
  on public.onboarding_questions for update to authenticated
  using (public.has_permission(group_id, null, (1::bigint << 22)) or public.has_permission(group_id, null, (1::bigint << 1)));

create policy "Onboarding managers can delete questions"
  on public.onboarding_questions for delete to authenticated
  using (public.has_permission(group_id, null, (1::bigint << 22)) or public.has_permission(group_id, null, (1::bigint << 1)));

create policy "Members can view onboarding options"
  on public.onboarding_options for select to authenticated
  using (
    exists (
      select 1 from public.onboarding_questions q
      where q.id = onboarding_options.question_id
        and q.group_id = any(select public.get_user_group_ids())
    )
  );

create policy "Onboarding managers can insert options"
  on public.onboarding_options for insert to authenticated
  with check (
    exists (
      select 1 from public.onboarding_questions q
      where q.id = onboarding_options.question_id
        and (public.has_permission(q.group_id, null, (1::bigint << 22)) or public.has_permission(q.group_id, null, (1::bigint << 1)))
    )
  );

create policy "Onboarding managers can update options"
  on public.onboarding_options for update to authenticated
  using (
    exists (
      select 1 from public.onboarding_questions q
      where q.id = onboarding_options.question_id
        and (public.has_permission(q.group_id, null, (1::bigint << 22)) or public.has_permission(q.group_id, null, (1::bigint << 1)))
    )
  );

create policy "Onboarding managers can delete options"
  on public.onboarding_options for delete to authenticated
  using (
    exists (
      select 1 from public.onboarding_questions q
      where q.id = onboarding_options.question_id
        and (public.has_permission(q.group_id, null, (1::bigint << 22)) or public.has_permission(q.group_id, null, (1::bigint << 1)))
    )
  );

create policy "Members can view option role grants"
  on public.onboarding_option_roles for select to authenticated
  using (
    exists (
      select 1 from public.onboarding_options o
      join public.onboarding_questions q on q.id = o.question_id
      where o.id = onboarding_option_roles.option_id
        and q.group_id = any(select public.get_user_group_ids())
    )
  );

create policy "Onboarding managers can insert option role grants"
  on public.onboarding_option_roles for insert to authenticated
  with check (
    exists (
      select 1 from public.onboarding_options o
      join public.onboarding_questions q on q.id = o.question_id
      where o.id = onboarding_option_roles.option_id
        and (public.has_permission(q.group_id, null, (1::bigint << 22)) or public.has_permission(q.group_id, null, (1::bigint << 1)))
    )
  );

create policy "Onboarding managers can delete option role grants"
  on public.onboarding_option_roles for delete to authenticated
  using (
    exists (
      select 1 from public.onboarding_options o
      join public.onboarding_questions q on q.id = o.question_id
      where o.id = onboarding_option_roles.option_id
        and (public.has_permission(q.group_id, null, (1::bigint << 22)) or public.has_permission(q.group_id, null, (1::bigint << 1)))
    )
  );

create policy "Users can view their own onboarding progress"
  on public.member_onboarding for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_permission(group_id, null, (1::bigint << 22))
    or public.has_permission(group_id, null, (1::bigint << 1))
  );

create policy "Users can insert their own onboarding progress"
  on public.member_onboarding for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own onboarding progress"
  on public.member_onboarding for update to authenticated
  using (user_id = auth.uid());

create policy "Users can view their own onboarding responses"
  on public.member_onboarding_responses for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_permission(group_id, null, (1::bigint << 22))
    or public.has_permission(group_id, null, (1::bigint << 1))
  );

create policy "Users can insert their own onboarding responses"
  on public.member_onboarding_responses for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can delete their own onboarding responses"
  on public.member_onboarding_responses for delete to authenticated
  using (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 4. REALTIME
-- ────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.scheduled_events;
alter publication supabase_realtime add table public.event_rsvps;
