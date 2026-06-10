alter table public.channels
  add column if not exists is_ephemeral boolean not null default false;

alter table public.channels
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- Fast lookups for the reaper and the ephemeral voice list.
create index if not exists channels_ephemeral_voice_idx
  on public.channels(group_id)
  where is_ephemeral = true;
