'use server'

import { withAuth } from '@/lib/actions/withAuth'
import { createChannelInternal, CHANNEL_MANAGE_DENIED, normalizeChannelName } from '@/lib/channels/createChannelInternal'
import { gateGroupRole } from '@/lib/permissions/gate'
import { PERMISSIONS } from '@/lib/permissions'
import { redirect } from 'next/navigation'

/** Creates a text channel inside a group. Channel manager only. */
export const createChannel = withAuth(
  async function createChannelBody(
    { supabase, user },
    formData: FormData,
  ): Promise<{ error: string } | never> {
    const name = formData.get('name') as string
    const groupId = formData.get('group_id') as string

    if (!normalizeChannelName(name ?? '')) return { error: 'Channel name is required.' }
    if (!groupId) return { error: 'Missing group.' }

    const gateResult = await gateGroupRole(supabase, {
      groupId,
      userId: user.id,
      predicate: PERMISSIONS.canManageChannels,
      deniedMessage: CHANNEL_MANAGE_DENIED,
    })
    if ('error' in gateResult) return gateResult

    const result = await createChannelInternal(supabase, {
      groupId,
      name,
      description: formData.get('description') as string | null,
      noobAccess: formData.get('noob_access') === 'on',
    })

    if ('error' in result) return result
    redirect(`/channels/${result.channel.id}`)
  },
  { unauthenticated: () => redirect('/login') },
)

/** Updates channel name, topic, and access settings. */
export const updateChannelSettings = withAuth(
  async function updateChannelSettingsBody(
    { supabase, user },
    channelId: string,
    formData: FormData,
  ): Promise<{ error: string } | { ok: true }> {
    const name = (formData.get('name') as string).trim().toLowerCase().replace(/\s+/g, '-')
    const description = ((formData.get('description') as string | null) ?? '').trim()
    const noobAccess = formData.get('noob_access') === 'on'

    if (!channelId) return { error: 'Missing channel.' }
    if (!name) return { error: 'Channel name is required.' }
    if (name.length > 80) return { error: 'Channel name must be 80 characters or fewer.' }
    if (description.length > 180) return { error: 'Topic must be 180 characters or fewer.' }

    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .select('id, group_id')
      .eq('id', channelId)
      .single()

    if (channelError && channelError.code !== 'PGRST116') return { error: channelError.message }
    if (!channel) return { error: 'Channel not found.' }

    const gateResult = await gateGroupRole(supabase, {
      groupId: channel.group_id,
      userId: user.id,
      predicate: PERMISSIONS.canManageChannels,
      deniedMessage: CHANNEL_MANAGE_DENIED,
    })
    if ('error' in gateResult) return gateResult

    const { error } = await supabase
      .from('channels')
      .update({
        name,
        description: description || null,
        noob_access: noobAccess,
      })
      .eq('id', channelId)

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Deletes a channel. Channel manager only. */
export const deleteChannel = withAuth(
  async function deleteChannelBody(
    { supabase, user },
    channelId: string,
    groupId: string,
  ): Promise<{ error: string } | never> {
    const gateResult = await gateGroupRole(supabase, {
      groupId,
      userId: user.id,
      predicate: PERMISSIONS.canManageChannels,
      deniedMessage: CHANNEL_MANAGE_DENIED,
    })
    if ('error' in gateResult) return gateResult

    const { error } = await supabase
      .from('channels')
      .delete()
      .eq('id', channelId)

    if (error) return { error: error.message }
    redirect(`/groups/${groupId}`)
  },
  { unauthenticated: () => redirect('/login') },
)

/** Swaps a channel's position with the one above or below it. */
export const moveChannel = withAuth(
  async function moveChannelBody(
    { supabase, user },
    channelId: string,
    direction: 'up' | 'down',
  ): Promise<{ error: string } | void> {
    // Get the channel we're moving
    const { data: ch, error: channelError } = await supabase
      .from('channels')
      .select('id, group_id, position')
      .eq('id', channelId)
      .single()

    if (channelError) return { error: channelError.message }
    if (!ch) return { error: 'Channel not found.' }

    const gateResult = await gateGroupRole(supabase, {
      groupId: ch.group_id,
      userId: user.id,
      predicate: PERMISSIONS.canManageChannels,
      deniedMessage: CHANNEL_MANAGE_DENIED,
    })
    if ('error' in gateResult) return gateResult

    // Find the adjacent channel
    const { data: adjacent, error: adjacentError } = await supabase
      .from('channels')
      .select('id, position')
      .eq('group_id', ch.group_id)
      .eq('position', direction === 'up' ? ch.position - 1 : ch.position + 1)
      .single()

    if (adjacentError) return { error: adjacentError.message }
    if (!adjacent) return // already at boundary

    // Swap positions
    const { error: channelUpdateError } = await supabase
      .from('channels')
      .update({ position: adjacent.position })
      .eq('id', ch.id)

    if (channelUpdateError) return { error: channelUpdateError.message }

    const { error: adjacentUpdateError } = await supabase
      .from('channels')
      .update({ position: ch.position })
      .eq('id', adjacent.id)

    if (adjacentUpdateError) return { error: adjacentUpdateError.message }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)
