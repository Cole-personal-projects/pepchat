'use server'

import { withAuth } from '@/lib/actions/withAuth'
import { logAuditEvent } from '@/lib/audit'
import {
  consumeInvite,
  listInvites,
  normalizeInviteCode,
  parseInviteOptions,
  regenerateInvite,
  resolveInvite,
  revokeInvite,
  type InviteRecord,
} from '@/lib/invites'
import { inviteLookupClient } from '@/lib/invites/lookupClient'
import { gateGroupRole } from '@/lib/permissions/gate'
import { PERMISSIONS } from '@/lib/permissions'
import { redirect } from 'next/navigation'

/**
 * Creates a new group. Creator gets the 'admin' role.
 * Seeds both a #general and a #welcome channel.
 */
export const createGroup = withAuth(
  async function createGroupBody(
    { supabase, user },
    formData: FormData,
  ): Promise<{ error: string } | { redirectTo: string }> {
    const name = (formData.get('name') as string).trim()
    if (!name) return { error: 'Group name is required.' }
    if (name.length > 100) return { error: 'Name must be 100 characters or fewer.' }

    const { data: group, error: groupError } = await supabase
      .from('groups')
      .insert({ name, owner_id: user.id })
      .select()
      .single()

    if (groupError || !group) return { error: groupError?.message ?? 'Failed to create group.' }

    // Creator is the admin
    const { error: memberError } = await supabase.from('group_members').insert({
      group_id: group.id,
      user_id: user.id,
      role: 'admin',
    })
    if (memberError) return { error: memberError.message }

    // Seed #welcome (position 0) and #general (position 1)
    const { error: channelError } = await supabase.from('channels').insert([
      { group_id: group.id, name: 'welcome', description: 'Start here for intros and first steps.', noob_access: true, position: 0 },
      { group_id: group.id, name: 'general', position: 1 },
    ])
    if (channelError) return { error: channelError.message }

    const { data: generalChannel } = await supabase
      .from('channels')
      .select('id')
      .eq('group_id', group.id)
      .eq('name', 'general')
      .single()

    return { redirectTo: generalChannel ? `/channels/${generalChannel.id}` : `/groups/${group.id}` }
  },
  { unauthenticated: () => ({ redirectTo: '/login' }) },
)

/**
 * Joins an existing group via invite code.
 * New members start with the 'noob' role.
 */
export const joinGroup = withAuth(
  async function joinGroupBody(
    { supabase, user },
    formData: FormData,
  ): Promise<{ error: string } | { redirectTo: string }> {
    const inviteCode = normalizeInviteCode(formData.get('invite_code') as string)
    const resolved = await resolveInvite(supabase, inviteCode, {
      authoritativeSupabase: inviteLookupClient(supabase),
    })

    if (!resolved.ok) return { error: resolved.message }

    const consumed = await consumeInvite(supabase, resolved.invite, user.id)
    if (!consumed.ok) return { error: consumed.message }

    return { redirectTo: `/groups/${consumed.groupId}` }
  },
  { unauthenticated: () => ({ redirectTo: '/login' }) },
)

/**
 * Updates basic group details. Group admins only.
 */
export const updateGroupDetails = withAuth(
  async function updateGroupDetailsBody(
    { supabase, user },
    groupId: string,
    formData: FormData,
  ): Promise<{ error: string } | { ok: true }> {
    const gateResult = await gateGroupRole(supabase, { groupId, userId: user.id, predicate: PERMISSIONS.canManageGroup, deniedMessage: 'Only group admins can update group details.' })
    if ('error' in gateResult) return { error: gateResult.error }

    const name = (formData.get('name') as string | null)?.trim() ?? ''
    const description = (formData.get('description') as string | null)?.trim() ?? ''

    if (!name) return { error: 'Group name is required.' }
    if (name.length > 100) return { error: 'Name must be 100 characters or fewer.' }
    if (description.length > 180) return { error: 'Description must be 180 characters or fewer.' }

    const { error } = await supabase
      .from('groups')
      .update({ name, description: description || null })
      .eq('id', groupId)
      .eq('owner_id', user.id)

    if (error) return { error: error.message }
    await logAuditEvent(supabase, user.id, 'group_details_updated', 'group', groupId, {
      name,
      description: description || null,
    })
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/**
 * Configures the starboard: which channel ⭐-boarded messages repost into
 * (null disables) and how many stars it takes. Owner-only via groups RLS.
 */
export const updateStarboardSettings = withAuth(
  async (
    { supabase, user },
    groupId: string,
    starboardChannelId: string | null,
    threshold: number,
  ): Promise<{ error: string } | { ok: true }> => {
    const gateResult = await gateGroupRole(supabase, { groupId, userId: user.id, predicate: PERMISSIONS.canManageGroup, deniedMessage: 'Only group admins can update the starboard.' })
    if ('error' in gateResult) return { error: gateResult.error }

    const bounded = Math.trunc(threshold)
    if (!Number.isFinite(bounded) || bounded < 1 || bounded > 50) {
      return { error: 'Star threshold must be between 1 and 50.' }
    }

    if (starboardChannelId) {
      const { data: channel } = await supabase
        .from('channels')
        .select('id, group_id, kind')
        .eq('id', starboardChannelId)
        .maybeSingle()
      const row = channel as { id: string; group_id: string; kind: string | null } | null
      if (!row || row.group_id !== groupId) return { error: 'Pick a channel in this group.' }
      if (row.kind === 'voice') return { error: 'The starboard channel must be a text channel.' }
    }

    const { data: updated, error } = await supabase
      .from('groups')
      .update({ starboard_channel_id: starboardChannelId, starboard_threshold: bounded })
      .eq('id', groupId)
      .eq('owner_id', user.id)
      .select('id')

    if (error) return { error: error.message }
    if (!updated || updated.length === 0) {
      return { error: 'Only the group owner can change starboard settings.' }
    }

    await logAuditEvent(supabase, user.id, 'group_starboard_updated', 'group', groupId, {
      starboard_channel_id: starboardChannelId,
      starboard_threshold: bounded,
    })
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/**
 * Rotates a group's invite code. Group admins only.
 */
export const regenerateGroupInvite = withAuth(
  async function regenerateGroupInviteBody(
    { supabase, user },
    groupId: string,
    formData?: FormData,
  ): Promise<{ error: string } | { ok: true; invite_code: string; invite: InviteRecord }> {
    const gateResult = await gateGroupRole(supabase, { groupId, userId: user.id, predicate: PERMISSIONS.canManageGroup, deniedMessage: 'Only group admins can regenerate invite links.' })
    if ('error' in gateResult) return { error: gateResult.error }

    const options = parseInviteOptions(formData)
    if ('error' in options) return { error: options.error ?? 'Invalid invite options.' }

    const result = await regenerateInvite(supabase, {
      groupId,
      createdBy: user.id,
      options,
    })

    if ('error' in result) return result

    const { invite_code, invite } = result
    const { error } = await supabase
      .from('groups')
      .update({ invite_code })
      .eq('id', groupId)
      .eq('owner_id', user.id)

    if (error) return { error: error.message }
    await logAuditEvent(supabase, user.id, 'invite_regenerated', 'invite', invite.id, {
      group_id: groupId,
      max_uses: options.max_uses,
      expires_at: options.expires_at,
    })
    return { ok: true, invite_code, invite }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

export const listGroupInvites = withAuth(
  async function listGroupInvitesBody(
    { supabase, user },
    groupId: string,
  ): Promise<{ error: string } | { ok: true; invites: InviteRecord[]; uses: any[] }> {
    const gateResult = await gateGroupRole(supabase, { groupId, userId: user.id, predicate: PERMISSIONS.canManageGroup, deniedMessage: 'Only group admins can view invite history.' })
    if ('error' in gateResult) return { error: gateResult.error }

    const result = await listInvites(supabase, groupId)
    if ('error' in result) return result

    return result
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

export const revokeGroupInvite = withAuth(
  async function revokeGroupInviteBody(
    { supabase, user },
    inviteId: string,
    groupId: string,
  ): Promise<{ error: string } | { ok: true }> {
    const gateResult = await gateGroupRole(supabase, { groupId, userId: user.id, predicate: PERMISSIONS.canManageGroup, deniedMessage: 'Only group admins can revoke invites.' })
    if ('error' in gateResult) return { error: gateResult.error }

    const result = await revokeInvite(supabase, { inviteId, groupId })
    if ('error' in result) return result

    await logAuditEvent(supabase, user.id, 'invite_revoked', 'invite', inviteId, {
      group_id: groupId,
    })
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/**
 * Leaves a group. Admins must delete the group instead.
 */
export const leaveGroup = withAuth(
  async function leaveGroupBody(
    { supabase, user },
    groupId: string,
  ): Promise<{ error: string } | never> {
    // The owner must hand off the server before leaving; other admins may go.
    const { data: group } = await supabase
      .from('groups')
      .select('owner_id')
      .eq('id', groupId)
      .single()

    if (group?.owner_id === user.id) {
      return { error: 'Owners cannot leave. Transfer ownership or delete the group instead.' }
    }

    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', user.id)

    if (error) return { error: error.message }
    redirect('/channels')
  },
  { unauthenticated: () => redirect('/login') },
)

/**
 * Hands the server to another member. Owner-only and irreversible from the
 * UI: the target becomes the owner (and admin); the old owner stays an
 * admin so they keep day-to-day management without the crown.
 */
export const transferOwnership = withAuth(
  async function transferOwnershipBody(
    { supabase, user },
    groupId: string,
    newOwnerId: string,
  ): Promise<{ error: string } | { ok: true }> {
    if (!groupId || !newOwnerId) return { error: 'Missing group or member.' }
    if (newOwnerId === user.id) return { error: 'You already own this group.' }

    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('owner_id')
      .eq('id', groupId)
      .single()

    if (groupError) return { error: groupError.message }
    if (group?.owner_id !== user.id) {
      return { error: 'Only the owner can transfer ownership.' }
    }

    const { data: targetMembership, error: targetError } = await supabase
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', newOwnerId)
      .single()

    if (targetError && targetError.code !== 'PGRST116') return { error: targetError.message }
    if (!targetMembership?.role) {
      return { error: 'The new owner must be a member of this group.' }
    }

    // Promote the new owner to the admin tier first — while the caller still
    // holds owner privileges under RLS.
    if (targetMembership.role !== 'admin') {
      const { error: promoteError } = await supabase
        .from('group_members')
        .update({ role: 'admin' })
        .eq('group_id', groupId)
        .eq('user_id', newOwnerId)
      if (promoteError) return { error: promoteError.message }
    }

    const { error: ownerError } = await supabase
      .from('groups')
      .update({ owner_id: newOwnerId })
      .eq('id', groupId)
      .eq('owner_id', user.id)

    if (ownerError) return { error: ownerError.message }

    await logAuditEvent(supabase, user.id, 'ownership_transferred', 'user', newOwnerId, {
      group_id: groupId,
      previous_owner: user.id,
    })

    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/**
 * Uploads a group icon for a group the caller owns or admins.
 * Overwrites any existing icon at the same path.
 */
export const uploadGroupIcon = withAuth(
  async function uploadGroupIconBody(
    { supabase, user },
    groupId: string,
    iconBlob: { dataUrl: string; ext: string },
  ): Promise<{ error: string } | { ok: true; icon_url: string }> {
    const gateResult = await gateGroupRole(supabase, { groupId, userId: user.id, predicate: PERMISSIONS.canManageGroup, deniedMessage: 'Only group admins can update the group photo.' })
    if ('error' in gateResult) return { error: gateResult.error }

    const bytes = Buffer.from(iconBlob.dataUrl.split(',')[1], 'base64')
    const path = `groups/${groupId}/icon.${iconBlob.ext}`
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, bytes, {
        contentType: `image/${iconBlob.ext === 'jpg' ? 'jpeg' : iconBlob.ext}`,
        upsert: true,
      })
    if (uploadError) return { error: 'Icon upload failed.' }

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const icon_url = `${urlData.publicUrl}?t=${Date.now()}`

    const { error: updateError } = await supabase
      .from('groups')
      .update({ icon_url })
      .eq('id', groupId)

    if (updateError) return { error: updateError.message }
    await logAuditEvent(supabase, user.id, 'group_icon_updated', 'group', groupId, {
      icon_ext: iconBlob.ext,
    })
    return { ok: true, icon_url }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/**
 * Removes the group icon, reverting to the colored bubble fallback.
 */
export const removeGroupIcon = withAuth(
  async function removeGroupIconBody(
    { supabase, user },
    groupId: string,
  ): Promise<{ error: string } | { ok: true }> {
    const gateResult = await gateGroupRole(supabase, { groupId, userId: user.id, predicate: PERMISSIONS.canManageGroup, deniedMessage: 'Only group admins can remove the group photo.' })
    if ('error' in gateResult) return { error: gateResult.error }

    const files = await supabase.storage.from('avatars').list(`groups/${groupId}`)
    if (files.error) return { error: files.error.message }

    if (files.data?.length) {
      const { error: removeError } = await supabase.storage
        .from('avatars')
        .remove(files.data.map(f => `groups/${groupId}/${f.name}`))
      if (removeError) return { error: removeError.message }
    }

    const { error } = await supabase
      .from('groups')
      .update({ icon_url: null })
      .eq('id', groupId)

    if (error) return { error: error.message }
    await logAuditEvent(supabase, user.id, 'group_icon_removed', 'group', groupId)
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/**
 * Deletes a group (admin only). Cascades to channels and messages.
 */
export const deleteGroup = withAuth(
  async function deleteGroupBody(
    { supabase, user },
    groupId: string,
  ): Promise<{ error: string } | never> {
    const { error } = await supabase
      .from('groups')
      .delete()
      .eq('id', groupId)
      .eq('owner_id', user.id)

    if (error) return { error: error.message }
    redirect('/channels')
  },
  { unauthenticated: () => redirect('/login') },
)
