import { createElement, StrictMode, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRealtimeChannel, type RealtimeStatus } from '@/lib/realtime/useRealtimeChannel'

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }))

vi.mock('@/lib/supabase/client', () => ({ createClient: mockCreateClient }))

type BindingCall = {
  type: string
  filter: Record<string, unknown>
  handler: (payload: unknown) => void
}

type TestChannel = {
  topic: string
  options?: Record<string, unknown>
  on: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  track: ReturnType<typeof vi.fn>
  presenceState: ReturnType<typeof vi.fn>
  bindings: BindingCall[]
  removed: boolean
  statusCallback?: (status: RealtimeStatus) => void
}

type RealtimeLogEntry =
  | { action: 'channel'; topic: string; channel: TestChannel }
  | { action: 'on'; topic: string; channel: TestChannel; type: string; filter: Record<string, unknown> }
  | { action: 'subscribe'; topic: string; channel: TestChannel }
  | { action: 'removeChannel'; topic: string; channel: TestChannel }

function makeRealtimeMock() {
  const channels: TestChannel[] = []
  const log: RealtimeLogEntry[] = []

  const removeChannel = vi.fn((ch: TestChannel) => {
    ch.removed = true
    log.push({ action: 'removeChannel', topic: ch.topic, channel: ch })
    return Promise.resolve({ error: null })
  })

  const channel = vi.fn((topic: string, options?: Record<string, unknown>) => {
    const ch: TestChannel = {
      topic,
      options,
      bindings: [],
      removed: false,
      on: vi.fn((type: string, filter: Record<string, unknown>, handler: (payload: unknown) => void) => {
        ch.bindings.push({ type, filter, handler })
        log.push({ action: 'on', topic, channel: ch, type, filter })
        return ch
      }),
      subscribe: vi.fn((statusCallback?: (status: RealtimeStatus) => void) => {
        ch.statusCallback = statusCallback
        log.push({ action: 'subscribe', topic, channel: ch })
        return ch
      }),
      send: vi.fn(),
      track: vi.fn(),
      presenceState: vi.fn(() => ({})),
    }

    channels.push(ch)
    log.push({ action: 'channel', topic, channel: ch })
    return ch
  })

  function emit(topic: string, payload: unknown, bindingIndex = 0) {
    const ch = [...channels].reverse().find((candidate) => candidate.topic === topic && !candidate.removed)
    if (!ch) {
      throw new Error(`No active channel for topic ${topic}`)
    }
    const binding = ch.bindings[bindingIndex]
    if (!binding) {
      throw new Error(`No binding ${bindingIndex} for topic ${topic}`)
    }
    binding.handler(payload)
  }

  mockCreateClient.mockReturnValue({ channel, removeChannel })
  return { channel, channels, emit, log, removeChannel }
}

function logIndex(
  log: RealtimeLogEntry[],
  predicate: (entry: RealtimeLogEntry) => boolean,
): number {
  const index = log.findIndex(predicate)
  expect(index).toBeGreaterThanOrEqual(0)
  return index
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useRealtimeChannel', () => {
  it('subscribes and receives payloads through registered bindings', () => {
    const realtime = makeRealtimeMock()
    const onInsert = vi.fn()
    const onDelete = vi.fn()

    const { result } = renderHook(() =>
      useRealtimeChannel({
        topic: 'messages-ch-1',
        deps: ['ch-1'],
        bindings: [
          { type: 'broadcast', filter: { event: 'new_message' }, handler: onInsert },
          { type: 'postgres_changes', filter: { event: 'DELETE', schema: 'public', table: 'messages' }, handler: onDelete },
        ],
      }),
    )

    const channel = realtime.channels[0]
    expect(realtime.channel).toHaveBeenCalledWith('messages-ch-1', { config: { private: true } })
    expect(channel.bindings.map(({ type, filter }) => ({ type, filter }))).toEqual([
      { type: 'broadcast', filter: { event: 'new_message' } },
      { type: 'postgres_changes', filter: { event: 'DELETE', schema: 'public', table: 'messages' } },
    ])
    expect(channel.subscribe).toHaveBeenCalledTimes(1)
    expect(result.current.channelRef.current).toBe(channel)

    const payload = { id: 'payload-1' }
    act(() => realtime.emit('messages-ch-1', payload))
    expect(onInsert).toHaveBeenCalledWith(payload)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('removes the active channel exactly once on clean unmount', () => {
    const realtime = makeRealtimeMock()
    const { result, unmount } = renderHook(() =>
      useRealtimeChannel({ topic: 'messages-ch-1', deps: ['ch-1'], bindings: [] }),
    )
    const channel = realtime.channels[0]

    unmount()

    expect(realtime.removeChannel).toHaveBeenCalledTimes(1)
    expect(realtime.removeChannel).toHaveBeenCalledWith(channel)
    expect(channel.removed).toBe(true)
    expect(result.current.channelRef.current).toBeNull()
  })

  it('preserves caller channel options while defaulting to private authorization', () => {
    const realtime = makeRealtimeMock()
    renderHook(() =>
      useRealtimeChannel({
        topic: 'messages-ch-1',
        deps: ['ch-1'],
        options: { config: { broadcast: { self: true } } },
        bindings: [{ type: 'broadcast', filter: { event: 'new_message' }, handler: vi.fn() }],
      }),
    )

    expect(realtime.channel).toHaveBeenCalledWith('messages-ch-1', {
      config: { broadcast: { self: true }, private: true },
    })
  })

  it('remounts the same topic with a fresh channel after removing the first channel', () => {
    const realtime = makeRealtimeMock()
    const firstMount = renderHook(() =>
      useRealtimeChannel({ topic: 'messages-ch-1', deps: ['ch-1'], bindings: [] }),
    )
    const firstChannel = realtime.channels[0]

    firstMount.unmount()
    const secondMount = renderHook(() =>
      useRealtimeChannel({ topic: 'messages-ch-1', deps: ['ch-1'], bindings: [] }),
    )
    const secondChannel = realtime.channels[1]

    expect(realtime.channel).toHaveBeenCalledTimes(2)
    expect(firstChannel).not.toBe(secondChannel)
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1)
    expect(realtime.removeChannel).toHaveBeenCalledWith(firstChannel)
    expect(secondMount.result.current.channelRef.current).toBe(secondChannel)

    const firstRemove = logIndex(
      realtime.log,
      (entry) => entry.action === 'removeChannel' && entry.channel === firstChannel,
    )
    const secondCreate = logIndex(
      realtime.log,
      (entry) => entry.action === 'channel' && entry.channel === secondChannel,
    )
    expect(firstRemove).toBeLessThan(secondCreate)
  })

  it('removes the old dependency channel before subscribing to the replacement channel', () => {
    const realtime = makeRealtimeMock()
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string }) =>
        useRealtimeChannel({ topic: `messages-${channelId}`, deps: [channelId], bindings: [] }),
      { initialProps: { channelId: 'ch-1' } },
    )
    const oldChannel = realtime.channels[0]

    rerender({ channelId: 'ch-2' })
    const newChannel = realtime.channels[1]

    expect(realtime.removeChannel).toHaveBeenCalledTimes(1)
    expect(realtime.removeChannel).toHaveBeenCalledWith(oldChannel)
    expect(realtime.channel).toHaveBeenCalledWith('messages-ch-2')
    expect(newChannel.subscribe).toHaveBeenCalledTimes(1)
    expect(result.current.channelRef.current).toBe(newChannel)

    const oldRemove = logIndex(
      realtime.log,
      (entry) => entry.action === 'removeChannel' && entry.channel === oldChannel,
    )
    const newSubscribe = logIndex(
      realtime.log,
      (entry) => entry.action === 'subscribe' && entry.channel === newChannel,
    )
    expect(oldRemove).toBeLessThan(newSubscribe)
  })

  it('forwards SUBSCRIBED, CHANNEL_ERROR, and CLOSED status transitions in order', () => {
    const realtime = makeRealtimeMock()
    const onStatus = vi.fn()
    const { result } = renderHook(() =>
      useRealtimeChannel({ topic: 'presence-ch-1', deps: ['ch-1'], bindings: [], onStatus }),
    )
    const channel = realtime.channels[0]

    for (const status of ['SUBSCRIBED', 'CHANNEL_ERROR', 'CLOSED'] as const) {
      act(() => channel.statusCallback?.(status))
      expect(result.current.status).toBe(status)
    }

    expect(onStatus.mock.calls).toEqual([
      ['SUBSCRIBED', channel],
      ['CHANNEL_ERROR', channel],
      ['CLOSED', channel],
    ])
  })

  it('does not remove the same channel twice when unmount cleanup is invoked redundantly', () => {
    const realtime = makeRealtimeMock()
    const { unmount } = renderHook(() =>
      useRealtimeChannel({ topic: 'messages-ch-1', deps: ['ch-1'], bindings: [] }),
    )
    const channel = realtime.channels[0]

    unmount()
    unmount()

    expect(realtime.removeChannel).toHaveBeenCalledTimes(1)
    expect(realtime.removeChannel).toHaveBeenCalledWith(channel)
  })

  it('keeps StrictMode effect replay from removing any channel handle more than once', () => {
    const realtime = makeRealtimeMock()
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children)

    const { unmount } = renderHook(
      () => useRealtimeChannel({ topic: 'messages-ch-1', deps: ['ch-1'], bindings: [] }),
      { wrapper },
    )
    unmount()

    for (const channel of realtime.channels) {
      expect(realtime.removeChannel.mock.calls.filter(([removed]) => removed === channel)).toHaveLength(1)
    }
  })

  it('skips channel work when disabled and cleans up when rerendered disabled', () => {
    const realtime = makeRealtimeMock()
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useRealtimeChannel({ topic: 'messages-ch-1', enabled, deps: [enabled], bindings: [] }),
      { initialProps: { enabled: false } },
    )

    expect(realtime.channel).not.toHaveBeenCalled()
    expect(realtime.removeChannel).not.toHaveBeenCalled()
    expect(result.current.channelRef.current).toBeNull()

    rerender({ enabled: true })
    const active = realtime.channels[0]
    expect(active.topic).toBe('messages-ch-1')
    expect(result.current.channelRef.current).toBe(active)

    rerender({ enabled: false })
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1)
    expect(realtime.removeChannel).toHaveBeenCalledWith(active)
    expect(result.current.channelRef.current).toBeNull()
  })
})
