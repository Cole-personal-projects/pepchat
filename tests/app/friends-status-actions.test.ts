import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptFriendRequest, blockUser, removeFriendship, sendFriendRequest } from '@/app/(app)/friends/actions'
import { clearCustomStatus, setCustomStatus, setPresenceMode } from '@/app/(app)/status/actions'

const { mockCreateClient, mockCreateAdminClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mockCreateAdminClient }))

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null }
type Builder = Record<string, ReturnType<typeof vi.fn>>

function makeLookupBuilder(result: QueryResult): Builder {
  const builder: Builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.or = vi.fn(() => builder)
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  builder.single = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  return builder
}

function makeInsertBuilder(result: QueryResult = {}): Builder {
  const builder: Builder = {}
  builder.insert = vi.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }))
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

function makeDeleteBuilder(result: QueryResult = {}): Builder {
  const builder: Builder = {}
  const resolved = Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
  builder.delete = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  ;(builder as Record<string, unknown>).then = resolved.then.bind(resolved)
  return builder
}

function makeUpsertBuilder(result: QueryResult = {}): Builder {
  const builder: Builder = {}
  builder.upsert = vi.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }))
  return builder
}

function setupClient(builders: Builder[], options: { userId?: string | null } = {}) {
  let index = 0
  const from = vi.fn(() => {
    const builder = builders[index]
    index += 1
    if (!builder) throw new Error('Missing mock builder')
    return builder
  })

  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.userId === null ? null : { id: options.userId ?? 'user-1' } },
        error: null,
      }),
    },
    from,
  })

  return { from }
}

const ORIGINAL_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
})

afterAllRestore()
function afterAllRestore() {
  if (ORIGINAL_SERVICE_ROLE_KEY !== undefined) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_ROLE_KEY
  }
}

describe('sendFriendRequest', () => {
  it('rejects friending yourself', async () => {
    setupClient([
      makeLookupBuilder({ data: { id: 'user-1', username: 'me' } }),
    ])

    await expect(sendFriendRequest('me')).resolves.toEqual({ error: 'You cannot friend yourself.' })
  })

  it('returns a friendly error when the username does not exist', async () => {
    setupClient([
      makeLookupBuilder({ data: null }),
    ])

    await expect(sendFriendRequest('ghost')).resolves.toEqual({ error: 'No user found with that username.' })
  })

  it('rejects duplicates with a pending message', async () => {
    setupClient([
      makeLookupBuilder({ data: { id: 'user-2', username: 'bob' } }),
      makeLookupBuilder({ data: { id: 'f-1', status: 'pending', requester_id: 'user-1', addressee_id: 'user-2', blocked_by: null } }),
    ])

    await expect(sendFriendRequest('bob')).resolves.toEqual({ error: 'A friend request is already pending.' })
  })

  it('hides blocks created by the other user behind the not-found message', async () => {
    setupClient([
      makeLookupBuilder({ data: { id: 'user-2', username: 'bob' } }),
      makeLookupBuilder({ data: { id: 'f-1', status: 'blocked', requester_id: 'user-2', addressee_id: 'user-1', blocked_by: 'user-2' } }),
    ])

    await expect(sendFriendRequest('bob')).resolves.toEqual({ error: 'No user found with that username.' })
  })

  it('inserts a pending request on success', async () => {
    const insert = makeInsertBuilder()
    setupClient([
      makeLookupBuilder({ data: { id: 'user-2', username: 'bob' } }),
      makeLookupBuilder({ data: null }),
      insert,
    ])

    await expect(sendFriendRequest('@bob')).resolves.toEqual({ ok: true })
    expect(insert.insert).toHaveBeenCalledWith({
      requester_id: 'user-1',
      addressee_id: 'user-2',
      status: 'pending',
    })
  })
})

describe('acceptFriendRequest', () => {
  it('only the recipient can accept', async () => {
    setupClient([
      makeLookupBuilder({ data: { id: 'f-1', status: 'pending', addressee_id: 'user-2' } }),
    ])

    await expect(acceptFriendRequest('f-1')).resolves.toEqual({ error: 'Only the recipient can accept a request.' })
  })

  it('accepts pending requests addressed to the caller', async () => {
    const update = makeUpdateBuilder()
    setupClient([
      makeLookupBuilder({ data: { id: 'f-1', status: 'pending', addressee_id: 'user-1' } }),
      update,
    ])

    await expect(acceptFriendRequest('f-1')).resolves.toEqual({ ok: true })
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted' }))
  })
})

describe('removeFriendship', () => {
  it('prevents removing a block created by the other side', async () => {
    setupClient([
      makeLookupBuilder({ data: { id: 'f-1', status: 'blocked', blocked_by: 'user-2' } }),
    ])

    await expect(removeFriendship('f-1')).resolves.toEqual({ error: 'Friendship not found.' })
  })

  it('deletes accepted friendships', async () => {
    const del = makeDeleteBuilder()
    setupClient([
      makeLookupBuilder({ data: { id: 'f-1', status: 'accepted', blocked_by: null } }),
      del,
    ])

    await expect(removeFriendship('f-1')).resolves.toEqual({ ok: true })
    expect(del.delete).toHaveBeenCalled()
  })
})

describe('blockUser', () => {
  it('converts an existing relationship into a block', async () => {
    const update = makeUpdateBuilder()
    setupClient([
      makeLookupBuilder({ data: { id: 'f-1' } }),
      update,
    ])

    await expect(blockUser('user-2')).resolves.toEqual({ ok: true })
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked', blocked_by: 'user-1' }))
  })

  it('creates a block row when no relationship exists', async () => {
    const insert = makeInsertBuilder()
    setupClient([
      makeLookupBuilder({ data: null }),
      insert,
    ])

    await expect(blockUser('user-2')).resolves.toEqual({ ok: true })
    expect(insert.insert).toHaveBeenCalledWith({
      requester_id: 'user-1',
      addressee_id: 'user-2',
      status: 'blocked',
      blocked_by: 'user-1',
    })
  })
})

describe('status actions', () => {
  it('rejects invalid presence modes', async () => {
    setupClient([])
    await expect(setPresenceMode('away' as never)).resolves.toEqual({ error: 'Invalid presence mode.' })
  })

  it('upserts the presence mode', async () => {
    const upsert = makeUpsertBuilder()
    setupClient([upsert])

    await expect(setPresenceMode('dnd')).resolves.toEqual({ ok: true })
    expect(upsert.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', presence: 'dnd' }),
      { onConflict: 'user_id' },
    )
  })

  it('rejects over-long custom status text', async () => {
    setupClient([])
    await expect(setCustomStatus({ text: 'x'.repeat(129) })).resolves.toEqual({
      error: 'Status must be 128 characters or fewer.',
    })
  })

  it('rejects past expiry timestamps', async () => {
    setupClient([])
    await expect(setCustomStatus({ text: 'busy', expiresAt: '2000-01-01T00:00:00Z' })).resolves.toEqual({
      error: 'Status expiry must be in the future.',
    })
  })

  it('clears custom status fields', async () => {
    const upsert = makeUpsertBuilder()
    setupClient([upsert])

    await expect(clearCustomStatus()).resolves.toEqual({ ok: true })
    expect(upsert.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status_text: null, status_emoji: null, status_expires_at: null }),
      { onConflict: 'user_id' },
    )
  })
})
