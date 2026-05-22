'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel'

interface UnreadState {
  unreadChannelIds: Set<string>
  unreadGroupIds: Set<string>
  unreadCountsByChannelId: Map<string, number>
}

export function useUnreadChannels(
  userId: string,
  activeChannelId: string | null
): UnreadState {
  const [unreadChannelIds, setUnreadChannelIds] = useState(new Set<string>())
  const [unreadCountsByChannelId, setUnreadCountsByChannelId] = useState(new Map<string, number>())
  const channelGroupMapRef = useRef(new Map<string, string>())

  // Keep a ref so Realtime callbacks always see the current activeChannelId
  // without needing to re-subscribe when it changes.
  const activeChannelIdRef = useRef(activeChannelId)
  useEffect(() => { activeChannelIdRef.current = activeChannelId }, [activeChannelId])

  // When the user navigates to a channel, remove it from the unread set immediately.
  useEffect(() => {
    if (!activeChannelId) return
    setUnreadChannelIds(prev => {
      if (!prev.has(activeChannelId)) return prev
      const next = new Set(prev)
      next.delete(activeChannelId)
      return next
    })
    setUnreadCountsByChannelId(prev => {
      if (!prev.has(activeChannelId)) return prev
      const next = new Map(prev)
      next.delete(activeChannelId)
      return next
    })
  }, [activeChannelId])

  const fetchUnread = useCallback(async () => {
    if (!userId) return
    const supabase = createClient()

    // 1 — All channels accessible to this user (RLS filters by membership)
    const { data: channels } = await supabase
      .from('channels')
      .select('id, group_id')

    const channelGroupMap = new Map<string, string>()
    for (const ch of (channels ?? []) as { id: string; group_id: string }[]) {
      channelGroupMap.set(ch.id, ch.group_id)
    }
    channelGroupMapRef.current = channelGroupMap

    // 2 — User's read states
    const { data: readStates } = await supabase
      .from('channel_read_state')
      .select('channel_id, last_read_at')
      .eq('user_id', userId)

    const readMap = new Map(
      ((readStates ?? []) as { channel_id: string; last_read_at: string }[])
        .map(r => [r.channel_id, r.last_read_at])
    )

    // 3 — Recent messages from other users, capped at 30 days ago.
    // Always use thirtyDaysAgo — channels with no read state row need to be
    // checked from scratch; using min(last_read_at) as cutoff silently excluded
    // messages from never-visited channels.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data: messages } = await supabase
      .from('messages')
      .select('channel_id, created_at')
      .neq('user_id', userId)
      .gte('created_at', thirtyDaysAgo)

    // 4 — Compute unread channel IDs
    const unread = new Set<string>()
    const unreadCounts = new Map<string, number>()
    for (const msg of (messages ?? []) as { channel_id: string; created_at: string }[]) {
      if (msg.channel_id === activeChannelIdRef.current) continue
      const lastRead = readMap.get(msg.channel_id) ?? '1970-01-01T00:00:00Z'
      if (msg.created_at > lastRead) {
        unread.add(msg.channel_id)
        unreadCounts.set(msg.channel_id, (unreadCounts.get(msg.channel_id) ?? 0) + 1)
      }
    }

    setUnreadChannelIds(unread)
    setUnreadCountsByChannelId(unreadCounts)
  }, [userId])

  // Re-fetch on mount and when the tab regains focus — catches events missed while hidden.
  useEffect(() => {
    if (!userId) return

    fetchUnread()
    window.addEventListener('focus', fetchUnread)

    return () => {
      window.removeEventListener('focus', fetchUnread)
    }
  }, [userId, fetchUnread])

  // Subscription + re-fetch on reconnect. Re-runs only when userId changes.
  useRealtimeChannel({
    topic: `unread-${userId}`,
    enabled: Boolean(userId),
    deps: [userId, fetchUnread],
    bindings: [
      {
        type: 'postgres_changes',
        filter: { event: 'INSERT', schema: 'public', table: 'messages' },
        handler: (payload) => {
          const { channel_id, user_id } = payload.new as { channel_id: string; user_id: string }
          if (user_id === userId) return
          if (channel_id === activeChannelIdRef.current) return
          setUnreadChannelIds(prev => new Set(Array.from(prev).concat(channel_id)))
          setUnreadCountsByChannelId(prev => {
            const next = new Map(prev)
            next.set(channel_id, (next.get(channel_id) ?? 0) + 1)
            return next
          })
        },
      },
      {
        type: 'postgres_changes',
        filter: { event: '*', schema: 'public', table: 'channel_read_state' },
        handler: (payload) => {
          const { channel_id } = payload.new as { channel_id: string }
          setUnreadChannelIds(prev => {
            if (!prev.has(channel_id)) return prev
            const next = new Set(prev)
            next.delete(channel_id)
            return next
          })
          setUnreadCountsByChannelId(prev => {
            if (!prev.has(channel_id)) return prev
            const next = new Map(prev)
            next.delete(channel_id)
            return next
          })
        },
      },
    ],
    // Re-fetch on every successful (re)connection so missed events are caught.
    onStatus: (status) => {
      if (status === 'SUBSCRIBED') fetchUnread()
    },
  })

  const unreadGroupIds = useMemo(() => {
    const groups = new Set<string>()
    Array.from(unreadChannelIds).forEach(cId => {
      const gId = channelGroupMapRef.current.get(cId)
      if (gId) groups.add(gId)
    })
    return groups
  }, [unreadChannelIds])

  return { unreadChannelIds, unreadGroupIds, unreadCountsByChannelId }
}
