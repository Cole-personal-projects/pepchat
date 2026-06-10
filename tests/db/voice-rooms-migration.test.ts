import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const initialMigration = readFileSync(join(process.cwd(), 'supabase/migrations/20260526000000_voice_rooms.sql'), 'utf8')
const authenticatedWritesMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260529041000_voice_room_authenticated_writes.sql'),
  'utf8',
)
const ephemeralChannelsMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260609000000_voice_ephemeral_channels.sql'),
  'utf8',
)
const schema = readFileSync(join(process.cwd(), 'schema.sql'), 'utf8')
const channelsTableDefinition = schema.match(/create table if not exists public\.channels \([\s\S]*?\n\);/)?.[0] ?? ''

function policyBlock(sql: string, policyName: string) {
  return sql.match(new RegExp(`create policy "${policyName}"[\\s\\S]*?\\n  \\);`))?.[0] ?? ''
}

describe('voice rooms migration security posture', () => {
  it('creates the voice room tables with one-open-room and one-active-participant constraints', () => {
    expect(initialMigration).toContain('create table if not exists public.voice_rooms')
    expect(initialMigration).toContain('create table if not exists public.voice_room_participants')
    expect(initialMigration).toContain('voice_rooms_one_open_per_channel_idx')
    expect(initialMigration).toContain("where status = 'open'")
    expect(initialMigration).toContain('voice_room_participants_one_active_per_user_idx')
    expect(initialMigration).toContain('where left_at is null')
  })

  it('enables RLS and grants authenticated users select-only policy coverage', () => {
    expect(initialMigration).toContain('alter table public.voice_rooms enable row level security')
    expect(initialMigration).toContain('alter table public.voice_room_participants enable row level security')
    expect(initialMigration).toContain('create policy "Members can read accessible voice rooms"')
    expect(initialMigration).toContain('for select')
    expect(initialMigration).toContain('to authenticated')
    expect(initialMigration).toContain('gm.user_id = auth.uid()')
    expect(initialMigration).toContain("gm.role in ('admin', 'moderator', 'user')")
    expect(initialMigration).toContain("gm.role = 'noob' and (c.name = 'welcome' or c.noob_access = true)")
  })

  it('does not create direct anon/authenticated table write policies', () => {
    expect(initialMigration).not.toMatch(/for\s+insert\s+to\s+(anon|authenticated)/i)
    expect(initialMigration).not.toMatch(/for\s+update\s+to\s+(anon|authenticated)/i)
    expect(initialMigration).not.toMatch(/for\s+delete\s+to\s+(anon|authenticated)/i)
    expect(initialMigration).toContain('Intentionally no INSERT/UPDATE/DELETE policies for anon/authenticated roles')
  })

  it('allows only admins to directly create persistent voice rooms through authenticated RLS', () => {
    const createPolicy = policyBlock(authenticatedWritesMigration, 'Admins can create voice rooms for accessible channels')

    expect(createPolicy).toContain('for insert')
    expect(createPolicy).toContain('created_by = auth.uid()')
    expect(createPolicy).toContain("gm.role = 'admin'")
    expect(createPolicy).not.toContain("gm.role in ('admin', 'moderator')")
    expect(authenticatedWritesMigration).not.toContain('create policy "Managers can create voice rooms for accessible channels"')
    expect(authenticatedWritesMigration).toContain('create policy "Members can join accessible voice rooms"')
    expect(authenticatedWritesMigration).toContain('user_id = auth.uid()')
    expect(authenticatedWritesMigration).toContain("vr.status = 'open'")
    expect(authenticatedWritesMigration).toContain('create policy "Members can update their active voice participation"')
  })

  it('adds idempotent channel columns for ephemeral voice rooms without channel write policies', () => {
    expect(ephemeralChannelsMigration).toContain('alter table public.channels')
    expect(ephemeralChannelsMigration).toContain('add column if not exists is_ephemeral boolean not null default false')
    expect(ephemeralChannelsMigration).toContain(
      'add column if not exists created_by uuid references public.profiles(id) on delete set null',
    )
    expect(ephemeralChannelsMigration).toContain('create index if not exists channels_ephemeral_voice_idx')
    expect(ephemeralChannelsMigration).toContain('on public.channels(group_id)')
    expect(ephemeralChannelsMigration).toContain('where is_ephemeral = true')
    expect(ephemeralChannelsMigration).not.toContain("where kind = 'voice'")
    expect(channelsTableDefinition).not.toMatch(/\n\s+kind\s+/)
    expect(ephemeralChannelsMigration).not.toMatch(/create\s+policy/i)
    expect(ephemeralChannelsMigration).not.toMatch(/for\s+(insert|update|delete)\s+to\s+authenticated/i)
  })
})
