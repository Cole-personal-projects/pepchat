-- Promote thread roots into standalone channels.
-- Idempotent. Apply manually in Supabase SQL Editor before deploy.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS promoted_to_channel_id uuid REFERENCES channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_messages_promoted_lookup
  ON messages(id)
  WHERE promoted_to_channel_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.promote_thread_to_channel(
  p_root_message_id uuid,
  p_new_channel_name text,
  p_new_channel_topic text,
  p_noob_access boolean,
  p_actor_id uuid
) RETURNS TABLE (new_channel_id uuid, moved_reply_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_source_channel_id uuid;
  v_group_id uuid;
  v_root_author uuid;
  v_root_content text;
  v_root_created_at timestamptz;
  v_root_attachments jsonb;
  v_new_channel_id uuid;
  v_moved_count integer;
  v_next_position integer;
  v_moved_reply_ids uuid[];
  v_channel_name text;
  v_channel_topic text;
  v_actor_role public.member_role;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.banned_users bu
      WHERE bu.user_id = p_actor_id
  ) THEN
    RAISE EXCEPTION 'You do not have permission to promote this thread.';
  END IF;

  v_channel_name := lower(regexp_replace(trim(coalesce(p_new_channel_name, '')), '\s+', '-', 'g'));
  v_channel_topic := nullif(trim(coalesce(p_new_channel_topic, '')), '');

  IF v_channel_name = '' THEN
    RAISE EXCEPTION 'Channel name is required.';
  END IF;
  IF length(v_channel_name) > 80 THEN
    RAISE EXCEPTION 'Channel name must be 80 characters or fewer.';
  END IF;
  IF v_channel_name !~ '^[a-z0-9][a-z0-9-]*$' THEN
    RAISE EXCEPTION 'Channel name may only contain lowercase letters, numbers, and hyphens.';
  END IF;
  IF v_channel_topic IS NOT NULL AND length(v_channel_topic) > 180 THEN
    RAISE EXCEPTION 'Topic must be 180 characters or fewer.';
  END IF;

  SELECT m.channel_id, c.group_id, m.user_id, m.content, m.created_at, coalesce(m.attachments, '[]'::jsonb)
    INTO v_source_channel_id, v_group_id, v_root_author, v_root_content, v_root_created_at, v_root_attachments
    FROM public.messages m
    JOIN public.channels c ON c.id = m.channel_id
    WHERE m.id = p_root_message_id
      AND m.thread_root_id IS NULL
    FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Thread root not found.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.messages m
      WHERE m.id = p_root_message_id
        AND m.promoted_to_channel_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Thread already promoted.';
  END IF;

  SELECT gm.role
    INTO v_actor_role
    FROM public.group_members gm
    WHERE gm.group_id = v_group_id
      AND gm.user_id = p_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'You do not have permission to promote this thread.';
  END IF;

  IF v_actor_role NOT IN ('admin', 'moderator')
    AND (
      p_actor_id IS DISTINCT FROM v_root_author
      OR NOT public.can_read_channel_messages(v_source_channel_id)
    ) THEN
    RAISE EXCEPTION 'You do not have permission to promote this thread.';
  END IF;

  LOCK TABLE public.channels IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1
      FROM public.channels c
      WHERE c.group_id = v_group_id
        AND c.name = v_channel_name
  ) THEN
    RAISE EXCEPTION 'Channel name already exists.';
  END IF;

  SELECT count(*)::integer
    INTO v_moved_count
    FROM public.messages
    WHERE thread_root_id = p_root_message_id;

  IF v_moved_count = 0 THEN
    RAISE EXCEPTION 'Cannot promote an empty thread.';
  END IF;

  SELECT coalesce(max(position), -1) + 1
    INTO v_next_position
    FROM public.channels
    WHERE group_id = v_group_id;

  INSERT INTO public.channels (group_id, name, description, noob_access, position)
    VALUES (v_group_id, v_channel_name, v_channel_topic, coalesce(p_noob_access, false), v_next_position)
    RETURNING id INTO v_new_channel_id;

  SELECT coalesce(array_agg(id), ARRAY[]::uuid[])
    INTO v_moved_reply_ids
    FROM public.messages
    WHERE thread_root_id = p_root_message_id;

  UPDATE public.messages
    SET channel_id = v_new_channel_id,
        thread_root_id = NULL
    WHERE thread_root_id = p_root_message_id;

  INSERT INTO public.messages (channel_id, user_id, content, reply_to_id, thread_root_id, attachments, created_at)
    VALUES (v_new_channel_id, v_root_author, v_root_content, NULL, NULL, v_root_attachments, v_root_created_at);

  UPDATE public.messages
    SET promoted_to_channel_id = v_new_channel_id,
        promoted_at = now(),
        content = '',
        thread_reply_count = 0,
        thread_last_reply_at = NULL
    WHERE id = p_root_message_id;

  UPDATE public.messages AS mirror
    SET content = '',
        edited_at = now(),
        promoted_to_channel_id = v_new_channel_id,
        promoted_at = now()
    WHERE mirror.mirrored_from_thread_id = ANY(v_moved_reply_ids)
      AND mirror.thread_root_id IS NULL
      AND mirror.channel_id = v_source_channel_id;

  INSERT INTO public.audit_log (admin_id, action, target_type, target_id, metadata)
    VALUES (
      p_actor_id,
      'thread.promoted_to_channel',
      'message',
      p_root_message_id,
      jsonb_build_object(
        'source_channel_id', v_source_channel_id,
        'target_channel_id', v_new_channel_id,
        'root_message_id', p_root_message_id,
        'moved_reply_count', v_moved_count,
        'channel_name', v_channel_name
      )
    );

  new_channel_id := v_new_channel_id;
  moved_reply_count := v_moved_count;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_thread_to_channel(uuid, text, text, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_thread_to_channel(uuid, text, text, boolean, uuid) TO authenticated;
