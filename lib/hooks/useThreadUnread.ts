'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useThreadUnread(
  rootId: string,
  lastReplyAt?: string | null,
  replyCount = 0,
  currentUserId?: string
): boolean {
  const [lastReadAt, setLastReadAt] = useState<string | null>(null)
  const [hasLocalRead, setHasLocalRead] = useState(false)

  useEffect(() => {
    let ignore = false
    setHasLocalRead(false)

    if (!rootId || !currentUserId) {
      setLastReadAt(null)
      return
    }

    const supabase = createClient()
    supabase
      .from('thread_read_state')
      .select('last_read_at')
      .eq('user_id', currentUserId)
      .eq('thread_root_id', rootId)
      .maybeSingle()
      .then(({ data }) => {
        if (!ignore) setLastReadAt((data as { last_read_at?: string } | null)?.last_read_at ?? null)
      })

    return () => {
      ignore = true
    }
  }, [currentUserId, rootId, lastReplyAt])

  useEffect(() => {
    function handleThreadRead(event: Event) {
      const detail = (event as CustomEvent<{ rootId?: string }>).detail
      if (detail?.rootId === rootId) {
        setHasLocalRead(true)
        setLastReadAt(new Date().toISOString())
      }
    }

    function handleThreadActivity(event: Event) {
      const detail = (event as CustomEvent<{ rootId?: string; lastReplyAt?: string }>).detail
      if (detail?.rootId === rootId && detail.lastReplyAt) {
        setHasLocalRead(false)
      }
    }

    window.addEventListener('thread-read', handleThreadRead)
    window.addEventListener('thread-activity', handleThreadActivity)
    return () => {
      window.removeEventListener('thread-read', handleThreadRead)
      window.removeEventListener('thread-activity', handleThreadActivity)
    }
  }, [rootId])

  if (replyCount <= 0 || !lastReplyAt || !currentUserId || hasLocalRead) return false
  if (!lastReadAt) return true
  return new Date(lastReplyAt).getTime() > new Date(lastReadAt).getTime()
}
