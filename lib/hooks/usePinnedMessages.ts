'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel'
import type { PinnedMessage } from '@/lib/types'

const PINNED_SELECT = `
  id, channel_id, message_id, pinned_by_id, system_message_id, pinned_at,
  message:messages!pinned_messages_message_id_fkey(
    id, content, created_at, user_id,
    profiles(username, display_name, avatar_url, username_color)
  )
`

interface UsePinnedMessagesReturn {
  pinnedMessages: PinnedMessage[]
  pinnedCount: number
  refetch: () => Promise<void>
}

export function usePinnedMessages(channelId: string): UsePinnedMessagesReturn {
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([])
  const supabase = useRef(createClient()).current

  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from('pinned_messages')
      .select(PINNED_SELECT)
      .eq('channel_id', channelId)
      .order('pinned_at', { ascending: false })
    if (data) setPinnedMessages(data as unknown as PinnedMessage[])
  }, [channelId, supabase])

  useEffect(() => {
    refetch()
  }, [refetch])

  useRealtimeChannel({
    topic: `pinned-${channelId}`,
    enabled: Boolean(channelId),
    deps: [channelId, refetch],
    bindings: [
      {
        type: 'postgres_changes',
        filter: { event: 'INSERT', schema: 'public', table: 'pinned_messages' },
        handler: ({ new: row }) => {
          // No server-side filter (requires REPLICA IDENTITY FULL); filter client-side
          if ((row as any).channel_id !== channelId) return
          // Refetch to get the full record with message + profile joins
          refetch()
        },
      },
      {
        type: 'postgres_changes',
        filter: { event: 'DELETE', schema: 'public', table: 'pinned_messages' },
        handler: ({ old: row }) => {
          setPinnedMessages(prev => prev.filter(p => p.id !== (row as any).id))
        },
      },
    ],
  })

  return { pinnedMessages, pinnedCount: pinnedMessages.length, refetch }
}
