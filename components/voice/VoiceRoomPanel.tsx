'use client'

import { useCallback, useEffect, useState } from 'react'
import { startVoiceRoom, getCurrentVoiceRoom, mintVoiceToken, leaveVoiceRoom } from '@/app/(app)/voice/actions'
import { PERMISSIONS, type Role } from '@/lib/permissions'
import { useVoiceRoomConnection } from '@/components/voice/useVoiceRoomConnection'

type VoiceRoomSummary = {
  id: string
  channelId: string
  groupId: string
  status: 'open' | 'closed'
  participantCount: number
}

interface VoiceRoomPanelProps {
  channelId: string
  channelName: string
  userRole?: Role | null
  sourceNoobAccess?: boolean
  profileId?: string
  userId?: string
}

const JOIN_ERROR = 'Cannot join this room.'
const UNAVAILABLE_ERROR = 'Voice is unavailable.'

export default function VoiceRoomPanel({
  channelId,
  channelName,
  userRole,
  sourceNoobAccess = false,
}: VoiceRoomPanelProps) {
  const [room, setRoom] = useState<VoiceRoomSummary | null>(null)
  const [actionStatus, setActionStatus] = useState<'idle' | 'starting' | 'joining' | 'leaving'>('idle')
  const [error, setError] = useState<string | null>(null)
  const connection = useVoiceRoomConnection()

  const canStart = userRole ? PERMISSIONS.canStartVoiceRoom(userRole) : false
  const canJoin = userRole ? PERMISSIONS.canJoinVoiceRoom(userRole, channelName, sourceNoobAccess) : false
  const busy = actionStatus !== 'idle' || connection.status === 'joining' || connection.status === 'leaving'
  const joined = connection.status === 'connected'

  useEffect(() => {
    if (!canJoin) return

    let cancelled = false
    void getCurrentVoiceRoom(channelId)
      .then((result) => {
        if (cancelled) return
        if ('ok' in result && result.ok) {
          setRoom(result.room)
        }
      })
      .catch(() => {
        if (!cancelled) setError(UNAVAILABLE_ERROR)
      })

    return () => {
      cancelled = true
    }
  }, [canJoin, channelId])

  const handleStart = useCallback(async () => {
    setError(null)
    setActionStatus('starting')
    try {
      const result = await startVoiceRoom(channelId)
      if ('ok' in result && result.ok) {
        setRoom(result.room)
        return
      }
      setError(JOIN_ERROR)
    } catch {
      setError(UNAVAILABLE_ERROR)
    } finally {
      setActionStatus('idle')
    }
  }, [channelId])

  const handleJoin = useCallback(async () => {
    if (!room) return
    setError(null)
    setActionStatus('joining')
    try {
      const tokenResult = await mintVoiceToken(room.id)
      if (!('ok' in tokenResult) || !tokenResult.ok) {
        setError(JOIN_ERROR)
        return
      }

      const connectResult = await connection.connect({
        livekitUrl: tokenResult.livekitUrl,
        token: tokenResult.token,
      })
      if ('error' in connectResult) setError(UNAVAILABLE_ERROR)
    } catch {
      setError(UNAVAILABLE_ERROR)
    } finally {
      setActionStatus('idle')
    }
  }, [connection, room])

  const handleLeave = useCallback(async () => {
    if (!room) return
    setError(null)
    setActionStatus('leaving')
    try {
      const result = await leaveVoiceRoom(room.id)
      if (!('ok' in result) || !result.ok) {
        setError(UNAVAILABLE_ERROR)
        return
      }
      await connection.leave()
    } catch {
      setError(UNAVAILABLE_ERROR)
    } finally {
      setActionStatus('idle')
    }
  }, [connection, room])

  const visibleError = error ?? connection.error

  return (
    <section
      aria-label="Voice room"
      className="mx-4 mt-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">Voice room</p>
          <p className="text-xs text-[var(--text-muted)]">
            {joined
              ? 'Connected to voice.'
              : room
                ? 'Voice room is active.'
                : canStart
                  ? 'Start voice room.'
                  : 'No voice room active.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!room && canStart && (
            <button
              type="button"
              onClick={handleStart}
              disabled={busy}
              className="rounded-md border border-[var(--border-soft)] px-3 py-1 text-xs font-medium disabled:opacity-50"
            >
              {actionStatus === 'starting' ? 'Starting…' : 'Start voice room'}
            </button>
          )}

          {room && canJoin && !joined && (
            <button
              type="button"
              onClick={handleJoin}
              disabled={busy}
              className="rounded-md border border-[var(--border-soft)] px-3 py-1 text-xs font-medium disabled:opacity-50"
            >
              {actionStatus === 'joining' || connection.status === 'joining' ? 'Connecting…' : 'Join voice'}
            </button>
          )}

          {joined && (
            <>
              <button
                type="button"
                onClick={connection.toggleMute}
                disabled={busy}
                className="rounded-md border border-[var(--border-soft)] px-3 py-1 text-xs font-medium disabled:opacity-50"
              >
                {connection.muted ? 'Unmute' : 'Mute'}
              </button>
              <button
                type="button"
                onClick={handleLeave}
                disabled={busy}
                className="rounded-md border border-[var(--border-soft)] px-3 py-1 text-xs font-medium disabled:opacity-50"
              >
                {actionStatus === 'leaving' ? 'Leaving…' : 'Leave'}
              </button>
            </>
          )}
        </div>
      </div>

      {visibleError && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {visibleError}
        </p>
      )}
    </section>
  )
}
