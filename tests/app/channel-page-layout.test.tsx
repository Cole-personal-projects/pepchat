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
