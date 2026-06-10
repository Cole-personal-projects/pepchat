import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role, RolePredicate } from '@/lib/permissions'

export type GroupRoleGateResult =
  | { ok: true; membership: { role: Role } }
  | { error: string }

export type GroupPermissionGateResult = { ok: true } | { error: string }

/**
 * Bitfield permission gate backed by the has_permission() SQL engine.
 * Pass channelId for channel-scoped checks (overwrites apply); omit for
 * group-scoped checks. The bit is serialized as a string so values above
 * 2^53 stay exact.
 */
export async function gateGroupPermission(
  supabase: SupabaseClient,
  input: {
    groupId: string
    userId: string
    bit: bigint
    channelId?: string | null
    deniedMessage: string
  }
): Promise<GroupPermissionGateResult> {
  const { data, error } = await supabase.rpc('has_permission', {
    p_group_id: input.groupId,
    p_channel_id: input.channelId ?? null,
    p_bit: input.bit.toString(),
    p_user_id: input.userId,
  })

  if (error) return { error: error.message }
  if (data !== true) return { error: input.deniedMessage }
  return { ok: true }
}

export async function gateGroupRole(
  supabase: SupabaseClient,
  input: {
    groupId: string
    userId: string
    predicate: RolePredicate
    deniedMessage: string
  }
): Promise<GroupRoleGateResult> {
  const { data: membership, error } = await supabase
    .from('group_members')
    .select('role')
    .eq('group_id', input.groupId)
    .eq('user_id', input.userId)
    .single()

  if (error && error.code !== 'PGRST116') return { error: error.message }

  const role = membership?.role as Role | undefined
  if (!role || !input.predicate(role)) {
    return { error: input.deniedMessage }
  }

  return { ok: true, membership: { role } }
}
