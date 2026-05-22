-- Create/repair notification_preferences in the deployable Supabase migration path.
-- The canonical table definition already exists in schema.sql and legacy
-- migrations/notification-preferences.sql; this migration makes it available to
-- Supabase migration deploys so PostgREST can expose public.notification_preferences.

create table if not exists public.notification_preferences (
  user_id        uuid references public.profiles(id) on delete cascade primary key,
  dm_messages    boolean not null default true,
  mentions       boolean not null default true,
  group_messages boolean not null default false,
  created_at     timestamptz default now() not null,
  updated_at     timestamptz default now() not null
);

-- Repair partially-created tables without disturbing existing data.
alter table public.notification_preferences
  add column if not exists user_id uuid,
  add column if not exists dm_messages boolean default true,
  add column if not exists mentions boolean default true,
  add column if not exists group_messages boolean default false,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.notification_preferences
  alter column dm_messages set default true,
  alter column mentions set default true,
  alter column group_messages set default false,
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.notification_preferences
set
  dm_messages = coalesce(dm_messages, true),
  mentions = coalesce(mentions, true),
  group_messages = coalesce(group_messages, false),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where dm_messages is null
   or mentions is null
   or group_messages is null
   or created_at is null
   or updated_at is null;

do $$
begin
  if exists (select 1 from public.notification_preferences where user_id is null) then
    raise exception 'Cannot repair public.notification_preferences: user_id contains NULL values. Backfill each row with a valid public.profiles.id, then rerun this migration.';
  end if;

  alter table public.notification_preferences
    alter column user_id set not null,
    alter column dm_messages set not null,
    alter column mentions set not null,
    alter column group_messages set not null,
    alter column created_at set not null,
    alter column updated_at set not null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notification_preferences'::regclass
      and contype = 'p'
  ) then
    alter table public.notification_preferences
      add constraint notification_preferences_pkey primary key (user_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'notification_preferences_user_id_fkey'
      and conrelid = 'public.notification_preferences'::regclass
  ) then
    alter table public.notification_preferences
      add constraint notification_preferences_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade
      not valid;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from public.notification_preferences np
    where not exists (select 1 from public.profiles p where p.id = np.user_id)
  ) then
    raise exception 'Cannot validate public.notification_preferences.user_id: at least one row does not reference public.profiles(id). Fix or remove orphaned rows, then rerun this migration.';
  end if;

  alter table public.notification_preferences validate constraint notification_preferences_user_id_fkey;
end $$;

alter table public.notification_preferences enable row level security;

drop policy if exists "Users can view their own notification preferences" on public.notification_preferences;
create policy "Users can view their own notification preferences"
  on public.notification_preferences for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert their own notification preferences" on public.notification_preferences;
create policy "Users can insert their own notification preferences"
  on public.notification_preferences for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update their own notification preferences" on public.notification_preferences;
create policy "Users can update their own notification preferences"
  on public.notification_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Tell PostgREST/Supabase API nodes to refresh the schema cache after the table
-- and policies exist. Harmless when run outside hosted Supabase.
notify pgrst, 'reload schema';
