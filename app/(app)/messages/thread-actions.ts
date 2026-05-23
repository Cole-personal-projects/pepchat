'use server'

import type { Attachment, MessageWithProfile } from '@/lib/types'
import { THREAD_MESSAGE_SELECT } from '@/lib/queries'
import { withAuth } from '@/lib/actions/withAuth'
import { withSideEffects } from '@/lib/actions/sideEffects'

type SendThreadReplyInput = {
  rootId: string
  content: string
  attachments?: Attachment[]
  mirrorToChannel?: boolean
}

type FetchThreadRepliesInput = {
  rootId: string
  cursor?: string
  limit?: number
}

type FetchThreadRootInput = {
  rootId: string
}

type ThreadRootRow = {
  id: string
  channel_id: string
  thread_root_id: string | null
}

type SendThreadReplyOutput = {
  message: MessageWithProfile
  mirrorMessage: MessageWithProfile | null
}

function parseReplyCursor(cursor?: string): { createdAt: string; id: string } | null {
  if (!cursor) return null
  const separator = cursor.lastIndexOf('|')
  if (separator === -1) return null
  const createdAt = cursor.slice(0, separator)
  const id = cursor.slice(separator + 1)
  if (!createdAt || !id) return null
  return { createdAt, id }
}

function toReplyCursor(message: MessageWithProfile): string {
  return `${message.created_at}|${message.id}`
}

async function loadThreadRoot(
  supabase: { from: (table: string) => any },
  rootId: string,
  nonRootError = 'Thread root not found.'
): Promise<{ root: ThreadRootRow | null; error: string | null }> {
  const { data: root, error } = await supabase
    .from('messages')
    .select('id, channel_id, thread_root_id')
    .eq('id', rootId)
    .maybeSingle()

  if (error) return { root: null, error: error.message }
  if (!root) return { root: null, error: 'Thread root not found.' }
  if ((root as ThreadRootRow).thread_root_id) return { root: null, error: nonRootError }

  return { root: root as ThreadRootRow, error: null }
}

export const sendThreadReply = withAuth(
  async (ctx, input: SendThreadReplyInput) => {
    const rootId = input.rootId?.trim()
    const trimmed = input.content.trim()
    const attachments = input.attachments ?? []

    if (!rootId) return { error: 'Missing thread root.' }
    if (!trimmed && attachments.length === 0) return { error: 'Message cannot be empty.' }
    if (trimmed.length > 4000) return { error: 'Message too long (max 4000 characters).' }

    const { root: threadRoot, error: rootError } = await loadThreadRoot(
      ctx.supabase,
      rootId,
      'Cannot reply to a thread reply.'
    )
    if (rootError || !threadRoot) return { error: rootError ?? 'Thread root not found.' }

    let result
    try {
      const notificationDraft = {
        type: 'thread_reply',
        payload: {
          threadRootId: rootId,
          newReplyId: '',
          newReplyAuthorId: ctx.user.id,
          newReplyAuthorName: '',
          channelId: threadRoot.channel_id,
          content: trimmed,
          attachments,
        },
      }

      result = await withSideEffects<SendThreadReplyOutput>(ctx.supabase, ctx.user.id, async () => {
        const { data: message, error } = await ctx.supabase
          .from('messages')
          .insert({
            channel_id: threadRoot.channel_id,
            user_id: ctx.user.id,
            content: trimmed,
            reply_to_id: null,
            thread_root_id: rootId,
            attachments,
          })
          .select(THREAD_MESSAGE_SELECT)
          .single()

        if (error || !message) throw new Error(error?.message ?? 'Failed to send thread reply.')

        let mirrorMessage: MessageWithProfile | null = null
        if (input.mirrorToChannel) {
          const { data: mirror, error: mirrorError } = await ctx.supabase
            .from('messages')
            .insert({
              channel_id: threadRoot.channel_id,
              user_id: ctx.user.id,
              content: trimmed,
              reply_to_id: null,
              thread_root_id: null,
              mirrored_from_thread_id: (message as MessageWithProfile).id,
              attachments,
            })
            .select(THREAD_MESSAGE_SELECT)
            .single()

          if (mirrorError || !mirror) throw new Error(mirrorError?.message ?? 'Failed to mirror thread reply.')
          mirrorMessage = mirror as MessageWithProfile
        }

        return { message: message as MessageWithProfile, mirrorMessage }
      }, {
        onFailure: 'silent',
        audit: {
          action: 'thread.reply',
          targetType: 'message',
          targetId: rootId,
          metadata: { channel_id: threadRoot.channel_id, mirror_to_channel: Boolean(input.mirrorToChannel) },
        },
        notifications: [notificationDraft],
        afterCommit(output) {
          notificationDraft.payload.newReplyId = output.message.id
          notificationDraft.payload.newReplyAuthorName = output.message.profiles.display_name ?? output.message.profiles.username
        },
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to send thread reply.' }
    }

    try {
      const name = result.data.message.profiles.display_name ?? result.data.message.profiles.username
      await import('@/lib/server-notifications').then(({ buildThreadReplyUrl, enqueueMentionNotifications }) =>
        enqueueMentionNotifications(ctx.supabase, {
          senderId: ctx.user.id,
          senderName: name,
          messageId: result.data.message.id,
          channelId: threadRoot.channel_id,
          content: trimmed,
          urlBuilder: ({ channelId, messageId }) => buildThreadReplyUrl(channelId, rootId, messageId),
        })
      )
    } catch {
      // Mention notification fanout should never block the core thread reply path.
    }

    return { ok: true, message: result.data.message, mirrorMessage: result.data.mirrorMessage }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) }
)

export const fetchThreadRoot = withAuth(
  async (ctx, input: FetchThreadRootInput) => {
    const rootId = input.rootId?.trim()
    if (!rootId) return { error: 'Missing thread root.' }

    const { data: root, error } = await ctx.supabase
      .from('messages')
      .select(THREAD_MESSAGE_SELECT)
      .eq('id', rootId)
      .is('thread_root_id', null)
      .maybeSingle()

    if (error) return { error: error.message }
    if (!root) return { error: 'Thread root not found.' }
    return { ok: true, message: root as MessageWithProfile }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) }
)

export const fetchThreadReplies = withAuth(
  async (ctx, input: FetchThreadRepliesInput) => {
    const rootId = input.rootId?.trim()
    if (!rootId) return { error: 'Missing thread root.' }

    const limit = Math.max(1, Math.min(input.limit ?? 50, 100))
    const cursor = parseReplyCursor(input.cursor)

    const { error: rootError } = await loadThreadRoot(ctx.supabase, rootId)
    if (rootError) return { error: rootError }

    let query = ctx.supabase
      .from('messages')
      .select(THREAD_MESSAGE_SELECT)
      .eq('thread_root_id', rootId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit + 1)

    if (cursor) {
      query = query.or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`)
    }

    const { data, error } = await query
    if (error) return { error: error.message }

    const rows = ((data ?? []) as MessageWithProfile[])
    const messages = rows.slice(0, limit)
    const hasMore = rows.length > limit
    return {
      ok: true,
      messages,
      nextCursor: hasMore && messages.length > 0 ? toReplyCursor(messages[messages.length - 1]) : null,
    }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) }
)

export const markThreadRead = withAuth(
  async (ctx, input: { rootId: string }) => {
    const rootId = input.rootId?.trim()
    if (!rootId) return { error: 'Missing thread root.' }

    const { error: rootError } = await loadThreadRoot(ctx.supabase, rootId)
    if (rootError) return { error: rootError }

    const { error } = await ctx.supabase
      .from('thread_read_state')
      .upsert(
        { user_id: ctx.user.id, thread_root_id: rootId, last_read_at: new Date().toISOString() },
        { onConflict: 'user_id,thread_root_id' }
      )

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) }
)
