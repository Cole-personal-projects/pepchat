import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ChannelsSidebar from '@/components/sidebar/ChannelsSidebar'
import { updateChannelSettings } from '@/app/(app)/channels/actions'
import { createCategory, moveCategory } from '@/app/(app)/categories/actions'
import type { Channel, ChannelCategory, Group, Profile } from '@/lib/types'

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
vi.mock('@/app/(app)/categories/actions', () => ({
  createCategory: vi.fn(),
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
  moveCategory: vi.fn(),
}))
vi.mock('@/app/(app)/voice/actions', () => ({
  getCurrentVoiceRoom: vi.fn().mockResolvedValue({ ok: true, room: null }),
  joinVoiceChannel: vi.fn(),
  leaveVoiceRoom: vi.fn(),
  createTempVoiceRoom: vi.fn(),
}))
vi.mock('@/components/voice/useVoiceRoomConnection', () => ({
  useVoiceRoomConnection: () => ({
    status: 'idle',
    error: null,
    muted: false,
    connect: vi.fn(),
    leave: vi.fn(),
    toggleMute: vi.fn(),
  }),
}))

vi.mock('@/components/status/UserStatusMenu', () => ({
  default: () => <span>online</span>,
}))

const GROUP: Group = {
  id: 'grp-1', name: 'Design', description: null, icon_url: null,
  owner_id: 'u1', invite_code: 'abc', created_at: '2024-01-01T00:00:00Z',
}

const PROFILE: Profile = {
  id: 'u1', username: 'alice', display_name: 'Alice Smith', avatar_url: null,
  bio: null, location: null, website: null, username_color: '#fff',
  banner_color: '#5865f2', badge: null, pronouns: null,
  member_since: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
}

const CATEGORIES: ChannelCategory[] = [
  { id: 'cat-text', group_id: 'grp-1', name: 'Text Channels', position: 0, created_at: '2024-01-01T00:00:00Z' },
  { id: 'cat-voice', group_id: 'grp-1', name: 'Voice Rooms', position: 1, created_at: '2024-01-01T00:00:00Z' },
]

const CHANNELS: Channel[] = [
  { id: 'ch-active', group_id: 'grp-1', name: 'general', description: null, position: 0, created_at: '2024-01-01T00:00:00Z' },
  { id: 'ch-text-1', group_id: 'grp-1', name: 'design-talk', description: null, position: 1, category_id: 'cat-text', created_at: '2024-01-01T00:00:00Z' },
  { id: 'ch-text-2', group_id: 'grp-1', name: 'critique', description: null, position: 2, category_id: 'cat-text', created_at: '2024-01-01T00:00:00Z' },
  { id: 'ch-voice-1', group_id: 'grp-1', name: 'lounge', description: null, position: 3, category_id: 'cat-voice', kind: 'voice', created_at: '2024-01-01T00:00:00Z' },
]

const BASE_PROPS = {
  group: GROUP,
  channels: CHANNELS,
  categories: CATEGORIES,
  profile: PROFILE,
  userRole: 'user' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('ChannelsSidebar category sections', () => {
  it('renders category sections with their channels', () => {
    render(<ChannelsSidebar {...BASE_PROPS} />)

    expect(screen.getByTestId('category-section-cat-text')).toBeInTheDocument()
    expect(screen.getByTestId('category-section-cat-voice')).toBeInTheDocument()
    expect(screen.getByText('Text Channels')).toBeInTheDocument()
    expect(screen.getByText('Voice Rooms')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /design-talk/i })).toBeInTheDocument()
    // Voice channels render in the dedicated voice section, not as text rows.
    expect(screen.getByRole('button', { name: /join lounge voice/i })).toBeInTheDocument()
  })

  it('renders uncategorized channels outside category sections', () => {
    render(<ChannelsSidebar {...BASE_PROPS} />)
    expect(screen.getByRole('link', { name: '#general, current channel' })).toBeInTheDocument()
  })

  it('renders voice channels in the voice section with a join control', () => {
    render(<ChannelsSidebar {...BASE_PROPS} />)
    expect(screen.getByTestId('voice-channel-ch-voice-1')).toBeInTheDocument()
  })

  it('collapses a category on toggle, hiding read channels', () => {
    render(<ChannelsSidebar {...BASE_PROPS} />)

    fireEvent.click(screen.getByTestId('category-toggle-cat-text'))

    expect(screen.queryByRole('link', { name: /design-talk/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /critique/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('category-toggle-cat-text')).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps unread channels visible when their category is collapsed', () => {
    render(<ChannelsSidebar {...BASE_PROPS} unreadChannelIds={new Set(['ch-text-2'])} />)

    fireEvent.click(screen.getByTestId('category-toggle-cat-text'))

    expect(screen.queryByRole('link', { name: /design-talk/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /critique/i })).toBeInTheDocument()
  })

  it('persists collapse state per group in localStorage', () => {
    render(<ChannelsSidebar {...BASE_PROPS} />)

    fireEvent.click(screen.getByTestId('category-toggle-cat-text'))

    expect(JSON.parse(window.localStorage.getItem('sidebar-collapsed-categories-grp-1') ?? '[]')).toEqual(['cat-text'])
  })

  it('shows category management controls for admins only', () => {
    const { rerender } = render(<ChannelsSidebar {...BASE_PROPS} userRole="admin" />)
    expect(screen.getByTestId('create-category-btn')).toBeInTheDocument()
    expect(screen.getByTestId('category-rename-cat-text')).toBeInTheDocument()
    expect(screen.getByTestId('category-delete-cat-text')).toBeInTheDocument()

    rerender(<ChannelsSidebar {...BASE_PROPS} userRole="user" />)
    expect(screen.queryByTestId('create-category-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('category-rename-cat-text')).not.toBeInTheDocument()
  })

  it('creates a category through the modal', async () => {
    vi.mocked(createCategory).mockResolvedValue({ ok: true })
    render(<ChannelsSidebar {...BASE_PROPS} userRole="admin" />)

    fireEvent.click(screen.getByTestId('create-category-btn'))
    fireEvent.change(screen.getByLabelText(/category name/i), { target: { value: 'Events' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Category' }))

    await waitFor(() => expect(createCategory).toHaveBeenCalled())
    const formData = vi.mocked(createCategory).mock.calls[0][0] as FormData
    expect(formData.get('name')).toBe('Events')
    expect(formData.get('group_id')).toBe('grp-1')
  })

  it('moves categories with bounds applied', () => {
    vi.mocked(moveCategory).mockResolvedValue({ ok: true })
    render(<ChannelsSidebar {...BASE_PROPS} userRole="admin" />)

    expect(screen.getByTestId('category-move-up-cat-text')).toBeDisabled()
    expect(screen.getByTestId('category-move-down-cat-voice')).toBeDisabled()

    fireEvent.click(screen.getByTestId('category-move-down-cat-text'))
    expect(moveCategory).toHaveBeenCalledWith('cat-text', 'down')
  })

  it('passes the category id when creating a channel from a category header', () => {
    const onCreateChannel = vi.fn()
    render(<ChannelsSidebar {...BASE_PROPS} userRole="admin" onCreateChannel={onCreateChannel} />)

    fireEvent.click(screen.getByTestId('category-create-channel-cat-voice'))
    expect(onCreateChannel).toHaveBeenCalledWith('cat-voice')
  })

  it('includes a category picker in channel settings', async () => {
    vi.mocked(updateChannelSettings).mockResolvedValue({ ok: true })
    render(<ChannelsSidebar {...BASE_PROPS} userRole="admin" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit #design-talk settings' }))
    const select = screen.getByLabelText('Category', { exact: true })
    expect(select).toHaveValue('cat-text')

    fireEvent.change(select, { target: { value: 'cat-voice' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateChannelSettings).toHaveBeenCalled())
    const formData = vi.mocked(updateChannelSettings).mock.calls[0][1] as FormData
    expect(formData.get('category_id')).toBe('cat-voice')
  })
})
