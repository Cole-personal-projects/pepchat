import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  enqueueMentionNotifications,
  enqueueDirectMessageNotification,
  extractMentionUsernames,
  notificationBody,
} from '@/lib/server-notifications'

type QueryResult = { data?: unknown; error?: { message: string } | null }

function makeBuilder(result: QueryResult = {}) {
  const builder: Record<string, unknown> = {}
  const resolved = Promise.resolve({
    data: result.data ?? null,
    error: result.error ?? null,
  })

  for (const method of ['select', 'eq', 'in', 'maybeSingle']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.insert = vi.fn(() => builder)
  builder.then = resolved.then.bind(resolved)
  builder.maybeSingle = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })

  return builder
}

function setupClient(builders: Record<string, unknown>[]) {
  let index = 0
  const from = vi.fn(() => {
    const builder = builders[index]
    index += 1
    return builder
  })

  return { from }
}

const INPUT = {
  recipientId: 'user-b',
  senderId: 'user-a',
  senderName: 'Alice',
  messageId: 'dm-1',
  conversationId: 'conv-1',
  content: 'Hello there',
  attachments: [],
}

describe('server notification helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('formats notification bodies from text and attachments', () => {
    expect(notificationBody('  Hello there  ')).toBe('Hello there')
    expect(notificationBody('', [{ type: 'image', url: 'https://example.com/a.jpg', name: 'a.jpg', size: 1 }])).toBe('Image')
    expect(notificationBody('', [
      { type: 'image', url: 'https://example.com/a.jpg', name: 'a.jpg', size: 1 },
      { type: 'image', url: 'https://example.com/b.jpg', name: 'b.jpg', size: 1 },
    ])).toBe('2 attachments')
  })

  it('extracts unique mention usernames', () => {
    expect(extractMentionUsernames('@Bob hello @alice, @bob again, email@test.com')).toEqual(['bob', 'alice'])
  })

  it('enqueues a direct message notification when enabled', async () => {
    const preferenceBuilder = makeBuilder({ data: { dm_messages: true } })
    const eventBuilder = makeBuilder()
    const supabase = setupClient([preferenceBuilder, eventBuilder])

    await enqueueDirectMessageNotification(supabase as any, INPUT)

    expect(supabase.from).toHaveBeenCalledWith('notification_preferences')
    expect(preferenceBuilder.eq).toHaveBeenCalledWith('user_id', 'user-b')
    expect(supabase.from).toHaveBeenCalledWith('notification_events')
    expect(eventBuilder.insert).toHaveBeenCalledWith(
      {
        user_id: 'user-b',
        actor_id: 'user-a',
        type: 'dm_message',
        source_table: 'direct_messages',
        source_id: 'dm-1',
        conversation_id: 'conv-1',
        channel_id: null,
        title: 'Alice',
        body: 'Hello there',
        url: '/dm/conv-1#dm-1',
      }
    )
  })

  it('defaults to enabled when preferences do not exist', async () => {
    const preferenceBuilder = makeBuilder({ data: null })
    const eventBuilder = makeBuilder()
    const supabase = setupClient([preferenceBuilder, eventBuilder])

    await enqueueDirectMessageNotification(supabase as any, INPUT)

    expect(eventBuilder.insert).toHaveBeenCalled()
  })

  it('does not enqueue when direct message notifications are disabled', async () => {
    const preferenceBuilder = makeBuilder({ data: { dm_messages: false } })
    const eventBuilder = makeBuilder()
    const supabase = setupClient([preferenceBuilder, eventBuilder])

    await enqueueDirectMessageNotification(supabase as any, INPUT)

    expect(eventBuilder.insert).not.toHaveBeenCalled()
  })

  it('does not enqueue self-notifications', async () => {
    const preferenceBuilder = makeBuilder({ data: { dm_messages: true } })
    const eventBuilder = makeBuilder()
    const supabase = setupClient([preferenceBuilder, eventBuilder])

    await enqueueDirectMessageNotification(supabase as any, {
      ...INPUT,
      recipientId: 'user-a',
    })

    expect(supabase.from).not.toHaveBeenCalled()
    expect(eventBuilder.insert).not.toHaveBeenCalled()
  })

  it('enqueues mention notifications for mentioned users with mention preferences enabled', async () => {
    const profileBuilder = makeBuilder({
      data: [
        { id: 'user-b', username: 'bob', display_name: 'Bob' },
        { id: 'user-c', username: 'carol', display_name: 'Carol' },
        { id: 'user-a', username: 'alice', display_name: 'Alice' },
      ],
    })
    const channelBuilder = makeBuilder({
      data: { id: 'ch-1', group_id: 'group-1', noob_access: false, name: 'general' },
    })
    const membershipBuilder = makeBuilder({
      data: [
        { user_id: 'user-b', role: 'user' },
        { user_id: 'user-c', role: 'user' },
      ],
    })
    const preferenceBuilder = makeBuilder({
      data: [
        { user_id: 'user-b', mentions: true },
        { user_id: 'user-c', mentions: false },
      ],
    })
    const eventBuilder = makeBuilder()
    const supabase = setupClient([
      profileBuilder,
      channelBuilder,
      membershipBuilder,
      preferenceBuilder,
      eventBuilder,
    ])

    await enqueueMentionNotifications(supabase as any, {
      senderId: 'user-a',
      senderName: 'Alice',
      messageId: 'msg-1',
      channelId: 'ch-1',
      content: 'Hi @bob and @carol and @alice',
    })

    expect(profileBuilder.in).toHaveBeenCalledWith('username', ['bob', 'carol', 'alice'])
    expect(channelBuilder.eq).toHaveBeenCalledWith('id', 'ch-1')
    expect(membershipBuilder.eq).toHaveBeenCalledWith('group_id', 'group-1')
    expect(membershipBuilder.in).toHaveBeenCalledWith('user_id', ['user-b', 'user-c'])
    expect(preferenceBuilder.in).toHaveBeenCalledWith('user_id', ['user-b', 'user-c'])
    expect(eventBuilder.insert).toHaveBeenCalledWith([
      {
        user_id: 'user-b',
        actor_id: 'user-a',
        type: 'mention',
        source_table: 'messages',
        source_id: 'msg-1',
        conversation_id: null,
        channel_id: 'ch-1',
        title: 'Alice mentioned you',
        body: 'Hi @bob and @carol and @alice',
        url: '/channels/ch-1#msg-1',
      },
    ])
  })

  it('filters mention recipients that cannot read the channel before body/url fanout', async () => {
    const profileBuilder = makeBuilder({
      data: [
        { id: 'user-b', username: 'bob', display_name: 'Bob' },
        { id: 'user-c', username: 'carol', display_name: 'Carol' },
      ],
    })
    const channelBuilder = makeBuilder({
      data: { id: 'ch-1', group_id: 'group-1', noob_access: false, name: 'private' },
    })
    const membershipBuilder = makeBuilder({
      data: [
        { user_id: 'user-b', role: 'noob' },
        { user_id: 'user-c', role: 'user' },
      ],
    })
    const preferenceBuilder = makeBuilder({ data: [{ user_id: 'user-c', mentions: true }] })
    const eventBuilder = makeBuilder()
    const supabase = setupClient([
      profileBuilder,
      channelBuilder,
      membershipBuilder,
      preferenceBuilder,
      eventBuilder,
    ])

    await enqueueMentionNotifications(supabase as any, {
      senderId: 'user-a',
      senderName: 'Alice',
      messageId: 'thread-reply-1',
      channelId: 'ch-1',
      content: 'Private thread note for @bob and @carol',
    })

    expect(preferenceBuilder.in).toHaveBeenCalledWith('user_id', ['user-c'])
    expect(eventBuilder.insert).toHaveBeenCalledTimes(1)
    const insertedRows = (eventBuilder.insert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(insertedRows).toEqual([
      expect.objectContaining({
        user_id: 'user-c',
        body: 'Private thread note for @bob and @carol',
        url: '/channels/ch-1#thread-reply-1',
      }),
    ])
  })

  it('skips mention notification work when no mentions are present', async () => {
    const profileBuilder = makeBuilder()
    const supabase = setupClient([profileBuilder])

    await enqueueMentionNotifications(supabase as any, {
      senderId: 'user-a',
      senderName: 'Alice',
      messageId: 'msg-1',
      channelId: 'ch-1',
      content: 'No mentions here',
    })

    expect(supabase.from).not.toHaveBeenCalled()
  })
})
