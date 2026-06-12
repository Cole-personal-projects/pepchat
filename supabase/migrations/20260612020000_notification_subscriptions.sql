-- Mirrors migrations/notification-subscriptions.sql into the canonical
-- migration history: the table was only in the legacy folder and never
-- reached production, so device registration for web push failed with
-- "Could not find the table 'public.notification_subscriptions'".
-- Idempotent — safe to run on databases that already have the table.

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

alter table public.notification_subscriptions enable row level security;

create index if not exists idx_notification_subscriptions_user
  on public.notification_subscriptions(user_id);

drop policy if exists "Users can view their own notification subscriptions" on public.notification_subscriptions;
create policy "Users can view their own notification subscriptions"
  on public.notification_subscriptions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert their own notification subscriptions" on public.notification_subscriptions;
create policy "Users can insert their own notification subscriptions"
  on public.notification_subscriptions for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update their own notification subscriptions" on public.notification_subscriptions;
create policy "Users can update their own notification subscriptions"
  on public.notification_subscriptions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can delete their own notification subscriptions" on public.notification_subscriptions;
create policy "Users can delete their own notification subscriptions"
  on public.notification_subscriptions for delete to authenticated
  using (user_id = auth.uid());
