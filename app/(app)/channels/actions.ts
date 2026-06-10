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

    const categoryId = (formData.get('category_id') as string | null) || null
    const rawKind = (formData.get('kind') as string | null) || 'text'
    const kind = (['text', 'voice', 'forum'].includes(rawKind) ? rawKind : 'text') as 'text' | 'voice' | 'forum'

    const result = await createChannelInternal(supabase, {
      groupId,
      name,
      description: formData.get('description') as string | null,
      noobAccess: formData.get('noob_access') === 'on',
      categoryId,
      kind,
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
    const rawCategoryId = formData.get('category_id') as string | null
    const categoryId = rawCategoryId === null ? undefined : rawCategoryId || null

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

    // Categories must belong to the channel's own group.
    if (categoryId) {
      const { data: category, error: categoryError } = await supabase
        .from('channel_categories')
        .select('id, group_id')
        .eq('id', categoryId)
        .single()

      if (categoryError && categoryError.code !== 'PGRST116') return { error: categoryError.message }
      if (!category || category.group_id !== channel.group_id) {
        return { error: 'Category not found in this group.' }
      }
    }

    const { error } = await supabase
      .from('channels')
      .update({
        name,
        description: description || null,
        noob_access: noobAccess,
        ...(categoryId !== undefined ? { category_id: categoryId } : {}),
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
      .select('id, group_id, position, category_id')
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

    // Reorder happens within the channel's own category section, so find the
    // neighbor among siblings sharing the same category (or no category).
    let siblingQuery = supabase
      .from('channels')
      .select('id, position')
      .eq('group_id', ch.group_id)
      .order('position', { ascending: true })

    siblingQuery = ch.category_id === null
      ? siblingQuery.is('category_id', null)
      : siblingQuery.eq('category_id', ch.category_id)

    const { data: siblings, error: siblingsError } = await siblingQuery
    if (siblingsError) return { error: siblingsError.message }

    const index = (siblings ?? []).findIndex((c) => c.id === ch.id)
    const neighborIndex = direction === 'up' ? index - 1 : index + 1
    const adjacent = siblings?.[neighborIndex]
    if (index === -1 || !adjacent) return // already at boundary

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
