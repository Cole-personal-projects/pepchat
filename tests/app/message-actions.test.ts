import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendMessage } from '@/app/(app)/messages/actions'

const { mockCreateClient, mockEnqueueMentionNotifications } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockEnqueueMentionNotifications: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

vi.mock('@/lib/server-notifications', () => ({
  enqueueMentionNotifications: mockEnqueueMentionNotifications,
  dispatchNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

type QueryResult = { data?: unknown; error?: { message: string } | null }

function makeBuilder(result: QueryResult = {}) {
  const builder: Record<string, unknown> = {}
  for (const method of ['insert', 'select']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  return builder
}

function setupClient(builder: unknown, userId: string | null = 'user-a') {
  const from = vi.fn(() => builder)
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from,
  })
  return { from }
}

const MESSAGE = {
  id: 'msg-1',
  channel_id: 'ch-1',
  user_id: 'user-a',
  content: 'Hi @bob',
  reply_to_id: null,
  edited_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  attachments: [],
  profiles: {
    username: 'alice',
    display_name: 'Alice',
    avatar_url: null,
  },
}

describe('message actions — sendMessage notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnqueueMentionNotifications.mockResolvedValue(undefined)
  })

  it('enqueues mention notifications after sending a channel message', async () => {
    const builder = makeBuilder({ data: MESSAGE })
    setupClient(builder)

    await expect(sendMessage('ch-1', 'Hi @bob')).resolves.toEqual({ ok: true })

    expect(mockEnqueueMentionNotifications).toHaveBeenCalledWith(
      expect.anything(),
      {
        senderId: 'user-a',
        senderName: 'Alice',
        messageId: 'msg-1',
        channelId: 'ch-1',
        content: 'Hi @bob',
      }
    )
  })

  it('still sends the channel message when mention enqueue fails', async () => {
    const builder = makeBuilder({ data: MESSAGE })
    setupClient(builder)
    mockEnqueueMentionNotifications.mockRejectedValue(new Error('notification failed'))

    await expect(sendMessage('ch-1', 'Hi @bob')).resolves.toEqual({ ok: true })
  })

  it('still sends the channel message when path revalidation fails', async () => {
    const builder = makeBuilder({ data: MESSAGE })
    setupClient(builder)
    mockRevalidatePath.mockImplementation(() => {
      throw new TypeError('Illegal invocation')
    })

    await expect(sendMessage('ch-1', 'Hi @bob')).resolves.toEqual({ ok: true })
  })

  it('returns a typed error when the database rejects the message insert', async () => {
    const builder = makeBuilder({ error: { message: 'new row violates row-level security policy' } })
    setupClient(builder)

    await expect(sendMessage('ch-1', '', null, [{
      type: 'gif',
      url: 'https://media.example/cat.gif',
      name: 'Cat GIF',
      preview: 'https://media.example/cat-preview.gif',
      width: 320,
      height: 180,
      source: 'klipy',
    }])).resolves.toEqual({
      error: 'new row violates row-level security policy',
    })
  })
})
