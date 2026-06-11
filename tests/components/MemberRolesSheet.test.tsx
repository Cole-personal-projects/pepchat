import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import MemberRolesSheet from '@/components/roles/MemberRolesSheet'

const assignRoleMock = vi.fn().mockResolvedValue({ ok: true })
vi.mock('@/app/(app)/members/actions', () => ({
  assignRole: (...args: any[]) => assignRoleMock(...args),
  kickMember: vi.fn(),
}))

const assignMemberRoleMock = vi.fn().mockResolvedValue({ ok: true })
const removeMemberRoleMock = vi.fn().mockResolvedValue({ ok: true })
vi.mock('@/app/(app)/roles/actions', () => ({
  assignMemberRole: (...args: any[]) => assignMemberRoleMock(...args),
  removeMemberRole: (...args: any[]) => removeMemberRoleMock(...args),
}))

const GROUP_BUY = {
  id: 'role-gb', group_id: 'grp-1', name: 'Group Buy', color: '#57f287',
  hoist: false, mentionable: true, position: 1, permissions: '0',
  is_default: false, created_at: '2026-01-01T00:00:00Z',
}

let groupRolesResult: { roles: any[]; roleIdsByUserId: Map<string, Set<string>> } = {
  roles: [GROUP_BUY],
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

let legacyRoleFetch: { data: { role: string } | null; error: any } = {
  data: { role: 'user' },
  error: null,
}

function makeQueryStub() {
  const query: any = {}
  for (const method of ['select', 'eq', 'order', 'in', 'is', 'limit']) {
    query[method] = vi.fn(() => query)
  }
  query.single = vi.fn(() => Promise.resolve(legacyRoleFetch))
  return query
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: vi.fn(() => makeQueryStub()), rpc: vi.fn() }),
}))

const BASE_PROPS = {
  open: true,
  onClose: vi.fn(),
  groupId: 'grp-1',
  userId: 'u2',
  memberName: 'bob',
  currentUserId: 'admin-u',
  viewerRole: 'admin' as const,
}

async function renderSheet(props = {}) {
  await act(async () => {
    render(<MemberRolesSheet {...BASE_PROPS} {...props} />)
  })
}

describe('MemberRolesSheet', () => {
  beforeEach(() => {
    cleanup()
    assignRoleMock.mockClear()
    assignMemberRoleMock.mockClear()
    removeMemberRoleMock.mockClear()
    assignRoleMock.mockResolvedValue({ ok: true })
    assignMemberRoleMock.mockResolvedValue({ ok: true })
    removeMemberRoleMock.mockResolvedValue({ ok: true })
    groupRolesResult = { roles: [GROUP_BUY], roleIdsByUserId: new Map() }
    legacyRoleFetch = { data: { role: 'user' }, error: null }
  })

  it('renders both sections portaled to document.body', async () => {
    await renderSheet()

    expect(screen.getByTestId('action-sheet-title')).toHaveTextContent('bob — Roles')
    expect(screen.getByTestId('legacy-role-picker')).toBeInTheDocument()
    expect(screen.getByTestId('toggle-role-role-gb-u2')).toBeInTheDocument()
    expect(document.body.contains(screen.getByTestId('action-sheet'))).toBe(true)
  })

  it('changes membership level from the Discord-style picker', async () => {
    await renderSheet()

    expect(screen.getByTestId('legacy-role-user')).toHaveAttribute('aria-pressed', 'true')
    await act(async () => {
      fireEvent.click(screen.getByTestId('legacy-role-moderator'))
    })

    expect(assignRoleMock).toHaveBeenCalledWith('grp-1', 'u2', 'moderator')
    expect(screen.getByTestId('legacy-role-moderator')).toHaveAttribute('aria-pressed', 'true')
  })

  it('selecting the current membership level is a no-op', async () => {
    await renderSheet()
    await act(async () => {
      fireEvent.click(screen.getByTestId('legacy-role-user'))
    })

    expect(assignRoleMock).not.toHaveBeenCalled()
  })

  it('reverts the membership level and surfaces the error when assignRole fails', async () => {
    assignRoleMock.mockResolvedValueOnce({ error: 'Only admins can assign roles.' })
    await renderSheet()
    await act(async () => {
      fireEvent.click(screen.getByTestId('legacy-role-moderator'))
    })

    expect(screen.getByTestId('legacy-role-user')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Only admins can assign roles.')).toBeInTheDocument()
  })

  it('does not crash when assignRole resolves undefined (action throws upstream)', async () => {
    assignRoleMock.mockResolvedValueOnce(undefined)
    await renderSheet()
    await act(async () => {
      fireEvent.click(screen.getByTestId('legacy-role-moderator'))
    })

    expect(screen.getByTestId('action-sheet')).toBeInTheDocument()
  })

  it('hides the membership picker for self and admin targets', async () => {
    legacyRoleFetch = { data: { role: 'admin' }, error: null }
    await renderSheet()
    expect(screen.queryByTestId('legacy-role-picker')).not.toBeInTheDocument()

    cleanup()
    legacyRoleFetch = { data: { role: 'user' }, error: null }
    await renderSheet({ userId: 'admin-u' })
    expect(screen.queryByTestId('legacy-role-picker')).not.toBeInTheDocument()
  })

  it('assigns a custom role with an optimistic checkmark', async () => {
    await renderSheet()
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
    await renderSheet()

    expect(screen.getByTestId('toggle-role-role-gb-u2')).toHaveAttribute('aria-pressed', 'true')
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-role-role-gb-u2'))
    })

    expect(removeMemberRoleMock).toHaveBeenCalledWith('grp-1', 'u2', 'role-gb')
    expect(screen.getByTestId('toggle-role-role-gb-u2')).toHaveAttribute('aria-pressed', 'false')
  })

  it('reverts the optimistic toggle and surfaces the error on failure', async () => {
    assignMemberRoleMock.mockResolvedValueOnce({ error: 'Only role managers can assign roles.' })
    await renderSheet()
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-role-role-gb-u2'))
    })

    expect(screen.getByTestId('toggle-role-role-gb-u2')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Only role managers can assign roles.')).toBeInTheDocument()
  })

  it('renders nothing for viewers without role management permission', async () => {
    await renderSheet({ viewerRole: 'moderator' })
    expect(screen.queryByTestId('action-sheet')).not.toBeInTheDocument()
  })

  it('closes via the Done button', async () => {
    const onClose = vi.fn()
    await renderSheet({ onClose })
    fireEvent.click(screen.getByTestId('member-roles-done'))

    expect(onClose).toHaveBeenCalled()
  })
})
