'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client'

export type VoiceConnectionStatus = 'idle' | 'joining' | 'connected' | 'leaving' | 'error'

export interface VoiceTokenPayload {
  livekitUrl: string
  token: string
}

interface RemoteAudioElement {
  element: HTMLMediaElement
  track?: RemoteTrack
}

export interface UseVoiceRoomConnectionResult {
  status: VoiceConnectionStatus
  muted: boolean
  error: string | null
  connect: (payload: VoiceTokenPayload) => Promise<{ ok: true } | { error: string }>
  leave: () => Promise<void>
  toggleMute: () => Promise<void>
}

const GENERIC_ERROR = 'Voice is unavailable.'

function isAudioTrack(track: RemoteTrack): boolean {
  return track.kind === Track.Kind.Audio
}

export function useVoiceRoomConnection(): UseVoiceRoomConnectionResult {
  const roomRef = useRef<Room | null>(null)
  const remoteAudioRef = useRef<Set<RemoteAudioElement>>(new Set())
  const mountedRef = useRef(true)
  const [status, setStatus] = useState<VoiceConnectionStatus>('idle')
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cleanupRemoteAudio = useCallback(() => {
    remoteAudioRef.current.forEach(({ element, track }) => {
      if (track && typeof track.detach === 'function') {
        track.detach(element)
      }
      element.remove()
    })
    remoteAudioRef.current.clear()
  }, [])

  const disconnectRoom = useCallback(async () => {
    cleanupRemoteAudio()
    const room = roomRef.current
    roomRef.current = null
    if (room) {
      await room.disconnect(true)
    }
  }, [cleanupRemoteAudio])

  const connect = useCallback(async ({ livekitUrl, token }: VoiceTokenPayload) => {
    setError(null)
    setStatus('joining')

    try {
      await disconnectRoom()
      const room = new Room({ adaptiveStream: false, dynacast: false })
      roomRef.current = room

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (!isAudioTrack(track)) return
        const element = track.attach()
        element.autoplay = true
        element.dataset.voiceRoomAudio = 'remote'
        document.body.appendChild(element)
        remoteAudioRef.current.add({ element, track })
      })

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        remoteAudioRef.current.forEach(entry => {
          if (entry.track !== track) return
          track.detach(entry.element)
          entry.element.remove()
          remoteAudioRef.current.delete(entry)
        })
      })

      await room.connect(livekitUrl, token, { autoSubscribe: true })
      await room.startAudio()
      await room.localParticipant.setMicrophoneEnabled(true)

      if (mountedRef.current) {
        setMuted(false)
        setStatus('connected')
      }
      return { ok: true as const }
    } catch {
      await disconnectRoom()
      if (mountedRef.current) {
        setError(GENERIC_ERROR)
        setStatus('error')
      }
      return { error: GENERIC_ERROR }
    }
  }, [disconnectRoom])

  const leave = useCallback(async () => {
    setStatus('leaving')
    await disconnectRoom()
    if (mountedRef.current) {
      setMuted(false)
      setError(null)
      setStatus('idle')
    }
  }, [disconnectRoom])

  const toggleMute = useCallback(async () => {
    const room = roomRef.current
    if (!room || status !== 'connected') return

    const nextMuted = !muted
    try {
      await room.localParticipant.setMicrophoneEnabled(!nextMuted)
      if (mountedRef.current) setMuted(nextMuted)
    } catch {
      if (mountedRef.current) {
        setError(GENERIC_ERROR)
        setStatus('error')
      }
    }
  }, [muted, status])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      void disconnectRoom()
    }
  }, [disconnectRoom])

  return { status, muted, error, connect, leave, toggleMute }
}
