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

// Single-row membership fetch used by MemberRolesSheet's legacy picker.
let legacyRoleFetch: { data: { role: string } | null; error: any } = {
  data: { role: 'user' },
  error: null,
}

// Chainable query stub: awaiting the chain resolves the members list;
// terminating with .single() resolves the legacy-role row.
function makeQueryStub() {
  const query: any = {}
  for (const method of ['select', 'eq', 'order', 'in', 'is', 'limit']) {
    query[method] = vi.fn(() => query)
  }
  query.single = vi.fn(() => Promise.resolve(legacyRoleFetch))
  query.then = (resolve: any, reject: any) => Promise.resolve(fetchResult).then(resolve, reject)
  return query
}

const supabaseStub = {
  from: vi.fn(() => makeQueryStub()),
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
    legacyRoleFetch = { data: { role: 'user' }, error: null }
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

  it('keeps member rows clean: no selects, pills, or role buttons (Discord-style)', async () => {
    await act(async () => {
      render(<MembersPanel {...BASE_PROPS} />)
    })
    // Role management moved to the profile card's Manage Roles sheet.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByTestId('member-roles-btn-u1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('member-roles-btn-u2')).not.toBeInTheDocument()
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

  
  
  
  })
