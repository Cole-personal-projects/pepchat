-- Threads V1 PR4 mirror sync
-- Idempotent and independently revertible. Apply manually in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.validate_thread_mirror_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  source_channel_id uuid;
  source_user_id uuid;
  source_thread_root_id uuid;
  source_mirrored_from_thread_id uuid;
BEGIN
  IF NEW.mirrored_from_thread_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.thread_root_id IS NOT NULL THEN
    RAISE EXCEPTION 'Mirror messages must not be thread replies.';
  END IF;

  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Mirror messages must be authored by the authenticated user.';
  END IF;

  SELECT m.channel_id, m.user_id, m.thread_root_id, m.mirrored_from_thread_id
    INTO source_channel_id, source_user_id, source_thread_root_id, source_mirrored_from_thread_id
    FROM public.messages m
    WHERE m.id = NEW.mirrored_from_thread_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mirror source thread reply not found.';
  END IF;

  IF source_thread_root_id IS NULL OR source_mirrored_from_thread_id IS NOT NULL THEN
    RAISE EXCEPTION 'Mirror source must be a thread reply.';
  END IF;

  IF source_channel_id IS DISTINCT FROM NEW.channel_id THEN
    RAISE EXCEPTION 'Mirror messages must stay in the source channel.';
  END IF;

  IF source_user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Mirror messages must reference an own thread reply.';
  END IF;

  IF NOT public.can_read_channel_messages(NEW.channel_id) THEN
    RAISE EXCEPTION 'Not authorized to mirror this thread reply.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_thread_mirror_invariants ON public.messages;
CREATE TRIGGER trg_validate_thread_mirror_invariants
  BEFORE INSERT OR UPDATE OF channel_id, user_id, thread_root_id, mirrored_from_thread_id ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_thread_mirror_invariants();

CREATE OR REPLACE FUNCTION public.sync_thread_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Run before PostgreSQL's ON DELETE SET NULL FK action on mirror rows can
  -- clear mirrored_from_thread_id. The delete branch must still be able to
  -- match mirror.mirrored_from_thread_id = OLD.id to tombstone stale content.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.thread_root_id IS NOT NULL
       AND NEW.mirrored_from_thread_id IS NULL
       AND OLD.content IS DISTINCT FROM NEW.content THEN
      UPDATE public.messages AS mirror
        SET content = NEW.content, edited_at = now()
        WHERE mirror.mirrored_from_thread_id = NEW.id
          AND mirror.thread_root_id IS NULL
          AND mirror.channel_id = NEW.channel_id
          AND mirror.user_id = NEW.user_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.thread_root_id IS NOT NULL
       AND OLD.mirrored_from_thread_id IS NULL THEN
      UPDATE public.messages AS mirror
        SET content = '[deleted]', edited_at = now()
        WHERE mirror.mirrored_from_thread_id = OLD.id
          AND mirror.thread_root_id IS NULL
          AND mirror.channel_id = OLD.channel_id
          AND mirror.user_id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_thread_mirror ON public.messages;
CREATE TRIGGER trg_sync_thread_mirror
  BEFORE UPDATE OF content OR DELETE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_thread_mirror();

-- Rollback:
-- DROP TRIGGER IF EXISTS trg_sync_thread_mirror ON public.messages;
-- DROP FUNCTION IF EXISTS public.sync_thread_mirror();
-- DROP TRIGGER IF EXISTS trg_validate_thread_mirror_invariants ON public.messages;
-- DROP FUNCTION IF EXISTS public.validate_thread_mirror_invariants();
