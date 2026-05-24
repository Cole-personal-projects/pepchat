import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChannel, deleteChannel, moveChannel, updateChannelSettings } from '@/app/(app)/channels/actions'

const { mockCreateClient, mockRedirect } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null }
type Builder = Record<string, ReturnType<typeof vi.fn>>

function makeFormData(input: { name?: string; description?: string; groupId?: string; noobAccess?: boolean } = {}) {
  const formData = new FormData()
  if (input.name !== undefined) formData.set('name', input.name)
  if (input.description !== undefined) formData.set('description', input.description)
  if (input.groupId !== undefined) formData.set('group_id', input.groupId)
  if (input.noobAccess) formData.set('noob_access', 'on')
  return formData
}

function makeSelectBuilder(result: QueryResult): Builder {
  const builder: Builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  builder.maybeSingle = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  return builder
}

function makeListBuilder(result: QueryResult): Builder {
  const builder: Builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  return builder
}

function makeInsertBuilder(result: QueryResult = {}): Builder {
  const builder: Builder = {}
  builder.insert = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  return builder
}

function makeUpdateBuilder(result: QueryResult = {}): Builder {
  const builder: Builder = {}
  builder.update = vi.fn(() => builder)
  builder.eq = vi.fn(() => Promise.resolve({
    data: result.data ?? null,
    error: result.error ?? null,
  }))
  return builder
}

function makeDeleteBuilder(result: QueryResult = {}): Builder {
  const builder: Builder = {}
  builder.delete = vi.fn(() => builder)
  builder.eq = vi.fn(() => Promise.resolve({
    data: result.data ?? null,
    error: result.error ?? null,
  }))
  return builder
}

function makeGateBuilder(role: 'admin' | 'moderator' | 'user' | 'noob' | null = 'admin'): Builder {
  return makeSelectBuilder(role ? { data: { role } } : {
    data: null,
    error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
  })
}

function setupClient(builders: Builder[], userId: string | null = 'user-1') {
  let index = 0
  const tableCalls: string[] = []
  const from = vi.fn((table: string) => {
    tableCalls.push(table)
    const builder = builders[index]
    index += 1
    if (!builder) throw new Error(`Missing mock builder for ${table}`)
    return builder
  })

  const getUser = vi.fn().mockResolvedValue({
    data: { user: userId ? { id: userId } : null },
    error: null,
  })

  mockCreateClient.mockResolvedValue({
    auth: { getUser },
    from,
  })

  return { from, getUser, tableCalls }
}

const CHANNEL_DENIED = 'You do not have permission to manage channels.'

describe('channel actions — auth behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects unauthenticated createChannel callers to login', async () => {
    setupClient([], null)

    await expect(createChannel(makeFormData({ name: 'General', groupId: 'group-1' }))).rejects.toThrow('redirect:/login')

    expect(mockRedirect).toHaveBeenCalledWith('/login')
  })

  it('returns a stable unauthenticated error for updateChannelSettings', async () => {
    setupClient([], null)

    await expect(updateChannelSettings('ch-1', makeFormData({ name: 'General' }))).resolves.toEqual({
      error: 'Not authenticated.',
    })
  })

  it('redirects unauthenticated deleteChannel callers to login', async () => {
    setupClient([], null)

    await expect(deleteChannel('ch-1', 'group-1')).rejects.toThrow('redirect:/login')

    expect(mockRedirect).toHaveBeenCalledWith('/login')
  })

  it('returns a stable unauthenticated error for moveChannel', async () => {
    setupClient([], null)

    await expect(moveChannel('ch-1', 'up')).resolves.toEqual({
      error: 'Not authenticated.',
    })
  })
})

describe('channel actions — createChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects insufficient roles before reading existing channel positions', async () => {
    const gate = makeGateBuilder('user')
    const duplicate = makeSelectBuilder({ data: null })
    const existing = makeListBuilder({ data: [{ position: 0 }] })
    setupClient([gate, duplicate, existing])

    await expect(createChannel(makeFormData({ name: 'General', groupId: 'group-1' }))).resolves.toEqual({
      error: CHANNEL_DENIED,
    })

    expect(gate.select).toHaveBeenCalledWith('role')
    expect(gate.eq).toHaveBeenCalledWith('group_id', 'group-1')
    expect(gate.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(existing.select).not.toHaveBeenCalled()
  })

  it('allows managers while preserving normalization, position, noob access, and redirect behavior', async () => {
    const gate = makeGateBuilder('moderator')
    const duplicate = makeSelectBuilder({ data: null })
    const existing = makeListBuilder({ data: [{ position: 2 }] })
    const insert = makeInsertBuilder({ data: { id: 'ch-new' } })
    setupClient([gate, duplicate, existing, insert])

    await expect(createChannel(makeFormData({
      name: ' Welcome Chat ',
      description: ' Start here ',
      groupId: 'group-1',
      noobAccess: true,
    }))).rejects.toThrow('redirect:/channels/ch-new')

    expect(insert.insert).toHaveBeenCalledWith({
      group_id: 'group-1',
      name: 'welcome-chat',
      description: 'Start here',
      noob_access: true,
      position: 3,
    })
    expect(mockRedirect).toHaveBeenCalledWith('/channels/ch-new')
  })
})

describe('channel actions — updateChannelSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('looks up the channel group before gating and mutating settings', async () => {
    const channel = makeSelectBuilder({ data: { id: 'ch-1', group_id: 'group-1' } })
    const gate = makeGateBuilder('admin')
    const update = makeUpdateBuilder()
    const { tableCalls } = setupClient([channel, gate, update])

    await expect(updateChannelSettings('ch-1', makeFormData({
      name: ' Welcome Chat ',
      description: ' Start here ',
      noobAccess: true,
    }))).resolves.toEqual({ ok: true })

    expect(tableCalls).toEqual(['channels', 'group_members', 'channels'])
    expect(channel.select).toHaveBeenCalledWith('id, group_id')
    expect(gate.eq).toHaveBeenCalledWith('group_id', 'group-1')
    expect(update.update).toHaveBeenCalledWith({
      name: 'welcome-chat',
      description: 'Start here',
      noob_access: true,
    })
    expect(update.eq).toHaveBeenCalledWith('id', 'ch-1')
  })

  it('returns Channel not found when the pre-gate channel lookup has the Supabase missing-row shape', async () => {
    const channel = makeSelectBuilder({
      data: null,
      error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
    })
    const gate = makeGateBuilder('admin')
    setupClient([channel, gate])

    await expect(updateChannelSettings('ch-1', makeFormData({ name: 'General' }))).resolves.toEqual({
      error: 'Channel not found.',
    })

    expect(gate.select).not.toHaveBeenCalled()
  })

  it('rejects insufficient roles after channel lookup and before mutation', async () => {
    const channel = makeSelectBuilder({ data: { id: 'ch-1', group_id: 'group-1' } })
    const gate = makeGateBuilder('user')
    const update = makeUpdateBuilder()
    const { tableCalls } = setupClient([channel, gate, update])

    await expect(updateChannelSettings('ch-1', makeFormData({ name: 'General' }))).resolves.toEqual({
      error: CHANNEL_DENIED,
    })

    expect(tableCalls).toEqual(['channels', 'group_members'])
    expect(update.update).not.toHaveBeenCalled()
  })

  it('rejects empty channel names before querying channel data', async () => {
    const channel = makeSelectBuilder({ data: { id: 'ch-1', group_id: 'group-1' } })
    setupClient([channel])

    await expect(updateChannelSettings('ch-1', makeFormData({ name: ' ' }))).resolves.toEqual({
      error: 'Channel name is required.',
    })

    expect(channel.select).not.toHaveBeenCalled()
  })
})

describe('channel actions — deleteChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects insufficient roles before deleting', async () => {
    const gate = makeGateBuilder('noob')
    const deleteBuilder = makeDeleteBuilder()
    setupClient([gate, deleteBuilder])

    await expect(deleteChannel('ch-1', 'group-1')).resolves.toEqual({
      error: CHANNEL_DENIED,
    })

    expect(gate.eq).toHaveBeenCalledWith('group_id', 'group-1')
    expect(deleteBuilder.delete).not.toHaveBeenCalled()
  })

  it('allows managers while preserving the group redirect', async () => {
    const gate = makeGateBuilder('admin')
    const deleteBuilder = makeDeleteBuilder()
    setupClient([gate, deleteBuilder])

    await expect(deleteChannel('ch-1', 'group-1')).rejects.toThrow('redirect:/groups/group-1')

    expect(deleteBuilder.delete).toHaveBeenCalled()
    expect(deleteBuilder.eq).toHaveBeenCalledWith('id', 'ch-1')
    expect(mockRedirect).toHaveBeenCalledWith('/groups/group-1')
  })
})

describe('channel actions — moveChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('gates after selected channel lookup and before adjacent channel lookup', async () => {
    const channel = makeSelectBuilder({ data: { id: 'ch-2', group_id: 'group-1', position: 1 } })
    const gate = makeGateBuilder('admin')
    const adjacent = makeSelectBuilder({ data: { id: 'ch-1', position: 0 } })
    const channelUpdate = makeUpdateBuilder()
    const adjacentUpdate = makeUpdateBuilder()
    const { tableCalls } = setupClient([channel, gate, adjacent, channelUpdate, adjacentUpdate])

    await expect(moveChannel('ch-2', 'up')).resolves.toBeUndefined()

    expect(tableCalls).toEqual(['channels', 'group_members', 'channels', 'channels', 'channels'])
    expect(gate.eq).toHaveBeenCalledWith('group_id', 'group-1')
    expect(channelUpdate.update).toHaveBeenCalledWith({ position: 0 })
    expect(channelUpdate.eq).toHaveBeenCalledWith('id', 'ch-2')
    expect(adjacentUpdate.update).toHaveBeenCalledWith({ position: 1 })
    expect(adjacentUpdate.eq).toHaveBeenCalledWith('id', 'ch-1')
  })

  it('rejects insufficient roles after selected channel lookup and before adjacent lookup', async () => {
    const channel = makeSelectBuilder({ data: { id: 'ch-2', group_id: 'group-1', position: 1 } })
    const gate = makeGateBuilder('user')
    const adjacent = makeSelectBuilder({ data: { id: 'ch-1', position: 0 } })
    const { tableCalls } = setupClient([channel, gate, adjacent])

    await expect(moveChannel('ch-2', 'up')).resolves.toEqual({
      error: CHANNEL_DENIED,
    })

    expect(tableCalls).toEqual(['channels', 'group_members'])
    expect(adjacent.select).not.toHaveBeenCalled()
  })

  it('returns without updating when there is no adjacent channel', async () => {
    const channel = makeSelectBuilder({ data: { id: 'ch-1', group_id: 'group-1', position: 0 } })
    const gate = makeGateBuilder('admin')
    const adjacent = makeSelectBuilder({ data: null })
    const update = makeUpdateBuilder()
    setupClient([channel, gate, adjacent, update])

    await expect(moveChannel('ch-1', 'up')).resolves.toBeUndefined()

    expect(update.update).not.toHaveBeenCalled()
  })

  it('surfaces selected channel lookup errors', async () => {
    const channel = makeSelectBuilder({ error: { message: 'Channel lookup failed' } })
    const gate = makeGateBuilder('admin')
    setupClient([channel, gate])

    await expect(moveChannel('ch-2', 'up')).resolves.toEqual({
      error: 'Channel lookup failed',
    })

    expect(gate.select).not.toHaveBeenCalled()
  })

  it('surfaces adjacent channel lookup errors', async () => {
    const channel = makeSelectBuilder({ data: { id: 'ch-2', group_id: 'group-1', position: 1 } })
    const gate = makeGateBuilder('moderator')
    const adjacent = makeSelectBuilder({ error: { message: 'Adjacent lookup failed' } })
    const update = makeUpdateBuilder()
    setupClient([channel, gate, adjacent, update])

    await expect(moveChannel('ch-2', 'up')).resolves.toEqual({
      error: 'Adjacent lookup failed',
    })

    expect(update.update).not.toHaveBeenCalled()
  })

  it('surfaces update errors before applying the second update', async () => {
    const channel = makeSelectBuilder({ data: { id: 'ch-2', group_id: 'group-1', position: 1 } })
    const gate = makeGateBuilder('admin')
    const adjacent = makeSelectBuilder({ data: { id: 'ch-1', position: 0 } })
    const channelUpdate = makeUpdateBuilder({ error: { message: 'First update failed' } })
    const adjacentUpdate = makeUpdateBuilder()
    setupClient([channel, gate, adjacent, channelUpdate, adjacentUpdate])

    await expect(moveChannel('ch-2', 'up')).resolves.toEqual({
      error: 'First update failed',
    })

    expect(adjacentUpdate.update).not.toHaveBeenCalled()
  })
})
