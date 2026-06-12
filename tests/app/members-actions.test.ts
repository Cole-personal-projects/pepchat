import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assignRole, kickMember } from '@/app/(app)/members/actions'

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

type QueryResult = { data?: unknown; error?: { message: string } | null }

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
  builder.delete = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    // Updates report the matched rows ([{...}] by default) so actions can
    // distinguish a real change from an RLS-silenced zero-row update.
    Promise.resolve({
      data: result.data !== undefined ? result.data : [{ user_id: 'target' }],
      error: result.error ?? null,
    }).then(resolve, reject)
  return builder
}

function makeAuditBuilder() {
  const builder: Record<string, unknown> = {}
  builder.insert = vi.fn().mockResolvedValue({ error: null })
  return builder
}

function setupClient(builders: Record<string, unknown>[], userId = 'admin-1') {
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

describe('member actions — membership guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the existing unauthenticated error for role assignment', async () => {
    const from = vi.fn()
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
      from,
    })

    await expect(assignRole('group-1', 'user-1', 'moderator')).resolves.toEqual({
      error: 'Not authenticated.',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('returns the existing unauthenticated error for kicking members', async () => {
    const from = vi.fn()
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
      from,
    })

    await expect(kickMember('group-1', 'user-1')).resolves.toEqual({
      error: 'Not authenticated.',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('keeps the shared predicate denial for non-admin role assignment callers', async () => {
    const caller = makeSingleBuilder({ data: { role: 'moderator' } })
    const target = makeSingleBuilder({ data: { role: 'user' } })
    setupClient([caller, target])

    await expect(assignRole('group-1', 'user-1', 'noob')).resolves.toEqual({
      error: 'Only admins can assign roles.',
    })
    expect(target.single).not.toHaveBeenCalled()
  })

  it('does not assign a role when the caller targets themself', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const mutation = makeMutationBuilder()
    setupClient([caller, mutation])

    await expect(assignRole('group-1', 'admin-1', 'moderator')).resolves.toEqual({
      error: 'You cannot change your own role.',
    })

    expect(mutation.update).not.toHaveBeenCalled()
  })

  it('does not let non-owner admins grant the admin role', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'owner-x' } })
    const mutation = makeMutationBuilder()
    setupClient([caller, ownerLookup, mutation])

    await expect(assignRole('group-1', 'user-1', 'admin')).resolves.toEqual({
      error: 'Only the owner can grant the admin role.',
    })

    expect(mutation.update).not.toHaveBeenCalled()
  })

  it('lets the owner grant the admin role', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'admin-1' } })
    const target = makeSingleBuilder({ data: { role: 'user' } })
    const mutation = makeMutationBuilder()
    const audit = makeAuditBuilder()
    setupClient([caller, ownerLookup, target, mutation, audit])

    await expect(assignRole('group-1', 'user-1', 'admin')).resolves.toEqual({ ok: true })
    expect(mutation.update).toHaveBeenCalledWith({ role: 'admin' })
  })

  it("refuses to change the owner's role", async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'user-1' } })
    const mutation = makeMutationBuilder()
    setupClient([caller, ownerLookup, mutation])

    await expect(assignRole('group-1', 'user-1', 'moderator')).resolves.toEqual({
      error: "The owner's role cannot be changed. Transfer ownership instead.",
    })

    expect(mutation.update).not.toHaveBeenCalled()
  })

  it('does not assign a role when the target member is missing', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'owner-x' } })
    const target = makeSingleBuilder({ data: null })
    const mutation = makeMutationBuilder()
    setupClient([caller, ownerLookup, target, mutation])

    await expect(assignRole('group-1', 'missing-user', 'moderator')).resolves.toEqual({
      error: 'Target member was not found.',
    })

    expect(mutation.update).not.toHaveBeenCalled()
  })

  it('does not let non-owner admins demote another admin', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'owner-x' } })
    const target = makeSingleBuilder({ data: { role: 'admin' } })
    const mutation = makeMutationBuilder()
    setupClient([caller, ownerLookup, target, mutation])

    await expect(assignRole('group-1', 'target-admin-1', 'moderator')).resolves.toEqual({
      error: 'Only the owner can change an admin\'s role.',
    })

    expect(mutation.update).not.toHaveBeenCalled()
  })

  it('lets the owner demote another admin', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'admin-1' } })
    const target = makeSingleBuilder({ data: { role: 'admin' } })
    const mutation = makeMutationBuilder()
    const audit = makeAuditBuilder()
    setupClient([caller, ownerLookup, target, mutation, audit])

    await expect(assignRole('group-1', 'target-admin-1', 'moderator')).resolves.toEqual({ ok: true })
    expect(mutation.update).toHaveBeenCalledWith({ role: 'moderator' })
  })

  it('reports an error when the update matches zero rows (RLS block)', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'admin-1' } })
    const target = makeSingleBuilder({ data: { role: 'admin' } })
    const mutation = makeMutationBuilder({ data: [] })
    setupClient([caller, ownerLookup, target, mutation])

    await expect(assignRole('group-1', 'target-admin-1', 'user')).resolves.toEqual({
      error: 'The role change was blocked. No changes were made.',
    })
  })

  it('updates a member role using group and user filters', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'owner-x' } })
    const target = makeSingleBuilder({ data: { role: 'user' } })
    const mutation = makeMutationBuilder()
    const audit = makeAuditBuilder()
    setupClient([caller, ownerLookup, target, mutation, audit])

    await expect(assignRole('group-1', 'user-1', 'moderator')).resolves.toEqual({ ok: true })

    expect(mutation.update).toHaveBeenCalledWith({ role: 'moderator' })
    expect(mutation.eq).toHaveBeenCalledWith('group_id', 'group-1')
    expect(mutation.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('does not kick a member when the caller targets themself', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const mutation = makeMutationBuilder()
    setupClient([caller, mutation])

    await expect(kickMember('group-1', 'admin-1')).resolves.toEqual({
      error: 'Use "Leave Group" to remove yourself.',
    })

    expect(mutation.delete).not.toHaveBeenCalled()
  })

  it.each([
    { targetRole: 'admin', targetUserId: 'target-admin-1' },
    { targetRole: 'moderator', targetUserId: 'target-mod-1' },
  ] as const)(
    'does not kick a $targetRole when the caller is a moderator',
    async ({ targetRole, targetUserId }) => {
      const caller = makeSingleBuilder({ data: { role: 'moderator' } })
      const target = makeSingleBuilder({ data: { role: targetRole } })
      const mutation = makeMutationBuilder()
      setupClient([caller, target, mutation], 'mod-1')

      await expect(kickMember('group-1', targetUserId)).resolves.toEqual({
        error: 'Moderators can only kick users and noobs.',
      })

      expect(mutation.delete).not.toHaveBeenCalled()
    },
  )

  it('does not let non-owner admins kick another admin', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const target = makeSingleBuilder({ data: { role: 'admin' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'owner-x' } })
    const mutation = makeMutationBuilder()
    setupClient([caller, target, ownerLookup, mutation])

    await expect(kickMember('group-1', 'target-admin-1')).resolves.toEqual({
      error: 'Only the owner can kick an admin.',
    })

    expect(mutation.delete).not.toHaveBeenCalled()
  })

  it('never kicks the group owner', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const target = makeSingleBuilder({ data: { role: 'admin' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'target-admin-1' } })
    const mutation = makeMutationBuilder()
    setupClient([caller, target, ownerLookup, mutation])

    await expect(kickMember('group-1', 'target-admin-1')).resolves.toEqual({
      error: 'The group owner cannot be kicked.',
    })

    expect(mutation.delete).not.toHaveBeenCalled()
  })

  it('lets the owner kick an admin', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const target = makeSingleBuilder({ data: { role: 'admin' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'admin-1' } })
    const mutation = makeMutationBuilder()
    const audit = makeAuditBuilder()
    setupClient([caller, target, ownerLookup, mutation, audit])

    await expect(kickMember('group-1', 'target-admin-1')).resolves.toEqual({ ok: true })
    expect(mutation.delete).toHaveBeenCalled()
  })

  it('does not kick a member when the target member is missing', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const target = makeSingleBuilder({ data: null })
    const mutation = makeMutationBuilder()
    setupClient([caller, target, mutation])

    await expect(kickMember('group-1', 'missing-user')).resolves.toEqual({
      error: 'Target member was not found.',
    })

    expect(mutation.delete).not.toHaveBeenCalled()
  })

  it('surfaces caller membership lookup errors before assigning roles', async () => {
    const caller = makeSingleBuilder({ error: { message: 'Membership lookup failed' } })
    const target = makeSingleBuilder({ data: { role: 'user' } })
    const mutation = makeMutationBuilder()
    setupClient([caller, target, mutation])

    await expect(assignRole('group-1', 'user-1', 'moderator')).resolves.toEqual({
      error: 'Membership lookup failed',
    })

    expect(mutation.update).not.toHaveBeenCalled()
  })

  it('surfaces target membership lookup errors before kicking members', async () => {
    const caller = makeSingleBuilder({ data: { role: 'moderator' } })
    const target = makeSingleBuilder({ error: { message: 'Target lookup failed' } })
    const mutation = makeMutationBuilder()
    setupClient([caller, target, mutation])

    await expect(kickMember('group-1', 'user-1')).resolves.toEqual({
      error: 'Target lookup failed',
    })

    expect(mutation.delete).not.toHaveBeenCalled()
  })

  it('audits successful role assignments', async () => {
    const caller = makeSingleBuilder({ data: { role: 'admin' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'owner-x' } })
    const target = makeSingleBuilder({ data: { role: 'user' } })
    const mutation = makeMutationBuilder()
    const audit = makeAuditBuilder()
    setupClient([caller, ownerLookup, target, mutation, audit])

    await expect(assignRole('group-1', 'user-1', 'moderator')).resolves.toEqual({ ok: true })

    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      admin_id: 'admin-1',
      action: 'member_role_changed',
      target_type: 'user',
      target_id: 'user-1',
      metadata: {
        group_id: 'group-1',
        from_role: 'user',
        to_role: 'moderator',
      },
    }))
  })

  it('deletes a kicked member using group and user filters', async () => {
    const caller = makeSingleBuilder({ data: { role: 'moderator' } })
    const target = makeSingleBuilder({ data: { role: 'noob' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'owner-x' } })
    const mutation = makeMutationBuilder()
    const audit = makeAuditBuilder()
    setupClient([caller, target, ownerLookup, mutation, audit], 'mod-1')

    await expect(kickMember('group-1', 'user-1')).resolves.toEqual({ ok: true })

    expect(mutation.delete).toHaveBeenCalled()
    expect(mutation.eq).toHaveBeenCalledWith('group_id', 'group-1')
    expect(mutation.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('audits successful member kicks', async () => {
    const caller = makeSingleBuilder({ data: { role: 'moderator' } })
    const target = makeSingleBuilder({ data: { role: 'noob' } })
    const ownerLookup = makeSingleBuilder({ data: { owner_id: 'owner-x' } })
    const mutation = makeMutationBuilder()
    const audit = makeAuditBuilder()
    setupClient([caller, target, ownerLookup, mutation, audit], 'mod-1')

    await expect(kickMember('group-1', 'user-1')).resolves.toEqual({ ok: true })

    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      admin_id: 'mod-1',
      action: 'member_kicked',
      target_type: 'user',
      target_id: 'user-1',
      metadata: {
        group_id: 'group-1',
        actor_role: 'moderator',
        target_role: 'noob',
      },
    }))
  })
})
