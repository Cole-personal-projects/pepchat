import { describe, expect, it, beforeEach, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import JoinPage from '@/app/join/[code]/page'

const {
  mockConsumeInvite,
  mockCreateClaim,
  mockCreateClient,
  mockInviteLookupClient,
  mockRedirect,
  mockResolveInvite,
} = vi.hoisted(() => ({
  mockConsumeInvite: vi.fn(),
  mockCreateClaim: vi.fn(),
  mockCreateClient: vi.fn(),
  mockInviteLookupClient: vi.fn((client: unknown) => client),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
  mockResolveInvite: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }))
vi.mock('@/lib/invites/lookupClient', () => ({ inviteLookupClient: mockInviteLookupClient }))
vi.mock('@/lib/invites/accountClaims', () => ({ createOrReplaceAccountInviteClaim: mockCreateClaim }))
vi.mock('@/lib/invites', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/invites')>()),
  consumeInvite: mockConsumeInvite,
  resolveInvite: mockResolveInvite,
}))
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

const root = process.cwd()

const managedInvite = {
  kind: 'managed' as const,
  groupId: 'group-1',
  invite: {
    id: 'invite-1',
    group_id: 'group-1',
    code: 'valid-code',
    created_by: 'admin-1',
    max_uses: null,
    uses_count: 0,
    expires_at: null,
    revoked_at: null,
    created_at: new Date(0).toISOString(),
  },
}

function makeSupabase({
  user = null,
  profile = null,
}: {
  user?: { id: string; email?: string } | null
  profile?: { id: string } | null
} = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from: vi.fn((table: string) => {
      if (table !== 'profiles') throw new Error(`unexpected table:${table}`)
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: profile }),
      }
    }),
  }
}

async function renderJoinPage(code = 'valid-code') {
  const element = await JoinPage({ params: { code } })
  render(element)
}

describe('public join route placement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveInvite.mockResolvedValue({ ok: true, invite: managedInvite })
    mockConsumeInvite.mockResolvedValue({ ok: true, groupId: 'group-1', joined: true })
    mockCreateClaim.mockResolvedValue({ ok: true, claim: { id: 'claim-1' }, groupId: 'group-1' })
    mockCreateClient.mockResolvedValue(makeSupabase())
  })

  it('keeps /join/[code] outside the authenticated app route group', () => {
    expect(existsSync(join(root, 'app/join/[code]/page.tsx'))).toBe(true)
    expect(existsSync(join(root, 'app/(app)/join/[code]/page.tsx'))).toBe(false)
  })

  it('renders invite-aware auth links for anonymous valid managed invites', async () => {
    await renderJoinPage('valid-code')

    expect(screen.getByText('You have been invited to SideBar')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/signup?invite=valid-code&next=%2Fjoin%2Fvalid-code',
    )
    expect(screen.getByRole('link', { name: 'Log in instead' })).toHaveAttribute(
      'href',
      '/login?invite=valid-code&next=%2Fjoin%2Fvalid-code',
    )
    expect(mockResolveInvite).toHaveBeenCalledWith(
      expect.anything(),
      'valid-code',
      expect.objectContaining({ mode: 'account_signup' }),
    )
  })

  it('renders the generic closed state for invalid anonymous invites', async () => {
    mockResolveInvite.mockResolvedValue({ ok: false, reason: 'not_found', message: 'Invalid invite code.' })

    await renderJoinPage('bad-code')

    expect(screen.getByText('Invite not found')).toBeInTheDocument()
    expect(screen.getByText('This invite is no longer valid. Ask an admin for a fresh link.')).toBeInTheDocument()
  })

  it('rejects legacy invite codes for anonymous new-account bootstrap', async () => {
    mockResolveInvite.mockResolvedValue({
      ok: false,
      reason: 'legacy_not_allowed',
      message: 'This invite link is no longer accepted for new accounts. Ask an admin for a fresh invite.',
    })

    await renderJoinPage('legacy-code')

    expect(screen.getByText('Fresh invite needed')).toBeInTheDocument()
    expect(
      screen.getByText('This invite link is no longer accepted for new accounts. Ask an admin for a fresh invite.'),
    ).toBeInTheDocument()
  })

  it('creates an account invite claim for authenticated profile-less users opening a valid invite', async () => {
    mockCreateClient.mockResolvedValue(makeSupabase({ user: { id: 'user-1', email: 'u@example.com' }, profile: null }))

    await expect(JoinPage({ params: { code: 'valid-code' } })).rejects.toThrow(
      'redirect:/setup-profile?next=%2Fjoin%2Fvalid-code',
    )

    expect(mockCreateClaim).toHaveBeenCalledWith({
      inviteCode: 'valid-code',
      authUserId: 'user-1',
      email: 'u@example.com',
    })
    expect(mockRedirect).not.toHaveBeenCalledWith('/login?invite_required=1')
  })

  it('fails closed if a claimable invite cannot be claimed before setup', async () => {
    mockCreateClient.mockResolvedValue(makeSupabase({ user: { id: 'user-1', email: 'u@example.com' }, profile: null }))
    mockCreateClaim.mockResolvedValue({ error: 'max uses reached' })

    await renderJoinPage('valid-code')

    expect(screen.getByText('Invite expired')).toBeInTheDocument()
    expect(screen.getByText('This invite is no longer valid. Ask an admin for a fresh link.')).toBeInTheDocument()
  })

  it('keeps profiled-user group joining compatible with managed invites', async () => {
    mockCreateClient.mockResolvedValue(makeSupabase({ user: { id: 'user-1', email: 'u@example.com' }, profile: { id: 'user-1' } }))

    await expect(JoinPage({ params: { code: 'valid-code' } })).rejects.toThrow('redirect:/groups/group-1')

    expect(mockResolveInvite).toHaveBeenCalledWith(
      expect.anything(),
      'valid-code',
      expect.objectContaining({ mode: 'group_join' }),
    )
    expect(mockConsumeInvite).toHaveBeenCalledWith(expect.anything(), managedInvite, 'user-1')
    expect(mockCreateClaim).not.toHaveBeenCalled()
  })

  it('does not rely only on source-text assertions for invite flow coverage', () => {
    const source = readFileSync(join(root, 'app/join/[code]/page.tsx'), 'utf8')
    expect(source).toContain('createOrReplaceAccountInviteClaim')
    expect(source).not.toContain("redirect('/login?invite_required=1')")
  })
})
