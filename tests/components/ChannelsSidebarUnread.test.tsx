import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChannelsSidebar from '@/components/sidebar/ChannelsSidebar'
import type { Channel, Group, Profile } from '@/lib/types'

// ─── Next.js mocks ────────────────────────────────────────────────────────────

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ channelId: 'ch-active' }),
}))

vi.mock('@/app/(auth)/actions', () => ({ logout: vi.fn() }))
vi.mock('@/app/(app)/voice/actions', () => ({
  getCurrentVoiceRoom: vi.fn().mockResolvedValue({ ok: true, room: null }),
  joinVoiceChannel: vi.fn(),
  leaveVoiceRoom: vi.fn(),
  createTempVoiceRoom: vi.fn(),
}))
vi.mock('@/components/voice/useVoiceRoomConnection', () => ({
  useVoiceRoomConnection: () => ({
    status: 'idle', error: null, muted: false,
    connect: vi.fn(), leave: vi.fn(), toggleMute: vi.fn(),
  }),
}))
vi.mock('@/components/status/UserStatusMenu', () => ({
  default: () => <span>online</span>,
}))
vi.mock('@/components/events/EventsPanel', () => ({
  default: () => null,
}))
vi.mock('@/app/(app)/channels/actions', () => ({
  deleteChannel: vi.fn(),
  moveChannel: vi.fn(),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const GROUP: Group = {
  id: 'grp-1', name: 'Testers', description: null, icon_url: null,
  owner_id: 'u1', invite_code: 'abc', created_at: '2024-01-01T00:00:00Z',
}

const PROFILE: Profile = {
  id: 'u1', username: 'alice', avatar_url: null, display_name: null,
  bio: null, location: null, website: null, username_color: '#fff',
  banner_color: '#5865f2', badge: null, pronouns: null,
  member_since: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
}

const CHANNELS: Channel[] = [
  { id: 'ch-active', group_id: 'grp-1', name: 'general', description: null, position: 0, created_at: '2024-01-01T00:00:00Z' },
  { id: 'ch-unread', group_id: 'grp-1', name: 'announcements', description: null, position: 1, created_at: '2024-01-01T00:00:00Z' },
  { id: 'ch-read',   group_id: 'grp-1', name: 'random', description: null, position: 2, created_at: '2024-01-01T00:00:00Z' },
]

const BASE_PROPS = {
  group: GROUP,
  channels: CHANNELS,
  profile: PROFILE,
  userRole: 'user' as const,
}

describe('ChannelsSidebar unread indicators', () => {
  it('shows unread dot on a channel that is in unreadChannelIds', () => {
    render(<ChannelsSidebar {...BASE_PROPS} unreadChannelIds={new Set(['ch-unread'])} />)
    const dot = screen.getByTestId('unread-dot-ch-unread')
    expect(dot).toBeInTheDocument()
  })

  it('does not show unread dot on a channel not in unreadChannelIds', () => {
    render(<ChannelsSidebar {...BASE_PROPS} unreadChannelIds={new Set(['ch-unread'])} />)
    expect(screen.queryByTestId('unread-dot-ch-read')).not.toBeInTheDocument()
  })

  it('does not show unread dot on the active channel even if in unreadChannelIds', () => {
    render(<ChannelsSidebar {...BASE_PROPS} unreadChannelIds={new Set(['ch-active', 'ch-unread'])} />)
    expect(screen.queryByTestId('unread-dot-ch-active')).not.toBeInTheDocument()
  })

  it('renders channel name in bold when channel is unread', () => {
    render(<ChannelsSidebar {...BASE_PROPS} unreadChannelIds={new Set(['ch-unread'])} />)
    const link = screen.getByRole('link', { name: /announcements/i })
    expect(link).toHaveClass('font-medium')
  })

  it('does not render channel name in bold when channel is read', () => {
    render(<ChannelsSidebar {...BASE_PROPS} unreadChannelIds={new Set()} />)
    const link = screen.getByRole('link', { name: /random/i })
    expect(link).not.toHaveClass('font-medium')
  })
})
