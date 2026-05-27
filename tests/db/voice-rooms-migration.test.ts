import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260526000000_voice_rooms.sql'), 'utf8')

describe('voice rooms migration security posture', () => {
  it('creates the voice room tables with one-open-room and one-active-participant constraints', () => {
    expect(migration).toContain('create table if not exists public.voice_rooms')
    expect(migration).toContain('create table if not exists public.voice_room_participants')
    expect(migration).toContain('voice_rooms_one_open_per_channel_idx')
    expect(migration).toContain("where status = 'open'")
    expect(migration).toContain('voice_room_participants_one_active_per_user_idx')
    expect(migration).toContain('where left_at is null')
  })

  it('enables RLS and grants authenticated users select-only policy coverage', () => {
    expect(migration).toContain('alter table public.voice_rooms enable row level security')
    expect(migration).toContain('alter table public.voice_room_participants enable row level security')
    expect(migration).toContain('create policy "Members can read accessible voice rooms"')
    expect(migration).toContain('for select')
    expect(migration).toContain('to authenticated')
    expect(migration).toContain('gm.user_id = auth.uid()')
    expect(migration).toContain("gm.role in ('admin', 'moderator', 'user')")
    expect(migration).toContain("gm.role = 'noob' and (c.name = 'welcome' or c.noob_access = true)")
  })

  it('does not create direct anon/authenticated table write policies', () => {
    expect(migration).not.toMatch(/for\s+insert\s+to\s+(anon|authenticated)/i)
    expect(migration).not.toMatch(/for\s+update\s+to\s+(anon|authenticated)/i)
    expect(migration).not.toMatch(/for\s+delete\s+to\s+(anon|authenticated)/i)
    expect(migration).toContain('Intentionally no INSERT/UPDATE/DELETE policies for anon/authenticated roles')
  })
})
