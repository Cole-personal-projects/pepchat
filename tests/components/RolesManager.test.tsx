import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RolesManager from '@/components/roles/RolesManager'
import { createRole, deleteRole, updateRole } from '@/app/(app)/roles/actions'
import { PermissionBits } from '@/lib/permissions/bits'
import type { GroupRole } from '@/lib/types'

const { mockUseGroupRoles } = vi.hoisted(() => ({
  mockUseGroupRoles: vi.fn(),
}))

vi.mock('@/lib/hooks/useGroupRoles', () => ({ useGroupRoles: mockUseGroupRoles }))
vi.mock('@/app/(app)/roles/actions', () => ({
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
  moveRole: vi.fn(),
}))

const EVERYONE: GroupRole = {
  id: 'role-everyone', group_id: 'grp-1', name: '@everyone', color: null,
  hoist: false, mentionable: false, position: 0, permissions: 50944,
  is_default: true, created_at: '2026-01-01T00:00:00Z',
}

const MODERATOR: GroupRole = {
  id: 'role-mod', group_id: 'grp-1', name: 'Moderator', color: '#3ba55d',
  hoist: true, mentionable: true, position: 2, permissions: 4194296,
  is_default: false, created_at: '2026-01-01T00:00:00Z',
}

function setupRoles(roles: GroupRole[] = [MODERATOR, EVERYONE]) {
  mockUseGroupRoles.mockReturnValue({
    roles,
    memberRoles: [],
    roleIdsByUserId: new Map(),
    loading: false,
    refetch: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setupRoles()
})

describe('RolesManager', () => {
  it('lists roles top-first with @everyone present', () => {
    render(<RolesManager groupId="grp-1" />)

    expect(screen.getByTestId('role-item-role-mod')).toBeInTheDocument()
    expect(screen.getByTestId('role-item-role-everyone')).toBeInTheDocument()
  })

  it('creates a role from the create form', async () => {
    vi.mocked(createRole).mockResolvedValue({ ok: true, roleId: 'role-new' })
    render(<RolesManager groupId="grp-1" />)

    fireEvent.change(screen.getByTestId('new-role-name'), { target: { value: 'VIP' } })
    fireEvent.click(screen.getByTestId('create-role-btn'))

    await waitFor(() => expect(createRole).toHaveBeenCalled())
    const formData = vi.mocked(createRole).mock.calls[0][0] as FormData
    expect(formData.get('name')).toBe('VIP')
    expect(formData.get('group_id')).toBe('grp-1')
  })

  it('toggles a permission bit on the selected role', async () => {
    vi.mocked(updateRole).mockResolvedValue({ ok: true })
    render(<RolesManager groupId="grp-1" />)

    // First role (Moderator) is selected by default. KICK_MEMBERS (bit 16) is
    // part of the seeded moderator permissions, so toggling turns it off.
    fireEvent.click(screen.getByTestId('perm-KICK_MEMBERS-role-mod'))

    await waitFor(() => expect(updateRole).toHaveBeenCalledWith('role-mod', {
      permissions: (4194296n & ~PermissionBits.KICK_MEMBERS).toString(),
    }))
  })

  it('hides identity fields that do not apply to @everyone', () => {
    render(<RolesManager groupId="grp-1" />)

    fireEvent.click(screen.getByTestId('role-item-role-everyone'))

    expect(screen.queryByLabelText(/role name/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('delete-role-role-everyone')).not.toBeInTheDocument()
  })

  it('deletes a custom role after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    vi.mocked(deleteRole).mockResolvedValue({ ok: true })
    render(<RolesManager groupId="grp-1" />)

    fireEvent.click(screen.getByTestId('delete-role-role-mod'))

    await waitFor(() => expect(deleteRole).toHaveBeenCalledWith('role-mod'))
  })
})
