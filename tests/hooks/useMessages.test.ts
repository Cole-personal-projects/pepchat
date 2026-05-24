import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMessages } from '@/lib/hooks/useMessages'
import type { MessageWithProfile, Reaction } from '@/lib/types'

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: mockCreateClient }))

type BindingCall = { type: string; filter: Record<string, unknown>; handler: (payload: any) => void }
type TestChannel = {
  topic: string
  on: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  track: ReturnType<typeof vi.fn>
  presenceState: ReturnType<typeof vi.fn>
  bindings: BindingCall[]
}

function makeMessageFetch(message: MessageWithProfile | null) {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    single: vi.fn().mockResolvedValue(message ? { data: message, error: null } : { data: null, error: { message: 'not found' } }),
  }
  return builder
}

function makeRealtimeMock(messageFetch: unknown = makeMessageFetch(null)) {
  const channels: TestChannel[] = []
  const removeChannel = vi.fn().mockResolvedValue({ error: null })
  const channel = vi.fn((topic: string) => {
    const ch: TestChannel = {
      topic,
      bindings: [],
      on: vi.fn((type: string, filter: Record<string, unknown>, handler: (payload: any) => void) => {
        ch.bindings.push({ type, filter, handler })
        return ch
      }),
      subscribe: vi.fn(() => ch),
      send: vi.fn(),
      track: vi.fn(),
      presenceState: vi.fn(() => ({})),
    }
    channels.push(ch)
    return ch
  })
  mockCreateClient.mockReturnValue({ channel, removeChannel, from: vi.fn(() => messageFetch) })
  return { channel, channels, removeChannel, messageFetch }
}

const baseMessage: MessageWithProfile = {
  id: 'msg-1',
  channel_id: 'ch-1',
  user_id: 'user-1',
  content: 'hello',
  reply_to_id: null,
  edited_at: null,
  pinned_at: null,
  created_at: '2024-01-01T00:00:00Z',
  profiles: { username: 'alice', avatar_url: null, display_name: null },
  reactions: [],
}

const reaction: Reaction = {
  id: 'reaction-1',
  message_id: 'msg-1',
  user_id: 'user-2',
  emoji: '👍',
  created_at: '2024-01-01T00:01:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useMessages realtime migration', () => {
  it('subscribes to the exact message topic and registers the seven bindings in order', () => {
    const realtime = makeRealtimeMock()
    renderHook(() => useMessages('ch-1', [baseMessage], 'user-1'))

    expect(realtime.channels[0].topic).toBe('messages-ch-1')
    expect(realtime.channels[0].bindings.map(({ type, filter }) => ({ type, filter }))).toEqual([
      { type: 'broadcast', filter: { event: 'new_message' } },
      { type: 'broadcast', filter: { event: 'thread_activity' } },
      { type: 'broadcast', filter: { event: 'reaction_added' } },
      { type: 'broadcast', filter: { event: 'reaction_removed' } },
      { type: 'postgres_changes', filter: { event: 'INSERT', schema: 'public', table: 'messages' } },
      { type: 'postgres_changes', filter: { event: 'UPDATE', schema: 'public', table: 'messages' } },
      { type: 'postgres_changes', filter: { event: 'DELETE', schema: 'public', table: 'messages' } },
    ])
    expect(realtime.channels[0].subscribe).toHaveBeenCalledTimes(1)
  })

  it('appends broadcast messages once', () => {
    const realtime = makeRealtimeMock()
    const { result } = renderHook(() => useMessages('ch-1', [baseMessage], 'user-1'))
    const newMessage = { ...baseMessage, id: 'msg-2', content: 'second' }

    act(() => realtime.channels[0].bindings[0].handler({ payload: { message: newMessage } }))
    expect(result.current.messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2'])

    act(() => realtime.channels[0].bindings[0].handler({ payload: { message: newMessage } }))
    expect(result.current.messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2'])
  })

  it('appends a full message when a postgres INSERT arrives', async () => {
    const insertedMessage = { ...baseMessage, id: 'msg-2', user_id: 'user-2', content: 'inserted' }
    const messageFetch = makeMessageFetch(insertedMessage)
    const realtime = makeRealtimeMock(messageFetch)
    const { result } = renderHook(() => useMessages('ch-1', [baseMessage], 'user-1'))
    const insertBinding = realtime.channels[0].bindings.find((binding) => binding.type === 'postgres_changes' && binding.filter.event === 'INSERT')!

    await act(async () => insertBinding.handler({ new: { id: 'msg-2', channel_id: 'ch-1' } }))

    expect(result.current.messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2'])
    expect(messageFetch.eq).toHaveBeenCalledWith('id', 'msg-2')
    expect(messageFetch.is).toHaveBeenCalledWith('thread_root_id', null)
  })

  it('applies reaction add/remove broadcasts without duplicating reactions', () => {
    const realtime = makeRealtimeMock()
    const { result } = renderHook(() => useMessages('ch-1', [baseMessage], 'user-1'))

    act(() => realtime.channels[0].bindings[2].handler({ payload: { messageId: 'msg-1', reaction } }))
    expect(result.current.messages[0].reactions).toEqual([reaction])

    act(() => realtime.channels[0].bindings[2].handler({ payload: { messageId: 'msg-1', reaction: { ...reaction, id: 'reaction-2' } } }))
    expect(result.current.messages[0].reactions).toHaveLength(1)

    act(() => realtime.channels[0].bindings[3].handler({ payload: { messageId: 'msg-1', userId: 'user-2', emoji: '👍' } }))
    expect(result.current.messages[0].reactions).toEqual([])
  })

  it('guards UPDATE by channel and removes messages on DELETE', () => {
    const realtime = makeRealtimeMock()
    const { result } = renderHook(() => useMessages('ch-1', [baseMessage], 'user-1'))
    const updateBinding = realtime.channels[0].bindings.find((binding) => binding.type === 'postgres_changes' && binding.filter.event === 'UPDATE')!
    const deleteBinding = realtime.channels[0].bindings.find((binding) => binding.type === 'postgres_changes' && binding.filter.event === 'DELETE')!

    act(() => updateBinding.handler({ new: { id: 'msg-1', channel_id: 'ch-2', content: 'ignored', edited_at: 'later', pinned_at: 'pin' } }))
    expect(result.current.messages[0].content).toBe('hello')

    act(() => updateBinding.handler({
      new: {
        id: 'msg-1',
        channel_id: 'ch-1',
        content: '',
        edited_at: 'later',
        pinned_at: 'pin',
        promoted_to_channel_id: 'promoted-channel',
        promoted_at: '2024-01-02T00:00:00Z',
      },
    }))
    expect(result.current.messages[0]).toMatchObject({
      content: '',
      edited_at: 'later',
      pinned_at: 'pin',
      promoted_to_channel_id: 'promoted-channel',
      promoted_at: '2024-01-02T00:00:00Z',
    })

    act(() => deleteBinding.handler({ old: { id: 'msg-1' } }))
    expect(result.current.messages).toEqual([])
  })

  it('removes the old channel on unmount and on channelId rerender, then sends through the active channel', () => {
    const realtime = makeRealtimeMock()
    const { result, rerender, unmount } = renderHook(
      ({ channelId }: { channelId: string }) => useMessages(channelId, [baseMessage], 'user-1'),
      { initialProps: { channelId: 'ch-1' } }
    )
    const oldChannel = realtime.channels[0]

    rerender({ channelId: 'ch-2' })
    const newChannel = realtime.channels[1]
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1)
    expect(realtime.removeChannel).toHaveBeenCalledWith(oldChannel)
    expect(newChannel.topic).toBe('messages-ch-2')

    const outgoing = { ...baseMessage, id: 'msg-out' }
    act(() => result.current.broadcastNewMessage(outgoing))
    expect(newChannel.send).toHaveBeenCalledWith({ type: 'broadcast', event: 'new_message', payload: { message: outgoing } })
    expect(oldChannel.send).not.toHaveBeenCalled()

    act(() => result.current.broadcastReactionChange('msg-1', '🔥', 'user-2', 'added'))
    expect(newChannel.send).toHaveBeenLastCalledWith({
      type: 'broadcast',
      event: 'reaction_added',
      payload: { messageId: 'msg-1', reaction: expect.objectContaining({ message_id: 'msg-1', user_id: 'user-2', emoji: '🔥' }) },
    })

    act(() => result.current.broadcastReactionChange('msg-1', '🔥', 'user-2', 'removed'))
    expect(newChannel.send).toHaveBeenLastCalledWith({ type: 'broadcast', event: 'reaction_removed', payload: { messageId: 'msg-1', userId: 'user-2', emoji: '🔥' } })

    unmount()
    expect(realtime.removeChannel).toHaveBeenCalledTimes(2)
    expect(realtime.removeChannel).toHaveBeenLastCalledWith(newChannel)
  })
})
