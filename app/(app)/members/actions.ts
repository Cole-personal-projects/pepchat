'use server'

import { logAuditEvent } from '@/lib/audit'
import { withAuth } from '@/lib/actions/withAuth'
import { gateGroupRole } from '@/lib/permissions/gate'
import { PERMISSIONS, type Role } from '@/lib/permissions'

/**
 * Assigns a new role to a group member.
 * Admins can assign moderator/user/noob. The group owner is the super-admin:
 * only they can grant or revoke the admin tier, and nobody can change the
 * owner's own role here (ownership moves via transferOwnership).
 */
export const assignRole = withAuth(
  async ({ supabase, user }, groupId: string, targetUserId: string, newRole: Role): Promise<{ error: string } | { ok: true }> => {
    const callerGate = await gateGroupRole(supabase, {
      groupId,
      userId: user.id,
      predicate: PERMISSIONS.canAssignRoles,
      deniedMessage: 'Only admins can assign roles.',
    })

    if ('error' in callerGate) return { error: callerGate.error }

    // Enforce: cannot change own role
    if (targetUserId === user.id) {
      return { error: 'You cannot change your own role.' }
    }

    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('owner_id')
      .eq('id', groupId)
      .single()

    if (groupError) return { error: groupError.message }
    const isOwner = group?.owner_id === user.id

    // The owner's membership level is immutable here — use transferOwnership.
    if (targetUserId === group?.owner_id) {
      return { error: "The owner's role cannot be changed. Transfer ownership instead." }
    }

    // Only the owner can grant the admin tier.
    if (newRole === 'admin' && !isOwner) {
      return { error: 'Only the owner can grant the admin role.' }
    }

    const { data: targetMembership, error: targetError } = await supabase
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', targetUserId)
      .single()

    if (targetError) return { error: targetError.message }
    if (!targetMembership?.role) {
      return { error: 'Target member was not found.' }
    }
    // Only the owner can demote another admin.
    if (targetMembership?.role === 'admin' && !isOwner) {
      return { error: 'Only the owner can change an admin\'s role.' }
    }

    const { data: updatedRows, error } = await supabase
      .from('group_members')
      .update({ role: newRole })
      .eq('group_id', groupId)
      .eq('user_id', targetUserId)
      .select('user_id')

    if (error) return { error: error.message }
    // RLS rejections surface as zero matched rows, not errors — without this
    // check a blocked change reports success while the role stays put.
    if (!updatedRows || updatedRows.length === 0) {
      return { error: 'The role change was blocked. No changes were made.' }
    }
    await logAuditEvent(supabase, user.id, 'member_role_changed', 'user', targetUserId, {
      group_id: groupId,
      from_role: targetMembership.role,
      to_role: newRole,
    })

    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) }
)

/**
 * Removes a member from a group (kick).
 * Admins can kick anyone except other admins.
 * Moderators can kick user/noob only.
 */
export const kickMember = withAuth(
  async ({ supabase, user }, groupId: string, targetUserId: string): Promise<{ error: string } | { ok: true }> => {
    const callerGate = await gateGroupRole(supabase, {
      groupId,
      userId: user.id,
      predicate: PERMISSIONS.canKickMembers,
      deniedMessage: 'You do not have permission to kick members.',
    })

    if ('error' in callerGate) return { error: callerGate.error }

    const callerRole = callerGate.membership.role

    if (targetUserId === user.id) {
      return { error: 'Use "Leave Group" to remove yourself.' }
    }

    const { data: targetMembership, error: targetError } = await supabase
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', targetUserId)
      .single()

    if (targetError) return { error: targetError.message }
    const targetRole = targetMembership?.role
    if (!targetRole) {
      return { error: 'Target member was not found.' }
    }

    // Moderators cannot kick admins or other moderators
    if (callerRole === 'moderator' && targetRole && ['admin', 'moderator'].includes(targetRole)) {
      return { error: 'Moderators can only kick users and noobs.' }
    }

    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('owner_id')
      .eq('id', groupId)
      .single()

    if (groupError) return { error: groupError.message }

    // Nobody can kick the owner; only the owner can kick admins.
    if (targetUserId === group?.owner_id) {
      return { error: 'The group owner cannot be kicked.' }
    }
    if (targetRole === 'admin' && group?.owner_id !== user.id) {
      return { error: 'Only the owner can kick an admin.' }
    }

    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', targetUserId)

    if (error) return { error: error.message }
    await logAuditEvent(supabase, user.id, 'member_kicked', 'user', targetUserId, {
      group_id: groupId,
      actor_role: callerRole,
      target_role: targetRole,
    })

    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) }
)
