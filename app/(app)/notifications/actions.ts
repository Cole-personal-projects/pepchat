'use server'

import type {
  NotificationEvent,
  NotificationPreferences,
  NotificationPreferenceUpdate,
  NotificationSubscriptionInput,
} from '@/lib/types'
import { withAuth } from '@/lib/actions/withAuth'

type PreferencesResult =
  | { error: string }
  | { unavailable: true; message: string }
  | { ok: true; preferences: NotificationPreferences }

type SubscriptionResult = { error: string } | { ok: true }

type EventsResult =
  | { error: string }
  | { ok: true; events: NotificationEvent[]; unreadCount: number }

const PREFERENCES_UNAVAILABLE_MESSAGE = 'Notification delivery settings are temporarily unavailable.'

function isMissingNotificationPreferencesTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    (/notification_preferences/i.test(error.message ?? '') && /schema cache|does not exist|relation/i.test(error.message ?? ''))
  )
}

function defaultPreferences(userId: string): NotificationPreferences {
  const now = new Date().toISOString()
  return {
    user_id: userId,
    dm_messages: true,
    mentions: true,
    group_messages: false,
    created_at: now,
    updated_at: now,
  }
}

function preferencePayload(update: NotificationPreferenceUpdate): NotificationPreferenceUpdate {
  const payload: NotificationPreferenceUpdate = {}
  if (typeof update.dm_messages === 'boolean') payload.dm_messages = update.dm_messages
  if (typeof update.mentions === 'boolean') payload.mentions = update.mentions
  if (typeof update.group_messages === 'boolean') payload.group_messages = update.group_messages
  return payload
}

export const getNotificationPreferences = withAuth(
  async ({ supabase, user }): Promise<PreferencesResult> => {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (isMissingNotificationPreferencesTable(error)) {
      return { unavailable: true, message: PREFERENCES_UNAVAILABLE_MESSAGE }
    }

    if (error && error.code !== 'PGRST116') {
      return { error: error.message }
    }

    return { ok: true, preferences: (data as NotificationPreferences | null) ?? defaultPreferences(user.id) }
  },
  { unauthenticated: () => {
    return { error: 'Not authenticated.' }
  }},
)

export const updateNotificationPreferences = withAuth(
  async ({ supabase, user }, update: NotificationPreferenceUpdate): Promise<PreferencesResult> => {
    const payload = preferencePayload(update)
    const { data, error } = await supabase
      .from('notification_preferences')
      .upsert(
        {
          user_id: user.id,
          ...payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select('*')
      .single()

    if (isMissingNotificationPreferencesTable(error)) {
      return { error: PREFERENCES_UNAVAILABLE_MESSAGE }
    }

    if (error || !data) {
      return { error: error?.message ?? "Couldn't save notification preferences." }
    }

    return { ok: true, preferences: data as NotificationPreferences }
  },
  { unauthenticated: () => {
    return { error: 'Not authenticated.' }
  }},
)

export const saveNotificationSubscription = withAuth(
  async ({ supabase, user }, input: NotificationSubscriptionInput): Promise<SubscriptionResult> => {
    const endpoint = input.endpoint?.trim()
    const p256dh = input.keys?.p256dh?.trim()
    const auth = input.keys?.auth?.trim()

    if (!endpoint || !p256dh || !auth) {
      return { error: 'Invalid push subscription.' }
    }

    const { error } = await supabase
      .from('notification_subscriptions')
      .upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh,
          auth,
          user_agent: input.user_agent ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' }
      )

    if (error) {
      return { error: error.message }
    }

    return { ok: true }
  },
  { unauthenticated: () => {
    return { error: 'Not authenticated.' }
  }},
)

export const deleteNotificationSubscription = withAuth(
  async ({ supabase, user }, endpoint: string): Promise<SubscriptionResult> => {
    const normalizedEndpoint = endpoint.trim()
    if (!normalizedEndpoint) return { error: 'Invalid push subscription.' }

    const { error } = await supabase
      .from('notification_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', normalizedEndpoint)

    if (error) {
      return { error: error.message }
    }

    return { ok: true }
  },
  { unauthenticated: () => {
    return { error: 'Not authenticated.' }
  }},
)

export const getNotificationEvents = withAuth(
  async ({ supabase, user }, limit: number = 20): Promise<EventsResult> => {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50)
    const { data, error } = await supabase
      .from('notification_events')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(boundedLimit)

    if (error) return { error: error.message }

    const { count, error: countError } = await supabase
      .from('notification_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null)

    if (countError) return { error: countError.message }

    const events = (data ?? []) as NotificationEvent[]
    return {
      ok: true,
      events,
      unreadCount: count ?? 0,
    }
  },
  { unauthenticated: () => {
    return { error: 'Not authenticated.' }
  }},
)

type TestNotificationResult =
  | { error: string }
  | { ok: true; delivered: boolean; reason: string | null }

/**
 * Creates a real notification event for the caller and runs it through the
 * actual push delivery path, then reports what happened — so "is push
 * working on this device?" is answerable with one tap instead of a second
 * account and a test mention.
 */
export const sendTestNotification = withAuth(
  async ({ supabase, user }): Promise<TestNotificationResult> => {
    const sourceId = crypto.randomUUID()

    const { error: insertError } = await supabase
      .from('notification_events')
      .insert({
        user_id: user.id,
        actor_id: user.id,
        type: 'mention',
        source_table: 'messages',
        source_id: sourceId,
        conversation_id: null,
        channel_id: null,
        title: 'Test notification',
        body: 'Push delivery is working on this device 🎉',
        url: '/settings/profile',
      })

    if (insertError) return { error: insertError.message }

    const { deliverPushForSources, isPushDeliveryConfigured } = await import('@/lib/push/delivery')
    if (!isPushDeliveryConfigured()) {
      return { ok: true, delivered: false, reason: 'not_configured' }
    }

    await deliverPushForSources([sourceId])

    const { data: event } = await supabase
      .from('notification_events')
      .select('pushed_at, push_error')
      .eq('user_id', user.id)
      .eq('source_id', sourceId)
      .maybeSingle()

    const row = event as { pushed_at: string | null; push_error: string | null } | null
    if (!row?.pushed_at) {
      return { ok: true, delivered: false, reason: 'not_attempted' }
    }
    return { ok: true, delivered: row.push_error === null, reason: row.push_error }
  },
  { unauthenticated: () => {
    return { error: 'Not authenticated.' }
  }},
)

export const markNotificationEventRead = withAuth(
  async ({ supabase, user }, eventId: string): Promise<SubscriptionResult> => {
    const normalizedId = eventId.trim()
    if (!normalizedId) return { error: 'Invalid notification event.' }

    const { error } = await supabase
      .from('notification_events')
      .update({ read_at: new Date().toISOString() })
      .eq('id', normalizedId)
      .eq('user_id', user.id)

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => {
    return { error: 'Not authenticated.' }
  }},
)

export const markAllNotificationEventsRead = withAuth(
  async ({ supabase, user }): Promise<SubscriptionResult> => {
    const { error } = await supabase
      .from('notification_events')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('read_at', null)

    if (error) return { error: error.message }
    return { ok: true }
  },
  { unauthenticated: () => {
    return { error: 'Not authenticated.' }
  }},
)
