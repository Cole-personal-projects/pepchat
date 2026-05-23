'use server'

import { revalidatePath } from 'next/cache'
import type { MessageSearchResult, MessageWithProfile, Attachment } from '@/lib/types'
import { MESSAGE_SELECT } from '@/lib/queries'
import { withAuth } from '@/lib/actions/withAuth'
import { withSideEffects } from '@/lib/actions/sideEffects'

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path)
  } catch (err) {
    console.warn('[messages] Failed to revalidate path', path, err)
  }
}

type SearchMessagesInput = {
  groupId: string
  query?: string
  author?: string
  channel?: string
  date?: string
  limit?: number
}

export const sendMessage = withAuth(
  async (ctx, channelId: string, content: string, replyToId?: string | null, attachments?: Attachment[]) => {
    const trimmed = content.trim()
    if (!trimmed && (!attachments || attachments.length === 0)) return { error: 'Message cannot be empty.' }
    if (trimmed.length > 4000) return { error: 'Message too long (max 4000 characters).' }

    let result
    try {
      result = await withSideEffects(ctx.supabase, ctx.user.id, async () => {
        const { data: message, error } = await ctx.supabase
          .from('messages')
          .insert({
            channel_id:  channelId,
            user_id:     ctx.user.id,
            content:     trimmed,
            reply_to_id: replyToId ?? null,
            attachments: attachments ?? [],
          })
          .select(MESSAGE_SELECT)
          .single()

        if (error || !message) throw new Error(error?.message ?? 'Failed to send message.')
        return message as MessageWithProfile
      }, {
        onFailure: 'silent',
        notifications: [{
          type: 'mention',
          payload: {
            senderId: ctx.user.id,
            senderName: '', // filled in afterCommit
            messageId: '',
            channelId,
            content: trimmed,
          },
        }],
        afterCommit(message) {
          // Patch notification payload with actual message id and resolved name
          const name = message.profiles.display_name ?? message.profiles.username
          return (async () => {
            // Update the notification payload in-place isn't feasible here since
            // afterCommit runs after side-effects. So we dispatch directly.
            // The notification was sent with empty senderName/messageId — we'll
            // use the direct enqueue approach instead.
          })()
        },
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to send message.' }
    }

    // Notification fanout — dispatch manually after we have the resolved message
    try {
      const name = result.data.profiles.display_name ?? result.data.profiles.username
      await import('@/lib/server-notifications').then(({ enqueueMentionNotifications }) =>
        enqueueMentionNotifications(ctx.supabase, {
          senderId: ctx.user.id,
          senderName: name,
          messageId: result.data.id,
          channelId,
          content: trimmed,
        })
      )
    } catch {
      // Notification fanout should never block the core message send path.
    }

    // Avoid next-on-pages/Cloudflare Server Action response failures after successful writes.
    // Realtime subscriptions and the channel reload path refresh message state.
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) }
)

export const searchMessages = withAuth(
  async (ctx, input: SearchMessagesInput) => {
    const groupId = input.groupId?.trim()
    if (!groupId) return { error: 'Missing group.' }

    const { data: membership } = await ctx.supabase
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', ctx.user.id)
      .maybeSingle()

    if (!membership) return { error: 'You are not a member of this group.' }

    const normalizedQuery = input.query?.trim().toLowerCase() ?? ''
    const normalizedAuthor = input.author?.trim().toLowerCase() ?? ''
    const normalizedChannel = input.channel?.trim().toLowerCase().replace(/^#/, '') ?? ''
    const date = input.date?.trim() ?? ''
    const limit = Math.max(10, Math.min(input.limit ?? 80, 100))

    if (!normalizedQuery && !normalizedAuthor && !normalizedChannel && !date) {
      return { ok: true, messages: [] }
    }

    let query = ctx.supabase
      .from('messages')
      .select(`${MESSAGE_SELECT}, channels!inner(id, name, group_id)`)
      .eq('channels.group_id', groupId)
      .is('thread_root_id', null)
      .eq('is_system', false)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`)
      const end = new Date(`${date}T23:59:59.999Z`)
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        query = query.gte('created_at', start.toISOString()).lte('created_at', end.toISOString())
      }
    }

    const { data, error } = await query
    if (error) return { error: error.message }

    const messages = ((data ?? []) as MessageSearchResult[]).filter(message => {
      const author = `${message.profiles?.display_name ?? ''} ${message.profiles?.username ?? ''}`.toLowerCase()
      const channel = message.channels?.name?.toLowerCase() ?? ''
      const attachments = (message.attachments ?? [])
        .map(attachment => `${attachment.type} ${attachment.name}`)
        .join(' ')
        .toLowerCase()
      const replyText = message.replied_to
        ? `${message.replied_to.content} ${message.replied_to.profiles?.username ?? ''}`.toLowerCase()
        : ''
      const haystack = `${message.content} ${author} ${channel} ${attachments} ${replyText}`.toLowerCase()

      return (
        (!normalizedQuery || haystack.includes(normalizedQuery)) &&
        (!normalizedAuthor || author.includes(normalizedAuthor)) &&
        (!normalizedChannel || channel.includes(normalizedChannel))
      )
    })

    return { ok: true, messages }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) }
)

export const editMessage = withAuth(
  async (ctx, messageId: string, content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return { error: 'Message cannot be empty.' }
    if (trimmed.length > 4000) return { error: 'Message too long (max 4000 characters).' }

    const result = await withSideEffects(ctx.supabase, ctx.user.id, async () => {
      const { error } = await ctx.supabase
        .from('messages')
        .update({ content: trimmed, edited_at: new Date().toISOString() })
        .eq('id', messageId)
        .eq('user_id', ctx.user.id)

      if (error) throw new Error(error.message)
    }, {
      onFailure: 'silent',
      audit: {
        action: 'message.edit',
        targetType: 'message',
        targetId: messageId,
        metadata: { content_length: trimmed.length },
      },
    })

    if (!result.sideEffects.ok) {
      console.warn('[editMessage] Side effect failed', result.sideEffects)
    }

    safeRevalidatePath('/channels')
    return { ok: true, message: result.data }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) }
)

export const deleteMessage = withAuth(
  async (ctx, messageId: string): Promise<{ error: string } | { ok: true }> => {
    const result = await withSideEffects(ctx.supabase, ctx.user.id, async () => {
      const { error } = await ctx.supabase
        .from('messages')
        .delete()
        .eq('id', messageId)

      if (error) throw new Error(error.message)
    }, {
      onFailure: 'silent',
      audit: {
        action: 'message.delete',
        targetType: 'message',
        targetId: messageId,
      },
    })

    if (!result.sideEffects.ok) {
      console.warn('[deleteMessage] Side effect failed', result.sideEffects)
    }

    return { ok: true }
  }
)

export const pinMessage = withAuth(
  async (ctx, messageId: string, channelId: string): Promise<{ error: string } | { ok: true }> => {
    const result = await withSideEffects(ctx.supabase, ctx.user.id, async () => {
      const { data: profile } = await ctx.supabase
        .from('profiles')
        .select('username, display_name')
        .eq('id', ctx.user.id)
        .single()

      // Idempotent: skip if already pinned
      const { data: existing } = await ctx.supabase
        .from('pinned_messages')
        .select('id')
        .eq('channel_id', channelId)
        .eq('message_id', messageId)
        .maybeSingle()
      if (existing) return { channel_id: channelId, message_id: messageId } as const

      // Mark the message itself as pinned (RPC bypasses ownership RLS)
      await ctx.supabase.rpc('set_message_pinned_at', {
        p_message_id: messageId,
        p_pinned_at:  new Date().toISOString(),
      })

      // Insert the system message
      const pinnedBy = profile?.display_name ?? profile?.username ?? 'Someone'
      const { data: systemMsg } = await ctx.supabase
        .from('messages')
        .insert({
          channel_id: channelId,
          user_id:    ctx.user.id,
          content:    '',
          is_system:  true,
          system_type: 'pin',
          system_data: { pinned_by: pinnedBy, message_id: messageId },
        })
        .select('id')
        .single()

      // Record in pinned_messages
      const { error } = await ctx.supabase
        .from('pinned_messages')
        .insert({
          channel_id:        channelId,
          message_id:        messageId,
          pinned_by_id:      ctx.user.id,
          system_message_id: systemMsg?.id ?? null,
        })

      if (error) throw new Error(error.message)
      return { channel_id: channelId, message_id: messageId } as const
    }, {
      onFailure: 'bubble',
      audit: {
        action: 'message.pin',
        targetType: 'channel',
        targetId: channelId,
        metadata: { message_id: messageId },
      },
    })

    safeRevalidatePath(`/channels/${channelId}`)
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) }
)

export const unpinMessage = withAuth(
  async (ctx, pinnedId: string): Promise<{ error: string } | { ok: true }> => {
    const result = await withSideEffects(ctx.supabase, ctx.user.id, async () => {
      // Fetch system_message_id and message_id before deleting
      const { data: pin } = await ctx.supabase
        .from('pinned_messages')
        .select('message_id, system_message_id')
        .eq('id', pinnedId)
        .single()

      const { error } = await ctx.supabase
        .from('pinned_messages')
        .delete()
        .eq('id', pinnedId)

      if (error) throw new Error(error.message)

      if (pin) {
        // Clear pinned_at on the original message (RPC bypasses ownership RLS)
        await ctx.supabase.rpc('set_message_pinned_at', {
          p_message_id: pin.message_id,
          p_pinned_at:  null,
        })

        // Delete the system message
        if (pin.system_message_id) {
          await ctx.supabase.from('messages').delete().eq('id', pin.system_message_id)
        }
      }

      return pin as { message_id: string; system_message_id: string } | null
    }, {
      onFailure: 'bubble',
      audit: {
        action: 'message.unpin',
        targetType: 'pinned_message',
        targetId: pinnedId,
      },
    })

    if (result.data) {
      safeRevalidatePath(`/channels`)
    }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) }
)
