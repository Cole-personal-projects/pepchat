import { describe, expect, it } from 'vitest'
import { MESSAGE_SELECT, THREAD_MESSAGE_SELECT } from '@/lib/queries'

describe('message selects', () => {
  it('does not expose raw promoted target channel IDs in client-facing message selects', () => {
    expect(MESSAGE_SELECT).not.toContain('*')
    expect(MESSAGE_SELECT).not.toMatch(/(^|[,(\s])promoted_to_channel_id([,)\s]|$)/)
    expect(MESSAGE_SELECT).toContain('promoted_at')
    expect(MESSAGE_SELECT).toContain('promoted_channel:promoted_to_channel_id(id, name)')
    expect(MESSAGE_SELECT).toContain('mirrored_from_thread:mirrored_from_thread_id(id, thread_root_id, promoted_at, promoted_channel:promoted_to_channel_id(id, name))')
    expect(THREAD_MESSAGE_SELECT).toBe(MESSAGE_SELECT)
  })
})
