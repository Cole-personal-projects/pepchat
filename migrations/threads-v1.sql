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

CREATE OR REPLACE FUNCTION validate_thread_reply_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  root_channel_id uuid;
  root_thread_root_id uuid;
BEGIN
  IF NEW.thread_root_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Thread replies must be authored by the authenticated user.';
  END IF;

  SELECT m.channel_id, m.thread_root_id
    INTO root_channel_id, root_thread_root_id
    FROM public.messages m
    WHERE m.id = NEW.thread_root_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Thread root not found.';
  END IF;

  IF root_thread_root_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot reply to a thread reply.';
  END IF;

  IF root_channel_id IS DISTINCT FROM NEW.channel_id THEN
    RAISE EXCEPTION 'Thread replies must stay in the root channel.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.channels c
      WHERE c.id = NEW.channel_id
        AND c.group_id = ANY(SELECT public.get_user_group_ids())
        AND (
          public.get_user_role_in_group(c.group_id) <> 'noob'
          OR c.noob_access = true
          OR c.name = 'welcome'
        )
  ) THEN
    RAISE EXCEPTION 'Not authorized to reply in this thread.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_thread_reply_invariants ON messages;
CREATE TRIGGER trg_validate_thread_reply_invariants
  BEFORE INSERT OR UPDATE OF channel_id, user_id, thread_root_id ON messages
  FOR EACH ROW EXECUTE FUNCTION validate_thread_reply_invariants();

CREATE OR REPLACE FUNCTION maintain_thread_counters()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION can_read_channel_messages(p_channel_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.channels c
      WHERE c.id = p_channel_id
        AND c.group_id = ANY(SELECT public.get_user_group_ids())
        AND (
          public.get_user_role_in_group(c.group_id) <> 'noob'
          OR c.noob_access = true
          OR c.name = 'welcome'
        )
  )
$$;

CREATE OR REPLACE FUNCTION can_read_thread_messages(p_thread_root_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.messages m
      WHERE m.id = p_thread_root_id
        AND public.can_read_channel_messages(m.channel_id)
  )
$$;

DROP POLICY IF EXISTS "Members can receive authorized message realtime broadcasts" ON realtime.messages;
CREATE POLICY "Members can receive authorized message realtime broadcasts"
  ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    CASE
      WHEN realtime.topic() ~ '^messages-[0-9a-fA-F-]{36}$'
        THEN public.can_read_channel_messages(substring(realtime.topic() from 10)::uuid)
      WHEN realtime.topic() ~ '^thread-[0-9a-fA-F-]{36}$'
        THEN public.can_read_thread_messages(substring(realtime.topic() from 8)::uuid)
      ELSE false
    END
  );

DROP POLICY IF EXISTS "Members can send authorized message realtime broadcasts" ON realtime.messages;
CREATE POLICY "Members can send authorized message realtime broadcasts"
  ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    CASE
      WHEN realtime.topic() ~ '^messages-[0-9a-fA-F-]{36}$'
        THEN public.can_read_channel_messages(substring(realtime.topic() from 10)::uuid)
      WHEN realtime.topic() ~ '^thread-[0-9a-fA-F-]{36}$'
        THEN public.can_read_thread_messages(substring(realtime.topic() from 8)::uuid)
      ELSE false
    END
  );

ALTER TABLE notification_events DROP CONSTRAINT IF EXISTS notification_events_type_check;
ALTER TABLE notification_events
  ADD CONSTRAINT notification_events_type_check
  CHECK (type IN ('dm_message', 'mention', 'group_message', 'thread_reply'));

-- thread_read_state: user owns their own rows (mirrors channel_read_state)
DROP POLICY IF EXISTS thread_read_state_select_own ON thread_read_state;
CREATE POLICY thread_read_state_select_own ON thread_read_state
  FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS thread_read_state_insert_own ON thread_read_state;
CREATE POLICY thread_read_state_insert_own ON thread_read_state
  FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS thread_read_state_update_own ON thread_read_state;
CREATE POLICY thread_read_state_update_own ON thread_read_state
  FOR UPDATE USING (user_id = auth.uid());
