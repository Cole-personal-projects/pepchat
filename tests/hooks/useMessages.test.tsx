import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useMessages } from '@/lib/hooks/useMessages'
import type { MessageWithProfile } from '@/lib/types'

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: mockCreateClient }))

const MESSAGE: MessageWithProfile = {
  id: 'msg-1',
  channel_id: 'ch-1',
  user_id: 'user-1',
  content: 'Initial',
  reply_to_id: null,
  edited_at: null,
  created_at: '2024-01-01T12:00:00.000Z',
  attachments: [],
  reactions: [],
  replied_to: null,
  profiles: { username: 'alice', display_name: null, avatar_url: null },
}

const INSERTED_MESSAGE: MessageWithProfile = {
  ...MESSAGE,
  id: 'msg-2',
  user_id: 'user-2',
  content: 'Inserted through realtime',
  created_at: '2024-01-01T12:01:00.000Z',
  profiles: { username: 'bob', display_name: null, avatar_url: null },
}

type RealtimeHandler = (payload: any) => void

function makeRealtimeChannel() {
  const handlers: Array<{ type: string; filter: Record<string, unknown>; handler: RealtimeHandler }> = []
  const channel: any = {
    on: vi.fn((type: string, filter: Record<string, unknown>, handler: RealtimeHandler) => {
      handlers.push({ type, filter, handler })
      return channel
    }),
    subscribe: vi.fn((callback?: (status: string) => void) => {
      callback?.('SUBSCRIBED')
      return channel
    }),
    send: vi.fn().mockResolvedValue('ok'),
    _trigger(type: string, event: string, payload: any) {
      for (const binding of handlers) {
        if (binding.type === type && binding.filter.event === event) binding.handler(payload)
      }
    },
  }
  return channel
}

function makeMessageFetch(message: MessageWithProfile | null) {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn().mockResolvedValue(message ? { data: message, error: null } : { data: null, error: { message: 'not found' } }),
  }
  return builder
}

describe('useMessages realtime message state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and appends full message data when a postgres INSERT arrives', async () => {
    const channel = makeRealtimeChannel()
    const messageFetch = makeMessageFetch(INSERTED_MESSAGE)
    mockCreateClient.mockReturnValue({
      channel: vi.fn(() => channel),
      removeChannel: vi.fn().mockResolvedValue({ error: null }),
      from: vi.fn((table: string) => {
        expect(table).toBe('messages')
        return messageFetch
      }),
    })

    const { result } = renderHook(() => useMessages('ch-1', [MESSAGE], 'user-1'))
    await waitFor(() => expect(channel.subscribe).toHaveBeenCalled())

    await act(async () => {
      channel._trigger('postgres_changes', 'INSERT', { new: { id: 'msg-2', channel_id: 'ch-1' } })
    })

    await waitFor(() => expect(result.current.messages.map(message => message.id)).toEqual(['msg-1', 'msg-2']))
    expect(messageFetch.eq).toHaveBeenCalledWith('id', 'msg-2')
  })

  it('removes a message when a postgres DELETE arrives', async () => {
    const channel = makeRealtimeChannel()
    mockCreateClient.mockReturnValue({
      channel: vi.fn(() => channel),
      removeChannel: vi.fn().mockResolvedValue({ error: null }),
      from: vi.fn(() => makeMessageFetch(null)),
    })

    const { result } = renderHook(() => useMessages('ch-1', [MESSAGE, INSERTED_MESSAGE], 'user-1'))
    await waitFor(() => expect(channel.subscribe).toHaveBeenCalled())

    act(() => {
      channel._trigger('postgres_changes', 'DELETE', { old: { id: 'msg-1' } })
    })

    expect(result.current.messages.map(message => message.id)).toEqual(['msg-2'])
  })
})
