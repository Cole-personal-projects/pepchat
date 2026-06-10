create extension if not exists pg_cron;

create or replace function public.reap_empty_ephemeral_voice_channels()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  with empty_temp as (
    select c.id
    from public.channels c
    where c.channel_kind = 'ephemeral_voice'
      and c.is_ephemeral = true
      and c.created_at < now() - interval '45 seconds'
      and not exists (
        select 1
        from public.voice_rooms vr
        join public.voice_room_participants vrp on vrp.room_id = vr.id
        where vr.channel_id = c.id
          and vrp.left_at is null
          and vrp.last_seen_at > now() - interval '45 seconds'
      )
  )
  delete from public.channels c
  using empty_temp e
  where c.id = e.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.reap_empty_ephemeral_voice_channels() from public, anon, authenticated;
grant execute on function public.reap_empty_ephemeral_voice_channels() to postgres, service_role;

-- Replacing any existing local/dev schedule keeps this migration idempotent.
do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'reap-ephemeral-voice';
end;
$$;

select cron.schedule('reap-ephemeral-voice', '* * * * *',
  $$select public.reap_empty_ephemeral_voice_channels();$$
);
