import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGroup, joinGroup, leaveGroup, listGroupInvites, regenerateGroupInvite, removeGroupIcon, revokeGroupInvite, updateGroupDetails, uploadGroupIcon } from '@/app/(app)/groups/actions'
import { PERMISSIONS } from '@/lib/permissions'

const { mockCreateClient, mockCreateAdminClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))

type QueryResult = { data?: unknown; error?: { message: string } | null }

function makeInsertSelectBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  builder.insert = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  return builder
}

function makeInsertBuilder(result: QueryResult = {}) {
  const builder: Record<string, unknown> = {}
  builder.insert = vi.fn(() => Promise.resolve({
    data: result.data ?? null,
    error: result.error ?? null,
  }))
  return builder
}

function makeAuditBuilder() {
  const builder: Record<string, unknown> = {}
  builder.insert = vi.fn().mockResolvedValue({ error: null })
  return builder
}

function makeSelectBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  return builder
}

function makeDeleteBuilder(result: QueryResult = {}) {
  const builder: Record<string, unknown> = {}
  builder.delete = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve, reject)
  return builder
}

function makeUpdateBuilder(result: QueryResult = {}) {
  const builder: Record<string, unknown> = {}
  const resolved = Promise.resolve({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  builder.update = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.then = resolved.then.bind(resolved)
  return builder
}

function makeOrderedSelectBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  const resolved = Promise.resolve({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  builder.then = resolved.then.bind(resolved)
  return builder
}

function setupClient(builders: Record<string, unknown>[], options: {
  storage?: Record<string, unknown>
  userId?: string | null
  rpcResult?: QueryResult
} = {}) {
  let index = 0
  const from = vi.fn(() => {
    const builder = builders[index]
    index += 1
    return builder
  })
  const rpcBuilder = makeSelectBuilder(options.rpcResult ?? {})
  const rpc = vi.fn(() => rpcBuilder)

  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.userId === null ? null : { id: options.userId ?? 'user-1' } },
        error: null,
      }),
    },
    from,
    rpc,
    storage: options.storage,
  })

  return { from, rpc, rpcBuilder }
}

function setupAdminClient(builders: Record<string, unknown>[]) {
  let index = 0
  const from = vi.fn(() => {
    const builder = builders[index]
    index += 1
    return builder
  })

  mockCreateAdminClient.mockReturnValue({ from })
  return { from }
}

function groupForm(name = 'Test Group') {
  const formData = new FormData()
  formData.set('name', name)
  return formData
}

function groupDetailsForm(name = 'Updated Group', description = 'Updated description') {
  const formData = new FormData()
  formData.set('name', name)
  formData.set('description', description)
  return formData
}

describe('group actions — createGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces member seed errors after creating a group', async () => {
    const group = makeInsertSelectBuilder({ data: { id: 'group-1' } })
    const member = makeInsertBuilder({ error: { message: 'Member seed failed' } })
    const channels = makeInsertBuilder()
    setupClient([group, member, channels])

    await expect(createGroup(groupForm())).resolves.toEqual({
      error: 'Member seed failed',
    })

    expect(channels.insert).not.toHaveBeenCalled()
  })

  it('surfaces channel seed errors after creating a group member', async () => {
    const group = makeInsertSelectBuilder({ data: { id: 'group-1' } })
    const member = makeInsertBuilder()
    const channels = makeInsertBuilder({ error: { message: 'Channel seed failed' } })
    setupClient([group, member, channels])

    await expect(createGroup(groupForm())).resolves.toEqual({
      error: 'Channel seed failed',
    })
  })
})

describe('group actions — joinGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('joins through an active managed invite and records usage for new members', async () => {
    const invite = makeSelectBuilder({ data: { id: 'invite-1', group_id: 'group-1', code: 'managed', max_uses: null, uses_count: 0, expires_at: null, revoked_at: null, created_at: '2026-05-16T00:00:00.000Z', created_by: 'admin-1' } })
    const existing = makeSelectBuilder({ data: null })
    const formData = new FormData()
    formData.set('invite_code', 'https://sidebar.test/join/managed?x=1')
    const { rpc } = setupClient([invite, existing], { rpcResult: { data: { group_id: 'group-1', joined: true } } })

    await expect(joinGroup(formData)).resolves.toEqual({ redirectTo: '/groups/group-1' })
    expect(rpc).toHaveBeenCalledWith('consume_managed_group_invite', { p_invite_code: 'managed' })
  })

  it('falls back to legacy invites when no managed row exists', async () => {
    const managed = makeSelectBuilder({ data: null })
    const legacy = makeSelectBuilder({ data: { id: 'legacy-group' } })
    const existing = makeSelectBuilder({ data: null })
    const formData = new FormData()
    formData.set('invite_code', 'legacy-code')
    const { rpc } = setupClient([managed, legacy, existing], { rpcResult: { data: { group_id: 'legacy-group', joined: true } } })

    await expect(joinGroup(formData)).resolves.toEqual({ redirectTo: '/groups/legacy-group' })
    expect(rpc).toHaveBeenCalledWith('consume_legacy_group_invite', { p_invite_code: 'legacy-code' })
  })

  it('does not add usage for existing members', async () => {
    const invite = makeSelectBuilder({ data: { id: 'invite-1', group_id: 'group-1', code: 'managed', max_uses: null, uses_count: 0, expires_at: null, revoked_at: null, created_at: '2026-05-16T00:00:00.000Z', created_by: 'admin-1' } })
    const existing = makeSelectBuilder({ data: { id: 'member-1' } })
    const formData = new FormData()
    formData.set('invite_code', 'managed')
    const { from } = setupClient([invite, existing])

    await expect(joinGroup(formData)).resolves.toEqual({ redirectTo: '/groups/group-1' })
    expect(from).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid and unusable managed invites with existing messages', async () => {
    const invalidForm = new FormData()
    invalidForm.set('invite_code', 'missing')
    setupClient([makeSelectBuilder({ data: null }), makeSelectBuilder({ data: null })])
    await expect(joinGroup(invalidForm)).resolves.toEqual({ error: 'Invalid invite code.' })

    const unusableForm = new FormData()
    unusableForm.set('invite_code', 'revoked')
    setupClient([makeSelectBuilder({ data: { id: 'invite-1', group_id: 'group-1', code: 'revoked', max_uses: null, uses_count: 0, expires_at: null, revoked_at: '2026-05-16T00:00:00.000Z', created_at: '2026-05-16T00:00:00.000Z', created_by: 'admin-1' } })])
    await expect(joinGroup(unusableForm)).resolves.toEqual({ error: 'Invite link has expired or reached its usage limit.' })
  })

  it('uses the service-role lookup to block RLS-hidden revoked managed invites before legacy fallback', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    const formData = new FormData()
    formData.set('invite_code', 'overlap')
    const userScoped = setupClient([])
    setupAdminClient([makeSelectBuilder({ data: { id: 'invite-1', group_id: 'group-1', code: 'overlap', max_uses: null, uses_count: 0, expires_at: null, revoked_at: '2026-05-16T00:00:00.000Z', created_at: '2026-05-16T00:00:00.000Z', created_by: 'admin-1' } })])

    await expect(joinGroup(formData)).resolves.toEqual({ error: 'Invite link has expired or reached its usage limit.' })
    expect(userScoped.from).not.toHaveBeenCalled()
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })
})

describe('group actions — leaveGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces membership delete errors before redirecting', async () => {
    const membership = makeSelectBuilder({ data: { role: 'user' } })
    const deletion = makeDeleteBuilder({ error: { message: 'Leave failed' } })
    setupClient([membership, deletion])

    await expect(leaveGroup('group-1')).resolves.toEqual({
      error: 'Leave failed',
    })
  })
})

describe('group actions — updateGroupDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated users', async () => {
    setupClient([], { userId: null })

    await expect(updateGroupDetails('group-1', groupDetailsForm())).resolves.toEqual({
      error: 'Not authenticated.',
    })
  })

  it('rejects empty group names', async () => {
    const membership = makeSelectBuilder({ data: { role: 'admin' } })
    setupClient([membership])

    await expect(updateGroupDetails('group-1', groupDetailsForm('   '))).resolves.toEqual({
      error: 'Group name is required.',
    })
  })

  it('updates group name and description for admins', async () => {
    const membership = makeSelectBuilder({ data: { role: 'admin' } })
    const update = makeUpdateBuilder()
    const audit = makeAuditBuilder()
    setupClient([membership, update, audit])

    await expect(updateGroupDetails('group-1', groupDetailsForm())).resolves.toEqual({ ok: true })

    expect(update.update).toHaveBeenCalledWith({
      name: 'Updated Group',
      description: 'Updated description',
    })
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      admin_id: 'user-1',
      action: 'group_details_updated',
      target_type: 'group',
      target_id: 'group-1',
    }))
  })

  it('rejects insufficient roles with the existing message', async () => {
    const membership = makeSelectBuilder({ data: { role: 'user' } })
    setupClient([membership])

    await expect(updateGroupDetails('group-1', groupDetailsForm())).resolves.toEqual({
      error: 'Only group admins can update group details.',
    })
  })

  it('clears blank descriptions', async () => {
    const membership = makeSelectBuilder({ data: { role: 'admin' } })
    const update = makeUpdateBuilder()
    const audit = makeAuditBuilder()
    setupClient([membership, update, audit])

    await expect(updateGroupDetails('group-1', groupDetailsForm('Updated Group', '   '))).resolves.toEqual({ ok: true })

    expect(update.update).toHaveBeenCalledWith({
      name: 'Updated Group',
      description: null,
    })
  })
})

describe('group actions — regenerateGroupInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated users', async () => {
    setupClient([], { userId: null })

    await expect(regenerateGroupInvite('group-1')).resolves.toEqual({
      error: 'Not authenticated.',
    })
  })

  it('rejects non-admin users', async () => {
    const membership = makeSelectBuilder({ data: { role: 'user' } })
    setupClient([membership])

    await expect(regenerateGroupInvite('group-1')).resolves.toEqual({
      error: 'Only group admins can regenerate invite links.',
    })
  })

  it('rejects moderators even though the UI invite predicate allows them', async () => {
    expect(PERMISSIONS.canGenerateInvite('moderator')).toBe(true)
    const membership = makeSelectBuilder({ data: { role: 'moderator' } })
    setupClient([membership])

    await expect(regenerateGroupInvite('group-1')).resolves.toEqual({
      error: 'Only group admins can regenerate invite links.',
    })
  })

  it('updates the group invite code for admins', async () => {
    const membership = makeSelectBuilder({ data: { role: 'admin' } })
    const inviteInsert = makeInsertSelectBuilder({
      data: {
        id: 'invite-1',
        code: 'abc123abc123',
        group_id: 'group-1',
        created_by: 'user-1',
        max_uses: null,
        uses_count: 0,
        expires_at: null,
        revoked_at: null,
        created_at: '2026-05-09T00:00:00.000Z',
      },
    })
    const update = makeUpdateBuilder()
    const audit = makeAuditBuilder()
    setupClient([membership, inviteInsert, update, audit])

    const result = await regenerateGroupInvite('group-1')

    expect(result).toMatchObject({ ok: true })
    if ('invite_code' in result) expect(result.invite_code).toHaveLength(12)
    expect(inviteInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      group_id: 'group-1',
      created_by: 'user-1',
      code: expect.stringMatching(/^[a-f0-9]{12}$/),
      max_uses: null,
      expires_at: null,
    }))
    expect(update.update).toHaveBeenCalledWith({
      invite_code: expect.stringMatching(/^[a-f0-9]{12}$/),
    })
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'invite_regenerated',
      target_type: 'invite',
      target_id: 'invite-1',
      metadata: expect.objectContaining({ group_id: 'group-1' }),
    }))
  })

  it('creates limited expiring invites for admins', async () => {
    const membership = makeSelectBuilder({ data: { role: 'admin' } })
    const inviteInsert = makeInsertSelectBuilder({ data: { id: 'invite-1', code: 'abc123abc123' } })
    const update = makeUpdateBuilder()
    const audit = makeAuditBuilder()
    const formData = new FormData()
    formData.set('max_uses', '3')
    formData.set('expires_at', '2099-01-01T00:00')
    setupClient([membership, inviteInsert, update, audit])

    await expect(regenerateGroupInvite('group-1', formData)).resolves.toMatchObject({ ok: true })

    expect(inviteInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      max_uses: 3,
      expires_at: expect.any(String),
    }))
  })
})

describe('group actions — invite management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists invites and usage for admins', async () => {
    const membership = makeSelectBuilder({ data: { role: 'admin' } })
    const invites = makeOrderedSelectBuilder({ data: [{ id: 'invite-1', code: 'abc' }] })
    const uses = makeOrderedSelectBuilder({ data: [{ id: 'use-1' }] })
    setupClient([membership, invites, uses])

    await expect(listGroupInvites('group-1')).resolves.toEqual({
      ok: true,
      invites: [{ id: 'invite-1', code: 'abc' }],
      uses: [{ id: 'use-1' }],
    })
  })

  it('rejects non-admin invite history access with the existing message', async () => {
    const membership = makeSelectBuilder({ data: { role: 'moderator' } })
    setupClient([membership])

    await expect(listGroupInvites('group-1')).resolves.toEqual({
      error: 'Only group admins can view invite history.',
    })
  })

  it('revokes invites for admins and rotates mirrored legacy codes', async () => {
    const membership = makeSelectBuilder({ data: { role: 'admin' } })
    const inviteLookup = makeSelectBuilder({ data: { code: 'managed-code' } })
    const revokeUpdate = makeUpdateBuilder()
    const groupLookup = makeSelectBuilder({ data: { invite_code: 'managed-code' } })
    const legacyUpdate = makeUpdateBuilder()
    const audit = makeAuditBuilder()
    setupClient([membership, inviteLookup, revokeUpdate, groupLookup, legacyUpdate, audit])

    await expect(revokeGroupInvite('invite-1', 'group-1')).resolves.toEqual({ ok: true })

    expect(revokeUpdate.update).toHaveBeenCalledWith({
      revoked_at: expect.any(String),
    })
    expect(legacyUpdate.update).toHaveBeenCalledWith({
      invite_code: expect.stringMatching(/^[a-f0-9]{12}$/),
    })
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'invite_revoked',
      target_type: 'invite',
      target_id: 'invite-1',
      metadata: { group_id: 'group-1' },
    }))
  })

  it('preserves different legacy codes when revoking managed invites', async () => {
    const membership = makeSelectBuilder({ data: { role: 'admin' } })
    const inviteLookup = makeSelectBuilder({ data: { code: 'managed-code' } })
    const revokeUpdate = makeUpdateBuilder()
    const groupLookup = makeSelectBuilder({ data: { invite_code: 'legacy-code' } })
    const audit = makeAuditBuilder()
    const { from } = setupClient([membership, inviteLookup, revokeUpdate, groupLookup, audit])

    await expect(revokeGroupInvite('invite-1', 'group-1')).resolves.toEqual({ ok: true })
    expect(from).toHaveBeenCalledTimes(5)
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({ action: 'invite_revoked' }))
  })

  it('rejects non-admin invite revocation with the existing message', async () => {
    const membership = makeSelectBuilder({ data: { role: 'moderator' } })
    setupClient([membership])

    await expect(revokeGroupInvite('invite-1', 'group-1')).resolves.toEqual({
      error: 'Only group admins can revoke invites.',
    })
  })
})

describe('group actions — uploadGroupIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects insufficient roles with the existing message', async () => {
    const membership = makeSelectBuilder({ data: { role: 'user' } })
    setupClient([membership])

    await expect(uploadGroupIcon('group-1', {
      dataUrl: 'data:image/png;base64,aWNvbg==',
      ext: 'png',
    })).resolves.toEqual({
      error: 'Only group admins can update the group photo.',
    })
  })
})

describe('group actions — removeGroupIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces storage list errors before updating the group', async () => {
    const membership = makeSelectBuilder({ data: { role: 'admin' } })
    const update = makeUpdateBuilder()
    const avatars = {
      list: vi.fn().mockResolvedValue({ data: null, error: { message: 'List failed' } }),
      remove: vi.fn(),
    }
    const storage = { from: vi.fn(() => avatars) }
    setupClient([membership, update], { storage })

    await expect(removeGroupIcon('group-1')).resolves.toEqual({
      error: 'List failed',
    })

    expect(update.update).not.toHaveBeenCalled()
  })

  it('rejects insufficient roles with the existing message', async () => {
    const membership = makeSelectBuilder({ data: { role: 'user' } })
    setupClient([membership])

    await expect(removeGroupIcon('group-1')).resolves.toEqual({
      error: 'Only group admins can remove the group photo.',
    })
  })

  it('surfaces storage remove errors before clearing the group icon', async () => {
    const membership = makeSelectBuilder({ data: { role: 'admin' } })
    const update = makeUpdateBuilder()
    const avatars = {
      list: vi.fn().mockResolvedValue({ data: [{ name: 'icon.png' }], error: null }),
      remove: vi.fn().mockResolvedValue({ error: { message: 'Remove failed' } }),
    }
    const storage = { from: vi.fn(() => avatars) }
    setupClient([membership, update], { storage })

    await expect(removeGroupIcon('group-1')).resolves.toEqual({
      error: 'Remove failed',
    })

    expect(avatars.remove).toHaveBeenCalledWith(['groups/group-1/icon.png'])
    expect(update.update).not.toHaveBeenCalled()
  })
})
