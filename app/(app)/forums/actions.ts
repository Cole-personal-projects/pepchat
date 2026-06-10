'use server'

import { withAuth } from '@/lib/actions/withAuth'

const MAX_TITLE_LENGTH = 100
const MAX_TAGS_PER_POST = 5

type CreateForumPostResult = { error: string } | { ok: true; postId: string }

/**
 * Creates a forum post: a top-level message with a title that anchors a
 * thread. RLS enforces VIEW + SEND on the channel; tags must belong to it.
 */
export const createForumPost = withAuth(
  async function createForumPostBody({ supabase, user }, formData: FormData): Promise<CreateForumPostResult> {
    const channelId = formData.get('channel_id') as string
    const title = ((formData.get('title') as string | null) ?? '').trim().replace(/\s+/g, ' ')
    const content = ((formData.get('content') as string | null) ?? '').trim()
    const tagIds = formData.getAll('tag_ids').map(String).filter(Boolean)

    if (!channelId) return { error: 'Missing channel.' }
    if (!title) return { error: 'Post title is required.' }
    if (title.length > MAX_TITLE_LENGTH) {
      return { error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.` }
    }
    if (!content) return { error: 'Post body is required.' }
    if (tagIds.length > MAX_TAGS_PER_POST) {
      return { error: `Choose at most ${MAX_TAGS_PER_POST} tags.` }
    }

    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .select('id, kind')
      .eq('id', channelId)
      .single()

    if (channelError && channelError.code !== 'PGRST116') return { error: channelError.message }
    if (!channel || (channel as { kind?: string }).kind !== 'forum') {
      return { error: 'Posts can only be created in forum channels.' }
    }

    if (tagIds.length > 0) {
      const { data: tags, error: tagsError } = await supabase
        .from('forum_tags')
        .select('id')
        .eq('channel_id', channelId)
        .in('id', tagIds)

      if (tagsError) return { error: tagsError.message }
      if ((tags ?? []).length !== tagIds.length) {
        return { error: 'One or more tags do not belong to this forum.' }
      }
    }

    const { data: post, error } = await supabase
      .from('messages')
      .insert({
        channel_id: channelId,
        user_id: user.id,
        content,
        thread_title: title,
      })
      .select('id')
      .single()

    if (error || !post) return { error: error?.message ?? 'Failed to create post.' }
    const postId = (post as { id: string }).id

    if (tagIds.length > 0) {
      const { error: tagError } = await supabase
        .from('forum_post_tags')
        .insert(tagIds.map(tagId => ({ tag_id: tagId, root_message_id: postId })))

      // Tagging is best-effort; the post itself stands.
      if (tagError) return { ok: true, postId }
    }

    return { ok: true, postId }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)
