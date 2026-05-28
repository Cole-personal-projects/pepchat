import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceRoomConnection } from '@/components/voice/useVoiceRoomConnection'

type Handler = (...args: any[]) => void

type MockRoomInstance = {
  handlers: Map<string, Handler>
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  startAudio: ReturnType<typeof vi.fn>
  localParticipant: {
    setMicrophoneEnabled: ReturnType<typeof vi.fn>
  }
  on: (event: string, handler: Handler) => MockRoomInstance
}

const livekitMock = vi.hoisted(() => {
  const roomInstances: MockRoomInstance[] = []
  let failConnect = false

  class MockRoom implements MockRoomInstance {
    handlers = new Map<string, Handler>()
    connect = vi.fn(() => failConnect ? Promise.reject(new Error('network detail')) : Promise.resolve())
    disconnect = vi.fn().mockResolvedValue(undefined)
    startAudio = vi.fn().mockResolvedValue(undefined)
    localParticipant = {
      setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
    }

    constructor() {
      roomInstances.push(this)
    }

    on(event: string, handler: Handler) {
      this.handlers.set(event, handler)
      return this
    }
  }

  return {
    MockRoom,
    roomInstances,
    setFailConnect: (value: boolean) => {
      failConnect = value
    },
  }
})

vi.mock('livekit-client', () => ({
  Room: livekitMock.MockRoom,
  RoomEvent: {
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
  },
  Track: {
    Kind: {
      Audio: 'audio',
      Video: 'video',
    },
  },
}))

function latestRoom() {
  const room = livekitMock.roomInstances.at(-1)
  if (!room) throw new Error('expected room instance')
  return room
}

describe('useVoiceRoomConnection', () => {
  beforeEach(() => {
    livekitMock.roomInstances.length = 0
    livekitMock.setFailConnect(false)
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('connects to LiveKit before publishing microphone audio only', async () => {
    const { result } = renderHook(() => useVoiceRoomConnection())

    await act(async () => {
      await result.current.connect({ livekitUrl: 'wss://voice.example.test', token: 'token' })
    })

    const room = latestRoom()
    expect(room.connect).toHaveBeenCalledWith('wss://voice.example.test', 'token', { autoSubscribe: true })
    expect(room.startAudio).toHaveBeenCalledTimes(1)
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    expect(room.connect.mock.invocationCallOrder[0]).toBeLessThan(
      room.localParticipant.setMicrophoneEnabled.mock.invocationCallOrder[0],
    )
    expect(result.current.status).toBe('connected')
  })

  it('does not publish the microphone when connection fails', async () => {
    const { result } = renderHook(() => useVoiceRoomConnection())
    livekitMock.setFailConnect(true)

    await act(async () => {
      await result.current.connect({ livekitUrl: 'wss://voice.example.test', token: 'token' })
    })

    const room = latestRoom()
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
    expect(room.disconnect).toHaveBeenCalledWith(true)
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Voice is unavailable.')
  })

  it('disconnects and stops tracks on leave', async () => {
    const { result } = renderHook(() => useVoiceRoomConnection())

    await act(async () => {
      await result.current.connect({ livekitUrl: 'wss://voice.example.test', token: 'token' })
    })
    const room = latestRoom()

    await act(async () => {
      await result.current.leave()
    })

    expect(room.disconnect).toHaveBeenCalledWith(true)
    expect(result.current.status).toBe('idle')
  })

  it('disconnects and cleans remote audio on unmount', async () => {
    const { result, unmount } = renderHook(() => useVoiceRoomConnection())

    await act(async () => {
      await result.current.connect({ livekitUrl: 'wss://voice.example.test', token: 'token' })
    })
    const room = latestRoom()
    const detach = vi.fn()
    const element = document.createElement('audio')
    const track = {
      kind: 'audio',
      attach: vi.fn(() => element),
      detach,
    }

    act(() => {
      room.handlers.get('trackSubscribed')?.(track)
    })
    expect(document.querySelectorAll('audio[data-voice-room-audio="remote"]')).toHaveLength(1)

    unmount()

    expect(room.disconnect).toHaveBeenCalledWith(true)
    expect(detach).toHaveBeenCalledWith(element)
    await waitFor(() => {
      expect(document.querySelectorAll('audio[data-voice-room-audio="remote"]')).toHaveLength(0)
    })
  })

  it('mute and unmute toggle the microphone without requesting video', async () => {
    const { result } = renderHook(() => useVoiceRoomConnection())

    await act(async () => {
      await result.current.connect({ livekitUrl: 'wss://voice.example.test', token: 'token' })
    })
    const room = latestRoom()
    room.localParticipant.setMicrophoneEnabled.mockClear()

    await act(async () => {
      await result.current.toggleMute()
    })
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false)
    expect(result.current.muted).toBe(true)

    await act(async () => {
      await result.current.toggleMute()
    })
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(true)
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(expect.objectContaining({ video: expect.anything() }))
    expect(result.current.muted).toBe(false)
  })
})
