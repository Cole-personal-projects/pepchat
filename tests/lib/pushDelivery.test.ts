// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { deliverPushForSources } from '@/lib/push/delivery'
import type { PushSubscriptionKeys, VapidConfig, WebPushSendResult } from '@/lib/push/webPush'

const VAPID: VapidConfig = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:test@example.com' }

type TableData = Record<string, unknown[]>

/**
 * Minimal chainable supabase stub: every query resolves to the table's rows
 * (filters ignored — tests assert on recorded calls instead).
 */
function makeAdminStub(tables: TableData) {
  const updates: Array<{ table: string; values: Record<string, unknown>; id: unknown }> = []
  const deletes: Array<{ table: string; ids: unknown[] }> = []

  function builder(table: string) {
    const result = { data: tables[table] ?? [], error: null }
    const chain: Record<string, unknown> = {}
    const self = () => chain
    chain.select = vi.fn(self)
    chain.in = vi.fn((_col: string, ids: unknown[]) => {
      const pendingDelete = deletes.find(d => d.table === table && d.ids.length === 0)
      if (pendingDelete) pendingDelete.ids.push(...ids)
      return chain
    })
    chain.is = vi.fn(self)
    chain.update = vi.fn((values: Record<string, unknown>) => {
      chain.eq = vi.fn((_col: string, id: unknown) => {
        updates.push({ table, values, id })
        return Promise.resolve({ data: null, error: null })
      })
      return chain
    })
    chain.delete = vi.fn(() => {
      deletes.push({ table, ids: [] })
      return chain
    })
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject)
    return chain
  }

  return {
    client: { from: vi.fn((table: string) => builder(table)) },
    updates,
    deletes,
  }
}

const EVENT = {
  id: 'evt-1',
  user_id: 'user-1',
  title: 'Ashe mentioned you',
  body: 'hello',
  url: '/channels/c1#m1',
}

const SUBSCRIPTION = {
  id: 'sub-1',
  user_id: 'user-1',
  endpoint: 'https://push.example.com/send/1',
  p256dh: 'p256dh-key',
  auth: 'auth-secret',
}

function okSend(): Promise<WebPushSendResult> {
  return Promise.resolve({ ok: true, statusCode: 201 })
}

describe('deliverPushForSources', () => {
  it('sends one push per device and marks the event pushed', async () => {
    const { client, updates } = makeAdminStub({
      notification_events: [EVENT],
      notification_subscriptions: [
        SUBSCRIPTION,
        { ...SUBSCRIPTION, id: 'sub-2', endpoint: 'https://push.example.com/send/2' },
      ],
    })
    const send = vi.fn(okSend)

    await deliverPushForSources(['msg-1'], { adminClient: client as never, send, vapid: VAPID })

    expect(send).toHaveBeenCalledTimes(2)
    const [keys, payload] = send.mock.calls[0] as unknown as [PushSubscriptionKeys, string]
    expect(keys.endpoint).toBe('https://push.example.com/send/1')
    expect(JSON.parse(payload)).toEqual({ title: EVENT.title, body: 'hello', url: EVENT.url })
    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe('evt-1')
    expect(updates[0].values.push_error).toBeNull()
    expect(updates[0].values.pushed_at).toBeTruthy()
  })

  it('marks events with no registered devices as terminal (no_subscriptions)', async () => {
    const { client, updates } = makeAdminStub({
      notification_events: [EVENT],
      notification_subscriptions: [],
    })
    const send = vi.fn(okSend)

    await deliverPushForSources(['msg-1'], { adminClient: client as never, send, vapid: VAPID })

    expect(send).not.toHaveBeenCalled()
    expect(updates[0].values.push_error).toBe('no_subscriptions')
  })

  it('prunes subscriptions the push service reports gone (410)', async () => {
    const { client, deletes } = makeAdminStub({
      notification_events: [EVENT],
      notification_subscriptions: [SUBSCRIPTION],
    })
    const send = vi.fn().mockResolvedValue({
      ok: false, statusCode: 410, error: 'Push service responded 410', subscriptionGone: true,
    })

    await deliverPushForSources(['msg-1'], { adminClient: client as never, send, vapid: VAPID })

    expect(deletes).toHaveLength(1)
    expect(deletes[0].table).toBe('notification_subscriptions')
    expect(deletes[0].ids).toEqual(['sub-1'])
  })

  it('records the failure on the event when every device fails', async () => {
    const { client, updates } = makeAdminStub({
      notification_events: [EVENT],
      notification_subscriptions: [SUBSCRIPTION],
    })
    const send = vi.fn().mockResolvedValue({
      ok: false, statusCode: 500, error: 'Push service responded 500', subscriptionGone: false,
    })

    await deliverPushForSources(['msg-1'], { adminClient: client as never, send, vapid: VAPID })

    expect(updates[0].values.push_error).toBe('Push service responded 500')
  })

  it('no-ops when VAPID keys are not configured', async () => {
    const { client } = makeAdminStub({ notification_events: [EVENT] })
    const send = vi.fn(okSend)

    await deliverPushForSources(['msg-1'], { adminClient: client as never, send, vapid: null })

    expect(client.from).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('no-ops on an empty source list', async () => {
    const { client } = makeAdminStub({})
    await deliverPushForSources([], { adminClient: client as never, send: vi.fn(okSend), vapid: VAPID })
    expect(client.from).not.toHaveBeenCalled()
  })
})
