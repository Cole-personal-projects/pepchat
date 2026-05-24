'use server'

import { withAuth } from '@/lib/actions/withAuth'
import { withSideEffects } from '@/lib/actions/sideEffects'
import { validateChannelInput } from '@/lib/channels/createChannelInternal'
import { PERMISSIONS } from '@/lib/permissions'
import { gateGroupRole } from '@/lib/permissions/gate'

const PROMOTE_DENIED = 'You do not have permission to promote this thread.'

type PromoteThreadInput = {
  rootMessageId: string
  channelName: string
  channelTopic?: string
  noobAccess?: boolean
}

type RootMessageRow = {
  id: string
  channel_id: string
  thread_root_id: string | null
  user_id: string
}

type SourceChannelRow = {
  id: string
  group_id: string
  noob_access: boolean
}

type PromoteRpcRow = {
  new_channel_id: string
  moved_reply_count: number
}

type PromoteThreadOutput =
  | { newChannelId: string; movedReplyCount: number }
  | { error: string }

async function broadcastPromotion(
  supabase: { channel?: (topic: string) => { send: (payload: { type: 'broadcast'; event: string; payload: unknown }) => Promise<unknown> } },
  input: { rootMessageId: string; groupId: string; newChannelId: string; channel: unknown },
) {
  if (!supabase.channel) return

  await supabase.channel(`thread-${input.rootMessageId}`).send({
    type: 'broadcast',
    event: 'thread_promoted',
    payload: { newChannelId: input.newChannelId },
  })

  await supabase.channel(`channels-${input.groupId}`).send({
    type: 'broadcast',
    event: 'channel_added',
    payload: input.channel,
  })
}

export const promoteThreadToChannel = withAuth(
  async ({ supabase, user }, input: PromoteThreadInput): Promise<PromoteThreadOutput> => {
    const rootMessageId = input.rootMessageId?.trim()
    if (!rootMessageId) return { error: 'Missing thread root.' }

    const { data: root, error: rootError } = await supabase
      .from('messages')
      .select('id, channel_id, thread_root_id, user_id')
      .eq('id', rootMessageId)
      .maybeSingle()

    if (rootError) return { error: rootError.message }
    if (!root) return { error: 'Thread root not found.' }
    const rootMessage = root as RootMessageRow
    if (rootMessage.thread_root_id) return { error: 'Cannot promote a thread reply.' }

    const { data: sourceChannel, error: sourceChannelError } = await supabase
      .from('channels')
      .select('id, group_id, noob_access')
      .eq('id', rootMessage.channel_id)
      .single()

    if (sourceChannelError) return { error: sourceChannelError.message }
    if (!sourceChannel) return { error: 'Source channel not found.' }
    const channel = sourceChannel as SourceChannelRow
    const isRootAuthor = rootMessage.user_id === user.id

    const gateResult = await gateGroupRole(supabase, {
      groupId: channel.group_id,
      userId: user.id,
      predicate: role => PERMISSIONS.canPromoteThread(role, isRootAuthor),
      deniedMessage: PROMOTE_DENIED,
    })
    if ('error' in gateResult) return gateResult

    const noobAccess = input.noobAccess ?? channel.noob_access
    const validation = await validateChannelInput(supabase, {
      groupId: channel.group_id,
      name: input.channelName,
      description: input.channelTopic,
      noobAccess,
    })
    if ('error' in validation) return validation

    const auditMetadata = {
      source_channel_id: rootMessage.channel_id,
      target_channel_id: '',
      root_message_id: rootMessageId,
      moved_reply_count: 0,
    }

    let output: { newChannelId: string; movedReplyCount: number }
    try {
      const sideEffectResult = await withSideEffects(
        supabase,
        user.id,
        async () => {
          const { data, error } = await supabase.rpc('promote_thread_to_channel', {
            p_root_message_id: rootMessageId,
            p_new_channel_name: validation.value.name,
            p_new_channel_topic: validation.value.description,
            p_noob_access: validation.value.noobAccess,
            p_actor_id: user.id,
          })

          if (error) throw new Error(error.message)
          const row = Array.isArray(data) ? data[0] : data
          if (!row) throw new Error('Failed to promote thread.')
          const result = row as PromoteRpcRow
          return {
            newChannelId: result.new_channel_id,
            movedReplyCount: result.moved_reply_count,
          }
        },
        {
          onFailure: 'bubble',
          audit: {
            action: 'thread.promoted_to_channel',
            targetType: 'message',
            targetId: rootMessageId,
            metadata: auditMetadata,
          },
          afterCommit(result) {
            auditMetadata.target_channel_id = result.newChannelId
            auditMetadata.moved_reply_count = result.movedReplyCount
          },
        },
      )
      output = sideEffectResult.data
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to promote thread.' }
    }

    const { data: newChannel } = await supabase
      .from('channels')
      .select('id, group_id, name, description, noob_access, position, created_at')
      .eq('id', output.newChannelId)
      .single()

    try {
      await broadcastPromotion(supabase, {
        rootMessageId,
        groupId: channel.group_id,
        newChannelId: output.newChannelId,
        channel: newChannel,
      })
    } catch {
      // Realtime broadcasts are best-effort and must not roll back a committed promotion.
    }

    return output
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)
