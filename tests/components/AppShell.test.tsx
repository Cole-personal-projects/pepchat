import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import AppShell from '@/app/(app)/AppShell'
import type { Profile } from '@/lib/types'

const { mockNavigation } = vi.hoisted(() => ({
  mockNavigation: { pathname: '/channels/ch-1' },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockNavigation.pathname,
  useParams: () => ({}),
}))

vi.mock('@/components/sidebar/GroupsSidebar', () => ({
  default: () => <nav data-testid="groups-sidebar" />,
}))

vi.mock('@/components/sidebar/ChannelsSidebar', () => ({
  default: () => <aside data-testid="channels-sidebar" />,
}))

vi.mock('@/components/modals/CreateGroupModal', () => ({ default: () => null }))
vi.mock('@/components/modals/JoinGroupModal', () => ({ default: () => null }))
vi.mock('@/components/modals/GroupSettingsModal', () => ({ default: () => null }))
vi.mock('@/components/modals/CreateChannelModal', () => ({ default: () => null }))
vi.mock('@/components/notifications/NotificationTray', () => ({ default: () => null }))
vi.mock('@/components/ui/InstallBanner', () => ({ default: () => null }))
vi.mock('@/components/ui/NetworkStatusBanner', () => ({ default: () => null }))
vi.mock('@/components/ui/MotionSurface', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="motion-surface">{children}</div>,
}))

vi.mock('@/lib/hooks/useGroups', () => ({
  useGroups: () => ({
    groups: [],
    loading: true,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useChannels', () => ({
  useChannels: () => ({ channels: [], loading: false, refetch: vi.fn() }),
}))

vi.mock('@/lib/hooks/useUnreadChannels', () => ({
  useUnreadChannels: () => ({
    unreadChannelIds: new Set<string>(),
    unreadGroupIds: new Set<string>(),
    unreadCountsByChannelId: new Map<string, number>(),
  }),
}))

vi.mock('@/lib/channelReadState', () => ({
  markChannelRead: vi.fn(),
  markChannelUnread: vi.fn(),
}))

const profile: Profile = {
  id: 'u1',
  username: 'alice',
  avatar_url: null,
  display_name: 'Alice',
  bio: null,
  location: null,
  website: null,
  username_color: '#ffffff',
  banner_color: '#111111',
  badge: null,
  pronouns: null,
  member_since: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
}

function getMobileBackdrop(container: HTMLElement) {
  return container.querySelector('.modal-backdrop-enter')
}

function getSidebarShell() {
  return screen.getByTestId('groups-sidebar').parentElement
}

describe('AppShell mobile empty-route sidebar fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockNavigation.pathname = '/channels/ch-1'
    setViewportWidth(390)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('opens the mobile sidebar when pathname changes into /channels without remounting', () => {
    const { container, rerender } = render(
      <AppShell profile={profile}>
        <div>No channel selected</div>
      </AppShell>
    )

    expect(getMobileBackdrop(container)).not.toBeInTheDocument()
    expect(getSidebarShell()).toHaveClass('-translate-x-full')

    mockNavigation.pathname = '/channels'
    rerender(
      <AppShell profile={profile}>
        <div>No channel selected</div>
      </AppShell>
    )

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(getMobileBackdrop(container)).toBeInTheDocument()
    expect(getSidebarShell()).toHaveClass('translate-x-0')
  })

  it('does not open the mobile overlay for /channels at desktop width', () => {
    setViewportWidth(1024)
    mockNavigation.pathname = '/channels'

    const { container } = render(
      <AppShell profile={profile}>
        <div>No channel selected</div>
      </AppShell>
    )

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(getMobileBackdrop(container)).not.toBeInTheDocument()
    expect(getSidebarShell()).toHaveClass('-translate-x-full')
  })

  it('does not auto-open on non-empty channel routes at mobile width', () => {
    mockNavigation.pathname = '/channels/ch-1'

    const { container } = render(
      <AppShell profile={profile}>
        <div>Channel content</div>
      </AppShell>
    )

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(getMobileBackdrop(container)).not.toBeInTheDocument()
    expect(getSidebarShell()).toHaveClass('-translate-x-full')
  })

  it('uses a single Channels bottom-nav button for sidebar navigation on DM routes', () => {
    mockNavigation.pathname = '/dm'

    const { container } = render(
      <AppShell profile={profile}>
        <div>DM content</div>
      </AppShell>
    )

    const mobileNav = screen.getByRole('navigation', { name: 'Mobile app navigation' })
    expect(screen.getByRole('button', { name: 'Channels' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'DMs' })).not.toBeInTheDocument()
    expect(mobileNav).toHaveTextContent('Channels')
    expect(mobileNav).not.toHaveTextContent('DMs')
    expect(getMobileBackdrop(container)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Channels' }))

    expect(getMobileBackdrop(container)).toBeInTheDocument()
    expect(getSidebarShell()).toHaveClass('translate-x-0')
  })

  it('does not immediately reopen after closing the backdrop on the same empty route', () => {
    mockNavigation.pathname = '/channels'

    const { container, rerender } = render(
      <AppShell profile={profile}>
        <div>No channel selected</div>
      </AppShell>
    )

    act(() => {
      vi.advanceTimersByTime(300)
    })

    const backdrop = getMobileBackdrop(container)
    expect(backdrop).toBeInTheDocument()

    fireEvent.click(backdrop as Element)
    expect(getMobileBackdrop(container)).not.toBeInTheDocument()

    rerender(
      <AppShell profile={profile}>
        <div>No channel selected</div>
      </AppShell>
    )
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(getMobileBackdrop(container)).not.toBeInTheDocument()
    expect(getSidebarShell()).toHaveClass('-translate-x-full')
  })
})
