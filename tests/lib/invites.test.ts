import { describe, expect, it, vi } from 'vitest'
import {
  consumeInvite,
  generateInviteCode,
  inviteIsUsable,
  listInvites,
  normalizeInviteCode,
  parseInviteOptions,
  regenerateInvite,
  resolveInvite,
  revokeInvite,
  type InviteRecord,
} from '@/lib/invites'

type QueryResult = { data?: unknown; error?: { message: string } | null }

type Call = { method: string; args: unknown[] }

function builder(result: QueryResult = {}) {
  const calls: Call[] = []
  const promise = Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
  const api: Record<string, unknown> = {
    calls,
    select: vi.fn((...args: unknown[]) => { calls.push({ method: 'select', args }); return api }),
    insert: vi.fn((...args: unknown[]) => { calls.push({ method: 'insert', args }); return api }),
    update: vi.fn((...args: unknown[]) => { calls.push({ method: 'update', args }); return api }),
    eq: vi.fn((...args: unknown[]) => { calls.push({ method: 'eq', args }); return api }),
    order: vi.fn((...args: unknown[]) => { calls.push({ method: 'order', args }); return api }),
    limit: vi.fn((...args: unknown[]) => { calls.push({ method: 'limit', args }); return api }),
    single: vi.fn(() => promise),
    maybeSingle: vi.fn(() => promise),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
  return api
}

function client(builders: Record<string, unknown>[], rpcResult: QueryResult = {}) {
  let index = 0
  const rpcBuilder = builder(rpcResult)
  return {
    from: vi.fn(() => builders[index++]),
    rpc: vi.fn(() => rpcBuilder),
    rpcBuilder,
  }
}

function form(values: Record<string, string>) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(values)) formData.set(key, value)
  return formData
}

function invite(overrides: Partial<InviteRecord> = {}): InviteRecord {
  return {
    id: 'invite-1',
    group_id: 'group-1',
    code: 'managed-code',
    created_by: 'admin-1',
    max_uses: null,
    uses_count: 0,
    expires_at: null,
    revoked_at: null,
    created_at: '2026-05-16T00:00:00.000Z',
    ...overrides,
  }
}

describe('invite helpers', () => {
  it('generates 12-character hex invite codes', () => {
    expect(generateInviteCode()).toMatch(/^[a-f0-9]{12}$/)
  })

  it('normalizes raw codes and join URLs', () => {
    expect(normalizeInviteCode(' invite-123 ')).toBe('invite-123')
    expect(normalizeInviteCode('/join/invite-123')).toBe('invite-123')
    expect(normalizeInviteCode('https://sidebar.test/join/invite-123?next=/x#hash')).toBe('invite-123')
    expect(normalizeInviteCode('/join/invite%20123')).toBe('invite 123')
  })

  it('parses empty and valid invite options', () => {
    expect(parseInviteOptions()).toEqual({ max_uses: null, expires_at: null })
    const result = parseInviteOptions(form({ max_uses: '3', expires_at: '2099-01-01T00:00' }))
    expect(result).toMatchObject({ max_uses: 3, expires_at: expect.any(String) })
  })

  it.each(['0', '-1', '1.5', '1001', 'abc'])('rejects invalid max uses %s', value => {
    expect(parseInviteOptions(form({ max_uses: value }))).toEqual({ error: 'Usage limit must be between 1 and 1000.' })
  })

  it('rejects invalid or past expiry', () => {
    expect(parseInviteOptions(form({ expires_at: 'not-a-date' }))).toEqual({ error: 'Expiration date is invalid.' })
    expect(parseInviteOptions(form({ expires_at: '2000-01-01T00:00' }))).toEqual({ error: 'Expiration date must be in the future.' })
  })

  it('evaluates managed invite usability', () => {
    const now = Date.parse('2026-05-16T00:00:00.000Z')
    expect(inviteIsUsable({ revoked_at: null, expires_at: null, max_uses: null, uses_count: 0 }, now)).toBe(true)
    expect(inviteIsUsable({ revoked_at: '2026-05-15T00:00:00.000Z', expires_at: null, max_uses: null, uses_count: 0 }, now)).toBe(false)
    expect(inviteIsUsable({ revoked_at: null, expires_at: '2026-05-16T00:00:00.000Z', max_uses: null, uses_count: 0 }, now)).toBe(false)
    expect(inviteIsUsable({ revoked_at: null, expires_at: null, max_uses: 2, uses_count: 2 }, now)).toBe(false)
  })
})

describe('resolveInvite', () => {
  it('returns missing_code without querying', async () => {
    const supabase = client([])
    await expect(resolveInvite(supabase as any, '   ')).resolves.toEqual({ ok: false, reason: 'missing_code', message: 'Invite code is required.' })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('uses authoritative managed lookup and lets active managed invite win over legacy overlap', async () => {
    const managed = builder({ data: invite() })
    const userScoped = client([])
    const authoritative = client([managed])

    await expect(resolveInvite(userScoped as any, 'managed-code', { authoritativeSupabase: authoritative as any })).resolves.toEqual({
      ok: true,
      invite: { kind: 'managed', invite: invite(), groupId: 'group-1' },
    })
    expect(authoritative.from).toHaveBeenCalledWith('group_invites')
    expect(userScoped.from).not.toHaveBeenCalled()
  })

  it('falls back to legacy when no managed row exists', async () => {
    const managed = builder({ data: null })
    const legacy = builder({ data: { id: 'group-legacy' } })
    const supabase = client([managed, legacy])

    await expect(resolveInvite(supabase as any, 'legacy-code')).resolves.toEqual({
      ok: true,
      invite: { kind: 'legacy', code: 'legacy-code', groupId: 'group-legacy' },
    })
  })

  it('returns not_found when neither managed nor legacy exists', async () => {
    const supabase = client([builder({ data: null }), builder({ data: null })])
    await expect(resolveInvite(supabase as any, 'missing')).resolves.toEqual({ ok: false, reason: 'not_found', message: 'Invalid invite code.' })
  })

  it.each([
    ['revoked', invite({ revoked_at: '2026-05-15T00:00:00.000Z' })],
    ['expired', invite({ expires_at: '2026-05-15T00:00:00.000Z' })],
    ['exhausted', invite({ max_uses: 1, uses_count: 1 })],
  ])('treats %s managed invites as unusable and authoritative', async (_name, managedInvite) => {
    const supabase = client([builder({ data: managedInvite })])
    await expect(resolveInvite(supabase as any, managedInvite.code, { now: Date.parse('2026-05-16T00:00:00.000Z') })).resolves.toEqual({
      ok: false,
      reason: 'unusable',
      message: 'Invite link has expired or reached its usage limit.',
    })
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('detects RLS-hidden revoked managed rows using authoritativeSupabase and does not accept matching legacy fallback', async () => {
    const authoritative = client([builder({ data: invite({ revoked_at: '2026-05-15T00:00:00.000Z', code: 'overlap' }) })])
    const userScoped = client([builder({ data: null }), builder({ data: { id: 'group-legacy' } })])

    await expect(resolveInvite(userScoped as any, 'overlap', {
      authoritativeSupabase: authoritative as any,
      now: Date.parse('2026-05-16T00:00:00.000Z'),
    })).resolves.toEqual({ ok: false, reason: 'unusable', message: 'Invite link has expired or reached its usage limit.' })
    expect(userScoped.from).not.toHaveBeenCalled()
  })

  it('account-signup mode rejects legacy invite codes for new account bootstrap', async () => {
    const managed = builder({ data: null })
    const legacy = builder({ data: { id: 'group-legacy' } })
    const supabase = client([managed, legacy])

    await expect(resolveInvite(supabase as any, 'legacy-code', { mode: 'account_signup' })).resolves.toEqual({
      ok: false,
      reason: 'legacy_not_allowed',
      message: 'This invite link is no longer accepted for new accounts. Ask an admin for a fresh invite.',
    })
  })

  it('account-signup mode requires the invite creator to still be group owner or admin', async () => {
    const managedInvite = invite({ created_by: 'former-admin' })
    const managed = builder({ data: managedInvite })
    const group = builder({ data: { owner_id: 'owner-1' } })
    const membership = builder({ data: { role: 'moderator' } })
    const supabase = client([managed, group, membership])

    await expect(resolveInvite(supabase as any, 'managed-code', { mode: 'account_signup' })).resolves.toEqual({
      ok: false,
      reason: 'creator_not_allowed',
      message: 'This invite is no longer valid. Ask an admin for a fresh link.',
    })
  })

  it('account-signup mode accepts managed invites created by current group owners', async () => {
    const managedInvite = invite({ created_by: 'owner-1' })
    const managed = builder({ data: managedInvite })
    const group = builder({ data: { owner_id: 'owner-1' } })
    const supabase = client([managed, group])

    await expect(resolveInvite(supabase as any, 'managed-code', { mode: 'account_signup' })).resolves.toEqual({
      ok: true,
      invite: { kind: 'managed', invite: managedInvite, groupId: 'group-1' },
    })
  })

})

describe('consumeInvite', () => {
  it('does not insert or increment usage for existing members', async () => {
    const existing = builder({ data: { id: 'member-1' } })
    const supabase = client([existing])

    await expect(consumeInvite(supabase as any, { kind: 'managed', invite: invite({ uses_count: 4 }), groupId: 'group-1' }, 'user-1')).resolves.toEqual({
      ok: true,
      groupId: 'group-1',
      joined: false,
    })
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('uses the atomic legacy invite RPC for new legacy members', async () => {
    const membershipLookup = builder({ data: null })
    const supabase = client([membershipLookup], { data: { group_id: 'group-1', joined: true } })

    await expect(consumeInvite(supabase as any, { kind: 'legacy', code: 'legacy', groupId: 'group-1' }, 'user-1')).resolves.toEqual({ ok: true, groupId: 'group-1', joined: true })
    expect(supabase.rpc).toHaveBeenCalledWith('consume_legacy_group_invite', { p_invite_code: 'legacy' })
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('uses the atomic managed invite RPC so membership, usage, and counts are one transaction', async () => {
    const membershipLookup = builder({ data: null })
    const supabase = client([membershipLookup], { data: { group_id: 'group-1', joined: true } })

    await expect(consumeInvite(supabase as any, { kind: 'managed', invite: invite({ uses_count: 2 }), groupId: 'group-1' }, 'user-1')).resolves.toEqual({ ok: true, groupId: 'group-1', joined: true })
    expect(supabase.rpc).toHaveBeenCalledWith('consume_managed_group_invite', { p_invite_code: 'managed-code' })
  })

  it('returns atomic invite consumption errors', async () => {
    const supabase = client([builder({ data: null })], { error: { message: 'invite exhausted' } })
    await expect(consumeInvite(supabase as any, { kind: 'managed', invite: invite(), groupId: 'group-1' }, 'user-1')).resolves.toEqual({ ok: false, message: 'invite exhausted' })
  })
})

describe('invite management operations', () => {
  it('regenerateInvite inserts a managed invite and propagates insert errors', async () => {
    const insert = builder({ data: invite({ code: 'abc123abc123' }) })
    const supabase = client([insert])
    const result = await regenerateInvite(supabase as any, { groupId: 'group-1', createdBy: 'user-1', options: { max_uses: 5, expires_at: '2099-01-01T00:00:00.000Z' } })
    expect(result).toMatchObject({ ok: true, invite: invite({ code: 'abc123abc123' }) })
    if ('invite_code' in result) expect(result.invite_code).toMatch(/^[a-f0-9]{12}$/)
    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ group_id: 'group-1', created_by: 'user-1', code: expect.stringMatching(/^[a-f0-9]{12}$/), max_uses: 5 }))

    const failing = client([builder({ error: { message: 'insert failed' } })])
    await expect(regenerateInvite(failing as any, { groupId: 'group-1', createdBy: 'user-1', options: { max_uses: null, expires_at: null } })).resolves.toEqual({ error: 'insert failed' })
  })

  it('listInvites returns ordered invites and usage and propagates errors', async () => {
    const invites = builder({ data: [invite()] })
    const uses = builder({ data: [{ id: 'use-1' }] })
    const supabase = client([invites, uses])
    await expect(listInvites(supabase as any, 'group-1')).resolves.toEqual({ ok: true, invites: [invite()], uses: [{ id: 'use-1' }] })
    expect(invites.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(uses.order).toHaveBeenCalledWith('used_at', { ascending: false })
    expect(uses.limit).toHaveBeenCalledWith(25)

    await expect(listInvites(client([builder({ error: { message: 'list failed' } })]) as any, 'group-1')).resolves.toEqual({ error: 'list failed' })
    await expect(listInvites(client([builder({ data: [] }), builder({ error: { message: 'uses failed' } })]) as any, 'group-1')).resolves.toEqual({ error: 'uses failed' })
  })

  it('revokeInvite filters by invite and group and rotates mirrored legacy codes only', async () => {
    const lookup = builder({ data: { code: 'managed-code' } })
    const revoke = builder()
    const legacyLookup = builder({ data: { invite_code: 'managed-code' } })
    const legacyUpdate = builder()
    const supabase = client([lookup, revoke, legacyLookup, legacyUpdate])

    await expect(revokeInvite(supabase as any, { inviteId: 'invite-1', groupId: 'group-1' })).resolves.toEqual({ ok: true })
    expect(revoke.update).toHaveBeenCalledWith({ revoked_at: expect.any(String) })
    expect(revoke.eq).toHaveBeenCalledWith('id', 'invite-1')
    expect(revoke.eq).toHaveBeenCalledWith('group_id', 'group-1')
    expect(legacyUpdate.update).toHaveBeenCalledWith({ invite_code: expect.stringMatching(/^[a-f0-9]{12}$/) })

    const preserved = client([builder({ data: { code: 'managed-code' } }), builder(), builder({ data: { invite_code: 'legacy-code' } })])
    await expect(revokeInvite(preserved as any, { inviteId: 'invite-1', groupId: 'group-1' })).resolves.toEqual({ ok: true })
    expect(preserved.from).toHaveBeenCalledTimes(3)
  })

  it('revokeInvite propagates lookup, revoke, and legacy mirror update errors', async () => {
    await expect(revokeInvite(client([builder({ error: { message: 'lookup failed' } })]) as any, { inviteId: 'invite-1', groupId: 'group-1' })).resolves.toEqual({ error: 'lookup failed' })
    await expect(revokeInvite(client([builder({ data: { code: 'managed-code' } }), builder({ error: { message: 'revoke failed' } })]) as any, { inviteId: 'invite-1', groupId: 'group-1' })).resolves.toEqual({ error: 'revoke failed' })
    await expect(revokeInvite(client([builder({ data: { code: 'managed-code' } }), builder(), builder({ data: { invite_code: 'managed-code' } }), builder({ error: { message: 'legacy failed' } })]) as any, { inviteId: 'invite-1', groupId: 'group-1' })).resolves.toEqual({ error: 'legacy failed' })
  })
})
