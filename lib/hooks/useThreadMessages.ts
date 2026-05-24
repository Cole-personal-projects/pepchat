'use client'

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { MESSAGE_SELECT } from '@/lib/queries'
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel'
import { createClient } from '@/lib/supabase/client'
import type { MessageWithProfile } from '@/lib/types'

type ThreadActivityPayload = {
  rootId: string
  replyCount: number
  lastReplyAt: string
}

type NewThreadReplyPayload = {
  messageId?: string
  rootId?: string
  channelId?: string
}

export type ThreadPromotedPayload = {
  rootId: string
  newChannelId: string
  channelName: string
}

type ThreadPromotedBroadcastPayload = {
  newChannelId?: string
  channelName?: string
}

const EMPTY_REPLIES: MessageWithProfile[] = []

interface UseThreadMessagesReturn {
  replies: MessageWithProfile[]
  setReplies: Dispatch<SetStateAction<MessageWithProfile[]>>
  addReply: (reply: MessageWithProfile) => void
  removeReply: (replyId: string) => void
  broadcastNewThreadReply: (reply: MessageWithProfile) => void
  broadcastThreadActivity: (activity: ThreadActivityPayload) => void
}

export function useThreadMessages(
  rootId: string | null,
  channelId: string | null,
  initialReplies: MessageWithProfile[] = EMPTY_REPLIES,
  onThreadPromoted?: (payload: ThreadPromotedPayload) => void
): UseThreadMessagesReturn {
  const [replies, setReplies] = useState<MessageWithProfile[]>(initialReplies)

  useEffect(() => {
    setReplies(initialReplies)
  }, [initialReplies, rootId])

  const addReply = useCallback((reply: MessageWithProfile) => {
    setReplies(prev => {
      if (prev.some(existing => existing.id === reply.id)) return prev
      return [...prev, reply]
    })
  }, [])

  const removeReply = useCallback((replyId: string) => {
    setReplies(prev => prev.filter(reply => reply.id !== replyId))
  }, [])

  const { channelRef: threadChannelRef } = useRealtimeChannel({
    topic: `thread-${rootId ?? 'idle'}`,
    enabled: Boolean(rootId),
    deps: [rootId, onThreadPromoted],
    bindings: [
      {
        type: 'broadcast',
        filter: { event: 'new_thread_reply' },
        handler: async ({ payload }) => {
          const replyPayload = payload as NewThreadReplyPayload | undefined
          if (!replyPayload?.messageId || replyPayload.rootId !== rootId) return

          const supabase = createClient()
          const { data, error } = await supabase
            .from('messages')
            .select(MESSAGE_SELECT)
            .eq('id', replyPayload.messageId)
            .eq('thread_root_id', rootId)
            .single()

          if (error || !data) return
          const reply = data as MessageWithProfile
          if (reply.thread_root_id !== rootId) return
          addReply(reply)
        },
      },
      {
        type: 'broadcast',
        filter: { event: 'thread_promoted' },
        handler: ({ payload }) => {
          const promotedPayload = payload as ThreadPromotedBroadcastPayload | undefined
          if (!rootId || !promotedPayload?.newChannelId) return
          onThreadPromoted?.({
            rootId,
            newChannelId: promotedPayload.newChannelId,
            channelName: promotedPayload.channelName ?? 'new-channel',
          })
        },
      },
      {
        type: 'postgres_changes',
        filter: {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: rootId ? `thread_root_id=eq.${rootId}` : 'thread_root_id=eq.__idle__',
        },
        handler: payload => {
          setReplies(prev =>
            prev.map(reply =>
              reply.id === payload.new.id
                ? {
                    ...reply,
                    content: payload.new.content as string,
                    edited_at: payload.new.edited_at as string | null,
                    pinned_at: payload.new.pinned_at as string | null,
                    promoted_to_channel_id: payload.new.promoted_to_channel_id as string | null,
                    promoted_at: payload.new.promoted_at as string | null,
                  }
                : reply
            )
          )
        },
      },
      {
        type: 'postgres_changes',
        filter: {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: rootId ? `thread_root_id=eq.${rootId}` : 'thread_root_id=eq.__idle__',
        },
        handler: payload => {
          setReplies(prev => prev.filter(reply => reply.id !== payload.old.id))
        },
      },
    ],
  })

  const { channelRef: activityChannelRef } = useRealtimeChannel({
    topic: `messages-${channelId ?? 'idle'}`,
    enabled: Boolean(channelId && rootId),
    options: { config: { private: true } },
    deps: [channelId, rootId],
    bindings: [],
  })

  const broadcastNewThreadReply = useCallback((reply: MessageWithProfile) => {
    threadChannelRef.current?.send({
      type: 'broadcast',
      event: 'new_thread_reply',
      payload: { messageId: reply.id, rootId: reply.thread_root_id, channelId: reply.channel_id },
    })
  }, [])

  const broadcastThreadActivity = useCallback((activity: ThreadActivityPayload) => {
    activityChannelRef.current?.send({
      type: 'broadcast',
      event: 'thread_activity',
      payload: activity,
    })
  }, [])

  return {
    replies,
    setReplies,
    addReply,
    removeReply,
    broadcastNewThreadReply,
    broadcastThreadActivity,
  }
}
