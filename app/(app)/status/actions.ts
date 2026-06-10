'use server'

import { withAuth } from '@/lib/actions/withAuth'
import type { PresenceMode } from '@/lib/types'

const PRESENCE_MODES: PresenceMode[] = ['online', 'idle', 'dnd', 'invisible']
const MAX_STATUS_TEXT_LENGTH = 128

type StatusActionResult = { error: string } | { ok: true }

/** Sets the caller's presence mode (online / idle / dnd / invisible). */
export const setPresenceMode = withAuth(
  async function setPresenceModeBody({ supabase, user }, mode: PresenceMode): Promise<StatusActionResult> {
    if (!PRESENCE_MODES.includes(mode)) return { error: 'Invalid presence mode.' }

    const { error } = await supabase
      .from('user_status')
      .upsert(
        { user_id: user.id, presence: mode, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Sets a custom status (emoji + text + optional expiry). */
export const setCustomStatus = withAuth(
  async function setCustomStatusBody(
    { supabase, user },
    input: { emoji?: string | null; text?: string | null; expiresAt?: string | null },
  ): Promise<StatusActionResult> {
    const text = (input.text ?? '').trim() || null
    const emoji = (input.emoji ?? '').trim() || null
    if (text && text.length > MAX_STATUS_TEXT_LENGTH) {
      return { error: `Status must be ${MAX_STATUS_TEXT_LENGTH} characters or fewer.` }
    }
    if (input.expiresAt) {
      const expires = new Date(input.expiresAt)
      if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) {
        return { error: 'Status expiry must be in the future.' }
      }
    }

    const { error } = await supabase
      .from('user_status')
      .upsert(
        {
          user_id: user.id,
          status_emoji: emoji,
          status_text: text,
          status_expires_at: input.expiresAt ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)

/** Clears the caller's custom status (presence mode is untouched). */
export const clearCustomStatus = withAuth(
  async function clearCustomStatusBody({ supabase, user }): Promise<StatusActionResult> {
    const { error } = await supabase
      .from('user_status')
      .upsert(
        {
          user_id: user.id,
          status_emoji: null,
          status_text: null,
          status_expires_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => ({ error: 'Not authenticated.' }) },
)
