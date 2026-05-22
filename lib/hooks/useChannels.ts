'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel'
import type { Channel } from '@/lib/types'

/**
 * Fetches channels for the given group and subscribes to live changes.
 */
export function useChannels(groupId: string | null) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)

  const fetchChannels = useCallback(async () => {
    if (!groupId) {
      setChannels([])
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data } = await supabase
      .from('channels')
      .select('*')
      .eq('group_id', groupId)
      .order('position', { ascending: true })

    if (data) setChannels(data as Channel[])
    setLoading(false)
  }, [groupId])

  useEffect(() => {
    setLoading(true)
    fetchChannels()
  }, [fetchChannels])

  useRealtimeChannel({
    topic: `channels-${groupId}`,
    enabled: Boolean(groupId),
    deps: [groupId, fetchChannels],
    bindings: [
      {
        type: 'postgres_changes',
        // INSERT and UPDATE carry group_id in the payload — filter works.
        filter: { event: 'INSERT', schema: 'public', table: 'channels', filter: `group_id=eq.${groupId}` },
        handler: fetchChannels,
      },
      {
        type: 'postgres_changes',
        filter: { event: 'UPDATE', schema: 'public', table: 'channels', filter: `group_id=eq.${groupId}` },
        handler: fetchChannels,
      },
      {
        type: 'postgres_changes',
        // DELETE payload only contains the PK (id) with default REPLICA IDENTITY,
        // so the group_id filter never matches. Handle it without a filter and
        // remove by ID client-side — safe because we only remove if the channel
        // is already in our list.
        filter: { event: 'DELETE', schema: 'public', table: 'channels' },
        handler: (payload) => {
          const deletedId = (payload.old as { id: string }).id
          setChannels(prev => {
            const next = prev.filter(c => c.id !== deletedId)
            return next.length === prev.length ? prev : next
          })
        },
      },
    ],
  })

  return { channels, loading, refetch: fetchChannels }
}
