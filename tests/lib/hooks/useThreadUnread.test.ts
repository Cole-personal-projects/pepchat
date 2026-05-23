import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThreadUnread } from '@/lib/hooks/useThreadUnread'

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }))

vi.mock('@/lib/supabase/client', () => ({ createClient: mockCreateClient }))

function setupReadState(lastReadAt: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: lastReadAt ? { last_read_at: lastReadAt } : null,
    error: null,
  })
  const eqThreadRoot = vi.fn(() => ({ maybeSingle }))
  const eqUser = vi.fn(() => ({ eq: eqThreadRoot }))
  const select = vi.fn(() => ({ eq: eqUser }))
  const from = vi.fn(() => ({ select }))
  mockCreateClient.mockReturnValue({ from })
  return { from, select, eqUser, eqThreadRoot, maybeSingle }
}

describe('useThreadUnread', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when a thread has replies and no read state', async () => {
    const client = setupReadState(null)

    const { result } = renderHook(() =>
      useThreadUnread('root-1', '2026-01-01T00:00:00.000Z', 1, 'user-1')
    )

    await waitFor(() => expect(client.maybeSingle).toHaveBeenCalled())
    expect(client.from).toHaveBeenCalledWith('thread_read_state')
    expect(client.eqUser).toHaveBeenCalledWith('user_id', 'user-1')
    expect(client.eqThreadRoot).toHaveBeenCalledWith('thread_root_id', 'root-1')
    expect(result.current).toBe(true)
  })

  it('compares the last reply time against existing read state', async () => {
    setupReadState('2026-01-01T00:05:00.000Z')

    const { result, rerender } = renderHook(
      ({ lastReplyAt }) => useThreadUnread('root-1', lastReplyAt, 1, 'user-1'),
      { initialProps: { lastReplyAt: '2026-01-01T00:00:00.000Z' } }
    )

    await waitFor(() => expect(result.current).toBe(false))

    rerender({ lastReplyAt: '2026-01-01T00:10:00.000Z' })
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('clears and re-invalidates unread state from thread lifecycle events', async () => {
    setupReadState(null)

    const { result, rerender } = renderHook(
      ({ lastReplyAt }) => useThreadUnread('root-1', lastReplyAt, 1, 'user-1'),
      { initialProps: { lastReplyAt: '2026-01-01T00:00:00.000Z' } }
    )

    await waitFor(() => expect(result.current).toBe(true))

    act(() => {
      window.dispatchEvent(new CustomEvent('thread-read', { detail: { rootId: 'root-1' } }))
    })
    expect(result.current).toBe(false)

    act(() => {
      window.dispatchEvent(
        new CustomEvent('thread-activity', {
          detail: { rootId: 'root-1', lastReplyAt: '2099-01-01T00:10:00.000Z' },
        })
      )
    })
    act(() => {
      rerender({ lastReplyAt: '2099-01-01T00:10:00.000Z' })
    })
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('does not query read state when no current user is available', () => {
    const { result } = renderHook(() => useThreadUnread('root-1', '2026-01-01T00:00:00.000Z', 1))

    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(result.current).toBe(false)
  })
})
