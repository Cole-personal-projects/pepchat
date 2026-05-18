'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel'

export interface OnlineUser {
  user_id: string
  username: string
  avatar_url: string | null
  status?: PresenceStatus
}

export type PresenceStatus = 'online' | 'away' | 'dnd'

interface PresencePayload extends OnlineUser {
  typing: boolean
  status: PresenceStatus
}

interface UsePresenceReturn {
  onlineUsers: OnlineUser[]
  typingUsernames: string[]
  broadcastTyping: () => void
  status: PresenceStatus
  setStatus: (status: PresenceStatus) => void
}

/**
 * Joins a Supabase Realtime Presence room for the given channel.
 * Returns the list of online users, who is currently typing,
 * and a function to broadcast the current user's typing state.
 */
export function usePresence(
  channelId: string,
  currentUser: OnlineUser
): UsePresenceReturn {
  const [onlineUsers, setOnlineUsers]       = useState<OnlineUser[]>([])
  const [typingUsernames, setTypingUsernames] = useState<string[]>([])
  const [status, setStatusState] = useState<PresenceStatus>('online')
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Capture stable identity values so broadcastTyping callback doesn't need to re-run the effect
  const userIdRef    = useRef(currentUser.user_id)
  const usernameRef  = useRef(currentUser.username)
  const avatarRef    = useRef(currentUser.avatar_url)
  const statusRef    = useRef<PresenceStatus>('online')
  useEffect(() => {
    userIdRef.current   = currentUser.user_id
    usernameRef.current = currentUser.username
    avatarRef.current   = currentUser.avatar_url
  })

  useEffect(() => {
    const saved = window.localStorage.getItem('sidebar:presence-status')
    if (saved === 'online' || saved === 'away' || saved === 'dnd') {
      statusRef.current = saved
      setStatusState(saved)
    }
  }, [])

  function syncState() {
    const state = roomRef.current?.presenceState<PresencePayload>() ?? {}
    const users: OnlineUser[]  = []
    const typing: string[]     = []

    for (const presences of Object.values(state)) {
      const p = presences[0] as PresencePayload | undefined
      if (!p) continue
      users.push({ user_id: p.user_id, username: p.username, avatar_url: p.avatar_url, status: p.status ?? 'online' })
      if (p.typing && p.user_id !== userIdRef.current) {
        typing.push(p.username)
      }
    }

    setOnlineUsers(users)
    setTypingUsernames(typing)
  }

  const { channelRef: roomRef } = useRealtimeChannel({
    topic: `presence-${channelId}`,
    options: { config: { presence: { key: currentUser.user_id } } },
    deps: [channelId],
    bindings: [
      { type: 'presence', filter: { event: 'sync' }, handler: syncState },
    ],
    onStatus: async (status, room) => {
      if (status === 'SUBSCRIBED') {
        await room.track({
          user_id:    userIdRef.current,
          username:   usernameRef.current,
          avatar_url: avatarRef.current,
          status:     statusRef.current,
          typing:     false,
        } satisfies PresencePayload)
      }
    },
  })

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current)
        typingTimerRef.current = null
      }
    }
  }, [channelId])

  const broadcastTyping = useCallback(() => {
    const room = roomRef.current
    if (!room) return

    room.track({
      user_id:    userIdRef.current,
      username:   usernameRef.current,
      avatar_url: avatarRef.current,
      status:     statusRef.current,
      typing:     true,
    })

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      roomRef.current?.track({
        user_id:    userIdRef.current,
        username:   usernameRef.current,
        avatar_url: avatarRef.current,
        status:     statusRef.current,
        typing:     false,
      })
    }, 2500)
  }, [])

  const setStatus = useCallback((nextStatus: PresenceStatus) => {
    statusRef.current = nextStatus
    setStatusState(nextStatus)
    window.localStorage.setItem('sidebar:presence-status', nextStatus)
    roomRef.current?.track({
      user_id:    userIdRef.current,
      username:   usernameRef.current,
      avatar_url: avatarRef.current,
      status:     nextStatus,
      typing:     false,
    } satisfies PresencePayload)
  }, [])

  return { onlineUsers, typingUsernames, broadcastTyping, status, setStatus }
}
