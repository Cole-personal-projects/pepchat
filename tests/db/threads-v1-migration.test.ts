import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const migration = readFileSync(join(root, 'migrations/threads-v1.sql'), 'utf8')
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
})
