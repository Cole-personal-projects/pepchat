'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel'
import type { ChannelCategory } from '@/lib/types'

/**
 * Fetches channel categories for the given group and subscribes to live changes.
 */
export function useChannelCategories(groupId: string | null) {
  const [categories, setCategories] = useState<ChannelCategory[]>([])
  const [loading, setLoading] = useState(true)

  const fetchCategories = useCallback(async () => {
    if (!groupId) {
      setCategories([])
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data } = await supabase
      .from('channel_categories')
      .select('*')
      .eq('group_id', groupId)
      .order('position', { ascending: true })

    if (data) setCategories(data as ChannelCategory[])
    setLoading(false)
  }, [groupId])

  useEffect(() => {
    setLoading(true)
    fetchCategories()
  }, [fetchCategories])

  useRealtimeChannel({
    topic: `channel-categories-${groupId}`,
    enabled: Boolean(groupId),
    deps: [groupId, fetchCategories],
    bindings: [
      {
        type: 'postgres_changes',
        filter: { event: 'INSERT', schema: 'public', table: 'channel_categories', filter: `group_id=eq.${groupId}` },
        handler: fetchCategories,
      },
      {
        type: 'postgres_changes',
        filter: { event: 'UPDATE', schema: 'public', table: 'channel_categories', filter: `group_id=eq.${groupId}` },
        handler: fetchCategories,
      },
      {
        type: 'postgres_changes',
        // DELETE payloads only carry the PK — remove client-side by id.
        filter: { event: 'DELETE', schema: 'public', table: 'channel_categories' },
        handler: (payload) => {
          const deletedId = (payload.old as { id: string }).id
          setCategories(prev => {
            const next = prev.filter(c => c.id !== deletedId)
            return next.length === prev.length ? prev : next
          })
        },
      },
    ],
  })

  return { categories, loading, refetch: fetchCategories }
}
