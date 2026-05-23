import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useUnreadChannels } from '@/lib/hooks/useUnreadChannels'

// ─── Mock Supabase ────────────────────────────────────────────────────────────

// vi.hoisted ensures the variable exists before vi.mock's hoisted factory runs
const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: mockCreateClient }))

type Callback = (payload: unknown) => void

function makeChannelMock() {
  const tableCallbacks: Record<string, Callback> = {}
  const ch: Record<string, unknown> = {}
  ch.on = vi.fn((_event: string, filter: Record<string, unknown>, cb: Callback) => {
    if (filter?.table) tableCallbacks[filter.table as string] = cb
    return ch
  })
  ch.subscribe = vi.fn(() => ch)
  ch.unsubscribe = vi.fn().mockResolvedValue('ok')
  ch._trigger = (table: string, payload: unknown) => tableCallbacks[table]?.(payload)
  return ch
}

function makeBuilder(data: unknown) {
  const b: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'in', 'order', 'limit', 'upsert', 'filter']
  for (const m of methods) b[m] = vi.fn(() => b)
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res)
  b.catch = (rej: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).catch(rej)
  b.finally = (cb: () => void) => Promise.resolve({ data, error: null }).finally(cb)
  return b
}

function setupMock(tableData: Record<string, unknown>) {
  const channelMock = makeChannelMock()
  mockCreateClient.mockReturnValue({
    from: vi.fn((table: string) => makeBuilder(tableData[table] ?? null)),
    channel: vi.fn(() => channelMock),
    removeChannel: vi.fn().mockResolvedValue({ error: null }),
  })
  return channelMock
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = 'user-1'
const OTHER_ID = 'user-2'
const CH_A = { id: 'ch-a', group_id: 'grp-1' }
const CH_B = { id: 'ch-b', group_id: 'grp-2' }
const BEFORE = '2024-01-01T10:00:00Z'
const NOW    = '2024-01-01T12:00:00Z'
const AFTER  = '2024-01-01T14:00:00Z'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useUnreadChannels', () => {
  afterEach(() => { vi.clearAllMocks() })

  it('returns empty sets when no messages exist', async () => {
    setupMock({ channels: [CH_A], channel_read_state: [], messages: [] })
    const { result } = renderHook(() => useUnreadChannels(USER_ID, null))
    await waitFor(() => { expect(result.current.unreadChannelIds.size).toBe(0) })
    expect(result.current.unreadGroupIds.size).toBe(0)
  })

  it('marks channel unread when other-user message exists after last_read_at', async () => {
    setupMock({
      channels: [CH_A],
      channel_read_state: [{ channel_id: 'ch-a', last_read_at: BEFORE }],
      messages: [{ channel_id: 'ch-a', created_at: AFTER }],
    })
    const { result } = renderHook(() => useUnreadChannels(USER_ID, null))
    await waitFor(() => { expect(result.current.unreadChannelIds.has('ch-a')).toBe(true) })
    expect(result.current.unreadCountsByChannelId.get('ch-a')).toBe(1)
  })

  it('does not mark channel unread when all messages are before last_read_at', async () => {
    setupMock({
      channels: [CH_A],
      channel_read_state: [{ channel_id: 'ch-a', last_read_at: NOW }],
      messages: [{ channel_id: 'ch-a', created_at: BEFORE }],
    })
    const { result } = renderHook(() => useUnreadChannels(USER_ID, null))
    await waitFor(() => { expect(result.current.unreadChannelIds.has('ch-a')).toBe(false) })
  })

  it('marks channel unread when no read state row exists', async () => {
    setupMock({
      channels: [CH_A],
      channel_read_state: [],
      messages: [{ channel_id: 'ch-a', created_at: NOW }],
    })
    const { result } = renderHook(() => useUnreadChannels(USER_ID, null))
    await waitFor(() => { expect(result.current.unreadChannelIds.has('ch-a')).toBe(true) })
  })

  it('excludes the active channel from the unread set on initial load', async () => {
    setupMock({
      channels: [CH_A],
      channel_read_state: [],
      messages: [{ channel_id: 'ch-a', created_at: NOW }],
    })
    const { result } = renderHook(() => useUnreadChannels(USER_ID, 'ch-a'))
    await waitFor(() => { expect(result.current.unreadChannelIds.size).toBe(0) })
  })

  it('derives unreadGroupIds from the channel-to-group mapping', async () => {
    setupMock({
      channels: [CH_A, CH_B],
      channel_read_state: [],
      messages: [
        { channel_id: 'ch-a', created_at: NOW },
        { channel_id: 'ch-b', created_at: NOW },
      ],
    })
    const { result } = renderHook(() => useUnreadChannels(USER_ID, null))
    await waitFor(() => {
      expect(result.current.unreadGroupIds.has('grp-1')).toBe(true)
      expect(result.current.unreadGroupIds.has('grp-2')).toBe(true)
    })
  })

  it('counts unread messages per channel', async () => {
    setupMock({
      channels: [CH_A, CH_B],
      channel_read_state: [{ channel_id: 'ch-a', last_read_at: BEFORE }],
      messages: [
        { channel_id: 'ch-a', created_at: NOW },
        { channel_id: 'ch-a', created_at: AFTER },
        { channel_id: 'ch-b', created_at: NOW },
      ],
    })
    const { result } = renderHook(() => useUnreadChannels(USER_ID, null))
    await waitFor(() => {
      expect(result.current.unreadCountsByChannelId.get('ch-a')).toBe(2)
      expect(result.current.unreadCountsByChannelId.get('ch-b')).toBe(1)
    })
  })

  it('adds channel to unread when realtime message arrives from another user', async () => {
    const ch = setupMock({ channels: [CH_A], channel_read_state: [], messages: [] })
    const { result } = renderHook(() => useUnreadChannels(USER_ID, null))
    await waitFor(() => { expect(result.current.unreadChannelIds.size).toBe(0) })

    act(() => {
      ;(ch._trigger as (t: string, p: unknown) => void)('messages', {
        new: { channel_id: 'ch-a', user_id: OTHER_ID },
      })
    })

    expect(result.current.unreadChannelIds.has('ch-a')).toBe(true)
    expect(result.current.unreadCountsByChannelId.get('ch-a')).toBe(1)
  })

  it('ignores realtime thread replies for channel unread state', async () => {
    const ch = setupMock({ channels: [CH_A], channel_read_state: [], messages: [] })
    const { result } = renderHook(() => useUnreadChannels(USER_ID, null))
    await waitFor(() => { expect(result.current.unreadChannelIds.size).toBe(0) })

    act(() => {
      ;(ch._trigger as (t: string, p: unknown) => void)('messages', {
        new: { channel_id: 'ch-a', user_id: OTHER_ID, thread_root_id: 'root-1' },
      })
    })

    expect(result.current.unreadChannelIds.has('ch-a')).toBe(false)
    expect(result.current.unreadCountsByChannelId.has('ch-a')).toBe(false)
  })

  it('does not add active channel to unread on realtime message', async () => {
    const ch = setupMock({ channels: [CH_A], channel_read_state: [], messages: [] })
    const { result } = renderHook(() => useUnreadChannels(USER_ID, 'ch-a'))
    await waitFor(() => { expect(result.current.unreadChannelIds.size).toBe(0) })

    act(() => {
      ;(ch._trigger as (t: string, p: unknown) => void)('messages', {
        new: { channel_id: 'ch-a', user_id: OTHER_ID },
      })
    })

    expect(result.current.unreadChannelIds.has('ch-a')).toBe(false)
    expect(result.current.unreadCountsByChannelId.has('ch-a')).toBe(false)
  })

  it('ignores realtime messages from the current user', async () => {
    const ch = setupMock({ channels: [CH_A], channel_read_state: [], messages: [] })
    const { result } = renderHook(() => useUnreadChannels(USER_ID, null))
    await waitFor(() => { expect(result.current.unreadChannelIds.size).toBe(0) })

    act(() => {
      ;(ch._trigger as (t: string, p: unknown) => void)('messages', {
        new: { channel_id: 'ch-a', user_id: USER_ID },
      })
    })

    expect(result.current.unreadChannelIds.has('ch-a')).toBe(false)
  })

  it('removes channel from unread when channel_read_state is upserted', async () => {
    const ch = setupMock({
      channels: [CH_A],
      channel_read_state: [],
      messages: [{ channel_id: 'ch-a', created_at: NOW }],
    })
    const { result } = renderHook(() => useUnreadChannels(USER_ID, null))
    await waitFor(() => { expect(result.current.unreadChannelIds.has('ch-a')).toBe(true) })

    act(() => {
      ;(ch._trigger as (t: string, p: unknown) => void)('channel_read_state', {
        new: { channel_id: 'ch-a', user_id: USER_ID },
      })
    })

    expect(result.current.unreadChannelIds.has('ch-a')).toBe(false)
  })

  it('clears active channel from unread set when activeChannelId prop changes', async () => {
    setupMock({
      channels: [CH_A],
      channel_read_state: [],
      messages: [{ channel_id: 'ch-a', created_at: NOW }],
    })
    const { result, rerender } = renderHook(
      ({ active }: { active: string | null }) => useUnreadChannels(USER_ID, active),
      { initialProps: { active: null as string | null } }
    )
    await waitFor(() => { expect(result.current.unreadChannelIds.has('ch-a')).toBe(true) })

    rerender({ active: 'ch-a' })

    expect(result.current.unreadChannelIds.has('ch-a')).toBe(false)
    expect(result.current.unreadCountsByChannelId.has('ch-a')).toBe(false)
  })
})
