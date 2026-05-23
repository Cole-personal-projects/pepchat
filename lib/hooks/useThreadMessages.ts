'use client'

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel'
import type { MessageWithProfile } from '@/lib/types'

type ThreadActivityPayload = {
  rootId: string
  replyCount: number
  lastReplyAt: string
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
  initialReplies: MessageWithProfile[] = EMPTY_REPLIES
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
    deps: [rootId],
    bindings: [
      {
        type: 'broadcast',
        filter: { event: 'new_thread_reply' },
        handler: ({ payload }) => {
          const reply = payload?.message as MessageWithProfile | undefined
          if (!reply || reply.thread_root_id !== rootId) return
          addReply(reply)
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
    deps: [channelId, rootId],
    bindings: [],
  })

  const broadcastNewThreadReply = useCallback((reply: MessageWithProfile) => {
    threadChannelRef.current?.send({
      type: 'broadcast',
      event: 'new_thread_reply',
      payload: { message: reply },
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
