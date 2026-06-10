'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel'
import type { Friendship, Profile, UserStatus } from '@/lib/types'

export type FriendshipWithProfile = Friendship & {
  /** The other participant's profile (visible to friends via RLS). */
  other: Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'> | null
  /** The other participant's status row when visible. */
  otherStatus: Pick<UserStatus, 'presence' | 'status_emoji' | 'status_text' | 'status_expires_at'> | null
}

/**
 * The caller's friendships (accepted, pending both directions, blocks they
 * created) joined with the other user's profile and status.
 */
export function useFriends(currentUserId: string | null) {
  const [friendships, setFriendships] = useState<FriendshipWithProfile[]>([])
  const [loading, setLoading] = useState(true)

  const fetchFriends = useCallback(async () => {
    if (!currentUserId) {
      setFriendships([])
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data: rows } = await supabase
      .from('friendships')
      .select('*')
      .or(`requester_id.eq.${currentUserId},addressee_id.eq.${currentUserId}`)
      .order('created_at', { ascending: false })

    const friendshipRows = (rows ?? []) as Friendship[]
    const otherIds = [...new Set(friendshipRows.map(row =>
      row.requester_id === currentUserId ? row.addressee_id : row.requester_id,
    ))]

    let profiles: Array<Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'>> = []
    let statuses: Array<UserStatus> = []
    if (otherIds.length > 0) {
      const [profileResult, statusResult] = await Promise.all([
        supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', otherIds),
        supabase.from('user_status').select('*').in('user_id', otherIds),
      ])
      profiles = (profileResult.data ?? []) as typeof profiles
      statuses = (statusResult.data ?? []) as UserStatus[]
    }

    const profileById = new Map(profiles.map(profile => [profile.id, profile]))
    const statusById = new Map(statuses.map(status => [status.user_id, status]))

    setFriendships(friendshipRows.map(row => {
      const otherId = row.requester_id === currentUserId ? row.addressee_id : row.requester_id
      const status = statusById.get(otherId) ?? null
      const expired = status?.status_expires_at && new Date(status.status_expires_at).getTime() <= Date.now()
      return {
        ...row,
        other: profileById.get(otherId) ?? null,
        otherStatus: status
          ? {
              presence: status.presence,
              status_emoji: expired ? null : status.status_emoji,
              status_text: expired ? null : status.status_text,
              status_expires_at: status.status_expires_at,
            }
          : null,
      }
    }))
    setLoading(false)
  }, [currentUserId])

  useEffect(() => {
    setLoading(true)
    fetchFriends()
  }, [fetchFriends])

  useRealtimeChannel({
    topic: `friendships-${currentUserId}`,
    enabled: Boolean(currentUserId),
    deps: [currentUserId, fetchFriends],
    bindings: [
      {
        type: 'postgres_changes',
        filter: { event: '*', schema: 'public', table: 'friendships' },
        handler: fetchFriends,
      },
      {
        type: 'postgres_changes',
        filter: { event: '*', schema: 'public', table: 'user_status' },
        handler: fetchFriends,
      },
    ],
  })

  const grouped = useMemo(() => ({
    accepted: friendships.filter(f => f.status === 'accepted'),
    incoming: friendships.filter(f => f.status === 'pending' && f.addressee_id === currentUserId),
    outgoing: friendships.filter(f => f.status === 'pending' && f.requester_id === currentUserId),
    blocked: friendships.filter(f => f.status === 'blocked' && f.blocked_by === currentUserId),
  }), [friendships, currentUserId])

  return { friendships, grouped, loading, refetch: fetchFriends }
}
