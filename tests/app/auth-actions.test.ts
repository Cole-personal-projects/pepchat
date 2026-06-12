import { beforeEach, describe, expect, it, vi } from 'vitest'
import { login, setupProfile, signup } from '@/app/(auth)/actions'

const {
  mockCreateClient,
  mockResolveInvite,
  mockInviteLookupClient,
  mockHasPendingClaim,
  mockCreateClaim,
  mockCompleteProfile,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockResolveInvite: vi.fn(),
  mockInviteLookupClient: vi.fn((client: unknown) => client),
  mockHasPendingClaim: vi.fn(),
  mockCreateClaim: vi.fn(),
  mockCompleteProfile: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: (key: string) => (key === 'origin' ? 'https://sidebar.test' : null) }),
}))
vi.mock('@/lib/invites/lookupClient', () => ({ inviteLookupClient: mockInviteLookupClient }))
vi.mock('@/lib/invites/accountClaims', () => ({
  userHasPendingAccountInviteClaim: mockHasPendingClaim,
  createOrReplaceAccountInviteClaim: mockCreateClaim,
  completeAccountInviteProfile: mockCompleteProfile,
}))
vi.mock('@/lib/invites', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/invites')>()),
  resolveInvite: mockResolveInvite,
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))

type QueryResult = { data?: unknown; error?: { message: string } | null }

function makeSelectBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  return builder
}

function setupClient(builders: unknown[], userId: string | null = 'user-1') {
  let index = 0
  const from = vi.fn(() => builders[index++])
  const signUp = vi.fn().mockResolvedValue({ data: { user: { id: 'new-user', identities: [{}] } }, error: null })
  const signOut = vi.fn().mockResolvedValue({ error: null })

  mockCreateClient.mockResolvedValue({
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signUp,
      signOut,
      getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
    from,
  })

  return { from, signUp, signOut }
}

function loginForm(next?: string) {
  const formData = new FormData()
  formData.set('email', 'user@example.com')
  formData.set('password', 'password')
  if (next) formData.set('next', next)
  return formData
}

function signupForm(invite?: string) {
  const formData = new FormData()
  formData.set('email', 'user@example.com')
  formData.set('password', 'password')
  if (invite) formData.set('invite', invite)
  return formData
}

function profileForm(username = 'alice', next?: string) {
  const formData = new FormData()
  formData.set('username', username)
  if (next) formData.set('next', next)
  return formData
}

const managedInvite = {
  ok: true,
  invite: {
    kind: 'managed',
    groupId: 'group-1',
    invite: { id: 'invite-1', group_id: 'group-1' },
  },
}

describe('auth actions — invite-only gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveInvite.mockResolvedValue(managedInvite)
    mockHasPendingClaim.mockResolvedValue(true)
    mockCreateClaim.mockResolvedValue({ ok: true, groupId: 'group-1', claim: { id: 'claim-1' } })
    mockCompleteProfile.mockResolvedValue({ ok: true, groupId: 'group-1' })
  })

  it('signup without invite returns invite-required and does not call signUp', async () => {
    const { signUp } = setupClient([])

    await expect(signup(signupForm())).resolves.toEqual({ error: 'A valid invite is required to create an account.' })

    expect(signUp).not.toHaveBeenCalled()
  })

  it('signup revalidates the invite before creating a user and pending claim', async () => {
    const { signUp } = setupClient([])

    await expect(signup(signupForm('managed-code'))).resolves.toEqual({ email: 'user@example.com' })

    expect(mockResolveInvite).toHaveBeenCalledWith(expect.anything(), 'managed-code', expect.objectContaining({ mode: 'account_signup' }))
    expect(signUp).toHaveBeenCalledWith({ email: 'user@example.com', password: 'password' })
    expect(mockCreateClaim).toHaveBeenCalledWith({ inviteCode: 'managed-code', authUserId: 'new-user', email: 'user@example.com' })
  })

  it('duplicate-email fake-success does not create an invite claim', async () => {
    const { signUp } = setupClient([])
    signUp.mockResolvedValueOnce({ data: { user: { id: 'existing', identities: [] } }, error: null })

    await expect(signup(signupForm('managed-code'))).resolves.toEqual({ error: 'An account with that email already exists.' })

    expect(mockCreateClaim).not.toHaveBeenCalled()
  })

  it('redirects existing profiled users to a safe next path', async () => {
    setupClient([makeSelectBuilder({ data: { id: 'user-1' } })])

    await expect(login(loginForm('/join/invite-123'))).rejects.toThrow('redirect:/join/invite-123')
  })

  it('does not redirect to unsafe external next paths', async () => {
    setupClient([makeSelectBuilder({ data: { id: 'user-1' } })])

    await expect(login(loginForm('//evil.example'))).rejects.toThrow('redirect:/channels')
  })

  it('redirects no-profile login users with pending claims to setup', async () => {
    setupClient([makeSelectBuilder({ data: null })])

    await expect(login(loginForm('/join/invite-123'))).rejects.toThrow(
      'redirect:/setup-profile?next=%2Fjoin%2Finvite-123',
    )
  })

  it('signs out no-profile login users without pending claims', async () => {
    mockHasPendingClaim.mockResolvedValueOnce(false)
    const { signOut } = setupClient([makeSelectBuilder({ data: null })])

    await expect(login(loginForm('/channels'))).resolves.toEqual({ error: 'An invite is required to finish account setup.' })
    expect(signOut).toHaveBeenCalled()
  })

  it('setupProfile without a pending claim fails closed', async () => {
    mockHasPendingClaim.mockResolvedValueOnce(false)
    setupClient([])

    await expect(setupProfile(profileForm('alice'))).resolves.toEqual({ error: 'An invite is required to finish account setup.' })
    expect(mockCompleteProfile).not.toHaveBeenCalled()
  })

  it('setupProfile with a pending claim calls atomic completion and redirects to safe next', async () => {
    setupClient([makeSelectBuilder({ data: null })])

    await expect(setupProfile(profileForm('alice', '/join/invite-123'))).rejects.toThrow('redirect:/join/invite-123')
    expect(mockCompleteProfile).toHaveBeenCalledWith(expect.anything(), 'alice')
  })

  it('setupProfile defaults to the invited group after atomic completion', async () => {
    setupClient([makeSelectBuilder({ data: null })])

    await expect(setupProfile(profileForm('alice'))).rejects.toThrow('redirect:/groups/group-1')
  })
})

describe('password reset actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function resetForm(email: string) {
    const form = new FormData()
    form.set('email', email)
    return form
  }

  function passwordForm(password: string, confirm: string) {
    const form = new FormData()
    form.set('password', password)
    form.set('confirm', confirm)
    return form
  }

  it('requestPasswordReset sends a recovery email pointing at the reset page', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null })
    mockCreateClient.mockResolvedValue({ auth: { resetPasswordForEmail } } as never)

    const { requestPasswordReset } = await import('@/app/(auth)/actions')
    await expect(requestPasswordReset(resetForm('cole@example.com'))).resolves.toEqual({ ok: true })

    const [email, options] = resetPasswordForEmail.mock.calls[0]
    expect(email).toBe('cole@example.com')
    expect(options.redirectTo).toContain('/auth/confirm?next=%2Freset-password')
  })

  it('requestPasswordReset gives the same answer for unknown emails (no enumeration)', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: { message: 'user not found' } })
    mockCreateClient.mockResolvedValue({ auth: { resetPasswordForEmail } } as never)

    const { requestPasswordReset } = await import('@/app/(auth)/actions')
    await expect(requestPasswordReset(resetForm('nobody@example.com'))).resolves.toEqual({ ok: true })
  })

  it('requestPasswordReset rejects malformed emails', async () => {
    const { requestPasswordReset } = await import('@/app/(auth)/actions')
    await expect(requestPasswordReset(resetForm('not-an-email'))).resolves.toEqual({
      error: 'Enter the email you signed up with.',
    })
  })

  it('updatePassword enforces length and match', async () => {
    const { updatePassword } = await import('@/app/(auth)/actions')
    await expect(updatePassword(passwordForm('short', 'short'))).resolves.toEqual({
      error: 'Password must be at least 8 characters.',
    })
    await expect(updatePassword(passwordForm('longenough1', 'different1'))).resolves.toEqual({
      error: 'Passwords do not match.',
    })
  })

  it('updatePassword rejects expired recovery sessions', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)

    const { updatePassword } = await import('@/app/(auth)/actions')
    await expect(updatePassword(passwordForm('longenough1', 'longenough1'))).resolves.toEqual({
      error: 'This reset link has expired. Request a new one from the login page.',
    })
  })

  it('updatePassword saves and enters the app', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null })
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
        updateUser,
      },
    } as never)

    const { updatePassword } = await import('@/app/(auth)/actions')
    await expect(updatePassword(passwordForm('longenough1', 'longenough1'))).rejects.toThrow('redirect:/channels')
    expect(updateUser).toHaveBeenCalledWith({ password: 'longenough1' })
  })
})
