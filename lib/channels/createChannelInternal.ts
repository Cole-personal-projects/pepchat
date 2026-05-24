import type { SupabaseClient } from '@supabase/supabase-js'

export const CHANNEL_MANAGE_DENIED = 'You do not have permission to manage channels.'

export type ChannelInput = {
  groupId: string
  name: string
  description?: string | null
  noobAccess?: boolean
}

export type NormalizedChannelInput = {
  groupId: string
  name: string
  description: string | null
  noobAccess: boolean
}

export type CreateChannelInternalResult =
  | { ok: true; channel: { id: string; group_id: string; name: string; description: string | null; noob_access: boolean; position: number } }
  | { error: string }

export function normalizeChannelName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}

export async function validateChannelInput(
  supabase: Pick<SupabaseClient, 'from'>,
  input: ChannelInput,
): Promise<{ ok: true; value: NormalizedChannelInput } | { error: string }> {
  const name = normalizeChannelName(input.name ?? '')
  const description = (input.description ?? '').trim()
  const groupId = input.groupId

  if (!name) return { error: 'Channel name is required.' }
  if (!groupId) return { error: 'Missing group.' }
  if (name.length > 80) return { error: 'Channel name must be 80 characters or fewer.' }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return { error: 'Channel name may only contain lowercase letters, numbers, and hyphens.' }
  }
  if (description.length > 180) return { error: 'Topic must be 180 characters or fewer.' }

  const { data: existing, error } = await supabase
    .from('channels')
    .select('id')
    .eq('group_id', groupId)
    .eq('name', name)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') return { error: error.message }
  if (existing) return { error: 'Channel name already exists.' }

  return {
    ok: true,
    value: {
      groupId,
      name,
      description: description || null,
      noobAccess: Boolean(input.noobAccess),
    },
  }
}

export async function createChannelInternal(
  supabase: Pick<SupabaseClient, 'from'>,
  input: ChannelInput,
): Promise<CreateChannelInternalResult> {
  const validation = await validateChannelInput(supabase, input)
  if ('error' in validation) return validation
  const { groupId, name, description, noobAccess } = validation.value

  const { data: existingPositions } = await supabase
    .from('channels')
    .select('position')
    .eq('group_id', groupId)
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = existingPositions && existingPositions.length > 0 ? existingPositions[0].position + 1 : 0

  const { data: channel, error } = await supabase
    .from('channels')
    .insert({
      group_id: groupId,
      name,
      description,
      noob_access: noobAccess,
      position: nextPosition,
    })
    .select('id, group_id, name, description, noob_access, position')
    .single()

  if (error || !channel) return { error: error?.message ?? 'Failed to create channel.' }
  return { ok: true, channel: channel as CreateChannelInternalResult extends { ok: true; channel: infer C } ? C : never }
}
