// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'
import { createMiddlewareClient } from '@/lib/supabase/middleware'

const { mockCreateServerClient } = vi.hoisted(() => ({ mockCreateServerClient: vi.fn() }))

vi.mock('@supabase/ssr', () => ({
  createServerClient: mockCreateServerClient,
}))

function makeRequest(path: string) {
  return new NextRequest(new URL(path, 'https://sidebar.test'))
}

function makeProfileBuilder(profile: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({ data: profile, error: null })
  return builder
}

function setupSupabase(userId: string | null, profile: unknown = { id: userId }, hasPendingClaim = false) {
  const profileBuilder = makeProfileBuilder(profile)
  const from = vi.fn(() => profileBuilder)
  const rpc = vi.fn().mockResolvedValue({ data: hasPendingClaim, error: null })
  const signOut = vi.fn().mockResolvedValue({ error: null })

  mockCreateServerClient.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null }, error: null }),
      signOut,
    },
    from,
    rpc,
  })

  return { from, profileBuilder, rpc, signOut }
}

describe('middleware invite-only gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows unauthenticated public join links to render invite landing', async () => {
    setupSupabase(null)

    const response = await middleware(makeRequest('/join/invite-123'))

    expect(response.headers.get('location')).toBeNull()
  })

  it('redirects unauthenticated protected app routes to login with next', async () => {
    setupSupabase(null)

    const response = await middleware(makeRequest('/channels/abc'))

    expect(response.headers.get('location')).toBe('https://sidebar.test/login?next=%2Fchannels%2Fabc')
  })

  it('redirects authenticated users without profiles and pending claims to setup with current path', async () => {
    const { rpc } = setupSupabase('user-1', null, true)

    const response = await middleware(makeRequest('/channels?dm=conversation-1'))

    expect(rpc).toHaveBeenCalledWith('user_has_pending_account_invite_claim', { p_auth_user_id: 'user-1' })
    expect(response.headers.get('location')).toBe(
      'https://sidebar.test/setup-profile?next=%2Fchannels%3Fdm%3Dconversation-1',
    )
  })

  it('signs out authenticated users without profiles and pending claims', async () => {
    const { signOut } = setupSupabase('user-1', null, false)

    const response = await middleware(makeRequest('/setup-profile'))

    expect(signOut).toHaveBeenCalled()
    expect(response.headers.get('location')).toBe('https://sidebar.test/login?invite_required=1')
  })

  it('sends authenticated login visitors with profiles to a safe next path', async () => {
    setupSupabase('user-1')

    const response = await middleware(makeRequest('/login?next=/join/invite-123'))

    expect(response.headers.get('location')).toBe('https://sidebar.test/join/invite-123')
  })

  it('preserves query strings on safe next paths', async () => {
    setupSupabase('user-1')

    const response = await middleware(makeRequest('/login?next=/channels?dm=conversation-1'))

    expect(response.headers.get('location')).toBe('https://sidebar.test/channels?dm=conversation-1')
  })

  it.each(['//evil.example', '/join\\evil'])('ignores unsafe next paths for authenticated login visitors: %s', async next => {
    setupSupabase('user-1')

    const response = await middleware(makeRequest(`/login?next=${encodeURIComponent(next)}`))

    expect(response.headers.get('location')).toBe('https://sidebar.test/channels')
  })
})

describe('middleware Supabase factory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mutates request cookies, rebinds the response, and preserves response cookie options', () => {
    const request = makeRequest('/channels')
    const { getResponse } = createMiddlewareClient(request)
    const initialResponse = getResponse()

    const cookieAdapter = mockCreateServerClient.mock.calls[0]?.[2]?.cookies
    expect(cookieAdapter.getAll()).toEqual([])

    cookieAdapter.setAll([
      {
        name: 'sb-session',
        value: 'refreshed-token',
        options: { path: '/', httpOnly: true, sameSite: 'lax' as const },
      },
    ])

    const reboundResponse = getResponse()
    expect(request.cookies.get('sb-session')?.value).toBe('refreshed-token')
    expect(reboundResponse).not.toBe(initialResponse)
    expect(reboundResponse.cookies.get('sb-session')).toEqual(
      expect.objectContaining({ name: 'sb-session', value: 'refreshed-token', path: '/', httpOnly: true, sameSite: 'lax' }),
    )
  })
})
