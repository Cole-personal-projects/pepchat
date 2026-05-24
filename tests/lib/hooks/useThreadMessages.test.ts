import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThreadMessages } from '@/lib/hooks/useThreadMessages'
import type { MessageWithProfile } from '@/lib/types'

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }))

vi.mock('@/lib/supabase/client', () => ({ createClient: mockCreateClient }))

type TestChannel = {
  topic: string
  options?: Record<string, unknown>
  bindings: Array<{ type: string; filter: Record<string, unknown>; handler: (payload: any) => void }>
  on: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  removed: boolean
}

function makeRealtimeMock() {
  const channels: TestChannel[] = []
  const fromSingle = vi.fn()
  const fromEqThreadRoot = vi.fn(() => ({ single: fromSingle }))
  const fromEqId = vi.fn(() => ({ eq: fromEqThreadRoot }))
  const fromSelect = vi.fn(() => ({ eq: fromEqId }))
  const from = vi.fn(() => ({ select: fromSelect }))
  const removeChannel = vi.fn((channel: TestChannel) => {
    channel.removed = true
    return Promise.resolve({ error: null })
  })
  const channel = vi.fn((topic: string, options?: Record<string, unknown>) => {
    const ch: TestChannel = {
      topic,
      options,
      bindings: [],
      removed: false,
      on: vi.fn((type: string, filter: Record<string, unknown>, handler: (payload: any) => void) => {
        ch.bindings.push({ type, filter, handler })
        return ch
      }),
      subscribe: vi.fn(() => ch),
      send: vi.fn(),
    }
    channels.push(ch)
    return ch
  })

  mockCreateClient.mockReturnValue({ channel, from, removeChannel })
  return { channel, channels, from, fromEqId, fromEqThreadRoot, fromSelect, fromSingle, removeChannel }
}

const REPLY: MessageWithProfile = {
  id: 'reply-1',
  channel_id: 'ch-1',
  user_id: 'user-a',
  content: 'hello',
  reply_to_id: null,
  thread_root_id: 'root-1',
  thread_reply_count: 0,
  thread_last_reply_at: null,
  mirrored_from_thread_id: null,
  edited_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  attachments: [],
  profiles: { username: 'alice', display_name: 'Alice', avatar_url: null },
}

describe('useThreadMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('subscribes to private thread replies and fetches broadcast replies through RLS', async () => {
    const realtime = makeRealtimeMock()
    const { result } = renderHook(() => useThreadMessages('root-1', 'ch-1'))

    expect(realtime.channel).toHaveBeenCalledWith('thread-root-1', { config: { private: true } })
    expect(realtime.channel).toHaveBeenCalledWith('messages-ch-1', { config: { private: true } })
    const threadChannel = realtime.channels.find(channel => channel.topic === 'thread-root-1')!
    expect(threadChannel.bindings.map(({ type, filter }) => ({ type, filter }))).toEqual([
      { type: 'broadcast', filter: { event: 'new_thread_reply' } },
      { type: 'broadcast', filter: { event: 'thread_promoted' } },
      { type: 'postgres_changes', filter: { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'thread_root_id=eq.root-1' } },
      { type: 'postgres_changes', filter: { event: 'DELETE', schema: 'public', table: 'messages', filter: 'thread_root_id=eq.root-1' } },
    ])

    realtime.fromSingle.mockResolvedValueOnce({ data: REPLY, error: null })
    await act(async () => {
      await threadChannel.bindings[0].handler({ payload: { messageId: REPLY.id, rootId: 'root-1', channelId: 'ch-1' } })
    })

    expect(result.current.replies).toEqual([REPLY])
    expect(realtime.from).toHaveBeenCalledWith('messages')
    expect(realtime.fromEqId).toHaveBeenCalledWith('id', REPLY.id)
    expect(realtime.fromEqThreadRoot).toHaveBeenCalledWith('thread_root_id', 'root-1')
  })

  it('ignores malformed or wrong-thread reply broadcasts without fetching', async () => {
    const realtime = makeRealtimeMock()
    renderHook(() => useThreadMessages('root-1', 'ch-1'))
    const threadChannel = realtime.channels.find(channel => channel.topic === 'thread-root-1')!

    await act(async () => {
      await threadChannel.bindings[0].handler({ payload: { message: REPLY } })
      await threadChannel.bindings[0].handler({ payload: { messageId: REPLY.id, rootId: 'other-root', channelId: 'ch-1' } })
    })

    expect(realtime.from).not.toHaveBeenCalled()
  })

  it('broadcasts minimal new thread replies and channel thread activity', () => {
    const realtime = makeRealtimeMock()
    const { result } = renderHook(() => useThreadMessages('root-1', 'ch-1'))
    const threadChannel = realtime.channels.find(channel => channel.topic === 'thread-root-1')!
    const activityChannel = realtime.channels.find(channel => channel.topic === 'messages-ch-1')!

    act(() => {
      result.current.broadcastNewThreadReply(REPLY)
      result.current.broadcastThreadActivity({ rootId: 'root-1', replyCount: 2, lastReplyAt: REPLY.created_at })
    })

    expect(threadChannel.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'new_thread_reply',
      payload: { messageId: REPLY.id, rootId: REPLY.thread_root_id, channelId: REPLY.channel_id },
    })
    expect(threadChannel.send.mock.calls[0][0].payload).not.toHaveProperty('message')
    expect(activityChannel.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'thread_activity',
      payload: { rootId: 'root-1', replyCount: 2, lastReplyAt: REPLY.created_at },
    })
  })
})
