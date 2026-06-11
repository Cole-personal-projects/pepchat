import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, act } from '@testing-library/react'
import MembersPanel from '@/components/sidebar/MembersPanel'

vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const assignRoleMock = vi.fn().mockResolvedValue({ ok: true })
const kickMemberMock = vi.fn().mockResolvedValue({ ok: true })
vi.mock('@/app/(app)/members/actions', () => ({
  assignRole: (...args: any[]) => assignRoleMock(...args),
  kickMember: (...args: any[]) => kickMemberMock(...args),
}))

const assignMemberRoleMock = vi.fn().mockResolvedValue({ ok: true })
const removeMemberRoleMock = vi.fn().mockResolvedValue({ ok: true })
vi.mock('@/app/(app)/roles/actions', () => ({
  assignMemberRole: (...args: any[]) => assignMemberRoleMock(...args),
  removeMemberRole: (...args: any[]) => removeMemberRoleMock(...args),
}))

// Mutable so the role-sheet tests can provide custom roles.
let groupRolesResult: { roles: any[]; roleIdsByUserId: Map<string, Set<string>> } = {
  roles: [],
  roleIdsByUserId: new Map(),
}

vi.mock('@/lib/hooks/useGroupRoles', () => ({
  useGroupRoles: () => ({
    roles: groupRolesResult.roles,
    memberRoles: [],
    roleIdsByUserId: groupRolesResult.roleIdsByUserId,
    loading: false,
    refetch: vi.fn(),
  }),
}))

// Mutable so tests can swap out the resolved data between calls
let fetchResult = {
  data: [
    { user_id: 'u1', group_id: 'grp-1', role: 'moderator', profiles: { username: 'alice', avatar_url: null } },
    { user_id: 'u2', group_id: 'grp-1', role: 'user',      profiles: { username: 'bob',   avatar_url: null } },
  ],
  error: null,
}

let realtimeCb: ((payload: any) => void) | null = null

const supabaseStub = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve(fetchResult)),
      })),
    })),
  })),
  channel: vi.fn(() => ({
    on: vi.fn((_evt: string, _filter: any, cb: (p: any) => void) => {
      realtimeCb = cb
      return { subscribe: vi.fn(() => ({})) }
    }),
  })),
  removeChannel: vi.fn(),
  rpc: vi.fn(),
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => supabaseStub,
}))

const BASE_PROPS = {
  groupId: 'grp-1',
  currentUserId: 'admin-u',
  currentUserRole: 'admin' as const,
}

describe('MembersPanel — role change regression', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    assignRoleMock.mockClear()
    kickMemberMock.mockClear()
    realtimeCb = null
    assignRoleMock.mockResolvedValue({ ok: true })
    kickMemberMock.mockResolvedValue({ ok: true })
    groupRolesResult = { roles: [], roleIdsByUserId: new Map() }
    fetchResult = {
      data: [
        { user_id: 'u1', group_id: 'grp-1', role: 'moderator', profiles: { username: 'alice', avatar_url: null } },
        { user_id: 'u2', group_id: 'grp-1', role: 'user',      profiles: { username: 'bob',   avatar_url: null } },
      ],
      error: null,
    }
  })

  it('renders member list on mount', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  it('does not crash when realtime fires a role UPDATE', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    // The realtime callback triggers fetchMembers — swap the resolved data first
    fetchResult = {
      data: [
        { user_id: 'u1', group_id: 'grp-1', role: 'moderator', profiles: { username: 'alice', avatar_url: null } },
        { user_id: 'u2', group_id: 'grp-1', role: 'moderator', profiles: { username: 'bob',   avatar_url: null } },
      ],
      error: null,
    }

    await act(async () => {
      realtimeCb?.({ eventType: 'UPDATE', new: { user_id: 'u2', role: 'moderator', group_id: 'grp-1' } })
    })

    // Component must still be in the DOM — no crash
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  it('renders role dropdown for non-admin members when viewer is admin', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0)
  })

  it('labels the collapsible members section state', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    expect(screen.getByRole('button', { name: 'Members — 2' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows member counts by role', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    expect(screen.getByTestId('member-count-admin')).toHaveTextContent('admin: 0')
    expect(screen.getByTestId('member-count-moderator')).toHaveTextContent('moderator: 1')
    expect(screen.getByTestId('member-count-user')).toHaveTextContent('user: 1')
    expect(screen.getByTestId('member-count-noob')).toHaveTextContent('noob: 0')
  })

  it('filters members by username', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    fireEvent.change(screen.getByTestId('member-search-input'), { target: { value: 'bob' } })

    expect(screen.queryByText('alice')).not.toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  it('filters members by role and can clear the search', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    fireEvent.change(screen.getByTestId('member-search-input'), { target: { value: 'moderator' } })

    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.queryByText('bob')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('member-search-clear'))

    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  it('shows an empty search state when no members match', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    fireEvent.change(screen.getByTestId('member-search-input'), { target: { value: 'nobody' } })

    expect(screen.getByText(/no members match/i)).toBeInTheDocument()
  })

  it('labels member row profile and action buttons', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    expect(screen.getByRole('button', { name: "Open alice's profile" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send message to alice' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kick alice from group' })).toBeInTheDocument()
  })

  it('limits moderator kick controls to user and noob targets', async () => {
    fetchResult = {
      data: [
        { user_id: 'admin-u', group_id: 'grp-1', role: 'moderator', profiles: { username: 'me', avatar_url: null } },
        { user_id: 'u1', group_id: 'grp-1', role: 'moderator', profiles: { username: 'alice', avatar_url: null } },
        { user_id: 'u2', group_id: 'grp-1', role: 'user',      profiles: { username: 'bob',   avatar_url: null } },
        { user_id: 'u3', group_id: 'grp-1', role: 'noob',      profiles: { username: 'newbie', avatar_url: null } },
        { user_id: 'u4', group_id: 'grp-1', role: 'admin',     profiles: { username: 'owner',  avatar_url: null } },
      ],
      error: null,
    }

    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} currentUserRole="moderator" />)
    })

    expect(screen.queryByRole('button', { name: 'Kick alice from group' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kick bob from group' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kick newbie from group' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kick owner from group' })).not.toBeInTheDocument()
  })

  it('does not throw TypeError when assignRole returns undefined (action throws)', async () => {
    assignRoleMock.mockResolvedValueOnce(undefined)

    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    await act(async () => {
      screen.getAllByRole('combobox')[0].dispatchEvent(new Event('change', { bubbles: true }))
    })

    // No crash — component stays in DOM
    expect(screen.getByText('alice')).toBeInTheDocument()
  })

  it('confirms sensitive role changes before assigning roles', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    await act(async () => {
      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'user' } })
    })

    expect(confirm).toHaveBeenCalledWith("Change alice's role from moderator to user?")
    expect(assignRoleMock).toHaveBeenCalled()
  })

  it('does not assign roles when confirmation is cancelled', async () => {
    ;(confirm as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    assignRoleMock.mockClear()

    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    await act(async () => {
      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'user' } })
    })

    expect(assignRoleMock).not.toHaveBeenCalled()
  })

  it('handles assignRole returning { error } without crashing', async () => {
    assignRoleMock.mockResolvedValueOnce({ error: 'Only admins can assign roles.' })

    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    await act(async () => {
      screen.getAllByRole('combobox')[0].dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Component stays alive — no crash
    expect(screen.getByText('alice')).toBeInTheDocument()
  })
})

describe('MembersPanel — custom role assignment sheet', () => {
  const GROUP_BUY = {
    id: 'role-gb', group_id: 'grp-1', name: 'Group Buy', color: '#57f287',
    hoist: false, mentionable: true, position: 1, permissions: '0',
    is_default: false, created_at: '2026-01-01T00:00:00Z',
  }

  beforeEach(() => {
    assignMemberRoleMock.mockClear()
    removeMemberRoleMock.mockClear()
    assignMemberRoleMock.mockResolvedValue({ ok: true })
    removeMemberRoleMock.mockResolvedValue({ ok: true })
    groupRolesResult = { roles: [GROUP_BUY], roleIdsByUserId: new Map() }
    fetchResult = {
      data: [
        { user_id: 'u1', group_id: 'grp-1', role: 'moderator', profiles: { username: 'alice', avatar_url: null } },
        { user_id: 'u2', group_id: 'grp-1', role: 'user',      profiles: { username: 'bob',   avatar_url: null } },
      ],
      error: null,
    }
  })

  it('opens a portaled action sheet listing custom roles', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    fireEvent.click(screen.getByTestId('member-roles-btn-u2'))

    expect(screen.getByTestId('action-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('action-sheet-title')).toHaveTextContent('bob — Roles')
    // Portaled to document.body so the sidebar scroll container can't clip it.
    expect(document.body.contains(screen.getByTestId('action-sheet'))).toBe(true)
    expect(screen.getByTestId('toggle-role-role-gb-u2')).toHaveAttribute('aria-pressed', 'false')
  })

  it('assigns a custom role with an optimistic checkmark', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    fireEvent.click(screen.getByTestId('member-roles-btn-u2'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-role-role-gb-u2'))
    })

    expect(assignMemberRoleMock).toHaveBeenCalledWith('grp-1', 'u2', 'role-gb')
    expect(screen.getByTestId('toggle-role-role-gb-u2')).toHaveAttribute('aria-pressed', 'true')
  })

  it('removes an assigned role when toggled off', async () => {
    groupRolesResult = {
      roles: [GROUP_BUY],
      roleIdsByUserId: new Map([['u2', new Set(['role-gb'])]]),
    }
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    fireEvent.click(screen.getByTestId('member-roles-btn-u2'))
    expect(screen.getByTestId('toggle-role-role-gb-u2')).toHaveAttribute('aria-pressed', 'true')

    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-role-role-gb-u2'))
    })

    expect(removeMemberRoleMock).toHaveBeenCalledWith('grp-1', 'u2', 'role-gb')
    expect(screen.getByTestId('toggle-role-role-gb-u2')).toHaveAttribute('aria-pressed', 'false')
  })

  it('reverts the optimistic toggle and surfaces the error on failure', async () => {
    assignMemberRoleMock.mockResolvedValue({ error: 'Only role managers can assign roles.' })
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    fireEvent.click(screen.getByTestId('member-roles-btn-u2'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-role-role-gb-u2'))
    })

    expect(screen.getByTestId('toggle-role-role-gb-u2')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Only role managers can assign roles.')).toBeInTheDocument()
  })

  it('closes via the Done button', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })

    fireEvent.click(screen.getByTestId('member-roles-btn-u2'))
    fireEvent.click(screen.getByTestId('member-roles-done'))

    expect(screen.queryByTestId('action-sheet')).not.toBeInTheDocument()
  })

  it('hides the roles button from non-admin viewers', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} currentUserRole="moderator" />)
    })

    expect(screen.queryByTestId('member-roles-btn-u2')).not.toBeInTheDocument()
  })
})
