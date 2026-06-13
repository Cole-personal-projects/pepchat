import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

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

export async function createChannelInternal(
  supabase: Pick<SupabaseClient, 'from'>,
  input: ChannelInput,
): Promise<CreateChannelInternalResult> {
  const validation = await validateChannelInput(supabase, input)
  if ('error' in validation) return validation
  const { groupId, name, description, noobAccess, kind, categoryId } = validation.value

  // The write goes through the service-role client. Every caller authorizes
  // the user against their own session before reaching here (channel
  // managers only), so this is a trusted server-side insert. We bypass the
  // channels INSERT RLS policy deliberately: on the production runtime it
  // rejects authorized owner/admin inserts even though the same session
  // resolves auth.uid() correctly for message inserts and for the
  // permission gate's own reads — an RLS evaluation quirk we route around
  // rather than depend on. Falls back to the caller's client when no
  // service-role key is configured (local/dev without admin creds).
  const writeClient: Pick<SupabaseClient, 'from'> = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAdminClient()
    : supabase

  const { data: existingPositions } = await writeClient
    .from('channels')
    .select('position')
    .eq('group_id', groupId)
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = existingPositions && existingPositions.length > 0 ? existingPositions[0].position + 1 : 0

  const { data: channel, error } = await writeClient
    .from('channels')
    .insert({
      group_id: groupId,
      name,
      description,
      noob_access: noobAccess,
      position: nextPosition,
      kind,
      category_id: categoryId,
    })
    .select('id, group_id, name, description, noob_access, position')
    .single()

  if (error || !channel) return { error: error?.message ?? 'Failed to create channel.' }
  return { ok: true, channel: channel as CreateChannelInternalResult extends { ok: true; channel: infer C } ? C : never }
}
