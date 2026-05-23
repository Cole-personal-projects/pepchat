-- Thread columns on messages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS thread_root_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS thread_reply_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS thread_last_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS mirrored_from_thread_id uuid REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_thread_root
  ON messages(thread_root_id)
  WHERE thread_root_id IS NOT NULL;

-- Hot path: channel timeline ordered by recent thread activity
CREATE INDEX IF NOT EXISTS idx_messages_thread_activity
  ON messages(channel_id, thread_last_reply_at DESC)
  WHERE thread_root_id IS NULL;

-- Per-thread unread tracking
CREATE TABLE IF NOT EXISTS thread_read_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  thread_root_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, thread_root_id)
);
ALTER TABLE thread_read_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION maintain_thread_counters()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.thread_root_id IS NOT NULL THEN
    UPDATE messages
      SET thread_reply_count = thread_reply_count + 1,
          thread_last_reply_at = NEW.created_at
      WHERE id = NEW.thread_root_id;
  ELSIF TG_OP = 'DELETE' AND OLD.thread_root_id IS NOT NULL THEN
    UPDATE messages
      SET thread_reply_count = GREATEST(thread_reply_count - 1, 0)
      WHERE id = OLD.thread_root_id;
    -- Note: thread_last_reply_at is not recomputed on delete (would require a
    -- SELECT MAX); allow it to drift. Recompute lazily on next thread fetch
    -- if accuracy becomes a problem. V2 candidate.
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_maintain_thread_counters ON messages;
CREATE TRIGGER trg_maintain_thread_counters
  AFTER INSERT OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION maintain_thread_counters();

ALTER TABLE notification_events DROP CONSTRAINT IF EXISTS notification_events_type_check;
ALTER TABLE notification_events
  ADD CONSTRAINT notification_events_type_check
  CHECK (type IN ('dm_message', 'mention', 'group_message', 'thread_reply'));

-- thread_read_state: user owns their own rows (mirrors channel_read_state)
CREATE POLICY thread_read_state_select_own ON thread_read_state
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY thread_read_state_insert_own ON thread_read_state
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY thread_read_state_update_own ON thread_read_state
  FOR UPDATE USING (user_id = auth.uid());
