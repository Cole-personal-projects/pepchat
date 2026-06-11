import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { completeOnboarding, saveOnboardingConfig } from '@/app/(app)/onboarding/actions'

const { mockCreateClient, mockCreateAdminClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mockCreateAdminClient }))

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null }
type Builder = Record<string, ReturnType<typeof vi.fn>>

function makeMaybeSingleBuilder(result: QueryResult): Builder {
  const builder: Builder = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  return builder
}

function makeInListBuilder(result: QueryResult): Builder {
  const builder: Builder = {}
  const resolved = Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
  builder.select = vi.fn(() => builder)
  builder.in = vi.fn(() => builder)
  ;(builder as Record<string, unknown>).then = resolved.then.bind(resolved)
  return builder
}

function makeUpsertBuilder(result: QueryResult = {}): Builder {
  const builder: Builder = {}
  builder.upsert = vi.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }))
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

const ORIGINAL_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
})

afterAll(() => {
  if (ORIGINAL_SERVICE_ROLE_KEY !== undefined) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_ROLE_KEY
  }
})

describe('saveOnboardingConfig', () => {
  it('requires rules text before enabling', async () => {
    setupClient([])
    await expect(saveOnboardingConfig('grp-1', { enabled: true, rulesText: '  ' })).resolves.toEqual({
      error: 'Add rules text before enabling onboarding.',
    })
  })

  it('denies users without onboarding or group management bits', async () => {
    setupClient([], { hasPermission: false })
    await expect(saveOnboardingConfig('grp-1', { enabled: false, rulesText: 'Be kind' })).resolves.toEqual({
      error: 'You do not have permission to manage onboarding.',
    })
  })

  it('upserts config for managers', async () => {
    const upsert = makeUpsertBuilder()
    setupClient([upsert])

    await expect(saveOnboardingConfig('grp-1', { enabled: true, rulesText: 'Be kind' })).resolves.toEqual({ ok: true })
    expect(upsert.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ group_id: 'grp-1', enabled: true, rules_text: 'Be kind' }),
      { onConflict: 'group_id' },
    )
  })
})

describe('completeOnboarding', () => {
  it('rejects when onboarding is disabled', async () => {
    setupClient([
      makeMaybeSingleBuilder({ data: { group_id: 'grp-1', enabled: false } }),
    ])

    await expect(completeOnboarding('grp-1', [])).resolves.toEqual({
      error: 'Onboarding is not enabled for this server.',
    })
  })

  it('rejects answers from other groups', async () => {
    setupClient([
      makeMaybeSingleBuilder({ data: { group_id: 'grp-1', enabled: true } }),
      makeInListBuilder({ data: [{ id: 'opt-1', question_id: 'q-1', onboarding_questions: { group_id: 'grp-other' } }] }),
    ])

    await expect(completeOnboarding('grp-1', ['opt-1'])).resolves.toEqual({ error: 'Invalid onboarding answers.' })
  })

  function makeAdminClient(builders: Builder[]) {
    let index = 0
    const from = vi.fn(() => {
      const builder = builders[index]
      index += 1
      if (!builder) throw new Error('Missing admin mock builder')
      return builder
    })
    mockCreateAdminClient.mockReturnValue({ from })
    return { from }
  }

  function makeUpdateBuilder(result: QueryResult = {}): Builder {
    const builder: Builder = {}
    const resolved = Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
    builder.update = vi.fn(() => builder)
    builder.eq = vi.fn(() => builder)
    ;(builder as Record<string, unknown>).then = resolved.then.bind(resolved)
    return builder
  }

  function setupCompletionClient() {
    const progressUpsert = makeUpsertBuilder()
    const responsesUpsert = makeUpsertBuilder()
    setupClient([
      makeMaybeSingleBuilder({ data: { group_id: 'grp-1', enabled: true } }),
      makeInListBuilder({ data: [{ id: 'opt-1', question_id: 'q-1', onboarding_questions: { group_id: 'grp-1' } }] }),
      makeInListBuilder({ data: [{ role_id: 'role-1' }] }),
      progressUpsert,
      responsesUpsert,
    ])
    return { progressUpsert }
  }

  it('records completion and responses, granting roles via the admin client', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    const { progressUpsert } = setupCompletionClient()

    const adminRoles = makeInListBuilder({
      data: [{ id: 'role-1', group_id: 'grp-1', name: 'group-buy', is_default: false }],
    })
    const adminUpsert = makeUpsertBuilder()
    makeAdminClient([adminRoles, adminUpsert])

    await expect(completeOnboarding('grp-1', ['opt-1'])).resolves.toEqual({ ok: true })

    expect(progressUpsert.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ group_id: 'grp-1', user_id: 'user-1' }),
      { onConflict: 'group_id,user_id' },
    )
    expect(adminUpsert.upsert).toHaveBeenCalledWith(
      [{ group_id: 'grp-1', user_id: 'user-1', role_id: 'role-1' }],
      { onConflict: 'role_id,user_id', ignoreDuplicates: true },
    )
  })

  it('promotes noobs to the member level when the Member template is granted', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    setupCompletionClient()

    const adminRoles = makeInListBuilder({
      data: [{ id: 'role-1', group_id: 'grp-1', name: 'Member', is_default: false }],
    })
    const adminUpsert = makeUpsertBuilder()
    const levelUpdate = makeUpdateBuilder()
    makeAdminClient([adminRoles, adminUpsert, levelUpdate])

    await expect(completeOnboarding('grp-1', ['opt-1'])).resolves.toEqual({ ok: true })

    expect(levelUpdate.update).toHaveBeenCalledWith({ role: 'user' })
    expect(levelUpdate.eq).toHaveBeenCalledWith('user_id', 'user-1')
    // Only noobs get promoted — moderators/admins are untouched.
    expect(levelUpdate.eq).toHaveBeenCalledWith('role', 'noob')
  })

  it('never grants staff roles from stale onboarding configs', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    setupCompletionClient()

    const adminRoles = makeInListBuilder({
      data: [{ id: 'role-1', group_id: 'grp-1', name: 'Admin', is_default: false }],
    })
    const adminUpsert = makeUpsertBuilder()
    const admin = makeAdminClient([adminRoles, adminUpsert])

    await expect(completeOnboarding('grp-1', ['opt-1'])).resolves.toEqual({ ok: true })

    expect(adminUpsert.upsert).not.toHaveBeenCalled()
    // Only the roles lookup ran on the admin client.
    expect(admin.from).toHaveBeenCalledTimes(1)
  })
})
