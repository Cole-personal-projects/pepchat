DROP TRIGGER IF EXISTS trg_maintain_thread_counters ON messages;
DROP FUNCTION IF EXISTS maintain_thread_counters();
DROP POLICY IF EXISTS thread_read_state_select_own ON thread_read_state;
DROP POLICY IF EXISTS thread_read_state_insert_own ON thread_read_state;
DROP POLICY IF EXISTS thread_read_state_update_own ON thread_read_state;
DROP TABLE IF EXISTS thread_read_state;
DROP INDEX IF EXISTS idx_messages_thread_activity;
DROP INDEX IF EXISTS idx_messages_thread_root;
ALTER TABLE messages
  DROP COLUMN IF EXISTS mirrored_from_thread_id,
  DROP COLUMN IF EXISTS thread_last_reply_at,
  DROP COLUMN IF EXISTS thread_reply_count,
  DROP COLUMN IF EXISTS thread_root_id;
ALTER TABLE notification_events DROP CONSTRAINT IF EXISTS notification_events_type_check;
ALTER TABLE notification_events
  ADD CONSTRAINT notification_events_type_check
  CHECK (type IN ('dm_message', 'mention', 'group_message'));
