-- Threads V1 PR4 mirror sync
-- Idempotent and independently revertible. Apply manually in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION sync_thread_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only source thread replies drive mirrors. Mirror rows themselves have
  -- thread_root_id IS NULL and mirrored_from_thread_id IS NOT NULL, so they
  -- cannot recursively trigger source->mirror sync.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.thread_root_id IS NOT NULL
       AND NEW.mirrored_from_thread_id IS NULL
       AND OLD.content IS DISTINCT FROM NEW.content THEN
      UPDATE messages
        SET content = NEW.content, edited_at = now()
        WHERE mirrored_from_thread_id = NEW.id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.thread_root_id IS NOT NULL
       AND OLD.mirrored_from_thread_id IS NULL THEN
      UPDATE messages
        SET content = '[deleted]', deleted_at = now()
        WHERE mirrored_from_thread_id = OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_thread_mirror ON messages;
CREATE TRIGGER trg_sync_thread_mirror
  AFTER UPDATE OF content OR DELETE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION sync_thread_mirror();

-- Rollback:
-- DROP TRIGGER IF EXISTS trg_sync_thread_mirror ON messages;
-- DROP FUNCTION IF EXISTS sync_thread_mirror();
