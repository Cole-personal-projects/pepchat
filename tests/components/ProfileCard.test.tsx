import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ProfileCard from '@/components/profile/ProfileCard'
import { PROFILE_A, PROFILE_B } from '@/tests/fixtures'

const mockPush = vi.fn()
const mockGetProfile = vi.fn()
const mockRpc = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/app/(app)/profile/actions', () => ({
  getProfile: (userId: string) => mockGetProfile(userId),
}))

vi.mock('@/app/(app)/members/actions', () => ({
  assignRole: vi.fn().mockResolvedValue({ ok: true }),
  kickMember: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/app/(app)/roles/actions', () => ({
  assignMemberRole: vi.fn().mockResolvedValue({ ok: true }),
  removeMemberRole: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/hooks/useGroupRoles', () => ({
  useGroupRoles: () => ({
    roles: [
      {
        id: 'role-gb', group_id: 'grp-1', name: 'group-buy', color: '#57f287',
        hoist: false, mentionable: true, position: 1, permissions: '0',
        is_default: false, created_at: '2026-01-01T00:00:00Z',
      },
    ],
    memberRoles: [],
    roleIdsByUserId: new Map(),
    loading: false,
    refetch: vi.fn(),
  }),
}))

// Chainable query stub for MemberRolesSheet's legacy-role fetch.
function makeQueryStub() {
  const query: any = {}
  for (const method of ['select', 'eq', 'order', 'in', 'is', 'limit']) {
    query[method] = vi.fn(() => query)
  }
  query.single = vi.fn(() => Promise.resolve({ data: { role: 'user' }, error: null }))
  return query
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: mockRpc,
    from: vi.fn(() => makeQueryStub()),
  }),
}))

function anchorEl() {
  const el = document.createElement('button')
  el.getBoundingClientRect = () => ({
    left: 20,
    right: 60,
    top: 30,
    bottom: 50,
    width: 40,
    height: 20,
    x: 20,
    y: 30,
    toJSON: () => ({}),
  })
  document.body.appendChild(el)
  return el
}

describe('ProfileCard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    mockPush.mockReset()
    mockGetProfile.mockReset()
    mockRpc.mockReset()
    mockGetProfile.mockResolvedValue(PROFILE_B)
    mockRpc.mockResolvedValue({ data: 'conv-1', error: null })
  })

  it('labels the close control', async () => {
    render(
      <ProfileCard
        userId={PROFILE_B.id}
        currentUserId={PROFILE_A.id}
        anchorEl={anchorEl()}
        onClose={vi.fn()}
      />
    )

    await screen.findByText('Bob')

    expect(screen.getByRole('button', { name: 'Close profile card' })).toBeInTheDocument()
  })

  it('closes from the labeled close control', async () => {
    const onClose = vi.fn()
    render(
      <ProfileCard
        userId={PROFILE_B.id}
        currentUserId={PROFILE_A.id}
        anchorEl={anchorEl()}
        onClose={onClose}
      />
    )

    await screen.findByText('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Close profile card' }))

    expect(onClose).toHaveBeenCalled()
  })

  it('opens a direct message from the profile card action', async () => {
    const onClose = vi.fn()
    render(
      <ProfileCard
        userId={PROFILE_B.id}
        currentUserId={PROFILE_A.id}
        anchorEl={anchorEl()}
        onClose={onClose}
      />
    )

    await screen.findByText('Bob')
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }))

    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('get_or_create_dm', { other_user_id: PROFILE_B.id }))
    expect(onClose).toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith('/dm/conv-1')
  })

  it('shows Manage Roles for group admins and opens the role sheet', async () => {
    render(
      <ProfileCard
        userId={PROFILE_B.id}
        currentUserId={PROFILE_A.id}
        anchorEl={anchorEl()}
        onClose={vi.fn()}
        groupId="grp-1"
        viewerRole="admin"
      />
    )

    await screen.findByText('Bob')
    const manageButton = screen.getByTestId('profile-manage-roles')
    fireEvent.click(manageButton)

    await screen.findByTestId('action-sheet')
    expect(screen.getByTestId('action-sheet-title')).toHaveTextContent('Roles')
    expect(screen.getByTestId(`toggle-role-role-gb-${PROFILE_B.id}`)).toBeInTheDocument()
    await screen.findByTestId('legacy-role-picker')
  })

  it('hides Manage Roles without group context or for non-admin viewers', async () => {
    const { unmount } = render(
      <ProfileCard
        userId={PROFILE_B.id}
        currentUserId={PROFILE_A.id}
        anchorEl={anchorEl()}
        onClose={vi.fn()}
      />
    )
    await screen.findByText('Bob')
    expect(screen.queryByTestId('profile-manage-roles')).not.toBeInTheDocument()
    unmount()

    render(
      <ProfileCard
        userId={PROFILE_B.id}
        currentUserId={PROFILE_A.id}
        anchorEl={anchorEl()}
        onClose={vi.fn()}
        groupId="grp-1"
        viewerRole="moderator"
      />
    )
    await screen.findByText('Bob')
    expect(screen.queryByTestId('profile-manage-roles')).not.toBeInTheDocument()
  })

  it('keeps the card open while interacting inside the role sheet', async () => {
    const onClose = vi.fn()
    render(
      <ProfileCard
        userId={PROFILE_B.id}
        currentUserId={PROFILE_A.id}
        anchorEl={anchorEl()}
        onClose={onClose}
        groupId="grp-1"
        viewerRole="admin"
      />
    )

    await screen.findByText('Bob')
    fireEvent.click(screen.getByTestId('profile-manage-roles'))
    await screen.findByTestId('action-sheet')

    // Pointer events inside the portaled sheet must not dismiss the card.
    fireEvent.pointerDown(screen.getByTestId('action-sheet'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
