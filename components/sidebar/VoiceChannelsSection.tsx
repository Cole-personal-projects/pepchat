'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createTempVoiceRoom, getCurrentVoiceRoom, joinVoiceChannel, leaveVoiceRoom } from '@/app/(app)/voice/actions'
import { useVoiceRoomConnection } from '@/components/voice/useVoiceRoomConnection'
import type { Channel } from '@/lib/types'

type VoiceRoomSummary = {
  id: string
  channelId: string
  groupId: string
  status: 'open' | 'idle' | 'closed'
  participantCount: number
}

interface VoiceChannelsSectionProps {
  channels: Channel[]
  /** Enables the join-to-create room button. */
  groupId?: string
  canCreateRoom?: boolean
  onMobileClose?: () => void
}

const JOIN_ERROR = 'Cannot join this room.'
const UNAVAILABLE_ERROR = 'Voice is unavailable.'

function roomStatusLabel(room: VoiceRoomSummary | null | undefined, connected: boolean) {
  if (connected) return 'Connected'
  if (room && room.participantCount > 0) return `${room.participantCount} connected`
  return 'Click to join'
}

export default function VoiceChannelsSection({ channels, groupId, canCreateRoom = false, onMobileClose }: VoiceChannelsSectionProps) {
  const connection = useVoiceRoomConnection()
  const [roomsByChannelId, setRoomsByChannelId] = useState<Record<string, VoiceRoomSummary | null>>({})
  const [loadingChannelIds, setLoadingChannelIds] = useState<Set<string>>(new Set())
  const [joiningChannelId, setJoiningChannelId] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [creatingRoom, setCreatingRoom] = useState(false)
  const [createRoomError, setCreateRoomError] = useState<string | null>(null)
  const [connectedChannelId, setConnectedChannelId] = useState<string | null>(null)
  const [connectedRoomId, setConnectedRoomId] = useState<string | null>(null)
  const [errorByChannelId, setErrorByChannelId] = useState<Record<string, string | null>>({})

  const channelIdsKey = useMemo(() => channels.map(channel => channel.id).join('|'), [channels])
  const busy = Boolean(joiningChannelId) || leaving || creatingRoom || connection.status === 'joining' || connection.status === 'leaving'

  useEffect(() => {
    if (channels.length === 0) return

    let cancelled = false
    const nextLoading = new Set(channels.map(channel => channel.id))
    setLoadingChannelIds(nextLoading)

    void Promise.all(
      channels.map(async (channel) => {
        try {
          const result = await getCurrentVoiceRoom(channel.id)
          if (cancelled) return
          setRoomsByChannelId(current => ({
            ...current,
            [channel.id]: 'ok' in result && result.ok ? result.room : null,
          }))
          if (!('ok' in result) || !result.ok) {
            setErrorByChannelId(current => ({ ...current, [channel.id]: JOIN_ERROR }))
          }
        } catch {
          if (!cancelled) setErrorByChannelId(current => ({ ...current, [channel.id]: UNAVAILABLE_ERROR }))
        } finally {
          if (!cancelled) {
            setLoadingChannelIds(current => {
              const next = new Set(current)
              next.delete(channel.id)
              return next
            })
          }
        }
      })
    )

    return () => {
      cancelled = true
    }
    // channelIdsKey captures channel membership; depending on the array
    // identity would refetch every render since callers filter inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelIdsKey])

  const handleJoin = useCallback(async (channel: Channel) => {
    setJoiningChannelId(channel.id)
    setErrorByChannelId(current => ({ ...current, [channel.id]: null }))

    try {
      const roomResult = await joinVoiceChannel(channel.id)
      if (!('ok' in roomResult) || !roomResult.ok) {
        setErrorByChannelId(current => ({ ...current, [channel.id]: JOIN_ERROR }))
        return
      }

      const connectResult = await connection.connect({
        livekitUrl: roomResult.livekitUrl,
        token: roomResult.token,
      })
      if ('error' in connectResult) {
        setErrorByChannelId(current => ({ ...current, [channel.id]: UNAVAILABLE_ERROR }))
        return
      }

      setConnectedChannelId(channel.id)
      setConnectedRoomId(roomResult.room.id)
      setRoomsByChannelId(current => ({
        ...current,
        [channel.id]: {
          ...roomResult.room,
          participantCount: Math.max(roomResult.room.participantCount, 1),
        },
      }))
      onMobileClose?.()
    } catch {
      setErrorByChannelId(current => ({ ...current, [channel.id]: UNAVAILABLE_ERROR }))
    } finally {
      setJoiningChannelId(null)
    }
  }, [connection, onMobileClose])

  const handleCreateRoom = useCallback(async () => {
    if (!groupId) return
    setCreatingRoom(true)
    setCreateRoomError(null)

    try {
      const created = await createTempVoiceRoom(groupId)
      if (!('ok' in created) || !created.ok) {
        setCreateRoomError(JOIN_ERROR)
        return
      }
      // The new channel arrives in the sidebar via the channels realtime
      // subscription; join it immediately so the room never sits empty.
      await handleJoin({ id: created.channelId, name: 'your room' } as Channel)
    } catch {
      setCreateRoomError(UNAVAILABLE_ERROR)
    } finally {
      setCreatingRoom(false)
    }
  }, [groupId, handleJoin])

  const handleLeave = useCallback(async () => {
    if (!connectedRoomId) return
    setLeaving(true)
    try {
      const result = await leaveVoiceRoom(connectedRoomId)
      if (!('ok' in result) || !result.ok) {
        if (connectedChannelId) setErrorByChannelId(current => ({ ...current, [connectedChannelId]: UNAVAILABLE_ERROR }))
        return
      }
      await connection.leave()
      setConnectedChannelId(null)
      setConnectedRoomId(null)
    } catch {
      if (connectedChannelId) setErrorByChannelId(current => ({ ...current, [connectedChannelId]: UNAVAILABLE_ERROR }))
    } finally {
      setLeaving(false)
    }
  }, [connectedChannelId, connectedRoomId, connection])

  if (channels.length === 0 && !canCreateRoom) return null

  return (
    <section aria-label="Voice Channels" className="mt-3 border-t border-[var(--border-soft)] pt-3">
      <div className="flex items-center justify-between px-3 pb-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-faint)]">
          Voice Channels
        </span>
        <span className="text-[10px] text-[var(--text-faint)]" aria-hidden="true">●</span>
      </div>

      {canCreateRoom && groupId && (
        <div className="px-1 pb-1">
          <button
            type="button"
            data-testid="create-voice-room-btn"
            aria-label="Create voice room"
            onClick={handleCreateRoom}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-70"
          >
            <span aria-hidden="true" className="text-[var(--text-faint)]">➕</span>
            <span className="min-w-0 flex-1 truncate">{creatingRoom ? 'Creating room…' : 'Create Room'}</span>
          </button>
          {createRoomError && (
            <p role="alert" className="ml-8 mt-1 text-xs text-red-400">
              {createRoomError}
            </p>
          )}
        </div>
      )}

      <div className="space-y-1 px-1">
        {channels.map(channel => {
          const room = roomsByChannelId[channel.id]
          const isConnected = connectedChannelId === channel.id && connection.status === 'connected'
          const isLoading = loadingChannelIds.has(channel.id)
          const isJoining = joiningChannelId === channel.id || (isConnected && connection.status === 'joining')
          const participantCount = room?.participantCount ?? 0
          const visibleError = errorByChannelId[channel.id] ?? (isConnected ? connection.error : null)

          return (
            <div key={channel.id} className="rounded-md">
              <button
                type="button"
                aria-label={`${isConnected ? 'Connected to' : 'Join'} ${channel.name} voice`}
                data-testid={`voice-channel-${channel.id}`}
                onClick={() => handleJoin(channel)}
                disabled={busy || isLoading || isConnected}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-default disabled:opacity-70 ${isConnected ? 'bg-[var(--channel-active-bg)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)]'}`}
              >
                <span aria-hidden="true" className="text-[var(--text-faint)]">🔊</span>
                <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                <span className="text-[10px] text-[var(--text-faint)]">
                  {isLoading ? 'Loading…' : isJoining ? 'Joining…' : roomStatusLabel(room, isConnected)}
                </span>
              </button>

              {(participantCount > 0 || isConnected) && (
                <div
                  data-testid={`voice-participants-${channel.id}`}
                  className="ml-8 mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                  <span>{Math.max(participantCount, isConnected ? 1 : 0)} connected</span>
                </div>
              )}

              {isConnected && (
                <div className="ml-8 mt-1 flex items-center gap-1.5">
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                    Connected
                  </span>
                  <button
                    type="button"
                    onClick={connection.toggleMute}
                    disabled={busy}
                    className="rounded border border-[var(--border-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
                  >
                    {connection.muted ? 'Unmute' : 'Mute'}
                  </button>
                  <button
                    type="button"
                    onClick={handleLeave}
                    disabled={busy}
                    className="rounded border border-[var(--border-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"
                  >
                    {leaving ? 'Leaving…' : 'Leave'}
                  </button>
                </div>
              )}

              {visibleError && (
                <p role="alert" className="ml-8 mt-1 text-xs text-red-400">
                  {visibleError}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
