import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteNotificationSubscription,
  getNotificationEvents,
  getNotificationPreferences,
  markAllNotificationEventsRead,
  markNotificationEventRead,
  saveNotificationSubscription,
  updateNotificationPreferences,
} from '@/app/(app)/notifications/actions'

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null }

function setupClient(builder: unknown, userId: string | null = 'user-1') {
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

function setupClientSequence(builders: unknown[], userId: string | null = 'user-1') {
  let index = 0
  const from = vi.fn(() => {
    const builder = builders[index]
    index += 1
    return builder
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

function makeSelectBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.is = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
    count: result.count ?? null,
  })
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
    count: result.count ?? null,
  })
  builder.single = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  return builder
}

function makeUpsertBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  const resolved = Promise.resolve({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  builder.upsert = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  builder.then = resolved.then.bind(resolved)
  return builder
}

function makeDeleteBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  builder.delete = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  ;(builder.eq as ReturnType<typeof vi.fn>).mockReturnValueOnce(builder).mockResolvedValueOnce({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  return builder
}

function makeUpdateBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  const resolved = Promise.resolve({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  builder.update = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.is = vi.fn(() => builder)
  builder.then = resolved.then.bind(resolved)
  return builder
}

const PREFERENCES = {
  user_id: 'user-1',
  dm_messages: true,
  mentions: true,
  group_messages: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const SUBSCRIPTION = {
  endpoint: 'https://push.example/subscription-1',
  keys: {
    p256dh: 'p256dh-key',
    auth: 'auth-secret',
  },
  user_agent: 'Vitest Browser',
}

const EVENTS = [
  {
    id: 'event-1',
    user_id: 'user-1',
    actor_id: 'user-2',
    type: 'dm_message',
    source_table: 'direct_messages',
    source_id: 'dm-1',
    conversation_id: 'conv-1',
    channel_id: null,
    title: 'Alice',
    body: 'Hello',
    url: '/channels?dm=conv-1',
    read_at: null,
    pushed_at: null,
    push_error: null,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'event-2',
    user_id: 'user-1',
    actor_id: 'user-3',
    type: 'dm_message',
    source_table: 'direct_messages',
    source_id: 'dm-2',
    conversation_id: 'conv-2',
    channel_id: null,
    title: 'Bob',
    body: 'Read already',
    url: '/channels?dm=conv-2',
    read_at: '2026-01-01T00:01:00.000Z',
    pushed_at: null,
    push_error: null,
    created_at: '2026-01-01T00:00:30.000Z',
  },
]

describe('notification actions — getNotificationPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated users', async () => {
    setupClient(makeSelectBuilder({}), null)

    await expect(getNotificationPreferences()).resolves.toEqual({ error: 'Not authenticated.' })
  })

  it('returns stored preferences for the current user', async () => {
    const builder = makeSelectBuilder({ data: PREFERENCES })
    const { from } = setupClient(builder)

    await expect(getNotificationPreferences()).resolves.toEqual({
      ok: true,
      preferences: PREFERENCES,
    })

    expect(from).toHaveBeenCalledWith('notification_preferences')
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('returns default preferences when no row exists yet', async () => {
    setupClient(makeSelectBuilder({ error: { message: 'No rows', code: 'PGRST116' } }))

    const result = await getNotificationPreferences()

    expect(result).toMatchObject({
      ok: true,
      preferences: {
        user_id: 'user-1',
        dm_messages: true,
        mentions: true,
        group_messages: false,
      },
    })
  })

  it('reports notification preferences as unavailable when the table is missing from PostgREST schema cache', async () => {
    setupClient(makeSelectBuilder({
      error: {
        message: "Could not find the table 'public.notification_preferences' in the schema cache",
        code: 'PGRST205',
      },
    }))

    await expect(getNotificationPreferences()).resolves.toEqual({
      unavailable: true,
      message: 'Notification delivery settings are temporarily unavailable.',
    })
  })

  it('surfaces select errors', async () => {
    setupClient(makeSelectBuilder({ error: { message: 'Read failed' } }))

    await expect(getNotificationPreferences()).resolves.toEqual({ error: 'Read failed' })
  })
})

describe('notification actions — updateNotificationPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated users', async () => {
    setupClient(makeUpsertBuilder({}), null)

    await expect(updateNotificationPreferences({ dm_messages: false })).resolves.toEqual({
      error: 'Not authenticated.',
    })
  })

  it('upserts allowed preference fields for the current user', async () => {
    const builder = makeUpsertBuilder({ data: { ...PREFERENCES, dm_messages: false } })
    setupClient(builder)

    await expect(updateNotificationPreferences({ dm_messages: false })).resolves.toEqual({
      ok: true,
      preferences: { ...PREFERENCES, dm_messages: false },
    })

    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        dm_messages: false,
        updated_at: expect.any(String),
      }),
      { onConflict: 'user_id' }
    )
  })

  it('ignores unknown runtime fields', async () => {
    const builder = makeUpsertBuilder({ data: PREFERENCES })
    setupClient(builder)

    await updateNotificationPreferences({ dm_messages: true, unknown: false } as any)

    expect(builder.upsert).toHaveBeenCalledWith(
      expect.not.objectContaining({ unknown: false }),
      { onConflict: 'user_id' }
    )
  })

  it('surfaces upsert errors', async () => {
    setupClient(makeUpsertBuilder({ error: { message: 'Save failed' } }))

    await expect(updateNotificationPreferences({ mentions: false })).resolves.toEqual({
      error: 'Save failed',
    })
  })
})

describe('notification actions — saveNotificationSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated users', async () => {
    setupClient(makeUpsertBuilder({}), null)

    await expect(saveNotificationSubscription(SUBSCRIPTION)).resolves.toEqual({
      error: 'Not authenticated.',
    })
  })

  it('rejects invalid subscriptions', async () => {
    setupClient(makeUpsertBuilder({}))

    await expect(saveNotificationSubscription({
      endpoint: '',
      keys: { p256dh: 'key', auth: 'secret' },
    })).resolves.toEqual({ error: 'Invalid push subscription.' })
  })

  it('upserts the browser push subscription for the current user', async () => {
    const builder = makeUpsertBuilder({})
    const { from } = setupClient(builder)

    await expect(saveNotificationSubscription(SUBSCRIPTION)).resolves.toEqual({ ok: true })

    expect(from).toHaveBeenCalledWith('notification_subscriptions')
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        endpoint: SUBSCRIPTION.endpoint,
        p256dh: SUBSCRIPTION.keys.p256dh,
        auth: SUBSCRIPTION.keys.auth,
        user_agent: SUBSCRIPTION.user_agent,
        updated_at: expect.any(String),
      }),
      { onConflict: 'endpoint' }
    )
  })

  it('surfaces subscription save errors', async () => {
    setupClient(makeUpsertBuilder({ error: { message: 'Subscription failed' } }))

    await expect(saveNotificationSubscription(SUBSCRIPTION)).resolves.toEqual({
      error: 'Subscription failed',
    })
  })
})

describe('notification actions — deleteNotificationSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated users', async () => {
    setupClient(makeDeleteBuilder({}), null)

    await expect(deleteNotificationSubscription(SUBSCRIPTION.endpoint)).resolves.toEqual({
      error: 'Not authenticated.',
    })
  })

  it('deletes the current user subscription by endpoint', async () => {
    const builder = makeDeleteBuilder({})
    setupClient(builder)

    await expect(deleteNotificationSubscription(SUBSCRIPTION.endpoint)).resolves.toEqual({ ok: true })

    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1')
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'endpoint', SUBSCRIPTION.endpoint)
  })

  it('surfaces subscription delete errors', async () => {
    setupClient(makeDeleteBuilder({ error: { message: 'Delete failed' } }))

    await expect(deleteNotificationSubscription(SUBSCRIPTION.endpoint)).resolves.toEqual({
      error: 'Delete failed',
    })
  })
})

describe('notification actions — getNotificationEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated users', async () => {
    setupClient(makeSelectBuilder({}), null)

    await expect(getNotificationEvents()).resolves.toEqual({ error: 'Not authenticated.' })
  })

  it('returns recent events and unread count for the current user', async () => {
    const eventsBuilder = makeSelectBuilder({ data: EVENTS })
    const countBuilder = makeSelectBuilder({ count: 8 })
    const { from } = setupClientSequence([eventsBuilder, countBuilder])

    await expect(getNotificationEvents(200)).resolves.toEqual({
      ok: true,
      events: EVENTS,
      unreadCount: 8,
    })

    expect(from).toHaveBeenCalledWith('notification_events')
    expect(eventsBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(eventsBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(eventsBuilder.limit).toHaveBeenCalledWith(50)
    expect(countBuilder.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(countBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(countBuilder.is).toHaveBeenCalledWith('read_at', null)
  })

  it('surfaces event load errors', async () => {
    setupClient(makeSelectBuilder({ error: { message: 'Load failed' } }))

    await expect(getNotificationEvents()).resolves.toEqual({ error: 'Load failed' })
  })
})

describe('notification actions — markNotificationEventRead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects invalid event ids', async () => {
    setupClient(makeUpdateBuilder({}))

    await expect(markNotificationEventRead('   ')).resolves.toEqual({
      error: 'Invalid notification event.',
    })
  })

  it('marks one event read for the current user', async () => {
    const builder = makeUpdateBuilder({})
    const { from } = setupClient(builder)

    await expect(markNotificationEventRead('event-1')).resolves.toEqual({ ok: true })

    expect(from).toHaveBeenCalledWith('notification_events')
    expect(builder.update).toHaveBeenCalledWith({ read_at: expect.any(String) })
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'id', 'event-1')
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'user_id', 'user-1')
  })
})

describe('notification actions — markAllNotificationEventsRead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks unread events read for the current user', async () => {
    const builder = makeUpdateBuilder({})
    setupClientSequence([builder])

    await expect(markAllNotificationEventsRead()).resolves.toEqual({ ok: true })

    expect(builder.update).toHaveBeenCalledWith({ read_at: expect.any(String) })
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(builder.is).toHaveBeenCalledWith('read_at', null)
  })
})
