import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import ChannelsSidebar from '@/components/sidebar/ChannelsSidebar'
import { deleteChannel, moveChannel, updateChannelSettings } from '@/app/(app)/channels/actions'
import { getCurrentVoiceRoom, joinVoiceChannel, leaveVoiceRoom } from '@/app/(app)/voice/actions'
import type { Channel, Group, Profile } from '@/lib/types'

const { mockVoiceRoomConnection } = vi.hoisted(() => ({
  mockVoiceRoomConnection: {
    status: 'idle' as 'idle' | 'joining' | 'connected' | 'leaving' | 'error',
    muted: false,
    error: null as string | null,
    connect: vi.fn().mockResolvedValue({ ok: true }),
    leave: vi.fn().mockResolvedValue({ ok: true }),
    toggleMute: vi.fn(),
  },
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ channelId: 'ch-active' }),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))

vi.mock('@/app/(auth)/actions', () => ({ logout: vi.fn() }))
vi.mock('@/app/(app)/channels/actions', () => ({
  deleteChannel: vi.fn(),
  moveChannel: vi.fn(),
  updateChannelSettings: vi.fn(),
}))

vi.mock('@/app/(app)/voice/actions', () => ({
  getCurrentVoiceRoom: vi.fn(),
  joinVoiceChannel: vi.fn(),
  leaveVoiceRoom: vi.fn(),
}))

vi.mock('@/components/voice/useVoiceRoomConnection', () => ({
  useVoiceRoomConnection: () => mockVoiceRoomConnection,
}))

const GROUP: Group = {
  id: 'grp-1', name: 'Design', description: 'Design team discussion', icon_url: null,
  owner_id: 'u1', invite_code: 'abc', created_at: '2024-01-01T00:00:00Z',
}

const GROUP_NO_DESC: Group = {
  id: 'grp-2', name: 'General', description: null, icon_url: null,
  owner_id: 'u1', invite_code: 'xyz', created_at: '2024-01-01T00:00:00Z',
}

const PROFILE: Profile = {
  id: 'u1', username: 'alice', display_name: 'Alice Smith', avatar_url: null,
  bio: null, location: null, website: null, username_color: '#fff',
  banner_color: '#5865f2', badge: null, pronouns: null,
  member_since: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
}

const PROFILE_NO_DISPLAY: Profile = {
  ...PROFILE, display_name: null,
}

const CHANNELS: Channel[] = [
  { id: 'ch-active', group_id: 'grp-1', name: 'general',       description: null, position: 0, created_at: '2024-01-01T00:00:00Z', kind: 'text' },
  { id: 'ch-unread', group_id: 'grp-1', name: 'announcements', description: null, position: 1, created_at: '2024-01-01T00:00:00Z', kind: 'text' },
  { id: 'ch-read',   group_id: 'grp-1', name: 'random',        description: null, position: 2, created_at: '2024-01-01T00:00:00Z', kind: 'text' },
]

const CHANNELS_WITH_VOICE: Channel[] = [
  ...CHANNELS,
  { id: 'voice-lounge', group_id: 'grp-1', name: 'Lounge', description: null, position: 3, created_at: '2024-01-01T00:00:00Z', kind: 'voice' },
]

const BASE_PROPS = {
  group: GROUP,
  channels: CHANNELS,
  profile: PROFILE,
  userRole: 'user' as const,
}

afterEach(() => cleanup())

describe('ChannelsSidebar layout', () => {
  it('renders at 236px width', () => {
    const { container } = render(<ChannelsSidebar {...BASE_PROPS} />)
    const sidebar = container.firstElementChild as HTMLElement
    expect(sidebar).toHaveStyle({ width: '236px' })
  })

  it('shows group name in header', () => {
    render(<ChannelsSidebar {...BASE_PROPS} />)
    expect(screen.getByTestId('group-header-name')).toHaveTextContent('Design')
  })

  it('shows group description when present', () => {
    render(<ChannelsSidebar {...BASE_PROPS} />)
    expect(screen.getByTestId('group-header-desc')).toHaveTextContent('Design team discussion')
  })

  it('does not render description when group has no description', () => {
    render(<ChannelsSidebar {...BASE_PROPS} group={GROUP_NO_DESC} />)
    expect(screen.queryByTestId('group-header-desc')).not.toBeInTheDocument()
  })

  it('shows settings gear for admin', () => {
    render(<ChannelsSidebar {...BASE_PROPS} userRole="admin" />)
    expect(screen.getByTestId('group-settings-btn')).toBeInTheDocument()
  })

  it('does not show settings gear for user', () => {
    render(<ChannelsSidebar {...BASE_PROPS} userRole="user" />)
    expect(screen.queryByTestId('group-settings-btn')).not.toBeInTheDocument()
  })

  it('shows create channel button for admin', () => {
    render(<ChannelsSidebar {...BASE_PROPS} userRole="admin" />)
    expect(screen.getByTestId('create-channel-btn')).toBeInTheDocument()
  })

  it('shows create channel button for moderator', () => {
    render(<ChannelsSidebar {...BASE_PROPS} userRole="moderator" />)
    expect(screen.getByTestId('create-channel-btn')).toBeInTheDocument()
  })

  it('does not show create channel button for user', () => {
    render(<ChannelsSidebar {...BASE_PROPS} userRole="user" />)
    expect(screen.queryByTestId('create-channel-btn')).not.toBeInTheDocument()
  })
})

describe('ChannelsSidebar channel rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(deleteChannel).mockResolvedValue(undefined as never)
    vi.mocked(moveChannel).mockResolvedValue(undefined)
    vi.mocked(updateChannelSettings).mockResolvedValue({ ok: true })
    vi.mocked(getCurrentVoiceRoom).mockResolvedValue({ ok: true, room: null })
    vi.mocked(joinVoiceChannel).mockResolvedValue({
      ok: true,
      room: { id: 'room-1', channelId: 'voice-lounge', groupId: 'grp-1', status: 'open', participantCount: 1 },
      provider: 'livekit',
      livekitUrl: 'wss://voice.example',
      token: 'voice-token',
      expiresAt: '2024-01-01T01:00:00Z',
    })
  })

  it('shows dot indicator for unread channel', () => {
    render(<ChannelsSidebar {...BASE_PROPS} unreadChannelIds={new Set(['ch-unread'])} />)
    expect(screen.getByTestId('unread-dot-ch-unread')).toBeInTheDocument()
  })

  it('does not show dot indicator for read channel', () => {
    render(<ChannelsSidebar {...BASE_PROPS} unreadChannelIds={new Set(['ch-unread'])} />)
    expect(screen.queryByTestId('unread-dot-ch-read')).not.toBeInTheDocument()
  })

  it('does not show dot indicator on active channel even if unread', () => {
    render(<ChannelsSidebar {...BASE_PROPS} unreadChannelIds={new Set(['ch-active'])} />)
    expect(screen.queryByTestId('unread-dot-ch-active')).not.toBeInTheDocument()
  })

  it('unread channel link has font-medium class', () => {
    render(<ChannelsSidebar {...BASE_PROPS} unreadChannelIds={new Set(['ch-unread'])} />)
    const link = screen.getByRole('link', { name: /announcements/i })
    expect(link).toHaveClass('font-medium')
  })

  it('read channel link does not have font-medium class', () => {
    render(<ChannelsSidebar {...BASE_PROPS} unreadChannelIds={new Set()} />)
    const link = screen.getByRole('link', { name: /random/i })
    expect(link).not.toHaveClass('font-medium')
  })

  it('shows unread count when provided', () => {
    render(
      <ChannelsSidebar
        {...BASE_PROPS}
        unreadChannelIds={new Set(['ch-unread'])}
        unreadCountsByChannelId={new Map([['ch-unread', 3]])}
      />
    )
    expect(screen.getByTestId('unread-count-ch-unread')).toHaveTextContent('3')
  })

  it('labels unread channel links with unread context', () => {
    render(
      <ChannelsSidebar
        {...BASE_PROPS}
        unreadChannelIds={new Set(['ch-unread'])}
        unreadCountsByChannelId={new Map([['ch-unread', 3]])}
      />
    )

    expect(screen.getByRole('link', { name: '#announcements, 3 unread messages' })).toHaveAttribute('href', '/channels/ch-unread')
  })

  it('labels the active channel link as current', () => {
    render(<ChannelsSidebar {...BASE_PROPS} />)

    expect(screen.getByRole('link', { name: '#general, current channel' })).toHaveAttribute('href', '/channels/ch-active')
  })

  it('caps unread count at 99+', () => {
    render(
      <ChannelsSidebar
        {...BASE_PROPS}
        unreadChannelIds={new Set(['ch-unread'])}
        unreadCountsByChannelId={new Map([['ch-unread', 120]])}
      />
    )
    expect(screen.getByTestId('unread-count-ch-unread')).toHaveTextContent('99+')
  })

  it('filters channels by name and description', () => {
    render(
      <ChannelsSidebar
        {...BASE_PROPS}
        channels={[
          CHANNELS[0],
          { ...CHANNELS[1], description: 'Release notes and updates' },
          CHANNELS[2],
        ]}
      />
    )

    fireEvent.change(screen.getByTestId('channel-search-input'), { target: { value: 'announce' } })

    expect(screen.getByRole('link', { name: /announcements/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /general/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /random/i })).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('channel-search-input'), { target: { value: 'release notes' } })

    expect(screen.getByRole('link', { name: /announcements/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /general/i })).not.toBeInTheDocument()
  })

  it('clears the channel search', () => {
    render(<ChannelsSidebar {...BASE_PROPS} />)

    const searchInput = screen.getByTestId('channel-search-input')
    fireEvent.change(searchInput, { target: { value: 'random' } })

    expect(screen.getByRole('link', { name: /random/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /general/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('channel-search-clear'))

    expect(searchInput).toHaveValue('')
    expect(screen.getByRole('link', { name: /general/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /announcements/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /random/i })).toBeInTheDocument()
    expect(screen.queryByTestId('channel-search-clear')).not.toBeInTheDocument()
  })

  it('shows an empty channel search state when no channels match', () => {
    render(<ChannelsSidebar {...BASE_PROPS} />)

    fireEvent.change(screen.getByTestId('channel-search-input'), { target: { value: 'zzznomatch' } })

    expect(screen.getByText('No channels match your search.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /general/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /announcements/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /random/i })).not.toBeInTheDocument()
  })

  it('calls onMarkChannelRead from unread row action', () => {
    const onMarkChannelRead = vi.fn()
    render(
      <ChannelsSidebar
        {...BASE_PROPS}
        unreadChannelIds={new Set(['ch-unread'])}
        onMarkChannelRead={onMarkChannelRead}
      />
    )

    fireEvent.click(screen.getByTestId('mark-read-ch-unread'))

    expect(onMarkChannelRead).toHaveBeenCalledWith('ch-unread')
  })

  it('labels unread row actions with channel names', () => {
    render(
      <ChannelsSidebar
        {...BASE_PROPS}
        unreadChannelIds={new Set(['ch-unread'])}
        onMarkChannelRead={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Mark #announcements read' })).toBeInTheDocument()
  })

  it('calls onMarkChannelUnread from read row action', () => {
    const onMarkChannelUnread = vi.fn()
    render(<ChannelsSidebar {...BASE_PROPS} onMarkChannelUnread={onMarkChannelUnread} />)

    fireEvent.click(screen.getByTestId('mark-unread-ch-read'))

    expect(onMarkChannelUnread).toHaveBeenCalledWith('ch-read')
  })

  it('labels read row actions with channel names', () => {
    render(<ChannelsSidebar {...BASE_PROPS} onMarkChannelUnread={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Mark #random unread' })).toBeInTheDocument()
  })

  it('labels channel management actions with channel names', () => {
    render(<ChannelsSidebar {...BASE_PROPS} userRole="admin" />)

    expect(screen.getByRole('button', { name: 'Move #general up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit #general settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move #general down' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete #general' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move #random up' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move #random down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete #random' })).toBeInTheDocument()
  })

  it('shows channel move errors inline', async () => {
    vi.mocked(moveChannel).mockResolvedValueOnce({ error: 'Move failed' })
    render(<ChannelsSidebar {...BASE_PROPS} userRole="admin" />)

    fireEvent.click(screen.getAllByTitle('Move down')[0])

    await waitFor(() => expect(screen.getByTestId('channel-action-error')).toHaveTextContent('Move failed'))
  })

  it('shows channel delete errors inline', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    vi.mocked(deleteChannel).mockResolvedValueOnce({ error: 'Delete failed' } as never)
    render(<ChannelsSidebar {...BASE_PROPS} userRole="admin" />)

    fireEvent.click(screen.getAllByTitle('Delete channel')[0])

    await waitFor(() => expect(screen.getByTestId('channel-action-error')).toHaveTextContent('Delete failed'))
  })

  it('updates channel settings from the settings modal', async () => {
    render(<ChannelsSidebar {...BASE_PROPS} userRole="admin" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit #general settings' }))
    fireEvent.change(screen.getByLabelText(/channel name/i), { target: { value: 'welcome-chat' } })
    fireEvent.change(screen.getByLabelText(/topic/i), { target: { value: 'Start here' } })
    fireEvent.click(screen.getByLabelText(/visible to new members/i))
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateChannelSettings).toHaveBeenCalledWith('ch-active', expect.any(FormData)))
    const formData = vi.mocked(updateChannelSettings).mock.calls[0][1] as FormData
    expect(formData.get('name')).toBe('welcome-chat')
    expect(formData.get('description')).toBe('Start here')
    expect(formData.get('noob_access')).toBe('on')
  })
})

describe('ChannelsSidebar voice channels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentVoiceRoom).mockResolvedValue({ ok: true, room: null })
    vi.mocked(joinVoiceChannel).mockResolvedValue({
      ok: true,
      room: { id: 'room-1', channelId: 'voice-lounge', groupId: 'grp-1', status: 'open', participantCount: 1 },
      provider: 'livekit',
      livekitUrl: 'wss://voice.example',
      token: 'voice-token',
      expiresAt: '2024-01-01T01:00:00Z',
    })
    vi.mocked(leaveVoiceRoom).mockResolvedValue({ ok: true })
    Object.assign(mockVoiceRoomConnection, {
      status: 'idle',
      muted: false,
      error: null,
      connect: vi.fn().mockImplementation(async () => {
        mockVoiceRoomConnection.status = 'connected'
        return { ok: true }
      }),
      leave: vi.fn().mockImplementation(async () => {
        mockVoiceRoomConnection.status = 'idle'
        return { ok: true }
      }),
      toggleMute: vi.fn(),
    })
  })

  it('renders voice channels in a distinct sidebar section and omits them from text channels', async () => {
    render(<ChannelsSidebar {...BASE_PROPS} channels={CHANNELS_WITH_VOICE} userRole="admin" />)

    expect(screen.getByText('Voice Channels')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /join lounge voice/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /#lounge/i })).not.toBeInTheDocument()
    await waitFor(() => expect(getCurrentVoiceRoom).toHaveBeenCalledWith('voice-lounge'))
  })

  it('shows active occupancy nested below a voice channel', async () => {
    vi.mocked(getCurrentVoiceRoom).mockResolvedValueOnce({
      ok: true,
      room: { id: 'room-2', channelId: 'voice-lounge', groupId: 'grp-1', status: 'open', participantCount: 2 },
    })

    render(<ChannelsSidebar {...BASE_PROPS} channels={CHANNELS_WITH_VOICE} userRole="admin" />)

    await waitFor(() => expect(screen.getByTestId('voice-participants-voice-lounge')).toHaveTextContent('2 connected'))
  })

  it('joins a voice channel directly from a sidebar click', async () => {
    render(<ChannelsSidebar {...BASE_PROPS} channels={CHANNELS_WITH_VOICE} userRole="admin" />)

    const voiceButton = screen.getByRole('button', { name: /join lounge voice/i })
    await waitFor(() => expect(voiceButton).toBeEnabled())
    fireEvent.click(voiceButton)

    await waitFor(() => expect(joinVoiceChannel).toHaveBeenCalledWith('voice-lounge'))
    expect(joinVoiceChannel).toHaveBeenCalledTimes(1)
  })

  it('shows connected participant, mute, and leave controls after a successful join', async () => {
    render(<ChannelsSidebar {...BASE_PROPS} channels={CHANNELS_WITH_VOICE} userRole="admin" />)

    const voiceButton = screen.getByRole('button', { name: /join lounge voice/i })
    await waitFor(() => expect(voiceButton).toBeEnabled())
    fireEvent.click(voiceButton)

    await waitFor(() => expect(screen.getByRole('button', { name: /connected to lounge voice/i })).toBeDisabled())
    expect(screen.getAllByText('Connected')).toHaveLength(2)
    expect(screen.getByTestId('voice-participants-voice-lounge')).toHaveTextContent('1 connected')
    expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument()
  })

  it('wires connected mute and leave controls to the active voice room', async () => {
    render(<ChannelsSidebar {...BASE_PROPS} channels={CHANNELS_WITH_VOICE} userRole="admin" />)

    const voiceButton = screen.getByRole('button', { name: /join lounge voice/i })
    await waitFor(() => expect(voiceButton).toBeEnabled())
    fireEvent.click(voiceButton)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(mockVoiceRoomConnection.toggleMute).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(leaveVoiceRoom).toHaveBeenCalledWith('room-1'))
    expect(mockVoiceRoomConnection.leave).toHaveBeenCalledTimes(1)
  })
})

describe('ChannelsSidebar user footer', () => {
  it('shows display name in footer', () => {
    render(<ChannelsSidebar {...BASE_PROPS} />)
    expect(screen.getByTestId('user-footer-name')).toHaveTextContent('Alice Smith')
  })

  it('falls back to username when no display name', () => {
    render(<ChannelsSidebar {...BASE_PROPS} profile={PROFILE_NO_DISPLAY} />)
    expect(screen.getByTestId('user-footer-name')).toHaveTextContent('alice')
  })

  it('shows online status indicator', () => {
    render(<ChannelsSidebar {...BASE_PROPS} />)
    expect(screen.getByTestId('user-footer-status')).toBeInTheDocument()
  })
})
