import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getUnreadFromMessageLastReadAt,
  markChannelRead,
  markChannelUnread,
  markChannelUnreadFromMessage,
} from '@/lib/channelReadState'

const mockUpsert = vi.fn().mockResolvedValue({ error: null })
const mockMaybeSingle = vi.fn().mockResolvedValue({ data: { created_at: '2024-01-01T12:00:00.000Z' }, error: null })
const mockLimit = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockOrder = vi.fn(() => ({ limit: mockLimit }))
const mockIsMessages = vi.fn(() => ({ order: mockOrder }))
const mockEqMessages = vi.fn(() => ({ is: mockIsMessages }))
const mockSelectMessages = vi.fn(() => ({ eq: mockEqMessages }))
const mockFrom = vi.fn((table: string) => {
  if (table === 'messages') return { select: mockSelectMessages }
  return { upsert: mockUpsert }
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

describe('getUnreadFromMessageLastReadAt', () => {
  it('returns one millisecond before the selected message timestamp', () => {
    expect(getUnreadFromMessageLastReadAt('2024-01-01T12:00:00.000Z')).toBe('2024-01-01T11:59:59.999Z')
  })

  it('falls back to the epoch for invalid timestamps', () => {
    expect(getUnreadFromMessageLastReadAt('not-a-date')).toBe('1970-01-01T00:00:00.000Z')
  })
})

describe('markChannelRead', () => {
  afterEach(() => { vi.clearAllMocks() })

  it('calls upsert on channel_read_state with correct user_id and channel_id', async () => {
    await markChannelRead('ch-1', 'user-1')
    expect(mockFrom).toHaveBeenCalledWith('channel_read_state')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', channel_id: 'ch-1' }),
      expect.objectContaining({ onConflict: 'user_id,channel_id' })
    )
  })

  it('includes a last_read_at timestamp in the upsert payload', async () => {
    await markChannelRead('ch-1', 'user-1')
    const [payload] = mockUpsert.mock.calls[0]
    expect(typeof payload.last_read_at).toBe('string')
    expect(payload.last_read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('resolves without throwing when supabase returns an error', async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: 'Permission denied' } })
    await expect(markChannelRead('ch-1', 'user-1')).resolves.toBeUndefined()
  })
})

describe('markChannelUnreadFromMessage', () => {
  afterEach(() => { vi.clearAllMocks() })

  it('sets last_read_at just before the selected message', async () => {
    await markChannelUnreadFromMessage('ch-1', 'user-1', '2024-01-01T12:00:00.000Z')

    expect(mockFrom).toHaveBeenCalledWith('channel_read_state')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        channel_id: 'ch-1',
        last_read_at: '2024-01-01T11:59:59.999Z',
      }),
      expect.objectContaining({ onConflict: 'user_id,channel_id' })
    )
  })

  it('falls back to the epoch for invalid message timestamps', async () => {
    await markChannelUnreadFromMessage('ch-1', 'user-1', 'not-a-date')

    const [payload] = mockUpsert.mock.calls[0]
    expect(payload.last_read_at).toBe('1970-01-01T00:00:00.000Z')
  })
})

describe('markChannelUnread', () => {
  afterEach(() => { vi.clearAllMocks() })

  it('marks the latest channel message unread', async () => {
    await markChannelUnread('ch-1', 'user-1')

    expect(mockFrom).toHaveBeenCalledWith('messages')
    expect(mockSelectMessages).toHaveBeenCalledWith('created_at')
    expect(mockEqMessages).toHaveBeenCalledWith('channel_id', 'ch-1')
    expect(mockIsMessages).toHaveBeenCalledWith('thread_root_id', null)
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(mockLimit).toHaveBeenCalledWith(1)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        channel_id: 'ch-1',
        last_read_at: '2024-01-01T11:59:59.999Z',
      }),
      expect.objectContaining({ onConflict: 'user_id,channel_id' })
    )
  })

  it('falls back to the epoch when no messages exist', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    await markChannelUnread('ch-1', 'user-1')

    const [payload] = mockUpsert.mock.calls[0]
    expect(payload.last_read_at).toBe('1970-01-01T00:00:00.000Z')
  })
})
