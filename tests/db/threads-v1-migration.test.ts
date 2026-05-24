import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const migration = readFileSync(join(root, 'migrations/threads-v1.sql'), 'utf8')
const mirrorMigration = readFileSync(join(root, 'migrations/threads-v1-mirror.sql'), 'utf8')
const rollback = readFileSync(join(root, 'migrations/threads-v1-rollback.sql'), 'utf8')
const promotionMigration = readFileSync(join(root, 'migrations/promote-thread-to-channel.sql'), 'utf8')
const promotionRollback = readFileSync(join(root, 'migrations/promote-thread-to-channel-rollback.sql'), 'utf8')

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

  it('defines an atomic promote-thread RPC and rollback metadata cleanup', () => {
    expect(promotionMigration).toContain('ADD COLUMN IF NOT EXISTS promoted_to_channel_id')
    expect(promotionMigration).toContain('ADD COLUMN IF NOT EXISTS promoted_at')
    expect(promotionMigration).toContain('CREATE INDEX IF NOT EXISTS idx_messages_promoted_lookup')
    expect(promotionMigration).toContain('CREATE OR REPLACE FUNCTION public.promote_thread_to_channel')
    expect(promotionMigration).toContain('SECURITY DEFINER\nSET search_path = public, auth')
    expect(promotionMigration).toContain('FROM public.banned_users bu')
    expect(promotionMigration).toContain('WHERE bu.user_id = p_actor_id')
    expect(promotionMigration).toContain('v_actor_role public.member_role')
    expect(promotionMigration).toContain("v_actor_role NOT IN ('admin', 'moderator')")
    expect(promotionMigration).toContain('OR NOT public.can_read_channel_messages(v_source_channel_id)')
    expect(promotionMigration).toContain('REVOKE ALL ON FUNCTION public.promote_thread_to_channel(uuid, text, text, boolean, uuid) FROM PUBLIC')
    expect(promotionMigration).toContain('GRANT EXECUTE ON FUNCTION public.promote_thread_to_channel(uuid, text, text, boolean, uuid) TO authenticated')

    const banCheckIndex = promotionMigration.indexOf('FROM public.banned_users bu')
    const roleCheckIndex = promotionMigration.indexOf("v_actor_role NOT IN ('admin', 'moderator')")
    const firstMutationIndex = promotionMigration.indexOf('LOCK TABLE public.channels IN SHARE ROW EXCLUSIVE MODE')
    expect(banCheckIndex).toBeGreaterThan(-1)
    expect(roleCheckIndex).toBeGreaterThan(banCheckIndex)
    expect(firstMutationIndex).toBeGreaterThan(roleCheckIndex)

    expect(promotionMigration).toContain('LOCK TABLE public.channels IN SHARE ROW EXCLUSIVE MODE')
    expect(promotionMigration).toContain("RAISE EXCEPTION 'Cannot promote an empty thread.'")
    expect(promotionMigration).toContain('UPDATE public.messages\n    SET channel_id = v_new_channel_id,\n        thread_root_id = NULL')
    expect(promotionMigration).toContain('promoted_to_channel_id = v_new_channel_id')
    expect(promotionMigration).toContain('thread_reply_count = 0')
    expect(promotionMigration).toContain('mirror.mirrored_from_thread_id = ANY(v_moved_reply_ids)')
    expect(promotionMigration).toContain('promoted_to_channel_id = v_new_channel_id')
    expect(promotionMigration).toContain('INSERT INTO public.audit_log (admin_id, action, target_type, target_id, metadata)')
    expect(promotionMigration).toContain("'thread.promoted_to_channel'")
    expect(promotionMigration).toContain("'target_channel_id', v_new_channel_id")
    expect(promotionRollback).toContain('DROP FUNCTION IF EXISTS public.promote_thread_to_channel(uuid, text, text, boolean, uuid)')
    expect(promotionRollback).toContain('DROP INDEX IF EXISTS idx_messages_promoted_lookup')
    expect(promotionRollback).toContain('DROP COLUMN IF EXISTS promoted_to_channel_id')
  })
})
