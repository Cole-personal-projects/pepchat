import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThreadMessages } from '@/lib/hooks/useThreadMessages'
import type { MessageWithProfile } from '@/lib/types'

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }))

vi.mock('@/lib/supabase/client', () => ({ createClient: mockCreateClient }))

type TestChannel = {
  topic: string
  bindings: Array<{ type: string; filter: Record<string, unknown>; handler: (payload: any) => void }>
  on: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  removed: boolean
}

function makeRealtimeMock() {
  const channels: TestChannel[] = []
  const removeChannel = vi.fn((channel: TestChannel) => {
    channel.removed = true
    return Promise.resolve({ error: null })
  })
  const channel = vi.fn((topic: string) => {
    const ch: TestChannel = {
      topic,
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

  mockCreateClient.mockReturnValue({ channel, removeChannel })
  return { channel, channels, removeChannel }
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

  it('subscribes to thread replies through useRealtimeChannel bindings', () => {
    const realtime = makeRealtimeMock()
    const { result } = renderHook(() => useThreadMessages('root-1', 'ch-1'))

    expect(realtime.channel).toHaveBeenCalledWith('thread-root-1')
    expect(realtime.channel).toHaveBeenCalledWith('messages-ch-1')
    const threadChannel = realtime.channels.find(channel => channel.topic === 'thread-root-1')!
    expect(threadChannel.bindings.map(({ type, filter }) => ({ type, filter }))).toEqual([
      { type: 'broadcast', filter: { event: 'new_thread_reply' } },
      { type: 'postgres_changes', filter: { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'thread_root_id=eq.root-1' } },
      { type: 'postgres_changes', filter: { event: 'DELETE', schema: 'public', table: 'messages', filter: 'thread_root_id=eq.root-1' } },
    ])

    act(() => threadChannel.bindings[0].handler({ payload: { message: REPLY } }))
    expect(result.current.replies).toEqual([REPLY])
  })

  it('broadcasts new thread replies and channel thread activity', () => {
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
      payload: { message: REPLY },
    })
    expect(activityChannel.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'thread_activity',
      payload: { rootId: 'root-1', replyCount: 2, lastReplyAt: REPLY.created_at },
    })
  })
})
