-- Roll back promote-thread-to-channel metadata and RPC.
-- Existing promoted channels/messages are left in place; redirect linkage is removed.

DROP FUNCTION IF EXISTS public.promote_thread_to_channel(uuid, text, text, boolean, uuid);
DROP INDEX IF EXISTS idx_messages_promoted_lookup;
ALTER TABLE messages
  DROP COLUMN IF EXISTS promoted_at,
  DROP COLUMN IF EXISTS promoted_to_channel_id;
