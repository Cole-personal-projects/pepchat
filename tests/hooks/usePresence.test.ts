import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePresence, type OnlineUser } from '@/lib/hooks/usePresence'

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: mockCreateClient }))

type BindingCall = { type: string; filter: Record<string, unknown>; handler: () => void }
type TestChannel = {
  topic: string
  options?: Record<string, unknown>
  on: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  track: ReturnType<typeof vi.fn>
  presenceState: ReturnType<typeof vi.fn>
  bindings: BindingCall[]
  statusCallback?: (status: string) => void
}

function makeRealtimeMock() {
  const channels: TestChannel[] = []
  const removeChannel = vi.fn().mockResolvedValue({ error: null })
  const channel = vi.fn((topic: string, options?: Record<string, unknown>) => {
    const ch: TestChannel = {
      topic,
      options,
      bindings: [],
      on: vi.fn((type: string, filter: Record<string, unknown>, handler: () => void) => {
        ch.bindings.push({ type, filter, handler })
        return ch
      }),
      subscribe: vi.fn((statusCallback?: (status: string) => void) => {
        ch.statusCallback = statusCallback
        return ch
      }),
      send: vi.fn(),
      track: vi.fn().mockResolvedValue('ok'),
      presenceState: vi.fn(() => ({})),
    }
    channels.push(ch)
    return ch
  })
  mockCreateClient.mockReturnValue({ channel, removeChannel })
  return { channel, channels, removeChannel }
}

const currentUser: OnlineUser = {
  user_id: 'user-1',
  username: 'alice',
  avatar_url: 'alice.png',
  status: 'online',
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePresence realtime migration', () => {
  it('subscribes to the exact presence topic/options and registers the sync binding', () => {
    const realtime = makeRealtimeMock()
    renderHook(() => usePresence('ch-1', currentUser))

    expect(realtime.channels[0].topic).toBe('presence-ch-1')
    expect(realtime.channels[0].options).toEqual({ config: { presence: { key: 'user-1' } } })
    expect(realtime.channels[0].bindings.map(({ type, filter }) => ({ type, filter }))).toEqual([
      { type: 'presence', filter: { event: 'sync' } },
    ])
  })

  it('derives online users and typing usernames from the first presence per key', () => {
    const realtime = makeRealtimeMock()
    const { result } = renderHook(() => usePresence('ch-1', currentUser))
    realtime.channels[0].presenceState.mockReturnValue({
      user1: [{ user_id: 'user-1', username: 'alice', avatar_url: 'alice.png', typing: true, status: 'away' }],
      user2: [{ user_id: 'user-2', username: 'bob', avatar_url: null, typing: true }],
      user3: [
        { user_id: 'user-3', username: 'carol', avatar_url: 'carol.png', typing: false, status: 'dnd' },
        { user_id: 'ignored', username: 'ignored', avatar_url: null, typing: true, status: 'online' },
      ],
    })

    act(() => realtime.channels[0].bindings[0].handler())

    expect(result.current.onlineUsers).toEqual([
      { user_id: 'user-1', username: 'alice', avatar_url: 'alice.png', status: 'away' },
      { user_id: 'user-2', username: 'bob', avatar_url: null, status: 'online' },
      { user_id: 'user-3', username: 'carol', avatar_url: 'carol.png', status: 'dnd' },
    ])
    expect(result.current.typingUsernames).toEqual(['bob'])
  })

  it('tracks the current user only after SUBSCRIBED and not for named error statuses', () => {
    const realtime = makeRealtimeMock()
    renderHook(() => usePresence('ch-1', currentUser))

    act(() => realtime.channels[0].statusCallback?.('CHANNEL_ERROR'))
    act(() => realtime.channels[0].statusCallback?.('TIMED_OUT'))
    expect(realtime.channels[0].track).not.toHaveBeenCalled()

    act(() => realtime.channels[0].statusCallback?.('SUBSCRIBED'))
    expect(realtime.channels[0].track).toHaveBeenCalledWith({
      user_id: 'user-1',
      username: 'alice',
      avatar_url: 'alice.png',
      status: 'online',
      typing: false,
    })
  })

  it('broadcastTyping tracks true immediately, replaces the timer, and tracks false after 2500ms', () => {
    vi.useFakeTimers()
    const realtime = makeRealtimeMock()
    const { result } = renderHook(() => usePresence('ch-1', currentUser))

    act(() => result.current.broadcastTyping())
    expect(realtime.channels[0].track).toHaveBeenLastCalledWith({
      user_id: 'user-1',
      username: 'alice',
      avatar_url: 'alice.png',
      status: 'online',
      typing: true,
    })

    act(() => result.current.broadcastTyping())
    expect(realtime.channels[0].track).toHaveBeenCalledTimes(2)

    act(() => vi.advanceTimersByTime(2499))
    expect(realtime.channels[0].track).toHaveBeenCalledTimes(2)

    act(() => vi.advanceTimersByTime(1))
    expect(realtime.channels[0].track).toHaveBeenLastCalledWith({
      user_id: 'user-1',
      username: 'alice',
      avatar_url: 'alice.png',
      status: 'online',
      typing: false,
    })
  })

  it('preserves localStorage status and setStatus updates state, storage, and the active room', () => {
    window.localStorage.setItem('sidebar:presence-status', 'dnd')
    const realtime = makeRealtimeMock()
    const { result } = renderHook(() => usePresence('ch-1', currentUser))

    expect(result.current.status).toBe('dnd')

    act(() => result.current.setStatus('away'))
    expect(result.current.status).toBe('away')
    expect(window.localStorage.getItem('sidebar:presence-status')).toBe('away')
    expect(realtime.channels[0].track).toHaveBeenCalledWith({
      user_id: 'user-1',
      username: 'alice',
      avatar_url: 'alice.png',
      status: 'away',
      typing: false,
    })
  })

  it('clears typing timers and removes channels on unmount and channelId rerender; later tracks use only the active channel', () => {
    vi.useFakeTimers()
    const realtime = makeRealtimeMock()
    const { result, rerender, unmount } = renderHook(
      ({ channelId }: { channelId: string }) => usePresence(channelId, currentUser),
      { initialProps: { channelId: 'ch-1' } }
    )
    const oldChannel = realtime.channels[0]

    act(() => result.current.broadcastTyping())
    rerender({ channelId: 'ch-2' })
    const newChannel = realtime.channels[1]

    expect(realtime.removeChannel).toHaveBeenCalledTimes(1)
    expect(realtime.removeChannel).toHaveBeenCalledWith(oldChannel)
    expect(newChannel.topic).toBe('presence-ch-2')
    expect(newChannel.options).toEqual({ config: { presence: { key: 'user-1' } } })

    act(() => vi.advanceTimersByTime(2500))
    expect(oldChannel.track).toHaveBeenCalledTimes(1)

    act(() => result.current.broadcastTyping())
    expect(newChannel.track).toHaveBeenCalledWith(expect.objectContaining({ typing: true }))

    act(() => result.current.setStatus('away'))
    expect(newChannel.track).toHaveBeenCalledWith(expect.objectContaining({ status: 'away', typing: false }))

    unmount()
    expect(realtime.removeChannel).toHaveBeenCalledTimes(2)
    expect(realtime.removeChannel).toHaveBeenLastCalledWith(newChannel)
  })
})
