import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assignMemberRole,
  createRole,
  deleteRole,
  moveRole,
  removeMemberRole,
  updateRole,
} from '@/app/(app)/roles/actions'

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

function makeOrderedListBuilder(result: QueryResult): Builder {
  const builder: Builder = {}
  const resolved = Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  ;(builder as Record<string, unknown>).then = resolved.then.bind(resolved)
  return builder
}

function makeInsertSelectBuilder(result: QueryResult): Builder {
  const builder: Builder = {}
  builder.insert = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
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

function setupClient(builders: Builder[], options: { hasPermission?: boolean; userId?: string | null } = {}) {
  let index = 0
  const from = vi.fn(() => {
    const builder = builders[index]
    index += 1
    if (!builder) throw new Error('Missing mock builder')
    return builder
  })
  const rpc = vi.fn().mockResolvedValue({ data: options.hasPermission ?? true, error: null })

  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.userId === null ? null : { id: options.userId ?? 'user-1' } },
        error: null,
      }),
    },
    from,
    rpc,
  })

  return { from, rpc }
}

function roleForm(name: string, groupId = 'grp-1') {
  const formData = new FormData()
  formData.set('name', name)
  formData.set('group_id', groupId)
  return formData
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createRole', () => {
  it('denies callers without MANAGE_ROLES', async () => {
    setupClient([], { hasPermission: false })

    await expect(createRole(roleForm('VIP'))).resolves.toEqual({
      error: 'You do not have permission to manage roles.',
    })
  })

  it('gates via the has_permission RPC with the MANAGE_ROLES bit', async () => {
    const { rpc } = setupClient([
      makeOrderedListBuilder({ data: [{ position: 3, permissions: 50944, is_default: false }, { position: 0, permissions: 50944, is_default: true }] }),
      makeInsertSelectBuilder({ data: { id: 'role-new' } }),
    ])

    await expect(createRole(roleForm('VIP'))).resolves.toEqual({ ok: true, roleId: 'role-new' })

    expect(rpc).toHaveBeenCalledWith('has_permission', {
      p_group_id: 'grp-1',
      p_channel_id: null,
      p_bit: '4',
      p_user_id: 'user-1',
    })
  })

  it('seeds permissions from @everyone and appends at the top position', async () => {
    const insert = makeInsertSelectBuilder({ data: { id: 'role-new' } })
    setupClient([
      makeOrderedListBuilder({ data: [{ position: 3, permissions: 1, is_default: false }, { position: 0, permissions: 50944, is_default: true }] }),
      insert,
    ])

    await createRole(roleForm('VIP'))

    expect(insert.insert).toHaveBeenCalledWith({
      group_id: 'grp-1',
      name: 'VIP',
      position: 4,
      permissions: '50944',
    })
  })

  it('rejects the reserved @everyone name', async () => {
    setupClient([])
    await expect(createRole(roleForm('@everyone'))).resolves.toEqual({ error: 'That role name is reserved.' })
  })
})

describe('updateRole', () => {
  it('refuses to rename @everyone', async () => {
    setupClient([
      makeSelectBuilder({ data: { id: 'role-1', group_id: 'grp-1', is_default: true } }),
    ])

    await expect(updateRole('role-1', { name: 'Everyone Else' })).resolves.toEqual({
      error: 'The @everyone role cannot be renamed.',
    })
  })

  it('validates hex colors', async () => {
    setupClient([
      makeSelectBuilder({ data: { id: 'role-1', group_id: 'grp-1', is_default: false } }),
    ])

    await expect(updateRole('role-1', { color: 'red' })).resolves.toEqual({
      error: 'Role color must be a hex value like #5865f2.',
    })
  })

  it('stores permissions as an exact string', async () => {
    const update = makeUpdateBuilder()
    setupClient([
      makeSelectBuilder({ data: { id: 'role-1', group_id: 'grp-1', is_default: false } }),
      update,
    ])

    await expect(updateRole('role-1', { permissions: '4194296' })).resolves.toEqual({ ok: true })
    expect(update.update).toHaveBeenCalledWith({ permissions: '4194296' })
  })

  it('updates identity fields together', async () => {
    const update = makeUpdateBuilder()
    setupClient([
      makeSelectBuilder({ data: { id: 'role-1', group_id: 'grp-1', is_default: false } }),
      update,
    ])

    await expect(updateRole('role-1', { name: ' VIP  Crew ', color: '#ff0000', hoist: true, mentionable: false })).resolves.toEqual({ ok: true })
    expect(update.update).toHaveBeenCalledWith({
      name: 'VIP Crew',
      color: '#ff0000',
      hoist: true,
      mentionable: false,
    })
  })
})

describe('deleteRole', () => {
  it('protects the default role', async () => {
    setupClient([
      makeSelectBuilder({ data: { id: 'role-1', group_id: 'grp-1', is_default: true } }),
    ])

    await expect(deleteRole('role-1')).resolves.toEqual({ error: 'The @everyone role cannot be deleted.' })
  })

  it('deletes custom roles for managers', async () => {
    const del = makeDeleteBuilder()
    setupClient([
      makeSelectBuilder({ data: { id: 'role-1', group_id: 'grp-1', is_default: false } }),
      del,
    ])

    await expect(deleteRole('role-1')).resolves.toEqual({ ok: true })
    expect(del.delete).toHaveBeenCalled()
  })
})

describe('moveRole', () => {
  it('swaps positions among custom roles only', async () => {
    const first = makeUpdateBuilder()
    const second = makeUpdateBuilder()
    setupClient([
      makeSelectBuilder({ data: { id: 'role-1', group_id: 'grp-1', position: 1, is_default: false } }),
      makeOrderedListBuilder({ data: [{ id: 'role-1', position: 1 }, { id: 'role-2', position: 2 }] }),
      first,
      second,
    ])

    await expect(moveRole('role-1', 'up')).resolves.toEqual({ ok: true })
    expect(first.update).toHaveBeenCalledWith({ position: 2 })
    expect(second.update).toHaveBeenCalledWith({ position: 1 })
  })

  it('rejects moving @everyone', async () => {
    setupClient([
      makeSelectBuilder({ data: { id: 'role-1', group_id: 'grp-1', position: 0, is_default: true } }),
    ])

    await expect(moveRole('role-1', 'up')).resolves.toEqual({ error: 'The @everyone role cannot be reordered.' })
  })
})

describe('member role assignment', () => {
  it('assigns a role within the same group', async () => {
    const insert = makeInsertBuilder()
    setupClient([
      makeSelectBuilder({ data: { id: 'role-1', group_id: 'grp-1', is_default: false } }),
      insert,
    ])

    await expect(assignMemberRole('grp-1', 'user-2', 'role-1')).resolves.toEqual({ ok: true })
    expect(insert.insert).toHaveBeenCalledWith({ group_id: 'grp-1', user_id: 'user-2', role_id: 'role-1' })
  })

  it('treats duplicate assignment as success', async () => {
    setupClient([
      makeSelectBuilder({ data: { id: 'role-1', group_id: 'grp-1', is_default: false } }),
      makeInsertBuilder({ error: { message: 'duplicate', code: '23505' } }),
    ])

    await expect(assignMemberRole('grp-1', 'user-2', 'role-1')).resolves.toEqual({ ok: true })
  })

  it('rejects roles from another group', async () => {
    setupClient([
      makeSelectBuilder({ data: { id: 'role-1', group_id: 'grp-other', is_default: false } }),
    ])

    await expect(assignMemberRole('grp-1', 'user-2', 'role-1')).resolves.toEqual({ error: 'Role not found.' })
  })

  it('removes role assignments', async () => {
    const del = makeDeleteBuilder()
    setupClient([del])

    await expect(removeMemberRole('grp-1', 'user-2', 'role-1')).resolves.toEqual({ ok: true })
    expect(del.eq).toHaveBeenCalledWith('group_id', 'grp-1')
    expect(del.eq).toHaveBeenCalledWith('user_id', 'user-2')
    expect(del.eq).toHaveBeenCalledWith('role_id', 'role-1')
  })
})
