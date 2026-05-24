import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const migration = readFileSync(join(root, 'migrations/threads-v1.sql'), 'utf8')
const mirrorMigration = readFileSync(join(root, 'migrations/threads-v1-mirror.sql'), 'utf8')
const rollback = readFileSync(join(root, 'migrations/threads-v1-rollback.sql'), 'utf8')

describe('Threads V1 migration safety', () => {
  it('keeps notification event type integrity during rollback', () => {
    expect(rollback).not.toMatch(/alter\s+table\s+notification_events\s+drop\s+constraint\s+(if\s+exists\s+)?notification_events_type_check/i)
    expect(rollback).toContain('leave notification_events_type_check untouched')
  })

  it('enforces thread reply invariants before direct message writes can update counters', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION validate_thread_reply_invariants()')
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF channel_id, user_id, thread_root_id ON messages')
    expect(migration).toContain('root_thread_root_id IS NOT NULL')
    expect(migration).toContain('root_channel_id IS DISTINCT FROM NEW.channel_id')
    expect(migration).toContain('NEW.user_id IS DISTINCT FROM auth.uid()')
    expect(migration).toContain('Not authorized to reply in this thread.')
  })

  it('uses fixed search_path on SECURITY DEFINER thread functions', () => {
    expect(migration).toContain('SECURITY DEFINER\nSET search_path = public, auth')
    expect(migration).toContain('SECURITY DEFINER\nSET search_path = public')
  })

  it('protects private realtime broadcasts with the same channel visibility checks as message RLS', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION can_read_channel_messages(p_channel_id uuid)')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION can_read_thread_messages(p_thread_root_id uuid)')
    expect(migration).toContain('ON realtime.messages')
    expect(migration).toContain('FOR SELECT TO authenticated')
    expect(migration).toContain('FOR INSERT TO authenticated')
    expect(migration).toContain("realtime.topic() ~ '^messages-[0-9a-fA-F-]{36}$'")
    expect(migration).toContain("realtime.topic() ~ '^thread-[0-9a-fA-F-]{36}$'")
    expect(migration).toContain('public.can_read_channel_messages')
  })

  it('validates mirror rows cannot forge unrelated or cross-channel thread replies', () => {
    expect(mirrorMigration).toContain('CREATE OR REPLACE FUNCTION public.validate_thread_mirror_invariants()')
    expect(mirrorMigration).toContain('BEFORE INSERT OR UPDATE OF channel_id, user_id, thread_root_id, mirrored_from_thread_id ON public.messages')
    expect(mirrorMigration).toContain('Mirror messages must not be thread replies.')
    expect(mirrorMigration).toContain('NEW.user_id IS DISTINCT FROM auth.uid()')
    expect(mirrorMigration).toContain('source_thread_root_id IS NULL OR source_mirrored_from_thread_id IS NOT NULL')
    expect(mirrorMigration).toContain('source_channel_id IS DISTINCT FROM NEW.channel_id')
    expect(mirrorMigration).toContain('source_user_id IS DISTINCT FROM NEW.user_id')
    expect(mirrorMigration).toContain('Not authorized to mirror this thread reply.')
  })

  it('syncs only legitimate same-channel same-author mirror rows without deleted_at', () => {
    expect(mirrorMigration).toContain('CREATE OR REPLACE FUNCTION public.sync_thread_mirror()')
    expect(mirrorMigration).toContain('SECURITY DEFINER\nSET search_path = public')
    expect(mirrorMigration).toContain('UPDATE public.messages AS mirror')
    expect(mirrorMigration).toContain('mirror.mirrored_from_thread_id = NEW.id')
    expect(mirrorMigration).toContain('mirror.thread_root_id IS NULL')
    expect(mirrorMigration).toContain('mirror.channel_id = NEW.channel_id')
    expect(mirrorMigration).toContain('mirror.user_id = NEW.user_id')
    expect(mirrorMigration).toContain("SET content = '[deleted]', edited_at = now()")
    expect(mirrorMigration).not.toContain('deleted_at')
  })

  it('tombstones source-reply mirrors before the FK can clear mirrored_from_thread_id', () => {
    expect(migration).toContain('mirrored_from_thread_id uuid REFERENCES messages(id) ON DELETE SET NULL')
    expect(mirrorMigration).toContain('BEFORE UPDATE OF content OR DELETE ON public.messages')
    expect(mirrorMigration).toContain('mirror.mirrored_from_thread_id = OLD.id')

    const syncTriggerIndex = mirrorMigration.indexOf('CREATE TRIGGER trg_sync_thread_mirror')
    const beforeDeleteIndex = mirrorMigration.indexOf('BEFORE UPDATE OF content OR DELETE ON public.messages')
    const functionIndex = mirrorMigration.indexOf("SET content = '[deleted]', edited_at = now()")

    expect(syncTriggerIndex).toBeGreaterThan(-1)
    expect(beforeDeleteIndex).toBeGreaterThan(syncTriggerIndex)
    expect(functionIndex).toBeGreaterThan(-1)
  })
})
