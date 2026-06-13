import type { SupabaseClient } from '@supabase/supabase-js'

export const CHANNEL_MANAGE_DENIED = 'You do not have permission to manage channels.'

export type ChannelKindInput = 'text' | 'voice' | 'forum'

export type ChannelInput = {
  groupId: string
  name: string
  description?: string | null
  noobAccess?: boolean
  kind?: ChannelKindInput
  categoryId?: string | null
}

export type NormalizedChannelInput = {
  groupId: string
  name: string
  description: string | null
  noobAccess: boolean
  kind: ChannelKindInput
  categoryId: string | null
}

export type CreateChannelInternalResult =
  | { ok: true; channel: { id: string; group_id: string; name: string; description: string | null; noob_access: boolean; position: number } }
  | { error: string }

const VALID_KINDS: ChannelKindInput[] = ['text', 'voice', 'forum']

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

  const kind = input.kind ?? 'text'
  if (!VALID_KINDS.includes(kind)) return { error: 'Invalid channel type.' }

  const { data: existing, error } = await supabase
    .from('channels')
    .select('id')
    .eq('group_id', groupId)
    .eq('name', name)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') return { error: error.message }
  if (existing) return { error: 'Channel name already exists.' }

  const categoryId = input.categoryId ?? null
  if (categoryId) {
    const { data: category, error: categoryError } = await supabase
      .from('channel_categories')
      .select('id, group_id')
      .eq('id', categoryId)
      .maybeSingle()

    if (categoryError && categoryError.code !== 'PGRST116') return { error: categoryError.message }
    if (!category || (category as { group_id: string }).group_id !== groupId) {
      return { error: 'Category not found in this group.' }
    }
  }

  return {
    ok: true,
    value: {
      groupId,
      name,
      description: description || null,
      noobAccess: Boolean(input.noobAccess),
      kind,
      categoryId,
    },
  }
}

type ChannelRow = {
  id: string
  group_id: string
  name: string
  description: string | null
  noob_access: boolean
  position: number
}

export async function createChannelInternal(
  supabase: Pick<SupabaseClient, 'rpc' | 'from'>,
  input: ChannelInput,
): Promise<CreateChannelInternalResult> {
  // App-side validation (friendly errors). The create_channel function
  // re-validates and re-authorizes server-side, so this is for UX only.
  const validation = await validateChannelInput(supabase, input)
  if ('error' in validation) return validation
  const { groupId, name, description, noobAccess, kind, categoryId } = validation.value

  // The insert runs inside a SECURITY DEFINER function: authorization is
  // enforced there against auth.uid() (owner or admin/moderator), and the
  // definer-owned INSERT bypasses the channels WITH CHECK that rejects
  // authorized inserts on the production runtime. No service-role key.
  const { data, error } = await supabase.rpc('create_channel', {
    p_group_id: groupId,
    p_name: name,
    p_description: description,
    p_noob_access: noobAccess,
    p_kind: kind,
    p_category_id: categoryId,
  })

  if (error) return { error: error.message }
  const channel = (Array.isArray(data) ? data[0] : data) as ChannelRow | null
  if (!channel) return { error: 'Failed to create channel.' }

  return {
    ok: true,
    channel: {
      id: channel.id,
      group_id: channel.group_id,
      name: channel.name,
      description: channel.description,
      noob_access: channel.noob_access,
      position: channel.position,
    },
  }
}
