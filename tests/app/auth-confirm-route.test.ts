import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/auth/confirm/route'
import { createClient } from '@/lib/supabase/server'
import { userHasPendingAccountInviteClaim } from '@/lib/invites/accountClaims'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/invites/accountClaims', () => ({ userHasPendingAccountInviteClaim: vi.fn() }))

const mockCreateClient = vi.mocked(createClient)
const mockHasPendingClaim = vi.mocked(userHasPendingAccountInviteClaim)

function makeRequest(path: string) {
  return new NextRequest(new URL(path, 'https://sidebar.test'))
}

function setupSupabase({
  verifyError = null,
  user = { id: 'user-1' },
  profile = null,
}: {
  verifyError?: { message: string } | null
  user?: { id: string } | null
  profile?: { id: string } | null
} = {}) {
  const profileBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: profile }),
  }
  const signOut = vi.fn().mockResolvedValue({ error: null })
  const supabase = {
    auth: {
      verifyOtp: vi.fn().mockResolvedValue({ error: verifyError }),
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
      signOut,
    },
    from: vi.fn((table: string) => {
      if (table !== 'profiles') throw new Error(`unexpected table:${table}`)
      return profileBuilder
    }),
  }

  mockCreateClient.mockResolvedValue(supabase as never)
  return { supabase, profileBuilder, signOut }
}

describe('/auth/confirm invite gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasPendingClaim.mockResolvedValue(false)
  })

  it('redirects existing profiled users to a safe next path after OTP verification', async () => {
    setupSupabase({ profile: { id: 'user-1' } })

    const response = await GET(makeRequest('/auth/confirm?token_hash=hash&type=email&next=/dm/123'))

    expect(response.headers.get('location')).toBe('https://sidebar.test/dm/123')
    expect(mockHasPendingClaim).not.toHaveBeenCalled()
  })

  it('redirects profile-less users with pending account invite claims to setup-profile', async () => {
    const { supabase } = setupSupabase({ profile: null })
    mockHasPendingClaim.mockResolvedValue(true)

    const response = await GET(makeRequest('/auth/confirm?token_hash=hash&type=email&next=/join/abc'))

    expect(mockHasPendingClaim).toHaveBeenCalledWith(supabase, 'user-1')
    expect(response.headers.get('location')).toBe('https://sidebar.test/setup-profile?next=%2Fjoin%2Fabc')
  })

  it('signs out claimless profile-less confirmed users and fails closed', async () => {
    const { signOut } = setupSupabase({ profile: null })
    mockHasPendingClaim.mockResolvedValue(false)

    const response = await GET(makeRequest('/auth/confirm?token_hash=hash&type=email&next=/channels'))

    expect(signOut).toHaveBeenCalled()
    expect(response.headers.get('location')).toBe('https://sidebar.test/login?invite_required=1')
  })

  it('falls back to /channels for unsafe next paths', async () => {
    setupSupabase({ profile: { id: 'user-1' } })

    const response = await GET(makeRequest('/auth/confirm?token_hash=hash&type=email&next=//evil.test'))

    expect(response.headers.get('location')).toBe('https://sidebar.test/channels')
  })

  it('redirects invalid or failed OTP confirmations to login error', async () => {
    setupSupabase({ verifyError: { message: 'bad token' } })

    const response = await GET(makeRequest('/auth/confirm?token_hash=hash&type=email'))

    expect(response.headers.get('location')).toBe('https://sidebar.test/login?error=invalid_link')
  })
})
