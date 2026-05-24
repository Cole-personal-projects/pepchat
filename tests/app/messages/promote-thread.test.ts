import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promoteThreadToChannel } from '@/app/(app)/messages/promote-thread-action'

const { mockCreateAdminClient, mockCreateClient, mockLogAuditEvent } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockCreateClient: vi.fn(),
  mockLogAuditEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}))

vi.mock('@/lib/audit', () => ({
  logAuditEvent: mockLogAuditEvent,
}))

vi.mock('@/lib/server-notifications', () => ({
  dispatchNotification: vi.fn(),
}))

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null }

function makeBuilder(result: QueryResult = {}) {
  const builder: Record<string, any> = {}
  for (const method of ['select', 'eq', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  return builder
}

function setupClient(builders: unknown[], options: {
  userId?: string | null
  rpcResult?: QueryResult
  adminBanned?: boolean
  adminBanError?: { message: string; code?: string }
} = {}) {
  const queue = [...builders]
  const channelSend = vi.fn().mockResolvedValue('ok')
  const from = vi.fn((table: string) => {
    const next = queue.shift()
    if (!next) throw new Error(`Unexpected from(${table}) call`)
    return next
  })
  const rpc = vi.fn().mockResolvedValue({
    data: options.rpcResult?.data ?? [{ new_channel_id: 'ch-new', moved_reply_count: 2 }],
    error: options.rpcResult?.error ?? null,
  })
  const channel = vi.fn(() => ({ send: channelSend }))
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.userId === null ? null : { id: options.userId ?? 'actor-1' } },
        error: null,
      }),
    },
    from,
    rpc,
    channel,
  })

  const banLookup = makeBuilder({
    data: options.adminBanned ? { user_id: options.userId ?? 'actor-1' } : null,
    error: options.adminBanError ?? null,
  })
  const adminFrom = vi.fn((table: string) => {
    if (table !== 'banned_users') throw new Error(`Unexpected admin from(${table}) call`)
    return banLookup
  })
  mockCreateAdminClient.mockReturnValue({ from: adminFrom })

  return { from, rpc, channel, channelSend, adminFrom, banLookup }
}

const ROOT = { id: 'root-1', channel_id: 'ch-source', thread_root_id: null, user_id: 'author-1' }
const SOURCE_CHANNEL = { id: 'ch-source', group_id: 'group-1', noob_access: true }
const NEW_CHANNEL = { id: 'ch-new', group_id: 'group-1', name: 'promoted-thread' }
const ORIGINAL_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe('promoteThreadToChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLogAuditEvent.mockResolvedValue(undefined)
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  })

  afterEach(() => {
    if (ORIGINAL_SERVICE_ROLE_KEY === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_ROLE_KEY
    }
  })

  it('promotes a root thread for a channel manager and broadcasts after commit', async () => {
    const root = makeBuilder({ data: ROOT })
    const source = makeBuilder({ data: SOURCE_CHANNEL })
    const gate = makeBuilder({ data: { role: 'moderator' } })
    const duplicate = makeBuilder({ data: null })
    const newChannel = makeBuilder({ data: NEW_CHANNEL })
    const { rpc, channel, channelSend } = setupClient([root, source, gate, duplicate, newChannel])

    await expect(promoteThreadToChannel({
      rootMessageId: ' root-1 ',
      channelName: ' Promoted Thread ',
      channelTopic: ' Topic ',
    })).resolves.toEqual({ newChannelId: 'ch-new', movedReplyCount: 2 })

    expect(gate.eq).toHaveBeenCalledWith('group_id', 'group-1')
    expect(gate.eq).toHaveBeenCalledWith('user_id', 'actor-1')
    expect(duplicate.eq).toHaveBeenCalledWith('name', 'promoted-thread')
    expect(rpc).toHaveBeenCalledWith('promote_thread_to_channel', {
      p_root_message_id: 'root-1',
      p_new_channel_name: 'promoted-thread',
      p_new_channel_topic: 'Topic',
      p_noob_access: true,
      p_actor_id: 'actor-1',
    })
    expect(mockLogAuditEvent).not.toHaveBeenCalled()
    expect(channel).toHaveBeenCalledWith('thread-root-1')
    expect(channel).toHaveBeenCalledWith('channels-group-1')
    expect(channelSend).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'thread_promoted',
      payload: { newChannelId: 'ch-new', channelName: 'promoted-thread' },
    })
    expect(channelSend).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'channel_added',
      payload: NEW_CHANNEL,
    })
  })

  it('allows the root author even without channel-manager role', async () => {
    const root = makeBuilder({ data: { ...ROOT, user_id: 'actor-1' } })
    const source = makeBuilder({ data: SOURCE_CHANNEL })
    const gate = makeBuilder({ data: { role: 'user' } })
    const duplicate = makeBuilder({ data: null })
    const newChannel = makeBuilder({ data: NEW_CHANNEL })
    setupClient([root, source, gate, duplicate, newChannel])

    await expect(promoteThreadToChannel({ rootMessageId: 'root-1', channelName: 'promoted' }))
      .resolves.toEqual({ newChannelId: 'ch-new', movedReplyCount: 2 })
  })

  it('denies banned actors before role gate or RPC', async () => {
    const root = makeBuilder({ data: { ...ROOT, user_id: 'actor-1' } })
    const source = makeBuilder({ data: SOURCE_CHANNEL })
    const gate = makeBuilder({ data: { role: 'admin' } })
    const duplicate = makeBuilder({ data: null })
    const { rpc, banLookup } = setupClient([root, source, gate, duplicate], { adminBanned: true })

    await expect(promoteThreadToChannel({ rootMessageId: 'root-1', channelName: 'promoted' }))
      .resolves.toEqual({ error: 'You do not have permission to promote this thread.' })

    expect(banLookup.eq).toHaveBeenCalledWith('user_id', 'actor-1')
    expect(gate.select).not.toHaveBeenCalled()
    expect(duplicate.select).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not fail a committed promotion because of action-level audit logging', async () => {
    mockLogAuditEvent.mockRejectedValue(new Error('audit unavailable'))
    const root = makeBuilder({ data: ROOT })
    const source = makeBuilder({ data: SOURCE_CHANNEL })
    const gate = makeBuilder({ data: { role: 'moderator' } })
    const duplicate = makeBuilder({ data: null })
    const newChannel = makeBuilder({ data: NEW_CHANNEL })
    const { channelSend } = setupClient([root, source, gate, duplicate, newChannel])

    await expect(promoteThreadToChannel({ rootMessageId: 'root-1', channelName: 'promoted' }))
      .resolves.toEqual({ newChannelId: 'ch-new', movedReplyCount: 2 })

    expect(mockLogAuditEvent).not.toHaveBeenCalled()
    expect(channelSend).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'thread_promoted',
      payload: { newChannelId: 'ch-new', channelName: 'promoted-thread' },
    })
  })

  it('skips the channel_added broadcast when the new channel payload cannot be loaded', async () => {
    const root = makeBuilder({ data: ROOT })
    const source = makeBuilder({ data: SOURCE_CHANNEL })
    const gate = makeBuilder({ data: { role: 'moderator' } })
    const duplicate = makeBuilder({ data: null })
    const newChannel = makeBuilder({ data: null })
    const { channel, channelSend } = setupClient([root, source, gate, duplicate, newChannel])

    await expect(promoteThreadToChannel({ rootMessageId: 'root-1', channelName: 'promoted' }))
      .resolves.toEqual({ newChannelId: 'ch-new', movedReplyCount: 2 })

    expect(channel).toHaveBeenCalledWith('thread-root-1')
    expect(channel).not.toHaveBeenCalledWith('channels-group-1')
    expect(channelSend).toHaveBeenCalledTimes(1)
    expect(channelSend).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'thread_promoted',
      payload: { newChannelId: 'ch-new', channelName: 'new-channel' },
    })
  })

  it('denies non-author non-managers before validation or RPC', async () => {
    const root = makeBuilder({ data: ROOT })
    const source = makeBuilder({ data: SOURCE_CHANNEL })
    const gate = makeBuilder({ data: { role: 'user' } })
    const duplicate = makeBuilder({ data: null })
    const { rpc } = setupClient([root, source, gate, duplicate])

    await expect(promoteThreadToChannel({ rootMessageId: 'root-1', channelName: 'promoted' }))
      .resolves.toEqual({ error: 'You do not have permission to promote this thread.' })

    expect(duplicate.select).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns createChannel-compatible name collision errors before RPC', async () => {
    const root = makeBuilder({ data: ROOT })
    const source = makeBuilder({ data: SOURCE_CHANNEL })
    const gate = makeBuilder({ data: { role: 'admin' } })
    const duplicate = makeBuilder({ data: { id: 'existing' } })
    const { rpc } = setupClient([root, source, gate, duplicate])

    await expect(promoteThreadToChannel({ rootMessageId: 'root-1', channelName: 'Promoted' }))
      .resolves.toEqual({ error: 'Channel name already exists.' })

    expect(rpc).not.toHaveBeenCalled()
  })

  it('surfaces typed empty-thread errors from the transactional RPC', async () => {
    const root = makeBuilder({ data: ROOT })
    const source = makeBuilder({ data: SOURCE_CHANNEL })
    const gate = makeBuilder({ data: { role: 'admin' } })
    const duplicate = makeBuilder({ data: null })
    const { rpc } = setupClient([root, source, gate, duplicate], {
      rpcResult: { error: { message: 'Cannot promote an empty thread.' } },
    })

    await expect(promoteThreadToChannel({ rootMessageId: 'root-1', channelName: 'Promoted' }))
      .resolves.toEqual({ error: 'Cannot promote an empty thread.' })

    expect(rpc).toHaveBeenCalled()
    expect(mockLogAuditEvent).not.toHaveBeenCalled()
  })
})
