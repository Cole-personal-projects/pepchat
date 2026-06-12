import { createAdminClient } from '@/lib/supabase/admin'
import { sendWebPush, type PushSubscriptionKeys, type VapidConfig } from '@/lib/push/webPush'

/**
 * Web-push delivery for queued notification_events.
 *
 * Runs inline at the tail of the message-send server actions (the same
 * fire-and-forget block that enqueues the events), keyed by the message's
 * source id. Uses the service-role client because RLS correctly hides
 * recipients' push subscriptions and events from the sender.
 *
 * Missing configuration (VAPID keys or service-role key) downgrades to a
 * no-op so local/mock environments keep working without push.
 */

type EventRow = {
  id: string
  user_id: string
  title: string
  body: string | null
  url: string | null
}

type SubscriptionRow = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

export function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) return null
  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@sidebarchat.net',
  }
}

export function isPushDeliveryConfigured(): boolean {
  return getVapidConfig() !== null && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/** Injection seams for tests. */
export interface DeliveryDeps {
  adminClient?: ReturnType<typeof createAdminClient>
  send?: typeof sendWebPush
  vapid?: VapidConfig | null
}

/**
 * Delivers every still-unpushed notification event for the given source ids
 * (message ids), one push per registered device, then records the outcome on
 * the event row. Dead endpoints (404/410 from the push service) are pruned.
 */
export async function deliverPushForSources(
  sourceIds: string[],
  deps: DeliveryDeps = {},
): Promise<void> {
  const ids = sourceIds.filter(Boolean)
  if (ids.length === 0) return

  const vapid = deps.vapid !== undefined ? deps.vapid : getVapidConfig()
  if (!vapid) return
  if (!deps.adminClient && !process.env.SUPABASE_SERVICE_ROLE_KEY) return

  const supabase = deps.adminClient ?? createAdminClient()
  const send = deps.send ?? sendWebPush

  const { data: eventRows, error: eventsError } = await supabase
    .from('notification_events')
    .select('id, user_id, title, body, url')
    .in('source_id', ids)
    .is('pushed_at', null)

  if (eventsError) return
  const events = (eventRows ?? []) as EventRow[]
  if (events.length === 0) return

  const userIds = Array.from(new Set(events.map(event => event.user_id)))
  const { data: subscriptionRows, error: subscriptionsError } = await supabase
    .from('notification_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', userIds)

  if (subscriptionsError) return
  const subscriptions = (subscriptionRows ?? []) as SubscriptionRow[]
  const subscriptionsByUser = new Map<string, SubscriptionRow[]>()
  for (const subscription of subscriptions) {
    const list = subscriptionsByUser.get(subscription.user_id) ?? []
    list.push(subscription)
    subscriptionsByUser.set(subscription.user_id, list)
  }

  const deadSubscriptionIds = new Set<string>()

  await Promise.all(events.map(async event => {
    const targets = subscriptionsByUser.get(event.user_id) ?? []
    // No registered device is a terminal outcome for this event, not an
    // error: mark it pushed so the queue cannot grow unbounded.
    if (targets.length === 0) {
      await supabase
        .from('notification_events')
        .update({ pushed_at: new Date().toISOString(), push_error: 'no_subscriptions' })
        .eq('id', event.id)
      return
    }

    const payload = JSON.stringify({
      title: event.title,
      body: event.body ?? undefined,
      url: event.url ?? '/',
    })

    const results = await Promise.all(targets.map(async target => {
      const keys: PushSubscriptionKeys = {
        endpoint: target.endpoint,
        p256dh: target.p256dh,
        auth: target.auth,
      }
      const result = await send(keys, payload, vapid)
      if (!result.ok && result.subscriptionGone) deadSubscriptionIds.add(target.id)
      return result
    }))

    const delivered = results.filter(result => result.ok).length
    const firstError = results.find(result => !result.ok)
    await supabase
      .from('notification_events')
      .update({
        pushed_at: new Date().toISOString(),
        push_error: delivered > 0
          ? null
          : (firstError && !firstError.ok ? firstError.error : 'delivery_failed'),
      })
      .eq('id', event.id)
  }))

  if (deadSubscriptionIds.size > 0) {
    await supabase
      .from('notification_subscriptions')
      .delete()
      .in('id', Array.from(deadSubscriptionIds))
  }
}
