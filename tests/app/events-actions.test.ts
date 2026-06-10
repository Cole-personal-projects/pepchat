import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelEvent, createEvent, rsvpEvent } from '@/app/(app)/events/actions'

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }))

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null }
type Builder = Record<string, ReturnType<typeof vi.fn>>

function makeSelectBuilder(result: QueryResult): Builder {
  const builder: Builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  return builder
}

function makeInsertSelectBuilder(result: QueryResult): Builder {
  const builder: Builder = {}
  builder.insert = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  return builder
}

function makeUpdateBuilder(result: QueryResult = {}): Builder {
  const builder: Builder = {}
  const resolved = Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
  builder.update = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  ;(builder as Record<string, unknown>).then = resolved.then.bind(resolved)
  return builder
}

function makeUpsertBuilder(result: QueryResult = {}): Builder {
  const builder: Builder = {}
  builder.upsert = vi.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }))
  return builder
}

function makeDeleteBuilder(result: QueryResult = {}): Builder {
  const builder: Builder = {}
  const resolved = Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
  builder.delete = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  ;(builder as Record<string, unknown>).then = resolved.then.bind(resolved)
  return builder
}

function setupClient(builders: Builder[], options: { hasPermission?: boolean } = {}) {
  let index = 0
  const from = vi.fn(() => {
    const builder = builders[index]
    index += 1
    if (!builder) throw new Error('Missing mock builder')
    return builder
  })
  const rpc = vi.fn().mockResolvedValue({ data: options.hasPermission ?? true, error: null })

  mockCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
    from,
    rpc,
  })

  return { from, rpc }
}

function eventForm(input: { name?: string; startAt?: string; channelId?: string } = {}) {
  const formData = new FormData()
  formData.set('group_id', 'grp-1')
  formData.set('name', input.name ?? 'Movie Night')
  formData.set('start_at', input.startAt ?? new Date(Date.now() + 86400000).toISOString())
  if (input.channelId) formData.set('channel_id', input.channelId)
  return formData
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createEvent', () => {
  it('requires future start times', async () => {
    setupClient([])
    await expect(createEvent(eventForm({ startAt: '2000-01-01T00:00:00Z' }))).resolves.toEqual({
      error: 'Events must start in the future.',
    })
  })

  it('gates on CREATE_EVENTS via has_permission', async () => {
    const { rpc } = setupClient([
      makeInsertSelectBuilder({ data: { id: 'evt-1' } }),
    ])

    await expect(createEvent(eventForm())).resolves.toEqual({ ok: true, eventId: 'evt-1' })
    expect(rpc).toHaveBeenCalledWith('has_permission', expect.objectContaining({
      p_group_id: 'grp-1',
      p_bit: (1n << 21n).toString(),
    }))
  })

  it('denies without the bit', async () => {
    setupClient([], { hasPermission: false })
    await expect(createEvent(eventForm())).resolves.toEqual({
      error: 'You do not have permission to manage events.',
    })
  })

  it('validates the bound channel belongs to the group', async () => {
    setupClient([
      makeSelectBuilder({ data: { id: 'ch-1', group_id: 'grp-other' } }),
    ])

    await expect(createEvent(eventForm({ channelId: 'ch-1' }))).resolves.toEqual({
      error: 'Channel not found in this group.',
    })
  })
})

describe('cancelEvent', () => {
  it('lets creators cancel without MANAGE_EVENTS', async () => {
    const update = makeUpdateBuilder()
    const { rpc } = setupClient([
      makeSelectBuilder({ data: { id: 'evt-1', group_id: 'grp-1', created_by: 'user-1', status: 'scheduled' } }),
      update,
    ])

    await expect(cancelEvent('evt-1')).resolves.toEqual({ ok: true })
    expect(rpc).not.toHaveBeenCalled()
    expect(update.update).toHaveBeenCalledWith({ status: 'canceled' })
  })

  it('requires MANAGE_EVENTS for non-creators', async () => {
    setupClient([
      makeSelectBuilder({ data: { id: 'evt-1', group_id: 'grp-1', created_by: 'user-2', status: 'scheduled' } }),
    ], { hasPermission: false })

    await expect(cancelEvent('evt-1')).resolves.toEqual({
      error: 'You do not have permission to manage events.',
    })
  })
})

describe('rsvpEvent', () => {
  it('upserts an RSVP', async () => {
    const upsert = makeUpsertBuilder()
    setupClient([upsert])

    await expect(rsvpEvent('evt-1', 'going')).resolves.toEqual({ ok: true })
    expect(upsert.upsert).toHaveBeenCalledWith(
      { event_id: 'evt-1', user_id: 'user-1', status: 'going' },
      { onConflict: 'event_id,user_id' },
    )
  })

  it('clears an RSVP when passed null', async () => {
    const del = makeDeleteBuilder()
    setupClient([del])

    await expect(rsvpEvent('evt-1', null)).resolves.toEqual({ ok: true })
    expect(del.delete).toHaveBeenCalled()
  })

  it('rejects invalid statuses', async () => {
    setupClient([])
    await expect(rsvpEvent('evt-1', 'maybe' as never)).resolves.toEqual({ error: 'Invalid RSVP.' })
  })
})
