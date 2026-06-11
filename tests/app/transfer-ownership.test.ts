import { beforeEach, describe, expect, it, vi } from 'vitest'
import { transferOwnership } from '@/app/(app)/groups/actions'

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null }

function makeSingleBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  return builder
}

function makeMutationBuilder(result: QueryResult = {}) {
  const builder: Record<string, unknown> = {}
  builder.update = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve, reject)
  return builder
}

function makeAuditBuilder() {
  const builder: Record<string, unknown> = {}
  builder.insert = vi.fn().mockResolvedValue({ error: null })
  return builder
}

function setupClient(builders: Record<string, unknown>[], userId = 'owner-1') {
  let index = 0
  const from = vi.fn(() => {
    const builder = builders[index]
    index += 1
    return builder
  })

  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
    },
    from,
  })

  return { from }
}

describe('transferOwnership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated callers', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      from: vi.fn(),
    })

    await expect(transferOwnership('group-1', 'user-2')).resolves.toEqual({
      error: 'Not authenticated.',
    })
  })

  it('rejects transferring to yourself', async () => {
    setupClient([])

    await expect(transferOwnership('group-1', 'owner-1')).resolves.toEqual({
      error: 'You already own this group.',
    })
  })

  it('only the owner can transfer', async () => {
    const groupLookup = makeSingleBuilder({ data: { owner_id: 'someone-else' } })
    setupClient([groupLookup])

    await expect(transferOwnership('group-1', 'user-2')).resolves.toEqual({
      error: 'Only the owner can transfer ownership.',
    })
  })

  it('requires the new owner to be a member', async () => {
    const groupLookup = makeSingleBuilder({ data: { owner_id: 'owner-1' } })
    const targetLookup = makeSingleBuilder({ data: null })
    setupClient([groupLookup, targetLookup])

    await expect(transferOwnership('group-1', 'stranger')).resolves.toEqual({
      error: 'The new owner must be a member of this group.',
    })
  })

  it('promotes the new owner to admin, flips owner_id, and audits', async () => {
    const groupLookup = makeSingleBuilder({ data: { owner_id: 'owner-1' } })
    const targetLookup = makeSingleBuilder({ data: { role: 'user' } })
    const promote = makeMutationBuilder()
    const ownerUpdate = makeMutationBuilder()
    const audit = makeAuditBuilder()
    setupClient([groupLookup, targetLookup, promote, ownerUpdate, audit])

    await expect(transferOwnership('group-1', 'user-2')).resolves.toEqual({ ok: true })

    expect(promote.update).toHaveBeenCalledWith({ role: 'admin' })
    expect(promote.eq).toHaveBeenCalledWith('user_id', 'user-2')
    expect(ownerUpdate.update).toHaveBeenCalledWith({ owner_id: 'user-2' })
    expect(ownerUpdate.eq).toHaveBeenCalledWith('owner_id', 'owner-1')
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ownership_transferred',
      target_id: 'user-2',
      metadata: { group_id: 'group-1', previous_owner: 'owner-1' },
    }))
  })

  it('skips the promotion step when the target is already an admin', async () => {
    const groupLookup = makeSingleBuilder({ data: { owner_id: 'owner-1' } })
    const targetLookup = makeSingleBuilder({ data: { role: 'admin' } })
    const ownerUpdate = makeMutationBuilder()
    const audit = makeAuditBuilder()
    setupClient([groupLookup, targetLookup, ownerUpdate, audit])

    await expect(transferOwnership('group-1', 'admin-2')).resolves.toEqual({ ok: true })

    expect(ownerUpdate.update).toHaveBeenCalledWith({ owner_id: 'admin-2' })
  })
})
