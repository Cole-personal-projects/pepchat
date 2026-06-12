'use server'

import { withAuth } from '@/lib/actions/withAuth'

/**
 * Toggle an emoji reaction on a message.
 * If the current user already has this reaction, it is removed.
 * Otherwise it is added.
 * Returns the action taken so the client can sync optimistic state.
 */
export const toggleReaction = withAuth(
  async ({ supabase, user }, messageId: string, emoji: string): Promise<{ error: string } | { ok: true; action: 'added' | 'removed' }> => {
    // Check if the reaction already exists
    const { data: existing } = await supabase
      .from('message_reactions')
      .select('id')
      .eq('message_id', messageId)
      .eq('user_id', user.id)
      .eq('emoji', emoji)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('message_reactions')
        .delete()
        .eq('id', existing.id)
      if (error) return { error: error.message }
      return { ok: true, action: 'removed' }
    } else {
      const { error } = await supabase
        .from('message_reactions')
        .insert({ message_id: messageId, user_id: user.id, emoji })
      if (error) return { error: error.message }

      // Starboard check rides the add path; it must never block the reaction.
      try {
        const { maybeStarboardMessage } = await import('@/lib/starboard')
        await maybeStarboardMessage(supabase, messageId, user.id, emoji)
      } catch {
        // Best-effort only.
      }

      return { ok: true, action: 'added' }
    }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)
