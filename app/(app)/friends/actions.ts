'use server'

import { withAuth } from '@/lib/actions/withAuth'

const FRIEND_NOT_FOUND = 'No user found with that username.'

type FriendActionResult = { error: string } | { ok: true }

/** Service-role client for username lookups beyond profile-visibility RLS. */
async function adminClientOrNull() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  const { createAdminClient } = await import('@/lib/supabase/admin')
  return createAdminClient()
}

/** Sends a friend request by exact username. */
export const sendFriendRequest = withAuth(
  async function sendFriendRequestBody({ supabase, user }, username: string): Promise<FriendActionResult> {
    const normalized = (username ?? '').trim().replace(/^@/, '')
    if (!normalized) return { error: 'Enter a username.' }

    // Username lookup must work for users outside your groups; the
    // service-role client performs it after authentication.
    const admin = await adminClientOrNull()
    const lookupClient = admin ?? supabase
    const { data: target, error: lookupError } = await lookupClient
      .from('profiles')
      .select('id, username')
      .eq('username', normalized)
      .maybeSingle()

    if (lookupError && lookupError.code !== 'PGRST116') return { error: lookupError.message }
    if (!target) return { error: FRIEND_NOT_FOUND }
    if ((target as { id: string }).id === user.id) return { error: 'You cannot friend yourself.' }

    const targetId = (target as { id: string }).id

    // One row per pair: reject duplicates/blocks with friendly messages.
    const { data: existing, error: existingError } = await supabase
      .from('friendships')
      .select('id, status, requester_id, addressee_id, blocked_by')
      .or(`and(requester_id.eq.${user.id},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${user.id})`)
      .maybeSingle()

    if (existingError && existingError.code !== 'PGRST116') return { error: existingError.message }
    if (existing) {
      const row = existing as { status: string; blocked_by: string | null }
      if (row.status === 'accepted') return { error: 'You are already friends.' }
      if (row.status === 'pending') return { error: 'A friend request is already pending.' }
      if (row.status === 'blocked') {
        return row.blocked_by === user.id
          ? { error: 'Unblock this user before sending a request.' }
          : { error: FRIEND_NOT_FOUND }
      }
    }

    const { error } = await supabase.from('friendships').insert({
      requester_id: user.id,
      addressee_id: targetId,
      status: 'pending',
    })

    if (error) {
      if (error.code === '23505') return { error: 'A friend request is already pending.' }
      return { error: error.message }
    }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Accepts a pending request addressed to the caller. */
export const acceptFriendRequest = withAuth(
  async function acceptFriendRequestBody({ supabase, user }, friendshipId: string): Promise<FriendActionResult> {
    if (!friendshipId) return { error: 'Missing request.' }

    const { data: request, error: lookupError } = await supabase
      .from('friendships')
      .select('id, status, addressee_id')
      .eq('id', friendshipId)
      .single()

    if (lookupError && lookupError.code !== 'PGRST116') return { error: lookupError.message }
    if (!request || (request as { status: string }).status !== 'pending') {
      return { error: 'Request not found.' }
    }
    if ((request as { addressee_id: string }).addressee_id !== user.id) {
      return { error: 'Only the recipient can accept a request.' }
    }

    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', friendshipId)

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Declines a pending request, cancels an outgoing one, or removes a friend. */
export const removeFriendship = withAuth(
  async function removeFriendshipBody({ supabase, user }, friendshipId: string): Promise<FriendActionResult> {
    if (!friendshipId) return { error: 'Missing friendship.' }

    const { data: row, error: lookupError } = await supabase
      .from('friendships')
      .select('id, status, blocked_by')
      .eq('id', friendshipId)
      .single()

    if (lookupError && lookupError.code !== 'PGRST116') return { error: lookupError.message }
    if (!row) return { error: 'Friendship not found.' }
    if ((row as { status: string }).status === 'blocked' && (row as { blocked_by: string | null }).blocked_by !== user.id) {
      return { error: 'Friendship not found.' }
    }

    const { error } = await supabase.from('friendships').delete().eq('id', friendshipId)
    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Blocks a user, replacing any existing relationship row. */
export const blockUser = withAuth(
  async function blockUserBody({ supabase, user }, targetUserId: string): Promise<FriendActionResult> {
    if (!targetUserId) return { error: 'Missing user.' }
    if (targetUserId === user.id) return { error: 'You cannot block yourself.' }

    const { data: existing, error: existingError } = await supabase
      .from('friendships')
      .select('id')
      .or(`and(requester_id.eq.${user.id},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${user.id})`)
      .maybeSingle()

    if (existingError && existingError.code !== 'PGRST116') return { error: existingError.message }

    if (existing) {
      const { error } = await supabase
        .from('friendships')
        .update({
          status: 'blocked',
          blocked_by: user.id,
          responded_at: new Date().toISOString(),
        })
        .eq('id', (existing as { id: string }).id)
      if (error) return { error: error.message }
      return { ok: true }
    }

    const { error } = await supabase.from('friendships').insert({
      requester_id: user.id,
      addressee_id: targetUserId,
      status: 'blocked',
      blocked_by: user.id,
    })
    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)
