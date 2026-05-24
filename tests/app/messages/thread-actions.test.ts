import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchThreadReplies, markThreadRead, sendThreadReply } from '@/app/(app)/messages/thread-actions'

const { mockCreateClient, mockDispatchNotification, mockEnqueueMentionNotifications, mockLogAuditEvent } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockDispatchNotification: vi.fn(),
  mockEnqueueMentionNotifications: vi.fn(),
  mockLogAuditEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

vi.mock('@/lib/server-notifications', () => ({
  buildThreadReplyUrl: (channelId: string, rootId: string, messageId: string) => `/channels/${channelId}?thread=${rootId}#${messageId}`,
  enqueueMentionNotifications: mockEnqueueMentionNotifications,
  dispatchNotification: mockDispatchNotification,
}))

vi.mock('@/lib/audit', () => ({
  logAuditEvent: mockLogAuditEvent,
}))

type QueryResult = { data?: unknown; error?: { message: string } | null }

function makeChain(result: QueryResult = {}) {
  const builder: Record<string, any> = {}
  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'or']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (resolve: (value: QueryResult) => unknown, reject: (reason?: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve, reject)
  return builder
}

function makeSingleBuilder(result: QueryResult = {}) {
  const builder = makeChain(result)
  builder.single = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  builder.insert = vi.fn(() => builder)
  builder.upsert = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  return builder
}

function setupClient(builders: unknown[], userId: string | null = 'user-a') {
  const queue = [...builders]
  const from = vi.fn(() => {
    const next = queue.shift()
    if (!next) throw new Error('Unexpected from() call')
    return next
  })
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

const THREAD_REPLY = {
  id: 'reply-1',
  channel_id: 'ch-1',
  user_id: 'user-a',
  content: 'Hi @bob',
  reply_to_id: null,
  thread_root_id: 'root-1',
  thread_reply_count: 0,
  thread_last_reply_at: null,
  mirrored_from_thread_id: null,
  edited_at: null,
  created_at: '2026-01-01T00:01:00.000Z',
  attachments: [],
  profiles: {
    username: 'alice',
    display_name: 'Alice',
    avatar_url: null,
  },
}

describe('thread actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnqueueMentionNotifications.mockResolvedValue(undefined)
    mockDispatchNotification.mockResolvedValue(undefined)
    mockLogAuditEvent.mockResolvedValue(undefined)
  })

  it('sends a thread reply against a root message and preserves mention fanout', async () => {
    const rootBuilder = makeSingleBuilder({ data: { id: 'root-1', channel_id: 'ch-1', thread_root_id: null } })
    const insertBuilder = makeSingleBuilder({ data: THREAD_REPLY })
    const { from } = setupClient([rootBuilder, insertBuilder])

    await expect(sendThreadReply({ rootId: 'root-1', content: ' Hi @bob ' })).resolves.toEqual({
      ok: true,
      message: THREAD_REPLY,
      mirrorMessage: null,
    })

    expect(from).toHaveBeenNthCalledWith(1, 'messages')
    expect(rootBuilder.eq).toHaveBeenCalledWith('id', 'root-1')
    expect(insertBuilder.insert).toHaveBeenCalledWith({
      channel_id: 'ch-1',
      user_id: 'user-a',
      content: 'Hi @bob',
      reply_to_id: null,
      thread_root_id: 'root-1',
      attachments: [],
    })
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      'user-a',
      'thread.reply',
      'message',
      'root-1',
      { channel_id: 'ch-1', mirror_to_channel: false }
    )
    expect(mockDispatchNotification).toHaveBeenCalledWith(expect.anything(), {
      type: 'thread_reply',
      payload: {
        threadRootId: 'root-1',
        newReplyId: 'reply-1',
        newReplyAuthorId: 'user-a',
        newReplyAuthorName: 'Alice',
        channelId: 'ch-1',
        content: 'Hi @bob',
        attachments: [],
      },
    })
    expect(mockEnqueueMentionNotifications).toHaveBeenCalledWith(expect.anything(), {
      senderId: 'user-a',
      senderName: 'Alice',
      messageId: 'reply-1',
      channelId: 'ch-1',
      content: 'Hi @bob',
      urlBuilder: expect.any(Function),
    })
  })

  it('creates a channel mirror when requested', async () => {
    const mirrorMessage = {
      ...THREAD_REPLY,
      id: 'mirror-1',
      thread_root_id: null,
      mirrored_from_thread_id: 'reply-1',
      mirrored_from_thread: { id: 'reply-1', thread_root_id: 'root-1' },
    }
    const rootBuilder = makeSingleBuilder({ data: { id: 'root-1', channel_id: 'ch-1', thread_root_id: null } })
    const replyInsertBuilder = makeSingleBuilder({ data: THREAD_REPLY })
    const mirrorInsertBuilder = makeSingleBuilder({ data: mirrorMessage })
    setupClient([rootBuilder, replyInsertBuilder, mirrorInsertBuilder])

    await expect(sendThreadReply({ rootId: 'root-1', content: 'mirror me', mirrorToChannel: true })).resolves.toEqual({
      ok: true,
      message: THREAD_REPLY,
      mirrorMessage,
    })

    expect(replyInsertBuilder.insert).toHaveBeenCalledWith({
      channel_id: 'ch-1',
      user_id: 'user-a',
      content: 'mirror me',
      reply_to_id: null,
      thread_root_id: 'root-1',
      attachments: [],
    })
    expect(mirrorInsertBuilder.insert).toHaveBeenCalledWith({
      channel_id: 'ch-1',
      user_id: 'user-a',
      content: 'mirror me',
      reply_to_id: null,
      thread_root_id: null,
      mirrored_from_thread_id: 'reply-1',
      attachments: [],
    })
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      'user-a',
      'thread.reply',
      'message',
      'root-1',
      { channel_id: 'ch-1', mirror_to_channel: true }
    )
    expect(mockEnqueueMentionNotifications).toHaveBeenCalledTimes(1)
  })

  it('rejects replies to replies', async () => {
    const rootBuilder = makeSingleBuilder({ data: { id: 'reply-parent', channel_id: 'ch-1', thread_root_id: 'root-1' } })
    setupClient([rootBuilder])

    await expect(sendThreadReply({ rootId: 'reply-parent', content: 'nested' })).resolves.toEqual({
      error: 'Cannot reply to a thread reply.',
    })
  })

  it('fetches thread replies with cursor pagination', async () => {
    const reply2 = { ...THREAD_REPLY, id: 'reply-2', created_at: '2026-01-01T00:02:00.000Z' }
    const rootBuilder = makeSingleBuilder({ data: { id: 'root-1', channel_id: 'ch-1', thread_root_id: null } })
    const fetchBuilder = makeChain({ data: [THREAD_REPLY, reply2] })
    setupClient([rootBuilder, fetchBuilder])

    await expect(fetchThreadReplies({ rootId: 'root-1', limit: 1 })).resolves.toEqual({
      ok: true,
      messages: [THREAD_REPLY],
      nextCursor: '2026-01-01T00:01:00.000Z|reply-1',
    })

    expect(rootBuilder.eq).toHaveBeenCalledWith('id', 'root-1')
    expect(fetchBuilder.eq).toHaveBeenCalledWith('thread_root_id', 'root-1')
    expect(fetchBuilder.order).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(fetchBuilder.order).toHaveBeenCalledWith('id', { ascending: true })
    expect(fetchBuilder.limit).toHaveBeenCalledWith(2)
  })

  it('rejects fetching replies for a non-root message', async () => {
    const rootBuilder = makeSingleBuilder({ data: { id: 'reply-parent', channel_id: 'ch-1', thread_root_id: 'root-1' } })
    setupClient([rootBuilder])

    await expect(fetchThreadReplies({ rootId: 'reply-parent' })).resolves.toEqual({
      error: 'Thread root not found.',
    })
  })

  it('marks a thread read with an owned upsert row', async () => {
    const rootBuilder = makeSingleBuilder({ data: { id: 'root-1', channel_id: 'ch-1', thread_root_id: null } })
    const upsertBuilder = makeSingleBuilder({ data: null })
    setupClient([rootBuilder, upsertBuilder])

    await expect(markThreadRead({ rootId: 'root-1' })).resolves.toEqual({ ok: true })

    expect(rootBuilder.eq).toHaveBeenCalledWith('id', 'root-1')
    expect(upsertBuilder.upsert).toHaveBeenCalledWith(
      {
        user_id: 'user-a',
        thread_root_id: 'root-1',
        last_read_at: expect.any(String),
      },
      { onConflict: 'user_id,thread_root_id' }
    )
  })

  it('rejects marking a non-root message read', async () => {
    const rootBuilder = makeSingleBuilder({ data: { id: 'reply-parent', channel_id: 'ch-1', thread_root_id: 'root-1' } })
    setupClient([rootBuilder])

    await expect(markThreadRead({ rootId: 'reply-parent' })).resolves.toEqual({
      error: 'Thread root not found.',
    })
  })
})
