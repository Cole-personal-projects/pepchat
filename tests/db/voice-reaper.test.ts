import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260609001000_voice_reaper_cron.sql'),
  'utf8',
)

function normalized(sql: string) {
  return sql.replace(/\s+/g, ' ').toLowerCase()
}

describe('voice reaper cron migration', () => {
  it('defines an idempotent security-definer reaper and cron schedule', () => {
    expect(migration).toContain('create extension if not exists pg_cron')
    expect(migration).toContain('create or replace function public.reap_empty_ephemeral_voice_channels')
    expect(migration).not.toContain('p_stale_seconds')
    expect(migration).toContain('returns int')
    expect(migration).toContain('language plpgsql')
    expect(migration).toContain('security definer')
    expect(migration).toContain('set search_path = public')
    expect(normalized(migration)).toContain('revoke execute on function public.reap_empty_ephemeral_voice_channels() from public, anon, authenticated')
    expect(normalized(migration)).toContain('grant execute on function public.reap_empty_ephemeral_voice_channels() to postgres, service_role')
    expect(migration).toContain("cron.unschedule")
    expect(migration).toContain("jobname = 'reap-ephemeral-voice'")
    expect(migration).toContain("cron.schedule('reap-ephemeral-voice', '* * * * *'")
    expect(migration).toContain('select public.reap_empty_ephemeral_voice_channels();')
  })

  it('reaps only empty ephemeral voice channels older than the stale grace window', () => {
    const sql = normalized(migration)

    expect(sql).toContain('delete from public.channels c')
    expect(sql).toContain("c.channel_kind = 'ephemeral_voice'")
    expect(sql).toContain('c.is_ephemeral = true')
    expect(sql).toContain("c.created_at < now() - interval '45 seconds'")
    expect(sql).toContain('return v_deleted')
  })

  it('spares occupied channels by treating recently seen active participants as non-empty', () => {
    const sql = normalized(migration)

    expect(sql).toContain('not exists')
    expect(sql).toContain('from public.voice_rooms vr')
    expect(sql).toContain('join public.voice_room_participants vrp on vrp.room_id = vr.id')
    expect(sql).toContain('vr.channel_id = c.id')
    expect(sql).toContain('vrp.left_at is null')
    expect(sql).toContain("vrp.last_seen_at > now() - interval '45 seconds'")
  })
})
