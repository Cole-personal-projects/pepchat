'use client'

import { useCallback, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel'
import { MESSAGE_SELECT } from '@/lib/queries'
import type { MessageWithProfile, Reaction } from '@/lib/types'

const PAGE_SIZE = 50

interface UseMessagesReturn {
  messages: MessageWithProfile[]
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => Promise<void>
  addMessage: (msg: MessageWithProfile) => void
  removeMessage: (messageId: string) => void
  broadcastNewMessage: (msg: MessageWithProfile) => void
  toggleReactionOptimistic: (messageId: string, emoji: string, userId: string, username: string) => void
  broadcastReactionChange: (messageId: string, emoji: string, userId: string, action: 'added' | 'removed') => void
  updateMessageContent: (messageId: string, content: string) => void
  updateMessagePinnedAt: (messageId: string, pinnedAt: string | null) => void
}

/**
 * Manages the message list for a channel.
 *
 * New messages use Supabase Broadcast (sender pushes to the room after insert,
 * all other members receive it instantly without RLS interference).
 *
 * Edits and deletes still use postgres_changes since those only need to update
 * existing state and don't require delivering profile data.
 *
 * Reactions use Broadcast for add/remove events.
 */
export function useMessages(
  channelId: string,
  initialMessages: MessageWithProfile[],
  currentUserId?: string
): UseMessagesReturn {
  const [messages, setMessages]       = useState<MessageWithProfile[]>(initialMessages)
  const [hasMore, setHasMore]         = useState(initialMessages.length === PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const { channelRef } = useRealtimeChannel({
    topic: `messages-${channelId}`,
    deps: [channelId],
    bindings: [
      {
        type: 'broadcast',
        filter: { event: 'new_message' },
        handler: ({ payload }) => {
          const msg = payload.message as MessageWithProfile
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev
            return [...prev, msg]
          })
        },
      },
      {
        type: 'broadcast',
        filter: { event: 'reaction_added' },
        handler: ({ payload }) => {
          const { messageId, reaction } = payload as { messageId: string; reaction: Reaction }
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== messageId) return m
              const existing = m.reactions ?? []
              if (existing.some((r) => r.id === reaction.id || (r.user_id === reaction.user_id && r.emoji === reaction.emoji))) return m
              return { ...m, reactions: [...existing, reaction] }
            })
          )
        },
      },
      {
        type: 'broadcast',
        filter: { event: 'reaction_removed' },
        handler: ({ payload }) => {
          const { messageId, userId, emoji } = payload as { messageId: string; userId: string; emoji: string }
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== messageId) return m
              return { ...m, reactions: (m.reactions ?? []).filter((r) => !(r.user_id === userId && r.emoji === emoji)) }
            })
          )
        },
      },
      {
        type: 'postgres_changes',
        filter: { event: 'INSERT', schema: 'public', table: 'messages' },
        handler: async (payload) => {
          const inserted = payload.new as { id?: string; channel_id?: string } | null
          if (!inserted?.id || inserted.channel_id !== channelId) return

          const supabase = createClient()
          const { data, error } = await supabase
            .from('messages')
            .select(MESSAGE_SELECT)
            .eq('id', inserted.id)
            .is('thread_root_id', null)
            .single()

          if (error || !data) return
          const msg = data as MessageWithProfile
          if (msg.channel_id !== channelId) return
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev
            return [...prev, msg]
          })
        },
      },
      {
        type: 'postgres_changes',
        filter: { event: 'UPDATE', schema: 'public', table: 'messages' },
        handler: (payload) => {
          if (payload.new.channel_id !== channelId) return
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.new.id
                ? { ...m, content: payload.new.content as string, edited_at: payload.new.edited_at as string | null, pinned_at: payload.new.pinned_at as string | null }
                : m
            )
          )
        },
      },
      {
        type: 'postgres_changes',
        filter: { event: 'DELETE', schema: 'public', table: 'messages' },
        handler: (payload) => {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id))
        },
      },
    ],
  })

  /** Broadcast a freshly inserted message to all other room members. */
  const broadcastNewMessage = useCallback((msg: MessageWithProfile) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'new_message',
      payload: { message: msg },
    })
  }, [])

  /** Add a message to local state immediately (used by the sender). */
  const addMessage = useCallback((msg: MessageWithProfile) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev
      return [...prev, msg]
    })
  }, [])

  /** Remove a message from local state after a successful delete. */
  const removeMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId))
  }, [])

  /**
   * Optimistically toggle a reaction in local state.
   * Call before the server action; caller is responsible for rollback on error.
   */
  const toggleReactionOptimistic = useCallback(
    (messageId: string, emoji: string, userId: string, username: string) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m
          const existing = m.reactions ?? []
          const hasReaction = existing.some((r) => r.user_id === userId && r.emoji === emoji)
          if (hasReaction) {
            return { ...m, reactions: existing.filter((r) => !(r.user_id === userId && r.emoji === emoji)) }
          } else {
            const newReaction: Reaction = {
              id: `optimistic-${Date.now()}`,
              message_id: messageId,
              user_id: userId,
              emoji,
              created_at: new Date().toISOString(),
              profiles: { username },
            }
            return { ...m, reactions: [...existing, newReaction] }
          }
        })
      )
    },
    []
  )

  /** Broadcast a reaction change to other room members. */
  const broadcastReactionChange = useCallback(
    (messageId: string, emoji: string, userId: string, action: 'added' | 'removed') => {
      if (action === 'added') {
        // Build a minimal reaction object for peers (no real id yet — they'll get it via their own fetch if needed)
        const reaction: Reaction = {
          id: `broadcast-${Date.now()}`,
          message_id: messageId,
          user_id: userId,
          emoji,
          created_at: new Date().toISOString(),
        }
        channelRef.current?.send({
          type: 'broadcast',
          event: 'reaction_added',
          payload: { messageId, reaction },
        })
      } else {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'reaction_removed',
          payload: { messageId, userId, emoji },
        })
      }
    },
    []
  )

  /** Optimistically update a message's pinned_at in local state after pin/unpin. */
  const updateMessagePinnedAt = useCallback((messageId: string, pinnedAt: string | null) => {
    setMessages(prev =>
      prev.map(m => m.id === messageId ? { ...m, pinned_at: pinnedAt } : m)
    )
  }, [])

  /** Optimistically update a message's content in local state after a successful edit. */
  const updateMessageContent = useCallback((messageId: string, content: string) => {
    setMessages(prev =>
      prev.map(m =>
        m.id === messageId
          ? { ...m, content, edited_at: new Date().toISOString() }
          : m
      )
    )
  }, [])

  /** Prepend older messages (pagination). */
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const oldest = messages[0]?.created_at
    if (!oldest) { setLoadingMore(false); return }

    const supabase = createClient()
    const { data } = await supabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('channel_id', channelId)
      .is('thread_root_id', null)
      .lt('created_at', oldest)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)

    if (data) {
      const older = (data as MessageWithProfile[]).reverse()
      setMessages((prev) => [...older, ...prev])
      setHasMore(data.length === PAGE_SIZE)
    }
    setLoadingMore(false)
  }, [channelId, hasMore, loadingMore, messages])

  return { messages, hasMore, loadingMore, loadMore, addMessage, removeMessage, broadcastNewMessage, toggleReactionOptimistic, broadcastReactionChange, updateMessageContent, updateMessagePinnedAt }
}
