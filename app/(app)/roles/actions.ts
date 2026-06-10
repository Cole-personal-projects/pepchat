'use server'

import { withAuth } from '@/lib/actions/withAuth'
import { gateGroupPermission } from '@/lib/permissions/gate'
import { PermissionBits, toPermissionBits } from '@/lib/permissions/bits'

const ROLES_DENIED = 'You do not have permission to manage roles.'
const MAX_ROLE_NAME_LENGTH = 60
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

type RoleActionResult = { error: string } | { ok: true }
type CreateRoleResult = { error: string } | { ok: true; roleId: string }

export type RoleUpdateInput = {
  name?: string
  color?: string | null
  hoist?: boolean
  mentionable?: boolean
  /** Bitfield serialized as a string to stay bigint-exact. */
  permissions?: string
}

function normalizeRoleName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/** Creates a custom role seeded with @everyone's permissions. */
export const createRole = withAuth(
  async function createRoleBody({ supabase, user }, formData: FormData): Promise<CreateRoleResult> {
    const groupId = formData.get('group_id') as string
    const name = normalizeRoleName((formData.get('name') as string | null) ?? '')

    if (!groupId) return { error: 'Missing group.' }
    if (!name) return { error: 'Role name is required.' }
    if (name.length > MAX_ROLE_NAME_LENGTH) {
      return { error: `Role name must be ${MAX_ROLE_NAME_LENGTH} characters or fewer.` }
    }
    if (name === '@everyone') return { error: 'That role name is reserved.' }

    const gate = await gateGroupPermission(supabase, {
      groupId,
      userId: user.id,
      bit: PermissionBits.MANAGE_ROLES,
      deniedMessage: ROLES_DENIED,
    })
    if ('error' in gate) return gate

    const { data: existing, error: existingError } = await supabase
      .from('roles')
      .select('position, permissions, is_default')
      .eq('group_id', groupId)
      .order('position', { ascending: false })

    if (existingError) return { error: existingError.message }

    const nextPosition = existing && existing.length > 0 ? (existing[0].position as number) + 1 : 1
    const everyone = (existing ?? []).find((r) => r.is_default)
    const seedPermissions = everyone ? String(everyone.permissions) : '0'

    const { data: role, error } = await supabase
      .from('roles')
      .insert({
        group_id: groupId,
        name,
        position: nextPosition,
        permissions: seedPermissions,
      })
      .select('id')
      .single()

    if (error || !role) return { error: error?.message ?? 'Failed to create role.' }
    return { ok: true, roleId: (role as { id: string }).id }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Updates role identity and permission bits. The @everyone role only accepts permission changes. */
export const updateRole = withAuth(
  async function updateRoleBody(
    { supabase, user },
    roleId: string,
    input: RoleUpdateInput,
  ): Promise<RoleActionResult> {
    if (!roleId) return { error: 'Missing role.' }

    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('id, group_id, is_default')
      .eq('id', roleId)
      .single()

    if (roleError && roleError.code !== 'PGRST116') return { error: roleError.message }
    if (!role) return { error: 'Role not found.' }

    const gate = await gateGroupPermission(supabase, {
      groupId: role.group_id,
      userId: user.id,
      bit: PermissionBits.MANAGE_ROLES,
      deniedMessage: ROLES_DENIED,
    })
    if ('error' in gate) return gate

    const update: Record<string, unknown> = {}

    if (input.name !== undefined) {
      if (role.is_default) return { error: 'The @everyone role cannot be renamed.' }
      const name = normalizeRoleName(input.name)
      if (!name) return { error: 'Role name is required.' }
      if (name.length > MAX_ROLE_NAME_LENGTH) {
        return { error: `Role name must be ${MAX_ROLE_NAME_LENGTH} characters or fewer.` }
      }
      if (name === '@everyone') return { error: 'That role name is reserved.' }
      update.name = name
    }

    if (input.color !== undefined) {
      if (input.color !== null && !HEX_COLOR.test(input.color)) {
        return { error: 'Role color must be a hex value like #5865f2.' }
      }
      update.color = input.color
    }

    if (input.hoist !== undefined) update.hoist = Boolean(input.hoist)
    if (input.mentionable !== undefined) update.mentionable = Boolean(input.mentionable)

    if (input.permissions !== undefined) {
      let bits: bigint
      try {
        bits = toPermissionBits(input.permissions)
      } catch {
        return { error: 'Invalid permission value.' }
      }
      if (bits < 0n) return { error: 'Invalid permission value.' }
      update.permissions = bits.toString()
    }

    if (Object.keys(update).length === 0) return { ok: true }

    const { error } = await supabase.from('roles').update(update).eq('id', roleId)
    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Deletes a custom role. Assignments cascade away; @everyone is protected. */
export const deleteRole = withAuth(
  async function deleteRoleBody({ supabase, user }, roleId: string): Promise<RoleActionResult> {
    if (!roleId) return { error: 'Missing role.' }

    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('id, group_id, is_default')
      .eq('id', roleId)
      .single()

    if (roleError && roleError.code !== 'PGRST116') return { error: roleError.message }
    if (!role) return { error: 'Role not found.' }
    if (role.is_default) return { error: 'The @everyone role cannot be deleted.' }

    const gate = await gateGroupPermission(supabase, {
      groupId: role.group_id,
      userId: user.id,
      bit: PermissionBits.MANAGE_ROLES,
      deniedMessage: ROLES_DENIED,
    })
    if ('error' in gate) return gate

    const { error } = await supabase.from('roles').delete().eq('id', roleId)
    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Swaps a role's position with its neighbor. @everyone stays pinned at the bottom. */
export const moveRole = withAuth(
  async function moveRoleBody(
    { supabase, user },
    roleId: string,
    direction: 'up' | 'down',
  ): Promise<RoleActionResult> {
    if (!roleId) return { error: 'Missing role.' }

    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('id, group_id, position, is_default')
      .eq('id', roleId)
      .single()

    if (roleError && roleError.code !== 'PGRST116') return { error: roleError.message }
    if (!role) return { error: 'Role not found.' }
    if (role.is_default) return { error: 'The @everyone role cannot be reordered.' }

    const gate = await gateGroupPermission(supabase, {
      groupId: role.group_id,
      userId: user.id,
      bit: PermissionBits.MANAGE_ROLES,
      deniedMessage: ROLES_DENIED,
    })
    if ('error' in gate) return gate

    const { data: siblings, error: siblingsError } = await supabase
      .from('roles')
      .select('id, position')
      .eq('group_id', role.group_id)
      .eq('is_default', false)
      .order('position', { ascending: true })

    if (siblingsError) return { error: siblingsError.message }

    const index = (siblings ?? []).findIndex((r) => r.id === roleId)
    const neighborIndex = direction === 'up' ? index + 1 : index - 1
    const neighbor = siblings?.[neighborIndex]
    if (index === -1 || !neighbor) return { ok: true } // boundary

    const { error: firstError } = await supabase
      .from('roles')
      .update({ position: neighbor.position })
      .eq('id', role.id)
    if (firstError) return { error: firstError.message }

    const { error: secondError } = await supabase
      .from('roles')
      .update({ position: role.position })
      .eq('id', neighbor.id)
    if (secondError) return { error: secondError.message }

    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Grants a custom role to a member. */
export const assignMemberRole = withAuth(
  async function assignMemberRoleBody(
    { supabase, user },
    groupId: string,
    userId: string,
    roleId: string,
  ): Promise<RoleActionResult> {
    if (!groupId || !userId || !roleId) return { error: 'Missing role assignment.' }

    const gate = await gateGroupPermission(supabase, {
      groupId,
      userId: user.id,
      bit: PermissionBits.MANAGE_ROLES,
      deniedMessage: ROLES_DENIED,
    })
    if ('error' in gate) return gate

    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('id, group_id, is_default')
      .eq('id', roleId)
      .single()

    if (roleError && roleError.code !== 'PGRST116') return { error: roleError.message }
    if (!role || role.group_id !== groupId) return { error: 'Role not found.' }
    if (role.is_default) return { error: 'Everyone already has the @everyone role.' }

    const { error } = await supabase
      .from('member_roles')
      .insert({ group_id: groupId, user_id: userId, role_id: roleId })

    if (error && error.code !== '23505') return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Removes a custom role from a member. */
export const removeMemberRole = withAuth(
  async function removeMemberRoleBody(
    { supabase, user },
    groupId: string,
    userId: string,
    roleId: string,
  ): Promise<RoleActionResult> {
    if (!groupId || !userId || !roleId) return { error: 'Missing role assignment.' }

    const gate = await gateGroupPermission(supabase, {
      groupId,
      userId: user.id,
      bit: PermissionBits.MANAGE_ROLES,
      deniedMessage: ROLES_DENIED,
    })
    if ('error' in gate) return gate

    const { error } = await supabase
      .from('member_roles')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .eq('role_id', roleId)

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)
