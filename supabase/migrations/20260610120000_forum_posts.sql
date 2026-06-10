-- Forum channels: posts are thread roots with a required title.
-- Reuses threads-v1 (thread_root_id / thread_reply_count) for replies and
-- forum_tags / forum_post_tags (20260610093000) for tagging.

alter table public.messages
  add column if not exists thread_title text
  check (thread_title is null or char_length(thread_title) <= 100);

-- Forum listing: newest activity first among top-level posts.
create index if not exists idx_messages_forum_posts
  on public.messages(channel_id, created_at desc)
  where thread_root_id is null and thread_title is not null;
