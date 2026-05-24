import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChannelPage from '@/app/(app)/channels/[channelId]/page'

const { mockCreateClient, mockRedirect } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }))
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))
vi.mock('@/components/chat/ChannelShell', () => ({
  default: () => <div data-testid="channel-shell" />,
}))

function tableResult(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data }),
    single: vi.fn().mockResolvedValue({ data }),
    maybeSingle: vi.fn().mockResolvedValue({ data }),
  }
}

function makeSupabase() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from: vi.fn((table: string) => {
      if (table === 'channels') return tableResult({ id: 'ch-1', group_id: 'group-1', name: 'general', description: null })
      if (table === 'profiles') return tableResult({ id: 'user-1', username: 'alice', avatar_url: null })
      if (table === 'group_members') return tableResult({ role: 'user' })
      if (table === 'channel_read_state') return tableResult({ last_read_at: null })
      if (table === 'messages') return tableResult([])
      throw new Error(`unexpected table:${table}`)
    }),
  }
}

describe('ChannelPage desktop layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateClient.mockResolvedValue(makeSupabase())
  })

  it('does not redirect promoted thread links when target channel is hidden by RLS', async () => {
    const channelResults = [
      tableResult(null),
      tableResult({ id: 'ch-1', group_id: 'group-1', name: 'general', description: null, noob_access: false }),
    ]
    const messageResults = [
      tableResult({ promoted_to_channel_id: 'ch-hidden' }),
      tableResult([]),
    ]
    const supabase = makeSupabase()
    supabase.from = vi.fn((table: string) => {
      if (table === 'messages') return messageResults.shift() ?? tableResult([])
      if (table === 'channels') return channelResults.shift() ?? tableResult(null)
      if (table === 'profiles') return tableResult({ id: 'user-1', username: 'alice', avatar_url: null })
      if (table === 'group_members') return tableResult({ role: 'user' })
      if (table === 'channel_read_state') return tableResult({ last_read_at: null })
      throw new Error(`unexpected table:${table}`)
    })
    mockCreateClient.mockResolvedValueOnce(supabase)

    const element = await ChannelPage({ params: { channelId: 'ch-1' }, searchParams: { thread: 'root-1' } })
    render(element)

    expect(mockRedirect).not.toHaveBeenCalledWith('/channels/ch-hidden')
    expect(screen.getByTestId('channel-shell')).toBeInTheDocument()
  })

  it('redirects promoted thread links only after target channel is visible under RLS', async () => {
    const channelResults = [
      tableResult({ id: 'ch-visible' }),
    ]
    const supabase = makeSupabase()
    supabase.from = vi.fn((table: string) => {
      if (table === 'messages') return tableResult({ promoted_to_channel_id: 'ch-visible' })
      if (table === 'channels') return channelResults.shift() ?? tableResult(null)
      throw new Error(`unexpected table:${table}`)
    })
    mockCreateClient.mockResolvedValueOnce(supabase)

    await expect(ChannelPage({ params: { channelId: 'ch-1' }, searchParams: { thread: 'root-1' } }))
      .rejects.toThrow('redirect:/channels/ch-visible')
  })

  it('lets the channel route fill the desktop app surface width', async () => {
    const element = await ChannelPage({ params: { channelId: 'ch-1' } })
    const { container } = render(element)

    expect(screen.getByTestId('channel-shell')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass(
      'flex',
      'flex-1',
      'min-w-0',
      'min-h-0',
      'flex-col',
      'overflow-hidden',
    )
  })
})
