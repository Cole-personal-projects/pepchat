'use server'

import { createClient } from '@/lib/supabase/server'
import { enqueueDirectMessageNotification } from '@/lib/server-notifications'
import { DM_SELECT } from '@/lib/queries'
import type { DirectMessageWithProfile, Attachment } from '@/lib/types'
import { withAuth } from '@/lib/actions/withAuth'
import { withSideEffects } from '@/lib/actions/sideEffects'

type DMPreviewMessage = {
  id: string
  conversation_id: string
  content: string
  attachments?: Attachment[] | null
  created_at: string
}

function formatDMPreview(content: string, attachments?: Attachment[] | null): string | null {
  const trimmed = content.trim()
  if (trimmed) return trimmed.slice(0, 100)
  if (!attachments || attachments.length === 0) return null

  const [first] = attachments
  if (attachments.length === 1) {
    if (first.type === 'gif') return 'GIF'
    if (first.type === 'image') return 'Image'
    return 'Attachment'
  }

  return `${attachments.length} attachments`
}

async function updateConversationPreview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
): Promise<void> {
  const { data: latest } = await supabase
    .from('direct_messages')
    .select('id, conversation_id, content, attachments, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const latestMessage = latest as DMPreviewMessage | null
  await supabase
    .from('dm_conversations')
    .update({
      last_message:    latestMessage ? formatDMPreview(latestMessage.content, latestMessage.attachments) : null,
      last_message_at: latestMessage?.created_at ?? null,
    })
    .eq('id', conversationId)
}

export const sendDM = withAuth(
  async (ctx, conversationId: string, recipientId: string, content: string, attachments?: Attachment[]): Promise<{ error: string } | { ok: true; message: DirectMessageWithProfile }> => {
    const trimmed = content.trim()
    if (!trimmed && (!attachments || attachments.length === 0)) return { error: 'Message cannot be empty.' }
    if (trimmed.length > 4000) return { error: 'Message too long (max 4000 characters).' }

    const result = await withSideEffects(ctx.supabase, ctx.user.id, async () => {
      const { data: msg, error } = await ctx.supabase
        .from('direct_messages')
        .insert({
          conversation_id: conversationId,
          sender_id:       ctx.user.id,
          recipient_id:    recipientId,
          content:         trimmed,
          attachments:     attachments ?? [],
        })
        .select(DM_SELECT)
        .single()

      if (error || !msg) throw new Error(error?.message ?? 'Failed to send message.')

      // Update conversation preview
      await ctx.supabase
        .from('dm_conversations')
        .update({ last_message: formatDMPreview(trimmed, attachments), last_message_at: new Date().toISOString() })
        .eq('id', conversationId)

      return msg as unknown as DirectMessageWithProfile
    }, {
      onFailure: 'silent',
      // DM fanout happens in the manual block below once the message id is
      // resolved; a draft here would dispatch with an empty id ('dm' wasn't
      // even a dispatcher case — it only logged an unknown-type warning).
    })

    // Notification fanout — send after commit via separate enqueue
    try {
      const sentMessage = result.data
      await enqueueDirectMessageNotification(ctx.supabase, {
        recipientId,
        senderId: ctx.user.id,
        senderName: sentMessage.sender.display_name ?? sentMessage.sender.username,
        messageId: sentMessage.id,
        conversationId,
        content: trimmed,
        attachments: attachments ?? [],
      })
      await import('@/lib/push/delivery').then(({ deliverPushForSources }) =>
        deliverPushForSources([sentMessage.id]),
      )
    } catch {
      // Notification fanout should never block the core message send path.
    }

    return { ok: true, message: result.data }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) }
)

export const editDM = withAuth(
  async (ctx, messageId: string, content: string): Promise<{ error: string } | { ok: true }> => {
    const trimmed = content.trim()
    if (!trimmed) return { error: 'Message cannot be empty.' }

    const result = await withSideEffects(ctx.supabase, ctx.user.id, async () => {
      const { data, error } = await ctx.supabase
        .from('direct_messages')
        .update({ content: trimmed, edited_at: new Date().toISOString() })
        .eq('id', messageId)
        .eq('sender_id', ctx.user.id)
        .select('id, conversation_id, content, attachments, created_at')
        .single()

      if (error) throw new Error(error.message)

      const updatedMessage = data as DMPreviewMessage | null
      if (updatedMessage) {
        await updateConversationPreview(ctx.supabase, updatedMessage.conversation_id)
      }
    }, {
      onFailure: 'silent',
      audit: {
        action: 'dm.edit',
        targetType: 'direct_message',
        targetId: messageId,
      },
    })

    if (!result.sideEffects.ok) {
      console.warn('[editDM] Side effect failed', result.sideEffects)
    }

    return { ok: true }
  }
)

export const deleteDM = withAuth(
  async (ctx, messageId: string): Promise<{ error: string } | { ok: true }> => {
    const result = await withSideEffects(ctx.supabase, ctx.user.id, async () => {
      const { data: target } = await ctx.supabase
        .from('direct_messages')
        .select('conversation_id')
        .eq('id', messageId)
        .single()

      const { data, error } = await ctx.supabase
        .from('direct_messages')
        .delete()
        .eq('id', messageId)

      if (error) throw new Error(error.message)

      // Update the conversation preview after delete
      if (target) {
        await updateConversationPreview(ctx.supabase, target.conversation_id)
      }
    }, {
      onFailure: 'silent',
      audit: {
        action: 'dm.delete',
        targetType: 'direct_message',
        targetId: messageId,
      },
    })

    if (!result.sideEffects.ok) {
      console.warn('[deleteDM] Side effect failed', result.sideEffects)
    }

    return { ok: true }
  }
)

export const markDMsRead = withAuth(
  async ({ supabase, user }, conversationId: string): Promise<void> => {
    await supabase
      .from('direct_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('recipient_id', user.id)
      .is('read_at', null)
  },
)
